using System;
using System.Collections.Generic;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Pip0Shell.Core;
using Pip0Shell.Ipc;

namespace Pip0Shell.Ui;

/// <summary>
/// ミニドック（M1。docs/design.md 4-3）：ダウンロードの完了の直後に、主モニターの作業領域の右下に出す小さな画面。
///
/// - 枠のない最前面のウィンドウで、前面には出ません（ShowActivated = false、WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW）。
///   ボタンを押しても、作業中のアプリからキーボードの入力先を奪いません。
/// - 1つのダウンロードが1行：ファイル名、仕分け先、新しい名前、理由、ボタン（提案どおり／別の仕分け先／そのまま／開く）。
///   ボタンを押すと ui.mini_dock.action を送り、その行のボタンを押せなくします（行を消すのは本体からの次の表示）。
/// - マウスが乗った・離れたら ui.mini_dock.interaction（"enter" / "leave"）を送ります（本体が残り時間を止める・数え直す）。
/// - 行は ui.mini_dock.show のたびに、届いた内容で置き換えます。いつ閉じるかは本体が決めます。
/// </summary>
internal sealed class MiniDockWindow : Window
{
    private const double WidthDip = 380;
    private const int MarginAt100 = 12;

    private readonly ShellOutput output;
    private readonly StackPanel rowsPanel = new();
    private EchoId dockId;
    private bool pointerInside;

    public MiniDockWindow(ShellOutput output)
    {
        this.output = output;

        Title = "pip0 ミニドック";
        WindowStyle = WindowStyle.None;
        AllowsTransparency = true;
        Background = Brushes.Transparent;
        ResizeMode = ResizeMode.NoResize;
        ShowInTaskbar = false;
        ShowActivated = false;
        Topmost = true;
        SizeToContent = SizeToContent.Height;
        Width = WidthDip;
        WindowStartupLocation = WindowStartupLocation.Manual;
        Left = WindowPlacement.OffScreen;
        Top = WindowPlacement.OffScreen;

        var layout = new StackPanel();
        layout.Children.Add(UiStyle.Label("ダウンロードの仕分け（pip0）", 12, bold: true, UiStyle.SubText));
        layout.Children.Add(rowsPanel);
        Content = UiStyle.Panel(layout);

        SourceInitialized += (_, _) => WindowPlacement.ApplyFloatingStyle(this, clickThrough: false);
        Loaded += (_, _) => Reposition();
        SizeChanged += (_, _) => Reposition();
        DpiChanged += (_, _) => Dispatcher.BeginInvoke(Reposition);
        MouseEnter += (_, _) => SendInteraction("enter");
        MouseLeave += (_, _) => SendInteraction("leave");
    }

    /// <summary>今表示しているミニドックの dock_id</summary>
    public EchoId DockId => dockId;

    /// <summary>行を置き換えて表示する</summary>
    public void ShowContent(MiniDockContent content)
    {
        bool idChanged = content.DockId != dockId;
        dockId = content.DockId;
        rowsPanel.Children.Clear();
        foreach (MiniDockRow row in content.Rows)
        {
            rowsPanel.Children.Add(BuildRow(row));
        }
        if (!IsVisible)
        {
            pointerInside = false;
            Show();
        }
        else if (idChanged && pointerInside)
        {
            // 別のミニドックに変わったとき、マウスが乗ったままなら、新しい dock_id でも知らせる
            SendInteraction("enter", force: true);
        }
        Reposition();
    }

    /// <summary>ui.mini_dock.close：閉じる（隠す）</summary>
    public void HideDock()
    {
        pointerInside = false;
        rowsPanel.Children.Clear();
        Hide();
    }

    private UIElement BuildRow(MiniDockRow row)
    {
        var body = new StackPanel();
        var buttons = new WrapPanel();

        var title = new DockPanel();
        string? chip = row.Status switch
        {
            MiniDockContent.StatusNoCandidate => "仕分け先の候補なし",
            MiniDockContent.StatusNeedsAnalysis => "解析待ち",
            _ => null,
        };
        if (chip is not null)
        {
            Border chipBorder = UiStyle.Chip(chip, UiStyle.WaitChip, UiStyle.WaitChipText);
            DockPanel.SetDock(chipBorder, Dock.Right);
            title.Children.Add(chipBorder);
        }
        title.Children.Add(UiStyle.SingleLine(row.FileName, 13, bold: true));
        body.Children.Add(title);

        body.Children.Add(UiStyle.Label(
            row.DestLabel is null ? "仕分け先：候補がありません（何も移動しません）" : "仕分け先：" + row.DestLabel,
            12));
        if (row.NewName is not null)
        {
            body.Children.Add(UiStyle.Label("新しい名前：" + row.NewName, 12));
        }
        else if (row.Status == MiniDockContent.StatusNeedsAnalysis)
        {
            body.Children.Add(UiStyle.Label("新しい名前：解析の後に決めます", 12, colour: UiStyle.SubText));
        }
        if (row.Reasons.Count > 0)
        {
            body.Children.Add(UiStyle.Label("理由：" + string.Join("／", row.Reasons), 11, colour: UiStyle.SubText));
        }
        if (row.ContextLabel is not null)
        {
            body.Children.Add(UiStyle.Label("作業中：" + row.ContextLabel, 11, colour: UiStyle.SubText));
        }

        var all = new List<Button>();
        void Send(string action, long? alternativeIndex)
        {
            foreach (Button button in all)
            {
                button.IsEnabled = false; // 2回押されないように。行は本体からの次の表示で置き換わる
            }
            SendAction(row, action, alternativeIndex);
        }

        Button accept = UiStyle.SmallButton("提案どおり", () => Send("accept", null), primary: true);
        accept.IsEnabled = row.CanAccept;
        all.Add(accept);
        foreach (MiniDockAlternative alternative in row.Alternatives)
        {
            all.Add(UiStyle.SmallButton(alternative.Label, () => Send("alternative", alternative.Index)));
        }
        all.Add(UiStyle.SmallButton("そのまま", () => Send("keep", null)));
        all.Add(UiStyle.SmallButton("開く", () => Send("open", null)));
        foreach (Button button in all)
        {
            buttons.Children.Add(button);
        }
        body.Children.Add(buttons);
        return UiStyle.Card(body);
    }

    private void SendAction(MiniDockRow row, string action, long? alternativeIndex)
    {
        output.SendEvent("ui.mini_dock.action", new JsonObject
        {
            ["dock_id"] = dockId.ToJson(),
            ["entry_id"] = row.EntryId.ToJson(),
            ["action"] = action,
            ["alternative_index"] = alternativeIndex,
        });
        Log.Info("ミニドックのボタンが押されました（" + action + "）。");
    }

    private void SendInteraction(string state, bool force = false)
    {
        bool inside = state == "enter";
        if (!force && inside == pointerInside)
        {
            return;
        }
        pointerInside = inside;
        if (!IsVisible)
        {
            return;
        }
        output.SendEvent("ui.mini_dock.interaction", new JsonObject
        {
            ["dock_id"] = dockId.ToJson(),
            ["state"] = state,
        });
    }

    /// <summary>主モニターの作業領域の右下に置く</summary>
    private void Reposition()
    {
        if (!IsVisible || WindowPlacement.GetRect(this) is not PixelRect rect)
        {
            return;
        }
        double scale = WindowPlacement.ScaleOf(this);
        PixelPoint position = ScreenGeometry.BottomRight(
            WindowPlacement.PrimaryWorkArea(),
            rect.Width,
            rect.Height,
            ScreenGeometry.Scale(MarginAt100, scale));
        WindowPlacement.MoveTo(this, position);
    }
}
