using System.Runtime.InteropServices;
using Windows.Win32.Foundation;
using Windows.Win32.UI.Shell;

namespace Pip0Shell.Trash;

/// <summary>
/// IFileOperation の進み具合の知らせを受け取り、「ごみ箱に入るか」を見張る。
///
/// - PreDeleteItem：削除の直前に呼ばれる。dwFlags に TSF_DELETE_RECYCLE_IF_POSSIBLE が付いていなければ、
///   ごみ箱に入らず完全に削除されるということなので、E_ABORT を返してその削除を止める（"refused"）。
/// - PostDeleteItem：削除の後に呼ばれる。psiNewlyCreated（ごみ箱の中にできた項目）がなければ "failed" とする。
///
/// インターフェイスの宣言は CsWin32 が生成したもの（NativeMethods.json の preserveSigMethods で、
/// HRESULT をそのまま返す形にしている）です。ほかの知らせには S_OK を返すだけです。
/// 受け取った IShellItem は、こちらが作った項目と同じ COM のラッパーを共有することがあるため、ここでは解放しません。
/// </summary>
[ComVisible(true)]
[ClassInterface(ClassInterfaceType.None)]
internal sealed class RecycleProgressSink : IFileOperationProgressSink
{
    /// <summary>ごみ箱に入らない削除だったので止めた</summary>
    public bool Refused { get; private set; }

    /// <summary>PostDeleteItem が呼ばれた</summary>
    public bool PostDeleteCalled { get; private set; }

    /// <summary>PostDeleteItem の hrDelete（削除の結果）</summary>
    public int DeleteResult { get; private set; }

    /// <summary>ごみ箱の中に項目ができた</summary>
    public bool RecycleItemCreated { get; private set; }

    public HRESULT PreDeleteItem(uint dwFlags, IShellItem psiItem)
    {
        if ((dwFlags & (uint)_TRANSFER_SOURCE_FLAGS.TSF_DELETE_RECYCLE_IF_POSSIBLE) == 0)
        {
            Refused = true;
            return HRESULT.E_ABORT;
        }
        return HRESULT.S_OK;
    }

    public HRESULT PostDeleteItem(uint dwFlags, IShellItem psiItem, HRESULT hrDelete, IShellItem psiNewlyCreated)
    {
        PostDeleteCalled = true;
        DeleteResult = hrDelete.Value;
        RecycleItemCreated = psiNewlyCreated is not null;
        return HRESULT.S_OK;
    }

    public HRESULT StartOperations() => HRESULT.S_OK;

    public HRESULT FinishOperations(HRESULT hrResult) => HRESULT.S_OK;

    public HRESULT PreRenameItem(uint dwFlags, IShellItem psiItem, PCWSTR pszNewName) => HRESULT.S_OK;

    public HRESULT PostRenameItem(uint dwFlags, IShellItem psiItem, PCWSTR pszNewName, HRESULT hrRename, IShellItem psiNewlyCreated)
        => HRESULT.S_OK;

    public HRESULT PreMoveItem(uint dwFlags, IShellItem psiItem, IShellItem psiDestinationFolder, PCWSTR pszNewName)
        => HRESULT.S_OK;

    public HRESULT PostMoveItem(uint dwFlags, IShellItem psiItem, IShellItem psiDestinationFolder, PCWSTR pszNewName, HRESULT hrMove, IShellItem psiNewlyCreated)
        => HRESULT.S_OK;

    public HRESULT PreCopyItem(uint dwFlags, IShellItem psiItem, IShellItem psiDestinationFolder, PCWSTR pszNewName)
        => HRESULT.S_OK;

    public HRESULT PostCopyItem(uint dwFlags, IShellItem psiItem, IShellItem psiDestinationFolder, PCWSTR pszNewName, HRESULT hrCopy, IShellItem psiNewlyCreated)
        => HRESULT.S_OK;

    public HRESULT PreNewItem(uint dwFlags, IShellItem psiDestinationFolder, PCWSTR pszNewName) => HRESULT.S_OK;

    public HRESULT PostNewItem(uint dwFlags, IShellItem psiDestinationFolder, PCWSTR pszNewName, PCWSTR pszTemplateName, uint dwFileAttributes, HRESULT hrNew, IShellItem psiNewItem)
        => HRESULT.S_OK;

    public HRESULT UpdateProgress(uint iWorkTotal, uint iWorkSoFar) => HRESULT.S_OK;

    public HRESULT ResetTimer() => HRESULT.S_OK;

    public HRESULT PauseTimer() => HRESULT.S_OK;

    public HRESULT ResumeTimer() => HRESULT.S_OK;
}
