using System.Collections.Generic;
using Pip0Shell.Core;
using Windows.Win32.Foundation;

namespace Pip0Shell.CloudFiles;

/// <summary>
/// Windows のエラー番号（HRESULT）を、利用者に見せる日本語の理由にする。
/// 理由の後ろに「（0x8007016A）」の形で番号を付けるので、知らない番号でも調べられます。
/// </summary>
internal static class HResultText
{
    private static readonly Dictionary<WIN32_ERROR, string> Win32Texts = new()
    {
        [WIN32_ERROR.ERROR_FILE_NOT_FOUND] = "ファイルが見つかりません",
        [WIN32_ERROR.ERROR_PATH_NOT_FOUND] = "フォルダーが見つかりません",
        [WIN32_ERROR.ERROR_ACCESS_DENIED] = "アクセスが拒否されました（権限がないか、読み取り専用です）",
        [WIN32_ERROR.ERROR_INVALID_HANDLE] = "ファイルのハンドルが正しくありません",
        [WIN32_ERROR.ERROR_WRITE_PROTECT] = "書き込みが禁止されたドライブです",
        [WIN32_ERROR.ERROR_NOT_READY] = "ドライブの準備ができていません（取り外された可能性があります）",
        [WIN32_ERROR.ERROR_SHARING_VIOLATION] = "ほかのアプリが使用中です",
        [WIN32_ERROR.ERROR_LOCK_VIOLATION] = "ほかのアプリがファイルの一部をロックしています",
        [WIN32_ERROR.ERROR_HANDLE_DISK_FULL] = "ディスクの空き容量が足りません",
        [WIN32_ERROR.ERROR_DISK_FULL] = "ディスクの空き容量が足りません",
        [WIN32_ERROR.ERROR_NOT_SUPPORTED] = "この場所（ファイルシステム）では使えない操作です",
        [WIN32_ERROR.ERROR_INVALID_FUNCTION] = "この場所（ファイルシステム）では使えない操作です",
        [WIN32_ERROR.ERROR_INVALID_PARAMETER] = "指定が正しくありません",
        [WIN32_ERROR.ERROR_INVALID_NAME] = "パスまたは名前が正しくありません",
        [WIN32_ERROR.ERROR_BAD_PATHNAME] = "パスまたは名前が正しくありません",
        [WIN32_ERROR.ERROR_FILENAME_EXCED_RANGE] = "パスが長すぎます",
        [WIN32_ERROR.ERROR_ALREADY_EXISTS] = "同じ名前のものがすでにあります",
        [WIN32_ERROR.ERROR_DIRECTORY] = "フォルダーの指定が正しくありません",
        [WIN32_ERROR.ERROR_OPLOCK_NOT_GRANTED] = "ほかのアプリが使用中のため、排他的に開けません",
        [WIN32_ERROR.ERROR_OPERATION_ABORTED] = "操作が中止されました",
        [WIN32_ERROR.ERROR_CANCELLED] = "操作が取り消されました",
        [WIN32_ERROR.ERROR_USER_MAPPED_FILE] = "ほかのアプリがファイルをメモリーに割り当てて使用中です",
        [WIN32_ERROR.ERROR_CLOUD_FILE_SYNC_ROOT_METADATA_CORRUPT] = "同期ルートの管理情報が壊れています",
        [WIN32_ERROR.ERROR_CLOUD_FILE_PROVIDER_NOT_RUNNING] = "クラウド ファイル プロバイダー（pip0 シェル）が接続されていません",
        [WIN32_ERROR.ERROR_CLOUD_FILE_METADATA_CORRUPT] = "プレースホルダーの管理情報が壊れています",
        [WIN32_ERROR.ERROR_CLOUD_FILE_METADATA_TOO_LARGE] = "プレースホルダーの管理情報が大きすぎます",
        [WIN32_ERROR.ERROR_NOT_A_CLOUD_FILE] = "プレースホルダー（ゴースト）ではありません",
        [WIN32_ERROR.ERROR_CLOUD_FILE_NOT_IN_SYNC] = "同期済みの状態ではありません（変更があります）",
        [WIN32_ERROR.ERROR_CLOUD_FILE_ALREADY_CONNECTED] = "ほかのプロセスがすでにこの同期ルートに接続しています",
        [WIN32_ERROR.ERROR_CLOUD_FILE_NOT_SUPPORTED] = "Cloud Files API がこの操作に対応していません",
        [WIN32_ERROR.ERROR_CLOUD_FILE_INVALID_REQUEST] = "Cloud Files API への要求が正しくありません",
        [WIN32_ERROR.ERROR_CLOUD_FILE_READ_ONLY_VOLUME] = "読み取り専用のドライブです",
        [WIN32_ERROR.ERROR_CLOUD_FILE_CONNECTED_PROVIDER_ONLY] = "同期ルートに接続したプロバイダーだけが行える操作です",
        [WIN32_ERROR.ERROR_CLOUD_FILE_VALIDATION_FAILED] = "データの検証に失敗しました",
        [WIN32_ERROR.ERROR_CLOUD_FILE_INSUFFICIENT_RESOURCES] = "資源（メモリー等）が足りません",
        [WIN32_ERROR.ERROR_CLOUD_FILE_UNSUCCESSFUL] = "クラウド ファイルの操作に失敗しました",
        [WIN32_ERROR.ERROR_CLOUD_FILE_NOT_UNDER_SYNC_ROOT] = "同期ルートの中にありません",
        [WIN32_ERROR.ERROR_CLOUD_FILE_IN_USE] = "使用中のため処理できません",
        [WIN32_ERROR.ERROR_CLOUD_FILE_PINNED] = "「常にこのデバイス上に保持する」が設定されているため、中身を外せません",
        [WIN32_ERROR.ERROR_CLOUD_FILE_REQUEST_ABORTED] = "要求が中止されました",
        [WIN32_ERROR.ERROR_CLOUD_FILE_PROPERTY_CORRUPT] = "プレースホルダーの情報が壊れています",
        [WIN32_ERROR.ERROR_CLOUD_FILE_ACCESS_DENIED] = "クラウド ファイルの操作が拒否されました（書き込みの権限が必要です）",
        [WIN32_ERROR.ERROR_CLOUD_FILE_INCOMPATIBLE_HARDLINKS] = "ハードリンクがあるため処理できません",
        [WIN32_ERROR.ERROR_CLOUD_FILE_PROPERTY_LOCK_CONFLICT] = "ほかの処理と競合しました",
        [WIN32_ERROR.ERROR_CLOUD_FILE_REQUEST_CANCELED] = "要求が取り消されました",
        [WIN32_ERROR.ERROR_CLOUD_FILE_PROVIDER_TERMINATED] = "クラウド ファイル プロバイダーが終了しました",
        [WIN32_ERROR.ERROR_NOT_A_CLOUD_SYNC_ROOT] = "同期ルートではありません",
        [WIN32_ERROR.ERROR_CLOUD_FILE_REQUEST_TIMEOUT] = "要求が時間切れになりました",
        [WIN32_ERROR.ERROR_CLOUD_FILE_DEHYDRATION_DISALLOWED] = "中身を外すことが許可されていません",
    };

    private static readonly Dictionary<int, string> OtherTexts = new()
    {
        [HRESULT.E_ABORT.Value] = "操作が中止されました",
        [HRESULT.REGDB_E_CLASSNOTREG.Value] = "必要な Windows の部品が登録されていません",
        [HRESULT.COPYENGINE_E_USER_CANCELLED.Value] = "操作が取り消されました",
        [HRESULT.COPYENGINE_E_SHARING_VIOLATION_SRC.Value] = "ほかのアプリが使用中です",
        [HRESULT.COPYENGINE_E_ACCESS_DENIED_SRC.Value] = "アクセスが拒否されました（権限がありません）",
        [HRESULT.COPYENGINE_E_PATH_NOT_FOUND_SRC.Value] = "ファイルが見つかりません",
        [HRESULT.COPYENGINE_E_RECYCLE_BIN_NOT_FOUND.Value] = "この場所にはごみ箱がありません",
        [HRESULT.COPYENGINE_E_RECYCLE_FORCE_NUKE.Value] = "ごみ箱に入らず完全に削除される設定です",
        [HRESULT.COPYENGINE_E_RECYCLE_SIZE_TOO_BIG.Value] = "ごみ箱に入れるには大きすぎます",
        [HRESULT.COPYENGINE_E_REQUIRES_ELEVATION.Value] = "管理者の権限が必要です",
        [unchecked((int)0x8007000E)] = "メモリーが足りません",
        [unchecked((int)0x80004001)] = "この Windows では使えない機能です",
        [unchecked((int)0x80070490)] = "見つかりません",
    };

    /// <summary>Win32 のエラー番号を HRESULT にする（HRESULT_FROM_WIN32）</summary>
    public static int FromWin32(WIN32_ERROR error)
    {
        return unchecked((int)(0x80070000u | ((uint)error & 0xFFFFu)));
    }

    public static int FromWin32(int error)
    {
        return error <= 0 ? error : unchecked((int)(0x80070000u | ((uint)error & 0xFFFFu)));
    }

    public static bool Is(int hresult, WIN32_ERROR error) => hresult == FromWin32(error);

    /// <summary>「日本語の理由（0x80070020）」の形にする</summary>
    public static string Describe(int hresult)
    {
        return Text(hresult) + "（" + Log.Hex(hresult) + "）";
    }

    private static string Text(int hresult)
    {
        uint value = unchecked((uint)hresult);
        if ((value & 0xFFFF0000u) == 0x80070000u
            && Win32Texts.TryGetValue((WIN32_ERROR)(value & 0xFFFFu), out string? win32Text))
        {
            return win32Text;
        }
        if (OtherTexts.TryGetValue(hresult, out string? otherText))
        {
            return otherText;
        }
        return "Windows のエラーです";
    }
}
