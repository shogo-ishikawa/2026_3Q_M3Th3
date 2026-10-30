using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.Storage.FileSystem;

namespace Pip0Shell.CloudFiles;

/// <summary>
/// 開いたファイルの、大きさ・最終更新日時・ファイル番号・属性。
/// cf.make_ghost で、保管庫へコピーしたときの値（expected）と比べて、ファイルが変わっていないかを確かめます。
/// </summary>
internal sealed class FileSnapshot
{
    /// <summary>1601年1月1日（FILETIME の起点）から 1970年1月1日までを 100 ナノ秒で数えた値</summary>
    private const long UnixEpochAsFileTime = 116444736000000000L;

    private FileSnapshot(long size, long mtimeNs, uint attributes, IReadOnlyList<string> fileKeys)
    {
        Size = size;
        MtimeNs = mtimeNs;
        Attributes = attributes;
        FileKeys = fileKeys;
    }

    public long Size { get; }

    /// <summary>最終更新日時を、1970年1月1日からのナノ秒にした値（Python の os.stat の st_mtime_ns と同じ）</summary>
    public long MtimeNs { get; }

    public uint Attributes { get; }

    /// <summary>
    /// 中身がすべてはディスクにない印が付いているか（FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS または RECALL_ON_OPEN）。
    /// Windows の説明では「ファイルのデータのすべてがローカルの記憶装置にあるわけではない」という意味です。
    /// </summary>
    public bool DataNotFullyLocal =>
        (Attributes & (uint)(FILE_FLAGS_AND_ATTRIBUTES.FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS | FILE_FLAGS_AND_ATTRIBUTES.FILE_ATTRIBUTE_RECALL_ON_OPEN)) != 0;

    /// <summary>
    /// 「ボリューム番号:ファイル番号」の書き方の候補。本体は Python の os.stat の st_dev:st_ino を使います。
    /// Python 3.12 以降は 64 ビットのボリューム番号と 128 ビットのファイル番号（FILE_ID_INFO）、
    /// 3.11 までは 32 ビットのボリューム番号と 64 ビットのファイル番号を使うため、どちらの書き方でも照合できるようにしています。
    /// どれも同じファイルを指す番号なので、別のファイルに置き換わったことは見分けられます。
    /// </summary>
    public IReadOnlyList<string> FileKeys { get; }

    public bool HasFileKey(string expected)
    {
        foreach (string key in FileKeys)
        {
            if (string.Equals(key, expected, StringComparison.Ordinal))
            {
                return true;
            }
        }
        return false;
    }

    /// <summary>ハンドルから読む。読めなければ null と HRESULT</summary>
    public static unsafe FileSnapshot? TryRead(HANDLE handle, out int hresult)
    {
        BY_HANDLE_FILE_INFORMATION info;
        if (!PInvoke.GetFileInformationByHandle(handle, &info))
        {
            hresult = HResultText.FromWin32(Marshal.GetLastPInvokeError());
            return null;
        }

        long size = ((long)info.nFileSizeHigh << 32) | info.nFileSizeLow;
        long fileTime = ((long)(uint)info.ftLastWriteTime.dwHighDateTime << 32) | (uint)info.ftLastWriteTime.dwLowDateTime;
        long mtimeNs = (fileTime - UnixEpochAsFileTime) * 100;

        var keys = new List<string>();
        ulong index64 = ((ulong)info.nFileIndexHigh << 32) | info.nFileIndexLow;
        uint serial32 = info.dwVolumeSerialNumber;

        FILE_ID_INFO idInfo;
        if (PInvoke.GetFileInformationByHandleEx(handle, FILE_INFO_BY_HANDLE_CLASS.FileIdInfo, &idInfo, (uint)sizeof(FILE_ID_INFO)))
        {
            UInt128 id128 = ReadFileId(idInfo.FileId.Identifier.AsReadOnlySpan());
            ulong serial64 = idInfo.VolumeSerialNumber;
            AddKey(keys, serial64.ToString(CultureInfo.InvariantCulture), id128.ToString(CultureInfo.InvariantCulture));
            AddKey(keys, unchecked((long)serial64).ToString(CultureInfo.InvariantCulture), id128.ToString(CultureInfo.InvariantCulture));
            AddKey(keys, serial32.ToString(CultureInfo.InvariantCulture), id128.ToString(CultureInfo.InvariantCulture));
        }
        AddKey(keys, serial32.ToString(CultureInfo.InvariantCulture), index64.ToString(CultureInfo.InvariantCulture));

        hresult = 0;
        return new FileSnapshot(size, mtimeNs, info.dwFileAttributes, keys);
    }

    /// <summary>FILE_ID_128 の 16 バイト（リトルエンディアン）を数にする</summary>
    private static UInt128 ReadFileId(ReadOnlySpan<byte> bytes)
    {
        ulong low = BitConverter.ToUInt64(bytes.Slice(0, 8));
        ulong high = BitConverter.ToUInt64(bytes.Slice(8, 8));
        return new UInt128(high, low);
    }

    private static void AddKey(List<string> keys, string volume, string file)
    {
        string key = volume + ":" + file;
        if (!keys.Contains(key))
        {
            keys.Add(key);
        }
    }
}
