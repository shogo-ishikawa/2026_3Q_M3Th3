using System;
using System.IO;
using System.Security;
using Microsoft.Win32;

namespace Pip0Shell.Context;

/// <summary>
/// Windows が「最近使ったファイル」を記録する設定を、レジストリーから読む（読むだけで、変えません）。
///
/// - HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced の Start_TrackDocs（設定アプリの
///   「最近開いた項目を…表示する」）。値がなければ Windows の初期値（記録する）。
/// - ポリシー NoRecentDocsHistory（HKCU と HKLM の Software\Microsoft\Windows\CurrentVersion\Policies\Explorer）が 1 なら記録しない。
/// 解釈は <see cref="RecentItems.InterpretTracking"/> が行います。
/// </summary>
internal static class RecentTrackingSetting
{
    private const string AdvancedKey = @"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced";
    private const string PolicyKey = @"Software\Microsoft\Windows\CurrentVersion\Policies\Explorer";

    public static RecentTrackingReading Read()
    {
        try
        {
            int? trackDocs;
            using (RegistryKey? key = Registry.CurrentUser.OpenSubKey(AdvancedKey))
            {
                object? value = key?.GetValue("Start_TrackDocs");
                if (value is null)
                {
                    trackDocs = null;
                }
                else if (!TryReadNumber(value, out int number))
                {
                    return new RecentTrackingReading(false, null, false); // 形が違って解釈できない
                }
                else
                {
                    trackDocs = number;
                }
            }
            bool policy = PolicyDisables(Registry.CurrentUser) || PolicyDisables(Registry.LocalMachine);
            return new RecentTrackingReading(true, trackDocs, policy);
        }
        catch (Exception error) when (error is SecurityException or UnauthorizedAccessException or IOException)
        {
            return new RecentTrackingReading(false, null, false);
        }
    }

    private static bool PolicyDisables(RegistryKey hive)
    {
        using RegistryKey? key = hive.OpenSubKey(PolicyKey);
        object? value = key?.GetValue("NoRecentDocsHistory");
        return value is not null && TryReadNumber(value, out int number) && number != 0;
    }

    /// <summary>DWORD（int）か、4 バイト以上の REG_BINARY を数として読む</summary>
    private static bool TryReadNumber(object value, out int number)
    {
        switch (value)
        {
            case int dword:
                number = dword;
                return true;
            case byte[] bytes when bytes.Length >= 4:
                number = BitConverter.ToInt32(bytes, 0);
                return true;
            default:
                number = 0;
                return false;
        }
    }
}
