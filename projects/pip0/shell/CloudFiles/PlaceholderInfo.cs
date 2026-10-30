using System;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.Storage.CloudFilters;

namespace Pip0Shell.CloudFiles;

/// <summary>
/// プレースホルダー（ゴースト）の状態。CfGetPlaceholderInfo（CF_PLACEHOLDER_INFO_STANDARD）で読みます。
/// </summary>
internal sealed class PlaceholderInfo
{
    /// <summary>FileIdentity の最大の長さ（CF_PLACEHOLDER_MAX_FILE_IDENTITY_LENGTH）</summary>
    private const int MaxIdentityLength = 4096;

    public static readonly PlaceholderInfo NotPlaceholder = new();

    /// <summary>Cloud Files のプレースホルダーか（偽なら通常のファイル）</summary>
    public bool IsPlaceholder { get; private init; }

    /// <summary>FileIdentity が項目ID（32桁の16進数の ASCII）なら、その文字列。違えば null</summary>
    public string? ItemId { get; private init; }

    /// <summary>ディスク上にある中身のバイト数。0 なら中身はディスクにない</summary>
    public long OnDiskDataSize { get; private init; }

    /// <summary>同期済み（保管庫の内容と同じ）の印が付いているか</summary>
    public bool InSync { get; private init; }

    public CF_PIN_STATE PinState { get; private init; }

    /// <summary>
    /// ハンドルのファイルの状態を読む。通常のファイルなら <see cref="NotPlaceholder"/> と 0 を返す。
    /// 読めなかったら HRESULT を返す。
    /// </summary>
    public static unsafe int TryRead(HANDLE handle, out PlaceholderInfo info)
    {
        int bufferSize = sizeof(CF_PLACEHOLDER_STANDARD_INFO) + MaxIdentityLength;
        byte* buffer = stackalloc byte[bufferSize];
        uint returned = 0;
        HRESULT result = PInvoke.CfGetPlaceholderInfo(
            handle,
            CF_PLACEHOLDER_INFO_CLASS.CF_PLACEHOLDER_INFO_STANDARD,
            buffer,
            (uint)bufferSize,
            &returned);

        if (HResultText.Is(result.Value, WIN32_ERROR.ERROR_NOT_A_CLOUD_FILE))
        {
            info = NotPlaceholder;
            return 0;
        }
        if (result.Failed)
        {
            info = NotPlaceholder;
            return result.Value;
        }

        var standard = (CF_PLACEHOLDER_STANDARD_INFO*)buffer;
        byte* identityStart = (byte*)&standard->FileIdentity;
        int available = bufferSize - (int)(identityStart - buffer);
        int identityLength = (int)Math.Min(standard->FileIdentityLength, (uint)available);
        var identity = new ReadOnlySpan<byte>(identityStart, identityLength);

        info = new PlaceholderInfo
        {
            IsPlaceholder = true,
            ItemId = CloudFiles.ItemId.FromIdentity(identity),
            OnDiskDataSize = standard->OnDiskDataSize,
            InSync = standard->InSyncState == CF_IN_SYNC_STATE.CF_IN_SYNC_STATE_IN_SYNC,
            PinState = standard->PinState,
        };
        return 0;
    }
}
