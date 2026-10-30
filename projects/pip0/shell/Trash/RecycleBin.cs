using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using Pip0Shell.CloudFiles;
using Pip0Shell.Core;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.UI.Shell;

namespace Pip0Shell.Trash;

/// <summary>1件のごみ箱への移動の結果（"recycled"/"refused"/"failed"/"not_attempted"）</summary>
internal sealed record RecycleResult(string Status, string Reason);

/// <summary>
/// Windows のごみ箱へ、1件ずつ移す（IFileOperation）。確認画面で承認された後にだけ呼ばれます。
///
/// - IFileOperation は STA のスレッドで使うため、専用のスレッドを作って動かします。
/// - 操作の印：FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI | FOFX_RECYCLEONDELETE | FOFX_EARLYFAILURE
///   に加えて FOF_NO_CONNECTED_ELEMENTS（「page.html」を消すときに「page_files」フォルダーまで一緒に消さないため。
///   確認画面に出していないものを消さないための追加です）。
/// - ごみ箱に入らない（完全に削除される）場合は、<see cref="RecycleProgressSink"/> が止めて "refused" にします。
///   通常の削除や完全な削除に切り替えることはしません。
/// </summary>
internal static class RecycleBin
{
    private const FILEOPERATION_FLAGS OperationFlags =
        FILEOPERATION_FLAGS.FOF_ALLOWUNDO
        | FILEOPERATION_FLAGS.FOF_NOCONFIRMATION
        | FILEOPERATION_FLAGS.FOF_SILENT
        | FILEOPERATION_FLAGS.FOF_NOERRORUI
        | FILEOPERATION_FLAGS.FOFX_RECYCLEONDELETE
        | FILEOPERATION_FLAGS.FOFX_EARLYFAILURE
        | FILEOPERATION_FLAGS.FOF_NO_CONNECTED_ELEMENTS;

    /// <summary>paths を順番に1件ずつ移す。結果は paths と同じ順番</summary>
    public static List<RecycleResult> RecycleEach(IReadOnlyList<string> paths, CancellationToken shutdown)
    {
        var results = new List<RecycleResult>();
        Exception? failure = null;
        var thread = new Thread(() =>
        {
            try
            {
                foreach (string path in paths)
                {
                    if (shutdown.IsCancellationRequested)
                    {
                        results.Add(new RecycleResult("not_attempted", "シェルが終了するため、移しませんでした。"));
                        continue;
                    }
                    results.Add(RecycleOne(path));
                }
            }
            catch (Exception error)
            {
                failure = error;
            }
        })
        {
            IsBackground = true,
            Name = "pip0 recycle",
        };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();

        if (failure is not null)
        {
            Log.Error("ごみ箱への移動の途中で予期しないエラーが起きました：" + Log.Describe(failure));
        }
        while (results.Count < paths.Count)
        {
            results.Add(new RecycleResult("not_attempted", "予期しないエラーのため、移しませんでした。"));
        }
        return results;
    }

    /// <summary>ごみ箱の操作（FileOperation）を作れるかを確かめる（init のとき）</summary>
    public static bool Probe(out string reason)
    {
        string? problem = null;
        var thread = new Thread(() =>
        {
            try
            {
                var operation = (IFileOperation)new FileOperation();
                Marshal.FinalReleaseComObject(operation);
            }
            catch (Exception error)
            {
                problem = HResultText.Describe(error.HResult);
            }
        })
        {
            IsBackground = true,
            Name = "pip0 recycle probe",
        };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        if (!thread.Join(TimeSpan.FromSeconds(10)))
        {
            reason = "時間内に確かめられませんでした。";
            return false;
        }
        reason = problem ?? "";
        return problem is null;
    }

    private static RecycleResult RecycleOne(string path)
    {
        if (!DirectoryEntry.TryRead(path, out EntryInfo entry))
        {
            return Failed("ファイルが見つかりません。");
        }
        if (entry.IsDirectory)
        {
            return Failed("フォルダーは対象外です（ファイルだけを移します）。");
        }

        IShellItem? item = null;
        IFileOperation? operation = null;
        var sink = new RecycleProgressSink();
        uint cookie = 0;
        bool advised = false;
        try
        {
            HRESULT created = PInvoke.SHCreateItemFromParsingName(path, null, typeof(IShellItem).GUID, out object itemObject);
            if (created.Failed)
            {
                return Failed("ファイルを Windows のシェルで扱えません：" + HResultText.Describe(created.Value));
            }
            item = (IShellItem)itemObject;

            operation = (IFileOperation)new FileOperation();
            operation.SetOperationFlags(OperationFlags);
            operation.Advise(sink, out cookie);
            advised = true;
            operation.DeleteItem(item, null);

            int performResult = 0;
            try
            {
                operation.PerformOperations();
            }
            catch (Exception error)
            {
                // 失敗の HRESULT は、COMException 以外の例外（UnauthorizedAccessException 等）で届くこともある
                performResult = error.HResult < 0 ? error.HResult : HRESULT.E_ABORT.Value;
            }
            return Decide(path, sink, performResult);
        }
        catch (Exception error)
        {
            // 準備（項目の作成、操作の設定）の失敗。まだ何も削除していない
            return Failed("ごみ箱へ移す準備ができませんでした：" + HResultText.Describe(error.HResult));
        }
        finally
        {
            if (advised && operation is not null)
            {
                try
                {
                    operation.Unadvise(cookie);
                }
                catch (Exception)
                {
                    // 後片付けの失敗は、結果に影響しない
                }
            }
            if (operation is not null)
            {
                Marshal.FinalReleaseComObject(operation);
            }
            if (item is not null)
            {
                Marshal.FinalReleaseComObject(item);
            }
        }
    }

    /// <summary>進み具合の知らせと、実際にファイルが残っているかから、結果を決める</summary>
    private static RecycleResult Decide(string path, RecycleProgressSink sink, int performResult)
    {
        if (sink.Refused)
        {
            return new RecycleResult(
                "refused",
                "この場所ではごみ箱を使えない（ごみ箱に入らず完全に削除される）ため、削除しませんでした。ファイルは元の場所に残っています。");
        }
        bool stillThere = DirectoryEntry.TryRead(path, out _);
        if (sink.PostDeleteCalled)
        {
            if (sink.DeleteResult < 0)
            {
                return Failed("ごみ箱へ移せませんでした：" + HResultText.Describe(sink.DeleteResult));
            }
            if (!sink.RecycleItemCreated)
            {
                return Failed("ごみ箱の中に項目が作られませんでした（ごみ箱に入らなかった可能性があります）。");
            }
            if (stillThere)
            {
                return Failed("ごみ箱へ移したはずのファイルが、元の場所に残っています。");
            }
            return new RecycleResult("recycled", "");
        }
        if (performResult < 0)
        {
            return Failed("ごみ箱へ移せませんでした：" + HResultText.Describe(performResult));
        }
        if (stillThere)
        {
            return Failed("ごみ箱へ移せませんでした（Windows から理由が返されませんでした）。");
        }
        return Failed("ファイルは元の場所からなくなりましたが、ごみ箱へ移ったことを確かめられませんでした。");
    }

    private static RecycleResult Failed(string reason) => new("failed", reason);
}
