using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace Pip0Shell.Ui;

/// <summary>
/// デスクの左端に付く、小さな「つまみ」のウィンドウ（docs/design.md 4-4）。
///
/// デスクが薄くなってクリックを通している間も、つまみだけは常にクリックできます。
/// つまみにマウスを 0.3 秒置くか、クリックすると、デスクが操作モードになります（判定は <see cref="DeskProximity"/>）。
/// 前面には出ません（WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW）。
/// </summary>
internal sealed class DeskHandleWindow : Window
{
    private const double WidthDip = 22;
    private const double HeightDip = 64;

    private readonly Border grip;
    private readonly Action onClick;

    public DeskHandleWindow(Action onClick)
    {
        this.onClick = onClick;

        Title = "pip0 デスクのつまみ";
        WindowStyle = WindowStyle.None;
        AllowsTransparency = true;
        Background = Brushes.Transparent;
        ResizeMode = ResizeMode.NoResize;
        ShowInTaskbar = false;
        ShowActivated = false;
        Topmost = true;
        Width = WidthDip;
        Height = HeightDip;
        WindowStartupLocation = WindowStartupLocation.Manual;
        Left = WindowPlacement.OffScreen;
        Top = WindowPlacement.OffScreen;
        Cursor = Cursors.Hand;
        ToolTip = "ここにマウスを置くか、クリックすると、デスクの候補を選べます";

        grip = new Border
        {
            CornerRadius = new CornerRadius(8, 0, 0, 8),
            BorderBrush = UiStyle.PanelBorder,
            BorderThickness = new Thickness(1, 1, 0, 1),
            Child = new TextBlock
            {
                Text = "⋮",
                FontSize = 18,
                FontWeight = FontWeights.Bold,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
            },
        };
        SetEngaged(false);
        Content = grip;

        SourceInitialized += (_, _) => WindowPlacement.ApplyFloatingStyle(this, clickThrough: false);
        MouseLeftButtonUp += (_, _) => this.onClick();
    }

    /// <summary>操作モードの間は目立つ色にする</summary>
    public void SetEngaged(bool engaged)
    {
        grip.Background = engaged ? UiStyle.Accent : UiStyle.PanelBackground;
        if (grip.Child is TextBlock glyph)
        {
            glyph.Foreground = engaged ? UiStyle.AccentText : UiStyle.SubText;
        }
    }
}
