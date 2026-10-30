using System;
using System.Diagnostics;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using Pip0Shell.Context;
using Pip0Shell.Core;
using Pip0Shell.Ipc;
using Windows.Win32;

namespace Pip0Shell.Ui;

/// <summary>
/// 浮上式デスク（M2。docs/design.md 4-4）：作業中のアプリに関係するファイルの候補を、画面の端に出す。
///
/// - 置き場所：前面のウィンドウがある画面の右端（上下の中央）。ファイルダイアログのとき（dialog_hwnd / dialog_rect）は、
///   ダイアログの上辺に沿って横に並べる（ダイアログが動いたら付いていく）。ダイアログの中に UI は入れません。
/// - 候補：名前、状態（ゴーストは「退避中」）、理由、ボタン（開く／場所を開く／ダイアログに入力）。
///   ボタンは ui.desk.action を送るだけで、開く・入力するかどうかは本体が決めます（本体が shell.open_file 等を頼みます）。
/// - 接近で透過：マウスがデスクから desk_approach_px（100% のときのピクセル数）以内に来たら、不透明度を
///   desk_transparent_opacity にして、クリックを下のウィンドウへ通す（WS_EX_TRANSPARENT）。離れたら戻す。
/// - つまみ（<see cref="DeskHandleWindow"/>）：0.3 秒とどまるかクリックで操作モード（不透明でクリックできる）。
///   マウスが desk_approach_px より離れたら終わる。始まりと終わりを ui.desk.handle で知らせる。
/// - 候補をつかんで、ほかのアプリへドラッグできる（コピーだけ）。このドラッグは「pip0 からのドラッグ」として知らせる。
/// 前面には出ません（ShowActivated = false、WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW）。
/// </summary>
internal sealed class DeskWindow : Window
{
    private const double EdgeWidthDip = 300;
    private const double DialogCardWidthDip = 230;
    private const int MarginAt100 = 8;
    private const int DialogFollowTicks = 10;
    private static readonly TimeSpan TickInterval = TimeSpan.FromMilliseconds(33);

    private readonly ShellOutput output;
    private readonly ShellSettings settings;
    private readonly DeskPressRecorder presses;
    private readonly DeskProximity proximity = new();
    private readonly DeskHandleWindow handle;
    private readonly DispatcherTimer timer;
    private readonly Stopwatch clock = Stopwatch.StartNew();
    private readonly StackPanel layout = new();
    private readonly StackPanel header = new();
    private readonly Panel itemsHost = new StackPanel();
    private readonly WrapPanel dialogItemsHost = new() { Orientation = Orientation.Horizontal };
    private readonly ContentControl itemsSlot = new();
    private DeskContent? content;
    private nint anchorWindow;
    private PixelRect? lastDialogRect;
    private int ticks;
    private Point? dragStart;
    private string? dragPath;

    public DeskWindow(ShellOutput output, ShellSettings settings, DeskPressRecorder presses)
    {
        this.output = output;
        this.settings = settings;
        this.presses = presses;

        Title = "pip0 デスク";
        WindowStyle = WindowStyle.None;
        AllowsTransparency = true; // 透過（Opacity）とクリックの通過に必要
        Background = Brushes.Transparent;
        ResizeMode = ResizeMode.NoResize;
        ShowInTaskbar = false;
        ShowActivated = false;
        Topmost = true;
        SizeToContent = SizeToContent.WidthAndHeight;
        WindowStartupLocation = WindowStartupLocation.Manual;
        Left = WindowPlacement.OffScreen;
        Top = WindowPlacement.OffScreen;

        layout.Children.Add(header);
        layout.Children.Add(itemsSlot);
        Content = UiStyle.Panel(layout);

        handle = new DeskHandleWindow(EngageFromHandle);
        timer = new DispatcherTimer(DispatcherPriority.Background) { Interval = TickInterval };
        timer.Tick += (_, _) => Tick();

        SourceInitialized += (_, _) => WindowPlacement.ApplyFloatingStyle(this, clickThrough: false);
        Loaded += (_, _) => Reposition();
        SizeChanged += (_, _) => Reposition();
        DpiChanged += (_, _) => Dispatcher.BeginInvoke(Reposition);
        Closed += (_, _) =>
        {
            timer.Stop();
            try
            {
                handle.Close(); // 終了のときは、ほかの処理がすでに閉じていることがある
            }
            catch (InvalidOperationException)
            {
            }
        };
    }

    /// <summary>候補を置き換えて表示する</summary>
    public void ShowContent(DeskContent desk)
    {
        content = desk;
        lastDialogRect = null;
        if (!desk.ForDialog)
        {
            // 作業中のアプリのある画面の右端に出す（前面に出ないウィンドウなので、前面は作業中のアプリのまま）
            anchorWindow = (IntPtr)PInvoke.GetForegroundWindow();
        }
        BuildHeader(desk);
        BuildItems(desk);
        if (!IsVisible)
        {
            Show();
            handle.Show();
            ApplyMode(proximity.Mode);
        }
        timer.Start();
        Reposition();
    }

    /// <summary>ui.desk.hide：隠す。操作モードだったら "released" を知らせる</summary>
    public void HideDesk()
    {
        timer.Stop();
        DeskStep step = proximity.Reset();
        if (step.HandleEvent is not null)
        {
            SendHandle(step.HandleEvent);
        }
        ApplyMode(DeskMode.Normal);
        presses.Clear();
        content = null;
        handle.Hide();
        Hide();
    }

    // ------------------------------------------------------------------
    // 中身
    // ------------------------------------------------------------------

    private void BuildHeader(DeskContent desk)
    {
        header.Children.Clear();
        header.Children.Add(UiStyle.Label("pip0 デスク（関係しそうなファイル）", 12, bold: true, UiStyle.SubText));
        if (desk.ContextLabel is not null)
        {
            header.Children.Add(UiStyle.Label("作業中：" + desk.ContextLabel, 11, colour: UiStyle.SubText));
        }
        if (desk.PartnerLabel is not null)
        {
            header.Children.Add(UiStyle.Label(desk.PartnerLabel, 11, colour: UiStyle.SubText));
        }
        if (desk.Items.Count == 0)
        {
            header.Children.Add(UiStyle.Label("候補はありません。", 12));
        }
    }

    private void BuildItems(DeskContent desk)
    {
        itemsHost.Children.Clear();
        dialogItemsHost.Children.Clear();
        Panel host = desk.ForDialog ? dialogItemsHost : itemsHost;
        foreach (DeskItem item in desk.Items)
        {
            Border card = BuildCard(item, desk);
            if (desk.ForDialog)
            {
                card.Width = DialogCardWidthDip;
                card.Margin = new Thickness(0, 6, 6, 0);
            }
            host.Children.Add(card);
        }
        // 全体の幅を決める（長いタイトルなどで、横に広がりすぎないように）
        if (desk.ForDialog)
        {
            itemsSlot.Content = dialogItemsHost;
            layout.Width = DialogWidthDip();
        }
        else
        {
            itemsSlot.Content = itemsHost;
            layout.Width = EdgeWidthDip;
        }
    }

    private Border BuildCard(DeskItem item, DeskContent desk)
    {
        var body = new StackPanel();
        var title = new DockPanel();
        if (item.IsGhost)
        {
            Border chip = UiStyle.Chip("退避中", UiStyle.GhostChip, UiStyle.GhostChipText);
            chip.ToolTip = "中身を保管庫に退避しています。開くと元に戻ります。";
            DockPanel.SetDock(chip, Dock.Right);
            title.Children.Add(chip);
        }
        title.Children.Add(UiStyle.SingleLine(item.Name, 13, bold: true));
        body.Children.Add(title);
        if (item.Reasons.Count > 0)
        {
            body.Children.Add(UiStyle.Label(string.Join("／", item.Reasons), 11, colour: UiStyle.SubText));
        }

        var buttons = new WrapPanel();
        buttons.Children.Add(UiStyle.SmallButton("開く", () => SendAction("open", item), primary: true));
        buttons.Children.Add(UiStyle.SmallButton("場所を開く", () => SendAction("reveal", item)));
        if (desk.ForDialog)
        {
            buttons.Children.Add(UiStyle.SmallButton("ダイアログに入力", () => SendAction("fill_dialog", item)));
        }
        body.Children.Add(buttons);

        Border card = UiStyle.Card(body);
        card.ToolTip = "つかんでほかのアプリへドラッグできます（コピー）";
        card.PreviewMouseLeftButtonDown += (_, e) => OnCardPressed(item, e);
        card.PreviewMouseMove += (_, e) => OnCardMoved(card, e);
        card.PreviewMouseLeftButtonUp += (_, _) =>
        {
            dragStart = null;
            dragPath = null;
        };
        return card;
    }

    private void SendAction(string action, DeskItem item)
    {
        var payload = new JsonObject
        {
            ["action"] = action,
            ["path"] = item.Path,
            ["desk_id"] = content?.DeskId?.ToJson(),
        };
        if (action == "fill_dialog")
        {
            payload["dialog_hwnd"] = content?.DialogHwnd;
        }
        output.SendEvent("ui.desk.action", payload);
        Log.Info("デスクのボタンが押されました（" + action + "）。");
    }

    // ------------------------------------------------------------------
    // 候補をつかんでドラッグする（pip0 からのドラッグ）
    // ------------------------------------------------------------------

    private void OnCardPressed(DeskItem item, MouseButtonEventArgs e)
    {
        if (IsInsideButton(e.OriginalSource as DependencyObject))
        {
            dragStart = null;
            dragPath = null;
            return;
        }
        dragStart = e.GetPosition(this);
        dragPath = item.Path;
        Point screen = PointToScreen(dragStart.Value); // 物理ピクセル
        presses.Record(item.Path, new PixelPoint((int)Math.Round(screen.X), (int)Math.Round(screen.Y)), Environment.TickCount64);
    }

    private void OnCardMoved(Border card, MouseEventArgs e)
    {
        if (dragStart is not Point start || dragPath is not string path || e.LeftButton != MouseButtonState.Pressed)
        {
            return;
        }
        Point now = e.GetPosition(this);
        if (Math.Abs(now.X - start.X) < SystemParameters.MinimumHorizontalDragDistance
            && Math.Abs(now.Y - start.Y) < SystemParameters.MinimumVerticalDragDistance)
        {
            return;
        }
        dragStart = null;
        dragPath = null;
        try
        {
            var data = new DataObject(DataFormats.FileDrop, new[] { path });
            DragDrop.DoDragDrop(card, data, DragDropEffects.Copy); // 元のファイルを動かさないよう、コピーだけを許す
        }
        catch (Exception error)
        {
            Log.Warning("デスクからドラッグできませんでした：" + Log.Describe(error));
        }
    }

    private static bool IsInsideButton(DependencyObject? source)
    {
        for (DependencyObject? current = source; current is not null; current = ParentOf(current))
        {
            if (current is ButtonBase)
            {
                return true;
            }
            if (current is DeskWindow)
            {
                return false;
            }
        }
        return false;
    }

    /// <summary>画面の部品の親（文字の一部のような、画面の木にない部品は論理の木の親）</summary>
    private static DependencyObject? ParentOf(DependencyObject current)
    {
        return current is Visual or System.Windows.Media.Media3D.Visual3D
            ? VisualTreeHelper.GetParent(current)
            : LogicalTreeHelper.GetParent(current);
    }

    // ------------------------------------------------------------------
    // 接近で透過・つまみで操作モード
    // ------------------------------------------------------------------

    private void Tick()
    {
        if (!IsVisible)
        {
            return;
        }
        ticks++;
        if (content is { ForDialog: true } && ticks % DialogFollowTicks == 0)
        {
            PixelRect? dialog = CurrentDialogRect();
            if (dialog != lastDialogRect)
            {
                Reposition();
            }
        }

        if (WindowPlacement.GetRect(this) is not PixelRect deskRect)
        {
            return;
        }
        PixelRect handleRect = WindowPlacement.GetRect(handle) ?? default;
        PixelPoint? cursor = PInvoke.GetCursorPos(out System.Drawing.Point point) ? new PixelPoint(point.X, point.Y) : null;
        double approach = settings.DeskApproachPx * WindowPlacement.ScaleOf(this);
        DeskStep step = proximity.Update(clock.ElapsedMilliseconds, cursor, deskRect, handleRect, approach);
        if (step.ModeChanged)
        {
            ApplyMode(step.Mode);
        }
        if (step.HandleEvent is not null)
        {
            SendHandle(step.HandleEvent);
        }
    }

    private void EngageFromHandle()
    {
        DeskStep step = proximity.Engage();
        if (step.ModeChanged)
        {
            ApplyMode(step.Mode);
        }
        if (step.HandleEvent is not null)
        {
            SendHandle(step.HandleEvent);
        }
    }

    private void ApplyMode(DeskMode mode)
    {
        bool faded = mode == DeskMode.Faded;
        Opacity = faded ? settings.DeskTransparentOpacity : 1.0;
        WindowPlacement.SetClickThrough(this, faded);
        handle.SetEngaged(mode == DeskMode.Engaged);
    }

    private void SendHandle(string state)
    {
        output.SendEvent("ui.desk.handle", new JsonObject { ["state"] = state });
    }

    // ------------------------------------------------------------------
    // 置き場所
    // ------------------------------------------------------------------

    /// <summary>ダイアログの今の位置（ダイアログがあれば、届いた位置より今の位置を使う）</summary>
    private PixelRect? CurrentDialogRect()
    {
        if (content?.DialogHwnd is long hwnd)
        {
            var window = WindowInfo.FromNumber(hwnd);
            if (PInvoke.IsWindow(window) && WindowInfo.GetFrameRect(window) is PixelRect live)
            {
                return live;
            }
        }
        return content?.DialogRect;
    }

    private double DialogWidthDip()
    {
        PixelRect? dialog = CurrentDialogRect();
        double scale = WindowPlacement.ScaleOf(this);
        double width = dialog is PixelRect rect ? rect.Width / scale : 3 * (DialogCardWidthDip + 6);
        return Math.Clamp(width, DialogCardWidthDip + 6, 4 * (DialogCardWidthDip + 6));
    }

    private void Reposition()
    {
        if (!IsVisible || content is null || WindowPlacement.GetRect(this) is not PixelRect rect)
        {
            return;
        }
        double scale = WindowPlacement.ScaleOf(this);
        int margin = ScreenGeometry.Scale(MarginAt100, scale);
        int handleWidth = WindowPlacement.GetRect(handle)?.Width ?? ScreenGeometry.Scale(22, scale);

        PixelPoint position;
        PixelRect? dialog = content.ForDialog ? CurrentDialogRect() : null;
        if (dialog is PixelRect dialogRect)
        {
            lastDialogRect = dialogRect;
            PixelRect work = WindowPlacement.WorkAreaOfRect(dialogRect);
            // つまみを左に付けるので、その分だけ作業領域を狭めて計算する
            var usable = new PixelRect(work.Left + handleWidth, work.Top, work.Right, work.Bottom);
            position = ScreenGeometry.AlongDialogTop(dialogRect, usable, rect.Width, rect.Height, margin);
        }
        else
        {
            PixelRect work = WindowPlacement.WorkAreaOfWindow(anchorWindow);
            position = ScreenGeometry.RightEdgeCentre(work, rect.Width, rect.Height, margin);
        }
        WindowPlacement.MoveTo(this, position);

        if (WindowPlacement.GetRect(handle) is PixelRect handleRect)
        {
            int top = position.Y + Math.Max(0, (rect.Height - handleRect.Height) / 2);
            WindowPlacement.MoveTo(handle, new PixelPoint(position.X - handleRect.Width, top));
        }
    }
}
