using System;
using System.Collections.Generic;

namespace Pip0Shell.CloudFiles;

/// <summary>
/// ゴーストごとに、中身を渡し終えた範囲を覚えておき、ファイル全体を渡し終えたかを判定する（cf.hydrated を送るため）。
/// 同期ルートは「Full」の取得方式なので、ふつうは1回の FETCH_DATA でファイル全体を渡しますが、
/// 何回かに分かれても判定できるようにしています。
/// </summary>
internal sealed class HydrationTracker
{
    private const int MaxTrackedItems = 1000;

    private readonly object gate = new();
    private readonly Dictionary<string, List<(long Start, long End)>> served = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>[start, end) を渡し終えたことを記録する。ファイル全体（0 から fileSize まで）がそろったら真</summary>
    public bool MarkServed(string itemId, long fileSize, long start, long end)
    {
        lock (gate)
        {
            if (!served.TryGetValue(itemId, out List<(long Start, long End)>? ranges))
            {
                if (served.Count >= MaxTrackedItems)
                {
                    served.Clear(); // 覚えきれないときは、途中の記録を捨てる（cf.hydrated が届かないことがあるだけ）
                }
                ranges = new List<(long Start, long End)>();
                served[itemId] = ranges;
            }

            ranges.Add((start, end));
            ranges.Sort((a, b) => a.Start.CompareTo(b.Start));

            // 重なる範囲をまとめ、0 から続く範囲がファイルの終わりまで届いているかを見る
            var merged = new List<(long Start, long End)>();
            foreach ((long s, long e) in ranges)
            {
                if (merged.Count > 0 && s <= merged[^1].End)
                {
                    (long ms, long me) = merged[^1];
                    merged[^1] = (ms, Math.Max(me, e));
                }
                else
                {
                    merged.Add((s, e));
                }
            }
            served[itemId] = merged;

            bool complete = merged.Count == 1 && merged[0].Start <= 0 && merged[0].End >= fileSize;
            if (complete)
            {
                served.Remove(itemId);
            }
            return complete;
        }
    }
}
