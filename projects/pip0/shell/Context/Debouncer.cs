namespace Pip0Shell.Context;

/// <summary>
/// 続けて起きる出来事を1回にまとめる（前面ウィンドウの切り替えやタイトルの変化を、300ms まとめて1回知らせる）。
///
/// - 最後の出来事から quietMs たったら1回だけ知らせる。
/// - 出来事が止まらなくても（タイトルが絶えず変わるアプリ等）、最初の出来事から maxWaitMs たったら知らせる。
/// 時刻は引数で受け取るので、Checks/ で確かめられます。どのスレッドから呼んでもかまいません。
/// </summary>
internal sealed class Debouncer
{
    private readonly object gate = new();
    private readonly long quietMs;
    private readonly long maxWaitMs;
    private bool pending;
    private long firstAt;
    private long lastAt;

    public Debouncer(long quietMs, long maxWaitMs)
    {
        this.quietMs = quietMs;
        this.maxWaitMs = maxWaitMs < quietMs ? quietMs : maxWaitMs;
    }

    /// <summary>出来事が起きた</summary>
    public void Signal(long nowMs)
    {
        lock (gate)
        {
            if (!pending)
            {
                pending = true;
                firstAt = nowMs;
            }
            lastAt = nowMs;
        }
    }

    /// <summary>知らせる予定の時刻。出来事がなければ null</summary>
    public long? DueAt()
    {
        lock (gate)
        {
            if (!pending)
            {
                return null;
            }
            long quietEnd = lastAt + quietMs;
            long maxEnd = firstAt + maxWaitMs;
            return quietEnd < maxEnd ? quietEnd : maxEnd;
        }
    }

    /// <summary>知らせる時刻になっていたら、まとめを終えて真を返す</summary>
    public bool TryFire(long nowMs)
    {
        lock (gate)
        {
            if (!pending)
            {
                return false;
            }
            long quietEnd = lastAt + quietMs;
            long maxEnd = firstAt + maxWaitMs;
            if (nowMs < quietEnd && nowMs < maxEnd)
            {
                return false;
            }
            pending = false;
            return true;
        }
    }
}
