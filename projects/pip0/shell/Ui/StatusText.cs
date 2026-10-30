using System.Collections.Generic;
using System.Globalization;
using Pip0Shell.Ipc;

namespace Pip0Shell.Ui;

/// <summary>
/// ui.status の payload を、通知領域アイコンの説明（ツールチップ）と状態の画面の文にする。
/// {"automation": "running"/"stopped", "throttle": {...}, "restore": {...}, "analysis": {"pending"},
///  "vault": {状態: 件数}, "features": [{"feature", "ok", "reason", "label"}]}
///
/// 値の意味を決めるのは本体です。ここでは、知っている名前を日本語にし、
/// 知らない機能は本体が付けた名前（label）か、機能の名前（feature）をそのまま見せます。
/// </summary>
internal sealed class StatusText
{
    /// <summary>機能の名前（feature.status の feature）と、画面に出す日本語の名前。★ここを変えると表示が変わる</summary>
    private static readonly Dictionary<string, string> FeatureNames = new()
    {
        ["cloud_files"] = "ゴースト（Cloud Files API）",
        ["recycle_bin"] = "ごみ箱への移動",
        ["foreground_hook"] = "前面ウィンドウの監視",
        ["mouse_hook"] = "ドラッグの検知",
        ["cursor_sampler"] = "マウスの位置（シェイクの判定）",
        ["uia"] = "ファイルダイアログ（UI Automation）",
        ["explorer_selection"] = "エクスプローラーの選択項目",
        ["recent_items"] = "最近使ったファイル",
        ["session_events"] = "ロック・スリープの検知",
    };

    private const int MaxFeatures = 50;
    private const int MaxTextLength = 300;

    private StatusText(string automationLabel, IReadOnlyList<string> lines, int unavailableFeatures)
    {
        AutomationLabel = automationLabel;
        Lines = lines;
        UnavailableFeatures = unavailableFeatures;
    }

    /// <summary>「動作中」「停止中」など</summary>
    public string AutomationLabel { get; }

    /// <summary>状態の画面に出す行</summary>
    public IReadOnlyList<string> Lines { get; }

    /// <summary>使えない機能の数</summary>
    public int UnavailableFeatures { get; }

    /// <summary>まだ本体から状態が届いていないとき</summary>
    public static StatusText Waiting { get; } = new("不明", new[] { "pip0 本体から、まだ状態が届いていません。" }, 0);

    /// <summary>通知領域アイコンにマウスを置いたときの説明（Windows の上限 127 文字は TrayIcon が守る）</summary>
    public string Tooltip()
    {
        string text = "pip0（自動処理：" + AutomationLabel + "）";
        return UnavailableFeatures > 0 ? text + "／使えない機能 " + UnavailableFeatures + " 件" : text;
    }

    public static StatusText Parse(Payload payload)
    {
        var lines = new List<string>();
        string automation = payload.GetString("automation") switch
        {
            "running" => "動作中",
            "stopped" => "停止中（全復元で止めました。再開は通知領域のメニューから）",
            null => "不明",
            string other => TextLimit.Shorten(other, 40),
        };
        string shortAutomation = automation.StartsWith("停止中", System.StringComparison.Ordinal) ? "停止中" : automation;
        lines.Add("自動処理：" + automation);

        Payload throttle = payload.GetObject("throttle");
        if (!throttle.IsEmpty)
        {
            AddThrottleLines(throttle, lines);
        }

        Payload restore = payload.GetObject("restore");
        if (!restore.IsEmpty)
        {
            AddRestoreLines(restore, lines);
        }

        long? analysisPending = payload.GetObject("analysis").GetInt64("pending");
        if (analysisPending is not null)
        {
            lines.Add("解析の待ち：" + analysisPending.Value.ToString(CultureInfo.InvariantCulture) + " 件");
        }
        long? evacuated = payload.GetObject("vault").GetInt64("evacuated");
        if (evacuated is not null)
        {
            lines.Add("退避中（ゴースト）のファイル：" + evacuated.Value.ToString(CultureInfo.InvariantCulture) + " 件");
        }

        int unavailable = 0;
        IReadOnlyList<Payload>? features = payload.GetObjectArray("features");
        if (features is { Count: > 0 })
        {
            lines.Add("");
            lines.Add("機能の状態：");
            int shown = 0;
            foreach (Payload feature in features)
            {
                if (shown >= MaxFeatures)
                {
                    break;
                }
                string? id = feature.GetString("feature");
                if (string.IsNullOrWhiteSpace(id))
                {
                    continue;
                }
                bool ok = feature.GetBoolean("ok") == true;
                if (!ok)
                {
                    unavailable++;
                }
                string? label = feature.GetString("label");
                string name = FeatureNames.TryGetValue(id, out string? known)
                    ? known
                    : TextLimit.Shorten(string.IsNullOrWhiteSpace(label) ? id : label, 60);
                string reason = TextLimit.ShortenOrNull(feature.GetString("reason"), MaxTextLength) ?? "";
                lines.Add((ok ? "　○ " : "　× ") + name + (reason.Length > 0 ? "：" + reason : ""));
                shown++;
            }
        }
        return new StatusText(shortAutomation, lines, unavailable);
    }

    private static void AddThrottleLines(Payload throttle, List<string> lines)
    {
        bool? allowed = throttle.GetBoolean("allowed");
        string power = throttle.GetString("power") switch
        {
            "ac" => "接続中",
            "battery" => "バッテリー",
            "unknown" => "不明",
            null => "不明",
            string other => TextLimit.Shorten(other, 40),
        };
        string heavy = allowed switch
        {
            true => "実行できます",
            false => "待機中",
            null => "不明",
        };
        lines.Add("高負荷の処理（解析・退避）：" + heavy);
        lines.Add("　電源：" + power + "、無操作：" + IdleText(throttle.GetDouble("idle_seconds")));
        string? reason = TextLimit.ShortenOrNull(throttle.GetString("reason"), MaxTextLength);
        if (reason is not null)
        {
            lines.Add("　" + reason);
        }
    }

    private static void AddRestoreLines(Payload restore, List<string> lines)
    {
        long? total = restore.GetInt64("total");
        if (total is null)
        {
            return;
        }
        bool finished = restore.GetBoolean("finished") == true;
        lines.Add("全復元：" + (finished ? "終わりました" : "途中です") + "（全 " + total + " 件）");
        lines.Add(
            "　復元 " + Count(restore, "restored") + "、衝突 " + Count(restore, "conflict")
            + "、開いた後に変更 " + Count(restore, "local_newer") + "、見つからない " + Count(restore, "missing")
            + "、失敗 " + Count(restore, "failed") + "、残り " + Count(restore, "remaining"));
    }

    private static string Count(Payload payload, string name)
    {
        long? value = payload.GetInt64(name);
        return value is null ? "?" : value.Value.ToString(CultureInfo.InvariantCulture);
    }

    private static string IdleText(double? seconds)
    {
        if (seconds is null || double.IsNaN(seconds.Value) || seconds.Value < 0)
        {
            return "不明";
        }
        return ((long)seconds.Value).ToString(CultureInfo.InvariantCulture) + " 秒";
    }
}
