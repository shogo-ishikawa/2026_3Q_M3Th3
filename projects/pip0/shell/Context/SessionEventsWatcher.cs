using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text.Json.Nodes;
using Microsoft.Win32;
using Pip0Shell.Core;
using Pip0Shell.Ipc;

namespace Pip0Shell.Context;

/// <summary>
/// Windows のセッションの出来事を、session.event で本体へ知らせる（M5 の「同じセッション」の区切りに使う。docs/design.md 4-7）。
///
/// | Windows の知らせ（Microsoft.Win32.SystemEvents） | kind |
/// | --- | --- |
/// | SessionSwitch：SessionLock / SessionUnlock / SessionLogoff | "lock" / "unlock" / "logoff" |
/// | PowerModeChanged：Suspend / Resume | "suspend" / "resume" |
/// | SessionEnding：SystemShutdown / Logoff | "shutdown" / "logoff" |
///
/// 同じ kind が 2 秒以内に続いたら1回にまとめます（サインアウトは2通りの知らせで届くことがあるため）。
/// 何をするか（消音の記録を消す等）は本体が決めます。
/// </summary>
internal sealed class SessionEventsWatcher
{
    private const long DuplicateMilliseconds = 2000;

    private readonly ShellOutput output;
    private readonly object gate = new();
    private readonly Dictionary<string, long> lastSent = new(StringComparer.Ordinal);
    private readonly Stopwatch clock = Stopwatch.StartNew();
    private bool subscribed;

    public SessionEventsWatcher(ShellOutput output)
    {
        this.output = output;
    }

    /// <summary>知らせを受け取り始める。始められたら真</summary>
    public bool Start(out string reason)
    {
        try
        {
            SystemEvents.SessionSwitch += OnSessionSwitch;
            SystemEvents.PowerModeChanged += OnPowerModeChanged;
            SystemEvents.SessionEnding += OnSessionEnding;
            subscribed = true;
            reason = "";
            return true;
        }
        catch (Exception error)
        {
            Log.Warning("セッションの知らせを受け取れません：" + Log.Describe(error));
            reason = "画面のロック・スリープ等の知らせ（SystemEvents）を受け取れません（" + error.GetType().Name + "）。";
            Stop();
            return false;
        }
    }

    public void Stop()
    {
        if (!subscribed)
        {
            return;
        }
        subscribed = false;
        try
        {
            SystemEvents.SessionSwitch -= OnSessionSwitch;
            SystemEvents.PowerModeChanged -= OnPowerModeChanged;
            SystemEvents.SessionEnding -= OnSessionEnding;
        }
        catch (Exception error)
        {
            Log.Warning("セッションの知らせの受け取りを止められませんでした：" + Log.Describe(error));
        }
    }

    private void OnSessionSwitch(object? sender, SessionSwitchEventArgs e)
    {
        string? kind = e.Reason switch
        {
            SessionSwitchReason.SessionLock => "lock",
            SessionSwitchReason.SessionUnlock => "unlock",
            SessionSwitchReason.SessionLogoff => "logoff",
            _ => null,
        };
        Send(kind);
    }

    private void OnPowerModeChanged(object? sender, PowerModeChangedEventArgs e)
    {
        string? kind = e.Mode switch
        {
            PowerModes.Suspend => "suspend",
            PowerModes.Resume => "resume",
            _ => null,
        };
        Send(kind);
    }

    private void OnSessionEnding(object? sender, SessionEndingEventArgs e)
    {
        Send(e.Reason == SessionEndReasons.SystemShutdown ? "shutdown" : "logoff");
    }

    private void Send(string? kind)
    {
        if (kind is null)
        {
            return;
        }
        try
        {
            long now = clock.ElapsedMilliseconds;
            lock (gate)
            {
                if (lastSent.TryGetValue(kind, out long previous) && now - previous < DuplicateMilliseconds)
                {
                    return;
                }
                lastSent[kind] = now;
            }
            output.SendEvent("session.event", new JsonObject { ["kind"] = kind });
            Log.Info("セッションの出来事を知らせました（" + kind + "）。");
        }
        catch (Exception error)
        {
            // SystemEvents のスレッドで例外を外へ出さない
            Log.Error("セッションの出来事を知らせられませんでした：" + Log.Describe(error));
        }
    }
}
