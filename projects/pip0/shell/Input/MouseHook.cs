using System;
using System.Runtime.InteropServices;
using Pip0Shell.CloudFiles;
using Pip0Shell.Context;
using Pip0Shell.Core;
using Pip0Shell.Ui;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.UI.WindowsAndMessaging;

namespace Pip0Shell.Input;

/// <summary>
/// 低レベルのマウスのフック（WH_MOUSE_LL）。専用のスレッドとメッセージループで動かします。
///
/// - フックの関数（<see cref="HookProc"/>）は、受け取った出来事を列に入れるだけで、すぐに戻ります。
///   Windows は、応答の遅い低レベルのフックを知らせなしに外すため、重い処理（ウィンドウやファイルを調べる）はしません。
/// - 左ボタンを押していない間の移動は列に入れません（ドラッグの判定に要らないため）。
/// - 2 秒ごとに、マウスの位置が動いたのにフックが何も受け取っていないかを確かめ、2 回続いたら
///   「フックが外された」とみなして付け直し、feature.status（mouse_hook）で知らせます。
///   管理者として動くアプリへの入力は、Windows の制限（UIPI）でフックに届かないため、そのときは判断しません。
/// </summary>
internal sealed class MouseHook
{
    private const uint HealthTimerId = 1;
    private const uint HealthIntervalMs = 2000;
    private const int SuspiciousChecksBeforeReinstall = 2;

    private readonly Action<MouseEventRecord> sink;
    private readonly FeatureReporter features;
    private readonly MessageLoopThread loop = new("pip0 mouse hook");
    private readonly HOOKPROC proc;

    // フックのスレッドだけが触る
    private HHOOK hook;
    private nuint healthTimer;
    private System.Drawing.Point lastCheckedCursor;
    private bool hasCheckedCursor;
    private int suspiciousChecks;

    // フックの関数（同じスレッド）が書き、点検（同じスレッド）が読む
    private int eventsSinceCheck;
    private bool leftDown;

    public MouseHook(Action<MouseEventRecord> sink, FeatureReporter features)
    {
        this.sink = sink;
        this.features = features;
        // Windows に渡す関数。フックを付けている間に GC に回収されないよう、フィールドで持ち続ける
        proc = HookProc;
    }

    public bool Start(out string reason)
    {
        return loop.Start(Install, OnThreadMessage, Remove, TimeSpan.FromSeconds(10), out reason);
    }

    public void Stop()
    {
        loop.Stop(TimeSpan.FromSeconds(3));
    }

    private bool Install(out string problem)
    {
        if (!TryHook(out problem))
        {
            return false;
        }
        healthTimer = PInvoke.SetTimer(HWND.Null, HealthTimerId, HealthIntervalMs, null);
        if (healthTimer == 0)
        {
            Log.Warning("マウスのフックの点検の時計を始められませんでした（外されても気づけません）。");
        }
        return true;
    }

    private bool TryHook(out string problem)
    {
        using FreeLibrarySafeHandle module = PInvoke.GetModuleHandle((string?)null);
        hook = PInvoke.SetWindowsHookEx(
            WINDOWS_HOOK_ID.WH_MOUSE_LL,
            proc,
            new HINSTANCE(module.DangerousGetHandle()),
            0);
        if (hook.IsNull)
        {
            int error = Marshal.GetLastPInvokeError();
            problem = "マウスのフック（WH_MOUSE_LL）を付けられませんでした：" + HResultText.Describe(HResultText.FromWin32(error));
            return false;
        }
        problem = "";
        return true;
    }

    private void Remove()
    {
        if (healthTimer != 0)
        {
            PInvoke.KillTimer(HWND.Null, healthTimer);
            healthTimer = 0;
        }
        if (!hook.IsNull)
        {
            PInvoke.UnhookWindowsHookEx(hook);
            hook = default;
        }
    }

    private void OnThreadMessage(MSG message)
    {
        if (message.message == PInvoke.WM_TIMER && message.wParam.Value == healthTimer)
        {
            CheckHealth();
        }
    }

    /// <summary>マウスが動いたのにフックが何も受け取っていなければ、外されたとみなして付け直す</summary>
    private void CheckHealth()
    {
        if (!PInvoke.GetCursorPos(out System.Drawing.Point cursor))
        {
            return; // 画面のロック中など。判断しない
        }
        bool moved = hasCheckedCursor && cursor != lastCheckedCursor;
        lastCheckedCursor = cursor;
        hasCheckedCursor = true;

        if (moved && eventsSinceCheck == 0 && !InputMayBeHiddenByWindows(cursor))
        {
            suspiciousChecks++;
        }
        else
        {
            suspiciousChecks = 0;
        }
        eventsSinceCheck = 0;

        if (suspiciousChecks < SuspiciousChecksBeforeReinstall)
        {
            return;
        }
        suspiciousChecks = 0;
        Log.Warning("マウスのフックが外されたようなので、付け直します。");
        features.Report(FeatureReporter.MouseHook, false, "Windows がマウスのフックを外しました（応答が遅いと外されることがあります）。付け直します。");

        if (!hook.IsNull)
        {
            PInvoke.UnhookWindowsHookEx(hook); // すでに外されていれば失敗するが、問題ない
            hook = default;
        }
        leftDown = false;
        sink(new MouseEventRecord(MouseEventKind.HookReset, default, Environment.TickCount64));

        if (TryHook(out string problem))
        {
            features.Report(FeatureReporter.MouseHook, true, "マウスのフックを付け直しました。ドラッグの検知を続けます。");
        }
        else
        {
            features.Report(FeatureReporter.MouseHook, false, problem);
        }
    }

    /// <summary>
    /// マウスの下のウィンドウか前面のウィンドウが、管理者として動くアプリ（このシェルより高い権限）のものか、権限が分からないとき真。
    /// そのアプリへの入力は、Windows の制限（UIPI）で低レベルのフックに届かないため、「フックが外れた」とは判断しない。
    /// </summary>
    private static bool InputMayBeHiddenByWindows(System.Drawing.Point cursor)
    {
        HWND under = WindowInfo.GetRoot(WindowInfo.FromPoint(new PixelPoint(cursor.X, cursor.Y)));
        HWND foreground = PInvoke.GetForegroundWindow();
        foreach (HWND window in new[] { under, foreground })
        {
            if (window.IsNull)
            {
                continue;
            }
            uint processId = WindowInfo.GetProcessId(window);
            if (processId == 0 || ProcessInfo.IsHigherIntegrityThanSelf(processId) != false)
            {
                return true;
            }
        }
        return false;
    }

    /// <summary>Windows から呼ばれる。列に入れるだけで、すぐに戻る（例外を外へ出さない）</summary>
    private unsafe LRESULT HookProc(int code, WPARAM wParam, LPARAM lParam)
    {
        if (code >= 0)
        {
            try
            {
                eventsSinceCheck++;
                uint message = (uint)wParam.Value;
                var info = (MSLLHOOKSTRUCT*)lParam.Value;
                var point = new PixelPoint(info->pt.X, info->pt.Y);
                if (message == PInvoke.WM_LBUTTONDOWN)
                {
                    leftDown = true;
                    sink(new MouseEventRecord(MouseEventKind.LeftDown, point, Environment.TickCount64));
                }
                else if (message == PInvoke.WM_LBUTTONUP)
                {
                    leftDown = false;
                    sink(new MouseEventRecord(MouseEventKind.LeftUp, point, Environment.TickCount64));
                }
                else if (message == PInvoke.WM_MOUSEMOVE && leftDown)
                {
                    sink(new MouseEventRecord(MouseEventKind.Move, point, Environment.TickCount64));
                }
            }
            catch (Exception)
            {
                // フックの中の失敗で、マウスの操作を止めない
            }
        }
        return PInvoke.CallNextHookEx(HHOOK.Null, code, wParam, lParam);
    }
}
