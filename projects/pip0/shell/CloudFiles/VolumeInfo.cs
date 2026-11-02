using System;
using System.IO;
using Windows.Win32;

namespace Pip0Shell.CloudFiles;

/// <summary>ドライブのファイルシステムの名前（NTFS、exFAT 等）を調べる</summary>
internal static unsafe class VolumeInfo
{
    /// <summary>path があるドライブのファイルシステムの名前。調べられなければ null</summary>
    public static string? FileSystemName(string path)
    {
        string? root = Path.GetPathRoot(path);
        if (string.IsNullOrEmpty(root))
        {
            return null;
        }
        if (!root.EndsWith('\\'))
        {
            root += "\\";
        }

        Span<char> name = stackalloc char[64];
        if (!PInvoke.GetVolumeInformation(root, Span<char>.Empty, null, null, null, name))
        {
            return null;
        }
        int end = name.IndexOf('\0');
        return (end >= 0 ? name.Slice(0, end) : name).ToString();
    }
}
