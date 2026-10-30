using System;
using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using System.Threading;
using Pip0Shell.Core;
using Pip0Shell.Ipc;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.Storage.CloudFilters;

namespace Pip0Shell.CloudFiles;

/// <summary>
/// 同期ルートへの接続（CfConnectSyncRoot）と、Windows（cldflt.sys）から呼ばれるコールバック。
///
/// 受け付けるコールバック：
/// - FETCH_DATA：ゴーストが開かれた。保管庫から中身を渡す（<see cref="FetchDataService"/>）。
/// - CANCEL_FETCH_DATA：上の要求が取り消された。
/// - NOTIFY_DELETE：ゴーストが削除されようとしている（まだ削除されていない）。認める返事をして、覚えておく。
/// - NOTIFY_DELETE_COMPLETION：削除が終わった。本体へ cf.notify_delete を送る。
/// - NOTIFY_RENAME：ゴーストの名前が変わる・移動されようとしている（まだ変わっていない）。認める返事をして、覚えておく。
/// - NOTIFY_RENAME_COMPLETION：名前の変更・移動が終わった。本体へ cf.notify_rename を送る。
///
/// 本体へ知らせるのは、操作が終わった後だけです。前の知らせ（NOTIFY_DELETE・NOTIFY_RENAME）の時点では、
/// 操作がまだ失敗しうるため（例：同じ名前のファイルがあって、名前の変更が断られる）、そこで知らせると、
/// 保管庫の記録（ゴーストの今の場所）が実際と食い違います。
/// 同期ルートの外への移動は、終わりの知らせが届かないことがあるため、少し待ってから、元の場所にファイルがなく
/// 移動先にあることを確かめて知らせます。
///
/// コールバックは Windows のスレッドから呼ばれます。中で例外を外へ出すとプロセスが落ちるため、すべて受け止めます。
/// </summary>
internal sealed unsafe class SyncProvider
{
    // Windows に関数ポインターとして渡すコールバックの委譲（delegate）。
    // 接続している間に GC に回収されると落ちるので、静的フィールドでプロセスが終わるまで持ち続ける。
    private static readonly CF_CALLBACK FetchDataCallback = OnFetchData;
    private static readonly CF_CALLBACK CancelFetchDataCallback = OnCancelFetchData;
    private static readonly CF_CALLBACK NotifyDeleteCallback = OnNotifyDelete;
    private static readonly CF_CALLBACK NotifyDeleteCompletionCallback = OnNotifyDeleteCompletion;
    private static readonly CF_CALLBACK NotifyRenameCallback = OnNotifyRename;
    private static readonly CF_CALLBACK NotifyRenameCompletionCallback = OnNotifyRenameCompletion;

    private static readonly CF_CALLBACK_REGISTRATION[] CallbackTable =
    {
        new() { Type = CF_CALLBACK_TYPE.CF_CALLBACK_TYPE_FETCH_DATA, Callback = FetchDataCallback },
        new() { Type = CF_CALLBACK_TYPE.CF_CALLBACK_TYPE_CANCEL_FETCH_DATA, Callback = CancelFetchDataCallback },
        new() { Type = CF_CALLBACK_TYPE.CF_CALLBACK_TYPE_NOTIFY_DELETE, Callback = NotifyDeleteCallback },
        new() { Type = CF_CALLBACK_TYPE.CF_CALLBACK_TYPE_NOTIFY_DELETE_COMPLETION, Callback = NotifyDeleteCompletionCallback },
        new() { Type = CF_CALLBACK_TYPE.CF_CALLBACK_TYPE_NOTIFY_RENAME, Callback = NotifyRenameCallback },
        new() { Type = CF_CALLBACK_TYPE.CF_CALLBACK_TYPE_NOTIFY_RENAME_COMPLETION, Callback = NotifyRenameCompletionCallback },
        new() { Type = CF_CALLBACK_TYPE.CF_CALLBACK_TYPE_NONE }, // CF_CALLBACK_REGISTRATION_END
    };

    /// <summary>前の知らせを覚えておく時間。これを過ぎても終わりの知らせが来ない操作は、失敗したとみなして忘れる</summary>
    private const long PendingLifetimeMs = 120_000;

    /// <summary>同期ルートの外への移動を、確かめるまで待つ時間</summary>
    private const int OutOfScopeCheckDelayMs = 3_000;

    /// <summary>コールバックから使う、接続中のプロバイダー（シェルが接続する同期ルートは1つだけ）</summary>
    private static volatile SyncProvider? current;

    private readonly object gate = new();
    private readonly ShellOutput output;
    private readonly FetchDataService fetches;

    // 前の知らせを受けて、終わりの知らせを待っている削除・名前の変更（ファイル番号 FileId ごと）
    private readonly ConcurrentDictionary<long, PendingChange> pendingDeletes = new();
    private readonly ConcurrentDictionary<long, PendingChange> pendingRenames = new();
    private CF_CONNECTION_KEY connectionKey;
    private bool connected;
    private string? rootPath;
    private string? rootFinalPath;

    public SyncProvider(ShellOutput output, Func<string?> vaultDirectory)
    {
        this.output = output;
        fetches = new FetchDataService(output, vaultDirectory);
    }

    public bool IsConnected
    {
        get
        {
            lock (gate)
            {
                return connected;
            }
        }
    }

    /// <summary>接続中の同期ルートのパス（本体から受け取った形）</summary>
    public string? RootPath
    {
        get
        {
            lock (gate)
            {
                return connected ? rootPath : null;
            }
        }
    }

    /// <summary>接続中の同期ルートの本当の場所（GetFinalPathNameByHandle の結果）</summary>
    public string? RootFinalPath
    {
        get
        {
            lock (gate)
            {
                return connected ? rootFinalPath : null;
            }
        }
    }

    /// <summary>同期ルートに接続する。接続できた（すでに同じ場所に接続していた）ら真</summary>
    public bool Connect(string path, out string reason)
    {
        lock (gate)
        {
            if (connected)
            {
                if (string.Equals(PathText.TrimEndSeparator(rootPath ?? ""), PathText.TrimEndSeparator(path), StringComparison.OrdinalIgnoreCase))
                {
                    reason = "すでに接続しています。";
                    return true;
                }
                reason = "別のフォルダーの同期ルートに接続しています。";
                return false;
            }

            current = this;
            fetches.Resume();
            CF_CONNECTION_KEY key;
            HRESULT result = PInvoke.CfConnectSyncRoot(
                path,
                CallbackTable,
                null,
                CF_CONNECT_FLAGS.CF_CONNECT_FLAG_REQUIRE_PROCESS_INFO | CF_CONNECT_FLAGS.CF_CONNECT_FLAG_REQUIRE_FULL_FILE_PATH,
                &key);
            if (result.Failed)
            {
                reason = "同期ルートに接続できませんでした：" + HResultText.Describe(result.Value);
                Log.Warning("同期ルートに接続できませんでした（" + Log.Hex(result.Value) + "）。");
                return false;
            }

            connectionKey = key;
            connected = true;
            rootPath = PathText.TrimEndSeparator(path);
            rootFinalPath = FinalPath.OfDirectory(path) ?? rootPath;
            reason = "";
            Log.Info("同期ルートに接続しました。");
            return true;
        }
    }

    /// <summary>接続を切る（終了のとき、登録を解除する前）。処理中の FETCH_DATA はエラーで返す</summary>
    public void Disconnect(bool shuttingDown)
    {
        CF_CONNECTION_KEY key;
        lock (gate)
        {
            if (!connected)
            {
                if (shuttingDown)
                {
                    fetches.StopAll(TimeSpan.Zero);
                }
                return;
            }
            key = connectionKey;
            connected = false;
        }

        fetches.StopAll(TimeSpan.FromSeconds(3));
        HRESULT result = PInvoke.CfDisconnectSyncRoot(key);
        if (result.Failed)
        {
            Log.Warning("同期ルートとの接続を切れませんでした（" + Log.Hex(result.Value) + "）。");
        }
        else
        {
            Log.Info("同期ルートとの接続を切りました。");
        }
        if (!shuttingDown)
        {
            fetches.Resume();
        }
    }

    // ------------------------------------------------------------------
    // コールバック（Windows のスレッドから呼ばれる）
    // ------------------------------------------------------------------

    private static void OnFetchData(CF_CALLBACK_INFO* info, CF_CALLBACK_PARAMETERS* parameters)
    {
        try
        {
            FetchJob job = FetchJob.FromCallback(info, parameters);
            SyncProvider? provider = current;
            if (provider is null)
            {
                FailFetchDirectly(info, parameters);
                return;
            }
            provider.fetches.Start(job);
        }
        catch (Exception error)
        {
            Log.Error("FETCH_DATA の受け付けで予期しないエラーが起きました：" + Log.Describe(error));
            FailFetchDirectly(info, parameters);
        }
    }

    private static void OnCancelFetchData(CF_CALLBACK_INFO* info, CF_CALLBACK_PARAMETERS* parameters)
    {
        try
        {
            current?.fetches.CancelByPlatform(info->TransferKey);
        }
        catch (Exception error)
        {
            Log.Error("CANCEL_FETCH_DATA の処理で予期しないエラーが起きました：" + Log.Describe(error));
        }
    }

    private static void OnNotifyDelete(CF_CALLBACK_INFO* info, CF_CALLBACK_PARAMETERS* parameters)
    {
        try
        {
            string? itemId = null;
            string? path = null;
            CF_CALLBACK_DELETE_FLAGS flags = CF_CALLBACK_DELETE_FLAGS.CF_CALLBACK_DELETE_FLAG_NONE;
            long fileId = info->FileId;
            try
            {
                itemId = CallbackInfoReader.ItemId(info);
                path = CallbackInfoReader.FullPath(info);
                flags = parameters->Anonymous.Delete.Flags;
            }
            finally
            {
                // 削除を止めることはしない。必ず「認める」と返す（返さないと、削除したアプリが待たされる）
                int result = CloudOperations.AcknowledgeDelete(CallbackInfoReader.Keys(info));
                if (result < 0)
                {
                    Log.Warning("ゴーストの削除の通知に返事ができませんでした（" + Log.Hex(result) + "）。");
                }
            }

            SyncProvider? provider = current;
            if (provider is null || itemId is null || (flags & CF_CALLBACK_DELETE_FLAGS.CF_CALLBACK_DELETE_FLAG_IS_DIRECTORY) != 0)
            {
                return;
            }
            if ((flags & CF_CALLBACK_DELETE_FLAGS.CF_CALLBACK_DELETE_FLAG_IS_UNDELETE) != 0)
            {
                // 「削除の取り消し」（削除の予約が外された）：前に覚えた削除は起きないので忘れる。本体へは何も送らない
                provider.pendingDeletes.TryRemove(fileId, out _);
                return;
            }
            provider.Remember(provider.pendingDeletes, fileId, new PendingChange(itemId, path, null, true, Environment.TickCount64));
        }
        catch (Exception error)
        {
            Log.Error("NOTIFY_DELETE の処理で予期しないエラーが起きました：" + Log.Describe(error));
        }
    }

    private static void OnNotifyDeleteCompletion(CF_CALLBACK_INFO* info, CF_CALLBACK_PARAMETERS* parameters)
    {
        try
        {
            SyncProvider? provider = current;
            if (provider is null)
            {
                return;
            }
            provider.pendingDeletes.TryRemove(info->FileId, out PendingChange? pending);
            // 項目ID と場所は、終わりの知らせから読む。読めなければ、前の知らせで覚えたものを使う
            string? itemId = CallbackInfoReader.ItemId(info) ?? pending?.ItemId;
            string? path = CallbackInfoReader.FullPath(info) ?? pending?.OldPath;
            if (itemId is null)
            {
                return;
            }
            Log.Info("ゴーストが削除されました（項目 " + itemId + "）。");
            provider.output.SendEvent("cf.notify_delete", new JsonObject
            {
                ["item_id"] = itemId,
                ["path"] = path,
            });
        }
        catch (Exception error)
        {
            Log.Error("NOTIFY_DELETE_COMPLETION の処理で予期しないエラーが起きました：" + Log.Describe(error));
        }
    }

    private static void OnNotifyRename(CF_CALLBACK_INFO* info, CF_CALLBACK_PARAMETERS* parameters)
    {
        try
        {
            string? itemId = null;
            string? oldPath = null;
            string? newPath = null;
            bool insideRoot = false;
            bool isDirectory = false;
            long fileId = info->FileId;
            try
            {
                itemId = CallbackInfoReader.ItemId(info);
                oldPath = CallbackInfoReader.FullPath(info);
                CF_CALLBACK_RENAME_FLAGS flags = parameters->Anonymous.Rename.Flags;
                newPath = CallbackInfoReader.WithVolume(info, parameters->Anonymous.Rename.TargetPath.ToString());
                insideRoot = (flags & CF_CALLBACK_RENAME_FLAGS.CF_CALLBACK_RENAME_FLAG_TARGET_IN_SCOPE) != 0;
                isDirectory = (flags & CF_CALLBACK_RENAME_FLAGS.CF_CALLBACK_RENAME_FLAG_IS_DIRECTORY) != 0;
            }
            finally
            {
                // 名前の変更・移動を止めることはしない。必ず「認める」と返す
                int result = CloudOperations.AcknowledgeRename(CallbackInfoReader.Keys(info));
                if (result < 0)
                {
                    Log.Warning("ゴーストの名前の変更の通知に返事ができませんでした（" + Log.Hex(result) + "）。");
                }
            }

            SyncProvider? provider = current;
            if (provider is null || itemId is null || isDirectory)
            {
                return;
            }
            var pending = new PendingChange(itemId, oldPath, newPath, insideRoot, Environment.TickCount64);
            provider.Remember(provider.pendingRenames, fileId, pending);
            if (!insideRoot)
            {
                // 同期ルートの外への移動は、終わりの知らせが届かないことがあるので、少し待ってから確かめる。
                // Timer は覚えておかないと GC に回収されて動かないので、覚えた変更に持たせる
                pending.Check = new Timer(_ => provider.ConfirmOutOfScopeMove(fileId), null, OutOfScopeCheckDelayMs, Timeout.Infinite);
            }
        }
        catch (Exception error)
        {
            Log.Error("NOTIFY_RENAME の処理で予期しないエラーが起きました：" + Log.Describe(error));
        }
    }

    private static void OnNotifyRenameCompletion(CF_CALLBACK_INFO* info, CF_CALLBACK_PARAMETERS* parameters)
    {
        try
        {
            SyncProvider? provider = current;
            if (provider is null)
            {
                return;
            }
            provider.pendingRenames.TryRemove(info->FileId, out PendingChange? pending);
            pending?.Check?.Dispose();
            // 終わりの知らせでは、NormalizedPath が新しい場所、SourcePath が元の場所
            string? itemId = CallbackInfoReader.ItemId(info) ?? pending?.ItemId;
            string? newPath = CallbackInfoReader.FullPath(info) ?? pending?.NewPath;
            string? oldPath = CallbackInfoReader.WithVolume(info, parameters->Anonymous.RenameCompletion.SourcePath.ToString())
                ?? pending?.OldPath;
            if (itemId is null)
            {
                return;
            }
            bool insideRoot = pending?.InsideRoot ?? provider.IsUnderRoot(newPath);
            provider.ReportRename(itemId, oldPath, newPath, insideRoot);
        }
        catch (Exception error)
        {
            Log.Error("NOTIFY_RENAME_COMPLETION の処理で予期しないエラーが起きました：" + Log.Describe(error));
        }
    }

    /// <summary>
    /// 同期ルートの外への移動を確かめる（終わりの知らせが来なかったとき）。
    /// 元の場所にファイルがなく、移動先にあるときだけ、移動が終わったとして知らせる。
    /// </summary>
    private void ConfirmOutOfScopeMove(long fileId)
    {
        try
        {
            if (!pendingRenames.TryRemove(fileId, out PendingChange? pending))
            {
                return; // 終わりの知らせで、もう知らせた
            }
            pending.Check?.Dispose();
            bool oldExists = pending.OldPath is not null && DirectoryEntry.TryRead(pending.OldPath, out _);
            bool newExists = pending.NewPath is not null && DirectoryEntry.TryRead(pending.NewPath, out _);
            if (oldExists || !newExists)
            {
                Log.Info("同期ルートの外への移動は、終わったことを確かめられなかったため、知らせません（項目 " + pending.ItemId + "）。");
                return;
            }
            ReportRename(pending.ItemId, pending.OldPath, pending.NewPath, false);
        }
        catch (Exception error)
        {
            Log.Error("同期ルートの外への移動の確認で予期しないエラーが起きました：" + Log.Describe(error));
        }
    }

    private void ReportRename(string itemId, string? oldPath, string? newPath, bool insideRoot)
    {
        Log.Info("ゴーストの名前が変わりました（項目 " + itemId + "、同期ルートの" + (insideRoot ? "中" : "外") + "へ）。");
        output.SendEvent("cf.notify_rename", new JsonObject
        {
            ["item_id"] = itemId,
            ["old_path"] = oldPath,
            ["new_path"] = newPath,
            ["inside_root"] = insideRoot,
        });
    }

    /// <summary>前の知らせを覚える。終わりの知らせが来ないまま古くなったもの（失敗した操作）は、ここで忘れる</summary>
    private void Remember(ConcurrentDictionary<long, PendingChange> pending, long fileId, PendingChange change)
    {
        long now = Environment.TickCount64;
        foreach (var entry in pending)
        {
            if (now - entry.Value.NoticedAt > PendingLifetimeMs && pending.TryRemove(entry.Key, out PendingChange? old))
            {
                old.Check?.Dispose();
            }
        }
        if (pending.TryRemove(fileId, out PendingChange? replaced))
        {
            replaced.Check?.Dispose();
        }
        pending[fileId] = change;
    }

    /// <summary>path が接続中の同期ルートの中なら真（本体から受け取った形と、本当の場所の両方で比べる）</summary>
    private bool IsUnderRoot(string? path)
    {
        if (path is null)
        {
            return false;
        }
        string? root = RootPath;
        string? finalRoot = RootFinalPath;
        return (root is not null && PathText.IsInside(path, root)) || (finalRoot is not null && PathText.IsInside(path, finalRoot));
    }

    /// <summary>受け付けられなかった FETCH_DATA に、すぐにエラーを返す（アプリを時間切れまで待たせないため）</summary>
    private static void FailFetchDirectly(CF_CALLBACK_INFO* info, CF_CALLBACK_PARAMETERS* parameters)
    {
        try
        {
            long offset = parameters->Anonymous.FetchData.RequiredFileOffset;
            long length = parameters->Anonymous.FetchData.RequiredLength;
            CloudOperations.FailTransfer(
                CallbackInfoReader.Keys(info),
                offset,
                length,
                NTSTATUS.STATUS_CLOUD_FILE_UNSUCCESSFUL);
        }
        catch (Exception error)
        {
            Log.Error("FETCH_DATA にエラーを返せませんでした：" + Log.Describe(error));
        }
    }

    /// <summary>前の知らせ（NOTIFY_DELETE・NOTIFY_RENAME）で覚えた、終わるのを待っている変更</summary>
    private sealed class PendingChange
    {
        public PendingChange(string itemId, string? oldPath, string? newPath, bool insideRoot, long noticedAt)
        {
            ItemId = itemId;
            OldPath = oldPath;
            NewPath = newPath;
            InsideRoot = insideRoot;
            NoticedAt = noticedAt;
        }

        public string ItemId { get; }

        /// <summary>元の場所（削除なら、削除されるファイルの場所）</summary>
        public string? OldPath { get; }

        /// <summary>移動先（削除なら null）</summary>
        public string? NewPath { get; }

        /// <summary>移動先が同期ルートの中か（Windows の TARGET_IN_SCOPE の印）</summary>
        public bool InsideRoot { get; }

        /// <summary>前の知らせを受けた時刻（Environment.TickCount64）</summary>
        public long NoticedAt { get; }

        /// <summary>同期ルートの外への移動を確かめるタイマー（それ以外は null）</summary>
        public Timer? Check { get; set; }
    }
}
