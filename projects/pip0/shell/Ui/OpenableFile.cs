using System;
using System.Collections.Generic;
using System.IO;

namespace Pip0Shell.Ui;

/// <summary>
/// shell.open_file で「既定のアプリで開く」ことをしない種類のファイル（開くとプログラムが動くもの）。
///
/// デスクの「開く」はユーザーの操作ですが、ダウンロードしたばかりの「請求書.pdf.exe」のようなファイルを
/// pip0 のボタン1つで実行させないため、これらは開かずに理由を返します（場所を開くことはできます）。
/// 種類を増やす・減らすときは <see cref="RunnableExtensions"/> を変えてください。
/// </summary>
internal static class OpenableFile
{
    /// <summary>開くと、プログラムやスクリプトが動く拡張子（小文字、点つき）</summary>
    private static readonly HashSet<string> RunnableExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".exe", ".com", ".bat", ".cmd", ".scr", ".pif", ".cpl", ".msi", ".msp", ".mst",
        ".msix", ".msixbundle", ".appx", ".appxbundle", ".appinstaller", ".application", ".appref-ms",
        ".ps1", ".psm1", ".psd1", ".vbs", ".vbe", ".js", ".jse", ".wsf", ".wsh", ".hta", ".jar",
        ".lnk", ".url", ".scf", ".reg", ".inf", ".settingcontent-ms", ".library-ms", ".search-ms",
    };

    /// <summary>開くとプログラムが動く種類なら真</summary>
    public static bool IsRunnable(string path)
    {
        string extension = Path.GetExtension(path.TrimEnd(' ', '.'));
        return extension.Length > 0 && RunnableExtensions.Contains(extension);
    }
}
