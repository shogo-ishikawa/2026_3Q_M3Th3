using System;

namespace Pip0Shell.Ui;

/// <summary>
/// デスクの候補の上でマウスのボタンが押されたことを覚えておく。
/// ドラッグの検知（Input/DragMonitor.cs）が「pip0 のデスクから始まったドラッグ」のファイルを知るために使います。
///
/// 画面のスレッドが <see cref="Record"/> し、ドラッグを見張るスレッドが <see cref="Find"/> するので、ロックして使います。
/// </summary>
internal sealed class DeskPressRecorder
{
    /// <summary>押した記録を使える時間（ミリ秒）</summary>
    public const long MaxAgeMilliseconds = 3000;

    /// <summary>フックが受け取った押した位置と、画面が受け取った位置の差として許す距離（ピクセル）</summary>
    public const int MaxDistancePixels = 24;

    private readonly object gate = new();
    private string? path;
    private PixelPoint point;
    private long recordedAt;

    /// <summary>候補 path の上で、point（物理ピクセル）でボタンが押された</summary>
    public void Record(string pressedPath, PixelPoint pressedPoint, long nowMs)
    {
        lock (gate)
        {
            path = pressedPath;
            point = pressedPoint;
            recordedAt = nowMs;
        }
    }

    /// <summary>downPoint で押されたボタンが、少し前にデスクの候補の上で押されたものなら、その候補のパス。違えば null</summary>
    public string? Find(PixelPoint downPoint, long nowMs)
    {
        lock (gate)
        {
            if (path is null || nowMs - recordedAt > MaxAgeMilliseconds || nowMs < recordedAt)
            {
                return null;
            }
            if (Math.Abs(point.X - downPoint.X) > MaxDistancePixels || Math.Abs(point.Y - downPoint.Y) > MaxDistancePixels)
            {
                return null;
            }
            return path;
        }
    }

    /// <summary>デスクを隠したときなど、記録を消す</summary>
    public void Clear()
    {
        lock (gate)
        {
            path = null;
        }
    }
}
