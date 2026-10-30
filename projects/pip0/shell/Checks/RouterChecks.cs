using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using Pip0Shell.Ipc;

namespace Pip0Shell.Checks;

/// <summary>
/// MessageRouter と ShellOutput：init の前の断り方、知らない type、形の違う要求、予期しない例外、
/// 「要求には必ず1つの答え」、終了中の断り方。
/// </summary>
internal static class RouterChecks
{
    public static void Run()
    {
        var output = new MemoryStream();
        var shellOutput = new ShellOutput(new JsonLineChannel(new MemoryStream(), output));
        var shutdown = new CancellationTokenSource();
        var router = new MessageRouter(shellOutput, shutdown.Token);

        int quitCount = 0;
        int notifyCount = 0;
        router.AddRequest("init", (payload, token) =>
        {
            router.MarkInitialised();
            return RequestResult.Success(new JsonObject { ["shell_version"] = "test" });
        }, runOnReceiver: true);
        router.AddRequest("shell.ping", (payload, token) => RequestResult.Success(new JsonObject { ["time"] = 1.5 }));
        router.AddRequest("cf.status", (payload, token) => RequestResult.Success(new JsonObject { ["path"] = payload.GetString("path") }));
        router.AddRequest("boom", (payload, token) => throw new InvalidOperationException(@"C:\Users\secret\file.pdf"));
        router.AddRequest("slow", (payload, token) =>
        {
            Thread.Sleep(200);
            return RequestResult.Success(new JsonObject { ["done"] = true });
        });
        router.AddEvent("shell.quit", _ => quitCount++);
        router.AddEvent("ui.notify", _ => notifyCount++);

        Dispatch(router, "{\"kind\":\"request\",\"id\":1,\"type\":\"cf.status\",\"payload\":{\"path\":\"C:\\\\a\"}}");
        Dispatch(router, "{\"kind\":\"request\",\"id\":2,\"type\":\"shell.ping\",\"payload\":{}}");
        Dispatch(router, "{\"kind\":\"event\",\"type\":\"ui.notify\",\"payload\":{}}");
        Dispatch(router, "{\"kind\":\"event\",\"type\":\"shell.quit\",\"payload\":{}}");
        Dispatch(router, "{\"kind\":\"request\",\"id\":3,\"type\":\"init\",\"payload\":{\"protocol\":1}}");
        Dispatch(router, "{\"kind\":\"request\",\"id\":4,\"type\":\"cf.status\",\"payload\":{\"path\":\"C:\\\\a\"}}");
        Dispatch(router, "{\"kind\":\"request\",\"id\":5,\"type\":\"no.such.type\",\"payload\":{}}");
        Dispatch(router, "{\"kind\":\"request\",\"id\":6,\"payload\":{}}");
        Dispatch(router, "{\"kind\":\"request\",\"id\":7,\"type\":\"boom\",\"payload\":{}}");
        Dispatch(router, "{\"kind\":\"request\",\"id\":8,\"type\":\"slow\",\"payload\":{}}");
        Dispatch(router, "{\"kind\":\"event\",\"type\":\"ui.notify\",\"payload\":{}}");
        Dispatch(router, "{\"kind\":\"event\",\"type\":\"no.such.event\",\"payload\":{}}");
        Dispatch(router, "{\"kind\":\"response\",\"id\":9,\"ok\":true,\"payload\":{}}");

        Program.Check(router.WaitForIdle(TimeSpan.FromSeconds(10)), "処理中の要求が時間内に終わる");

        shutdown.Cancel();
        Dispatch(router, "{\"kind\":\"request\",\"id\":10,\"type\":\"shell.ping\",\"payload\":{}}");

        Dictionary<long, List<JsonElement>> responses = ReadResponses(output);
        for (long id = 1; id <= 10; id++)
        {
            if (id == 9)
            {
                continue;
            }
            Program.Check(responses.TryGetValue(id, out var list) && list.Count == 1, "要求 " + id + " には答えがちょうど1つ");
        }
        Program.Check(!responses.ContainsKey(9), "本体からの response には答えない");

        CheckError(responses, 1, "not_initialised", "init の前の cf.status は断る");
        CheckOk(responses, 2, "init の前でも shell.ping は受け付ける");
        Program.Check(quitCount == 1, "init の前でも shell.quit は受け付ける");
        CheckOk(responses, 3, "init を受け付ける");
        CheckOk(responses, 4, "init の後は cf.status を受け付ける");
        Program.Check(Payload(responses, 4).GetProperty("path").GetString() == "C:\\a", "payload が処理に渡る");
        CheckError(responses, 5, "unknown_type", "知らない type の要求は unknown_type");
        CheckError(responses, 6, "bad_request", "type のない要求は bad_request");
        CheckError(responses, 7, "internal_error", "処理の例外は internal_error");
        Program.Check(!Message(responses, 7).Contains("secret", StringComparison.Ordinal), "例外のメッセージ（パスを含みうる）を答えに入れない");
        CheckOk(responses, 8, "時間のかかる要求も答える");
        Program.Check(notifyCount == 1, "init の前の ui.notify は無視し、後のものは処理する");
        CheckError(responses, 10, "shutting_down", "終了中の要求は shutting_down");
    }

    private static void Dispatch(MessageRouter router, string json)
    {
        IncomingMessage? message = IncomingMessage.Parse(Encoding.UTF8.GetBytes(json), out string problem);
        if (message is null)
        {
            Program.Check(false, "テストの入力を読めない：" + problem);
            return;
        }
        router.Dispatch(message);
    }

    private static Dictionary<long, List<JsonElement>> ReadResponses(MemoryStream output)
    {
        var responses = new Dictionary<long, List<JsonElement>>();
        string text = Encoding.UTF8.GetString(output.ToArray());
        foreach (string line in text.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            JsonElement root = JsonDocument.Parse(line).RootElement.Clone();
            if (root.GetProperty("kind").GetString() != "response")
            {
                continue;
            }
            long id = root.GetProperty("id").GetInt64();
            if (!responses.TryGetValue(id, out var list))
            {
                list = new List<JsonElement>();
                responses[id] = list;
            }
            list.Add(root);
        }
        return responses;
    }

    private static void CheckOk(Dictionary<long, List<JsonElement>> responses, long id, string what)
    {
        bool ok = responses.TryGetValue(id, out var list) && list.Count > 0
            && list[0].GetProperty("ok").GetBoolean()
            && list[0].GetProperty("payload").ValueKind == JsonValueKind.Object;
        Program.Check(ok, what);
    }

    private static void CheckError(Dictionary<long, List<JsonElement>> responses, long id, string code, string what)
    {
        bool ok = responses.TryGetValue(id, out var list) && list.Count > 0
            && !list[0].GetProperty("ok").GetBoolean()
            && list[0].GetProperty("error").GetProperty("code").GetString() == code
            && (list[0].GetProperty("error").GetProperty("message").GetString() ?? "").Length > 0;
        Program.Check(ok, what);
    }

    private static JsonElement Payload(Dictionary<long, List<JsonElement>> responses, long id)
    {
        return responses[id][0].GetProperty("payload");
    }

    private static string Message(Dictionary<long, List<JsonElement>> responses, long id)
    {
        return responses[id][0].GetProperty("error").GetProperty("message").GetString() ?? "";
    }
}
