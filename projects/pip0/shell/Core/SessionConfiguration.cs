using System;
using System.Collections.Generic;
using Pip0Shell.CloudFiles;
using Pip0Shell.Ipc;

namespace Pip0Shell.Core;

/// <summary>
/// init の要求で受け取った値（docs/ipc-protocol.md の2節）。
/// {"protocol": 1, "vault_dir", "pip0_root", "sync_root_display_name", "headless", "settings": {...}, "watched_roots": [...]}
///
/// watched_roots（約束への追加。なくてもよい）：pip0 本体が監視・索引するフォルダーの絶対パスの一覧。
/// 「最近使ったファイル」（usage.recent_items）は、この中のファイルだけを知らせます。
/// 渡されないときは pip0_root だけを使います。
/// </summary>
internal sealed class SessionConfiguration
{
    public const string DefaultDisplayName = "pip0";
    private const int MaxDisplayNameLength = 64;

    /// <summary>watched_roots として受け付ける数の上限</summary>
    public const int MaxWatchedRoots = 64;

    /// <summary>保管庫（%LOCALAPPDATA%\pip0\vault）。ゴーストの中身を読む場所。null は「渡されていない」</summary>
    public string? VaultDir { get; init; }

    /// <summary>pip0 専用フォルダー（%USERPROFILE%\pip0）。同期ルートにする場所。null は「渡されていない」</summary>
    public string? Pip0Root { get; init; }

    /// <summary>エクスプローラーに表示する同期ルートの名前</summary>
    public string SyncRootDisplayName { get; init; } = DefaultDisplayName;

    /// <summary>画面を出さずに動く（コマンドラインの --headless か、init の headless のどちらかが真）</summary>
    public bool Headless { get; init; }

    public ShellSettings Settings { get; init; } = new();

    /// <summary>「最近使ったファイル」を知らせる対象のフォルダー（絶対パス）。空なら何も知らせない</summary>
    public IReadOnlyList<string> WatchedRoots { get; init; } = Array.Empty<string>();

    /// <summary>init の payload を読む。形が違えば null を返し、problem に理由を入れる</summary>
    public static SessionConfiguration? FromPayload(Payload payload, bool commandLineHeadless, out string problem)
    {
        string? vaultDir = null;
        string? vaultText = payload.GetString("vault_dir");
        if (vaultText is not null && !PathText.TryNormaliseAbsolute(vaultText, out vaultDir))
        {
            problem = "vault_dir が Windows の絶対パスではありません。";
            return null;
        }

        string? pip0Root = null;
        string? rootText = payload.GetString("pip0_root");
        if (rootText is not null && !PathText.TryNormaliseAbsolute(rootText, out pip0Root))
        {
            problem = "pip0_root が Windows の絶対パスではありません。";
            return null;
        }

        string displayName = (payload.GetString("sync_root_display_name") ?? "").Trim();
        if (displayName.Length == 0)
        {
            displayName = DefaultDisplayName;
        }
        if (displayName.Length > MaxDisplayNameLength)
        {
            displayName = displayName.Substring(0, MaxDisplayNameLength);
        }

        problem = "";
        return new SessionConfiguration
        {
            VaultDir = vaultDir,
            Pip0Root = pip0Root,
            SyncRootDisplayName = displayName,
            Headless = commandLineHeadless || payload.GetBoolean("headless") == true,
            Settings = ShellSettings.FromPayload(payload.GetObject("settings")),
            WatchedRoots = ReadWatchedRoots(payload.GetStringArray("watched_roots"), pip0Root),
        };
    }

    /// <summary>
    /// watched_roots を読む。絶対パスでないものは使わない（記録には件数だけを書く）。
    /// 渡されていなければ pip0_root だけ、それもなければ空。
    /// </summary>
    public static IReadOnlyList<string> ReadWatchedRoots(IReadOnlyList<string>? given, string? pip0Root)
    {
        var roots = new List<string>();
        if (given is null)
        {
            if (pip0Root is not null)
            {
                roots.Add(pip0Root);
            }
            return roots;
        }

        int ignored = 0;
        foreach (string text in given)
        {
            if (roots.Count >= MaxWatchedRoots || !PathText.TryNormaliseAbsolute(text, out string root))
            {
                ignored++;
                continue;
            }
            if (!roots.Exists(existing => string.Equals(existing, root, StringComparison.OrdinalIgnoreCase)))
            {
                roots.Add(root);
            }
        }
        if (ignored > 0)
        {
            Log.Warning("watched_roots のうち " + ignored + " 件は、絶対パスでないか多すぎるため使いません。");
        }
        return roots;
    }

    /// <summary>2回目の init が、1回目と同じ場所を指しているか</summary>
    public bool SameLocations(SessionConfiguration other)
    {
        return string.Equals(VaultDir, other.VaultDir, StringComparison.OrdinalIgnoreCase)
            && string.Equals(Pip0Root, other.Pip0Root, StringComparison.OrdinalIgnoreCase)
            && Headless == other.Headless;
    }
}
