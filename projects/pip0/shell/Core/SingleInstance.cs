using System;
using System.Threading;

namespace Pip0Shell.Core;

/// <summary>
/// 同じ Windows のセッションの中で、pip0 シェルを1つだけ動かすための名前付きミューテックス。
///
/// 名前は「Local\」で始まるので、セッション（サインインごと）の中だけで有効です。
/// ミューテックスは取得したスレッドでしか解放できないため、Program.Main の中で取得と解放をします。
/// </summary>
internal sealed class SingleInstance : IDisposable
{
    private readonly Mutex mutex;
    private bool owned = true;

    private SingleInstance(Mutex mutex)
    {
        this.mutex = mutex;
    }

    /// <summary>取得できたら SingleInstance、ほかのシェルが動いていたら null</summary>
    public static SingleInstance? TryAcquire(string userSid)
    {
        var mutex = new Mutex(initiallyOwned: false, name: @"Local\pip0.shell." + userSid);
        bool acquired;
        try
        {
            acquired = mutex.WaitOne(0);
        }
        catch (AbandonedMutexException)
        {
            // 前のシェルが解放せずに終わっていた。所有権はこちらに移っている
            acquired = true;
        }

        if (!acquired)
        {
            mutex.Dispose();
            return null;
        }
        return new SingleInstance(mutex);
    }

    public void Dispose()
    {
        if (owned)
        {
            owned = false;
            try
            {
                mutex.ReleaseMutex();
            }
            catch (ApplicationException)
            {
                // 取得したスレッド以外から呼ばれた。プロセスの終了時に Windows が解放する
            }
        }
        mutex.Dispose();
    }
}
