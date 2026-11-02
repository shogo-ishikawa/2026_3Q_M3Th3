using System.Text.Json.Nodes;
using Pip0Shell.Core;

namespace Pip0Shell.Ipc;

/// <summary>
/// シェル → pip0 本体へ送る窓口。知らせ（event）と答え（response）を組み立てて送ります。
/// どのスレッドからでも呼べます（書き込みは JsonLineChannel がロックしてから行います）。
/// </summary>
internal sealed class ShellOutput
{
    private readonly JsonLineChannel channel;

    public ShellOutput(JsonLineChannel channel)
    {
        this.channel = channel;
    }

    /// <summary>知らせを送る：{"kind": "event", "type": ..., "payload": {...}}</summary>
    public void SendEvent(string type, JsonObject payload)
    {
        var message = new JsonObject
        {
            ["kind"] = "event",
            ["type"] = type,
            ["payload"] = payload,
        };
        WriteOutcome outcome = channel.Write(message);
        if (outcome == WriteOutcome.TooLarge || outcome == WriteOutcome.Failed)
        {
            Log.Error("知らせ（" + type + "）を送れませんでした。");
        }
    }

    /// <summary>要求への答えを送る。答えが大きすぎたときは、too_large の失敗を代わりに送る</summary>
    public void SendResponse(long id, RequestResult result)
    {
        JsonObject message = BuildResponse(id, result);
        WriteOutcome outcome = channel.Write(message);
        if (outcome == WriteOutcome.TooLarge || outcome == WriteOutcome.Failed)
        {
            // 「要求には必ず1つの答えを返す」約束を守るため、小さな失敗の答えを送り直す
            RequestResult fallback = outcome == WriteOutcome.TooLarge
                ? RequestResult.Failure(ErrorCodes.TooLarge, "答えが 1 MiB を超えたため送れませんでした。")
                : RequestResult.Failure(ErrorCodes.InternalError, "答えを JSON にできませんでした。");
            channel.Write(BuildResponse(id, fallback));
        }
    }

    private static JsonObject BuildResponse(long id, RequestResult result)
    {
        if (result.Ok)
        {
            return new JsonObject
            {
                ["kind"] = "response",
                ["id"] = id,
                ["ok"] = true,
                ["payload"] = result.Payload ?? new JsonObject(),
            };
        }
        return new JsonObject
        {
            ["kind"] = "response",
            ["id"] = id,
            ["ok"] = false,
            ["error"] = new JsonObject
            {
                ["code"] = result.ErrorCode,
                ["message"] = result.ErrorMessage,
            },
        };
    }
}
