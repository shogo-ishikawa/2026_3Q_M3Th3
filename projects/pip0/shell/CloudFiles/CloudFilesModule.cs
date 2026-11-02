using System;
using System.IO;
using System.Text.Json.Nodes;
using System.Threading;
using Pip0Shell.Core;
using Pip0Shell.Ipc;

namespace Pip0Shell.CloudFiles;

/// <summary>
/// ゴースト（M4）のための Cloud Files API の要求を受け付ける入口。
///
/// cf.register_root、cf.connect、cf.status、cf.make_ghost、cf.restore、cf.locate、cf.unregister_root を処理します。
/// 何をゴーストにするか・いつ戻すかは pip0 本体が決めます。シェルは指示を確かめて実行し、結果を返すだけです。
/// </summary>
internal sealed class CloudFilesModule
{
    /// <summary>登録を解除する前に調べる項目数の上限（これを超えたら、解除しない）</summary>
    private const int MaxScanEntries = 200_000;

    private readonly ShellState state;
    private readonly FeatureReporter features;
    private readonly SyncRootRegistrar registrar;
    private readonly SyncProvider provider;
    private readonly PlaceholderOperations placeholders;
    private readonly object registrationGate = new();
    private volatile bool supported;
    private volatile string unavailableReason = "init の前です。";

    public CloudFilesModule(ShellOutput output, ShellState state, FeatureReporter features, string userSid)
    {
        this.state = state;
        this.features = features;
        registrar = new SyncRootRegistrar(userSid);
        provider = new SyncProvider(output, () => state.Configuration?.VaultDir);
        placeholders = new PlaceholderOperations(provider, state);
    }

    public void RegisterHandlers(MessageRouter router)
    {
        router.AddRequest("cf.register_root", HandleRegisterRoot);
        router.AddRequest("cf.connect", HandleConnect);
        router.AddRequest("cf.status", HandleStatus);
        router.AddRequest("cf.make_ghost", HandleMakeGhost);
        router.AddRequest("cf.restore", HandleRestore);
        router.AddRequest("cf.locate", HandleLocate);
        router.AddRequest("cf.unregister_root", HandleUnregisterRoot);
    }

    /// <summary>起動したとき（init の前）の見込み。shell.ready で知らせる</summary>
    public static bool ProbeSupported() => SyncRootRegistrar.IsSupported(out _);

    /// <summary>init のときに呼ぶ。使えないときは、理由を feature.status で知らせて偽を返す</summary>
    public bool Initialise(SessionConfiguration configuration)
    {
        if (!SyncRootRegistrar.IsSupported(out string reason))
        {
            return MarkUnavailable(reason);
        }
        if (configuration.VaultDir is null || configuration.Pip0Root is null)
        {
            return MarkUnavailable("保管庫（vault_dir）または pip0 専用フォルダー（pip0_root）の場所が、init で渡されていません。");
        }
        supported = true;
        unavailableReason = "";
        // 使えるかどうかの最終的な知らせは、cf.register_root と cf.connect の結果で送る
        return true;
    }

    /// <summary>終了のとき：処理中の FETCH_DATA をエラーで返し、同期ルートとの接続を切る</summary>
    public void Shutdown()
    {
        provider.Disconnect(shuttingDown: true);
    }

    // ------------------------------------------------------------------

    private RequestResult HandleRegisterRoot(Payload payload, CancellationToken shutdown)
    {
        if (!TryReadPath(payload, out string path, out RequestResult? bad))
        {
            return bad;
        }
        string displayName = (payload.GetString("display_name") ?? "").Trim();
        if (displayName.Length == 0)
        {
            displayName = state.Configuration?.SyncRootDisplayName ?? SessionConfiguration.DefaultDisplayName;
        }
        if (!supported)
        {
            return RegisterAnswer(false, false, unavailableReason);
        }

        lock (registrationGate)
        {
            if (!Directory.Exists(path))
            {
                return RegisterAnswer(false, false, "フォルダーがありません（pip0 本体が先に作る必要があります）。");
            }
            string? fileSystem = VolumeInfo.FileSystemName(path);
            if (fileSystem is not null && !string.Equals(fileSystem, "NTFS", StringComparison.OrdinalIgnoreCase))
            {
                string reason = fileSystem + " のドライブのため、同期ルートにできません（NTFS のドライブだけです）。";
                features.Report(FeatureReporter.CloudFiles, false, reason);
                return RegisterAnswer(false, false, reason);
            }

            try
            {
                RegistrationOutcome outcome = registrar.Register(path, displayName);
                if (!outcome.Registered)
                {
                    features.Report(FeatureReporter.CloudFiles, false, outcome.Reason);
                }
                return RegisterAnswer(outcome.Registered, outcome.Already, outcome.Reason);
            }
            catch (Exception error)
            {
                Log.Warning("同期ルートを登録できませんでした：" + Log.Describe(error));
                string reason = "同期ルートを登録できませんでした：" + HResultText.Describe(error.HResult);
                features.Report(FeatureReporter.CloudFiles, false, reason);
                return RegisterAnswer(false, false, reason);
            }
        }
    }

    private RequestResult HandleConnect(Payload payload, CancellationToken shutdown)
    {
        if (!TryReadPath(payload, out string path, out RequestResult? bad))
        {
            return bad;
        }
        if (!supported)
        {
            return ConnectAnswer(false, unavailableReason);
        }

        lock (registrationGate)
        {
            string? registered;
            try
            {
                registered = registrar.FindRegisteredPath();
            }
            catch (Exception error)
            {
                Log.Warning("同期ルートの登録を確かめられませんでした：" + Log.Describe(error));
                return ConnectFailed("同期ルートの登録を確かめられません：" + HResultText.Describe(error.HResult));
            }
            if (registered is null)
            {
                return ConnectFailed("同期ルートとして登録されていません（先に cf.register_root が必要です）。");
            }
            if (!SamePath(registered, path))
            {
                return ConnectFailed("指定の場所は、pip0 の同期ルートとして登録された場所と違います。");
            }

            bool connected = provider.Connect(path, out string reason);
            if (!connected)
            {
                return ConnectFailed(reason);
            }
            features.Report(FeatureReporter.CloudFiles, true, "同期ルートに接続しました（ゴーストが開かれると、保管庫から中身を渡します）。");
            return ConnectAnswer(true, reason);
        }
    }

    private RequestResult HandleStatus(Payload payload, CancellationToken shutdown)
    {
        if (!TryReadPath(payload, out string path, out RequestResult? bad))
        {
            return bad;
        }
        return RequestResult.Success(placeholders.Status(path));
    }

    private RequestResult HandleMakeGhost(Payload payload, CancellationToken shutdown)
    {
        if (!TryReadPath(payload, out string path, out RequestResult? bad))
        {
            return bad;
        }
        string? itemId = payload.GetString("item_id");
        if (!ItemId.IsValid(itemId))
        {
            return RequestResult.BadRequest("item_id には 32桁の16進数が必要です。");
        }
        Payload expected = payload.GetObject("expected");
        long? size = expected.GetInt64("size");
        long? mtimeNs = expected.GetInt64("mtime_ns");
        string? fileKey = expected.GetString("file_key");
        string? sha256 = expected.GetString("sha256");
        if (size is null || size.Value < 0 || mtimeNs is null || string.IsNullOrEmpty(fileKey) || sha256 is null || sha256.Length != 64)
        {
            return RequestResult.BadRequest("expected に size・mtime_ns（整数）・file_key・sha256（64桁）が必要です。");
        }

        JsonObject answer = supported
            ? placeholders.MakeGhost(path, itemId!, new GhostExpectation(size.Value, mtimeNs.Value, fileKey, sha256), shutdown)
            : new JsonObject { ["result"] = "error", ["reason"] = unavailableReason };
        Log.Info("ゴーストの作成：" + ResultOf(answer) + "（項目 " + itemId + "）。");
        return RequestResult.Success(answer);
    }

    private RequestResult HandleRestore(Payload payload, CancellationToken shutdown)
    {
        if (!TryReadPath(payload, out string path, out RequestResult? bad))
        {
            return bad;
        }
        string? itemId = payload.GetString("item_id");
        if (!ItemId.IsValid(itemId))
        {
            return RequestResult.BadRequest("item_id には 32桁の16進数が必要です。");
        }

        JsonObject answer = placeholders.Restore(path, itemId!);
        Log.Info("ゴーストの復元：" + ResultOf(answer) + "（項目 " + itemId + "）。");
        return RequestResult.Success(answer);
    }

    private RequestResult HandleLocate(Payload payload, CancellationToken shutdown)
    {
        string? itemId = payload.GetString("item_id");
        if (!ItemId.IsValid(itemId))
        {
            return RequestResult.BadRequest("item_id には 32桁の16進数が必要です。");
        }

        JsonObject answer = placeholders.Locate(itemId!, shutdown);
        Log.Info("ゴーストの場所の検索：" + ResultOf(answer) + "（項目 " + itemId + "）。");
        return RequestResult.Success(answer);
    }

    private RequestResult HandleUnregisterRoot(Payload payload, CancellationToken shutdown)
    {
        if (!TryReadPath(payload, out string path, out RequestResult? bad))
        {
            return bad;
        }
        if (!supported)
        {
            return UnregisterAnswer(false, unavailableReason);
        }

        lock (registrationGate)
        {
            string? registered;
            try
            {
                registered = registrar.FindRegisteredPath();
            }
            catch (Exception error)
            {
                Log.Warning("同期ルートの登録を確かめられませんでした：" + Log.Describe(error));
                return UnregisterAnswer(false, "同期ルートの登録を確かめられません：" + HResultText.Describe(error.HResult));
            }
            if (registered is null)
            {
                return UnregisterAnswer(true, "登録されていませんでした（何もしていません）。");
            }
            if (!SamePath(registered, path))
            {
                return UnregisterAnswer(false, "指定の場所は、pip0 の同期ルートとして登録された場所と違います。");
            }

            // 念のための確認：ゴーストが残ったまま解除すると、そのゴーストを開けなくなる（中身は保管庫に残る）
            if (Directory.Exists(path))
            {
                int count = DirectoryEntry.CountPlaceholderFiles(path, MaxScanEntries, out bool complete);
                if (count > 0)
                {
                    return UnregisterAnswer(false, "ゴースト（プレースホルダー）が " + count + " 件残っているため、登録を解除しません。先に全復元してください。");
                }
                if (!complete)
                {
                    return UnregisterAnswer(false, "フォルダーの中をすべて確かめられなかったため、登録を解除しません。");
                }
            }

            provider.Disconnect(shuttingDown: false);
            try
            {
                registrar.Unregister();
            }
            catch (Exception error)
            {
                Log.Warning("同期ルートの登録を解除できませんでした：" + Log.Describe(error));
                return UnregisterAnswer(false, "同期ルートの登録を解除できませんでした：" + HResultText.Describe(error.HResult));
            }
            features.Report(FeatureReporter.CloudFiles, false, "同期ルートの登録を解除しました（ゴーストは作れません）。");
            return UnregisterAnswer(true, "");
        }
    }

    // ------------------------------------------------------------------

    private bool MarkUnavailable(string reason)
    {
        supported = false;
        unavailableReason = reason;
        features.Report(FeatureReporter.CloudFiles, false, reason);
        return false;
    }

    private RequestResult ConnectFailed(string reason)
    {
        features.Report(FeatureReporter.CloudFiles, false, reason);
        return ConnectAnswer(false, reason);
    }

    private static bool TryReadPath(Payload payload, out string path, [System.Diagnostics.CodeAnalysis.NotNullWhen(false)] out RequestResult? bad)
    {
        if (PathText.TryNormaliseAbsolute(payload.GetString("path"), out path))
        {
            bad = null;
            return true;
        }
        bad = RequestResult.BadRequest("path には Windows の絶対パスが必要です。");
        return false;
    }

    private static bool SamePath(string a, string b)
    {
        return string.Equals(PathText.TrimEndSeparator(a), PathText.TrimEndSeparator(b), StringComparison.OrdinalIgnoreCase);
    }

    private static string ResultOf(JsonObject answer)
    {
        return answer["result"]?.GetValue<string>() ?? "（不明）";
    }

    private static RequestResult RegisterAnswer(bool registered, bool already, string reason)
    {
        return RequestResult.Success(new JsonObject
        {
            ["registered"] = registered,
            ["already"] = already,
            ["reason"] = reason,
        });
    }

    private static RequestResult ConnectAnswer(bool connected, string reason)
    {
        return RequestResult.Success(new JsonObject
        {
            ["connected"] = connected,
            ["reason"] = reason,
        });
    }

    private static RequestResult UnregisterAnswer(bool unregistered, string reason)
    {
        return RequestResult.Success(new JsonObject
        {
            ["unregistered"] = unregistered,
            ["reason"] = reason,
        });
    }
}
