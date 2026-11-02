using System;
using System.Drawing;
using System.Text.Json.Nodes;
using System.Windows.Forms;
using Pip0Shell.Core;
using Pip0Shell.Ipc;

namespace Pip0Shell.Ui;

/// <summary>
/// 通知領域（タスクバーの右下）のアイコンとメニュー（Windows Forms の NotifyIcon）。画面のスレッドで作り、使います。
///
/// メニューを選ぶと、本体へ tray.command を送ります（何をするかは本体が決めます）。★メニューの文字と順番はここで変えられます。
/// - 状態                       → {"command": "status"}（シェルは状態の画面も開き、本体から届いた最新の状態を見せる）
/// - デスクを表示               → {"command": "show_desk"}
/// - 全復元（自動処理を止める）   → {"command": "kill_switch"}（1回の操作で始める。確認は出さない）
/// - 自動処理を再開（確認）       → 確認画面で「再開する」が押されたときだけ {"command": "resume", "confirmed": true}
/// - 終了                       → {"command": "quit"}（本体が終了を決め、shell.quit を送ってきます）
///
/// ui.notify は吹き出し、ui.status はアイコンの説明（マウスを置いたときの文字）に使います。
/// </summary>
internal sealed class TrayIcon : IDisposable
{
    private const int MaxTipTitleLength = 63;
    private const int MaxTipTextLength = 255;
    private const int MaxIconTextLength = 127;
    private const int BalloonMilliseconds = 10000;

    private readonly ShellOutput output;
    private readonly ContextMenuStrip menu;
    private readonly NotifyIcon notifyIcon;
    private readonly TrayIconImage image;
    private bool disposed;

    /// <param name="openStatus">「状態」が選ばれたときに、状態の画面を開く処理</param>
    /// <param name="confirmResume">「自動処理を再開（確認）」が選ばれたときに、確認画面を出す処理</param>
    public TrayIcon(ShellOutput output, Action openStatus, Action confirmResume)
    {
        this.output = output;

        menu = new ContextMenuStrip();
        menu.Items.Add("状態", null, (_, _) =>
        {
            SendCommand("status");
            openStatus();
        });
        menu.Items.Add("デスクを表示", null, (_, _) => SendCommand("show_desk"));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("全復元（自動処理を止める）", null, (_, _) => SendCommand("kill_switch"));
        menu.Items.Add("自動処理を再開（確認）", null, (_, _) => confirmResume());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("終了", null, (_, _) => SendCommand("quit"));

        image = TrayIconImage.Create();
        notifyIcon = new NotifyIcon
        {
            Icon = image.Icon,
            Text = "pip0",
            ContextMenuStrip = menu,
            Visible = false,
        };
        notifyIcon.DoubleClick += (_, _) =>
        {
            SendCommand("status");
            openStatus();
        };
    }

    public void Show()
    {
        notifyIcon.Visible = true;
    }

    /// <summary>ui.notify の知らせを、アイコンの吹き出しで見せる</summary>
    public void ShowNotification(string title, string message, string level)
    {
        if (disposed)
        {
            return;
        }
        ToolTipIcon icon = level switch
        {
            "warning" => ToolTipIcon.Warning,
            "error" => ToolTipIcon.Error,
            _ => ToolTipIcon.Info,
        };
        string text = string.IsNullOrWhiteSpace(message) ? title : message; // 本文が空だと Windows Forms が受け付けない
        if (string.IsNullOrWhiteSpace(text))
        {
            return;
        }
        notifyIcon.ShowBalloonTip(BalloonMilliseconds, Limit(title, MaxTipTitleLength), Limit(text, MaxTipTextLength), icon);
    }

    /// <summary>ui.status を、アイコンにマウスを置いたときの説明に出す</summary>
    public void ShowStatus(StatusText status)
    {
        if (disposed)
        {
            return;
        }
        notifyIcon.Text = Limit(status.Tooltip(), MaxIconTextLength);
    }

    /// <summary>確認画面で「再開する」が押されたとき</summary>
    public void SendResumeConfirmed()
    {
        output.SendEvent("tray.command", new JsonObject
        {
            ["command"] = "resume",
            ["confirmed"] = true,
        });
        Log.Info("通知領域のメニューが選ばれました（resume、確認済み）。");
    }

    public void Dispose()
    {
        if (disposed)
        {
            return;
        }
        disposed = true;
        notifyIcon.Visible = false;
        notifyIcon.Dispose();
        menu.Dispose();
        image.Dispose();
    }

    private void SendCommand(string command)
    {
        output.SendEvent("tray.command", new JsonObject { ["command"] = command });
        Log.Info("通知領域のメニューが選ばれました（" + command + "）。");
    }

    private static string Limit(string text, int maxLength)
    {
        return text.Length <= maxLength ? text : text.Substring(0, maxLength - 1) + "…";
    }
}
