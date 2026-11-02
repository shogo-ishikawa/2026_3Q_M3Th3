using System;
using System.IO;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Unicode;
using Pip0Shell.Core;

namespace Pip0Shell.Ipc;

/// <summary>1行を読んだ結果</summary>
internal enum ReadOutcome
{
    /// <summary>1行を読んだ</summary>
    Line,

    /// <summary>1 MiB を超える行を読み捨てた</summary>
    TooLong,

    /// <summary>入力が閉じられた（pip0 本体が終わった）</summary>
    EndOfStream,
}

/// <summary>書いた結果</summary>
internal enum WriteOutcome
{
    Written,
    TooLarge,
    Closed,
    Failed,
}

/// <summary>
/// 標準入出力で、JSON を1行ずつやり取りする（docs/ipc-protocol.md の1節）。
///
/// - 1行は UTF-8 の JSON オブジェクト1つで、「\n」で終わる。最大 1 MiB。超えた行は読み捨てる。
/// - 読むのは1つのスレッド（受信のスレッド）だけ。
/// - 書くのは複数のスレッド（要求の処理、Cloud Files のコールバック、画面）から。行が混ざらないよう、ロックしてから書く。
/// </summary>
internal sealed class JsonLineChannel
{
    /// <summary>1行の上限（改行を除いたバイト数）</summary>
    public const int MaxLineBytes = 1024 * 1024;

    // 日本語はそのまま、HTML で特別な文字（&lt; など）だけを \u の形にする。どちらも正しい JSON
    private static readonly JsonSerializerOptions WriteOptions = new()
    {
        Encoder = JavaScriptEncoder.Create(UnicodeRanges.All),
        WriteIndented = false,
    };

    private readonly Stream input;
    private readonly Stream output;
    private readonly object writeGate = new();
    private readonly byte[] readBuffer = new byte[64 * 1024];
    private readonly MemoryStream lineBuffer = new();
    private int readStart;
    private int readEnd;
    private bool outputClosed;

    public JsonLineChannel(Stream input, Stream output)
    {
        this.input = input;
        this.output = output;
    }

    /// <summary>
    /// 次の1行を読む（受信のスレッドだけが呼ぶ）。
    /// 改行で終わらないまま入力が閉じた場合も、その最後の行を返す。
    /// </summary>
    public ReadOutcome ReadLine(out byte[] line)
    {
        bool discarding = false;
        lineBuffer.SetLength(0);

        while (true)
        {
            if (readStart == readEnd)
            {
                int count;
                try
                {
                    count = input.Read(readBuffer, 0, readBuffer.Length);
                }
                catch (IOException)
                {
                    count = 0; // パイプが壊れた＝本体が終わった
                }
                catch (ObjectDisposedException)
                {
                    count = 0;
                }

                if (count <= 0)
                {
                    if (discarding)
                    {
                        line = Array.Empty<byte>();
                        return ReadOutcome.TooLong;
                    }
                    if (lineBuffer.Length > 0)
                    {
                        line = TakeLine();
                        return ReadOutcome.Line;
                    }
                    line = Array.Empty<byte>();
                    return ReadOutcome.EndOfStream;
                }
                readStart = 0;
                readEnd = count;
            }

            int newline = Array.IndexOf(readBuffer, (byte)'\n', readStart, readEnd - readStart);
            int chunkEnd = newline >= 0 ? newline : readEnd;
            int chunkLength = chunkEnd - readStart;

            if (!discarding)
            {
                if (lineBuffer.Length + chunkLength > MaxLineBytes)
                {
                    // 上限を超えた：この行の残りは改行まで読み捨てる
                    discarding = true;
                    lineBuffer.SetLength(0);
                }
                else
                {
                    lineBuffer.Write(readBuffer, readStart, chunkLength);
                }
            }

            readStart = newline >= 0 ? newline + 1 : readEnd;

            if (newline >= 0)
            {
                if (discarding)
                {
                    line = Array.Empty<byte>();
                    return ReadOutcome.TooLong;
                }
                line = TakeLine();
                return ReadOutcome.Line;
            }
        }
    }

    /// <summary>メッセージを1行にして書く（どのスレッドからでも呼べる）</summary>
    public WriteOutcome Write(JsonObject message)
    {
        byte[] bytes;
        try
        {
            bytes = JsonSerializer.SerializeToUtf8Bytes(message, WriteOptions);
        }
        catch (Exception error) when (error is JsonException or ArgumentException or InvalidOperationException)
        {
            Log.Error("送るメッセージを JSON にできませんでした：" + Log.Describe(error));
            return WriteOutcome.Failed;
        }

        if (bytes.Length > MaxLineBytes)
        {
            Log.Error("送るメッセージが 1 MiB を超えたため、送りませんでした。");
            return WriteOutcome.TooLarge;
        }

        // JSON と改行を1回で書く（1行が2回の書き込みに分かれないようにする）
        byte[] line = new byte[bytes.Length + 1];
        bytes.CopyTo(line, 0);
        line[^1] = (byte)'\n';

        lock (writeGate)
        {
            if (outputClosed)
            {
                return WriteOutcome.Closed;
            }
            try
            {
                output.Write(line, 0, line.Length);
                output.Flush();
                return WriteOutcome.Written;
            }
            catch (Exception error) when (error is IOException or ObjectDisposedException or NotSupportedException)
            {
                outputClosed = true;
                Log.Warning("pip0 本体への出力が閉じられました：" + Log.Describe(error));
                return WriteOutcome.Closed;
            }
        }
    }

    private byte[] TakeLine()
    {
        byte[] bytes = lineBuffer.ToArray();
        lineBuffer.SetLength(0);
        // Windows 流の改行（\r\n）で送られても読めるようにする
        if (bytes.Length > 0 && bytes[^1] == (byte)'\r')
        {
            Array.Resize(ref bytes, bytes.Length - 1);
        }
        return bytes;
    }
}
