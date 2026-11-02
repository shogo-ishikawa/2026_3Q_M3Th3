using System;
using System.Diagnostics;
using System.Text.Json.Nodes;
using System.Threading;
using Pip0Shell.Core;
using Pip0Shell.Ipc;
using Pip0Shell.Ui;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.UI.Accessibility;
using Windows.Win32.UI.WindowsAndMessaging;

namespace Pip0Shell.Context;

/// <summary>
/// 前面のウィンドウ（作業文脈）を見張り、context.foreground を本体へ送る（docs/design.md 4-4）。
///
/// - SetWinEventHook（WINEVENT_OUTOFCONTEXT）で、前面の切り替え（EVENT_SYSTEM_FOREGROUND）と、
///   前面のウィンドウのタイトルの変化（EVENT_OBJECT_NAMECHANGE のうち、OBJID_WINDOW・CHILDID_SELF・前面のウィンドウのもの）を受け取る。
///   タイトルの変化は、前面のアプリのプロセスだけに絞って受け取る（ほかのアプリの大量の知らせを受けないため）。
/// - 続けて起きる知らせは 300ms まとめ（<see cref="Debouncer"/>）、別のスレッドで前面のウィンドウを読んで送る。
///   送る内容：プロセス名、ウィンドウタイトル、種類の名前、ファイルダイアログか（UI Automation）とその位置。
/// - 前と同じ内容なら送らない。pip0 自身のウィンドウが前面のときも送らない（作業文脈は変わっていないため）。
/// - 画面の画像は取得しません。タイトルは記録（ログ）に書きません。
/// </summary>
internal sealed class ForegroundWatcher
{
    /// <summary>知らせをまとめる時間（ミリ秒）</summary>
    public const long QuietMilliseconds = 300;

    /// <summary>知らせが止まらなくても、この時間がたったら送る（ミリ秒）</summary>
    public const long MaxWaitMilliseconds = 1000;

    /// <summary>フックのスレッドへの「タイトルの変化のフックを付け直す」の合図</summary>
    private const uint RehookMessage = PInvoke.WM_APP + 1;

    private readonly ShellOutput output;
    private readonly FeatureReporter features;
    private readonly MessageLoopThread hookThread = new("pip0 foreground hook");
    private readonly Debouncer debouncer = new(QuietMilliseconds, MaxWaitMilliseconds);
    private readonly AutoResetEvent wake = new(false);
    private readonly Stopwatch clock = Stopwatch.StartNew();
    private readonly WINEVENTPROC callback;
    private readonly uint ownProcessId = (uint)Environment.ProcessId;

    // フックのスレッドだけが触る
    private HWINEVENTHOOK foregroundHook;
    private HWINEVENTHOOK nameHook;
    private uint nameHookProcessId;

    // タイトルの変化のフックを付けられているか（null は未確認）。始めた後の変化だけを feature.status で知らせる
    private volatile int titleHookState = TitleHookUnknown;
    private volatile bool reporting;
    private const int TitleHookUnknown = 0;
    private const int TitleHookWorking = 1;
    private const int TitleHookFailed = 2;

    // 送るスレッドだけが触る
    private ForegroundSnapshot? lastSent;
    private bool uiaHealthy;

    private Thread? worker;
    private volatile bool stopping;

    /// <param name="automationAvailable">init のときに UI Automation を使えたか（feature.status の uia の最初の状態）</param>
    public ForegroundWatcher(ShellOutput output, FeatureReporter features, bool automationAvailable)
    {
        this.output = output;
        this.features = features;
        uiaHealthy = automationAvailable;
        // Windows に渡す関数。フックを付けている間に GC に回収されないよう、フィールドで持ち続ける
        callback = OnWinEvent;
    }

    /// <summary>
    /// フックを付け、送るスレッドを始める。前面の切り替えのフックを付けられたら真。
    /// 付けられたときの feature.status（foreground_hook）は、ここで送る（タイトルの変化のフックの状態も含めるため）。
    /// </summary>
    public bool Start(out string reason)
    {
        bool hooked = hookThread.Start(InstallHooks, OnThreadMessage, RemoveHooks, TimeSpan.FromSeconds(10), out reason);
        if (!hooked)
        {
            return false;
        }
        worker = new Thread(WorkerLoop)
        {
            IsBackground = true,
            Name = "pip0 foreground context",
        };
        worker.Start();
        reporting = true;
        ReportTitleHook(titleHookState != TitleHookFailed);
        Signal(); // 始めた時点の前面のウィンドウも知らせる
        return true;
    }

    public void Stop()
    {
        stopping = true;
        wake.Set();
        hookThread.Stop(TimeSpan.FromSeconds(3));
        worker?.Join(TimeSpan.FromSeconds(3));
    }

    // ------------------------------------------------------------------
    // フックのスレッド
    // ------------------------------------------------------------------

    private bool InstallHooks(out string problem)
    {
        foregroundHook = PInvoke.SetWinEventHook(
            PInvoke.EVENT_SYSTEM_FOREGROUND,
            PInvoke.EVENT_SYSTEM_FOREGROUND,
            HMODULE.Null,
            callback,
            0,
            0,
            PInvoke.WINEVENT_OUTOFCONTEXT | PInvoke.WINEVENT_SKIPOWNPROCESS);
        if (foregroundHook.IsNull)
        {
            // SetWinEventHook は失敗の理由（GetLastError）を返さない
            problem = "前面ウィンドウの切り替えを受け取るフック（SetWinEventHook）を付けられませんでした。";
            return false;
        }
        RehookNameChange();
        problem = "";
        return true;
    }

    private void RemoveHooks()
    {
        if (!nameHook.IsNull)
        {
            PInvoke.UnhookWinEvent(nameHook);
            nameHook = default;
        }
        if (!foregroundHook.IsNull)
        {
            PInvoke.UnhookWinEvent(foregroundHook);
            foregroundHook = default;
        }
    }

    private void OnThreadMessage(MSG message)
    {
        if (message.message == RehookMessage)
        {
            RehookNameChange();
        }
    }

    /// <summary>タイトルの変化のフックを、今の前面のアプリのプロセスだけに付け直す</summary>
    private void RehookNameChange()
    {
        HWND foreground = PInvoke.GetForegroundWindow();
        uint processId = foreground.IsNull ? 0 : WindowInfo.GetProcessId(foreground);
        if (processId == nameHookProcessId && !nameHook.IsNull)
        {
            return;
        }
        if (!nameHook.IsNull)
        {
            PInvoke.UnhookWinEvent(nameHook);
            nameHook = default;
        }
        nameHookProcessId = 0;
        if (processId == 0 || processId == ownProcessId)
        {
            return;
        }

        nameHook = PInvoke.SetWinEventHook(
            PInvoke.EVENT_OBJECT_NAMECHANGE,
            PInvoke.EVENT_OBJECT_NAMECHANGE,
            HMODULE.Null,
            callback,
            processId,
            0,
            PInvoke.WINEVENT_OUTOFCONTEXT);
        if (nameHook.IsNull)
        {
            SetTitleHookState(TitleHookFailed);
            return;
        }
        nameHookProcessId = processId;
        SetTitleHookState(TitleHookWorking);
    }

    /// <summary>タイトルの変化のフックの状態が変わったときだけ、feature.status で知らせる（始めた後）</summary>
    private void SetTitleHookState(int state)
    {
        int previous = titleHookState;
        titleHookState = state;
        if (previous == state || !reporting)
        {
            return;
        }
        if (state == TitleHookFailed)
        {
            Log.Warning("タイトルの変化を受け取るフックを付けられませんでした。");
        }
        ReportTitleHook(state == TitleHookWorking);
    }

    private void ReportTitleHook(bool titleChangesAvailable)
    {
        features.Report(
            FeatureReporter.ForegroundHook,
            titleChangesAvailable,
            titleChangesAvailable
                ? "前面のアプリの切り替えとタイトルの変化を受け取ります（画面の画像は取得しません）。"
                : "前面のアプリの切り替えは受け取れますが、タイトルの変化（Slack の会話の切り替え等）を受け取るフックを付けられません。");
    }

    /// <summary>Windows から呼ばれる。ここでは合図をするだけで、すぐに戻る（例外を外へ出さない）</summary>
    private void OnWinEvent(HWINEVENTHOOK hook, uint winEvent, HWND hwnd, int idObject, int idChild, uint eventThread, uint eventTime)
    {
        try
        {
            if (winEvent == PInvoke.EVENT_SYSTEM_FOREGROUND)
            {
                hookThread.Post(RehookMessage);
                Signal();
                return;
            }
            if (winEvent == PInvoke.EVENT_OBJECT_NAMECHANGE
                && idObject == (int)OBJECT_IDENTIFIER.OBJID_WINDOW
                && idChild == (int)PInvoke.CHILDID_SELF
                && hwnd == PInvoke.GetForegroundWindow())
            {
                Signal();
            }
        }
        catch (Exception)
        {
            // フックの中の失敗で、ほかの機能を止めない
        }
    }

    private void Signal()
    {
        debouncer.Signal(clock.ElapsedMilliseconds);
        wake.Set();
    }

    // ------------------------------------------------------------------
    // 送るスレッド（UI Automation を使うので、フックや画面のスレッドとは別にする）
    // ------------------------------------------------------------------

    private void WorkerLoop()
    {
        while (!stopping)
        {
            long? due = debouncer.DueAt();
            long now = clock.ElapsedMilliseconds;
            int wait = due is null ? Timeout.Infinite : (int)Math.Clamp(due.Value - now, 0, int.MaxValue);
            if (wait != 0)
            {
                wake.WaitOne(wait);
            }
            if (stopping)
            {
                break;
            }
            if (debouncer.TryFire(clock.ElapsedMilliseconds))
            {
                try
                {
                    CaptureAndSend();
                }
                catch (Exception error)
                {
                    Log.Error("前面のウィンドウを読めませんでした：" + Log.Describe(error));
                }
            }
        }
    }

    private void CaptureAndSend()
    {
        HWND foreground = PInvoke.GetForegroundWindow();
        if (foreground.IsNull)
        {
            return; // 切り替えの途中など、前面のウィンドウがない
        }
        uint processId = WindowInfo.GetProcessId(foreground);
        if (processId == ownProcessId)
        {
            return;
        }

        ProcessLookup process = ProcessInfo.Lookup(processId);
        string title = WindowInfo.GetTitle(foreground);
        string className = WindowInfo.GetClassName(foreground);
        DialogProbe dialog = DialogProbe.NotDialog;
        if (string.Equals(className, FileDialogAutomation.DialogClassName, StringComparison.Ordinal))
        {
            // UI Automation を使うのはダイアログのときだけ。使ったときだけ、動いたかを確かめる
            dialog = FileDialogAutomation.ProbeDialog(foreground);
            ReportAutomationHealth(!dialog.AutomationBroken);
        }

        var snapshot = new ForegroundSnapshot(
            WindowInfo.ToNumber(foreground),
            process.Name,
            title,
            className,
            dialog.IsFileDialog,
            dialog.Rect,
            process.AccessDenied || dialog.AccessDenied);
        if (snapshot == lastSent)
        {
            return;
        }
        lastSent = snapshot;

        var payload = new JsonObject
        {
            ["hwnd"] = snapshot.Hwnd,
            ["process_name"] = snapshot.ProcessName,
            ["window_title"] = snapshot.Title,
            ["window_class"] = snapshot.ClassName,
            ["is_file_dialog"] = snapshot.IsFileDialog,
            ["dialog_rect"] = snapshot.DialogRect is PixelRect rect ? WindowInfo.RectToJson(rect) : null,
            ["inaccessible"] = snapshot.Inaccessible,
            ["at"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0,
        };
        if (snapshot.Inaccessible)
        {
            payload["reason"] = process.AccessDenied
                ? "前面のアプリのプロセスを調べる権限がありません（管理者として動くアプリ等）。"
                : "前面のダイアログの中を調べる権限がありません（管理者として動くアプリ等）。";
        }
        output.SendEvent("context.foreground", payload);
    }

    /// <summary>UI Automation が動かなくなった・戻ったときだけ、feature.status で知らせる</summary>
    private void ReportAutomationHealth(bool healthy)
    {
        if (healthy == uiaHealthy)
        {
            return;
        }
        uiaHealthy = healthy;
        features.Report(
            FeatureReporter.Uia,
            healthy,
            healthy
                ? "UI Automation でファイルダイアログを見分けられるようになりました。"
                : "UI Automation でダイアログの中を調べられませんでした。ファイルダイアログを見分けられません。");
    }

    /// <summary>送った内容（同じ内容を続けて送らないために比べる）</summary>
    private sealed record ForegroundSnapshot(
        long Hwnd,
        string? ProcessName,
        string Title,
        string ClassName,
        bool IsFileDialog,
        PixelRect? DialogRect,
        bool Inaccessible);
}
