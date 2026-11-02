using System;
using System.Windows;
using System.Windows.Controls;

namespace Pip0Shell.Ui;

/// <summary>
/// 「自動処理を再開」の確認画面（docs/design.md 4-9 の 6）。
/// 「再開する」が押されたときだけ onConfirmed を呼びます（本体へ tray.command の resume と confirmed: true を送る）。
/// 最初は「キャンセル」にフォーカスを置き、Enter キーで誤って再開しないようにします。閉じたときは何もしません。
/// </summary>
internal sealed class ConfirmResumeWindow : Window
{
    public ConfirmResumeWindow(Action onConfirmed)
    {
        Title = "自動処理の再開の確認（pip0）";
        Width = 460;
        SizeToContent = SizeToContent.Height;
        ResizeMode = ResizeMode.NoResize;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Topmost = true;
        ShowInTaskbar = true;

        var panel = new StackPanel { Margin = new Thickness(18) };
        panel.Children.Add(new TextBlock
        {
            Text = "自動処理を再開しますか？",
            FontFamily = UiStyle.Font,
            FontSize = 15,
            FontWeight = FontWeights.SemiBold,
            Margin = new Thickness(0, 0, 0, 8),
        });
        panel.Children.Add(new TextBlock
        {
            Text = "全復元で止めた、自動仕分け・自動改名・自動退避を、もう一度動かします。"
                + "全復元が途中のときは、pip0 本体が再開を断ります（先に全復元を最後まで実行してください）。",
            FontFamily = UiStyle.Font,
            TextWrapping = TextWrapping.Wrap,
            Foreground = SystemColors.GrayTextBrush,
            Margin = new Thickness(0, 0, 0, 14),
        });

        var resume = new Button
        {
            Content = "再開する",
            MinWidth = 110,
            Padding = new Thickness(12, 4, 12, 4),
            Margin = new Thickness(0, 0, 8, 0),
        };
        resume.Click += (_, _) =>
        {
            onConfirmed();
            Close();
        };
        var cancel = new Button
        {
            Content = "キャンセル",
            MinWidth = 100,
            Padding = new Thickness(12, 4, 12, 4),
            IsCancel = true,
        };

        var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
        buttons.Children.Add(resume);
        buttons.Children.Add(cancel);
        panel.Children.Add(buttons);
        Content = panel;

        Loaded += (_, _) =>
        {
            Activate();
            cancel.Focus();
        };
    }
}
