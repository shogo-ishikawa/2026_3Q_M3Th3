using System;
using System.Collections.Generic;
using Pip0Shell.Core;
using Windows.Security.Cryptography;
using Windows.Storage;
using Windows.Storage.Provider;

namespace Pip0Shell.CloudFiles;

/// <summary>
/// pip0 専用フォルダーを、Windows の同期ルートとして登録・解除する（StorageProviderSyncRootManager）。
///
/// - ID：「pip0!&lt;ユーザーの SID&gt;!default」（Windows の決まりの「提供元!SID!アカウント」の形）
/// - 取得の方式（HydrationPolicy）：Full。ゴーストが読まれるときは、ファイル全体を渡す。
/// - 一覧の方式（PopulationPolicy）：AlwaysFull。フォルダーの中身はいつもディスク上にある（FETCH_PLACEHOLDERS は使わない）。
/// - ハードリンク：許可しない。同期済みの判定（InSyncPolicy）：既定。
/// - 「常にこのデバイス上に保持する」（AllowPinning）：許可する（docs/design.md 4-6 の除外の条件に使うため）。
/// </summary>
internal sealed class SyncRootRegistrar
{
    /// <summary>エクスプローラーのナビゲーション ウィンドウに出すアイコン（Windows の標準のアイコン）</summary>
    public const string IconResource = @"%SystemRoot%\system32\imageres.dll,-1043";

    public SyncRootRegistrar(string userSid)
    {
        SyncRootId = "pip0!" + userSid + "!default";
    }

    public string SyncRootId { get; }

    /// <summary>この Windows で同期ルートを登録できるか（StorageProviderSyncRootManager.IsSupported）</summary>
    public static bool IsSupported(out string reason)
    {
        try
        {
            if (StorageProviderSyncRootManager.IsSupported())
            {
                reason = "";
                return true;
            }
            reason = "この Windows では同期ルート（Cloud Files API）を使えません（StorageProviderSyncRootManager.IsSupported が false）。";
            return false;
        }
        catch (Exception error)
        {
            Log.Warning("同期ルートが使えるかを確かめられませんでした：" + Log.Describe(error));
            reason = "同期ルート（Cloud Files API）が使えるかを確かめられませんでした（" + HResultText.Describe(error.HResult) + "）。";
            return false;
        }
    }

    /// <summary>pip0 の同期ルートが登録されている場所。登録されていなければ null</summary>
    public string? FindRegisteredPath()
    {
        IReadOnlyList<StorageProviderSyncRootInfo> roots = StorageProviderSyncRootManager.GetCurrentSyncRoots();
        foreach (StorageProviderSyncRootInfo root in roots)
        {
            if (string.Equals(root.Id, SyncRootId, StringComparison.OrdinalIgnoreCase))
            {
                return root.Path?.Path ?? "";
            }
        }
        return null;
    }

    /// <summary>
    /// 登録する。すでに同じ場所に登録されていれば何もしない。
    /// 失敗は例外（COMException 等）で伝えるので、呼ぶ側が HResult を理由にする。
    /// </summary>
    public RegistrationOutcome Register(string path, string displayName)
    {
        string? existing = FindRegisteredPath();
        if (existing is not null)
        {
            if (existing.Length > 0 && PathText.IsSameOrInside(existing, path) && PathText.IsSameOrInside(path, existing))
            {
                return new RegistrationOutcome(true, true, "すでに登録されています。");
            }
            return new RegistrationOutcome(
                false,
                false,
                "pip0 の同期ルートは、別の場所に登録されています（その場所の登録を先に解除する必要があります）。");
        }

        StorageFolder folder = StorageFolder.GetFolderFromPathAsync(path).AsTask().GetAwaiter().GetResult();
        var info = new StorageProviderSyncRootInfo
        {
            Id = SyncRootId,
            Path = folder,
            DisplayNameResource = displayName,
            IconResource = IconResource,
            HydrationPolicy = StorageProviderHydrationPolicy.Full,
            HydrationPolicyModifier = StorageProviderHydrationPolicyModifier.None,
            PopulationPolicy = StorageProviderPopulationPolicy.AlwaysFull,
            InSyncPolicy = StorageProviderInSyncPolicy.Default,
            HardlinkPolicy = StorageProviderHardlinkPolicy.None,
            ShowSiblingsAsGroup = false,
            AllowPinning = true,
            Version = ShellInfo.Version,
            Context = CryptographicBuffer.ConvertStringToBinary("pip0", BinaryStringEncoding.Utf8),
        };
        StorageProviderSyncRootManager.Register(info);
        Log.Info("同期ルートを登録しました。");
        return new RegistrationOutcome(true, false, "");
    }

    /// <summary>登録を解除する。失敗は例外で伝える</summary>
    public void Unregister()
    {
        StorageProviderSyncRootManager.Unregister(SyncRootId);
        Log.Info("同期ルートの登録を解除しました。");
    }
}

/// <summary>cf.register_root の答えの元になる値</summary>
internal readonly record struct RegistrationOutcome(bool Registered, bool Already, string Reason);
