using System;
using System.Runtime.InteropServices;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.Storage.CloudFilters;

namespace Pip0Shell.CloudFiles;

/// <summary>
/// CfOpenFileWithOplock で開いたファイル（「保護されたハンドル」）。
///
/// - ほかのアプリがこのファイルを開こうとすると（oplock が破られると）、Windows がこのハンドルを閉じます。
///   こちらの処理は、<see cref="TryReference"/> が偽になったことで、それに気付きます。
/// - Win32 の関数に渡すときは、参照を取ってから Win32 のハンドルを取り出し、使い終わったら <see cref="Release"/> します。
///   参照している間は、ほかのアプリはこのファイルを開くのを待たされるので、長い処理は小分けにします。
/// - 閉じるときは CfCloseHandle を使います（CloseHandle ではありません）。CsWin32 の簡易版の関数は
///   CloseHandle で閉じる SafeFileHandle を返すため、ここでは使いません。
/// </summary>
internal sealed class ProtectedFile : IDisposable
{
    private readonly ProtectedFileHandle handle;

    private ProtectedFile(ProtectedFileHandle handle)
    {
        this.handle = handle;
    }

    /// <summary>開く。成功なら 0、失敗なら HRESULT を返す</summary>
    public static unsafe int Open(string path, CF_OPEN_FILE_FLAGS flags, out ProtectedFile? file)
    {
        file = null;
        HANDLE raw;
        HRESULT result;
        fixed (char* text = PathText.ForWin32(path))
        {
            result = PInvoke.CfOpenFileWithOplock(text, flags, &raw);
        }
        if (result.Failed)
        {
            return result.Value;
        }
        if (raw.IsNull || raw == new HANDLE(new IntPtr(-1)))
        {
            return HResultText.FromWin32(WIN32_ERROR.ERROR_INVALID_HANDLE);
        }
        file = new ProtectedFile(new ProtectedFileHandle(raw));
        return 0;
    }

    /// <summary>
    /// 参照を取り、Win32 のハンドルを返す。偽なら、ハンドルはもう閉じられている（ほかのアプリが開こうとした）。
    /// 真のときは、必ず <see cref="Release"/> を呼ぶこと。
    /// </summary>
    public bool TryReference(out HANDLE win32Handle)
    {
        win32Handle = default;
        if (handle.IsInvalid || handle.IsClosed)
        {
            return false;
        }
        HANDLE raw = (HANDLE)handle.DangerousGetHandle();
        if (!PInvoke.CfReferenceProtectedHandle(raw))
        {
            return false;
        }
        win32Handle = PInvoke.CfGetWin32HandleFromProtectedHandle(raw);
        if (win32Handle.IsNull)
        {
            PInvoke.CfReleaseProtectedHandle(raw);
            return false;
        }
        return true;
    }

    public void Release()
    {
        PInvoke.CfReleaseProtectedHandle((HANDLE)handle.DangerousGetHandle());
    }

    public void Dispose()
    {
        handle.Dispose();
    }

    /// <summary>CfCloseHandle で閉じる SafeHandle（Dispose を忘れても、最後には閉じられる）</summary>
    private sealed class ProtectedFileHandle : SafeHandle
    {
        public ProtectedFileHandle(HANDLE raw)
            : base(IntPtr.Zero, ownsHandle: true)
        {
            SetHandle(raw);
        }

        public override bool IsInvalid => handle == IntPtr.Zero || handle == new IntPtr(-1);

        protected override bool ReleaseHandle()
        {
            PInvoke.CfCloseHandle((HANDLE)handle);
            return true;
        }
    }
}
