namespace Pip0Shell.Ui;

/// <summary>デスクの見え方</summary>
internal enum DeskMode
{
    /// <summary>マウスが遠い：不透明で、クリックできる</summary>
    Normal,

    /// <summary>マウスが近い：薄くなり、クリックは下のウィンドウへ通る</summary>
    Faded,

    /// <summary>操作モード（つまみから入る）：不透明で、候補を選べる</summary>
    Engaged,
}

/// <summary>1回の判定の結果。HandleEvent は本体へ送る ui.desk.handle の state（"engaged"/"released"、なければ null）</summary>
internal readonly record struct DeskStep(DeskMode Mode, bool ModeChanged, string? HandleEvent);

/// <summary>
/// デスクの「接近で透過」と「つまみで操作モード」の決まり（docs/design.md 4-4）。
/// 時刻とマウスの位置を受け取って次の見え方を返すだけで、画面には触れません（Checks/ で確かめられます）。
///
/// - マウスがデスクから approachPx 以内（デスクの上を含む）：薄くして、クリックを下へ通す（Faded）。
/// - つまみの上に 0.3 秒とどまるか、つまみをクリック：操作モード（Engaged）。本体へ "engaged" を送る。
/// - 操作モードの間は、マウスがデスクとつまみから approachPx より離れるまで続く。離れたら "released" を送る。
/// </summary>
internal sealed class DeskProximity
{
    /// <summary>つまみの上にとどまると操作モードに入る時間（ミリ秒）</summary>
    public const long HoverMilliseconds = 300;

    private long? hoverSince;

    public DeskMode Mode { get; private set; } = DeskMode.Normal;

    /// <summary>
    /// 一定の間隔で呼ぶ。cursor が null（マウスの位置を読めない）のときは、今の見え方のままにする。
    /// </summary>
    public DeskStep Update(long nowMs, PixelPoint? cursor, PixelRect desk, PixelRect handle, double approachPx)
    {
        DeskMode before = Mode;
        if (cursor is not PixelPoint point)
        {
            hoverSince = null;
            return new DeskStep(Mode, false, null);
        }

        if (Mode == DeskMode.Engaged)
        {
            double distance = ScreenGeometry.DistanceToRect(point, desk.Union(handle));
            if (distance > approachPx)
            {
                Mode = DeskMode.Normal;
                hoverSince = null;
                return new DeskStep(Mode, true, "released");
            }
            return new DeskStep(Mode, false, null);
        }

        if (!handle.IsEmpty && handle.Contains(point))
        {
            hoverSince ??= nowMs;
            if (nowMs - hoverSince.Value >= HoverMilliseconds)
            {
                Mode = DeskMode.Engaged;
                hoverSince = null;
                return new DeskStep(Mode, true, "engaged");
            }
        }
        else
        {
            hoverSince = null;
        }

        Mode = ScreenGeometry.DistanceToRect(point, desk) <= approachPx ? DeskMode.Faded : DeskMode.Normal;
        return new DeskStep(Mode, Mode != before, null);
    }

    /// <summary>つまみがクリックされた：すぐに操作モードにする</summary>
    public DeskStep Engage()
    {
        hoverSince = null;
        if (Mode == DeskMode.Engaged)
        {
            return new DeskStep(Mode, false, null);
        }
        Mode = DeskMode.Engaged;
        return new DeskStep(Mode, true, "engaged");
    }

    /// <summary>デスクを隠すとき：最初の状態に戻す。操作モードだったら "released" を返す</summary>
    public DeskStep Reset()
    {
        bool wasEngaged = Mode == DeskMode.Engaged;
        bool changed = Mode != DeskMode.Normal;
        Mode = DeskMode.Normal;
        hoverSince = null;
        return new DeskStep(Mode, changed, wasEngaged ? "released" : null);
    }
}
