using System;
using System.Runtime.InteropServices;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.System.Com;
using Windows.Win32.UI.Shell;
using Windows.Win32.UI.Shell.Common;

namespace Pip0Shell.Context;

/// <summary>
/// ショートカット（.lnk）が指す先のパスを読む（IShellLinkW と IPersistFile）。
///
/// - ショートカットのファイルを読むだけで、指す先のファイルには触れません（Resolve を呼ばないので、探しに行くことも、
///   ゴーストの中身を取りに行かせることもありません）。
/// - ShellLink は STA のスレッドで使う COM の部品なので、STA のスレッドから呼んでください。
/// - 長いパスに対応するため、まず項目 ID の一覧（PIDL）から SHGetPathFromIDListEx で読み、だめなら GetPath（260 文字まで）で読みます。
/// </summary>
internal static unsafe class ShellLinkReader
{
    private const int MaxPath = 32768;
    private const int ShortMaxPath = 260;

    /// <summary>指す先のパス。読めない・ファイルシステムの場所でなければ null</summary>
    public static string? ReadTarget(string linkPath)
    {
        object? instance = null;
        try
        {
            instance = new ShellLink();
            var link = (IShellLinkW)instance;
            var file = (IPersistFile)instance;
            fixed (char* name = linkPath)
            {
                file.Load(new PCWSTR(name), STGM.STGM_READ);
            }

            ITEMIDLIST* pidl = null;
            link.GetIDList(&pidl);
            if (pidl is not null)
            {
                try
                {
                    char[] buffer = new char[MaxPath];
                    fixed (char* pointer = buffer)
                    {
                        if (PInvoke.SHGetPathFromIDListEx(pidl, new PWSTR(pointer), (uint)buffer.Length, GPFIDL_FLAGS.GPFIDL_DEFAULT))
                        {
                            string fromList = new string(pointer);
                            if (fromList.Length > 0)
                            {
                                return fromList;
                            }
                        }
                    }
                }
                finally
                {
                    PInvoke.ILFree(pidl);
                }
            }

            char* shortBuffer = stackalloc char[ShortMaxPath];
            shortBuffer[0] = '\0';
            link.GetPath(new PWSTR(shortBuffer), ShortMaxPath, null, 0);
            string fromPath = new string(shortBuffer);
            return fromPath.Length > 0 ? fromPath : null;
        }
        catch (Exception error) when (error is COMException or UnauthorizedAccessException or InvalidCastException or ArgumentException or System.IO.IOException)
        {
            return null; // 壊れたショートカットなど
        }
        finally
        {
            if (instance is not null)
            {
                Marshal.FinalReleaseComObject(instance);
            }
        }
    }
}
