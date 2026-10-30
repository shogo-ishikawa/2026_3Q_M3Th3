using System.Collections.Generic;
using Pip0Shell.Ipc;

namespace Pip0Shell.Ui;

/// <summary>警告の対象の1件（ファイル名と判定）</summary>
internal sealed record HazardItem(string Name, string Level);

/// <summary>
/// ui.hazard.show の payload を読んだもの（docs/ipc-protocol.md の3節）。
/// {"level": "sensitive"/"unknown", "message", "items": [{"name", "level", "reasons"}]}
///
/// 機密かどうかの判定と、警告を出すか・消音するかは本体が決めます。シェルは枠と短い文を出すだけです。
/// </summary>
internal sealed record HazardContent(string Level, string Message, IReadOnlyList<HazardItem> Items)
{
    public const string LevelSensitive = "sensitive";
    public const string LevelUnknown = "unknown";

    /// <summary>画面に名前を出す件数（残りは「ほか n 件」）</summary>
    public const int ListedNames = 3;

    private const int MaxItems = 1000;
    private const int MaxTextLength = 200;

    /// <summary>赤（機密）で出すか。"sensitive" 以外は橙（機密か未判定）で出す（安全側：知らない値を「警告なし」にしない）</summary>
    public bool IsSensitive => Level == LevelSensitive;

    public static HazardContent Parse(Payload payload, out bool unknownLevel)
    {
        string level = payload.GetString("level") ?? "";
        unknownLevel = level != LevelSensitive && level != LevelUnknown;
        if (unknownLevel)
        {
            level = LevelUnknown;
        }

        var items = new List<HazardItem>();
        foreach (Payload raw in payload.GetObjectArray("items") ?? new List<Payload>())
        {
            string? name = raw.GetString("name");
            if (string.IsNullOrWhiteSpace(name) || items.Count >= MaxItems)
            {
                continue;
            }
            items.Add(new HazardItem(TextLimit.Shorten(name, MaxTextLength), raw.GetString("level") ?? LevelUnknown));
        }

        string message = TextLimit.ShortenOrNull(payload.GetString("message"), MaxTextLength)
            ?? (level == LevelSensitive
                ? "機密のファイルを含むドラッグです。送り先を確かめてください。"
                : "機密か未判定のファイルを含むドラッグです。送り先を確かめてください。");
        return new HazardContent(level, message, items);
    }

    /// <summary>「a.pdf、b.xlsx ほか 2 件」の形。対象がなければ空</summary>
    public string NamesLine()
    {
        if (Items.Count == 0)
        {
            return "";
        }
        var names = new List<string>();
        for (int i = 0; i < Items.Count && i < ListedNames; i++)
        {
            names.Add(Items[i].Name);
        }
        string line = string.Join("、", names);
        int rest = Items.Count - names.Count;
        return rest > 0 ? line + " ほか " + rest + " 件" : line;
    }
}
