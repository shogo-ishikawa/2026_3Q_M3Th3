using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using System.Threading;
using Microsoft.Win32.SafeHandles;
using Pip0Shell.Core;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.Storage.CloudFilters;
using Windows.Win32.Storage.FileSystem;
using ComTypes = System.Runtime.InteropServices.ComTypes;

namespace Pip0Shell.CloudFiles;

/// <summary>cf.make_ghost の "expected"：保管庫へコピーしたときの原本の値</summary>
internal sealed record GhostExpectation(long Size, long MtimeNs, string FileKey, string Sha256);

/// <summary>
/// ゴースト（プレースホルダー）の状態を読む・作る・戻す・探す（cf.status、cf.make_ghost、cf.restore、cf.locate）。
/// 手順は docs/ipc-protocol.md の2節と docs/design.md の7節に合わせています。
///
/// 大事な約束：
/// - ゴーストにする前に、原本と保管庫の両方が expected と一致することを確かめる。1つでも違えば "changed" で、何も変えない。
/// - 通常のファイルへ戻す前に、自分で中身を戻し（CfHydratePlaceholder）、中身がすべてディスクにあることを確かめる。
///   CfRevertPlaceholder は、中身がそろっていなければ自分で FETCH_DATA を呼んで中身を戻し、戻せなければ失敗します
///   （STATUS_CLOUD_FILE_ACCESS_DENIED）。それでも先に自分で戻すのは、保管庫のハッシュの確認と「すべてディスクにある」ことの
///   確認を、排他的なハンドルで戻す直前に行い、失敗の理由をはっきり返すためです。
///   「すべてある」と判断するのは、CfGetPlaceholderInfo の OnDiskDataSize がファイルの大きさ以上で、かつ
///   属性に RECALL_ON_DATA_ACCESS（データの一部がローカルにない印）が付いていないときだけです。
/// - 確かめられなかったことを、確かな答えとして返さない（cf.status の値は、分からなければ null）。
/// </summary>
internal sealed class PlaceholderOperations
{
    private const int HashChunkBytes = 1024 * 1024;
    private const nuint BufferAlignment = 4096;
    private const string BrokenByOtherApp = "ほかのアプリがファイルを開こうとしたため、中止しました（後でもう一度試せます）。";

    private readonly SyncProvider provider;
    private readonly ShellState state;

    public PlaceholderOperations(SyncProvider provider, ShellState state)
    {
        this.provider = provider;
        this.state = state;
    }

    // ------------------------------------------------------------------
    // cf.status
    // ------------------------------------------------------------------

    /// <summary>
    /// {"exists", "is_ghost", "item_id", "dehydrated", "in_sync", "pinned", "reason"} を返す。
    /// 読めなかった値は null（分からない）にする。「読めなかった」を「ゴーストではない」「ファイルがない」として返すと、
    /// 本体が、ゴーストを通常のファイルと思い込んで保管庫の扱いを誤るため。
    /// </summary>
    public JsonObject Status(string path)
    {
        EntryLookup found = DirectoryEntry.Find(path, out EntryInfo entry, out int findResult);
        if (found == EntryLookup.NotFound)
        {
            return StatusResult(false, false, null, null, null, null, "ファイルがありません。");
        }
        if (found == EntryLookup.Unknown)
        {
            return StatusResult(null, null, null, null, null, null, "ファイルがあるかを確かめられません：" + HResultText.Describe(findResult));
        }
        if (entry.IsDirectory)
        {
            return StatusResult(true, false, null, false, null, null, "フォルダーです（ゴーストになるのはファイルだけです）。");
        }
        if (entry.IsLink)
        {
            return StatusResult(true, false, null, false, null, null, "リンク（シンボリックリンク等）です。たどりません。");
        }

        // 属性を読むだけの開き方なので、ゴーストの中身を取りに行かせない
        using SafeFileHandle file = OpenForAttributes(path);
        if (file.IsInvalid)
        {
            int openResult = HResultText.FromWin32(Marshal.GetLastPInvokeError());
            if (IsNotFound(openResult))
            {
                return StatusResult(false, false, null, null, null, null, "ファイルがありません。");
            }
            return StatusResult(true, null, null, null, null, null, "状態を読めません：" + HResultText.Describe(openResult));
        }

        HANDLE handle = (HANDLE)file.DangerousGetHandle();
        FileSnapshot? snapshot = FileSnapshot.TryRead(handle, out int snapshotResult);
        if (snapshot is null)
        {
            return StatusResult(true, null, null, null, null, null, "状態を読めません：" + HResultText.Describe(snapshotResult));
        }
        int infoResult = PlaceholderInfo.TryRead(handle, out PlaceholderInfo info);
        if (infoResult < 0)
        {
            return StatusResult(true, null, null, null, null, null, "プレースホルダーの状態を読めません：" + HResultText.Describe(infoResult));
        }

        bool pinnedAttribute = (snapshot.Attributes & (uint)FILE_FLAGS_AND_ATTRIBUTES.FILE_ATTRIBUTE_PINNED) != 0;
        if (!info.IsPlaceholder)
        {
            return StatusResult(true, false, null, false, null, pinnedAttribute, "");
        }

        bool dehydrated = snapshot.Size > 0 && info.OnDiskDataSize == 0;
        bool pinned = info.PinState == CF_PIN_STATE.CF_PIN_STATE_PINNED || pinnedAttribute;
        string? root = provider.RootPath ?? state.Configuration?.Pip0Root;
        if (info.ItemId is not null && root is null)
        {
            return StatusResult(true, null, null, dehydrated, info.InSync, pinned, "pip0 専用フォルダーの場所が分からないため、pip0 のゴーストかを確かめられません。");
        }
        bool ours = info.ItemId is not null && PathText.IsInside(path, root!);
        return StatusResult(
            true,
            ours,
            ours ? info.ItemId : null,
            dehydrated,
            info.InSync,
            pinned,
            ours ? "" : "pip0 の項目ではないプレースホルダーです（ほかのクラウドの同期フォルダーのファイル等）。");
    }

    // ------------------------------------------------------------------
    // cf.make_ghost
    // ------------------------------------------------------------------

    /// <summary>{"result": "ghosted"/"changed"/"locked"/"not_in_root"/"error", "reason"} を返す</summary>
    public JsonObject MakeGhost(string path, string itemId, GhostExpectation expected, CancellationToken shutdown)
    {
        string? root = provider.RootPath;
        string? rootFinal = provider.RootFinalPath;
        if (root is null || rootFinal is null)
        {
            return Outcome("error", "同期ルートに接続していません（先に cf.connect が必要です）。");
        }
        if (!PathText.IsInside(path, root))
        {
            return Outcome("not_in_root", "pip0 の同期ルート（pip0 専用フォルダー）の外にあります。");
        }
        string? vaultDir = state.Configuration?.VaultDir;
        if (vaultDir is null)
        {
            return Outcome("error", "保管庫の場所が設定されていません。");
        }

        EntryLookup found = DirectoryEntry.Find(path, out EntryInfo entry, out int findResult);
        if (found == EntryLookup.NotFound)
        {
            return Outcome("changed", "ファイルが見つかりません。");
        }
        if (found == EntryLookup.Unknown)
        {
            return Outcome("error", "ファイルがあるかを確かめられません：" + HResultText.Describe(findResult));
        }
        if (entry.IsDirectory)
        {
            return Outcome("error", "フォルダーはゴーストにしません。");
        }
        if (entry.IsLink)
        {
            return Outcome("error", "リンク（シンボリックリンク等）はゴーストにしません。");
        }
        if (entry.IsReadOnly)
        {
            // CfConvertToPlaceholder には、書き込み（WRITE_DATA）の権利のあるハンドルが要る。
            // 読み取り専用のファイルは書き込みの権利で開けないので、何度試しても失敗する
            return Outcome("error", "読み取り専用のファイルのため、ゴーストにしません（何度試しても同じです）。");
        }

        // 1. 保管庫の内容が expected（大きさとハッシュ）に一致するか。
        //    原本を排他的に開いている時間を短くするため、原本を開く前に確かめる。
        //    確かめた内容は、変換が終わるまで開いたままにして、ほかのプロセスに書き換え・削除させない
        VaultContent? content;
        try
        {
            content = VaultContent.OpenVerified(
                vaultDir, itemId, expected.Size, expected.Sha256, null, shutdown, out VaultProblem kind, out string problem);
            if (content is null)
            {
                return Outcome(kind == VaultProblem.Mismatch ? "changed" : "error", problem);
            }
        }
        catch (OperationCanceledException)
        {
            return Outcome("error", "シェルが終了するため、中止しました。");
        }

        using (content)
        {
            // 2. 原本を、ほかのアプリと共有しない形で開く（ほかのアプリが開こうとすると、こちらが身を引く）
            int openResult = ProtectedFile.Open(
                path,
                CF_OPEN_FILE_FLAGS.CF_OPEN_FILE_FLAG_EXCLUSIVE | CF_OPEN_FILE_FLAGS.CF_OPEN_FILE_FLAG_WRITE_ACCESS,
                out ProtectedFile? file);
            if (openResult < 0 || file is null)
            {
                return Outcome(ClassifyOpenFailure(openResult), "原本を排他的に開けません：" + HResultText.Describe(openResult));
            }

            using (file)
            {
                return MakeGhostWithOpenFile(file, itemId, expected, rootFinal, shutdown);
            }
        }
    }

    private static unsafe JsonObject MakeGhostWithOpenFile(
        ProtectedFile file, string itemId, GhostExpectation expected, string rootFinal, CancellationToken shutdown)
    {
        // 3. 本当の場所、すでにプレースホルダーか、大きさ・更新日時・ファイル番号
        if (!file.TryReference(out HANDLE handle))
        {
            return Outcome("locked", BrokenByOtherApp);
        }
        FileSnapshot? before;
        try
        {
            string? finalPath = FinalPath.Of(handle);
            if (finalPath is null || !PathText.IsInside(finalPath, rootFinal))
            {
                return Outcome("not_in_root", "ファイルの実際の場所が、pip0 の同期ルートの外です。");
            }
            before = FileSnapshot.TryRead(handle, out int snapshotResult);
            if (before is null)
            {
                return Outcome("error", "大きさと更新日時を読めません：" + HResultText.Describe(snapshotResult));
            }
            int infoResult = PlaceholderInfo.TryRead(handle, out PlaceholderInfo existing);
            if (infoResult < 0)
            {
                return Outcome("error", "プレースホルダーかどうかを確かめられません：" + HResultText.Describe(infoResult));
            }
            if (existing.IsPlaceholder)
            {
                return AlreadyPlaceholder(existing, itemId, before.Size);
            }
            if (!DisableLastAccessUpdate(handle))
            {
                // CfOpenFileWithOplock のハンドルには FILE_WRITE_ATTRIBUTES がないため、Windows が断ることがある。
                // そのときは、この後の確認の読み取りで、最終アクセス日時が更新されうる（README の「制約」を参照）
                Log.Info("ゴーストにする前の確認の読み取りで、最終アクセス日時の更新を止められませんでした。");
            }
        }
        finally
        {
            file.Release();
        }

        string? difference = Compare(before, expected);
        if (difference is not null)
        {
            return Outcome("changed", difference);
        }

        // 4. 原本を読み直して、ハッシュが expected.sha256 と一致するか
        HashOutcome hash = HashThroughHandle(file, before.Size, shutdown);
        if (hash.FailureResult is not null)
        {
            return Outcome(hash.FailureResult, hash.Reason);
        }
        if (!VaultContent.HexEquals(hash.Sha256, expected.Sha256))
        {
            return Outcome("changed", "原本の内容のハッシュが、保管庫へコピーしたときと一致しません。");
        }

        // 5. もう一度確かめてから、プレースホルダーに変換して中身を外す（同じ参照の中で行う）
        if (!file.TryReference(out handle))
        {
            return Outcome("locked", BrokenByOtherApp);
        }
        try
        {
            FileSnapshot? now = FileSnapshot.TryRead(handle, out int nowResult);
            if (now is null)
            {
                return Outcome("error", "大きさと更新日時を読めません：" + HResultText.Describe(nowResult));
            }
            difference = Compare(now, expected);
            if (difference is not null)
            {
                return Outcome("changed", difference);
            }

            byte[] identity = ItemId.ToIdentity(itemId);
            int convertResult;
            fixed (byte* identityBytes = identity)
            {
                convertResult = PInvoke.CfConvertToPlaceholder(
                    handle,
                    identityBytes,
                    (uint)identity.Length,
                    CF_CONVERT_FLAGS.CF_CONVERT_FLAG_MARK_IN_SYNC | CF_CONVERT_FLAGS.CF_CONVERT_FLAG_DEHYDRATE,
                    null,
                    null).Value;
            }

            // 6. 結果を、報告ではなく実際の状態で確かめる
            return ConfirmGhost(handle, itemId, now.Size, convertResult);
        }
        finally
        {
            file.Release();
        }
    }

    /// <summary>変換の後の状態を読み、"ghosted" かどうかを決める。中身が外れていなければ通常のファイルに戻す</summary>
    private static unsafe JsonObject ConfirmGhost(HANDLE handle, string itemId, long size, int convertResult)
    {
        int infoResult = PlaceholderInfo.TryRead(handle, out PlaceholderInfo after);
        if (infoResult < 0 || !after.IsPlaceholder)
        {
            if (convertResult < 0)
            {
                return Outcome(ClassifyConvertFailure(convertResult), "プレースホルダーに変換できませんでした：" + HResultText.Describe(convertResult));
            }
            return Outcome("error", infoResult < 0
                ? "変換の後の状態を確かめられません：" + HResultText.Describe(infoResult)
                : "変換したはずのファイルが、プレースホルダーになっていません。");
        }
        if (!ItemId.Same(after.ItemId, itemId))
        {
            return Outcome("error", "別の項目のプレースホルダーになっています。");
        }

        // 中身がすべてディスクにあると言えるのは、2つの印（OnDiskDataSize と属性）がどちらもそう示すときだけ
        FileSnapshot? afterSnapshot = FileSnapshot.TryRead(handle, out _);
        bool fullyOnDisk = after.OnDiskDataSize >= size && afterSnapshot is { DataNotFullyLocal: false };
        if (size > 0 && !fullyOnDisk)
        {
            // 中身がディスクから外れた：開けば保管庫から戻るゴーストになった
            string note = after.OnDiskDataSize == 0 ? "" : "中身の一部がディスクに残っています。";
            if (convertResult < 0)
            {
                note = (note + "変換の報告はエラーでしたが（" + Log.Hex(convertResult) + "）、状態はゴーストです。").Trim();
            }
            return Outcome("ghosted", note);
        }

        // 中身がディスクに残ったまま（中身を外せなかった）。中身はそのままなので、通常のファイルに戻して元の状態にする
        string why = convertResult < 0 ? HResultText.Describe(convertResult) : "理由は分かりません";
        int revertResult = PInvoke.CfRevertPlaceholder(handle, CF_REVERT_FLAGS.CF_REVERT_FLAG_NONE, null).Value;
        if (revertResult < 0)
        {
            return Outcome(
                "error",
                "プレースホルダーに変換しましたが中身を外せず（" + why + "）、通常のファイルに戻すこともできませんでした（"
                + HResultText.Describe(revertResult) + "）。中身はディスク上に残っています。");
        }
        return Outcome(ClassifyConvertFailure(convertResult), "中身を外せなかったため、通常のファイルに戻しました（" + why + "）。");
    }

    private static JsonObject AlreadyPlaceholder(PlaceholderInfo existing, string itemId, long size)
    {
        if (ItemId.Same(existing.ItemId, itemId))
        {
            if (existing.InSync && (size == 0 || existing.OnDiskDataSize == 0))
            {
                return Outcome("ghosted", "すでにこの項目のゴーストになっています。");
            }
            return Outcome("error", "すでにこの項目のプレースホルダーですが、中身がディスクに残っています。");
        }
        return Outcome("error", "すでに別のプレースホルダー（ほかの項目、または pip0 以外）です。");
    }

    /// <summary>原本を保護されたハンドルから読んで SHA-256 を計算する。1 MiB ごとに参照を取り直す</summary>
    private static unsafe HashOutcome HashThroughHandle(ProtectedFile file, long size, CancellationToken shutdown)
    {
        byte* buffer = (byte*)NativeMemory.AlignedAlloc(HashChunkBytes, BufferAlignment);
        try
        {
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            long offset = 0;
            while (offset < size)
            {
                if (shutdown.IsCancellationRequested)
                {
                    return HashOutcome.Failed("error", "シェルが終了するため、中止しました。");
                }
                if (!file.TryReference(out HANDLE handle))
                {
                    return HashOutcome.Failed("locked", BrokenByOtherApp);
                }
                int read;
                int readResult;
                try
                {
                    read = OverlappedFileReader.Read(handle, buffer, HashChunkBytes, offset, out readResult);
                }
                finally
                {
                    file.Release();
                }
                if (read < 0)
                {
                    return HashOutcome.Failed("error", "原本を読めません：" + HResultText.Describe(readResult));
                }
                if (read == 0)
                {
                    return HashOutcome.Failed("changed", "読み取りの途中で、ファイルが短くなりました。");
                }
                int useful = (int)Math.Min(read, size - offset);
                hash.AppendData(new ReadOnlySpan<byte>(buffer, useful));
                offset += useful;
            }
            return HashOutcome.Done(Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant());
        }
        finally
        {
            NativeMemory.AlignedFree(buffer);
        }
    }

    // ------------------------------------------------------------------
    // cf.restore
    // ------------------------------------------------------------------

    /// <summary>
    /// {"result": "restored"/"already_regular"/"not_our_placeholder"/"missing"/"error", "reason"} を返す。
    ///
    /// 1. 属性だけを読む開き方で、この項目のゴーストかを確かめる。中身がディスクにない部分があれば、
    ///    CfHydratePlaceholder で戻す（Windows がこのシェルの FETCH_DATA を呼び、シェルが保管庫のハッシュを確かめてから渡す）。
    ///    ここで排他的なハンドルを持たないのは、中身を戻す Windows の処理と、こちらのハンドルがぶつからないようにするため。
    /// 2. 排他的に開き直し、この項目のゴーストで、中身がすべてディスクにあることをもう一度確かめてから、
    ///    CfRevertPlaceholder で通常のファイルに戻す。
    /// </summary>
    public JsonObject Restore(string path, string itemId)
    {
        EntryLookup found = DirectoryEntry.Find(path, out EntryInfo entry, out int findResult);
        if (found == EntryLookup.NotFound)
        {
            return Outcome("missing", "元の場所にファイルがありません。");
        }
        if (found == EntryLookup.Unknown)
        {
            // 「確かめられない」を「ない」（missing）として返すと、本体がゴーストを見失ったと記録してしまう
            return Outcome("error", "ファイルがあるかを確かめられません：" + HResultText.Describe(findResult));
        }
        if (entry.IsDirectory)
        {
            return Outcome("error", "フォルダーです。");
        }
        if (entry.IsLink)
        {
            return Outcome("error", "リンク（シンボリックリンク等）です。");
        }
        if (entry.IsReadOnly)
        {
            // CfRevertPlaceholder には、書き込み（WRITE_DATA）か WRITE_DAC の権利のあるハンドルが要る。
            // 読み取り専用のファイルは書き込みの権利で開けず、CfOpenFileWithOplock では WRITE_DAC を求められない。
            // 属性を勝手に変えることはしないので、ユーザーに外してもらう
            return Outcome("error", "読み取り専用のゴーストのため、通常のファイルに戻せません。エクスプローラーでファイルのプロパティを開き、"
                + "「読み取り専用」を外してから、もう一度試してください（中身は保管庫に残っています）。");
        }

        // 1. 確かめて、必要なら中身を戻す
        JsonObject? decided = HydrateIfNeeded(path, itemId);
        if (decided is not null)
        {
            return decided;
        }

        // 2. 排他的に開き直して、通常のファイルに戻す
        int openResult = ProtectedFile.Open(
            path,
            CF_OPEN_FILE_FLAGS.CF_OPEN_FILE_FLAG_EXCLUSIVE | CF_OPEN_FILE_FLAGS.CF_OPEN_FILE_FLAG_WRITE_ACCESS,
            out ProtectedFile? file);
        if (openResult < 0 || file is null)
        {
            if (IsNotFound(openResult))
            {
                return Outcome("missing", "元の場所にファイルがありません。");
            }
            if (IsInUse(openResult))
            {
                return Outcome("error", "ほかのアプリが使用中のため、今は戻せません（後でもう一度試せます）：" + HResultText.Describe(openResult));
            }
            return Outcome("error", "ファイルを開けません：" + HResultText.Describe(openResult));
        }

        using (file)
        {
            if (!file.TryReference(out HANDLE handle))
            {
                return Outcome("error", BrokenByOtherApp);
            }
            try
            {
                return RevertWithHandle(handle, itemId);
            }
            finally
            {
                file.Release();
            }
        }
    }

    /// <summary>手順1。続けてよいときは null、ここで答えが決まったときはその答えを返す</summary>
    private unsafe JsonObject? HydrateIfNeeded(string path, string itemId)
    {
        using SafeFileHandle file = OpenForAttributes(path);
        if (file.IsInvalid)
        {
            int openResult = HResultText.FromWin32(Marshal.GetLastPInvokeError());
            return IsNotFound(openResult)
                ? Outcome("missing", "元の場所にファイルがありません。")
                : Outcome("error", "ファイルを開けません：" + HResultText.Describe(openResult));
        }

        HANDLE handle = (HANDLE)file.DangerousGetHandle();
        int infoResult = PlaceholderInfo.TryRead(handle, out PlaceholderInfo info);
        if (infoResult < 0)
        {
            return Outcome("error", "プレースホルダーの状態を読めません：" + HResultText.Describe(infoResult));
        }
        if (!info.IsPlaceholder)
        {
            return Outcome("already_regular", "ゴーストではなく、通常のファイルです。");
        }
        if (!ItemId.Same(info.ItemId, itemId))
        {
            return Outcome("not_our_placeholder", "別の項目（または pip0 以外）のプレースホルダーです。");
        }
        FileSnapshot? snapshot = FileSnapshot.TryRead(handle, out int snapshotResult);
        if (snapshot is null)
        {
            return Outcome("error", "大きさを読めません：" + HResultText.Describe(snapshotResult));
        }
        if (snapshot.Size == 0 || (info.OnDiskDataSize >= snapshot.Size && !snapshot.DataNotFullyLocal))
        {
            return null; // 中身はすべてディスクにある
        }

        if (!provider.IsConnected)
        {
            return Outcome("error", "同期ルートに接続していないため、保管庫から中身を戻せません。");
        }
        int hydrateResult = PInvoke.CfHydratePlaceholder(
            handle, 0, snapshot.Size, CF_HYDRATE_FLAGS.CF_HYDRATE_FLAG_NONE, null).Value;
        if (hydrateResult < 0)
        {
            return Outcome("error", "保管庫から中身を戻せませんでした：" + HResultText.Describe(hydrateResult));
        }
        return null;
    }

    /// <summary>手順2：排他的なハンドルで確かめ直してから、通常のファイルに戻す</summary>
    private static unsafe JsonObject RevertWithHandle(HANDLE handle, string itemId)
    {
        int infoResult = PlaceholderInfo.TryRead(handle, out PlaceholderInfo info);
        if (infoResult < 0)
        {
            return Outcome("error", "プレースホルダーの状態を読めません：" + HResultText.Describe(infoResult));
        }
        if (!info.IsPlaceholder)
        {
            // 手順1と2の間に、ほかの処理が通常のファイルに戻した
            return Outcome("already_regular", "ゴーストではなく、通常のファイルです。");
        }
        if (!ItemId.Same(info.ItemId, itemId))
        {
            return Outcome("not_our_placeholder", "別の項目（または pip0 以外）のプレースホルダーです。");
        }
        FileSnapshot? snapshot = FileSnapshot.TryRead(handle, out int snapshotResult);
        if (snapshot is null)
        {
            return Outcome("error", "大きさを読めません：" + HResultText.Describe(snapshotResult));
        }
        if (snapshot.Size > 0 && (info.OnDiskDataSize < snapshot.Size || snapshot.DataNotFullyLocal))
        {
            return Outcome("error", "中身がすべて戻ったことを確かめられないため、通常のファイルには戻しませんでした。");
        }

        int revertResult = PInvoke.CfRevertPlaceholder(handle, CF_REVERT_FLAGS.CF_REVERT_FLAG_NONE, null).Value;
        if (revertResult < 0)
        {
            return Outcome("error", "通常のファイルに戻せませんでした：" + HResultText.Describe(revertResult));
        }
        int afterResult = PlaceholderInfo.TryRead(handle, out PlaceholderInfo after);
        if (afterResult < 0 || after.IsPlaceholder)
        {
            return Outcome("error", "通常のファイルに戻ったことを確かめられませんでした。");
        }
        return Outcome("restored", "");
    }

    // ------------------------------------------------------------------
    // cf.locate
    // ------------------------------------------------------------------

    /// <summary>cf.locate でたどる項目数の上限</summary>
    private const int LocateMaxEntries = 200_000;

    /// <summary>cf.locate にかける時間の上限</summary>
    private static readonly TimeSpan LocateTimeLimit = TimeSpan.FromSeconds(20);

    /// <summary>
    /// {"result": "found"/"not_found"/"error", "paths", "reason"} を返す（<see cref="LocateAnswer"/>）。
    /// pip0 専用フォルダー（同期ルート）の中から、この項目のゴースト（FileIdentity が項目ID のプレースホルダー）を探す。
    /// フォルダーの名前の変更や、シェルが止まっている間の移動で、ゴーストの場所が記録と違ってしまったときに、本体が使う。
    /// リンクとジャンクションはたどらず、プレースホルダーは属性だけを読む開き方で開く（中身を取りに行かせない）。
    /// </summary>
    public JsonObject Locate(string itemId, CancellationToken shutdown)
    {
        string? root = provider.RootPath ?? state.Configuration?.Pip0Root;
        if (root is null)
        {
            return LocateAnswer.Build(Array.Empty<string>(), false, "pip0 専用フォルダーの場所が分かりません");
        }

        Stopwatch clock = Stopwatch.StartNew();
        List<string> candidates = DirectoryEntry.ListPlaceholderFiles(
            root, LocateMaxEntries, LocateTimeLimit, shutdown, out bool complete);
        string problem = complete ? "" : "項目が多すぎる、時間がかかりすぎる、または読めないフォルダーがあります";

        var matches = new List<string>();
        foreach (string candidate in candidates)
        {
            if (shutdown.IsCancellationRequested || clock.Elapsed > LocateTimeLimit)
            {
                complete = false;
                problem = "時間がかかりすぎました";
                break;
            }
            using SafeFileHandle file = OpenForAttributes(candidate);
            if (file.IsInvalid)
            {
                complete = false;
                problem = "開けないプレースホルダーがあります";
                continue;
            }
            if (PlaceholderInfo.TryRead((HANDLE)file.DangerousGetHandle(), out PlaceholderInfo info) < 0)
            {
                complete = false;
                problem = "状態を読めないプレースホルダーがあります";
                continue;
            }
            if (info.IsPlaceholder && ItemId.Same(info.ItemId, itemId))
            {
                matches.Add(candidate);
            }
        }
        return LocateAnswer.Build(matches, complete, problem);
    }

    // ------------------------------------------------------------------
    // 小さな道具
    // ------------------------------------------------------------------

    /// <summary>属性を読むだけの開き方（中身を読まないので、ゴーストの中身を取りに行かせない。ほかのアプリの邪魔もしない）</summary>
    private static SafeFileHandle OpenForAttributes(string path)
    {
        return PInvoke.CreateFile(
            PathText.ForWin32(path),
            (uint)FILE_ACCESS_RIGHTS.FILE_READ_ATTRIBUTES,
            FILE_SHARE_MODE.FILE_SHARE_READ | FILE_SHARE_MODE.FILE_SHARE_WRITE | FILE_SHARE_MODE.FILE_SHARE_DELETE,
            null,
            FILE_CREATION_DISPOSITION.OPEN_EXISTING,
            default,
            null);
    }

    private static string? Compare(FileSnapshot snapshot, GhostExpectation expected)
    {
        if (snapshot.Size != expected.Size)
        {
            return "大きさが、保管庫へコピーしたときから変わりました。";
        }
        if (snapshot.MtimeNs != expected.MtimeNs)
        {
            return "最終更新日時が、保管庫へコピーしたときから変わりました。";
        }
        if (!snapshot.HasFileKey(expected.FileKey))
        {
            return "ファイル番号が一致しません（別のファイルに置き換えられた可能性があります）。";
        }
        return null;
    }

    /// <summary>
    /// この後の読み取りで、最終アクセス日時を変えないようにする。止められたら真（失敗しても続ける）。
    /// SetFileTime に 0xFFFFFFFF を渡すと、そのハンドルでの操作が最終アクセス日時を変えなくなるが、
    /// それには FILE_WRITE_ATTRIBUTES の権利が要る。別のハンドルで止めても、このハンドルの読み取りには効かず、
    /// ゴーストにした後に日時を書き戻すと、プレースホルダーの同期済みの印に影響しうるため、ここでは試すだけにする。
    /// </summary>
    private static unsafe bool DisableLastAccessUpdate(HANDLE handle)
    {
        var keep = new ComTypes.FILETIME { dwLowDateTime = -1, dwHighDateTime = -1 };
        return PInvoke.SetFileTime(handle, null, &keep, null);
    }

    private static bool IsNotFound(int hresult)
    {
        return HResultText.Is(hresult, WIN32_ERROR.ERROR_FILE_NOT_FOUND)
            || HResultText.Is(hresult, WIN32_ERROR.ERROR_PATH_NOT_FOUND);
    }

    private static bool IsInUse(int hresult)
    {
        return HResultText.Is(hresult, WIN32_ERROR.ERROR_SHARING_VIOLATION)
            || HResultText.Is(hresult, WIN32_ERROR.ERROR_LOCK_VIOLATION)
            || HResultText.Is(hresult, WIN32_ERROR.ERROR_OPLOCK_NOT_GRANTED)
            || HResultText.Is(hresult, WIN32_ERROR.ERROR_CLOUD_FILE_IN_USE)
            || HResultText.Is(hresult, WIN32_ERROR.ERROR_USER_MAPPED_FILE);
    }

    private static string ClassifyOpenFailure(int hresult)
    {
        if (IsInUse(hresult))
        {
            return "locked";
        }
        if (IsNotFound(hresult))
        {
            return "changed";
        }
        return "error";
    }

    private static string ClassifyConvertFailure(int hresult)
    {
        return hresult < 0 && IsInUse(hresult) ? "locked" : "error";
    }

    private static JsonObject Outcome(string result, string reason)
    {
        return new JsonObject
        {
            ["result"] = result,
            ["reason"] = reason,
        };
    }

    private static JsonObject StatusResult(
        bool? exists, bool? isGhost, string? itemId, bool? dehydrated, bool? inSync, bool? pinned, string reason)
    {
        return new JsonObject
        {
            ["exists"] = exists,
            ["is_ghost"] = isGhost,
            ["item_id"] = itemId,
            ["dehydrated"] = dehydrated,
            ["in_sync"] = inSync,
            ["pinned"] = pinned,
            ["reason"] = reason,
        };
    }

    private readonly record struct HashOutcome(string Sha256, string? FailureResult, string Reason)
    {
        public static HashOutcome Done(string sha256) => new(sha256, null, "");

        public static HashOutcome Failed(string result, string reason) => new("", result, reason);
    }
}
