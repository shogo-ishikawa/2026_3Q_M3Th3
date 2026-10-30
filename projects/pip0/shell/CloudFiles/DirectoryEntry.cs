using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.Storage.CloudFilters;
using Windows.Win32.Storage.FileSystem;

namespace Pip0Shell.CloudFiles;

/// <summary>フォルダーの一覧から読んだ、1つの項目の情報（ファイルを開かずに読めるもの）</summary>
internal readonly record struct EntryInfo(bool IsDirectory, bool IsLink, uint Attributes, uint ReparseTag)
{
    /// <summary>読み取り専用の属性が付いているか</summary>
    public bool IsReadOnly => (Attributes & (uint)FILE_FLAGS_AND_ATTRIBUTES.FILE_ATTRIBUTE_READONLY) != 0;
}

/// <summary>項目を探した結果</summary>
internal enum EntryLookup
{
    /// <summary>あった</summary>
    Found,

    /// <summary>ないことが確か（ファイル・フォルダーが見つからない、名前として正しくない）</summary>
    NotFound,

    /// <summary>あるかどうかを確かめられない（アクセスの拒否、ドライブの取り外しなど）</summary>
    Unknown,
}

/// <summary>
/// ファイルを開かずに（＝ゴーストの中身を取りに行かせずに）、属性と再解析ポイントの種類を読む。
/// シンボリックリンクやジャンクション（名前の代理になる再解析ポイント）は、たどらないために見分けます。
/// </summary>
internal static unsafe class DirectoryEntry
{
    /// <summary>再解析ポイントの種類のうち「名前の代理」（シンボリックリンク、ジャンクション等）を表すビット</summary>
    private const uint NameSurrogateBit = 0x20000000;

    /// <summary>
    /// path の項目を探す。「ない」と「確かめられない」を分けて返す（確かめられないことを「ない」としない）。
    /// hresult は、見つからなかったときの理由（あったときは 0）。
    /// </summary>
    public static EntryLookup Find(string path, out EntryInfo entry, out int hresult)
    {
        WIN32_FIND_DATAW data;
        using FindCloseSafeHandle find = PInvoke.FindFirstFileEx(
            PathText.ForWin32(path),
            FINDEX_INFO_LEVELS.FindExInfoBasic,
            &data,
            FINDEX_SEARCH_OPS.FindExSearchNameMatch,
            0);
        if (find.IsInvalid)
        {
            int error = Marshal.GetLastPInvokeError();
            entry = default;
            hresult = HResultText.FromWin32(error);
            bool missing = error == (int)WIN32_ERROR.ERROR_FILE_NOT_FOUND
                || error == (int)WIN32_ERROR.ERROR_PATH_NOT_FOUND
                || error == (int)WIN32_ERROR.ERROR_INVALID_NAME;
            return missing ? EntryLookup.NotFound : EntryLookup.Unknown;
        }
        entry = ToEntry(data);
        hresult = 0;
        return EntryLookup.Found;
    }

    /// <summary>path の項目を読む。なければ偽（「ない」と「確かめられない」を分けたいときは <see cref="Find"/>）</summary>
    public static bool TryRead(string path, out EntryInfo entry)
    {
        WIN32_FIND_DATAW data;
        using FindCloseSafeHandle find = PInvoke.FindFirstFileEx(
            PathText.ForWin32(path),
            FINDEX_INFO_LEVELS.FindExInfoBasic,
            &data,
            FINDEX_SEARCH_OPS.FindExSearchNameMatch,
            0);
        if (find.IsInvalid)
        {
            entry = default;
            return false;
        }
        entry = ToEntry(data);
        return true;
    }

    /// <summary>
    /// root の下にある、Cloud Files のプレースホルダーのファイルを数える（同期ルートの登録を解除する前の確認）。
    /// リンクとジャンクションはたどらない。maxEntries 件を超えたり、読めないフォルダーがあったりしたら complete が偽。
    /// </summary>
    public static int CountPlaceholderFiles(string root, int maxEntries, out bool complete)
    {
        int placeholders = 0;
        complete = WalkPlaceholderFiles(root, maxEntries, Timeout.InfiniteTimeSpan, CancellationToken.None, _ => placeholders++);
        return placeholders;
    }

    /// <summary>
    /// root の下にある、Cloud Files のプレースホルダーのファイルのパスを集める（cf.locate）。
    /// 数えるときと同じく、リンクとジャンクションはたどらない。maxEntries 件・timeLimit を超えたり、
    /// 読めないフォルダーがあったり、中止されたりしたら complete が偽（集めた分だけを返す）。
    /// </summary>
    public static List<string> ListPlaceholderFiles(
        string root, int maxEntries, TimeSpan timeLimit, CancellationToken cancel, out bool complete)
    {
        var paths = new List<string>();
        complete = WalkPlaceholderFiles(root, maxEntries, timeLimit, cancel, paths.Add);
        return paths;
    }

    /// <summary>
    /// root の下をたどり、プレースホルダーのファイル（属性と再解析ポイントの種類で判断。ファイルは開かない）ごとに
    /// found を呼ぶ。すべてたどれたら真。
    /// </summary>
    private static bool WalkPlaceholderFiles(
        string root, int maxEntries, TimeSpan timeLimit, CancellationToken cancel, Action<string> found)
    {
        bool complete = true;
        int entries = 0;
        Stopwatch clock = Stopwatch.StartNew();
        var pending = new Stack<string>();
        pending.Push(root);

        while (pending.Count > 0)
        {
            string directory = pending.Pop();
            WIN32_FIND_DATAW data;
            using FindCloseSafeHandle find = PInvoke.FindFirstFileEx(
                PathText.ForWin32(Path.Combine(directory, "*")),
                FINDEX_INFO_LEVELS.FindExInfoBasic,
                &data,
                FINDEX_SEARCH_OPS.FindExSearchNameMatch,
                FIND_FIRST_EX_FLAGS.FIND_FIRST_EX_LARGE_FETCH);
            if (find.IsInvalid)
            {
                complete = false;
                continue;
            }

            do
            {
                string name = data.cFileName.ToString();
                if (name == "." || name == "..")
                {
                    continue;
                }
                entries++;
                if (entries > maxEntries || cancel.IsCancellationRequested
                    || (timeLimit != Timeout.InfiniteTimeSpan && clock.Elapsed > timeLimit))
                {
                    return false;
                }

                EntryInfo entry = ToEntry(data);
                string fullPath = Path.Combine(directory, name);
                if (entry.IsDirectory)
                {
                    if (!entry.IsLink)
                    {
                        pending.Push(fullPath);
                    }
                    continue;
                }

                CF_PLACEHOLDER_STATE state = PInvoke.CfGetPlaceholderStateFromAttributeTag(entry.Attributes, entry.ReparseTag);
                if (state != CF_PLACEHOLDER_STATE.CF_PLACEHOLDER_STATE_INVALID
                    && (state & CF_PLACEHOLDER_STATE.CF_PLACEHOLDER_STATE_PLACEHOLDER) != 0)
                {
                    found(fullPath);
                }
            }
            while (PInvoke.FindNextFile(find, out data));
        }
        return complete;
    }

    private static EntryInfo ToEntry(in WIN32_FIND_DATAW data)
    {
        uint attributes = data.dwFileAttributes;
        bool reparse = (attributes & (uint)FILE_FLAGS_AND_ATTRIBUTES.FILE_ATTRIBUTE_REPARSE_POINT) != 0;
        uint tag = reparse ? data.dwReserved0 : 0;
        return new EntryInfo(
            (attributes & (uint)FILE_FLAGS_AND_ATTRIBUTES.FILE_ATTRIBUTE_DIRECTORY) != 0,
            reparse && (tag & NameSurrogateBit) != 0,
            attributes,
            tag);
    }
}
