using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Pip0Shell.Ipc;

/// <summary>
/// 本体が付けた ID（文字列か整数のどちらか）。値で比べられ、<see cref="ToJson"/> で受け取ったときと同じ形に戻せます。
/// </summary>
internal readonly record struct EchoId(string? Text, long? Number)
{
    public JsonNode? ToJson()
    {
        if (Text is not null)
        {
            return JsonValue.Create(Text);
        }
        return Number is long number ? JsonValue.Create(number) : null;
    }
}

/// <summary>
/// 受け取ったメッセージの "payload"（JSON のオブジェクト）を、型を確かめながら読むための小さな道具。
///
/// 名前がない・型が違う場合は例外にせず null（または空）を返します。
/// 必須の値がないときは、各処理が "bad_request" として答えます。
/// </summary>
internal readonly struct Payload
{
    private readonly JsonElement element;

    private Payload(JsonElement element)
    {
        this.element = element;
    }

    public static Payload Empty => default;

    /// <summary>JSON の値から作る。オブジェクトでなければ空</summary>
    public static Payload From(JsonElement element)
    {
        return element.ValueKind == JsonValueKind.Object ? new Payload(element) : default;
    }

    public bool IsEmpty => element.ValueKind != JsonValueKind.Object;

    public bool Has(string name) => TryGet(name, out _);

    public string? GetString(string name)
    {
        return TryGet(name, out JsonElement value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    }

    public long? GetInt64(string name)
    {
        if (TryGet(name, out JsonElement value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out long number))
        {
            return number;
        }
        return null;
    }

    public double? GetDouble(string name)
    {
        if (TryGet(name, out JsonElement value) && value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out double number))
        {
            return number;
        }
        return null;
    }

    public bool? GetBoolean(string name)
    {
        if (!TryGet(name, out JsonElement value))
        {
            return null;
        }
        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null,
        };
    }

    /// <summary>オブジェクトの値。なければ空の Payload</summary>
    public Payload GetObject(string name)
    {
        return TryGet(name, out JsonElement value) ? From(value) : Empty;
    }

    /// <summary>オブジェクトの配列。配列でなければ null。配列の中のオブジェクトでない要素は空の Payload になる</summary>
    public IReadOnlyList<Payload>? GetObjectArray(string name)
    {
        if (!TryGet(name, out JsonElement value) || value.ValueKind != JsonValueKind.Array)
        {
            return null;
        }
        var items = new List<Payload>();
        foreach (JsonElement item in value.EnumerateArray())
        {
            items.Add(From(item));
        }
        return items;
    }

    /// <summary>文字列の配列。配列でなければ null。文字列でない要素は飛ばす</summary>
    public IReadOnlyList<string>? GetStringArray(string name)
    {
        if (!TryGet(name, out JsonElement value) || value.ValueKind != JsonValueKind.Array)
        {
            return null;
        }
        var items = new List<string>();
        foreach (JsonElement item in value.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.String)
            {
                items.Add(item.GetString() ?? "");
            }
        }
        return items;
    }

    /// <summary>
    /// 本体が付けた ID（dock_id、entry_id など）。文字列か整数のときだけ読み、それ以外は null。
    /// シェルは ID の中身を解釈せず、受け取ったとおりの形で送り返します。
    /// </summary>
    public EchoId? GetEchoId(string name)
    {
        if (!TryGet(name, out JsonElement value))
        {
            return null;
        }
        if (value.ValueKind == JsonValueKind.String)
        {
            return new EchoId(value.GetString() ?? "", null);
        }
        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out long number))
        {
            return new EchoId(null, number);
        }
        return null;
    }

    private bool TryGet(string name, out JsonElement value)
    {
        if (element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out value))
        {
            return true;
        }
        value = default;
        return false;
    }
}
