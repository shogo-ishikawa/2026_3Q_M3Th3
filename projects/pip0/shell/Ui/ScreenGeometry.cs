using System;

namespace Pip0Shell.Ui;

/// <summary>画面の上の点（物理ピクセル。GetCursorPos と同じ座標）</summary>
internal readonly record struct PixelPoint(int X, int Y);

/// <summary>
/// 画面の上の長方形（物理ピクセル）。Win32 の RECT と同じく、Right と Bottom の位置は含みません。
/// </summary>
internal readonly record struct PixelRect(int Left, int Top, int Right, int Bottom)
{
    public int Width => Right - Left;

    public int Height => Bottom - Top;

    public bool IsEmpty => Width <= 0 || Height <= 0;

    public bool Contains(PixelPoint point)
    {
        return point.X >= Left && point.X < Right && point.Y >= Top && point.Y < Bottom;
    }

    /// <summary>両方を含む最小の長方形（空の長方形は無視する）</summary>
    public PixelRect Union(PixelRect other)
    {
        if (IsEmpty)
        {
            return other;
        }
        if (other.IsEmpty)
        {
            return this;
        }
        return new PixelRect(
            Math.Min(Left, other.Left),
            Math.Min(Top, other.Top),
            Math.Max(Right, other.Right),
            Math.Max(Bottom, other.Bottom));
    }

    public static PixelRect FromSize(int x, int y, int width, int height) => new(x, y, x + width, y + height);
}

/// <summary>
/// ミニドック・デスク・警告の枠を置く位置の計算（Windows の機能を使わないので、Checks/ で確かめられます）。
/// 置き方を変えたいときは、ここの関数を変えてください。
/// </summary>
internal static class ScreenGeometry
{
    /// <summary>点から長方形までの距離（ピクセル）。長方形の中なら 0、空の長方形なら無限大</summary>
    public static double DistanceToRect(PixelPoint point, PixelRect rect)
    {
        if (rect.IsEmpty)
        {
            return double.PositiveInfinity;
        }
        long dx = point.X < rect.Left ? rect.Left - point.X : point.X >= rect.Right ? point.X - (rect.Right - 1L) : 0;
        long dy = point.Y < rect.Top ? rect.Top - point.Y : point.Y >= rect.Bottom ? point.Y - (rect.Bottom - 1L) : 0;
        return Math.Sqrt((double)dx * dx + (double)dy * dy);
    }

    /// <summary>作業領域（タスクバーを除いた範囲）の右下に、余白 margin を空けて置く</summary>
    public static PixelPoint BottomRight(PixelRect workArea, int width, int height, int margin)
    {
        return Clamp(workArea, workArea.Right - margin - width, workArea.Bottom - margin - height, width, height);
    }

    /// <summary>作業領域の右端に、上下の中央で置く</summary>
    public static PixelPoint RightEdgeCentre(PixelRect workArea, int width, int height, int margin)
    {
        return Clamp(workArea, workArea.Right - margin - width, workArea.Top + (workArea.Height - height) / 2, width, height);
    }

    /// <summary>
    /// ファイルダイアログの上辺に沿って置く（左端をダイアログに合わせる）。
    /// 上に入らなければダイアログの下辺の下へ、それも入らなければ作業領域の上端に置く。
    /// </summary>
    public static PixelPoint AlongDialogTop(PixelRect dialog, PixelRect workArea, int width, int height, int gap)
    {
        int above = dialog.Top - gap - height;
        if (above >= workArea.Top)
        {
            return Clamp(workArea, dialog.Left, above, width, height);
        }
        int below = dialog.Bottom + gap;
        if (below + height <= workArea.Bottom)
        {
            return Clamp(workArea, dialog.Left, below, width, height);
        }
        return Clamp(workArea, dialog.Left, workArea.Top, width, height);
    }

    /// <summary>作業領域からはみ出さないように位置を直す（大きすぎるときは左上を合わせる）</summary>
    public static PixelPoint Clamp(PixelRect area, int x, int y, int width, int height)
    {
        int clampedX = Math.Max(area.Left, Math.Min(x, area.Right - width));
        int clampedY = Math.Max(area.Top, Math.Min(y, area.Bottom - height));
        return new PixelPoint(clampedX, clampedY);
    }

    /// <summary>100% 表示のときのピクセル数を、画面の拡大率 scale（1.5 = 150%）に合わせる</summary>
    public static int Scale(int pixelsAt100Percent, double scale)
    {
        if (double.IsNaN(scale) || scale <= 0)
        {
            scale = 1.0;
        }
        return (int)Math.Round(pixelsAt100Percent * scale);
    }
}
