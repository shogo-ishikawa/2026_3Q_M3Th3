using System;
using System.Collections.Generic;
using System.Text.Json.Nodes;
using Pip0Shell.CloudFiles;

namespace Pip0Shell.Context;

/// <summary>「最近使ったファイル」の1件（ショートカットの指す先と、ショートカットが更新された時刻）</summary>
internal readonly record struct RecentItem(string TargetPath, DateTime OpenedAtUtc);

/// <summary>レジストリーから読んだ「最近使ったファイル」の設定</summary>
/// <param name="Readable">設定を読めたか（読めなければ有効・無効は「不明」）</param>
/// <param name="TrackDocs">Explorer\Advanced の Start_TrackDocs（DWORD）。値がなければ null</param>
/// <param name="PolicyDisabled">ポリシー NoRecentDocsHistory が 1（記録しない）か</param>
internal readonly record struct RecentTrackingReading(bool Readable, int? TrackDocs, bool PolicyDisabled);

/// <summary>
/// usage.recent_items の中身を決める、Windows の機能を使わない部分（Checks/ で確かめられます）。
///
/// - 知らせるのは、init の watched_roots（pip0 が監視するフォルダー）の中のファイルだけです。
/// - tracking_enabled：Windows が「最近使ったファイル」を記録する設定か。
///   Start_TrackDocs がない → 有効（Windows の初期値）、0 → 無効、0 以外 → 有効、読めない → null（不明）。
///   ポリシー NoRecentDocsHistory が 1 なら無効。Recent フォルダーを読めないときも null（当てにできないため）。
/// </summary>
internal static class RecentItems
{
    /// <summary>1つの知らせに入れる件数の上限（多いときは分けて送る）</summary>
    public const int MaxItemsPerMessage = 500;

    public static bool? InterpretTracking(RecentTrackingReading reading)
    {
        if (!reading.Readable)
        {
            return null;
        }
        if (reading.PolicyDisabled)
        {
            return false;
        }
        return reading.TrackDocs is not int value || value != 0;
    }

    /// <summary>target が roots のどれかの中（またはそのもの）にあれば真。絶対パスでなければ偽</summary>
    public static bool IsInsideAny(string target, IReadOnlyList<string> roots)
    {
        return PathText.TryNormaliseAbsolute(target, out string normalised) && IsNormalisedInsideAny(normalised, roots);
    }

    /// <summary>
    /// 整えた（「..」や末尾の「\」のない）パスが、roots のどれかの中にあれば真。
    /// 文字列の比べ方だけなので、Windows 以外の Checks/ でも確かめられます。
    /// </summary>
    public static bool IsNormalisedInsideAny(string normalised, IReadOnlyList<string> roots)
    {
        foreach (string root in roots)
        {
            if (PathText.IsSameOrInside(normalised, root))
            {
                return true;
            }
        }
        return false;
    }

    /// <summary>1970年1月1日からの秒数（小数）</summary>
    public static double ToUnixSeconds(DateTime utc)
    {
        DateTime value = utc.Kind == DateTimeKind.Local ? utc.ToUniversalTime() : DateTime.SpecifyKind(utc, DateTimeKind.Utc);
        return (value - DateTime.UnixEpoch).TotalMilliseconds / 1000.0;
    }

    /// <summary>
    /// 知らせる payload の一覧を作る（件数が多ければ分ける）。items が空でも、tracking_enabled を伝えるため1つは作る。
    /// {"tracking_enabled": true/false/null, "items": [{"target_path", "opened_at"}]}
    /// </summary>
    public static List<JsonObject> BuildMessages(bool? trackingEnabled, IReadOnlyList<RecentItem> items)
    {
        var messages = new List<JsonObject>();
        var current = new JsonArray();
        foreach (RecentItem item in items)
        {
            if (current.Count >= MaxItemsPerMessage)
            {
                messages.Add(Message(trackingEnabled, current));
                current = new JsonArray();
            }
            current.Add(new JsonObject
            {
                ["target_path"] = item.TargetPath,
                ["opened_at"] = ToUnixSeconds(item.OpenedAtUtc),
            });
        }
        if (current.Count > 0 || messages.Count == 0)
        {
            messages.Add(Message(trackingEnabled, current));
        }
        return messages;
    }

    private static JsonObject Message(bool? trackingEnabled, JsonArray items)
    {
        return new JsonObject
        {
            ["tracking_enabled"] = trackingEnabled,
            ["items"] = items,
        };
    }
}
