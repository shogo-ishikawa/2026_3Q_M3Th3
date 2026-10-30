using System;
using System.Text;

namespace Pip0Shell.CloudFiles;

/// <summary>
/// 保管庫の項目ID（32桁の16進数）。ゴーストの FileIdentity に ASCII のまま入れます。
/// 保管庫のフォルダー名（vault\items\&lt;項目ID&gt;）にも使うので、16進数以外の文字を含むものは受け付けません
/// （「..\」などで保管庫の外を指せないようにするため）。
/// </summary>
internal static class ItemId
{
    public const int Length = 32;

    public static bool IsValid(string? text)
    {
        if (text is null || text.Length != Length)
        {
            return false;
        }
        foreach (char c in text)
        {
            bool hex = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
            if (!hex)
            {
                return false;
            }
        }
        return true;
    }

    /// <summary>FileIdentity に入れるバイト列（32バイトの ASCII）</summary>
    public static byte[] ToIdentity(string itemId) => Encoding.ASCII.GetBytes(itemId);

    /// <summary>FileIdentity のバイト列が項目IDなら、その文字列。違えば null</summary>
    public static string? FromIdentity(ReadOnlySpan<byte> identity)
    {
        if (identity.Length != Length)
        {
            return null;
        }
        foreach (byte b in identity)
        {
            if (b > 0x7F)
            {
                return null;
            }
        }
        string text = Encoding.ASCII.GetString(identity);
        return IsValid(text) ? text : null;
    }

    public static bool Same(string? a, string? b)
    {
        return a is not null && b is not null && string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
    }
}
