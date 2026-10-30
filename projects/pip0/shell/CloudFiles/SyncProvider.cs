using System;
using System.Text.Json.Nodes;
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
/// - NOTIFY_DELETE：ゴーストが削除されようとしている。認めてから、本体へ cf.notify_delete を送る。
/// - NOTIFY_RENAME：ゴーストの名前が変わる・移動される。認めてから、本体へ cf.notify_rename を送る。
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
    private static readonly CF_CALLBACK NotifyRenameCallback = OnNotifyRename;

    private static readonly CF_CALLBACK_REGISTRATION[] CallbackTable =
    {
        new() { Type = CF_CALLBACK_TYPE.CF_CALLBACK_TYPE_FETCH_DATA, Callback = FetchDataCallback },
        new() { Type = CF_CALLBACK_TYPE.CF_CALLBACK_TYPE_CANCEL_FETCH_DATA, Callback = CancelFetchDataCallback },
        new() { Type = CF_CALLBACK_TYPE.CF_CALLBACK_TYPE_NOTIFY_DELETE, Callback = NotifyDeleteCallback },
        new() { Type = CF_CALLBACK_TYPE.CF_CALLBACK_TYPE_NOTIFY_RENAME, Callback = NotifyRenameCallback },
        new() { Type = CF_CALLBACK_TYPE.CF_CALLBACK_TYPE_NONE }, // CF_CALLBACK_REGISTRATION_END
    };

    /// <summary>コールバックから使う、接続中のプロバイダー（シェルが接続する同期ルートは1つだけ）</summary>
    private static volatile SyncProvider? current;

    private readonly object gate = new();
    private readonly ShellOutput output;
    private readonly FetchDataService fetches;
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
            bool report = false;
            try
            {
                itemId = CallbackInfoReader.ItemId(info);
                path = CallbackInfoReader.FullPath(info);
                CF_CALLBACK_DELETE_FLAGS flags = parameters->Anonymous.Delete.Flags;
                report = itemId is not null
                    && (flags & CF_CALLBACK_DELETE_FLAGS.CF_CALLBACK_DELETE_FLAG_IS_DIRECTORY) == 0
                    && (flags & CF_CALLBACK_DELETE_FLAGS.CF_CALLBACK_DELETE_FLAG_IS_UNDELETE) == 0;
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

            if (report)
            {
                Log.Info("ゴーストが削除されます（項目 " + itemId + "）。");
                current?.output.SendEvent("cf.notify_delete", new JsonObject
                {
                    ["item_id"] = itemId,
                    ["path"] = path,
                });
            }
        }
        catch (Exception error)
        {
            Log.Error("NOTIFY_DELETE の処理で予期しないエラーが起きました：" + Log.Describe(error));
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
            bool report = false;
            try
            {
                itemId = CallbackInfoReader.ItemId(info);
                oldPath = CallbackInfoReader.FullPath(info);
                CF_CALLBACK_RENAME_FLAGS flags = parameters->Anonymous.Rename.Flags;
                newPath = CallbackInfoReader.WithVolume(info, parameters->Anonymous.Rename.TargetPath.ToString());
                insideRoot = (flags & CF_CALLBACK_RENAME_FLAGS.CF_CALLBACK_RENAME_FLAG_TARGET_IN_SCOPE) != 0;
                report = itemId is not null && (flags & CF_CALLBACK_RENAME_FLAGS.CF_CALLBACK_RENAME_FLAG_IS_DIRECTORY) == 0;
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

            if (report)
            {
                Log.Info("ゴーストの名前が変わります（項目 " + itemId + "、同期ルートの" + (insideRoot ? "中" : "外") + "へ）。");
                current?.output.SendEvent("cf.notify_rename", new JsonObject
                {
                    ["item_id"] = itemId,
                    ["old_path"] = oldPath,
                    ["new_path"] = newPath,
                    ["inside_root"] = insideRoot,
                });
            }
        }
        catch (Exception error)
        {
            Log.Error("NOTIFY_RENAME の処理で予期しないエラーが起きました：" + Log.Describe(error));
        }
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
}
