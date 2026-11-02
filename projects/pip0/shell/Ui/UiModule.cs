using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading;
using System.Windows;
using System.Windows.Threading;
using Pip0Shell.CloudFiles;
using Pip0Shell.Context;
using Pip0Shell.Core;
using Pip0Shell.Input;
using Pip0Shell.Ipc;

namespace Pip0Shell.Ui;

/// <summary>
/// 常駐UI・入力・作業文脈の入口。WPF の Application と、その画面のスレッド（STA、Dispatcher）を持ちます。
///
/// - <see cref="RegisterHandlers"/>：本体から届く ui.*・shell.cursor_stream の知らせと、
///   shell.fill_file_dialog・shell.open_file・shell.reveal_file の要求を登録する。
/// - <see cref="Start"/>：init で画面ありと決まったときに、画面のスレッドを作り、通知領域アイコンを出す。
/// - <see cref="StartObservers"/>：同じく画面ありのときに、OS の見張り（前面ウィンドウ、マウスのフックとドラッグ、
///   セッション、最近使ったファイル）を始め、それぞれの状態を feature.status で知らせる。1つが失敗しても、ほかは動かす。
/// - <see cref="Invoke{T}"/>、<see cref="Post"/>：ほかの部品（ごみ箱の確認画面など）が、画面のスレッドで処理するときに使う。
/// - <see cref="Stop"/>：終了のとき。見張りを止め、開いている画面を閉じ（確認画面の答えは "closed"）、アイコンを消す。
///
/// 何を表示するか・いつ閉じるかは本体が決めます。ここは届いた内容を画面に出し、起きたことを知らせるだけです。
/// 知らせ（event）は受信のスレッドで呼ばれるので、payload を読んだら、画面の処理は <see cref="Post"/> で画面のスレッドへ渡します。
/// </summary>
internal sealed class UiModule
{
    private readonly ShellOutput output;
    private readonly FeatureReporter features;
    private readonly ManualResetEventSlim ready = new(false);
    private readonly DeskPressRecorder deskPresses = new();
    private readonly HashSet<string> loggedWithoutUi = new(StringComparer.Ordinal);
    private Thread? thread;
    private Application? application;
    private Dispatcher? dispatcher;
    private string? startFailure;
    private volatile bool running;
    private volatile bool interactive;

    // 画面のスレッドだけが触る
    private TrayIcon? tray;
    private MiniDockWindow? miniDock;
    private DeskWindow? desk;
    private readonly List<HazardBorderWindow> hazards = new();
    private StatusWindow? statusWindow;
    private ConfirmResumeWindow? confirmResume;
    private StatusText latestStatus = StatusText.Waiting;

    // OS の見張り（StartObservers で作り、Stop で止める）
    private ForegroundWatcher? foreground;
    private ExplorerSelection? explorer;
    private DragMonitor? drags;
    private MouseHook? mouseHook;
    private CursorSampler? cursor;
    private SessionEventsWatcher? sessions;
    private RecentItemsWatcher? recent;

    public UiModule(ShellOutput output, FeatureReporter features)
    {
        this.output = output;
        this.features = features;
    }

    /// <summary>画面のスレッドが動いているか（表示なしのときは偽）</summary>
    public bool IsRunning => running;

    /// <summary>init で受け取った画面の設定</summary>
    public ShellSettings Settings { get; private set; } = new();

    /// <summary>本体から届く知らせと要求を登録する（受信を始める前に呼ぶ）</summary>
    public void RegisterHandlers(MessageRouter router)
    {
        router.AddEvent("ui.notify", HandleNotify);
        router.AddEvent("ui.status", HandleStatus);
        router.AddEvent("ui.mini_dock.show", HandleMiniDockShow);
        router.AddEvent("ui.mini_dock.close", HandleMiniDockClose);
        router.AddEvent("ui.desk.show", HandleDeskShow);
        router.AddEvent("ui.desk.hide", HandleDeskHide);
        router.AddEvent("ui.hazard.show", HandleHazardShow);
        router.AddEvent("ui.hazard.hide", HandleHazardHide);
        router.AddEvent("shell.cursor_stream", HandleCursorStream);
        router.AddRequest("shell.fill_file_dialog", HandleFillFileDialog);
        router.AddRequest("shell.open_file", HandleOpenFile);
        router.AddRequest("shell.reveal_file", HandleRevealFile);
    }

    // ------------------------------------------------------------------
    // 始めると止める
    // ------------------------------------------------------------------

    /// <summary>画面のスレッドを作り、通知領域アイコンを出す。準備できたら真</summary>
    public bool Start(SessionConfiguration configuration, out string reason)
    {
        interactive = !configuration.Headless;
        if (thread is not null)
        {
            reason = running ? "" : "画面はすでに止まっています。";
            return running;
        }
        Settings = configuration.Settings;
        thread = new Thread(UiThreadMain)
        {
            IsBackground = true,
            Name = "pip0 UI",
        };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();

        if (!ready.Wait(TimeSpan.FromSeconds(15)))
        {
            reason = "画面の準備が時間内に終わりませんでした。";
            return false;
        }
        if (startFailure is not null)
        {
            reason = startFailure;
            return false;
        }
        running = true;
        reason = "";
        return true;
    }

    /// <summary>
    /// OS の見張りを始め、それぞれの状態を feature.status で知らせる。
    /// 前面ウィンドウのフックとマウスのフックの両方を付けられたら真（init の capabilities.hooks）。
    /// </summary>
    public bool StartObservers(SessionConfiguration configuration)
    {
        interactive = !configuration.Headless;

        // 1. UI Automation（ファイルダイアログの判定と入力）
        bool uiaOk = FileDialogAutomation.Probe(out string uiaReason);
        features.Report(
            FeatureReporter.Uia,
            uiaOk,
            uiaOk ? "UI Automation でファイルダイアログを見分け、ファイル名欄に入力できます（管理者として動くアプリのダイアログを除く）。" : uiaReason);

        // 2. 前面ウィンドウ（作業文脈）。付けられたときの feature.status は ForegroundWatcher が送る
        var watcher = new ForegroundWatcher(output, features, uiaOk);
        bool foregroundOk = watcher.Start(out string foregroundReason);
        foreground = foregroundOk ? watcher : null;
        if (!foregroundOk)
        {
            features.Report(FeatureReporter.ForegroundHook, false, foregroundReason);
        }

        // 3. エクスプローラーの選択項目（ドラッグのファイルを知るため）。
        //    準備の確認に失敗しても（エクスプローラーの再起動中など）、部品は止めずにドラッグのたびに読み直し、
        //    読めたら「使える」に戻す
        const string explorerWorking = "ドラッグの始まりに、エクスプローラー（デスクトップを含む）で選ばれている項目を読みます。";
        var selection = new ExplorerSelection(() => features.Report(FeatureReporter.ExplorerSelection, true, explorerWorking));
        bool explorerOk = selection.Start(out string explorerReason);
        explorer = selection;
        if (!explorerOk)
        {
            explorerReason = "エクスプローラーの選択項目を読めません：" + explorerReason + "（ドラッグのたびに読み直します）";
        }
        features.Report(FeatureReporter.ExplorerSelection, explorerOk, explorerOk ? explorerWorking : explorerReason);

        // 4. マウスのフックとドラッグの判定
        var monitor = new DragMonitor(output, explorer, explorerReason, deskPresses);
        monitor.Start();
        var hook = new MouseHook(monitor.Enqueue, features);
        bool mouseOk = hook.Start(out string mouseReason);
        if (mouseOk)
        {
            drags = monitor;
            mouseHook = hook;
        }
        else
        {
            monitor.Stop();
        }
        features.Report(
            FeatureReporter.MouseHook,
            mouseOk,
            mouseOk ? "左ボタンのドラッグを検知します（エクスプローラーと pip0 のデスクからのドラッグだけを知らせます）。" : mouseReason);

        // 5. マウスの位置（シェイクの判定。送るのは本体が shell.cursor_stream で頼んだ間だけ）
        cursor = new CursorSampler(output, features);
        bool cursorOk = CursorSampler.Probe(out string cursorReason);
        features.Report(
            FeatureReporter.CursorSampler,
            cursorOk,
            cursorOk ? "デスクの表示中だけ、本体の指示でマウスの位置を送ります。" : cursorReason);

        // 6. 画面のロック・スリープ等
        var sessionWatcher = new SessionEventsWatcher(output);
        bool sessionsOk = sessionWatcher.Start(out string sessionsReason);
        sessions = sessionsOk ? sessionWatcher : null;
        features.Report(
            FeatureReporter.SessionEvents,
            sessionsOk,
            sessionsOk ? "画面のロック・サインアウト・スリープ・シャットダウンを知らせます。" : sessionsReason);

        // 7. 最近使ったファイル（読み終えてから、feature.status と usage.recent_items で知らせる）
        recent = new RecentItemsWatcher(output, features);
        recent.Start(configuration.WatchedRoots);

        return foregroundOk && mouseOk;
    }

    /// <summary>画面のスレッドで function を実行し、その結果を返す（終わるまで待つ）。画面がなければ例外</summary>
    public T Invoke<T>(Func<T> function)
    {
        Dispatcher? current = dispatcher;
        if (!running || current is null)
        {
            throw new InvalidOperationException("画面が動いていません。");
        }
        return current.Invoke(function);
    }

    /// <summary>画面のスレッドで action を実行するよう頼む（待たない）。画面がなければ何もしない</summary>
    public void Post(Action action)
    {
        Dispatcher? current = dispatcher;
        if (running && current is not null)
        {
            current.BeginInvoke(action);
        }
    }

    /// <summary>見張りを止め、開いている画面を閉じ、アイコンを消し、画面のスレッドを終える</summary>
    public void Stop()
    {
        StopObservers();
        if (!running)
        {
            return;
        }
        running = false;
        Dispatcher? current = dispatcher;
        if (current is null)
        {
            return;
        }

        try
        {
            // 1. 開いている画面（確認画面など）を閉じる。確認画面の答えは "closed" になり、何も削除されない
            current.Invoke(CloseAllWindows, DispatcherPriority.Send, CancellationToken.None, TimeSpan.FromSeconds(5));
            // 2. アイコンを消して、画面の処理を終える
            current.Invoke(
                () =>
                {
                    tray?.Dispose();
                    tray = null;
                    application?.Shutdown();
                },
                DispatcherPriority.Send,
                CancellationToken.None,
                TimeSpan.FromSeconds(5));
        }
        catch (Exception error)
        {
            Log.Warning("画面を閉じる処理で問題が起きました：" + Log.Describe(error));
        }
        thread?.Join(TimeSpan.FromSeconds(5));
    }

    private void StopObservers()
    {
        // 入口に近いものから止める（フック → ドラッグの判定 → エクスプローラーの問い合わせ）
        TryStop("マウスの位置", () => cursor?.Stop());
        TryStop("マウスのフック", () => mouseHook?.Stop());
        TryStop("ドラッグの判定", () => drags?.Stop());
        TryStop("エクスプローラーの問い合わせ", () => explorer?.Stop());
        TryStop("前面ウィンドウの見張り", () => foreground?.Stop());
        TryStop("セッションの見張り", () => sessions?.Stop());
        TryStop("最近使ったファイルの見張り", () => recent?.Stop());
        cursor = null;
        mouseHook = null;
        drags = null;
        explorer = null;
        foreground = null;
        sessions = null;
        recent = null;
    }

    private static void TryStop(string what, Action stop)
    {
        try
        {
            stop();
        }
        catch (Exception error)
        {
            Log.Warning(what + "を止める処理で問題が起きました：" + Log.Describe(error));
        }
    }

    private void UiThreadMain()
    {
        try
        {
            System.Windows.Forms.Application.EnableVisualStyles();
            application = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
            dispatcher = application.Dispatcher;
            dispatcher.UnhandledException += OnUnhandledException;
            // WPF の画面のスレッドで、Windows Forms のメニュー（通知領域アイコン）のキー操作も動くようにする
            System.Windows.Forms.Integration.WindowsFormsHost.EnableWindowsFormsInterop();
            tray = new TrayIcon(output, OpenStatusWindow, ConfirmResume);
            tray.Show();
        }
        catch (Exception error)
        {
            startFailure = "画面を準備できませんでした（" + error.GetType().Name + "）。";
            Log.Error("画面を準備できませんでした：" + Log.Describe(error));
            ready.Set();
            return;
        }

        ready.Set();
        try
        {
            application.Run();
        }
        catch (Exception error)
        {
            running = false;
            Log.Error("画面の処理が止まりました：" + Log.Describe(error));
        }
    }

    private void CloseAllWindows()
    {
        if (application is null)
        {
            return;
        }
        foreach (Window window in application.Windows.Cast<Window>().ToList())
        {
            try
            {
                window.Close();
            }
            catch (InvalidOperationException)
            {
                // すでに閉じかけている
            }
        }
    }

    private static void OnUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        // 画面の1つの処理の失敗で、シェル全体（ゴーストの中身を渡す処理など）を止めないようにする
        Log.Error("画面の処理で予期しないエラーが起きました：" + Log.Describe(e.Exception));
        e.Handled = true;
    }

    // ------------------------------------------------------------------
    // 本体から届く知らせ（受信のスレッドで呼ばれるので、画面のスレッドへ渡す）
    // ------------------------------------------------------------------

    /// <summary>ui.notify：{"title", "message", "level": "info"/"warning"/"error"}。通知領域アイコンの吹き出し</summary>
    private void HandleNotify(Payload payload)
    {
        if (!UiAvailable("ui.notify"))
        {
            return;
        }
        string title = payload.GetString("title") ?? "pip0";
        string message = payload.GetString("message") ?? "";
        string level = payload.GetString("level") ?? "info";
        Post(() => tray?.ShowNotification(title, message, level));
    }

    /// <summary>ui.status：アイコンの説明と、状態の画面の文</summary>
    private void HandleStatus(Payload payload)
    {
        if (!UiAvailable("ui.status"))
        {
            return;
        }
        StatusText status = StatusText.Parse(payload);
        Post(() =>
        {
            latestStatus = status;
            tray?.ShowStatus(status);
            statusWindow?.ShowStatus(status);
        });
    }

    /// <summary>ui.mini_dock.show：行を置き換えて、ミニドックを出す</summary>
    private void HandleMiniDockShow(Payload payload)
    {
        if (!UiAvailable("ui.mini_dock.show"))
        {
            return;
        }
        MiniDockContent? content = MiniDockContent.Parse(payload, out string problem, out int skipped);
        if (content is null)
        {
            Log.Warning("ui.mini_dock.show の形が違うため、表示しませんでした：" + problem);
            return;
        }
        if (skipped > 0)
        {
            Log.Warning("ミニドックの行のうち " + skipped + " 件は、形が違うか多すぎるため表示しませんでした。");
        }
        Post(() =>
        {
            miniDock ??= new MiniDockWindow(output);
            miniDock.ShowContent(content);
        });
    }

    /// <summary>ui.mini_dock.close：{"dock_id", "reason"}。表示中のものと dock_id が同じときだけ閉じる</summary>
    private void HandleMiniDockClose(Payload payload)
    {
        if (!UiAvailable("ui.mini_dock.close"))
        {
            return;
        }
        EchoId? dockId = payload.GetEchoId("dock_id");
        Post(() =>
        {
            if (miniDock is not null && (dockId is null || miniDock.DockId == dockId.Value))
            {
                miniDock.HideDock();
            }
        });
    }

    /// <summary>ui.desk.show：候補を置き換えて、デスクを出す</summary>
    private void HandleDeskShow(Payload payload)
    {
        if (!UiAvailable("ui.desk.show"))
        {
            return;
        }
        DeskContent content = DeskContent.Parse(payload, out int skipped);
        if (skipped > 0)
        {
            Log.Warning("デスクの候補のうち " + skipped + " 件は、形が違うか多すぎるため表示しませんでした。");
        }
        Post(() =>
        {
            desk ??= new DeskWindow(output, Settings, deskPresses);
            desk.ShowContent(content);
        });
    }

    /// <summary>ui.desk.hide：{"reason"}。デスクを隠す</summary>
    private void HandleDeskHide(Payload payload)
    {
        if (!UiAvailable("ui.desk.hide"))
        {
            return;
        }
        Post(() => desk?.HideDesk());
    }

    /// <summary>ui.hazard.show：すべての画面の縁を光らせる</summary>
    private void HandleHazardShow(Payload payload)
    {
        if (!UiAvailable("ui.hazard.show"))
        {
            return;
        }
        HazardContent hazard = HazardContent.Parse(payload, out bool unknownLevel);
        if (unknownLevel)
        {
            Log.Warning("ui.hazard.show の level が知らない値のため、橙（機密か未判定）で表示します。");
        }
        Post(() => ShowHazard(hazard));
    }

    /// <summary>ui.hazard.hide：枠を消す</summary>
    private void HandleHazardHide(Payload payload)
    {
        if (!UiAvailable("ui.hazard.hide"))
        {
            return;
        }
        Post(() =>
        {
            foreach (HazardBorderWindow window in hazards)
            {
                window.Hide();
            }
        });
    }

    /// <summary>shell.cursor_stream：{"enabled": bool}。マウスの位置を送り始める・止める</summary>
    private void HandleCursorStream(Payload payload)
    {
        CursorSampler? sampler = cursor;
        if (sampler is null)
        {
            LogOnce("shell.cursor_stream", "マウスの位置を送る部品がない（表示なし等）ため、shell.cursor_stream を無視しました。");
            return;
        }
        if (payload.GetBoolean("enabled") == true)
        {
            sampler.Start(Settings.CursorSampleMs, Settings.CursorBatchMs);
        }
        else
        {
            sampler.Stop();
        }
    }

    // ------------------------------------------------------------------
    // 本体からの要求（専用のスレッドで呼ばれる）
    // ------------------------------------------------------------------

    /// <summary>shell.fill_file_dialog：{"dialog_hwnd", "path"} → {"ok", "reason"}</summary>
    private RequestResult HandleFillFileDialog(Payload payload, CancellationToken shutdown)
    {
        long? hwnd = payload.GetInt64("dialog_hwnd");
        if (hwnd is null || hwnd.Value == 0)
        {
            return RequestResult.BadRequest("dialog_hwnd（ダイアログのウィンドウの番号）が必要です。");
        }
        if (!TryReadFilePath(payload, out string path, out RequestResult? bad))
        {
            return bad;
        }
        if (!interactive)
        {
            return Answer(false, "表示なし（headless）で動いているため、ダイアログに入力しません。");
        }
        FillOutcome outcome = FileDialogAutomation.Fill(WindowInfo.FromNumber(hwnd.Value), path);
        return Answer(outcome.Ok, outcome.Reason);
    }

    /// <summary>shell.open_file：{"path"} → {"ok", "reason"}（既定のアプリで開く）</summary>
    private RequestResult HandleOpenFile(Payload payload, CancellationToken shutdown)
    {
        if (!TryReadFilePath(payload, out string path, out RequestResult? bad))
        {
            return bad;
        }
        if (!interactive)
        {
            return Answer(false, "表示なし（headless）で動いているため、ファイルを開きません。");
        }
        return RequestResult.Success(FileActions.Open(path));
    }

    /// <summary>shell.reveal_file：{"path"} → {"ok", "reason"}（エクスプローラーで場所を開く）</summary>
    private RequestResult HandleRevealFile(Payload payload, CancellationToken shutdown)
    {
        if (!TryReadFilePath(payload, out string path, out RequestResult? bad))
        {
            return bad;
        }
        if (!interactive)
        {
            return Answer(false, "表示なし（headless）で動いているため、場所を開きません。");
        }
        return RequestResult.Success(FileActions.Reveal(path));
    }

    /// <summary>path が Windows の絶対パスで、ワイルドカード等の使えない文字を含まないこと</summary>
    private static bool TryReadFilePath(Payload payload, out string path, [System.Diagnostics.CodeAnalysis.NotNullWhen(false)] out RequestResult? bad)
    {
        string? requested = payload.GetString("path");
        if (requested is null
            || requested.IndexOfAny(new[] { '*', '?', '"', '<', '>', '|' }) >= 0
            || !PathText.TryNormaliseAbsolute(requested, out path))
        {
            path = "";
            bad = RequestResult.BadRequest("path には Windows の絶対パスが必要です（* ? \" < > | は使えません）。");
            return false;
        }
        bad = null;
        return true;
    }

    private static RequestResult Answer(bool ok, string reason)
    {
        return RequestResult.Success(new JsonObject
        {
            ["ok"] = ok,
            ["reason"] = reason,
        });
    }

    // ------------------------------------------------------------------
    // 画面のスレッドでの処理
    // ------------------------------------------------------------------

    private void ShowHazard(HazardContent hazard)
    {
        List<PixelRect> monitors = WindowPlacement.MonitorBounds();
        bool sameMonitors = hazards.Count == monitors.Count
            && hazards.Select(window => window.Bounds).SequenceEqual(monitors);
        if (!sameMonitors)
        {
            // 画面の数や配置が変わった：作り直す
            foreach (HazardBorderWindow old in hazards)
            {
                old.Close();
            }
            hazards.Clear();
            foreach (PixelRect bounds in monitors)
            {
                hazards.Add(new HazardBorderWindow(bounds, Settings.HazardBorderPx));
            }
        }
        foreach (HazardBorderWindow window in hazards)
        {
            window.Apply(hazard);
            if (!window.IsVisible)
            {
                window.Show();
            }
        }
    }

    /// <summary>通知領域の「状態」：状態の画面を開き、最新の状態を見せる</summary>
    private void OpenStatusWindow()
    {
        if (statusWindow is null)
        {
            statusWindow = new StatusWindow();
            statusWindow.Closed += (_, _) => statusWindow = null;
        }
        statusWindow.ShowStatus(latestStatus);
        if (!statusWindow.IsVisible)
        {
            statusWindow.Show();
        }
        statusWindow.Activate();
    }

    /// <summary>通知領域の「自動処理を再開（確認）」：確認画面を出す</summary>
    private void ConfirmResume()
    {
        if (confirmResume is not null)
        {
            confirmResume.Activate();
            return;
        }
        confirmResume = new ConfirmResumeWindow(() => tray?.SendResumeConfirmed());
        confirmResume.Closed += (_, _) => confirmResume = null;
        confirmResume.Show();
    }

    /// <summary>画面がないとき（表示なし・準備の失敗）は、知らせを無視する（種類ごとに1回だけ記録する）</summary>
    private bool UiAvailable(string type)
    {
        if (running)
        {
            return true;
        }
        LogOnce(type, "画面がない（表示なし・準備の失敗）ため、" + type + " を無視しました。");
        return false;
    }

    private void LogOnce(string key, string message)
    {
        lock (loggedWithoutUi)
        {
            if (!loggedWithoutUi.Add(key))
            {
                return;
            }
        }
        Log.Info(message + "（以後は記録しません）");
    }
}
