using System;
using System.Collections.Generic;
using System.IO;

namespace Pip0Shell.Ui;

/// <summary>
/// shell.open_file で「既定のアプリで開く」ことを認める種類のファイル（文書・画像・音声・動画）。
///
/// デスクやミニドックの「開く」はユーザーの操作ですが、ダウンロードしたばかりのファイルを pip0 のボタン1つで
/// 実行させないため、決まった種類（許可の一覧）だけを開きます。一覧にない種類は開かずに理由を返します（場所は開けます）。
/// 「開くとプログラムが動く種類」を数え上げる方法（禁止の一覧）は、.py（Python）、.msc、.chm のように
/// 既定のアプリがプログラムを動かす種類を数え漏らすため、使いません。
/// 種類を増やすときは <see cref="DocumentExtensions"/> に足してください。足してよいのは、既定のアプリで開いても
/// プログラムやスクリプトが動かない種類だけです（マクロ付きの Office 文書 .docm・.xlsm・.pptm などは足さない）。
/// </summary>
internal static class OpenableFile
{
    /// <summary>
    /// 既定のアプリで開いてよい拡張子（大文字小文字は区別しない）。
    /// .doc・.xls・.ppt（古い形式）にもマクロを入れられますが、Office は保護ビューとマクロの既定の設定
    /// （インターネットから来たファイルのマクロを止める）で、開いただけではマクロを動かしません。
    /// .zip は、エクスプローラー（または登録された圧縮ソフト）で中身の一覧を開くだけです。
    /// </summary>
    private static readonly HashSet<string> DocumentExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        // 文書
        ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp", ".rtf", ".txt", ".csv", ".md",
        // 画像
        ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".heic", ".tif", ".tiff",
        // 音声・動画
        ".mp3", ".m4a", ".wav", ".mp4", ".mov",
        // 圧縮ファイル
        ".zip",
    };

    /// <summary>既定のアプリで開いてよい種類なら真</summary>
    public static bool IsOpenable(string path)
    {
        // ファイル名の部分（「\」と「/」のどちらの区切りでも。確認用のプログラムを Windows 以外でも動かすため）
        string name = path.Substring(path.LastIndexOfAny(new[] { '\\', '/' }) + 1);
        if (name.Contains(':'))
        {
            return false; // 「a.exe:b.pdf」のような代替データストリームの指定は開かない
        }
        // Windows は名前の末尾の点・空白を無視するので（「a.exe. .」は a.exe）、外してから拡張子を見る
        string extension = Path.GetExtension(name.TrimEnd(' ', '.'));
        return extension.Length > 0 && DocumentExtensions.Contains(extension);
    }
}
