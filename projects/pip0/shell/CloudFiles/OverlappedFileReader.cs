using System;
using System.Runtime.InteropServices;
using System.Threading;
using Windows.Win32;
using Windows.Win32.Foundation;

namespace Pip0Shell.CloudFiles;

/// <summary>
/// CfOpenFileWithOplock が開いたファイル（非同期のハンドル）を、位置を指定して同期的に読む。
///
/// .NET の FileStream や RandomAccess は、非同期のハンドルをスレッドプールの I/O 完了ポートに結び付けようとします。
/// このハンドルは Windows（cldapi）のものなので結び付けず、ReadFile と、下位ビットを立てたイベントで完了を待ちます
/// （下位ビットを立てると、完了の知らせが I/O 完了ポートへ送られません）。
/// </summary>
internal static unsafe class OverlappedFileReader
{
    /// <summary>読めたバイト数を返す（0 はファイルの終わり）。失敗したら -1 を返し、hresult に番号を入れる</summary>
    public static int Read(HANDLE handle, byte* buffer, int count, long offset, out int hresult)
    {
        hresult = 0;
        using var completed = new ManualResetEvent(initialState: false);
        bool added = false;
        completed.SafeWaitHandle.DangerousAddRef(ref added);
        try
        {
            NativeOverlapped overlapped = default;
            overlapped.OffsetLow = unchecked((int)(offset & 0xFFFFFFFFL));
            overlapped.OffsetHigh = unchecked((int)(offset >> 32));
            overlapped.EventHandle = completed.SafeWaitHandle.DangerousGetHandle() | 1;

            if (!PInvoke.ReadFile(handle, buffer, (uint)count, null, &overlapped))
            {
                int error = Marshal.GetLastPInvokeError();
                if (error == (int)WIN32_ERROR.ERROR_HANDLE_EOF)
                {
                    return 0;
                }
                if (error != (int)WIN32_ERROR.ERROR_IO_PENDING)
                {
                    hresult = HResultText.FromWin32(error);
                    return -1;
                }
            }

            uint transferred = 0;
            if (!PInvoke.GetOverlappedResult(handle, &overlapped, &transferred, true))
            {
                int error = Marshal.GetLastPInvokeError();
                if (error == (int)WIN32_ERROR.ERROR_HANDLE_EOF)
                {
                    return 0;
                }
                hresult = HResultText.FromWin32(error);
                return -1;
            }
            return (int)transferred;
        }
        finally
        {
            if (added)
            {
                completed.SafeWaitHandle.DangerousRelease();
            }
        }
    }
}
