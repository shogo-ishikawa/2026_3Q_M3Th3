using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using Pip0Shell.CloudFiles;

namespace Pip0Shell.Checks;

/// <summary>
/// VaultContent.OpenVerified：ゴーストの中身を渡す前の確認（manifest.json の大きさと SHA-256）。
/// 一致しない・ない・読めないときに、渡さない判定になることを確かめる。一時フォルダーだけを使います。
/// </summary>
internal static class VaultChecks
{
    private const string Id = "0123456789abcdef0123456789abcdef";

    public static void Run()
    {
        string vault = Path.Combine(Path.GetTempPath(), "pip0-shell-checks-" + Guid.NewGuid().ToString("N"));
        try
        {
            byte[] data = RandomBytes(3 * 1024 * 1024 + 123);
            string sha = Sha256(data);
            string itemDir = Path.Combine(vault, "items", Id);

            Prepare(itemDir, data, ManifestJson(Id, data.Length, sha));
            using (VaultContent? content = Open(vault, Id, data.Length, null, out VaultProblem kind, out string problem))
            {
                Program.Check(content is not null && kind == VaultProblem.None && problem.Length == 0, "一致すれば開ける");
                if (content is not null)
                {
                    byte[] part = new byte[100];
                    int read = content.ReadAt(4096, part);
                    Program.Check(read == 100 && part.AsSpan().SequenceEqual(data.AsSpan(4096, 100)), "指定の位置から読める");
                    byte[] tail = new byte[1000];
                    int tailRead = content.ReadAt(data.Length - 10, tail);
                    Program.Check(tailRead == 10, "ファイルの終わりでは、あるだけ読む");
                }
            }

            ExpectProblem(Open(vault, Id, data.Length, sha.ToUpperInvariant(), out var k1, out _), k1, VaultProblem.None, "期待するハッシュが一致すれば開ける（大文字でも同じ）");
            ExpectProblem(Open(vault, Id, data.Length, new string('0', 64), out var k2, out _), k2, VaultProblem.Mismatch, "期待するハッシュが違えば開かない");
            ExpectProblem(Open(vault, Id, data.Length + 1, null, out var k3, out _), k3, VaultProblem.Mismatch, "ゴーストの大きさと manifest が違えば開かない");
            ExpectProblem(Open(vault, "../../etc/passwd0123456789abcdef", data.Length, null, out var k4, out _), k4, VaultProblem.Mismatch, "項目ID でない文字列では、ファイルを開かない");

            byte[] changed = (byte[])data.Clone();
            changed[12345] ^= 0xFF;
            Prepare(itemDir, changed, ManifestJson(Id, data.Length, sha));
            ExpectProblem(Open(vault, Id, data.Length, null, out var k5, out string p5), k5, VaultProblem.Mismatch, "中身が1バイト違えば開かない");
            Program.Check(p5.Contains("ハッシュ", StringComparison.Ordinal), "理由にハッシュの不一致と書く");

            Prepare(itemDir, data[..^1], ManifestJson(Id, data.Length, sha));
            ExpectProblem(Open(vault, Id, data.Length, null, out var k6, out _), k6, VaultProblem.Mismatch, "content の大きさが manifest と違えば開かない");

            Prepare(itemDir, data, ManifestJson("ffffffffffffffffffffffffffffffff", data.Length, sha));
            ExpectProblem(Open(vault, Id, data.Length, null, out var k7, out _), k7, VaultProblem.Mismatch, "manifest の item_id が違えば開かない");

            Prepare(itemDir, data, "{ not json");
            ExpectProblem(Open(vault, Id, data.Length, null, out var k8, out _), k8, VaultProblem.Unreadable, "manifest が壊れていれば開かない");

            Prepare(itemDir, data, "{\"item_id\":\"" + Id + "\",\"size\":" + data.Length + "}");
            ExpectProblem(Open(vault, Id, data.Length, null, out var k9, out _), k9, VaultProblem.Unreadable, "manifest に sha256 がなければ開かない");

            Prepare(itemDir, data, ManifestJson(Id, data.Length, sha));
            File.Delete(Path.Combine(itemDir, "content"));
            ExpectProblem(Open(vault, Id, data.Length, null, out var k10, out _), k10, VaultProblem.Missing, "content がなければ開かない");

            File.Delete(Path.Combine(itemDir, "manifest.json"));
            ExpectProblem(Open(vault, Id, data.Length, null, out var k11, out _), k11, VaultProblem.Missing, "manifest.json がなければ開かない");

            // 取り消し
            Prepare(itemDir, data, ManifestJson(Id, data.Length, sha));
            using var cancelled = new CancellationTokenSource();
            cancelled.Cancel();
            bool threw = false;
            try
            {
                VaultContent.OpenVerified(vault, Id, data.Length, null, null, cancelled.Token, out _, out _)?.Dispose();
            }
            catch (OperationCanceledException)
            {
                threw = true;
            }
            Program.Check(threw, "取り消されたら途中で止める");

            // 大きいファイルでは、ハッシュの計算の進み具合を知らせる
            byte[] big = RandomBytes(40 * 1024 * 1024 + 5);
            Prepare(itemDir, big, ManifestJson(Id, big.Length, Sha256(big)));
            long lastReported = 0;
            using (VaultContent? content = VaultContent.OpenVerified(vault, Id, big.Length, null, done => lastReported = done, CancellationToken.None, out var k12, out _))
            {
                Program.Check(content is not null && k12 == VaultProblem.None, "40 MiB のファイルも確かめて開ける");
            }
            Program.Check(lastReported >= 32L * 1024 * 1024, "進み具合を知らせる");
        }
        finally
        {
            try
            {
                Directory.Delete(vault, recursive: true);
            }
            catch (IOException)
            {
                // 後片付けの失敗は確認の結果に関係しない
            }
        }
    }

    private static VaultContent? Open(string vault, string id, long size, string? expectedSha, out VaultProblem kind, out string problem)
    {
        return VaultContent.OpenVerified(vault, id, size, expectedSha, null, CancellationToken.None, out kind, out problem);
    }

    private static void ExpectProblem(VaultContent? content, VaultProblem actual, VaultProblem expected, string what)
    {
        bool ok = expected == VaultProblem.None ? content is not null : content is null && actual == expected;
        content?.Dispose();
        Program.Check(ok, what + "（結果 " + actual + "）");
    }

    private static void Prepare(string itemDir, byte[] content, string manifest)
    {
        Directory.CreateDirectory(itemDir);
        File.WriteAllBytes(Path.Combine(itemDir, "content"), content);
        File.WriteAllText(Path.Combine(itemDir, "manifest.json"), manifest, new UTF8Encoding(false));
    }

    private static string ManifestJson(string id, long size, string sha)
    {
        // 本体（vault.py）が書く形に近いもの。シェルが使うのは item_id、size、sha256 だけ
        return "{\n  \"format\": 1,\n  \"item_id\": \"" + id + "\",\n  \"state\": \"evacuated\",\n"
            + "  \"original_path\": \"C:\\\\Users\\\\u\\\\pip0\\\\a.pdf\",\n  \"size\": " + size + ",\n"
            + "  \"mtime_ns\": 1793245920123456789,\n  \"sha256\": \"" + sha + "\",\n  \"history\": []\n}";
    }

    private static byte[] RandomBytes(int length)
    {
        byte[] bytes = new byte[length];
        new Random(20261029).NextBytes(bytes);
        return bytes;
    }

    private static string Sha256(byte[] data) => Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();
}
