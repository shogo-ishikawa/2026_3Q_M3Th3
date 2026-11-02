using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace Pip0Shell.Ui;

/// <summary>
/// ミニドック・デスク・警告の枠で共通に使う色と部品。★色や文字の大きさを変えたいときは、ここを変えてください。
/// </summary>
internal static class UiStyle
{
    /// <summary>日本語の UI の字体（Windows 11 の標準。なければ次の候補）</summary>
    public static readonly FontFamily Font = new("Yu Gothic UI, Meiryo UI, Segoe UI");

    public static readonly Brush PanelBackground = Frozen(Color.FromArgb(0xF5, 0xFA, 0xFA, 0xFC));
    public static readonly Brush PanelBorder = Frozen(Color.FromArgb(0xFF, 0xC8, 0xCC, 0xD8));
    public static readonly Brush CardBackground = Frozen(Color.FromArgb(0xFF, 0xFF, 0xFF, 0xFF));
    public static readonly Brush CardBorder = Frozen(Color.FromArgb(0xFF, 0xE1, 0xE4, 0xEC));
    public static readonly Brush Text = Frozen(Color.FromArgb(0xFF, 0x1F, 0x23, 0x2E));
    public static readonly Brush SubText = Frozen(Color.FromArgb(0xFF, 0x5B, 0x63, 0x75));
    public static readonly Brush Accent = Frozen(Color.FromArgb(0xFF, 0x3D, 0x5A, 0xC8));
    public static readonly Brush AccentText = Frozen(Colors.White);
    public static readonly Brush GhostChip = Frozen(Color.FromArgb(0xFF, 0xE3, 0xE8, 0xFA));
    public static readonly Brush GhostChipText = Frozen(Color.FromArgb(0xFF, 0x2E, 0x45, 0x9E));
    public static readonly Brush WaitChip = Frozen(Color.FromArgb(0xFF, 0xFF, 0xF1, 0xD6));
    public static readonly Brush WaitChipText = Frozen(Color.FromArgb(0xFF, 0x8A, 0x55, 0x00));

    /// <summary>機密（sensitive）の枠の色：赤</summary>
    public static readonly Color HazardSensitive = Color.FromArgb(0xFF, 0xE5, 0x39, 0x35);

    /// <summary>機密か未判定（unknown）の枠の色：橙</summary>
    public static readonly Color HazardUnknown = Color.FromArgb(0xFF, 0xFB, 0x8C, 0x00);

    public static Brush Frozen(Color colour)
    {
        var brush = new SolidColorBrush(colour);
        brush.Freeze();
        return brush;
    }

    /// <summary>文字（折り返しあり）</summary>
    public static TextBlock Label(string text, double size = 12, bool bold = false, Brush? colour = null)
    {
        return new TextBlock
        {
            Text = text,
            FontFamily = Font,
            FontSize = size,
            FontWeight = bold ? FontWeights.SemiBold : FontWeights.Normal,
            Foreground = colour ?? Text,
            TextWrapping = TextWrapping.Wrap,
        };
    }

    /// <summary>1行で、長ければ「…」で切る文字</summary>
    public static TextBlock SingleLine(string text, double size = 12, bool bold = false, Brush? colour = null)
    {
        TextBlock block = Label(text, size, bold, colour);
        block.TextWrapping = TextWrapping.NoWrap;
        block.TextTrimming = TextTrimming.CharacterEllipsis;
        block.ToolTip = text;
        return block;
    }

    /// <summary>小さなボタン。primary なら目立つ色にする</summary>
    public static Button SmallButton(string text, Action onClick, bool primary = false)
    {
        var button = new Button
        {
            Content = text,
            FontFamily = Font,
            FontSize = 12,
            Padding = new Thickness(8, 2, 8, 2),
            Margin = new Thickness(0, 4, 6, 0),
            MinWidth = 48,
            Focusable = false, // 前面に出ないウィンドウなので、キーボードの入力先にしない
            Cursor = System.Windows.Input.Cursors.Hand,
        };
        if (primary)
        {
            button.Background = Accent;
            button.Foreground = AccentText;
            button.BorderBrush = Accent;
        }
        button.Click += (_, _) => onClick();
        return button;
    }

    /// <summary>「退避中」などの小さな札</summary>
    public static Border Chip(string text, Brush background, Brush foreground)
    {
        return new Border
        {
            Background = background,
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(6, 0, 6, 1),
            Margin = new Thickness(6, 0, 0, 0),
            VerticalAlignment = VerticalAlignment.Center,
            Child = new TextBlock
            {
                Text = text,
                FontFamily = Font,
                FontSize = 11,
                Foreground = foreground,
            },
        };
    }

    /// <summary>1件分のカード</summary>
    public static Border Card(UIElement child)
    {
        return new Border
        {
            Background = CardBackground,
            BorderBrush = CardBorder,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(6),
            Padding = new Thickness(10, 8, 10, 8),
            Margin = new Thickness(0, 6, 0, 0),
            Child = child,
        };
    }

    /// <summary>ウィンドウ全体の枠</summary>
    public static Border Panel(UIElement child)
    {
        return new Border
        {
            Background = PanelBackground,
            BorderBrush = PanelBorder,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(10, 8, 10, 10),
            Child = child,
        };
    }
}
