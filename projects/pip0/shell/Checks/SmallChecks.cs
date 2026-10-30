using System;
using System.Linq;
using System.Text;
using System.Text.Json;
using Pip0Shell.CloudFiles;
using Pip0Shell.Core;
using Pip0Shell.Ipc;
using Pip0Shell.Trash;
using Windows.Win32.Foundation;

namespace Pip0Shell.Checks;

/// <summary>範囲の計算、渡し終えた範囲の記録、項目ID、HRESULT の説明、パスの文字列、設定の読み取り</summary>
internal static class SmallChecks
{
    public static void Run()
    {
        TransferRangeChecks();
        HydrationTrackerChecks();
        ItemIdChecks();
        HResultTextChecks();
        PathTextChecks();
        SettingsChecks();
        FormatSizeChecks();
    }

    private static void TransferRangeChecks()
    {
        Program.Check(TransferRange.Align(0, 10_000, 10_000) == (0, 10_000), "ファイル全体（終わりはファイルの大きさ）");
        Program.Check(TransferRange.Align(5000, 100, 1_000_000) == (4096, 8192), "途中の範囲は 4 KiB 単位に広げる");
        Program.Check(TransferRange.Align(0, -1, 5000) == (0, 5000), "長さが負なら終わりまで");
        Program.Check(TransferRange.Align(4096, 999_999, 5000) == (4096, 5000), "終わりを超える長さは、ファイルの終わりまで");
        Program.Check(TransferRange.Align(8192, 4096, 8192) == (0, 0), "ファイルの外の範囲は空");
        Program.Check(TransferRange.Align(-1, 10, 100) == (0, 0), "負の位置は空");
        Program.Check(TransferRange.Align(0, 1, 0) == (0, 0), "大きさ 0 のファイルは空");

        long size = 3L * 1024 * 1024 + 123;
        var chunks = TransferRange.Chunks(0, size, 1024 * 1024).ToList();
        Program.Check(chunks.Count == 4 && chunks.Sum(c => (long)c.Length) == size, "1 MiB ずつに分ける");
        Program.Check(chunks.Take(3).All(c => c.Length % 4096 == 0) && chunks[^1].Length == 123, "半端な長さは最後の1回だけ");

        bool rejected = false;
        try
        {
            _ = TransferRange.Chunks(0, 10, 1000).ToList();
        }
        catch (ArgumentOutOfRangeException)
        {
            rejected = true;
        }
        Program.Check(rejected, "4 KiB の倍数でない区切りは使わせない");

        // ばらばらの値で、Windows の約束（位置と長さは 4 KiB 単位、ただし終わりはファイルの終わりでもよい）を確かめる
        var random = new Random(42);
        bool allOk = true;
        for (int i = 0; i < 5000; i++)
        {
            long fileSize = random.NextInt64(1, 50L * 1024 * 1024);
            long offset = random.NextInt64(0, fileSize);
            long length = random.Next(0, 4) == 0 ? -1 : random.NextInt64(1, fileSize - offset + 10_000);
            (long start, long end) = TransferRange.Align(offset, length, fileSize);
            long wantedEnd = length < 0 ? fileSize : Math.Min(fileSize, offset + length);
            bool ok = start % 4096 == 0 && start <= offset && end >= wantedEnd && end <= fileSize
                && (end % 4096 == 0 || end == fileSize);
            foreach ((long chunkOffset, int chunkLength) in TransferRange.Chunks(start, end, 1024 * 1024))
            {
                bool lastChunk = chunkOffset + chunkLength == end;
                ok &= chunkOffset % 4096 == 0 && (chunkLength % 4096 == 0 || (lastChunk && end == fileSize));
            }
            allOk &= ok;
        }
        Program.Check(allOk, "5000 通りのばらばらな範囲で、位置と長さの約束を守る");
    }

    private static void HydrationTrackerChecks()
    {
        var tracker = new HydrationTracker();
        string id = "0123456789abcdef0123456789abcdef";
        Program.Check(!tracker.MarkServed(id, 10_000, 0, 4096), "一部だけでは、まだ全体ではない");
        Program.Check(!tracker.MarkServed(id, 10_000, 8192, 10_000), "離れた範囲を足しても、まだ全体ではない");
        Program.Check(tracker.MarkServed(id.ToUpperInvariant(), 10_000, 4096, 8192), "すき間が埋まると全体（項目ID の大文字小文字は区別しない）");
        Program.Check(tracker.MarkServed(id, 10_000, 0, 10_000), "全体を一度に渡せば、すぐに全体");
        Program.Check(!tracker.MarkServed("ffffffffffffffffffffffffffffffff", 10_000, 0, 9_999), "別の項目は別に数える");
    }

    private static void ItemIdChecks()
    {
        string id = "0123456789abcdef0123456789abcdef";
        Program.Check(ItemId.IsValid(id) && ItemId.IsValid(id.ToUpperInvariant()), "32桁の16進数は項目ID");
        Program.Check(!ItemId.IsValid(id[..31]) && !ItemId.IsValid(id + "0") && !ItemId.IsValid(null), "長さが違えば項目ID ではない");
        Program.Check(!ItemId.IsValid("0123456789abcdef0123456789abcdeg"), "16進数でない文字があれば項目ID ではない");
        Program.Check(ItemId.FromIdentity(Encoding.ASCII.GetBytes(id)) == id, "FileIdentity から読める");
        Program.Check(ItemId.FromIdentity(Encoding.ASCII.GetBytes(id + "0")) is null, "33バイトの FileIdentity は項目ID ではない");
        Program.Check(ItemId.FromIdentity(Encoding.UTF8.GetBytes("あいうえおかきくけこ01")) is null, "ASCII でない FileIdentity は項目ID ではない");
        Program.Check(ItemId.ToIdentity(id).Length == 32, "FileIdentity は 32 バイト");
        Program.Check(ItemId.Same(id, id.ToUpperInvariant()) && !ItemId.Same(id, null), "比べるときは大文字小文字を区別しない");
    }

    private static void HResultTextChecks()
    {
        int sharing = HResultText.FromWin32(WIN32_ERROR.ERROR_SHARING_VIOLATION);
        Program.Check(sharing == unchecked((int)0x80070020), "HRESULT_FROM_WIN32 と同じ値");
        string text = HResultText.Describe(sharing);
        Program.Check(text.Contains("使用中", StringComparison.Ordinal) && text.Contains("0x80070020", StringComparison.Ordinal), "日本語の理由と番号を付ける");
        Program.Check(HResultText.Describe(HResultText.FromWin32(WIN32_ERROR.ERROR_CLOUD_FILE_PROVIDER_NOT_RUNNING)).Contains("接続されていません", StringComparison.Ordinal), "Cloud Files のエラーを説明する");
        Program.Check(HResultText.Describe(unchecked((int)0x80270000)).Contains("取り消", StringComparison.Ordinal), "ごみ箱の操作のエラーを説明する");
        Program.Check(HResultText.Describe(0x12345678).Contains("0x12345678", StringComparison.Ordinal), "知らない番号も番号を付けて返す");
        Program.Check(HResultText.Is(sharing, WIN32_ERROR.ERROR_SHARING_VIOLATION) && !HResultText.Is(sharing, WIN32_ERROR.ERROR_ACCESS_DENIED), "番号の比較");
        Program.Check(HResultText.FromWin32(0) == 0, "0 は成功のまま");
    }

    private static void PathTextChecks()
    {
        const string root = @"C:\Users\u\pip0";
        Program.Check(PathText.IsInside(@"C:\Users\u\pip0\a.pdf", root), "同期ルートの中");
        Program.Check(PathText.IsInside(@"c:\users\U\PIP0\sub\b.txt", root), "大文字小文字は区別しない");
        Program.Check(!PathText.IsInside(root, root) && PathText.IsSameOrInside(root + @"\", root), "同期ルートそのものは「中」ではない");
        Program.Check(!PathText.IsSameOrInside(@"C:\Users\u\pip0x\a.pdf", root), "名前の先頭が同じだけの別のフォルダーは「中」ではない");
        Program.Check(PathText.StripLongPathPrefix(@"\\?\C:\a\b") == @"C:\a\b", "「\\\\?\\」を外す");
        Program.Check(PathText.StripLongPathPrefix(@"\\?\UNC\server\share\a") == @"\\server\share\a", "「\\\\?\\UNC\\」を外す");
        Program.Check(PathText.StripLongPathPrefix(@"\\?\Volume{1}\a") == @"\\?\Volume{1}\a", "ボリュームの GUID の形はそのまま");
        string longPath = @"C:\" + new string('d', 300);
        Program.Check(PathText.ForWin32(longPath) == @"\\?\" + longPath && PathText.ForWin32(@"C:\a") == @"C:\a", "長いパスだけに「\\\\?\\」を付ける");
        Program.Check(PathText.ForWin32(@"\\server\share\" + new string('e', 300)).StartsWith(@"\\?\UNC\server\share\", StringComparison.Ordinal), "長い UNC のパス");
        Program.Check(PathText.TrimEndSeparator(@"C:\") == @"C:\" && PathText.TrimEndSeparator(@"C:\a\") == @"C:\a", "末尾の「\\」の扱い");
        Program.Check(!PathText.TryNormaliseAbsolute(null, out _) && !PathText.TryNormaliseAbsolute("", out _), "空のパスは受け付けない");
        Program.Check(!PathText.TryNormaliseAbsolute("a\0b", out _), "NUL を含むパスは受け付けない");
        Program.Check(!PathText.TryNormaliseAbsolute(@"\\.\PhysicalDrive0", out _), "デバイスの名前は受け付けない");
        Program.Check(!PathText.TryNormaliseAbsolute(@"relative\path.txt", out _), "相対パスは受け付けない");
    }

    private static void SettingsChecks()
    {
        ShellSettings defaults = ShellSettings.FromPayload(Payload.Empty);
        Program.Check(defaults.DeskApproachPx == 48 && defaults.MiniDockMaxRows == 3 && Math.Abs(defaults.DeskTransparentOpacity - 0.15) < 1e-9, "settings がなければ settings.py と同じ初期値");

        Payload given = ParsePayload("{\"desk_approach_px\": 60, \"desk_transparent_opacity\": 5, \"mini_dock_max_rows\": \"4\", \"hazard_border_px\": 20}");
        ShellSettings settings = ShellSettings.FromPayload(given);
        Program.Check(settings.DeskApproachPx == 60 && settings.HazardBorderPx == 20, "正しい値は使う");
        Program.Check(Math.Abs(settings.DeskTransparentOpacity - 0.15) < 1e-9 && settings.MiniDockMaxRows == 3, "範囲の外・型の違う値は初期値にする");

        SessionConfiguration? headlessByArgument = SessionConfiguration.FromPayload(ParsePayload("{\"protocol\": 1}"), true, out _);
        Program.Check(headlessByArgument is { Headless: true, SyncRootDisplayName: "pip0", VaultDir: null }, "--headless なら表示なし。名前の初期値は pip0");
        SessionConfiguration? headlessByInit = SessionConfiguration.FromPayload(ParsePayload("{\"headless\": true, \"sync_root_display_name\": \"  \"}"), false, out _);
        Program.Check(headlessByInit is { Headless: true, SyncRootDisplayName: "pip0" }, "init の headless でも表示なし");
        SessionConfiguration? bad = SessionConfiguration.FromPayload(ParsePayload("{\"vault_dir\": \"relative\\\\vault\"}"), false, out string problem);
        Program.Check(bad is null && problem.Length > 0, "絶対パスでない vault_dir は受け付けない");

        var capabilities = new Capabilities { CloudFiles = true, Trash = false, Ui = true };
        string json = capabilities.ToJson().ToJsonString();
        Program.Check(json == "{\"cloud_files\":true,\"trash\":false,\"ui\":true,\"hooks\":false}", "capabilities の形（" + json + "）");
    }

    private static void FormatSizeChecks()
    {
        Program.Check(TrashItem.FormatSize(0) == "0 バイト" && TrashItem.FormatSize(1023) == "1023 バイト", "1 KB 未満はバイトで表す");
        Program.Check(TrashItem.FormatSize(1536) == "1.5 KB" && TrashItem.FormatSize(5L * 1024 * 1024) == "5.0 MB", "KB・MB で表す");
        var item = new TrashItem(@"C:\a\b.pdf", @"C:\a\b.pdf", "b.pdf", 2048);
        Program.Check(item.DisplayLine == "b.pdf（2.0 KB）", "確認画面の1行");
        Program.Check(new TrashItem(@"C:\a\b.pdf", @"C:\a\b.pdf", "b.pdf", null).DisplayLine == "b.pdf", "大きさが分からなければ名前だけ");
    }

    private static Payload ParsePayload(string json)
    {
        return Payload.From(JsonDocument.Parse(json).RootElement.Clone());
    }
}
