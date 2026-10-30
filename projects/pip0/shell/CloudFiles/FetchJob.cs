using System;
using System.Diagnostics;
using System.Threading;
using Pip0Shell.Core;
using Windows.Win32.Storage.CloudFilters;

namespace Pip0Shell.CloudFiles;

/// <summary>
/// 1回の FETCH_DATA（ゴーストが開かれて、中身を求められた）の内容。
/// コールバックの引数はコールバックの間だけ有効なので、必要な値をここへ写してから、別のスレッドで処理します。
/// </summary>
internal sealed class FetchJob
{
    private readonly CancellationTokenSource cancellation = new();
    private int cancelledByPlatform;

    private FetchJob()
    {
    }

    public CallbackKeys Keys { get; private init; }

    /// <summary>ゴーストの項目ID（FileIdentity）。読めなければ null</summary>
    public string? ItemId { get; private init; }

    /// <summary>ゴーストの完全なパス（本体へ知らせるだけで、記録には書かない）</summary>
    public string? Path { get; private init; }

    /// <summary>ゴーストの論理サイズ（元のファイルの大きさ）</summary>
    public long FileSize { get; private init; }

    public long RequiredOffset { get; private init; }

    public long RequiredLength { get; private init; }

    public uint? ProcessId { get; private init; }

    public string? ProcessName { get; private init; }

    public long StartedTimestamp { get; private init; }

    public CancellationToken Token => cancellation.Token;

    /// <summary>Windows が CANCEL_FETCH_DATA で取り消した（このときは、もう CfExecute を呼ばない）</summary>
    public bool CancelledByPlatform => Volatile.Read(ref cancelledByPlatform) != 0;

    /// <summary>開いたのが pip0 自身（このシェルか、親の pip0 本体）か</summary>
    public bool ByPip0 => ProcessId is uint id && Pip0Processes.IsPip0(id);

    public double ElapsedMilliseconds => Stopwatch.GetElapsedTime(StartedTimestamp).TotalMilliseconds;

    public void CancelByPlatform()
    {
        Volatile.Write(ref cancelledByPlatform, 1);
        cancellation.Cancel();
    }

    public void CancelForShutdown()
    {
        cancellation.Cancel();
    }

    public static unsafe FetchJob FromCallback(CF_CALLBACK_INFO* info, CF_CALLBACK_PARAMETERS* parameters)
    {
        (uint? processId, string? processName) = CallbackInfoReader.Process(info);
        return new FetchJob
        {
            StartedTimestamp = Stopwatch.GetTimestamp(),
            Keys = CallbackInfoReader.Keys(info),
            ItemId = CallbackInfoReader.ItemId(info),
            Path = CallbackInfoReader.FullPath(info),
            FileSize = info->FileSize,
            RequiredOffset = parameters->Anonymous.FetchData.RequiredFileOffset,
            RequiredLength = parameters->Anonymous.FetchData.RequiredLength,
            ProcessId = processId,
            ProcessName = processName,
        };
    }
}
