using System;
using System.Collections.Generic;

namespace Pip0Shell.CloudFiles;

/// <summary>
/// FETCH_DATA で求められた範囲を、TRANSFER_DATA で渡せる形にそろえる計算（Windows の API を使わない部分）。
///
/// Windows の約束：渡す位置と長さは 4 KiB の倍数。ただし、ファイルの終わりで終わる最後の1回だけは、長さが半端でもよい。
/// </summary>
internal static class TransferRange
{
    public const long Alignment = 4096;

    /// <summary>
    /// 求められた範囲 [offset, offset + length) を 4 KiB 単位に広げる。終わりはファイルの大きさを超えない。
    /// length が負、または終わりを超える場合は、ファイルの終わりまでとする。正しくない範囲なら Start == End を返す。
    /// </summary>
    public static (long Start, long End) Align(long requiredOffset, long requiredLength, long fileSize)
    {
        if (requiredOffset < 0 || fileSize <= 0 || requiredOffset >= fileSize)
        {
            return (0, 0);
        }
        long requestedEnd = requiredLength < 0 || requiredLength > fileSize - requiredOffset
            ? fileSize
            : requiredOffset + requiredLength;
        long start = requiredOffset / Alignment * Alignment;
        long alignedEnd = (requestedEnd + Alignment - 1) / Alignment * Alignment;
        return (start, Math.Min(fileSize, alignedEnd));
    }

    /// <summary>[start, end) を chunkBytes（4 KiB の倍数）ずつに分けた (位置, 長さ) の列</summary>
    public static IEnumerable<(long Offset, int Length)> Chunks(long start, long end, int chunkBytes)
    {
        if (chunkBytes <= 0 || chunkBytes % Alignment != 0)
        {
            throw new ArgumentOutOfRangeException(nameof(chunkBytes), "chunkBytes は 4 KiB の倍数にしてください。");
        }
        for (long offset = start; offset < end; offset += chunkBytes)
        {
            yield return (offset, (int)Math.Min(chunkBytes, end - offset));
        }
    }
}
