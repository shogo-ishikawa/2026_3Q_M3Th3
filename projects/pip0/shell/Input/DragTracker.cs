using System;
using Pip0Shell.Ui;

namespace Pip0Shell.Input;

/// <summary>マウスのフックから受け取った出来事の種類</summary>
internal enum MouseEventKind
{
    /// <summary>左ボタンを押したまま動いた（押していないときの移動は受け取らない）</summary>
    Move,

    /// <summary>左ボタンを押した</summary>
    LeftDown,

    /// <summary>左ボタンを離した</summary>
    LeftUp,

    /// <summary>フックを付け直した（その間の出来事を取りこぼした可能性がある）</summary>
    HookReset,
}

/// <summary>マウスのフックから受け取った1つの出来事。TickMs は Environment.TickCount64 のミリ秒</summary>
internal readonly record struct MouseEventRecord(MouseEventKind Kind, PixelPoint Point, long TickMs);

/// <summary><see cref="DragTracker"/> が判定した結果</summary>
internal enum DragStepKind
{
    /// <summary>何もない（ドラッグではない移動、クリックで終わった等）</summary>
    None,

    /// <summary>ボタンが押された（ドラッグになるかはまだ分からない）</summary>
    Pressed,

    /// <summary>押したまま一定の距離を動いた：ドラッグが始まった</summary>
    Started,

    /// <summary>ドラッグ中に動いた</summary>
    Moved,

    /// <summary>ドラッグ中にボタンが離された</summary>
    Ended,
}

/// <summary>
/// 「左ボタンを押して、Windows の決める距離（SM_CXDRAG / SM_CYDRAG）より動いたらドラッグ」という判定だけを行う。
/// Windows の機能を使わないので、Checks/ で確かめられます。何のファイルか・どのアプリかは Input/DragMonitor.cs が調べます。
/// </summary>
internal sealed class DragTracker
{
    private readonly int thresholdX;
    private readonly int thresholdY;
    private bool pressed;
    private bool dragging;

    /// <summary>thresholdX / thresholdY：押した位置から左右・上下にこの距離を超えて動いたらドラッグ（ピクセル）</summary>
    public DragTracker(int thresholdX, int thresholdY)
    {
        this.thresholdX = Math.Max(1, thresholdX);
        this.thresholdY = Math.Max(1, thresholdY);
    }

    /// <summary>ボタンを押した位置</summary>
    public PixelPoint DownPoint { get; private set; }

    public bool IsDragging => dragging;

    /// <summary>
    /// 左ボタンが押された。前のドラッグの「離した」を取りこぼしていたら abandonedDrag が真
    /// （呼ぶ側は、前のドラッグを「終わりを確かめられなかった」として閉じる）。
    /// </summary>
    public DragStepKind OnButtonDown(PixelPoint point, out bool abandonedDrag)
    {
        abandonedDrag = dragging;
        pressed = true;
        dragging = false;
        DownPoint = point;
        return DragStepKind.Pressed;
    }

    public DragStepKind OnMove(PixelPoint point)
    {
        if (dragging)
        {
            return DragStepKind.Moved;
        }
        if (!pressed)
        {
            return DragStepKind.None;
        }
        if (Math.Abs(point.X - DownPoint.X) > thresholdX || Math.Abs(point.Y - DownPoint.Y) > thresholdY)
        {
            dragging = true;
            return DragStepKind.Started;
        }
        return DragStepKind.None;
    }

    public DragStepKind OnButtonUp(PixelPoint point)
    {
        bool wasDragging = dragging;
        pressed = false;
        dragging = false;
        return wasDragging ? DragStepKind.Ended : DragStepKind.None;
    }

    /// <summary>出来事を取りこぼしたとき：最初の状態に戻す。ドラッグ中だったら真</summary>
    public bool Abandon()
    {
        bool wasDragging = dragging;
        pressed = false;
        dragging = false;
        return wasDragging;
    }
}
