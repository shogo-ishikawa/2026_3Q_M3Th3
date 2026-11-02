using System;
using System.Collections.Concurrent;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Pip0Shell.Core;
using Pip0Shell.Ipc;
using Windows.Win32.Foundation;

namespace Pip0Shell.CloudFiles;

/// <summary>
/// ゴーストが開かれたとき（FETCH_DATA）に、保管庫から中身を渡す。
///
/// 1. FileIdentity から項目ID を読み、VAULT_DIR\items\&lt;項目ID&gt;\manifest.json を読む。
/// 2. content の大きさと SHA-256 が manifest.json と一致することを、渡す前に確かめる。
/// 3. 求められた範囲を 4 KiB 単位にそろえ、1 MiB ずつ CfExecute（TRANSFER_DATA）で渡す。
///    長さが 4 KiB の倍数でないのは、ファイルの終わりで終わる最後の1回だけ。
/// 4. どこかで一致しない・読めないときは、エラーの状態で返す（違う内容や空の内容は決して渡さない）。
/// 5. 本体へ cf.fetch を送る。ファイル全体を渡し終えたら cf.hydrated も送る。
/// </summary>
internal sealed class FetchDataService
{
    /// <summary>1回に渡す大きさ（4 KiB の倍数）</summary>
    private const int ChunkBytes = 1024 * 1024;

    private readonly ShellOutput output;
    private readonly Func<string?> vaultDirectory;
    private readonly HydrationTracker tracker = new();
    private readonly ConcurrentDictionary<FetchJob, byte> active = new();
    private volatile bool stopping;

    public FetchDataService(ShellOutput output, Func<string?> vaultDirectory)
    {
        this.output = output;
        this.vaultDirectory = vaultDirectory;
    }

    /// <summary>コールバックから呼ぶ。処理は別のスレッドで行い、コールバックはすぐに戻る</summary>
    public void Start(FetchJob job)
    {
        if (stopping)
        {
            Finish(job, Fail(job, FullRange(job), "シェルが終了の処理中のため、中身を渡せません。"));
            return;
        }
        active[job] = 0;
        Task.Factory.StartNew(() => Run(job), CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);
    }

    /// <summary>CANCEL_FETCH_DATA：Windows が取り消した要求を止める</summary>
    public void CancelByPlatform(long transferKey)
    {
        foreach (FetchJob job in active.Keys)
        {
            if (job.Keys.TransferKey == transferKey)
            {
                job.CancelByPlatform();
            }
        }
    }

    /// <summary>終了のとき：処理中の要求を中止してエラーで返し、終わるまで少し待つ</summary>
    public void StopAll(TimeSpan wait)
    {
        stopping = true;
        foreach (FetchJob job in active.Keys)
        {
            job.CancelForShutdown();
        }
        DateTime deadline = DateTime.UtcNow + wait;
        while (!active.IsEmpty && DateTime.UtcNow < deadline)
        {
            Thread.Sleep(50);
        }
    }

    /// <summary>接続し直すとき：新しい要求を再び受け付ける</summary>
    public void Resume()
    {
        stopping = false;
    }

    private void Run(FetchJob job)
    {
        FetchOutcome outcome;
        try
        {
            outcome = Serve(job);
        }
        catch (Exception error)
        {
            Log.Error("ゴーストの中身を渡す処理で予期しないエラーが起きました：" + Log.Describe(error));
            outcome = Fail(job, FullRange(job), "シェルの内部で予期しないエラーが起きました（" + error.GetType().Name + "）。");
        }
        active.TryRemove(job, out _);
        Finish(job, outcome);
    }

    private unsafe FetchOutcome Serve(FetchJob job)
    {
        (long start, long end) = FullRange(job);
        if (job.ItemId is null)
        {
            return Fail(job, (start, end), "ゴーストの項目ID（FileIdentity）を読めません。");
        }
        if (end <= start)
        {
            return Fail(job, (start, end), "求められた範囲が正しくありません。");
        }
        string? vaultDir = vaultDirectory();
        if (vaultDir is null)
        {
            return Fail(job, (start, end), "保管庫の場所が設定されていません。");
        }

        VaultContent? content;
        string problem;
        try
        {
            // 渡す前に、保管庫の内容の大きさと SHA-256 を確かめる（大きいファイルは時間がかかるので、進み具合を知らせる）
            content = VaultContent.OpenVerified(
                vaultDir,
                job.ItemId,
                job.FileSize,
                expectedSha256: null,
                hashed => CloudOperations.ReportProgress(job.Keys, job.FileSize, hashed / 2),
                job.Token,
                out _,
                out problem);
        }
        catch (OperationCanceledException)
        {
            return Stopped(job, (start, end));
        }
        if (content is null)
        {
            return Fail(job, (start, end), problem);
        }

        using (content)
        {
            byte* buffer = (byte*)NativeMemory.AlignedAlloc(ChunkBytes, (nuint)TransferRange.Alignment);
            long offset = start;
            try
            {
                // 1 MiB ずつ渡す。4 KiB の倍数でない長さになるのは、ファイルの終わりで終わる最後の1回だけ
                foreach ((long chunkOffset, int length) in TransferRange.Chunks(start, end, ChunkBytes))
                {
                    offset = chunkOffset;
                    if (job.Token.IsCancellationRequested)
                    {
                        return Stopped(job, (offset, end));
                    }
                    int read = content.ReadAt(offset, new Span<byte>(buffer, length));
                    if (read != length)
                    {
                        return Fail(job, (offset, end), "保管庫の内容を最後まで読めませんでした。");
                    }
                    int result = CloudOperations.Transfer(job.Keys, buffer, offset, length);
                    if (result < 0)
                    {
                        // Windows 側で要求が終わった（取り消し、時間切れ等）。これ以上は渡さない
                        return new FetchOutcome(false, false, "中身を渡せませんでした（" + HResultText.Describe(result) + "）。");
                    }
                }
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                return Fail(job, (offset, end), "保管庫の内容を読めません（" + HResultText.Describe(error.HResult) + "）。");
            }
            finally
            {
                NativeMemory.AlignedFree(buffer);
            }
        }

        bool hydrated = tracker.MarkServed(job.ItemId, job.FileSize, start, end);
        return new FetchOutcome(true, hydrated, "");
    }

    /// <summary>求められた範囲を 4 KiB 単位に広げる（終わりはファイルの大きさを超えない）</summary>
    private static (long Start, long End) FullRange(FetchJob job)
    {
        return TransferRange.Align(job.RequiredOffset, job.RequiredLength, job.FileSize);
    }

    /// <summary>エラーの状態で返す（Windows が取り消した要求には、もう返さない）</summary>
    private static FetchOutcome Fail(FetchJob job, (long Start, long End) range, string reason)
    {
        if (range.End <= range.Start)
        {
            // そろえた範囲が空のときは、求められた範囲のまま返す（返さないと、アプリが時間切れまで待たされる）
            range = (Math.Max(0, job.RequiredOffset), Math.Max(0, job.RequiredOffset) + Math.Max(0, job.RequiredLength));
        }
        if (!job.CancelledByPlatform && range.End > range.Start)
        {
            int result = CloudOperations.FailTransfer(
                job.Keys, range.Start, range.End - range.Start, NTSTATUS.STATUS_CLOUD_FILE_UNSUCCESSFUL);
            if (result < 0)
            {
                Log.Warning("FETCH_DATA にエラーを返せませんでした（" + Log.Hex(result) + "）。");
            }
        }
        return new FetchOutcome(false, false, reason);
    }

    /// <summary>取り消し（Windows から）または終了（シェルから）で止めた</summary>
    private static FetchOutcome Stopped(FetchJob job, (long Start, long End) range)
    {
        if (job.CancelledByPlatform)
        {
            return new FetchOutcome(false, false, "読み取りが取り消されました。");
        }
        return Fail(job, range, "シェルが終了するため、中身を渡すのを中止しました。");
    }

    private void Finish(FetchJob job, FetchOutcome outcome)
    {
        string elapsed = job.ElapsedMilliseconds.ToString("F0", CultureInfo.InvariantCulture);
        string item = job.ItemId ?? "（不明）";
        if (outcome.Served)
        {
            Log.Info("ゴーストの中身を渡しました（項目 " + item + "、" + elapsed + " ms）。");
        }
        else
        {
            Log.Warning("ゴーストの中身を渡せませんでした（項目 " + item + "、" + elapsed + " ms）：" + outcome.Reason);
        }

        output.SendEvent("cf.fetch", new JsonObject
        {
            ["item_id"] = job.ItemId,
            ["path"] = job.Path,
            ["process_name"] = job.ProcessName,
            ["process_id"] = job.ProcessId,
            ["by_pip0"] = job.ByPip0,
            ["result"] = outcome.Served ? "served" : "failed",
            ["reason"] = outcome.Reason,
            ["elapsed_ms"] = Math.Round(job.ElapsedMilliseconds, 1),
        });

        if (outcome.Hydrated)
        {
            // by_pip0 は約束（ipc-protocol.md）にない追加の項目。pip0 自身の復元で中身が戻ったときに真
            output.SendEvent("cf.hydrated", new JsonObject
            {
                ["item_id"] = job.ItemId,
                ["path"] = job.Path,
                ["by_pip0"] = job.ByPip0,
            });
        }
    }

    private readonly record struct FetchOutcome(bool Served, bool Hydrated, string Reason);
}
