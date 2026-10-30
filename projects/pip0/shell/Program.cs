using System;
using System.Threading;
using System.Threading.Tasks;
using Pip0Shell.Core;

namespace Pip0Shell;

/// <summary>
/// pip0 シェルの入口。
///
/// pip0 本体（Python）が子プロセスとして起動し、標準入出力で JSON を1行ずつやり取りします（docs/ipc-protocol.md）。
/// 自分で起動した場合（標準入力がない場合）は、すぐに終わります。
///
/// 終了コード：0 = 正常、1 = 起動できなかった、3 = 同じセッションでシェルがすでに動いている、
/// 70 = 処理されない例外で止まった（.NET が例外の詳しい内容を標準エラー出力へ書く前に終わる）
/// </summary>
internal static class Program
{
    private const int ExitNormal = 0;
    private const int ExitStartupFailed = 1;
    private const int ExitAlreadyRunning = 3;
    private const int ExitCrashed = 70;

    public static int Main(string[] args)
    {
        // 画面を作る前に、モニターごとの拡大率に合わせる設定にする（WPF の画面にも効く）
        System.Windows.Forms.Application.SetHighDpiMode(System.Windows.Forms.HighDpiMode.PerMonitorV2);
        Log.Initialise();
        Log.Info("pip0 シェル " + ShellInfo.Version + " を起動します。");
        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
        {
            Log.Error("処理されない例外が起きました：" + (e.ExceptionObject is Exception error ? Log.Describe(error) : "種類は不明です"));
            // このまま戻ると、.NET が例外の内容（Message にパスが入ることがある）と呼び出し履歴を標準エラー出力へ書き、
            // pip0 本体の記録に残ってしまう。種類だけを書いた後、ここで終わる（本体はシェルを起動し直す）
            Console.Error.Flush();
            Environment.Exit(ExitCrashed);
        };
        TaskScheduler.UnobservedTaskException += (_, e) =>
        {
            Log.Error("処理されない例外が起きました（Task）：" + Log.Describe(e.Exception));
            e.SetObserved();
        };
        Thread.CurrentThread.Name = "pip0 main";

        CommandLineOptions options = CommandLineOptions.Parse(args);

        string userSid;
        try
        {
            userSid = UserIdentity.GetCurrentSid();
        }
        catch (Exception error)
        {
            Log.Error("ユーザーの SID を取得できないため、起動できません：" + Log.Describe(error));
            return ExitStartupFailed;
        }

        // 同じセッションで2つ目のシェルは動かさない（同期ルートに接続できるのは1つだけのため）
        SingleInstance? acquired;
        try
        {
            acquired = SingleInstance.TryAcquire(userSid);
        }
        catch (Exception error)
        {
            Log.Error("シェルが1つだけ動いているかを確かめられないため、起動できません：" + Log.Describe(error));
            return ExitStartupFailed;
        }
        using SingleInstance? instance = acquired;
        if (instance is null)
        {
            Log.Error("同じセッションで pip0 シェルがすでに動いているため、終了します。");
            return ExitAlreadyRunning;
        }

        Pip0Processes.Initialise();

        try
        {
            var application = new ShellApplication(options, userSid);
            application.Run();
            return ExitNormal;
        }
        catch (Exception error)
        {
            Log.Error("シェルが予期しないエラーで止まりました：" + Log.Describe(error));
            return ExitStartupFailed;
        }
    }
}
