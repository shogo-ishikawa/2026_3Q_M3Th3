using System.Text.Json.Nodes;
using Pip0Shell.Ipc;

namespace Pip0Shell.Core;

/// <summary>
/// 機能の状態を本体へ知らせる（feature.status）。
/// 使えない機能は、使えない理由（日本語）と一緒に知らせます。使えないのに使えると知らせることはしません。
/// </summary>
internal sealed class FeatureReporter
{
    /// <summary>Cloud Files API（同期ルート、ゴースト）</summary>
    public const string CloudFiles = "cloud_files";

    /// <summary>ごみ箱（IFileOperation）と確認画面</summary>
    public const string RecycleBin = "recycle_bin";

    /// <summary>前面ウィンドウの切り替えとタイトルの変化（SetWinEventHook）</summary>
    public const string ForegroundHook = "foreground_hook";

    /// <summary>ドラッグの検知（低レベルのマウスのフック WH_MOUSE_LL）</summary>
    public const string MouseHook = "mouse_hook";

    /// <summary>デスクの表示中にマウスの位置を調べる（GetCursorPos）</summary>
    public const string CursorSampler = "cursor_sampler";

    /// <summary>ファイルダイアログの判定と入力（UI Automation）</summary>
    public const string Uia = "uia";

    /// <summary>エクスプローラーで選ばれている項目の読み取り（Shell.Application の COM）</summary>
    public const string ExplorerSelection = "explorer_selection";

    /// <summary>Windows の「最近使ったファイル」（Recent フォルダーのショートカット）</summary>
    public const string RecentItems = "recent_items";

    /// <summary>画面のロック・サインアウト・スリープ・シャットダウン（SystemEvents）</summary>
    public const string SessionEvents = "session_events";

    private readonly ShellOutput output;

    public FeatureReporter(ShellOutput output)
    {
        this.output = output;
    }

    public void Report(string feature, bool ok, string reason)
    {
        output.SendEvent("feature.status", new JsonObject
        {
            ["feature"] = feature,
            ["ok"] = ok,
            ["reason"] = reason,
        });
        Log.Info("機能の状態を知らせました：" + feature + " = " + (ok ? "利用可" : "利用不可"));
    }
}
