using System;
using System.Buffers;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading;
using Pip0Shell.Ipc;

namespace Pip0Shell.CloudFiles;

/// <summary>保管庫を確かめた結果の種類</summary>
internal enum VaultProblem
{
    None,

    /// <summary>manifest.json か content がない</summary>
    Missing,

    /// <summary>項目ID・大きさ・ハッシュが一致しない</summary>
    Mismatch,

    /// <summary>読めない（権限がない、使用中、形が壊れている）</summary>
    Unreadable,
}

/// <summary>
/// 保管庫の項目（VAULT_DIR\items\&lt;項目ID&gt;\）の、manifest.json と content。
///
/// <see cref="OpenVerified"/> は、content を「ほかのプロセスが書き換えられない」形で開き、
/// manifest.json の大きさと SHA-256 に一致することを、全体を読んで確かめてから返します。
/// 中身を渡すときは、確かめたのと同じハンドルから読むので、確かめた後に書き換えられた内容を渡すことはありません。
/// </summary>
internal sealed class VaultContent : IDisposable
{
    private const int HashChunkBytes = 1024 * 1024;

    private VaultContent(FileStream stream, long size)
    {
        Stream = stream;
        Size = size;
    }

    public FileStream Stream { get; }

    public long Size { get; }

    /// <summary>
    /// 確かめてから開く。一致しない・読めないときは null を返し、kind と problem（日本語の理由）を入れる。
    /// expectedSha256 を渡すと、manifest.json のハッシュがそれと同じことも確かめる（cf.make_ghost で使う）。
    /// token で取り消されたら OperationCanceledException を投げる。
    /// </summary>
    public static VaultContent? OpenVerified(
        string vaultDir,
        string itemId,
        long expectedSize,
        string? expectedSha256,
        Action<long>? hashedBytes,
        CancellationToken token,
        out VaultProblem kind,
        out string problem)
    {
        if (!CloudFiles.ItemId.IsValid(itemId))
        {
            kind = VaultProblem.Mismatch;
            problem = "項目ID の形が正しくありません。";
            return null;
        }

        string itemDir = Path.Combine(vaultDir, "items", itemId);
        VaultManifest? manifest = VaultManifest.TryRead(Path.Combine(itemDir, "manifest.json"), out kind, out problem);
        if (manifest is null)
        {
            return null;
        }
        if (!CloudFiles.ItemId.Same(manifest.ItemId, itemId))
        {
            kind = VaultProblem.Mismatch;
            problem = "保管庫の manifest.json の項目ID が一致しません。";
            return null;
        }
        if (manifest.Size != expectedSize)
        {
            kind = VaultProblem.Mismatch;
            problem = "ファイルの大きさが、保管庫の manifest.json の記録と一致しません。";
            return null;
        }
        if (expectedSha256 is not null && !HexEquals(manifest.Sha256, expectedSha256))
        {
            kind = VaultProblem.Mismatch;
            problem = "保管庫の manifest.json のハッシュが、指定されたハッシュと一致しません。";
            return null;
        }

        FileStream stream;
        try
        {
            // FileShare.Read：確かめてから渡し終わるまで、ほかのプロセスに書き換えさせない
            stream = new FileStream(
                Path.Combine(itemDir, "content"),
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                bufferSize: 1,
                FileOptions.SequentialScan);
        }
        catch (Exception error) when (error is FileNotFoundException or DirectoryNotFoundException)
        {
            kind = VaultProblem.Missing;
            problem = "保管庫に内容（content）がありません。";
            return null;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            kind = VaultProblem.Unreadable;
            problem = "保管庫の内容を開けません（" + HResultText.Describe(error.HResult) + "）。";
            return null;
        }

        bool keep = false;
        try
        {
            if (stream.Length != manifest.Size)
            {
                kind = VaultProblem.Mismatch;
                problem = "保管庫の内容の大きさが、manifest.json の記録と一致しません。";
                return null;
            }

            string actual = HashWholeFile(stream, hashedBytes, token);
            if (!HexEquals(actual, manifest.Sha256))
            {
                kind = VaultProblem.Mismatch;
                problem = "保管庫の内容のハッシュが、manifest.json の記録と一致しません。";
                return null;
            }

            keep = true;
            kind = VaultProblem.None;
            problem = "";
            return new VaultContent(stream, manifest.Size);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            kind = VaultProblem.Unreadable;
            problem = "保管庫の内容を読めません（" + HResultText.Describe(error.HResult) + "）。";
            return null;
        }
        finally
        {
            if (!keep)
            {
                stream.Dispose();
            }
        }
    }

    /// <summary>offset から buffer がいっぱいになるまで（またはファイルの終わりまで）読む。読めたバイト数を返す</summary>
    public int ReadAt(long offset, Span<byte> buffer)
    {
        int total = 0;
        while (total < buffer.Length)
        {
            int count = RandomAccess.Read(Stream.SafeFileHandle, buffer.Slice(total), offset + total);
            if (count <= 0)
            {
                break;
            }
            total += count;
        }
        return total;
    }

    public void Dispose()
    {
        Stream.Dispose();
    }

    public static bool HexEquals(string a, string b)
    {
        return a.Length == 64 && b.Length == 64 && string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
    }

    private static string HashWholeFile(FileStream stream, Action<long>? hashedBytes, CancellationToken token)
    {
        byte[] buffer = ArrayPool<byte>.Shared.Rent(HashChunkBytes);
        try
        {
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            long done = 0;
            long lastReported = 0;
            stream.Position = 0;
            while (true)
            {
                token.ThrowIfCancellationRequested();
                int count = stream.Read(buffer, 0, HashChunkBytes);
                if (count <= 0)
                {
                    break;
                }
                hash.AppendData(buffer, 0, count);
                done += count;
                if (hashedBytes is not null && done - lastReported >= 32L * 1024 * 1024)
                {
                    hashedBytes(done);
                    lastReported = done;
                }
            }
            return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }
}

/// <summary>保管庫の manifest.json のうち、シェルが使う項目（item_id、size、sha256）</summary>
internal sealed class VaultManifest
{
    private const int MaxManifestBytes = 1024 * 1024;

    private VaultManifest(string itemId, long size, string sha256)
    {
        ItemId = itemId;
        Size = size;
        Sha256 = sha256;
    }

    public string ItemId { get; }

    public long Size { get; }

    public string Sha256 { get; }

    public static VaultManifest? TryRead(string path, out VaultProblem kind, out string problem)
    {
        byte[] bytes;
        try
        {
            // 本体が os.replace で書き換えても邪魔をしないよう、書き込み・削除を許して短く読む
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            if (stream.Length > MaxManifestBytes)
            {
                kind = VaultProblem.Unreadable;
                problem = "保管庫の manifest.json が大きすぎます。";
                return null;
            }
            bytes = new byte[stream.Length];
            stream.ReadExactly(bytes);
        }
        catch (Exception error) when (error is FileNotFoundException or DirectoryNotFoundException)
        {
            kind = VaultProblem.Missing;
            problem = "保管庫に項目の記録（manifest.json）がありません。";
            return null;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            kind = VaultProblem.Unreadable;
            problem = "保管庫の manifest.json を読めません（" + HResultText.Describe(error.HResult) + "）。";
            return null;
        }

        try
        {
            using JsonDocument document = JsonDocument.Parse(bytes);
            Payload manifest = Payload.From(document.RootElement);
            string? itemId = manifest.GetString("item_id");
            long? size = manifest.GetInt64("size");
            string? sha256 = manifest.GetString("sha256");
            if (itemId is null || size is null || size.Value < 0 || sha256 is null || sha256.Length != 64)
            {
                kind = VaultProblem.Unreadable;
                problem = "保管庫の manifest.json に、item_id・size・sha256 がそろっていません。";
                return null;
            }
            kind = VaultProblem.None;
            problem = "";
            return new VaultManifest(itemId, size.Value, sha256);
        }
        catch (JsonException)
        {
            kind = VaultProblem.Unreadable;
            problem = "保管庫の manifest.json を JSON として読めません。";
            return null;
        }
    }
}
