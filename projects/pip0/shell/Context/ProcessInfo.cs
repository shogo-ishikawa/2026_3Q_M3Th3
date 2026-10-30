using System;
using System.IO;
using System.Runtime.InteropServices;
using Pip0Shell.Core;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.Security;
using Windows.Win32.System.Threading;

namespace Pip0Shell.Context;

/// <summary>プロセスの名前を調べた結果。Name は "slack.exe" のような実行ファイルの名前（調べられなければ null）</summary>
internal readonly record struct ProcessLookup(string? Name, bool AccessDenied);

/// <summary>
/// プロセスの番号から、実行ファイルの名前と「権限の高さ」（整合性レベル）を調べる。
///
/// - 名前：OpenProcess（PROCESS_QUERY_LIMITED_INFORMATION）と QueryFullProcessImageName。
///   保護されたプロセスなどで拒否されたら AccessDenied（context.foreground の inaccessible）にする。
/// - 権限の高さ：管理者として動くアプリのウィンドウには、Windows の制限（UIPI）でファイル名を入力できないため、
///   失敗の理由を正しく伝えるために使う。
/// </summary>
internal static unsafe class ProcessInfo
{
    private const int MaxImagePath = 32768;

    public static ProcessLookup Lookup(uint processId)
    {
        if (processId == 0)
        {
            return new ProcessLookup(null, false);
        }
        HANDLE process = PInvoke.OpenProcess(PROCESS_ACCESS_RIGHTS.PROCESS_QUERY_LIMITED_INFORMATION, false, processId);
        if (process.IsNull)
        {
            int error = Marshal.GetLastPInvokeError();
            return new ProcessLookup(null, error == (int)WIN32_ERROR.ERROR_ACCESS_DENIED);
        }
        try
        {
            char[] buffer = new char[MaxImagePath];
            uint size = (uint)buffer.Length;
            fixed (char* pointer = buffer)
            {
                if (!PInvoke.QueryFullProcessImageName(process, PROCESS_NAME_FORMAT.PROCESS_NAME_WIN32, new PWSTR(pointer), &size))
                {
                    int error = Marshal.GetLastPInvokeError();
                    return new ProcessLookup(null, error == (int)WIN32_ERROR.ERROR_ACCESS_DENIED);
                }
                string fullPath = new string(pointer, 0, (int)Math.Min(size, (uint)buffer.Length));
                return new ProcessLookup(Path.GetFileName(fullPath), false);
            }
        }
        finally
        {
            PInvoke.CloseHandle(process);
        }
    }

    /// <summary>
    /// processId のプロセスが、このシェルより高い権限（整合性レベル）で動いていれば真、同じか低ければ偽、分からなければ null。
    /// </summary>
    public static bool? IsHigherIntegrityThanSelf(uint processId)
    {
        uint? own = IntegrityOfCurrentProcess();
        if (own is null || processId == 0)
        {
            return null;
        }
        HANDLE process = PInvoke.OpenProcess(PROCESS_ACCESS_RIGHTS.PROCESS_QUERY_LIMITED_INFORMATION, false, processId);
        if (process.IsNull)
        {
            return null;
        }
        try
        {
            uint? other = IntegrityOf(process);
            return other is null ? null : other.Value > own.Value;
        }
        finally
        {
            PInvoke.CloseHandle(process);
        }
    }

    private static uint? IntegrityOfCurrentProcess()
    {
        return IntegrityOf(PInvoke.GetCurrentProcess());
    }

    /// <summary>プロセスのトークンの整合性レベル（SECURITY_MANDATORY_*_RID の値）。読めなければ null</summary>
    private static uint? IntegrityOf(HANDLE process)
    {
        HANDLE token;
        if (!PInvoke.OpenProcessToken(process, TOKEN_ACCESS_MASK.TOKEN_QUERY, &token))
        {
            return null;
        }
        try
        {
            uint needed = 0;
            PInvoke.GetTokenInformation(token, TOKEN_INFORMATION_CLASS.TokenIntegrityLevel, null, 0, &needed);
            if (needed == 0 || needed > 4096)
            {
                return null;
            }
            byte* buffer = stackalloc byte[(int)needed];
            if (!PInvoke.GetTokenInformation(token, TOKEN_INFORMATION_CLASS.TokenIntegrityLevel, buffer, needed, &needed))
            {
                return null;
            }
            var label = (TOKEN_MANDATORY_LABEL*)buffer;
            PSID sid = label->Label.Sid;
            byte* count = PInvoke.GetSidSubAuthorityCount(sid);
            if (count is null || *count == 0)
            {
                return null;
            }
            uint* rid = PInvoke.GetSidSubAuthority(sid, (uint)(*count - 1));
            return rid is null ? null : *rid;
        }
        catch (Exception error)
        {
            Log.Warning("権限の高さを調べられませんでした：" + Log.Describe(error));
            return null;
        }
        finally
        {
            PInvoke.CloseHandle(token);
        }
    }
}
