using System;
using System.IO;

namespace Pip0Shell.CloudFiles;

/// <summary>Windows のパスの文字列の扱い（絶対パスの確認、フォルダーの中かどうか、長いパス）</summary>
internal static class PathText
{
    /// <summary>
    /// 本体から受け取ったパスが Windows の絶対パスかを確かめ、比べやすい形（末尾の「\」なし）にする。
    /// 「\\?\」の付いたパスは外して扱う。デバイスの名前空間（\\.\）は受け付けない。
    /// </summary>
    public static bool TryNormaliseAbsolute(string? path, out string normalised)
    {
        normalised = "";
        if (string.IsNullOrWhiteSpace(path) || path.IndexOf('\0') >= 0)
        {
            return false;
        }
        string text = StripLongPathPrefix(path);
        if (text.StartsWith(@"\\.\", StringComparison.Ordinal) || text.StartsWith(@"\\?\", StringComparison.Ordinal))
        {
            return false;
        }
        if (!Path.IsPathFullyQualified(text))
        {
            return false;
        }
        try
        {
            normalised = TrimEndSeparator(Path.GetFullPath(text));
            return true;
        }
        catch (Exception error) when (error is ArgumentException or NotSupportedException or PathTooLongException)
        {
            return false;
        }
    }

    /// <summary>path が root と同じか、root の中にあるとき真（大文字と小文字は区別しない）</summary>
    public static bool IsSameOrInside(string path, string root)
    {
        string p = TrimEndSeparator(path);
        string r = TrimEndSeparator(root);
        if (string.Equals(p, r, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }
        string prefix = r.EndsWith('\\') ? r : r + "\\";
        return p.StartsWith(prefix, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>path が root の中にある（root そのものではない）とき真</summary>
    public static bool IsInside(string path, string root)
    {
        return IsSameOrInside(path, root) && !string.Equals(TrimEndSeparator(path), TrimEndSeparator(root), StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Win32 API に渡す形。長いパスには「\\?\」を付ける</summary>
    public static string ForWin32(string path)
    {
        if (path.Length < 248 || path.StartsWith(@"\\?\", StringComparison.Ordinal))
        {
            return path;
        }
        if (path.StartsWith(@"\\", StringComparison.Ordinal))
        {
            return @"\\?\UNC\" + path.Substring(2);
        }
        return @"\\?\" + path;
    }

    /// <summary>「\\?\C:\…」→「C:\…」、「\\?\UNC\server\…」→「\\server\…」</summary>
    public static string StripLongPathPrefix(string path)
    {
        if (path.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase))
        {
            return @"\\" + path.Substring(8);
        }
        if (path.StartsWith(@"\\?\", StringComparison.Ordinal) && path.Length >= 6 && path[5] == ':')
        {
            return path.Substring(4);
        }
        return path;
    }

    /// <summary>末尾の「\」を外す（「C:\」のようなドライブの直下はそのまま）</summary>
    public static string TrimEndSeparator(string path)
    {
        string trimmed = path.TrimEnd('\\', '/');
        if (trimmed.Length == 2 && trimmed[1] == ':')
        {
            return trimmed + "\\";
        }
        return trimmed.Length == 0 ? path : trimmed;
    }
}
