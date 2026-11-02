using System.Globalization;

namespace Pip0Shell.Trash;

/// <summary>
/// ごみ箱へ移す候補の1件（trash.confirm_and_recycle の items の1つ）。
/// RequestedPath は本体から受け取ったままの文字列で、答えの "path" にそのまま返します（本体が照合しやすいように）。
/// </summary>
internal sealed record TrashItem(string Path, string RequestedPath, string Name, long? Size)
{
    /// <summary>確認画面に出す1行（名前と大きさ）</summary>
    public string DisplayLine => Size is long size ? Name + "（" + FormatSize(size) + "）" : Name;

    public static string FormatSize(long bytes)
    {
        if (bytes < 1024)
        {
            return bytes.ToString(CultureInfo.InvariantCulture) + " バイト";
        }
        double value = bytes;
        string[] units = { "KB", "MB", "GB", "TB" };
        int unit = -1;
        while (value >= 1024 && unit < units.Length - 1)
        {
            value /= 1024;
            unit++;
        }
        return value.ToString("0.0", CultureInfo.InvariantCulture) + " " + units[unit];
    }
}
