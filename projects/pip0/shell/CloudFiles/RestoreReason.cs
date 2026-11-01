using Windows.Win32.Foundation;

namespace Pip0Shell.CloudFiles;

/// <summary>
/// cf.restore で、通常のファイルに戻せなかったときの理由の文を作る（Windows の機能を呼ばない部分）。
/// </summary>
internal static class RestoreReason
{
    /// <summary>
    /// CfRevertPlaceholder が失敗したときの理由。
    /// アクセスが拒否され、ゴーストに「読み取り専用」が付いているときだけ、試せることを書き足す。
    ///
    /// Microsoft Learn の CfRevertPlaceholder の説明で求められているのは、呼び出し元がファイルに WRITE_DATA か WRITE_DAC の
    /// 権利を持つことで、読み取り専用の属性は条件に入っていない。Windows の実機では確かめていないため、
    /// 読み取り専用のゴーストを前もって断ることはせず、失敗したときにだけ、念のため案内する。
    /// </summary>
    public static string RevertFailed(int hresult, bool isReadOnly)
    {
        string reason = "通常のファイルに戻せませんでした：" + HResultText.Describe(hresult);
        if (isReadOnly && IsAccessDenied(hresult))
        {
            reason += "。このゴーストには「読み取り専用」が付いています。エクスプローラーでファイルのプロパティを開き、"
                + "「読み取り専用」を外してから、もう一度試してください（中身は保管庫に残っています）。";
        }
        return reason;
    }

    /// <summary>アクセスの拒否か（Windows の ERROR_ACCESS_DENIED と、Cloud Files の ERROR_CLOUD_FILE_ACCESS_DENIED）</summary>
    private static bool IsAccessDenied(int hresult)
    {
        return HResultText.Is(hresult, WIN32_ERROR.ERROR_ACCESS_DENIED)
            || HResultText.Is(hresult, WIN32_ERROR.ERROR_CLOUD_FILE_ACCESS_DENIED);
    }
}
