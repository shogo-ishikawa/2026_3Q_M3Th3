using System;
using Pip0Shell.Ipc;

namespace Pip0Shell.Core;

/// <summary>
/// init の "settings" で受け取る、画面の動きの設定（pip0/settings.py の値）。
/// 値がない・範囲の外のときは、settings.py と同じ初期値を使います。
/// 今のシェルでは通知領域アイコンだけを作っているので、ミニドック・デスク・警告の枠を作るときに使います。
/// </summary>
internal sealed class ShellSettings
{
    /// <summary>マウスがデスクにこの距離（px）まで近づくと透過する（DESK_APPROACH_PX）</summary>
    public int DeskApproachPx { get; init; } = 48;

    /// <summary>透過したときの不透明度（DESK_TRANSPARENT_OPACITY）</summary>
    public double DeskTransparentOpacity { get; init; } = 0.15;

    /// <summary>マウスの位置を調べる間隔（CURSOR_SAMPLE_MS）</summary>
    public int CursorSampleMs { get; init; } = 33;

    /// <summary>マウスの位置をまとめて送る間隔（CURSOR_BATCH_MS）</summary>
    public int CursorBatchMs { get; init; } = 100;

    /// <summary>警告の枠の太さ（HAZARD_BORDER_PX）</summary>
    public int HazardBorderPx { get; init; } = 12;

    /// <summary>ミニドックに同時に表示する行数（MINI_DOCK_MAX_ROWS）</summary>
    public int MiniDockMaxRows { get; init; } = 3;

    public static ShellSettings FromPayload(Payload settings)
    {
        var defaults = new ShellSettings();
        return new ShellSettings
        {
            DeskApproachPx = ReadInt(settings, "desk_approach_px", defaults.DeskApproachPx, 0, 1000),
            DeskTransparentOpacity = ReadDouble(settings, "desk_transparent_opacity", defaults.DeskTransparentOpacity, 0.0, 1.0),
            CursorSampleMs = ReadInt(settings, "cursor_sample_ms", defaults.CursorSampleMs, 5, 1000),
            CursorBatchMs = ReadInt(settings, "cursor_batch_ms", defaults.CursorBatchMs, 10, 5000),
            HazardBorderPx = ReadInt(settings, "hazard_border_px", defaults.HazardBorderPx, 1, 200),
            MiniDockMaxRows = ReadInt(settings, "mini_dock_max_rows", defaults.MiniDockMaxRows, 1, 20),
        };
    }

    private static int ReadInt(Payload settings, string name, int fallback, int minimum, int maximum)
    {
        double? value = settings.GetDouble(name);
        if (value is null || double.IsNaN(value.Value) || value.Value < minimum || value.Value > maximum)
        {
            return fallback;
        }
        return (int)Math.Round(value.Value);
    }

    private static double ReadDouble(Payload settings, string name, double fallback, double minimum, double maximum)
    {
        double? value = settings.GetDouble(name);
        if (value is null || double.IsNaN(value.Value) || value.Value < minimum || value.Value > maximum)
        {
            return fallback;
        }
        return value.Value;
    }
}
