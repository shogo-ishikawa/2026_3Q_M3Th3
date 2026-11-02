using System.Text.Json.Nodes;

namespace Pip0Shell.Input;

/// <summary>
/// マウスの位置の記録を、一定の間隔でまとめて input.cursor_batch の payload にする。
/// {"samples": [[ミリ秒, x, y], ...]}（ミリ秒は 1970年1月1日からのミリ秒、x・y は物理ピクセル）
///
/// 時刻は引数で受け取るので、Checks/ で確かめられます。
/// </summary>
internal sealed class CursorBatcher
{
    /// <summary>1回に送る記録の上限（送れずにたまったときに、1行が大きくなりすぎないように）</summary>
    public const int MaxSamples = 2000;

    private readonly long batchMs;
    private JsonArray samples = new();
    private long lastFlushAt;

    public CursorBatcher(long batchMs, long nowMs)
    {
        this.batchMs = batchMs < 1 ? 1 : batchMs;
        lastFlushAt = nowMs;
    }

    public int Count => samples.Count;

    /// <summary>次にまとめて送る時刻</summary>
    public long NextFlushAt => lastFlushAt + batchMs;

    public void Add(long unixMs, int x, int y)
    {
        if (samples.Count >= MaxSamples)
        {
            samples.RemoveAt(0); // 古いものから捨てる
        }
        samples.Add(new JsonArray(unixMs, x, y));
    }

    /// <summary>送る時刻になっていて、記録があれば payload を返す。なければ null</summary>
    public JsonObject? TakeIfDue(long nowMs)
    {
        if (nowMs < NextFlushAt)
        {
            return null;
        }
        lastFlushAt = nowMs;
        return TakeAll();
    }

    /// <summary>残りをすべて返す（止めるとき）。記録がなければ null</summary>
    public JsonObject? TakeAll()
    {
        if (samples.Count == 0)
        {
            return null;
        }
        JsonArray taken = samples;
        samples = new JsonArray();
        return new JsonObject { ["samples"] = taken };
    }
}
