using System.Windows;
using System.Windows.Controls;

namespace Pip0Shell.Ui;

/// <summary>
/// 状態の画面：通知領域のメニュー「状態」で開く、普通のウィンドウ。
/// 本体から届いた最新の ui.status（自動処理、高負荷の処理の条件、全復元の進み具合、機能の状態）を文で見せます。
/// 開いている間に ui.status が届くと、書き換わります。
/// </summary>
internal sealed class StatusWindow : Window
{
    private readonly TextBox text;

    public StatusWindow()
    {
        Title = "pip0 の状態";
        Width = 560;
        Height = 420;
        MinWidth = 360;
        MinHeight = 240;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        ShowInTaskbar = true;

        text = new TextBox
        {
            IsReadOnly = true,
            TextWrapping = TextWrapping.Wrap,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            FontFamily = UiStyle.Font,
            FontSize = 13,
            BorderThickness = new Thickness(0),
            Padding = new Thickness(4),
        };

        var close = new Button
        {
            Content = "閉じる",
            MinWidth = 90,
            Padding = new Thickness(10, 3, 10, 3),
            Margin = new Thickness(0, 10, 0, 0),
            HorizontalAlignment = HorizontalAlignment.Right,
            IsCancel = true,
        };
        close.Click += (_, _) => Close();

        var layout = new DockPanel { Margin = new Thickness(14) };
        DockPanel.SetDock(close, Dock.Bottom);
        layout.Children.Add(close);
        layout.Children.Add(text);
        Content = layout;
    }

    public void ShowStatus(StatusText status)
    {
        text.Text = string.Join("\n", status.Lines);
    }
}
