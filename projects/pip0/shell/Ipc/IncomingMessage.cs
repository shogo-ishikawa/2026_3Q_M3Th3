using System;
using System.Text.Json;

namespace Pip0Shell.Ipc;

/// <summary>メッセージの種類（docs/ipc-protocol.md の "kind"）</summary>
internal enum MessageKind
{
    Request,
    Response,
    Event,
}

/// <summary>
/// pip0 本体から届いた1行のメッセージ。
/// {"kind": "request", "id": 12, "type": "cf.status", "payload": {...}} の形です。
/// </summary>
internal sealed class IncomingMessage
{
    private IncomingMessage(MessageKind kind, long? id, string type, Payload payload)
    {
        Kind = kind;
        Id = id;
        Type = type;
        Payload = payload;
    }

    public MessageKind Kind { get; }

    /// <summary>要求の番号（request のときだけ）</summary>
    public long? Id { get; }

    public string Type { get; }

    public Payload Payload { get; }

    /// <summary>
    /// 1行（UTF-8 の JSON）を読む。読めなければ null を返し、problem に理由（内容を含まない日本語）を入れる。
    /// request で id が読めないときは、返事を返せないので null にする。
    /// </summary>
    public static IncomingMessage? Parse(byte[] line, out string problem)
    {
        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(line);
        }
        catch (JsonException)
        {
            problem = "JSON として読めません。";
            return null;
        }

        using (document)
        {
            JsonElement root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                problem = "JSON のオブジェクトではありません。";
                return null;
            }

            string? kindText = ReadString(root, "kind");
            MessageKind kind;
            switch (kindText)
            {
                case "request":
                    kind = MessageKind.Request;
                    break;
                case "response":
                    kind = MessageKind.Response;
                    break;
                case "event":
                    kind = MessageKind.Event;
                    break;
                default:
                    problem = "kind が request / response / event のどれでもありません。";
                    return null;
            }

            long? id = null;
            if (root.TryGetProperty("id", out JsonElement idElement)
                && idElement.ValueKind == JsonValueKind.Number
                && idElement.TryGetInt64(out long idValue))
            {
                id = idValue;
            }
            if (kind == MessageKind.Request && id is null)
            {
                problem = "request に整数の id がありません。";
                return null;
            }

            // type がない request には、bad_request として答えるため空文字にしておく
            string type = ReadString(root, "type") ?? "";

            // payload は JsonDocument を閉じた後も使うため、複製しておく
            Payload payload = Payload.Empty;
            if (root.TryGetProperty("payload", out JsonElement payloadElement))
            {
                payload = Payload.From(payloadElement.Clone());
            }

            problem = "";
            return new IncomingMessage(kind, id, type, payload);
        }
    }

    private static string? ReadString(JsonElement root, string name)
    {
        return root.TryGetProperty(name, out JsonElement value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
    }
}
