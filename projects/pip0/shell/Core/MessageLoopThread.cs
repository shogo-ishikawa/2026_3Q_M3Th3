using System;
using System.Threading;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.UI.WindowsAndMessaging;

namespace Pip0Shell.Core;

/// <summary>
/// Windows のメッセージループ（GetMessage の繰り返し）を持つ専用のスレッド。
///
/// SetWinEventHook（WINEVENT_OUTOFCONTEXT）と、低レベルのマウスのフック（WH_MOUSE_LL）は、
/// フックを付けたスレッドがメッセージを受け取っている間だけ呼ばれます。そのため、フックごとにこのスレッドを1つ作ります。
///
/// - <see cref="Start"/>：スレッドを作り、そのスレッドで setup（フックを付ける）を実行して、結果を待つ。
/// - スレッドあてのメッセージ（ウィンドウのない WM_TIMER や WM_APP など）は onThreadMessage に渡す。
/// - <see cref="Stop"/>：WM_QUIT を送ってループを終わらせ、そのスレッドで teardown（フックを外す）を実行する。
/// </summary>
internal sealed class MessageLoopThread
{
    /// <summary>setup の形：成功したら真。失敗したら problem に日本語の理由</summary>
    public delegate bool SetupAction(out string problem);

    private readonly string name;
    private readonly ManualResetEventSlim started = new(false);
    private Thread? thread;
    private volatile uint threadId;
    private bool setupSucceeded;
    private string setupProblem = "";

    public MessageLoopThread(string name)
    {
        this.name = name;
    }

    /// <summary>スレッドの番号（PostThreadMessage に使う）。動いていなければ 0</summary>
    public uint ThreadId => threadId;

    /// <summary>スレッドを作って setup を実行し、終わるまで待つ。setup が成功したら真</summary>
    public bool Start(SetupAction setup, Action<MSG> onThreadMessage, Action teardown, TimeSpan timeout, out string problem)
    {
        if (thread is not null)
        {
            problem = "すでに開始しています。";
            return false;
        }
        thread = new Thread(() => Run(setup, onThreadMessage, teardown))
        {
            IsBackground = true,
            Name = name,
        };
        thread.Start();
        if (!started.Wait(timeout))
        {
            problem = "準備が時間内に終わりませんでした。";
            return false;
        }
        problem = setupProblem;
        return setupSucceeded;
    }

    /// <summary>このスレッドへメッセージを送る（待たない）。送れたら真</summary>
    public bool Post(uint message)
    {
        uint id = threadId;
        return id != 0 && PInvoke.PostThreadMessage(id, message, default, default);
    }

    /// <summary>ループを終わらせ、スレッドの終わりを少しだけ待つ</summary>
    public void Stop(TimeSpan timeout)
    {
        uint id = threadId;
        if (id != 0)
        {
            PInvoke.PostThreadMessage(id, PInvoke.WM_QUIT, default, default);
        }
        thread?.Join(timeout);
    }

    private void Run(SetupAction setup, Action<MSG> onThreadMessage, Action teardown)
    {
        // PostThreadMessage を受け取れるよう、先にメッセージの列を作らせる
        PInvoke.PeekMessage(out MSG _, HWND.Null, 0, 0, PEEK_MESSAGE_REMOVE_TYPE.PM_NOREMOVE);
        threadId = PInvoke.GetCurrentThreadId();

        try
        {
            setupSucceeded = setup(out setupProblem);
        }
        catch (Exception error)
        {
            setupSucceeded = false;
            setupProblem = "準備の途中で予期しないエラーが起きました（" + error.GetType().Name + "）。";
            Log.Error(name + " の準備でエラーが起きました：" + Log.Describe(error));
        }
        started.Set();
        if (!setupSucceeded)
        {
            threadId = 0;
            return;
        }

        try
        {
            while (true)
            {
                BOOL result = PInvoke.GetMessage(out MSG message, HWND.Null, 0, 0);
                if (result.Value == 0 || result.Value == -1)
                {
                    break; // WM_QUIT か、エラー
                }
                if (message.hwnd == HWND.Null)
                {
                    try
                    {
                        onThreadMessage(message);
                    }
                    catch (Exception error)
                    {
                        Log.Error(name + " のメッセージの処理でエラーが起きました：" + Log.Describe(error));
                    }
                }
                PInvoke.TranslateMessage(in message);
                PInvoke.DispatchMessage(in message);
            }
        }
        catch (Exception error)
        {
            Log.Error(name + " のメッセージループが止まりました：" + Log.Describe(error));
        }
        finally
        {
            threadId = 0;
            try
            {
                teardown();
            }
            catch (Exception error)
            {
                Log.Warning(name + " の後片付けでエラーが起きました：" + Log.Describe(error));
            }
        }
    }
}
