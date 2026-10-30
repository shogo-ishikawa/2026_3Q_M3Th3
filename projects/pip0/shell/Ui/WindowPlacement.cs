using System;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.UI.WindowsAndMessaging;

namespace Pip0Shell.Ui;

/// <summary>
/// 常駐UI のウィンドウ（WPF）を、Win32 の設定で「前面に出ない・クリックを通す・物理ピクセルの位置に置く」ための道具。
///
/// - WS_EX_NOACTIVATE：クリックしても、作業中のアプリからキーボードの入力先を奪わない。
/// - WS_EX_TOOLWINDOW：タスクバーと Alt+Tab に出さない。
/// - WS_EX_TRANSPARENT：クリックを下のウィンドウへ通す（AllowsTransparency = true のウィンドウでだけ使う。
///   WPF が WS_EX_LAYERED を付けるため、この2つがそろうとクリックが通る）。
/// - 位置は物理ピクセル（GetCursorPos と同じ座標）で SetWindowPos する。WPF の Left/Top は拡大率の違う画面で
///   ずれることがあるため使わない。
/// - 画面の共有・録画・スクリーンショットに写さない（SetWindowDisplayAffinity の WDA_EXCLUDEFROMCAPTURE）。
///   警告の枠やミニドックには、ファイル名や作業中の会話名が出るため、画面の共有中に、ほかの人へ見せないようにする。
///   Windows の説明どおり、これは画面を写されないための「保護の仕組み」ではありません（カメラで撮るなどは防げない）。
/// </summary>
internal static class WindowPlacement
{
    /// <summary>まだ置き場所が決まっていないウィンドウを、いったん画面の外に作るための位置（DIP）</summary>
    public const double OffScreen = -32000;

    /// <summary>
    /// クリックされても前面に出ないように、WM_MOUSEACTIVATE に MA_NOACTIVATE と答えるフック。
    /// WS_EX_NOACTIVATE だけでは、WPF の処理で前面に出ることがあるための念のためです。
    /// HwndSource に渡す関数を GC に回収させないよう、静的フィールドで持ち続けます（状態を持たないので共有できる）。
    /// </summary>
    private static readonly HwndSourceHook NoActivateHook = (IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam, ref bool handled) =>
    {
        if (message == (int)PInvoke.WM_MOUSEACTIVATE)
        {
            handled = true;
            return (IntPtr)PInvoke.MA_NOACTIVATE;
        }
        return IntPtr.Zero;
    };

    public static HWND Handle(Window window) => (HWND)new WindowInteropHelper(window).Handle;

    /// <summary>SourceInitialized（ウィンドウが作られた直後、表示の前）で呼ぶ</summary>
    public static void ApplyFloatingStyle(Window window, bool clickThrough)
    {
        HWND hwnd = Handle(window);
        if (hwnd.IsNull)
        {
            return;
        }
        int style = PInvoke.GetWindowLong(hwnd, WINDOW_LONG_PTR_INDEX.GWL_EXSTYLE);
        style |= (int)(WINDOW_EX_STYLE.WS_EX_NOACTIVATE | WINDOW_EX_STYLE.WS_EX_TOOLWINDOW);
        style = clickThrough ? style | (int)WINDOW_EX_STYLE.WS_EX_TRANSPARENT : style & ~(int)WINDOW_EX_STYLE.WS_EX_TRANSPARENT;
        PInvoke.SetWindowLong(hwnd, WINDOW_LONG_PTR_INDEX.GWL_EXSTYLE, style);
        HwndSource.FromHwnd((IntPtr)hwnd)?.AddHook(NoActivateHook);
        if (!PInvoke.SetWindowDisplayAffinity(hwnd, WINDOW_DISPLAY_AFFINITY.WDA_EXCLUDEFROMCAPTURE))
        {
            // 失敗しても表示は続ける（ウィンドウの種類の名前だけを記録する。パスやタイトルは書かない）
            Core.Log.Warning("画面の共有に写さない設定ができませんでした（" + window.GetType().Name + "、エラー "
                + System.Runtime.InteropServices.Marshal.GetLastPInvokeError() + "）。");
        }
    }

    /// <summary>クリックを下へ通すか（WS_EX_TRANSPARENT）を切り替える</summary>
    public static void SetClickThrough(Window window, bool clickThrough)
    {
        HWND hwnd = Handle(window);
        if (hwnd.IsNull)
        {
            return;
        }
        int style = PInvoke.GetWindowLong(hwnd, WINDOW_LONG_PTR_INDEX.GWL_EXSTYLE);
        int updated = clickThrough
            ? style | (int)WINDOW_EX_STYLE.WS_EX_TRANSPARENT
            : style & ~(int)WINDOW_EX_STYLE.WS_EX_TRANSPARENT;
        if (updated != style)
        {
            PInvoke.SetWindowLong(hwnd, WINDOW_LONG_PTR_INDEX.GWL_EXSTYLE, updated);
        }
    }

    /// <summary>ウィンドウの位置と大きさ（物理ピクセル）。作られていなければ null</summary>
    public static PixelRect? GetRect(Window window)
    {
        HWND hwnd = Handle(window);
        if (hwnd.IsNull || !PInvoke.GetWindowRect(hwnd, out RECT rect))
        {
            return null;
        }
        return new PixelRect(rect.left, rect.top, rect.right, rect.bottom);
    }

    /// <summary>左上を (x, y)（物理ピクセル）に動かす。最前面のまま、前面には出さない</summary>
    public static void MoveTo(Window window, PixelPoint point)
    {
        HWND hwnd = Handle(window);
        if (hwnd.IsNull)
        {
            return;
        }
        PixelRect? current = GetRect(window);
        if (current is PixelRect rect && rect.Left == point.X && rect.Top == point.Y)
        {
            return;
        }
        PInvoke.SetWindowPos(hwnd, HWND.HWND_TOPMOST, point.X, point.Y, 0, 0,
            SET_WINDOW_POS_FLAGS.SWP_NOSIZE | SET_WINDOW_POS_FLAGS.SWP_NOACTIVATE);
    }

    /// <summary>位置と大きさ（物理ピクセル）を決める。最前面のまま、前面には出さない</summary>
    public static void SetBounds(Window window, PixelRect bounds)
    {
        HWND hwnd = Handle(window);
        if (hwnd.IsNull)
        {
            return;
        }
        PInvoke.SetWindowPos(hwnd, HWND.HWND_TOPMOST, bounds.Left, bounds.Top, bounds.Width, bounds.Height,
            SET_WINDOW_POS_FLAGS.SWP_NOACTIVATE);
    }

    /// <summary>ウィンドウのある画面の拡大率（1.0 = 100%、1.5 = 150%）</summary>
    public static double ScaleOf(Visual visual)
    {
        try
        {
            return VisualTreeHelper.GetDpi(visual).DpiScaleX;
        }
        catch (Exception)
        {
            return 1.0;
        }
    }

    /// <summary>主モニターの作業領域（タスクバーを除く、物理ピクセル）</summary>
    public static PixelRect PrimaryWorkArea()
    {
        System.Windows.Forms.Screen? primary = System.Windows.Forms.Screen.PrimaryScreen;
        return primary is null ? new PixelRect(0, 0, 1280, 720) : ToPixels(primary.WorkingArea);
    }

    /// <summary>hwnd のウィンドウがいちばん多く重なっている画面の作業領域。ウィンドウがなければ主モニター</summary>
    public static PixelRect WorkAreaOfWindow(nint hwnd)
    {
        if (hwnd == 0)
        {
            return PrimaryWorkArea();
        }
        return ToPixels(System.Windows.Forms.Screen.FromHandle(hwnd).WorkingArea);
    }

    /// <summary>長方形がいちばん多く重なっている画面の作業領域</summary>
    public static PixelRect WorkAreaOfRect(PixelRect rect)
    {
        var area = new System.Drawing.Rectangle(rect.Left, rect.Top, rect.Width, rect.Height);
        return ToPixels(System.Windows.Forms.Screen.FromRectangle(area).WorkingArea);
    }

    /// <summary>すべての画面の全体の範囲（タスクバーを含む、物理ピクセル）</summary>
    public static List<PixelRect> MonitorBounds()
    {
        var bounds = new List<PixelRect>();
        foreach (System.Windows.Forms.Screen screen in System.Windows.Forms.Screen.AllScreens)
        {
            bounds.Add(ToPixels(screen.Bounds));
        }
        return bounds;
    }

    private static PixelRect ToPixels(System.Drawing.Rectangle rectangle)
    {
        return new PixelRect(rectangle.Left, rectangle.Top, rectangle.Right, rectangle.Bottom);
    }
}
