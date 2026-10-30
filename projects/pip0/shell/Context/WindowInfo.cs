using System;
using Pip0Shell.Ui;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.Graphics.Dwm;
using Windows.Win32.UI.WindowsAndMessaging;

namespace Pip0Shell.Context;

/// <summary>
/// ウィンドウについての読み取り（タイトル、種類の名前、プロセスの番号、画面の上の位置、親をたどる）。
/// 読むだけで、ほかのアプリのウィンドウを変えることはしません。タイトルは記録（ログ）に書きません。
/// </summary>
internal static unsafe class WindowInfo
{
    /// <summary>読むタイトルの最大の長さ（これより長い部分は切る）</summary>
    public const int MaxTitleLength = 1024;

    private const int MaxClassNameLength = 256;
    private const int MaxParentDepth = 64;

    /// <summary>ウィンドウのタイトル。読めなければ空</summary>
    public static string GetTitle(HWND hwnd)
    {
        int length = PInvoke.GetWindowTextLength(hwnd);
        if (length <= 0)
        {
            return "";
        }
        int capacity = Math.Min(length, MaxTitleLength) + 1;
        Span<char> buffer = stackalloc char[capacity];
        fixed (char* pointer = buffer)
        {
            int copied = PInvoke.GetWindowText(hwnd, new PWSTR(pointer), capacity);
            return copied <= 0 ? "" : new string(pointer, 0, Math.Min(copied, capacity - 1));
        }
    }

    /// <summary>ウィンドウの種類の名前（"#32770"、"CabinetWClass" など）。読めなければ空</summary>
    public static string GetClassName(HWND hwnd)
    {
        Span<char> buffer = stackalloc char[MaxClassNameLength];
        fixed (char* pointer = buffer)
        {
            int copied = PInvoke.GetClassName(hwnd, new PWSTR(pointer), MaxClassNameLength);
            return copied <= 0 ? "" : new string(pointer, 0, copied);
        }
    }

    /// <summary>本体へ送る数としての HWND（JSON の整数）</summary>
    public static long ToNumber(HWND hwnd) => ((IntPtr)hwnd).ToInt64();

    /// <summary>本体から受け取った数を HWND に戻す</summary>
    public static HWND FromNumber(long value) => (HWND)new IntPtr(value);

    /// <summary>ウィンドウを作ったプロセスの番号。分からなければ 0</summary>
    public static uint GetProcessId(HWND hwnd)
    {
        uint processId = 0;
        PInvoke.GetWindowThreadProcessId(hwnd, &processId);
        return processId;
    }

    /// <summary>いちばん外側（トップレベル）のウィンドウ</summary>
    public static HWND GetRoot(HWND hwnd)
    {
        return hwnd.IsNull ? HWND.Null : PInvoke.GetAncestor(hwnd, GET_ANCESTOR_FLAGS.GA_ROOT);
    }

    /// <summary>画面の上の点の、いちばん内側のウィンドウ（クリックを通すウィンドウは飛ばされる）</summary>
    public static HWND FromPoint(PixelPoint point)
    {
        return PInvoke.WindowFromPoint(new System.Drawing.Point(point.X, point.Y));
    }

    /// <summary>
    /// hwnd から親をたどり、種類の名前が className のウィンドウを探す（hwnd 自身を含む）。
    /// トップレベルのウィンドウまでで止める。見つからなければ HWND.Null
    /// </summary>
    public static HWND FindSelfOrAncestor(HWND hwnd, string className)
    {
        HWND current = hwnd;
        for (int depth = 0; depth < MaxParentDepth && !current.IsNull; depth++)
        {
            if (string.Equals(GetClassName(current), className, StringComparison.Ordinal))
            {
                return current;
            }
            HWND root = GetRoot(current);
            if (current == root)
            {
                break;
            }
            current = PInvoke.GetAncestor(current, GET_ANCESTOR_FLAGS.GA_PARENT);
        }
        return HWND.Null;
    }

    /// <summary>
    /// ウィンドウの見えている枠の位置（物理ピクセル）。Windows 10/11 の見えない縁を除くため、DWM の値を先に使う。
    /// 読めなければ null
    /// </summary>
    public static PixelRect? GetFrameRect(HWND hwnd)
    {
        RECT rect;
        HRESULT result = PInvoke.DwmGetWindowAttribute(hwnd, DWMWINDOWATTRIBUTE.DWMWA_EXTENDED_FRAME_BOUNDS, &rect, (uint)sizeof(RECT));
        if (result.Failed && !PInvoke.GetWindowRect(hwnd, out rect))
        {
            return null;
        }
        var pixels = new PixelRect(rect.left, rect.top, rect.right, rect.bottom);
        return pixels.IsEmpty ? null : pixels;
    }

    /// <summary>位置を本体へ送る形 {"left", "top", "right", "bottom"}（物理ピクセル）</summary>
    public static System.Text.Json.Nodes.JsonObject RectToJson(PixelRect rect)
    {
        return new System.Text.Json.Nodes.JsonObject
        {
            ["left"] = rect.Left,
            ["top"] = rect.Top,
            ["right"] = rect.Right,
            ["bottom"] = rect.Bottom,
        };
    }
}
