using System;
using Microsoft.Win32.SafeHandles;
using Windows.Win32;
using Windows.Win32.System.Diagnostics.ToolHelp;

namespace Pip0Shell.Core;

/// <summary>
/// ゴーストを開いたプロセスが pip0 自身（このシェル、または親の pip0 本体）かを判定する。
///
/// cf.fetch の by_pip0 に使います。pip0 自身の読み取りは、ユーザーの利用として数えないためです。
/// 親プロセスの番号は起動時に1回だけ調べます（本体が終わると、シェルも標準入力が閉じて終わります）。
/// </summary>
internal static class Pip0Processes
{
    public static uint OwnId { get; } = (uint)Environment.ProcessId;

    public static uint? ParentId { get; private set; }

    public static void Initialise()
    {
        try
        {
            ParentId = FindParentProcessId(OwnId);
        }
        catch (Exception error)
        {
            ParentId = null;
            Log.Warning("親プロセス（pip0 本体）の番号を調べられませんでした：" + Log.Describe(error));
        }
        if (ParentId is null)
        {
            Log.Warning("親プロセスの番号が分からないため、by_pip0 はシェル自身の読み取りだけを真にします。");
        }
    }

    public static bool IsPip0(uint processId)
    {
        return processId == OwnId || (ParentId is uint parent && processId == parent);
    }

    private static unsafe uint? FindParentProcessId(uint processId)
    {
        using SafeFileHandle snapshot = PInvoke.CreateToolhelp32Snapshot_SafeHandle(
            CREATE_TOOLHELP_SNAPSHOT_FLAGS.TH32CS_SNAPPROCESS, 0);
        if (snapshot.IsInvalid)
        {
            return null;
        }

        var entry = new PROCESSENTRY32 { dwSize = (uint)sizeof(PROCESSENTRY32) };
        if (!PInvoke.Process32First(snapshot, ref entry))
        {
            return null;
        }
        do
        {
            if (entry.th32ProcessID == processId)
            {
                return entry.th32ParentProcessID;
            }
        }
        while (PInvoke.Process32Next(snapshot, ref entry));
        return null;
    }
}
