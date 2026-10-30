using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace Pip0Shell.Ui;

/// <summary>
/// 警告の枠（M5。docs/design.md 4-7）：1つの画面（モニター）の縁を光らせ、上の中央に短い文を出すウィンドウ。
///
/// - 画面ごとに1つ作り、その画面の全体（タスクバーを含む）を覆う。物理ピクセルで置く。
/// - 最前面で、クリックを下へ通し（WS_EX_TRANSPARENT）、前面にも出ないので、ドラッグ中の操作を邪魔しません。
///   クリックを通すウィンドウは、Windows がドロップ先を探すときにも飛ばされます。
/// - 赤：機密（sensitive）、橙：機密か未判定（unknown）。太さは hazard_border_px（100% のときのピクセル数）。
/// - 光り方は、外側から内側へ薄くなる3重の枠で表す（動かし続けると画面全体の描き直しが重くなるため、動かさない）。
/// </summary>
internal sealed class HazardBorderWindow : Window
{
    private readonly PixelRect bounds;
    private readonly Border outer = new();
    private readonly Border middle = new();
    private readonly Border inner = new();
    private readonly Border messagePanel = new();
    private readonly TextBlock messageText = new();
    private readonly TextBlock namesText = new();

    public HazardBorderWindow(PixelRect monitorBounds, int borderPx)
    {
        bounds = monitorBounds;

        Title = "pip0 警告";
        WindowStyle = WindowStyle.None;
        AllowsTransparency = true;
        Background = Brushes.Transparent;
        ResizeMode = ResizeMode.NoResize;
        ShowInTaskbar = false;
        ShowActivated = false;
        Topmost = true;
        IsHitTestVisible = false;
        Focusable = false;
        WindowStartupLocation = WindowStartupLocation.Manual;
        Left = WindowPlacement.OffScreen;
        Top = WindowPlacement.OffScreen;
        Width = 100;
        Height = 100;

        double thickness = borderPx;
        outer.BorderThickness = new Thickness(thickness);
        middle.BorderThickness = new Thickness(thickness);
        inner.BorderThickness = new Thickness(thickness);
        outer.Child = middle;
        middle.Child = inner;

        messageText.FontFamily = UiStyle.Font;
        messageText.FontSize = 16;
        messageText.FontWeight = FontWeights.SemiBold;
        messageText.Foreground = Brushes.White;
        messageText.TextWrapping = TextWrapping.Wrap;
        messageText.TextAlignment = TextAlignment.Center;
        namesText.FontFamily = UiStyle.Font;
        namesText.FontSize = 13;
        namesText.Foreground = Brushes.White;
        namesText.TextWrapping = TextWrapping.Wrap;
        namesText.TextAlignment = TextAlignment.Center;
        namesText.Margin = new Thickness(0, 2, 0, 0);

        var texts = new StackPanel();
        texts.Children.Add(messageText);
        texts.Children.Add(namesText);
        messagePanel.CornerRadius = new CornerRadius(14);
        messagePanel.Padding = new Thickness(18, 8, 18, 9);
        messagePanel.Margin = new Thickness(0, thickness * 3 + 12, 0, 0);
        messagePanel.MaxWidth = 720;
        messagePanel.HorizontalAlignment = HorizontalAlignment.Center;
        messagePanel.VerticalAlignment = VerticalAlignment.Top;
        messagePanel.Child = texts;

        var grid = new Grid();
        grid.Children.Add(outer);
        grid.Children.Add(messagePanel);
        Content = grid;

        SourceInitialized += (_, _) =>
        {
            WindowPlacement.ApplyFloatingStyle(this, clickThrough: true);
            WindowPlacement.SetBounds(this, bounds);
        };
        // 拡大率の違う画面へ動いたとき、Windows の提案する大きさに変わることがあるので、画面の全体に置き直す
        DpiChanged += (_, _) => Dispatcher.BeginInvoke(() => WindowPlacement.SetBounds(this, bounds));
        Loaded += (_, _) => WindowPlacement.SetBounds(this, bounds);
    }

    /// <summary>この枠が覆う画面の範囲（物理ピクセル）</summary>
    public PixelRect Bounds => bounds;

    /// <summary>色と文を変える</summary>
    public void Apply(HazardContent hazard)
    {
        Color colour = hazard.IsSensitive ? UiStyle.HazardSensitive : UiStyle.HazardUnknown;
        outer.BorderBrush = UiStyle.Frozen(colour);
        middle.BorderBrush = UiStyle.Frozen(Color.FromArgb(0x90, colour.R, colour.G, colour.B));
        inner.BorderBrush = UiStyle.Frozen(Color.FromArgb(0x40, colour.R, colour.G, colour.B));
        messagePanel.Background = UiStyle.Frozen(Color.FromArgb(0xE6, colour.R, colour.G, colour.B));
        messageText.Text = hazard.Message;
        string names = hazard.NamesLine();
        namesText.Text = names;
        namesText.Visibility = names.Length == 0 ? Visibility.Collapsed : Visibility.Visible;
    }
}
