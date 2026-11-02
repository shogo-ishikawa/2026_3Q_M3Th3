using System;
using System.Text.Json.Nodes;
using System.Threading;
using Pip0Shell.CloudFiles;
using Pip0Shell.Core;
using Pip0Shell.Ipc;
using Pip0Shell.Trash;
using Pip0Shell.Ui;

namespace Pip0Shell;

/// <summary>
/// シェル全体の流れ：部品を組み立て、本体からのメッセージを受け、終了の指示か標準入力の終わりで片付けて終わる。
///
/// 1. 標準入出力の通信を始め、shell.ready を送る（init の前の見込みの capabilities を付ける）。
/// 2. init を受けたら、場所と設定を記録し、画面あり（--headless でない）なら画面を出し、OS の見張り
///    （前面ウィンドウ、マウスのフックとドラッグ、セッション、最近使ったファイル）を始める。init の答えで capabilities を確定する。
///    init の前は、init と shell.ping 以外の要求を "not_initialised" で断る。
/// 3. shell.quit を受けるか、標準入力が閉じられたら（本体が終わったら）終了する。
///    見張りを止め、開いている確認画面を閉じ（何も削除しない）、処理中の FETCH_DATA をエラーで返し、同期ルートとの接続を切る。
/// </summary>
internal sealed class ShellApplication
{
    private readonly ShellState state;
    private readonly JsonLineChannel channel;
    private readonly ShellOutput output;
    private readonly MessageRouter router;
    private readonly FeatureReporter features;
    private readonly UiModule ui;
    private readonly CloudFilesModule cloudFiles;
    private readonly TrashModule trash;
    private readonly CancellationTokenSource shutdown = new();
    private int shutdownRequested;

    public ShellApplication(CommandLineOptions options, string userSid)
    {
        state = new ShellState(options);
        channel = new JsonLineChannel(Console.OpenStandardInput(), Console.OpenStandardOutput());
        output = new ShellOutput(channel);
        router = new MessageRouter(output, shutdown.Token);
        features = new FeatureReporter(output);
        ui = new UiModule(output, features);
        cloudFiles = new CloudFilesModule(output, state, features, userSid);
        trash = new TrashModule(state, ui, features);
    }

    /// <summary>終了の指示か、標準入力の終わりまで動かす</summary>
    public void Run()
    {
        RegisterHandlers();

        // shell.ready を、ほかのどの答えよりも先に送る（受信を始める前に送る）
        AnnounceReady();

        var receiver = new Thread(ReceiveLoop)
        {
            IsBackground = true,
            Name = "pip0 receiver",
        };
        receiver.Start();

        shutdown.Token.WaitHandle.WaitOne();
        ShutDown();
    }

    private void RegisterHandlers()
    {
        // init は受信のスレッドで処理し、終わるまで次のメッセージを処理しない
        router.AddRequest("init", HandleInit, runOnReceiver: true);
        router.AddRequest("shell.ping", HandlePing);
        router.AddEvent("shell.quit", _ => RequestShutdown("pip0 本体から終了の指示（shell.quit）を受けました。"));

        cloudFiles.RegisterHandlers(router);
        trash.RegisterHandlers(router);
        ui.RegisterHandlers(router);
    }

    /// <summary>shell.ready：受け付けを始めたことを知らせる。capabilities は起動時点の見込み（確定値は init の答え）</summary>
    private void AnnounceReady()
    {
        bool headless = state.Options.Headless;
        var expected = new Capabilities
        {
            CloudFiles = CloudFilesModule.ProbeSupported(),
            Trash = !headless,
            Ui = !headless,
            Hooks = !headless,
        };
        output.SendEvent("shell.ready", new JsonObject
        {
            ["shell_version"] = ShellInfo.Version,
            ["capabilities"] = expected.ToJson(),
        });
        Log.Info("受け付けを始めました（" + (headless ? "表示なし" : "表示あり") + "）。");
    }

    private RequestResult HandleInit(Payload payload, CancellationToken token)
    {
        long? protocol = payload.GetInt64("protocol");
        if (protocol != ShellInfo.ProtocolVersion)
        {
            return RequestResult.Failure(
                ErrorCodes.UnsupportedProtocol,
                "通信の版（protocol）が違います。このシェルは " + ShellInfo.ProtocolVersion + " だけに対応しています。");
        }

        SessionConfiguration? configuration = SessionConfiguration.FromPayload(payload, state.Options.Headless, out string problem);
        if (configuration is null)
        {
            return RequestResult.BadRequest(problem);
        }

        SessionConfiguration? existing = state.Configuration;
        if (existing is not null)
        {
            if (existing.SameLocations(configuration))
            {
                return RequestResult.Success(InitAnswer());
            }
            return RequestResult.Failure(
                ErrorCodes.AlreadyInitialised,
                "init はすでに別の内容で済んでいます。場所を変えるときは、シェルを起動し直してください。");
        }

        state.Configuration = configuration;
        Capabilities capabilities = state.Capabilities;
        capabilities.CloudFiles = cloudFiles.Initialise(configuration);

        bool uiReady = false;
        bool hooksReady = false;
        if (!configuration.Headless)
        {
            uiReady = ui.Start(configuration, out string uiProblem);
            if (!uiReady)
            {
                Log.Error("画面を準備できませんでした：" + uiProblem);
            }
            // 見張り（フック等）は画面がなくても動くので、画面の準備に失敗しても始める
            hooksReady = ui.StartObservers(configuration);
        }
        capabilities.Ui = uiReady;
        capabilities.Trash = trash.Initialise(uiReady, configuration.Headless);
        capabilities.Hooks = hooksReady;

        router.MarkInitialised();
        Log.Info("init を受け付けました（画面：" + (uiReady ? "あり" : "なし") + "、フック：" + (hooksReady ? "あり" : "なし") + "）。");
        return RequestResult.Success(InitAnswer());
    }

    private JsonObject InitAnswer()
    {
        return new JsonObject
        {
            ["shell_version"] = ShellInfo.Version,
            ["capabilities"] = state.Capabilities.ToJson(),
        };
    }

    private RequestResult HandlePing(Payload payload, CancellationToken token)
    {
        return RequestResult.Success(new JsonObject
        {
            ["time"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0,
        });
    }

    /// <summary>受信のスレッド：1行ずつ読み、振り分ける</summary>
    private void ReceiveLoop()
    {
        try
        {
            while (!shutdown.IsCancellationRequested)
            {
                ReadOutcome outcome = channel.ReadLine(out byte[] line);
                if (outcome == ReadOutcome.EndOfStream)
                {
                    RequestShutdown("標準入力が閉じられました（pip0 本体が終了しました）。");
                    return;
                }
                if (outcome == ReadOutcome.TooLong)
                {
                    Log.Error("1 MiB を超える行を受け取ったため、読み捨てました。");
                    continue;
                }
                if (line.Length == 0)
                {
                    continue;
                }

                IncomingMessage? message = IncomingMessage.Parse(line, out string problem);
                if (message is null)
                {
                    Log.Error("読めないメッセージを無視しました：" + problem);
                    continue;
                }
                router.Dispatch(message);
            }
        }
        catch (Exception error)
        {
            Log.Error("受信の処理が止まりました：" + Log.Describe(error));
            RequestShutdown("受信の処理が止まりました。");
        }
    }

    private void RequestShutdown(string cause)
    {
        if (Interlocked.Exchange(ref shutdownRequested, 1) != 0)
        {
            return;
        }
        Log.Info(cause);
        shutdown.Cancel();
    }

    private void ShutDown()
    {
        Log.Info("終了の処理を始めます。");
        // 1. 見張り（フック等）を止め、開いている確認画面を閉じる（答えは "closed"。何も削除しない）。通知領域アイコンを消す
        ui.Stop();
        // 2. 処理中の FETCH_DATA をエラーで返し、同期ルートとの接続を切る
        cloudFiles.Shutdown();
        // 3. 処理中の要求が答えを返し終えるのを、少しだけ待つ
        if (!router.WaitForIdle(TimeSpan.FromSeconds(5)))
        {
            Log.Warning("答えを返し終えていない要求があるまま終了します。");
        }
        Log.Info("終了しました。");
    }
}
