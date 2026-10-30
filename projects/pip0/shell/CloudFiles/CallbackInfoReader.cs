using System;
using Windows.Win32.Storage.CloudFilters;

namespace Pip0Shell.CloudFiles;

/// <summary>
/// コールバックの CF_CALLBACK_INFO から値を読む。
/// CF_CALLBACK_INFO の中のポインターはコールバックの間だけ有効なので、ここで文字列や数値に写します。
/// </summary>
internal static unsafe class CallbackInfoReader
{
    private const int MaxIdentityLength = 4096;

    public static CallbackKeys Keys(CF_CALLBACK_INFO* info)
    {
        return new CallbackKeys(info->ConnectionKey.Value, info->TransferKey, info->RequestKey);
    }

    /// <summary>FileIdentity が項目IDなら、その文字列。違えば null</summary>
    public static string? ItemId(CF_CALLBACK_INFO* info)
    {
        if (info->FileIdentity == null || info->FileIdentityLength == 0 || info->FileIdentityLength > MaxIdentityLength)
        {
            return null;
        }
        return CloudFiles.ItemId.FromIdentity(new ReadOnlySpan<byte>(info->FileIdentity, (int)info->FileIdentityLength));
    }

    /// <summary>コールバックの対象のファイルの完全なパス（C:\Users\…）</summary>
    public static string? FullPath(CF_CALLBACK_INFO* info)
    {
        return WithVolume(info, info->NormalizedPath.ToString());
    }

    /// <summary>
    /// ボリュームからのパス（「\Users\u\pip0\a.pdf」）に、ドライブ名（「C:」）を付ける。
    /// すでにドライブ名などが付いていれば、そのまま使う。
    /// </summary>
    public static string? WithVolume(CF_CALLBACK_INFO* info, string? path)
    {
        if (string.IsNullOrEmpty(path))
        {
            return null;
        }
        if (path.StartsWith(@"\??\", StringComparison.Ordinal))
        {
            return PathText.StripLongPathPrefix(@"\\?\" + path.Substring(4));
        }
        if (path.StartsWith(@"\\", StringComparison.Ordinal))
        {
            return PathText.StripLongPathPrefix(path);
        }
        if (path.Length >= 2 && path[1] == ':')
        {
            return path;
        }
        if (path[0] == '\\')
        {
            string? dosName = info->VolumeDosName.ToString();
            if (!string.IsNullOrEmpty(dosName))
            {
                return dosName.TrimEnd('\\') + path;
            }
            string? guidName = info->VolumeGuidName.ToString();
            if (!string.IsNullOrEmpty(guidName))
            {
                return guidName.TrimEnd('\\') + path;
            }
        }
        return path;
    }

    /// <summary>ファイルを開いたプロセスの番号と実行ファイル名（CF_CONNECT_FLAG_REQUIRE_PROCESS_INFO で届く）</summary>
    public static (uint? ProcessId, string? ProcessName) Process(CF_CALLBACK_INFO* info)
    {
        CF_PROCESS_INFO* process = info->ProcessInfo;
        if (process == null)
        {
            return (null, null);
        }
        uint minimumSize = (uint)((byte*)&process->PackageName - (byte*)process);
        if (process->StructSize < minimumSize)
        {
            return (null, null);
        }
        string? imagePath = process->ImagePath.ToString();
        string? name = string.IsNullOrEmpty(imagePath) ? null : System.IO.Path.GetFileName(imagePath);
        return (process->ProcessId, string.IsNullOrEmpty(name) ? null : name);
    }
}
