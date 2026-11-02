using System.Text.Json.Nodes;

namespace Pip0Shell.Ipc;

/// <summary>
/// 要求（request）への答え。
/// 成功：{"ok": true, "payload": {...}}、失敗：{"ok": false, "error": {"code", "message"}}。
///
/// 「ファイルが使用中」のような、予想される結果は成功の答え（payload の "result" や "reason"）で返します。
/// 失敗の答えは、要求そのものを処理できなかったとき（形が違う、init の前、知らない type 等）に使います。
/// </summary>
internal sealed class RequestResult
{
    private RequestResult(bool ok, JsonObject? payload, string? errorCode, string? errorMessage)
    {
        Ok = ok;
        Payload = payload;
        ErrorCode = errorCode;
        ErrorMessage = errorMessage;
    }

    public bool Ok { get; }

    public JsonObject? Payload { get; }

    public string? ErrorCode { get; }

    public string? ErrorMessage { get; }

    public static RequestResult Success(JsonObject payload) => new(true, payload, null, null);

    public static RequestResult Failure(string code, string message) => new(false, null, code, message);

    /// <summary>要求の形が違うとき</summary>
    public static RequestResult BadRequest(string message) => Failure(ErrorCodes.BadRequest, message);
}

/// <summary>失敗の答えの "code" の一覧</summary>
internal static class ErrorCodes
{
    /// <summary>知らない type の要求（docs/ipc-protocol.md で決められた名前）</summary>
    public const string UnknownType = "unknown_type";

    /// <summary>payload の形が違う（必須の値がない、絶対パスでない等）</summary>
    public const string BadRequest = "bad_request";

    /// <summary>init の前に、init と shell.ping 以外の要求が届いた</summary>
    public const string NotInitialised = "not_initialised";

    /// <summary>init が、前と違う内容でもう一度届いた</summary>
    public const string AlreadyInitialised = "already_initialised";

    /// <summary>init の protocol の版が違う</summary>
    public const string UnsupportedProtocol = "unsupported_protocol";

    /// <summary>シェルが終了の処理中</summary>
    public const string ShuttingDown = "shutting_down";

    /// <summary>答えが 1 MiB を超えた</summary>
    public const string TooLarge = "too_large";

    /// <summary>シェルの内部の予期しないエラー</summary>
    public const string InternalError = "internal_error";
}
