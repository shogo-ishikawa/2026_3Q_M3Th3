using System.Collections.Generic;
using System.IO;
using Windows.Win32;
using Windows.Win32.Storage.CloudFilters;
using Windows.Win32.Storage.FileSystem;

namespace Pip0Shell.CloudFiles;

/// <summary>フォルダーの一覧から読んだ、1つの項目の情報（ファイルを開かずに読めるもの）</summary>
internal readonly record struct EntryInfo(bool IsDirectory, bool IsLink, uint Attributes, uint ReparseTag);

/// <summary>
/// ファイルを開かずに（＝ゴーストの中身を取りに行かせずに）、属性と再解析ポイントの種類を読む。
/// シンボリックリンクやジャンクション（名前の代理になる再解析ポイント）は、たどらないために見分けます。
/// </summary>
internal static unsafe class DirectoryEntry
{
    /// <summary>再解析ポイントの種類のうち「名前の代理」（シンボリックリンク、ジャンクション等）を表すビット</summary>
    private const uint NameSurrogateBit = 0x20000000;

    /// <summary>path の項目を読む。なければ偽</summary>
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
        complete = true;
        int entries = 0;
        int placeholders = 0;
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
                if (entries > maxEntries)
                {
                    complete = false;
                    return placeholders;
                }

                EntryInfo entry = ToEntry(data);
                if (entry.IsDirectory)
                {
                    if (!entry.IsLink)
                    {
                        pending.Push(Path.Combine(directory, name));
                    }
                    continue;
                }

                CF_PLACEHOLDER_STATE state = PInvoke.CfGetPlaceholderStateFromAttributeTag(entry.Attributes, entry.ReparseTag);
                if (state != CF_PLACEHOLDER_STATE.CF_PLACEHOLDER_STATE_INVALID
                    && (state & CF_PLACEHOLDER_STATE.CF_PLACEHOLDER_STATE_PLACEHOLDER) != 0)
                {
                    placeholders++;
                }
            }
            while (PInvoke.FindNextFile(find, out data));
        }
        return placeholders;
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
