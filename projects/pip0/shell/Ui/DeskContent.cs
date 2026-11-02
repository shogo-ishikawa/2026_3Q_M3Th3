using System.Collections.Generic;
using Pip0Shell.CloudFiles;
using Pip0Shell.Ipc;

namespace Pip0Shell.Ui;

/// <summary>デスクの1件の候補</summary>
internal sealed record DeskItem(string Path, string Name, string Status, IReadOnlyList<string> Reasons)
{
    /// <summary>退避中（ゴースト）か。開くと保管庫から中身が戻る</summary>
    public bool IsGhost => Status == DeskContent.StatusGhost;
}

/// <summary>
/// ui.desk.show の payload を読んだもの（docs/ipc-protocol.md の3節）。
/// {"desk_id", "context_label", "partner_label", "dialog_hwnd", "dialog_rect", "items": [{"path", "name", "status", "reasons"}]}
///
/// 候補を選ぶ・並べる・何件にするかは本体が決めます（desk.rank_files）。シェルは届いた候補を、届いた順に並べるだけです。
/// dialog_rect は、シェルが context.foreground で送った形（{"left", "top", "right", "bottom"}、物理ピクセル）です。
/// </summary>
internal sealed record DeskContent(
    EchoId? DeskId,
    string? ContextLabel,
    string? PartnerLabel,
    long? DialogHwnd,
    PixelRect? DialogRect,
    IReadOnlyList<DeskItem> Items)
{
    public const string StatusPresent = "present";
    public const string StatusGhost = "ghost";

    /// <summary>1回に並べる候補の上限（本体の DESK_MAX_ITEMS より大きく、画面に収まる数）</summary>
    public const int MaxItems = 10;

    private const int MaxReasons = 8;
    private const int MaxTextLength = 300;

    /// <summary>ダイアログに合わせて置くか（dialog_hwnd か dialog_rect がある）</summary>
    public bool ForDialog => DialogHwnd is not null || DialogRect is not null;

    /// <summary>読む。形の違う候補（絶対パスでない等）は飛ばし、skipped に件数を入れる</summary>
    public static DeskContent Parse(Payload payload, out int skipped)
    {
        skipped = 0;
        var items = new List<DeskItem>();
        foreach (Payload raw in payload.GetObjectArray("items") ?? new List<Payload>())
        {
            string? requested = raw.GetString("path");
            if (requested is null || !PathText.TryNormaliseAbsolute(requested, out string path) || items.Count >= MaxItems)
            {
                skipped++;
                continue;
            }
            string name = raw.GetString("name") ?? "";
            if (string.IsNullOrWhiteSpace(name))
            {
                name = System.IO.Path.GetFileName(path);
            }
            items.Add(new DeskItem(
                requested,
                TextLimit.Shorten(name, MaxTextLength),
                raw.GetString("status") ?? StatusPresent,
                TextLimit.List(raw.GetStringArray("reasons"), MaxReasons, MaxTextLength)));
        }

        long? hwnd = payload.GetInt64("dialog_hwnd");
        if (hwnd is long value && value == 0)
        {
            hwnd = null;
        }
        return new DeskContent(
            payload.GetEchoId("desk_id"),
            TextLimit.ShortenOrNull(payload.GetString("context_label"), MaxTextLength),
            TextLimit.ShortenOrNull(payload.GetString("partner_label"), MaxTextLength),
            hwnd,
            ParseRect(payload.GetObject("dialog_rect")),
            items);
    }

    /// <summary>{"left", "top", "right", "bottom"} を読む。形が違う・大きさがないときは null</summary>
    public static PixelRect? ParseRect(Payload rect)
    {
        double? left = rect.GetDouble("left");
        double? top = rect.GetDouble("top");
        double? right = rect.GetDouble("right");
        double? bottom = rect.GetDouble("bottom");
        if (left is null || top is null || right is null || bottom is null)
        {
            return null;
        }
        const double limit = 1_000_000;
        if (System.Math.Abs(left.Value) > limit || System.Math.Abs(top.Value) > limit
            || System.Math.Abs(right.Value) > limit || System.Math.Abs(bottom.Value) > limit)
        {
            return null;
        }
        var result = new PixelRect((int)left.Value, (int)top.Value, (int)right.Value, (int)bottom.Value);
        return result.IsEmpty ? null : result;
    }
}
