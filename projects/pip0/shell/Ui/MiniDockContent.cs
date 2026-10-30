using System.Collections.Generic;
using Pip0Shell.Ipc;

namespace Pip0Shell.Ui;

/// <summary>ミニドックの1行の「別の仕分け先」</summary>
internal sealed record MiniDockAlternative(long Index, string Label);

/// <summary>ミニドックの1行（1つのダウンロード）</summary>
internal sealed record MiniDockRow(
    EchoId EntryId,
    string FileName,
    string Status,
    string? DestLabel,
    string? NewName,
    IReadOnlyList<string> Reasons,
    IReadOnlyList<MiniDockAlternative> Alternatives,
    string? ContextLabel)
{
    /// <summary>「提案どおり」を押せるか（仕分け先の候補がない行では押せない）</summary>
    public bool CanAccept => Status != MiniDockContent.StatusNoCandidate && !string.IsNullOrEmpty(DestLabel);
}

/// <summary>
/// ui.mini_dock.show の payload を読んだもの（docs/ipc-protocol.md の3節）。
/// {"dock_id", "rows": [{"entry_id", "file_name", "status", "dest_label", "new_name", "reasons", "alternatives", "context_label", "remaining_seconds"}]}
///
/// 行の中身と、いつ閉じるか（残り時間）は本体が決めます。シェルは届いた行をそのまま並べるだけです
/// （remaining_seconds は表示にも使いません。止めたり数え直したりするのは本体だからです）。
/// </summary>
internal sealed record MiniDockContent(EchoId DockId, IReadOnlyList<MiniDockRow> Rows)
{
    public const string StatusProposed = "proposed";
    public const string StatusNoCandidate = "no_candidate";
    public const string StatusNeedsAnalysis = "needs_analysis";

    /// <summary>1回に並べる行の上限（本体の MINI_DOCK_MAX_ROWS より大きく、画面に収まる数）</summary>
    public const int MaxRows = 20;

    private const int MaxReasons = 10;
    private const int MaxAlternatives = 5;
    private const int MaxTextLength = 300;

    /// <summary>読めなければ null（problem に理由）。形の違う行は飛ばす（skipped に件数）</summary>
    public static MiniDockContent? Parse(Payload payload, out string problem, out int skipped)
    {
        skipped = 0;
        EchoId? dockId = payload.GetEchoId("dock_id");
        if (dockId is null)
        {
            problem = "dock_id（文字列か整数）がありません。";
            return null;
        }
        IReadOnlyList<Payload>? rawRows = payload.GetObjectArray("rows");
        if (rawRows is null)
        {
            problem = "rows（配列）がありません。";
            return null;
        }

        var rows = new List<MiniDockRow>();
        foreach (Payload raw in rawRows)
        {
            MiniDockRow? row = ParseRow(raw);
            if (row is null || rows.Count >= MaxRows)
            {
                skipped++;
                continue;
            }
            rows.Add(row);
        }
        problem = "";
        return new MiniDockContent(dockId.Value, rows);
    }

    private static MiniDockRow? ParseRow(Payload raw)
    {
        EchoId? entryId = raw.GetEchoId("entry_id");
        string? fileName = raw.GetString("file_name");
        if (entryId is null || string.IsNullOrWhiteSpace(fileName))
        {
            return null;
        }
        string status = raw.GetString("status") ?? StatusProposed;

        var alternatives = new List<MiniDockAlternative>();
        foreach (Payload alternative in raw.GetObjectArray("alternatives") ?? new List<Payload>())
        {
            long? index = alternative.GetInt64("index");
            string? label = alternative.GetString("label");
            if (index is null || string.IsNullOrWhiteSpace(label) || alternatives.Count >= MaxAlternatives)
            {
                continue;
            }
            alternatives.Add(new MiniDockAlternative(index.Value, TextLimit.Shorten(label, MaxTextLength)));
        }

        return new MiniDockRow(
            entryId.Value,
            TextLimit.Shorten(fileName, MaxTextLength),
            status,
            TextLimit.ShortenOrNull(raw.GetString("dest_label"), MaxTextLength),
            TextLimit.ShortenOrNull(raw.GetString("new_name"), MaxTextLength),
            TextLimit.List(raw.GetStringArray("reasons"), MaxReasons, MaxTextLength),
            alternatives,
            TextLimit.ShortenOrNull(raw.GetString("context_label"), MaxTextLength));
    }
}

/// <summary>画面に出す文字の長さと数をそろえる小さな道具</summary>
internal static class TextLimit
{
    /// <summary>maxLength を超えたら切って「…」を付ける。前後の空白は除く</summary>
    public static string Shorten(string text, int maxLength)
    {
        string trimmed = text.Trim();
        return trimmed.Length <= maxLength ? trimmed : trimmed.Substring(0, maxLength - 1) + "…";
    }

    /// <summary>null や空白だけなら null</summary>
    public static string? ShortenOrNull(string? text, int maxLength)
    {
        return string.IsNullOrWhiteSpace(text) ? null : Shorten(text, maxLength);
    }

    /// <summary>空白だけの項目を除き、maxCount 件までにする</summary>
    public static IReadOnlyList<string> List(IReadOnlyList<string>? items, int maxCount, int maxLength)
    {
        var result = new List<string>();
        if (items is null)
        {
            return result;
        }
        foreach (string item in items)
        {
            if (result.Count >= maxCount)
            {
                break;
            }
            if (!string.IsNullOrWhiteSpace(item))
            {
                result.Add(Shorten(item, maxLength));
            }
        }
        return result;
    }
}
