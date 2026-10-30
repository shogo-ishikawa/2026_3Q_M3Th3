using System;
using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using System.Threading;
using Pip0Shell.Context;
using Pip0Shell.Core;
using Pip0Shell.Ipc;
using Pip0Shell.Ui;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.UI.WindowsAndMessaging;

namespace Pip0Shell.Input;

/// <summary>
/// マウスのフックの出来事から、ファイルのドラッグを見つけて本体へ知らせる（M5。docs/design.md 4-7）。
///
/// 1. 左ボタンを押したら、その位置のウィンドウ（いちばん外側のウィンドウとプロセス）を覚える。
/// 2. 押したまま SM_CXDRAG / SM_CYDRAG を超えて動いたら、ドラッグの始まり（<see cref="DragTracker"/>）。
///    - 押した位置が explorer.exe のフォルダー表示（SHELLDLL_DefView の中。デスクトップを含む）なら、
///      エクスプローラーで選ばれている項目を読み（<see cref="ExplorerSelection"/>）、drag.started（source "explorer"）を送る。
///    - 押した位置が pip0 のデスクの候補なら、その候補のファイルで drag.started（source "pip0"）を送る。
///    - それ以外（ほかのアプリ、タイトルバー、タスクバー等）からのドラッグは、ファイルを特定できないため知らせない。
/// 3. ドラッグ中に、マウスの下のアプリ（プロセス）が変わったら drag.target_changed を送る（30ms に1回まで調べる）。
/// 4. ボタンを離したら drag.ended。dropped_on_other_process は、離した位置のプロセスがドラッグ元と違うとき真。
///    送り先がドロップを受け入れたかは、Windows から取得できないため確かめていません。
///
/// フックの関数は列に入れるだけで、ここ（専用のスレッド）が順番に処理します。
/// </summary>
internal sealed class DragMonitor
{
    private const string ExplorerProcessName = "explorer.exe";
    private const string FolderViewClassName = "SHELLDLL_DefView";
    private const long TargetCheckIntervalMs = 30;
    private const int DeskPressRetries = 4;
    private const int DeskPressRetryMs = 50;
    private static readonly TimeSpan SelectionTimeout = TimeSpan.FromMilliseconds(2500);

    private readonly ShellOutput output;
    private readonly ExplorerSelection? explorer;
    private readonly string explorerUnavailableReason;
    private readonly DeskPressRecorder deskPresses;
    private readonly ConcurrentQueue<MouseEventRecord> queue = new();
    private readonly AutoResetEvent wake = new(false);
    private readonly uint ownProcessId = (uint)Environment.ProcessId;
    private DragTracker tracker = new(4, 4);
    private Thread? thread;
    private volatile bool stopping;

    // 押したときに覚えたこと
    private PressInfo? press;

    // 知らせているドラッグ（知らせないドラッグでは null）
    private ActiveDrag? active;

    /// <param name="explorer">エクスプローラーの選択項目を読む部品。使えなければ null（理由は explorerUnavailableReason）</param>
    public DragMonitor(ShellOutput output, ExplorerSelection? explorer, string explorerUnavailableReason, DeskPressRecorder deskPresses)
    {
        this.output = output;
        this.explorer = explorer;
        this.explorerUnavailableReason = explorerUnavailableReason;
        this.deskPresses = deskPresses;
    }

    public void Start()
    {
        // Windows の「ドラッグとみなす距離」。読めなければ Windows の初期値（4 ピクセル）
        int dragX = PInvoke.GetSystemMetrics(SYSTEM_METRICS_INDEX.SM_CXDRAG);
        int dragY = PInvoke.GetSystemMetrics(SYSTEM_METRICS_INDEX.SM_CYDRAG);
        tracker = new DragTracker(dragX > 0 ? dragX : 4, dragY > 0 ? dragY : 4);

        thread = new Thread(Run)
        {
            IsBackground = true,
            Name = "pip0 drag monitor",
        };
        thread.Start();
    }

    public void Stop()
    {
        stopping = true;
        wake.Set();
        thread?.Join(TimeSpan.FromSeconds(3));
    }

    /// <summary>フックの関数から呼ばれる。列に入れて合図するだけ</summary>
    public void Enqueue(MouseEventRecord record)
    {
        queue.Enqueue(record);
        wake.Set();
    }

    private void Run()
    {
        while (!stopping)
        {
            wake.WaitOne();
            while (!stopping && queue.TryDequeue(out MouseEventRecord record))
            {
                try
                {
                    Process(record);
                }
                catch (Exception error)
                {
                    Log.Error("ドラッグの判定でエラーが起きました：" + Log.Describe(error));
                    active = null;
                    tracker.Abandon();
                }
            }
        }
    }

    private void Process(MouseEventRecord record)
    {
        switch (record.Kind)
        {
            case MouseEventKind.LeftDown:
                tracker.OnButtonDown(record.Point, out bool abandoned);
                if (abandoned)
                {
                    EndUnconfirmed();
                }
                press = CapturePress(record.Point);
                break;

            case MouseEventKind.Move:
                DragStepKind step = tracker.OnMove(record.Point);
                if (step == DragStepKind.Started)
                {
                    BeginDrag(record);
                }
                else if (step == DragStepKind.Moved)
                {
                    TrackTarget(record);
                }
                break;

            case MouseEventKind.LeftUp:
                if (tracker.OnButtonUp(record.Point) == DragStepKind.Ended)
                {
                    EndDrag(record.Point);
                }
                press = null;
                break;

            case MouseEventKind.HookReset:
                if (tracker.Abandon())
                {
                    EndUnconfirmed();
                }
                press = null;
                break;
        }
    }

    /// <summary>押した位置のウィンドウを覚える（ここでは名前やファイルは調べない。軽い処理だけ）</summary>
    private static PressInfo CapturePress(PixelPoint point)
    {
        HWND pointed = WindowInfo.FromPoint(point);
        HWND root = WindowInfo.GetRoot(pointed);
        uint processId = WindowInfo.GetAppProcessId(pointed, root);
        return new PressInfo(point, pointed, root, processId, Environment.TickCount64);
    }

    private void BeginDrag(MouseEventRecord record)
    {
        active = null;
        if (press is not PressInfo source || source.ProcessId == 0)
        {
            return;
        }

        string dragId = Guid.NewGuid().ToString("N");
        if (source.ProcessId == ownProcessId)
        {
            // pip0 のデスクの候補からのドラッグか（画面のスレッドが押したことを記録するのは、フックより少し後なので、少しだけ待つ）
            string? path = deskPresses.Find(source.Point, Environment.TickCount64);
            for (int retry = 0; path is null && retry < DeskPressRetries; retry++)
            {
                Thread.Sleep(DeskPressRetryMs);
                path = deskPresses.Find(source.Point, Environment.TickCount64);
            }
            if (path is null)
            {
                return;
            }
            string? ownName = ProcessInfo.Lookup(ownProcessId).Name;
            active = new ActiveDrag(dragId, source.ProcessId, source.ProcessId);
            SendStarted(dragId, ownName, "pip0", new[] { path }, true, 0, "");
            return;
        }

        ProcessLookup sourceProcess = ProcessInfo.Lookup(source.ProcessId);
        if (!string.Equals(sourceProcess.Name, ExplorerProcessName, StringComparison.OrdinalIgnoreCase))
        {
            return; // ほかのアプリからのドラッグは、ファイルを特定できないため知らせない
        }
        HWND folderView = WindowInfo.FindSelfOrAncestor(source.Pointed, FolderViewClassName);
        if (folderView.IsNull)
        {
            return; // タイトルバー・タスクバー・ナビゲーション ウィンドウなど、フォルダー表示の外
        }

        string rootClass = WindowInfo.GetClassName(source.Root);
        bool desktop = rootClass is "Progman" or "WorkerW";
        SelectionResult selection = explorer is null
            ? SelectionResult.Unavailable(explorerUnavailableReason)
            : explorer.Query((IntPtr)source.Root, (IntPtr)source.Pointed, desktop, SelectionTimeout);

        active = new ActiveDrag(dragId, source.ProcessId, source.ProcessId);
        SendStarted(dragId, sourceProcess.Name, "explorer", selection.Paths, selection.Ok, selection.Unidentified, selection.Reason);
    }

    private void SendStarted(string dragId, string? sourceProcess, string source, System.Collections.Generic.IReadOnlyList<string> paths, bool ok, int unidentified, string reason)
    {
        var items = new JsonArray();
        foreach (string path in paths)
        {
            items.Add(path);
        }
        output.SendEvent("drag.started", new JsonObject
        {
            ["drag_id"] = dragId,
            ["source_process"] = sourceProcess,
            ["source"] = source,
            ["items"] = items,
            ["items_status"] = ok ? "ok" : "unavailable",
            ["reason"] = reason,
            ["unidentified_count"] = unidentified,
            ["at"] = Now(),
        });
        Log.Info("ドラッグの始まりを知らせました（" + source + "、" + paths.Count + " 件、" + (ok ? "読めた" : "読めなかった") + "）。");
    }

    /// <summary>ドラッグ中に、マウスの下のプロセスが変わったら知らせる</summary>
    private void TrackTarget(MouseEventRecord record)
    {
        if (active is not ActiveDrag drag || record.TickMs - drag.LastTargetCheckMs < TargetCheckIntervalMs)
        {
            return;
        }
        drag.LastTargetCheckMs = record.TickMs;
        uint processId = ProcessUnder(record.Point);
        if (processId == drag.TargetProcessId)
        {
            return;
        }
        drag.TargetProcessId = processId;
        output.SendEvent("drag.target_changed", new JsonObject
        {
            ["drag_id"] = drag.DragId,
            ["target_process"] = processId == 0 ? null : ProcessInfo.Lookup(processId).Name,
            ["at"] = Now(),
        });
    }

    private void EndDrag(PixelPoint point)
    {
        if (active is not ActiveDrag drag)
        {
            return;
        }
        active = null;
        uint processId = ProcessUnder(point);
        output.SendEvent("drag.ended", new JsonObject
        {
            ["drag_id"] = drag.DragId,
            ["target_process"] = processId == 0 ? null : ProcessInfo.Lookup(processId).Name,
            ["dropped_on_other_process"] = processId != 0 && processId != drag.SourceProcessId,
            ["at"] = Now(),
        });
    }

    /// <summary>ボタンを離したことを確かめられないまま終わったドラッグ（フックの付け直し等）を閉じる</summary>
    private void EndUnconfirmed()
    {
        if (active is not ActiveDrag drag)
        {
            return;
        }
        active = null;
        output.SendEvent("drag.ended", new JsonObject
        {
            ["drag_id"] = drag.DragId,
            ["target_process"] = null,
            ["dropped_on_other_process"] = false,
            ["reason"] = "ボタンを離したことを確かめられませんでした（マウスのフックが外れた可能性があります）。",
            ["at"] = Now(),
        });
    }

    /// <summary>点の下のアプリのプロセス（ストアのアプリも、アプリごとに見分ける。WindowInfo.GetAppProcessId）</summary>
    private static uint ProcessUnder(PixelPoint point)
    {
        HWND pointed = WindowInfo.FromPoint(point);
        return WindowInfo.GetAppProcessId(pointed, WindowInfo.GetRoot(pointed));
    }

    private static double Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0;

    /// <summary>ボタンを押したときに覚えたこと</summary>
    private readonly record struct PressInfo(PixelPoint Point, HWND Pointed, HWND Root, uint ProcessId, long TickMs);

    /// <summary>知らせているドラッグ</summary>
    private sealed class ActiveDrag
    {
        public ActiveDrag(string dragId, uint sourceProcessId, uint targetProcessId)
        {
            DragId = dragId;
            SourceProcessId = sourceProcessId;
            TargetProcessId = targetProcessId;
        }

        public string DragId { get; }

        public uint SourceProcessId { get; }

        public uint TargetProcessId { get; set; }

        public long LastTargetCheckMs { get; set; }
    }
}
