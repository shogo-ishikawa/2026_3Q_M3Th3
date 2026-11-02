using Microsoft.Win32.SafeHandles;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.Storage.FileSystem;

namespace Pip0Shell.CloudFiles;

/// <summary>
/// 開いたファイルの「本当の場所」（ジャンクションや 8.3 形式の短い名前をたどった後のパス）を調べる。
/// 同期ルートの中にあるかを、文字列の見た目ではなく実体で確かめるために使います。
/// </summary>
internal static unsafe class FinalPath
{
    private const int MaxCapacity = 33000;

    /// <summary>ハンドルの指すファイルのパス（「\\?\」は外す）。調べられなければ null</summary>
    public static string? Of(HANDLE handle)
    {
        int capacity = 512;
        while (capacity <= MaxCapacity)
        {
            char[] buffer = new char[capacity];
            uint length;
            fixed (char* text = buffer)
            {
                length = PInvoke.GetFinalPathNameByHandle(
                    handle,
                    text,
                    (uint)buffer.Length,
                    GETFINALPATHNAMEBYHANDLE_FLAGS.FILE_NAME_NORMALIZED | GETFINALPATHNAMEBYHANDLE_FLAGS.VOLUME_NAME_DOS);
            }
            if (length == 0)
            {
                return null;
            }
            if (length < (uint)buffer.Length)
            {
                return PathText.StripLongPathPrefix(new string(buffer, 0, (int)length));
            }
            capacity = (int)length + 1; // 足りなかった：必要な長さで読み直す
        }
        return null;
    }

    /// <summary>フォルダーの本当の場所。調べられなければ null</summary>
    public static string? OfDirectory(string path)
    {
        using SafeFileHandle directory = PInvoke.CreateFile(
            PathText.ForWin32(path),
            (uint)FILE_ACCESS_RIGHTS.FILE_READ_ATTRIBUTES,
            FILE_SHARE_MODE.FILE_SHARE_READ | FILE_SHARE_MODE.FILE_SHARE_WRITE | FILE_SHARE_MODE.FILE_SHARE_DELETE,
            null,
            FILE_CREATION_DISPOSITION.OPEN_EXISTING,
            FILE_FLAGS_AND_ATTRIBUTES.FILE_FLAG_BACKUP_SEMANTICS,
            null);
        if (directory.IsInvalid)
        {
            return null;
        }
        return Of((HANDLE)directory.DangerousGetHandle());
    }
}
