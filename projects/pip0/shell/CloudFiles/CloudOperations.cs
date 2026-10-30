using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.Storage.CloudFilters;

namespace Pip0Shell.CloudFiles;

/// <summary>コールバックで受け取った、操作を返すための鍵（コールバックの外でも使えるよう、数値で写しておく）</summary>
internal readonly record struct CallbackKeys(long ConnectionKey, long TransferKey, long RequestKey);

/// <summary>
/// CfExecute で Windows（cldflt）へ返す操作：中身を渡す（TRANSFER_DATA）、失敗を返す、削除・名前の変更を認める。
///
/// CF_OPERATION_PARAMETERS の ParamSize は、C の CF_SIZE_OF_OP_PARAM マクロと同じく
/// 「共用体の位置 ＋ 使う構造体の大きさ」にします（構造体全体の大きさではありません）。
/// </summary>
internal static unsafe class CloudOperations
{
    private static readonly uint TransferDataSize =
        SizeWith<CF_OPERATION_PARAMETERS._Anonymous_e__Union._TransferData_e__Struct>();

    private static readonly uint AckDeleteSize =
        SizeWith<CF_OPERATION_PARAMETERS._Anonymous_e__Union._AckDelete_e__Struct>();

    private static readonly uint AckRenameSize =
        SizeWith<CF_OPERATION_PARAMETERS._Anonymous_e__Union._AckRename_e__Struct>();

    /// <summary>中身の一部（offset から length バイト）を渡す。成功なら 0、失敗なら HRESULT</summary>
    public static int Transfer(CallbackKeys keys, byte* buffer, long offset, long length)
    {
        CF_OPERATION_INFO info = NewInfo(CF_OPERATION_TYPE.CF_OPERATION_TYPE_TRANSFER_DATA, keys);
        CF_OPERATION_PARAMETERS parameters = default;
        parameters.ParamSize = TransferDataSize;
        parameters.Anonymous.TransferData.Flags = CF_OPERATION_TRANSFER_DATA_FLAGS.CF_OPERATION_TRANSFER_DATA_FLAG_NONE;
        parameters.Anonymous.TransferData.CompletionStatus = NTSTATUS.STATUS_SUCCESS;
        parameters.Anonymous.TransferData.Buffer = buffer;
        parameters.Anonymous.TransferData.Offset = offset;
        parameters.Anonymous.TransferData.Length = length;
        return PInvoke.CfExecute(&info, &parameters).Value;
    }

    /// <summary>中身を渡せないことを返す（アプリには読み取りの失敗として伝わり、空の内容は渡らない）</summary>
    public static int FailTransfer(CallbackKeys keys, long offset, long length, NTSTATUS status)
    {
        CF_OPERATION_INFO info = NewInfo(CF_OPERATION_TYPE.CF_OPERATION_TYPE_TRANSFER_DATA, keys);
        CF_OPERATION_PARAMETERS parameters = default;
        parameters.ParamSize = TransferDataSize;
        parameters.Anonymous.TransferData.Flags = CF_OPERATION_TRANSFER_DATA_FLAGS.CF_OPERATION_TRANSFER_DATA_FLAG_NONE;
        parameters.Anonymous.TransferData.CompletionStatus = status;
        parameters.Anonymous.TransferData.Buffer = null;
        parameters.Anonymous.TransferData.Offset = offset;
        parameters.Anonymous.TransferData.Length = length;
        return PInvoke.CfExecute(&info, &parameters).Value;
    }

    /// <summary>ゴーストの削除を認める（NOTIFY_DELETE への返事）</summary>
    public static int AcknowledgeDelete(CallbackKeys keys)
    {
        CF_OPERATION_INFO info = NewInfo(CF_OPERATION_TYPE.CF_OPERATION_TYPE_ACK_DELETE, keys);
        CF_OPERATION_PARAMETERS parameters = default;
        parameters.ParamSize = AckDeleteSize;
        parameters.Anonymous.AckDelete.Flags = CF_OPERATION_ACK_DELETE_FLAGS.CF_OPERATION_ACK_DELETE_FLAG_NONE;
        parameters.Anonymous.AckDelete.CompletionStatus = NTSTATUS.STATUS_SUCCESS;
        return PInvoke.CfExecute(&info, &parameters).Value;
    }

    /// <summary>ゴーストの名前の変更・移動を認める（NOTIFY_RENAME への返事）</summary>
    public static int AcknowledgeRename(CallbackKeys keys)
    {
        CF_OPERATION_INFO info = NewInfo(CF_OPERATION_TYPE.CF_OPERATION_TYPE_ACK_RENAME, keys);
        CF_OPERATION_PARAMETERS parameters = default;
        parameters.ParamSize = AckRenameSize;
        parameters.Anonymous.AckRename.Flags = CF_OPERATION_ACK_RENAME_FLAGS.CF_OPERATION_ACK_RENAME_FLAG_NONE;
        parameters.Anonymous.AckRename.CompletionStatus = NTSTATUS.STATUS_SUCCESS;
        return PInvoke.CfExecute(&info, &parameters).Value;
    }

    /// <summary>進み具合をエクスプローラー等へ知らせる（失敗しても処理は続ける）</summary>
    public static void ReportProgress(CallbackKeys keys, long total, long completed)
    {
        PInvoke.CfReportProviderProgress(new CF_CONNECTION_KEY(keys.ConnectionKey), keys.TransferKey, total, completed);
    }

    private static CF_OPERATION_INFO NewInfo(CF_OPERATION_TYPE type, CallbackKeys keys)
    {
        return new CF_OPERATION_INFO
        {
            StructSize = (uint)sizeof(CF_OPERATION_INFO),
            Type = type,
            ConnectionKey = new CF_CONNECTION_KEY(keys.ConnectionKey),
            TransferKey = keys.TransferKey,
            CorrelationVector = null,
            SyncStatus = null,
            RequestKey = keys.RequestKey,
        };
    }

    /// <summary>CF_SIZE_OF_OP_PARAM と同じ：共用体の位置 ＋ T の大きさ</summary>
    private static uint SizeWith<T>()
        where T : unmanaged
    {
        CF_OPERATION_PARAMETERS parameters = default;
        long unionOffset = (byte*)&parameters.Anonymous - (byte*)&parameters;
        return (uint)(unionOffset + sizeof(T));
    }
}
