using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace Pip0Shell.Trash;

/// <summary>
/// ごみ箱へ移す前に、必ず出す確認画面（WPF）。対象のファイル名と件数を示し、
/// 「ごみ箱へ移動」が押されたときだけ承認とします。
///
/// - 「キャンセル」または Esc キー：Answer = "cancel"
/// - 画面を閉じた（×、Alt+F4、シェルの終了）：Answer = "closed"
/// どちらも何も削除しません。誤って Enter キーで承認しないよう、最初は「キャンセル」にフォーカスを置きます。
/// </summary>
internal sealed class ConfirmDeleteWindow : Window
{
    public const string AnswerApprove = "approve";
    public const string AnswerCancel = "cancel";
    public const string AnswerClosed = "closed";

    private const int MaxListedNames = 500;

    public ConfirmDeleteWindow(string title, string message, IReadOnlyList<TrashItem> items)
    {
        Title = title;
        Width = 520;
        SizeToContent = SizeToContent.Height;
        ResizeMode = ResizeMode.NoResize;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Topmost = true;
        ShowInTaskbar = true;
        ShowActivated = true;

        var panel = new StackPanel { Margin = new Thickness(18) };

        panel.Children.Add(new TextBlock
        {
            Text = items.Count + " 件のファイルを、ごみ箱へ移動しますか？" + TotalSizeText(items),
            FontSize = 15,
            FontWeight = FontWeights.SemiBold,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 8),
        });

        if (!string.IsNullOrWhiteSpace(message))
        {
            panel.Children.Add(new TextBlock
            {
                Text = message,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 0, 0, 8),
            });
        }

        var list = new ListBox
        {
            MaxHeight = 260,
            Margin = new Thickness(0, 0, 0, 8),
        };
        foreach (TrashItem item in items.Take(MaxListedNames))
        {
            list.Items.Add(new ListBoxItem { Content = item.DisplayLine, ToolTip = item.Path });
        }
        if (items.Count > MaxListedNames)
        {
            list.Items.Add(new ListBoxItem { Content = "ほか " + (items.Count - MaxListedNames) + " 件", IsEnabled = false });
        }
        panel.Children.Add(list);

        panel.Children.Add(new TextBlock
        {
            Text = "ごみ箱に入れられない場所のファイルは、削除せずにそのまま残します（完全に削除することはありません）。",
            TextWrapping = TextWrapping.Wrap,
            FontSize = 12,
            Foreground = SystemColors.GrayTextBrush,
            Margin = new Thickness(0, 0, 0, 14),
        });

        var approve = new Button
        {
            Content = "ごみ箱へ移動",
            MinWidth = 120,
            Padding = new Thickness(12, 4, 12, 4),
            Margin = new Thickness(0, 0, 8, 0),
        };
        approve.Click += (_, _) =>
        {
            Answer = AnswerApprove;
            DialogResult = true;
        };

        // IsCancel：Esc キーでも押される。押されると WPF が画面を閉じる
        var cancel = new Button
        {
            Content = "キャンセル",
            MinWidth = 100,
            Padding = new Thickness(12, 4, 12, 4),
            IsCancel = true,
        };
        cancel.Click += (_, _) => Answer = AnswerCancel;

        var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
        buttons.Children.Add(approve);
        buttons.Children.Add(cancel);
        panel.Children.Add(buttons);

        Content = panel;
        Loaded += (_, _) =>
        {
            Activate();
            cancel.Focus();
        };
    }

    /// <summary>"approve"（承認）、"cancel"（キャンセル）、"closed"（閉じた）のどれか</summary>
    public string Answer { get; private set; } = AnswerClosed;

    private static string TotalSizeText(IReadOnlyList<TrashItem> items)
    {
        if (items.Count == 0 || items.Any(item => item.Size is null))
        {
            return "";
        }
        long total = items.Sum(item => item.Size ?? 0);
        return "（合計 " + TrashItem.FormatSize(total) + "）";
    }
}
