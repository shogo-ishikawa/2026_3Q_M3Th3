using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Pip0Shell.Core;

namespace Pip0Shell.Ipc;

/// <summary>要求（request）を処理して答えを返す関数。shutdown はシェルの終了の合図</summary>
internal delegate RequestResult RequestHandler(Payload payload, CancellationToken shutdown);

/// <summary>知らせ（event）を処理する関数。受信のスレッドで順番に呼ばれるので、すぐに戻ること</summary>
internal delegate void NotificationHandler(Payload payload);

/// <summary>
/// 届いたメッセージを、"type" ごとの処理へ振り分ける。
///
/// - 要求：処理ごとに別のスレッドで動かし、終わったら同じ id の答えを返す（答えの順番は前後することがある）。
///   init だけは受信のスレッドで処理する（init が終わる前に、次の要求を処理しないため）。
/// - init の前に届いた要求は、init と shell.ping 以外 "not_initialised" で断る。
/// - 知らない type の要求には "unknown_type" で答え、知らない type の知らせは無視する。
/// - 知らせは受信のスレッドで、届いた順に処理する。
///
/// 処理の登録（AddRequest、AddEvent）は、受信を始める前に済ませること。
/// </summary>
internal sealed class MessageRouter
{
    private const int MaxRememberedIgnoredTypes = 100;
    private const int MaxLoggedTypeLength = 64;

    private static readonly HashSet<string> RequestsBeforeInit = new(StringComparer.Ordinal) { "init", "shell.ping" };
    private static readonly HashSet<string> EventsBeforeInit = new(StringComparer.Ordinal) { "shell.quit" };

    private readonly Dictionary<string, RequestRoute> requests = new(StringComparer.Ordinal);
    private readonly Dictionary<string, NotificationHandler> events = new(StringComparer.Ordinal);
    private readonly HashSet<string> ignoredEventTypes = new(StringComparer.Ordinal);
    private readonly ShellOutput output;
    private readonly CancellationToken shutdown;
    private readonly object idleGate = new();
    private int inFlight;
    private volatile bool initialised;

    public MessageRouter(ShellOutput output, CancellationToken shutdown)
    {
        this.output = output;
        this.shutdown = shutdown;
    }

    public bool IsInitialised => initialised;

    /// <summary>要求の処理を登録する。runOnReceiver が真なら、受信のスレッドで（ほかのメッセージより先に）処理する</summary>
    public void AddRequest(string type, RequestHandler handler, bool runOnReceiver = false)
    {
        requests.Add(type, new RequestRoute(handler, runOnReceiver));
    }

    /// <summary>知らせの処理を登録する</summary>
    public void AddEvent(string type, NotificationHandler handler)
    {
        events.Add(type, handler);
    }

    /// <summary>init が終わったことを記録する（これ以降、すべての要求を受け付ける）</summary>
    public void MarkInitialised()
    {
        initialised = true;
    }

    public void Dispatch(IncomingMessage message)
    {
        switch (message.Kind)
        {
            case MessageKind.Request:
                DispatchRequest(message);
                break;
            case MessageKind.Event:
                DispatchEvent(message);
                break;
            default:
                // シェルは本体へ要求を送らないので、本体からの答えは来ないはず
                Log.Warning("pip0 本体からの response は使わないため、無視しました。");
                break;
        }
    }

    /// <summary>処理中の要求がなくなるまで待つ（終了のとき）。時間内に終われば真</summary>
    public bool WaitForIdle(TimeSpan timeout)
    {
        DateTime deadline = DateTime.UtcNow + timeout;
        lock (idleGate)
        {
            while (Volatile.Read(ref inFlight) > 0)
            {
                TimeSpan remaining = deadline - DateTime.UtcNow;
                if (remaining <= TimeSpan.Zero)
                {
                    return false;
                }
                Monitor.Wait(idleGate, remaining);
            }
        }
        return true;
    }

    private void DispatchRequest(IncomingMessage message)
    {
        long id = message.Id ?? 0;
        string type = message.Type;

        if (type.Length == 0)
        {
            output.SendResponse(id, RequestResult.BadRequest("要求に type がありません。"));
            return;
        }
        if (!requests.TryGetValue(type, out RequestRoute? route))
        {
            output.SendResponse(id, RequestResult.Failure(ErrorCodes.UnknownType, "知らない種類の要求です（" + Shorten(type) + "）。"));
            return;
        }
        if (!initialised && !RequestsBeforeInit.Contains(type))
        {
            output.SendResponse(id, RequestResult.Failure(ErrorCodes.NotInitialised, "init の前には、この要求を受け付けられません。"));
            return;
        }
        if (shutdown.IsCancellationRequested)
        {
            output.SendResponse(id, RequestResult.Failure(ErrorCodes.ShuttingDown, "シェルは終了の処理中です。"));
            return;
        }

        if (route.RunOnReceiver)
        {
            Execute(id, type, route.Handler, message.Payload);
            return;
        }

        Interlocked.Increment(ref inFlight);
        // 確認画面の答えを待つなど、長くかかる処理があるため、スレッドプールを塞がない専用のスレッドで動かす
        Task.Factory.StartNew(
            () =>
            {
                try
                {
                    Execute(id, type, route.Handler, message.Payload);
                }
                finally
                {
                    if (Interlocked.Decrement(ref inFlight) == 0)
                    {
                        lock (idleGate)
                        {
                            Monitor.PulseAll(idleGate);
                        }
                    }
                }
            },
            CancellationToken.None,
            TaskCreationOptions.LongRunning,
            TaskScheduler.Default);
    }

    private void Execute(long id, string type, RequestHandler handler, Payload payload)
    {
        RequestResult result;
        try
        {
            result = handler(payload, shutdown);
        }
        catch (Exception error)
        {
            Log.Error("要求（" + type + "）の処理中に予期しないエラーが起きました：" + Log.Describe(error));
            result = RequestResult.Failure(
                ErrorCodes.InternalError,
                "シェルの内部で予期しないエラーが起きました（" + error.GetType().Name + "）。");
        }
        output.SendResponse(id, result);
    }

    private void DispatchEvent(IncomingMessage message)
    {
        string type = message.Type;
        if (!initialised && !EventsBeforeInit.Contains(type))
        {
            ReportIgnoredOnce(type, "init の前に届いた知らせを無視しました");
            return;
        }
        if (!events.TryGetValue(type, out NotificationHandler? handler))
        {
            ReportIgnoredOnce(type, "このシェルが処理しない知らせを無視しました");
            return;
        }
        try
        {
            handler(message.Payload);
        }
        catch (Exception error)
        {
            Log.Error("知らせ（" + type + "）の処理中に予期しないエラーが起きました：" + Log.Describe(error));
        }
    }

    /// <summary>同じ type については1回だけ記録する（ミニドックの更新などが何度も届くため）</summary>
    private void ReportIgnoredOnce(string type, string what)
    {
        if (ignoredEventTypes.Count >= MaxRememberedIgnoredTypes || !ignoredEventTypes.Add(type))
        {
            return;
        }
        Log.Info(what + "（" + Shorten(type) + "。以後は記録しません）。");
    }

    private static string Shorten(string type)
    {
        return type.Length <= MaxLoggedTypeLength ? type : type.Substring(0, MaxLoggedTypeLength) + "…";
    }

    private sealed record RequestRoute(RequestHandler Handler, bool RunOnReceiver);
}
