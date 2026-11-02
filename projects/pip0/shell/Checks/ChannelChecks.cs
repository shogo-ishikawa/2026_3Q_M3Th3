using System;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Pip0Shell.Ipc;

namespace Pip0Shell.Checks;

/// <summary>JsonLineChannel（1 MiB の上限、改行、読み捨て）と IncomingMessage（形の確認）</summary>
internal static class ChannelChecks
{
    public static void Run()
    {
        ReadsLinesAndDiscardsTooLongOnes();
        AcceptsLineOfExactlyTheLimit();
        WritesOneLinePerMessage();
        RefusesTooLargeMessage();
        ParsesMessages();
    }

    private static void ReadsLinesAndDiscardsTooLongOnes()
    {
        var input = new MemoryStream();
        Append(input, "{\"kind\":\"request\",\"id\":1,\"type\":\"shell.ping\",\"payload\":{}}\n");
        Append(input, "{\"kind\":\"event\",\"type\":\"shell.quit\",\"payload\":{}}\r\n");
        Append(input, "\n");
        Append(input, new string('a', JsonLineChannel.MaxLineBytes + 70_000) + "\n"); // 64 KiB の読み取りを何回もまたぐ
        Append(input, "{\"kind\":\"request\",\"id\":2,\"type\":\"x\"}\n");
        Append(input, "日本語の行\n");
        Append(input, "{\"kind\":\"event\",\"type\":\"last\"}"); // 改行なしで終わる
        input.Position = 0;

        var channel = new JsonLineChannel(input, new MemoryStream());
        Expect(channel, ReadOutcome.Line, "{\"kind\":\"request\",\"id\":1,\"type\":\"shell.ping\",\"payload\":{}}", "1行目");
        Expect(channel, ReadOutcome.Line, "{\"kind\":\"event\",\"type\":\"shell.quit\",\"payload\":{}}", "\\r\\n で終わる行（\\r を外す）");
        Expect(channel, ReadOutcome.Line, "", "空の行");
        Expect(channel, ReadOutcome.TooLong, null, "1 MiB を超える行は読み捨てる");
        Expect(channel, ReadOutcome.Line, "{\"kind\":\"request\",\"id\":2,\"type\":\"x\"}", "読み捨ての後の行が正しく読める");
        Expect(channel, ReadOutcome.Line, "日本語の行", "UTF-8 の行");
        Expect(channel, ReadOutcome.Line, "{\"kind\":\"event\",\"type\":\"last\"}", "改行なしで終わる最後の行");
        Expect(channel, ReadOutcome.EndOfStream, null, "入力の終わり");
        Expect(channel, ReadOutcome.EndOfStream, null, "入力の終わり（2回目）");

        // 改行がないまま上限を超えて終わる入力
        var tail = new MemoryStream();
        Append(tail, new string('b', JsonLineChannel.MaxLineBytes + 1));
        tail.Position = 0;
        var tailChannel = new JsonLineChannel(tail, new MemoryStream());
        Expect(tailChannel, ReadOutcome.TooLong, null, "改行なしで上限を超えた最後の行は読み捨てる");
        Expect(tailChannel, ReadOutcome.EndOfStream, null, "その後は入力の終わり");
    }

    private static void AcceptsLineOfExactlyTheLimit()
    {
        string prefix = "{\"kind\":\"event\",\"type\":\"big\",\"payload\":{\"text\":\"";
        string suffix = "\"}}";
        string line = prefix + new string('x', JsonLineChannel.MaxLineBytes - prefix.Length - suffix.Length) + suffix;
        var input = new MemoryStream();
        Append(input, line + "\n" + line + "x\n");
        input.Position = 0;
        var channel = new JsonLineChannel(input, new MemoryStream());
        ReadOutcome first = channel.ReadLine(out byte[] bytes);
        Program.Check(first == ReadOutcome.Line && bytes.Length == JsonLineChannel.MaxLineBytes, "ちょうど 1 MiB の行は読める");
        Program.Check(IncomingMessage.Parse(bytes, out _) is not null, "ちょうど 1 MiB の行を JSON として読める");
        Program.Check(channel.ReadLine(out _) == ReadOutcome.TooLong, "1 MiB と 1 バイトの行は読み捨てる");
    }

    private static void WritesOneLinePerMessage()
    {
        var output = new MemoryStream();
        var channel = new JsonLineChannel(new MemoryStream(), output);
        WriteOutcome a = channel.Write(new JsonObject { ["kind"] = "event", ["type"] = "t", ["payload"] = new JsonObject { ["text"] = "ごみ箱へ移動 <&>" } });
        WriteOutcome b = channel.Write(new JsonObject { ["kind"] = "event", ["type"] = "u", ["payload"] = new JsonObject { ["n"] = null } });
        Program.Check(a == WriteOutcome.Written && b == WriteOutcome.Written, "書けた");
        string text = Encoding.UTF8.GetString(output.ToArray());
        string[] lines = text.Split('\n');
        Program.Check(lines.Length == 3 && lines[2].Length == 0, "1件ずつ「\\n」で終わる2行になる");
        Program.Check(output.ToArray()[0] == (byte)'{', "先頭に BOM を付けない");
        Program.Check(lines[0].Contains("ごみ箱へ移動", StringComparison.Ordinal), "日本語はそのまま書く");
        Program.Check(!lines[0].Contains('<') && !lines[0].Contains('&'), "HTML で特別な文字は \\u の形にする");
        using JsonDocument document = JsonDocument.Parse(lines[0]);
        Program.Check(document.RootElement.GetProperty("payload").GetProperty("text").GetString() == "ごみ箱へ移動 <&>", "読み直すと元の文字列に戻る");
        Program.Check(lines[1].Contains("\"n\":null", StringComparison.Ordinal), "null は null と書く");
    }

    private static void RefusesTooLargeMessage()
    {
        var output = new MemoryStream();
        var channel = new JsonLineChannel(new MemoryStream(), output);
        WriteOutcome outcome = channel.Write(new JsonObject { ["text"] = new string('z', JsonLineChannel.MaxLineBytes) });
        Program.Check(outcome == WriteOutcome.TooLarge && output.Length == 0, "1 MiB を超えるメッセージは書かない");
    }

    private static void ParsesMessages()
    {
        IncomingMessage? request = Parse("{\"kind\":\"request\",\"id\":12,\"type\":\"cf.status\",\"payload\":{\"path\":\"C:\\\\a.pdf\"}}");
        Program.Check(request is { Kind: MessageKind.Request, Id: 12, Type: "cf.status" }, "要求を読める");
        Program.Check(request?.Payload.GetString("path") == "C:\\a.pdf", "payload の文字列を読める");

        Program.Check(Parse("{\"kind\":\"request\",\"type\":\"x\"}") is null, "id のない要求は読まない（答えを返せないため）");
        Program.Check(Parse("{\"kind\":\"request\",\"id\":1.5,\"type\":\"x\"}") is null, "id が整数でない要求は読まない");
        Program.Check(Parse("{\"kind\":\"other\",\"id\":1,\"type\":\"x\"}") is null, "知らない kind は読まない");
        Program.Check(Parse("[1,2]") is null, "オブジェクトでない JSON は読まない");
        Program.Check(Parse("not json") is null, "JSON でない行は読まない");

        IncomingMessage? noType = Parse("{\"kind\":\"request\",\"id\":3}");
        Program.Check(noType is { Type: "" }, "type のない要求は type を空にする（bad_request で答えるため）");

        IncomingMessage? noPayload = Parse("{\"kind\":\"event\",\"type\":\"shell.quit\"}");
        Program.Check(noPayload is not null && noPayload.Payload.IsEmpty, "payload がなければ空として扱う");

        IncomingMessage? arrayPayload = Parse("{\"kind\":\"event\",\"type\":\"x\",\"payload\":[1]}");
        Program.Check(arrayPayload is not null && arrayPayload.Payload.IsEmpty, "payload がオブジェクトでなければ空として扱う");

        IncomingMessage? typed = Parse("{\"kind\":\"request\",\"id\":4,\"type\":\"t\",\"payload\":{\"n\":\"5\",\"b\":1,\"o\":{\"k\":true},\"a\":[{\"p\":\"x\"},2]}}");
        Payload payload = typed!.Payload;
        Program.Check(payload.GetInt64("n") is null, "文字列の数字は整数として読まない");
        Program.Check(payload.GetBoolean("b") is null, "1 は真偽値として読まない");
        Program.Check(payload.GetObject("o").GetBoolean("k") == true, "入れ子のオブジェクトを読める");
        var array = payload.GetObjectArray("a");
        Program.Check(array is { Count: 2 } && array[0].GetString("p") == "x" && array[1].IsEmpty, "オブジェクトの配列を読める（オブジェクトでない要素は空）");
        Program.Check(payload.GetObjectArray("missing") is null, "ない名前は null");
    }

    private static IncomingMessage? Parse(string text) => IncomingMessage.Parse(Encoding.UTF8.GetBytes(text), out _);

    private static void Expect(JsonLineChannel channel, ReadOutcome expected, string? expectedText, string what)
    {
        ReadOutcome outcome = channel.ReadLine(out byte[] line);
        bool ok = outcome == expected && (expectedText is null || Encoding.UTF8.GetString(line) == expectedText);
        Program.Check(ok, what + "（結果 " + outcome + "）");
    }

    private static void Append(Stream stream, string text)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(text);
        stream.Write(bytes, 0, bytes.Length);
    }
}
