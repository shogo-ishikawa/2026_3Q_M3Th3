using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Pip0Shell.Context;
using Pip0Shell.Core;
using Pip0Shell.Input;
using Pip0Shell.Ipc;
using Pip0Shell.Ui;

namespace Pip0Shell.Checks;

/// <summary>
/// 入力と作業文脈のうち、Windows の機能を使わない判定：ドラッグの始まりと終わり、マウスの位置のまとめ方、
/// 前面ウィンドウの知らせのまとめ方（300ms）、「最近使ったファイル」の絞り込みと設定の解釈、init の watched_roots。
/// フック・UI Automation・エクスプローラーの COM は、Windows 11 の実機で確かめる必要があります。
/// </summary>
internal static class InputChecks
{
    public static void Run()
    {
        DragTrackerChecks();
        CursorBatcherChecks();
        DebouncerChecks();
        RecentItemsChecks();
        WatchedRootsChecks();
    }

    private static void DragTrackerChecks()
    {
        var tracker = new DragTracker(4, 4);
        Program.Check(tracker.OnMove(new PixelPoint(10, 10)) == DragStepKind.None, "押していないときの移動はドラッグではない");

        Program.Check(tracker.OnButtonDown(new PixelPoint(100, 100), out bool abandoned) == DragStepKind.Pressed && !abandoned, "押した");
        Program.Check(tracker.OnMove(new PixelPoint(104, 96)) == DragStepKind.None, "左右・上下 4px までは、まだドラッグではない（SM_CXDRAG）");
        Program.Check(tracker.OnButtonUp(new PixelPoint(104, 96)) == DragStepKind.None, "動かさずに離したらクリック（ドラッグの終わりは知らせない）");

        tracker.OnButtonDown(new PixelPoint(100, 100), out _);
        Program.Check(tracker.OnMove(new PixelPoint(105, 100)) == DragStepKind.Started && tracker.IsDragging, "4px を超えたらドラッグの始まり");
        Program.Check(tracker.DownPoint == new PixelPoint(100, 100), "押した位置を覚えている");
        Program.Check(tracker.OnMove(new PixelPoint(300, 400)) == DragStepKind.Moved, "ドラッグ中の移動");
        Program.Check(tracker.OnButtonUp(new PixelPoint(300, 400)) == DragStepKind.Ended && !tracker.IsDragging, "離したらドラッグの終わり");
        Program.Check(tracker.OnMove(new PixelPoint(310, 410)) == DragStepKind.None, "終わった後の移動は何もない");

        tracker.OnButtonDown(new PixelPoint(0, 0), out _);
        tracker.OnMove(new PixelPoint(0, -5));
        Program.Check(tracker.IsDragging, "上へ動かしてもドラッグ");
        Program.Check(tracker.OnButtonDown(new PixelPoint(50, 50), out bool lost) == DragStepKind.Pressed && lost && !tracker.IsDragging, "離したことを取りこぼして次に押したら、前のドラッグは「確かめられない終わり」");

        tracker.OnMove(new PixelPoint(60, 50));
        Program.Check(tracker.Abandon() && !tracker.IsDragging, "フックの付け直しでドラッグを捨てる");
        Program.Check(!tracker.Abandon(), "ドラッグ中でなければ捨てるものはない");

        var tiny = new DragTracker(0, -3);
        tiny.OnButtonDown(new PixelPoint(0, 0), out _);
        Program.Check(tiny.OnMove(new PixelPoint(1, 1)) == DragStepKind.None && tiny.OnMove(new PixelPoint(2, 0)) == DragStepKind.Started, "距離が読めない（0 以下）ときも 1px 以上でドラッグ");
    }

    private static void CursorBatcherChecks()
    {
        var batcher = new CursorBatcher(100, 0);
        Program.Check(batcher.TakeIfDue(50) is null, "まとめる時間の前は送らない");
        Program.Check(batcher.TakeIfDue(100) is null, "記録がなければ送らない");
        batcher.Add(1_700_000_000_000, 10, 20);
        batcher.Add(1_700_000_000_033, -5, 25);
        Program.Check(batcher.TakeIfDue(150) is null, "前に送ってから 100ms たつまで待つ");
        JsonObject? payload = batcher.TakeIfDue(200);
        Program.Check(payload is not null && payload.ToJsonString() == "{\"samples\":[[1700000000000,10,20],[1700000000033,-5,25]]}", "[ミリ秒, x, y] の並びで送る（左の画面の負の座標も）");
        Program.Check(batcher.Count == 0 && batcher.TakeAll() is null, "送った後は空");

        for (int i = 0; i < CursorBatcher.MaxSamples + 10; i++)
        {
            batcher.Add(i, i, i);
        }
        JsonObject? capped = batcher.TakeAll();
        JsonArray? samples = capped?["samples"] as JsonArray;
        Program.Check(samples is not null && samples.Count == CursorBatcher.MaxSamples && samples[0]![0]!.GetValue<long>() == 10, "たまりすぎたら古いものから捨てる");

        var zero = new CursorBatcher(0, 0);
        zero.Add(1, 1, 1);
        Program.Check(zero.TakeIfDue(1) is not null, "間隔 0 は 1ms として扱う");
    }

    private static void DebouncerChecks()
    {
        var debouncer = new Debouncer(300, 1000);
        Program.Check(debouncer.DueAt() is null && !debouncer.TryFire(10_000), "知らせがなければ何もしない");

        debouncer.Signal(0);
        Program.Check(debouncer.DueAt() == 300 && !debouncer.TryFire(299), "最後の知らせから 300ms たつまで待つ");
        Program.Check(debouncer.TryFire(300) && !debouncer.TryFire(301), "300ms たったら1回だけ");

        debouncer.Signal(1000);
        debouncer.Signal(1100);
        debouncer.Signal(1250);
        Program.Check(debouncer.DueAt() == 1550 && !debouncer.TryFire(1500) && debouncer.TryFire(1550), "続けて届いたら、最後から 300ms");

        for (long t = 5000; t <= 5900; t += 100)
        {
            debouncer.Signal(t);
        }
        Program.Check(debouncer.DueAt() == 6000, "止まらない知らせでも、最初から 1 秒で送る");
        Program.Check(debouncer.TryFire(6000), "最大の待ち時間で送る");

        var odd = new Debouncer(300, 100);
        odd.Signal(0);
        Program.Check(odd.DueAt() == 300, "最大の待ち時間がまとめる時間より短ければ、まとめる時間に合わせる");
    }

    private static void RecentItemsChecks()
    {
        Program.Check(RecentItems.InterpretTracking(new RecentTrackingReading(true, null, false)) == true, "Start_TrackDocs がなければ記録する（Windows の初期値）");
        Program.Check(RecentItems.InterpretTracking(new RecentTrackingReading(true, 0, false)) == false, "Start_TrackDocs = 0 なら記録しない");
        Program.Check(RecentItems.InterpretTracking(new RecentTrackingReading(true, 1, false)) == true, "Start_TrackDocs = 1 なら記録する");
        Program.Check(RecentItems.InterpretTracking(new RecentTrackingReading(true, 1, true)) == false, "ポリシー NoRecentDocsHistory があれば記録しない");
        Program.Check(RecentItems.InterpretTracking(new RecentTrackingReading(false, null, false)) is null, "読めなければ不明（null）");

        // 比べ方（文字列だけ）は、Windows の形のパスのまま、どの OS でも確かめる
        var roots = new List<string> { @"C:\Users\u\pip0", @"D:\資料" };
        Program.Check(RecentItems.IsNormalisedInsideAny(@"C:\Users\u\pip0\予算.xlsx", roots), "対象のフォルダーの中");
        Program.Check(RecentItems.IsNormalisedInsideAny(@"c:\users\U\PIP0\sub\a.pdf", roots), "大文字小文字は区別しない");
        Program.Check(RecentItems.IsNormalisedInsideAny(@"D:\資料\b.docx", roots), "2つ目の対象のフォルダー");
        Program.Check(!RecentItems.IsNormalisedInsideAny(@"C:\Users\u\pip0x\c.pdf", roots), "名前の先頭が同じだけの別のフォルダーは対象外");
        Program.Check(!RecentItems.IsNormalisedInsideAny(@"C:\Users\u\Documents\d.pdf", roots), "対象のフォルダーの外は知らせない");
        Program.Check(!RecentItems.IsNormalisedInsideAny(@"C:\Users\u\pip0\a.pdf", new List<string>()), "対象のフォルダーがなければ何も知らせない");
        Program.Check(!RecentItems.IsInsideAny(@"relative\e.pdf", roots) && !RecentItems.IsInsideAny("", roots), "絶対パスでなければ知らせない");
        if (OperatingSystem.IsWindows())
        {
            // パスを整える処理（Path.GetFullPath）は Windows のときだけ Windows の決まりで動く
            Program.Check(RecentItems.IsInsideAny(@"C:\Users\u\pip0\sub\..\予算.xlsx", roots), "「..」を整えてから比べる");
            Program.Check(!RecentItems.IsInsideAny(@"C:\Users\u\pip0\..\Documents\x.pdf", roots), "「..」で外へ出るパスは対象外");
        }

        Program.Check(Math.Abs(RecentItems.ToUnixSeconds(new DateTime(2026, 10, 29, 3, 12, 4, 500, DateTimeKind.Utc)) - 1793243524.5) < 1e-6, "更新日時を 1970年からの秒数にする");

        var items = Enumerable.Range(0, RecentItems.MaxItemsPerMessage + 3)
            .Select(i => new RecentItem(@"C:\Users\u\pip0\f" + i + ".txt", DateTime.UnixEpoch.AddSeconds(i)))
            .ToList();
        List<JsonObject> messages = RecentItems.BuildMessages(true, items);
        Program.Check(messages.Count == 2 && ((JsonArray)messages[0]["items"]!).Count == RecentItems.MaxItemsPerMessage && ((JsonArray)messages[1]["items"]!).Count == 3, "多いときは分けて送る");
        Program.Check(messages[1].ToJsonString().Contains("\"tracking_enabled\":true", StringComparison.Ordinal) && messages[1].ToJsonString().Contains("\"opened_at\":502", StringComparison.Ordinal), "どの知らせにも tracking_enabled を付ける");
        List<JsonObject> none = RecentItems.BuildMessages(null, new List<RecentItem>());
        Program.Check(none.Count == 1 && none[0].ToJsonString() == "{\"tracking_enabled\":null,\"items\":[]}", "当てにできないときは tracking_enabled: null（項目なし）");
    }

    private static void WatchedRootsChecks()
    {
        string pip0Root = SamplePath.Of(@"C:\Users\u\pip0");
        string downloads = SamplePath.Of(@"C:\Users\u\Downloads");
        Program.Check(SessionConfiguration.ReadWatchedRoots(null, pip0Root).SequenceEqual(new[] { pip0Root }), "watched_roots がなければ pip0_root だけ");
        Program.Check(SessionConfiguration.ReadWatchedRoots(null, null).Count == 0, "どちらもなければ空");
        IReadOnlyList<string> roots = SessionConfiguration.ReadWatchedRoots(
            new[] { SamplePath.Of(@"C:\Users\u\Downloads\"), "relative", downloads.ToUpperInvariant(), pip0Root },
            pip0Root);
        Program.Check(roots.SequenceEqual(new[] { downloads, pip0Root }), "絶対パスでないもの・重なるものを除き、末尾の区切りを外す");
        Program.Check(SessionConfiguration.ReadWatchedRoots(new string[0], pip0Root).Count == 0, "空の watched_roots は「何も知らせない」");
        var tooMany = Enumerable.Range(0, SessionConfiguration.MaxWatchedRoots + 5).Select(i => SamplePath.Of(@"C:\r" + i)).ToList();
        Program.Check(SessionConfiguration.ReadWatchedRoots(tooMany, null).Count == SessionConfiguration.MaxWatchedRoots, "多すぎる分は使わない");

        Payload init = Payload.From(JsonDocument.Parse(
            "{\"pip0_root\": " + SamplePath.Json(pip0Root) + ", \"watched_roots\": [" + SamplePath.Json(downloads) + "]}").RootElement.Clone());
        SessionConfiguration? configuration = SessionConfiguration.FromPayload(init, false, out _);
        Program.Check(configuration is not null && configuration.WatchedRoots.SequenceEqual(new[] { downloads }), "init の watched_roots を読む");
    }
}
