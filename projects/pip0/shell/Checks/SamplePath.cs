using System;
using System.Text.Json;

namespace Pip0Shell.Checks;

/// <summary>
/// 確認に使うパスの例。シェルは Windows のパスを Path.GetFullPath で整えますが、Windows 以外では
/// Path の決まりが違う（「C:\」で始まるパスを絶対パスと見なさない）ため、Windows 以外ではその OS の絶対パスに置き換えます。
/// 確かめる内容（絶対パスかどうか、受け取ったまま送り返すか等）は同じです。
/// </summary>
internal static class SamplePath
{
    /// <summary>Windows の形のパス（C:\ で始まる）を、この OS の絶対パスにする</summary>
    public static string Of(string windowsPath)
    {
        if (OperatingSystem.IsWindows())
        {
            return windowsPath;
        }
        string rest = windowsPath.Length >= 3 && windowsPath[1] == ':' ? windowsPath.Substring(3) : windowsPath;
        return "/" + char.ToLowerInvariant(windowsPath[0]) + "/" + rest.Replace('\\', '/');
    }

    /// <summary>JSON の文字列にする（「\」などを正しく書く）</summary>
    public static string Json(string text) => JsonSerializer.Serialize(text);
}
