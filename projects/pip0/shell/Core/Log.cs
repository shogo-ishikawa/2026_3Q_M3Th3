using System;
using System.Globalization;
using System.IO;
using System.Text;

namespace Pip0Shell.Core;

/// <summary>
/// 動作の記録を、標準エラー出力へ UTF-8 で書きます（pip0 本体がこれを読み、記録に残します）。
///
/// ここには、ファイル名・パス・URL・ファイルの中身・ウィンドウタイトルを書きません。
/// 書いてよいのは、処理の種類、件数、HRESULT（エラーの番号）、項目ID だけです。
/// 例外の Message にはパスが入ることがあるので、<see cref="Describe"/> で種類と番号だけにします。
/// </summary>
internal static class Log
{
    private static readonly object Gate = new();
    private static TextWriter writer = TextWriter.Null;

    public static void Initialise()
    {
        try
        {
            Stream stream = Console.OpenStandardError();
            writer = new StreamWriter(stream, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false))
            {
                AutoFlush = true,
            };
        }
        catch (Exception)
        {
            // 標準エラー出力が使えなくても、シェルの動作は続ける
            writer = TextWriter.Null;
        }
    }

    public static void Info(string message) => Write("情報", message);

    public static void Warning(string message) => Write("注意", message);

    public static void Error(string message) => Write("エラー", message);

    /// <summary>例外を「種類（HRESULT）」の文字列にする。Message は使わない</summary>
    public static string Describe(Exception error)
    {
        return error.GetType().Name + "（HRESULT 0x" + error.HResult.ToString("X8", CultureInfo.InvariantCulture) + "）";
    }

    /// <summary>HRESULT を「0x8007016A」の形の文字列にする</summary>
    public static string Hex(int hresult) => "0x" + hresult.ToString("X8", CultureInfo.InvariantCulture);

    private static void Write(string level, string message)
    {
        string time = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);
        string line = time + " [pip0-shell] [" + level + "] " + message;
        lock (Gate)
        {
            try
            {
                writer.WriteLine(line);
            }
            catch (Exception)
            {
                // 記録できなくても、シェルの動作は続ける
            }
        }
    }
}
