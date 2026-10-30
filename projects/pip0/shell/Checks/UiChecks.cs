using System;
using System.Linq;
using System.Text.Json;
using Pip0Shell.Ipc;
using Pip0Shell.Ui;

namespace Pip0Shell.Checks;

/// <summary>
/// 常駐UI のうち、Windows の機能を使わない判定：置き場所の計算、デスクの「接近で透過」と「つまみ」、
/// デスクから始まったドラッグの記録、ミニドック・デスク・警告・状態の payload の読み取り、開かない種類のファイル。
/// 画面そのもの（WPF のウィンドウ、透過、クリックの通過）は、Windows 11 の実機で確かめる必要があります。
/// </summary>
internal static class UiChecks
{
    public static void Run()
    {
        GeometryChecks();
        ProximityChecks();
        PressRecorderChecks();
        MiniDockChecks();
        DeskChecks();
        HazardChecks();
        StatusChecks();
        OpenableChecks();
        EchoIdChecks();
    }

    private static void GeometryChecks()
    {
        var rect = new PixelRect(100, 100, 200, 150);
        Program.Check(ScreenGeometry.DistanceToRect(new PixelPoint(150, 120), rect) == 0, "長方形の中の点までの距離は 0");
        Program.Check(ScreenGeometry.DistanceToRect(new PixelPoint(100, 100), rect) == 0, "左上の角は中");
        Program.Check(ScreenGeometry.DistanceToRect(new PixelPoint(199, 149), rect) == 0, "右下の最後の画素は中");
        Program.Check(Math.Abs(ScreenGeometry.DistanceToRect(new PixelPoint(200, 120), rect) - 1) < 1e-9, "右端の外側は 1（Right は含まない）");
        Program.Check(Math.Abs(ScreenGeometry.DistanceToRect(new PixelPoint(52, 120), rect) - 48) < 1e-9, "左に 48 離れた点");
        Program.Check(Math.Abs(ScreenGeometry.DistanceToRect(new PixelPoint(97, 96), rect) - 5) < 1e-9, "角から斜めの距離（3, 4 → 5）");
        Program.Check(double.IsPositiveInfinity(ScreenGeometry.DistanceToRect(new PixelPoint(0, 0), default)), "空の長方形までは無限大");

        var work = new PixelRect(0, 0, 1920, 1040);
        Program.Check(ScreenGeometry.BottomRight(work, 380, 200, 12) == new PixelPoint(1528, 828), "作業領域の右下に余白を空けて置く");
        Program.Check(ScreenGeometry.BottomRight(new PixelRect(-1920, 0, 0, 1040), 380, 200, 12) == new PixelPoint(-392, 828), "左側の画面（負の座標）でも右下");
        Program.Check(ScreenGeometry.RightEdgeCentre(work, 300, 400, 8) == new PixelPoint(1612, 320), "右端の上下の中央");
        Program.Check(ScreenGeometry.RightEdgeCentre(work, 300, 2000, 8) == new PixelPoint(1612, 0), "高すぎるときは上端に合わせる");
        Program.Check(ScreenGeometry.Clamp(work, 1800, 1000, 300, 200) == new PixelPoint(1620, 840), "はみ出す位置は作業領域の中へ戻す");
        Program.Check(ScreenGeometry.Clamp(work, 10, 10, 3000, 2000) == new PixelPoint(0, 0), "作業領域より大きければ左上に合わせる");

        var dialog = new PixelRect(500, 400, 1300, 900);
        Program.Check(ScreenGeometry.AlongDialogTop(dialog, work, 700, 120, 8) == new PixelPoint(500, 272), "ダイアログの上辺の上に置く");
        var topDialog = new PixelRect(500, 50, 1300, 600);
        Program.Check(ScreenGeometry.AlongDialogTop(topDialog, work, 700, 120, 8) == new PixelPoint(500, 608), "上に入らなければダイアログの下に置く");
        var tallDialog = new PixelRect(500, 50, 1300, 1000);
        Program.Check(ScreenGeometry.AlongDialogTop(tallDialog, work, 700, 120, 8) == new PixelPoint(500, 0), "上にも下にも入らなければ作業領域の上端");
        var rightDialog = new PixelRect(1500, 400, 1900, 900);
        Program.Check(ScreenGeometry.AlongDialogTop(rightDialog, work, 700, 120, 8) == new PixelPoint(1220, 272), "右にはみ出すときは作業領域の中へ戻す");

        Program.Check(ScreenGeometry.Scale(48, 1.5) == 72 && ScreenGeometry.Scale(48, 1.0) == 48, "100% のピクセル数を拡大率に合わせる");
        Program.Check(ScreenGeometry.Scale(12, double.NaN) == 12 && ScreenGeometry.Scale(12, 0) == 12, "拡大率が読めなければ 100% として扱う");

        Program.Check(new PixelRect(0, 0, 10, 10).Union(new PixelRect(20, 5, 30, 8)) == new PixelRect(0, 0, 30, 10), "2つを含む長方形");
        Program.Check(default(PixelRect).Union(rect) == rect && rect.Union(default) == rect, "空の長方形は無視する");
    }

    private static void ProximityChecks()
    {
        var desk = new PixelRect(1600, 300, 1900, 700);
        var handle = new PixelRect(1578, 468, 1600, 532);
        const double approach = 48;
        var proximity = new DeskProximity();

        DeskStep far = proximity.Update(0, new PixelPoint(1000, 500), desk, handle, approach);
        Program.Check(far.Mode == DeskMode.Normal && !far.ModeChanged && far.HandleEvent is null, "遠いときは不透明でクリックできる");

        DeskStep near = proximity.Update(33, new PixelPoint(1560, 350), desk, handle, approach);
        Program.Check(near.Mode == DeskMode.Faded && near.ModeChanged && near.HandleEvent is null, "48px 以内に来たら薄くなる（クリックを通す）");

        DeskStep over = proximity.Update(66, new PixelPoint(1700, 400), desk, handle, approach);
        Program.Check(over.Mode == DeskMode.Faded && !over.ModeChanged, "デスクの上でも薄いまま（下のウィンドウを操作できる）");

        DeskStep boundary = proximity.Update(99, new PixelPoint(1552, 350), desk, handle, approach);
        Program.Check(boundary.Mode == DeskMode.Faded, "ちょうど 48px は「近い」");
        DeskStep justOut = proximity.Update(132, new PixelPoint(1551, 350), desk, handle, approach);
        Program.Check(justOut.Mode == DeskMode.Normal && justOut.ModeChanged, "49px 離れたら元に戻る");

        DeskStep hover1 = proximity.Update(1000, new PixelPoint(1590, 500), desk, handle, approach);
        Program.Check(hover1.Mode == DeskMode.Faded && hover1.HandleEvent is null, "つまみに乗った直後は、まだ操作モードではない");
        DeskStep hover2 = proximity.Update(1299, new PixelPoint(1591, 501), desk, handle, approach);
        Program.Check(hover2.Mode != DeskMode.Engaged && hover2.HandleEvent is null, "0.299 秒では操作モードにならない");
        DeskStep hover3 = proximity.Update(1300, new PixelPoint(1592, 502), desk, handle, approach);
        Program.Check(hover3.Mode == DeskMode.Engaged && hover3.HandleEvent == "engaged" && hover3.ModeChanged, "0.3 秒とどまると操作モード（engaged を知らせる）");

        DeskStep inside = proximity.Update(1400, new PixelPoint(1750, 600), desk, handle, approach);
        Program.Check(inside.Mode == DeskMode.Engaged && inside.HandleEvent is null, "操作モードの間は、デスクの上でも不透明でクリックできる");
        DeskStep stillNear = proximity.Update(1500, new PixelPoint(1555, 600), desk, handle, approach);
        Program.Check(stillNear.Mode == DeskMode.Engaged, "つまみから 48px 以内なら操作モードのまま");
        DeskStep unknown = proximity.Update(1550, null, desk, handle, approach);
        Program.Check(unknown.Mode == DeskMode.Engaged && !unknown.ModeChanged && unknown.HandleEvent is null, "マウスの位置を読めないときは、そのまま");
        DeskStep released = proximity.Update(1600, new PixelPoint(1400, 600), desk, handle, approach);
        Program.Check(released.Mode == DeskMode.Normal && released.HandleEvent == "released", "48px より離れたら操作モードを終える（released を知らせる）");

        proximity.Update(2000, new PixelPoint(1590, 500), desk, handle, approach);
        proximity.Update(2200, new PixelPoint(1000, 500), desk, handle, approach);
        DeskStep reentered = proximity.Update(2350, new PixelPoint(1590, 500), desk, handle, approach);
        Program.Check(reentered.Mode != DeskMode.Engaged, "つまみから離れたら、とどまった時間は数え直す");

        DeskStep clicked = proximity.Engage();
        Program.Check(clicked.Mode == DeskMode.Engaged && clicked.HandleEvent == "engaged", "つまみのクリックで、すぐに操作モード");
        Program.Check(proximity.Engage().HandleEvent is null, "操作モードのときのクリックは、もう知らせない");
        DeskStep hidden = proximity.Reset();
        Program.Check(hidden.Mode == DeskMode.Normal && hidden.HandleEvent == "released", "操作モードのまま隠すときは released を知らせる");
        Program.Check(proximity.Reset().HandleEvent is null, "操作モードでなければ、隠しても何も知らせない");

        var noHandle = new DeskProximity();
        DeskStep withoutHandle = noHandle.Update(0, new PixelPoint(0, 0), desk, default, approach);
        Program.Check(withoutHandle.Mode == DeskMode.Normal, "つまみの位置が分からなくても動く");
    }

    private static void PressRecorderChecks()
    {
        var recorder = new DeskPressRecorder();
        Program.Check(recorder.Find(new PixelPoint(10, 10), 1000) is null, "記録がなければ null");
        recorder.Record(@"C:\Users\u\pip0\予算.xlsx", new PixelPoint(1700, 400), 1000);
        Program.Check(recorder.Find(new PixelPoint(1702, 398), 1500) == @"C:\Users\u\pip0\予算.xlsx", "近い位置・すぐ後なら、デスクの候補からのドラッグ");
        Program.Check(recorder.Find(new PixelPoint(1800, 400), 1500) is null, "離れた位置で押したものは別");
        Program.Check(recorder.Find(new PixelPoint(1700, 400), 1000 + DeskPressRecorder.MaxAgeMilliseconds + 1) is null, "古い記録は使わない");
        Program.Check(recorder.Find(new PixelPoint(1700, 400), 900) is null, "記録より前の時刻とは結び付けない");
        recorder.Clear();
        Program.Check(recorder.Find(new PixelPoint(1700, 400), 1100) is null, "消したら使わない");
    }

    private static void MiniDockChecks()
    {
        Payload payload = Parse(@"{
            ""dock_id"": ""dock-7"",
            ""rows"": [
                {""entry_id"": 3, ""file_name"": ""IMG_0001.png"", ""status"": ""proposed"", ""dest_label"": ""pip0\\資料"",
                 ""new_name"": ""2026-10-29_青いグラフ_Slack.png"", ""reasons"": [""ファイル名に「グラフ」"", ""  "", ""拡張子 .png""],
                 ""alternatives"": [{""index"": 0, ""label"": ""画像""}, {""index"": ""x"", ""label"": ""壊れた候補""}, {""index"": 2, ""label"": ""  ""}],
                 ""context_label"": ""Slack（予算）"", ""remaining_seconds"": 2.5},
                {""entry_id"": ""e-2"", ""file_name"": ""a.bin"", ""status"": ""no_candidate"", ""dest_label"": null, ""reasons"": []},
                {""entry_id"": ""e-3"", ""file_name"": ""   ""},
                {""file_name"": ""no-id.txt""},
                ""not an object""
            ]
        }");
        MiniDockContent? content = MiniDockContent.Parse(payload, out string problem, out int skipped);
        Program.Check(content is not null && problem.Length == 0, "ミニドックの payload を読める");
        if (content is null)
        {
            return;
        }
        Program.Check(content.DockId == new EchoId("dock-7", null), "dock_id は文字列のまま");
        Program.Check(content.Rows.Count == 2 && skipped == 3, "名前のない行・ID のない行・オブジェクトでない行は飛ばす（3 件）");
        MiniDockRow first = content.Rows[0];
        Program.Check(first.EntryId == new EchoId(null, 3) && first.EntryId.ToJson()!.ToJsonString() == "3", "整数の entry_id は整数のまま送り返す");
        Program.Check(first.Reasons.Count == 2, "空白だけの理由は除く");
        Program.Check(first.Alternatives.Count == 1 && first.Alternatives[0] == new MiniDockAlternative(0, "画像"), "形の違う別の候補は除く");
        Program.Check(first.CanAccept, "候補のある行は「提案どおり」を押せる");
        MiniDockRow second = content.Rows[1];
        Program.Check(!second.CanAccept && second.DestLabel is null && second.NewName is null, "候補のない行は「提案どおり」を押せない");

        Program.Check(MiniDockContent.Parse(Parse("{\"rows\": []}"), out string noId, out _) is null && noId.Length > 0, "dock_id がなければ表示しない");
        Program.Check(MiniDockContent.Parse(Parse("{\"dock_id\": 1}"), out string noRows, out _) is null && noRows.Length > 0, "rows がなければ表示しない");
        Program.Check(MiniDockContent.Parse(Parse("{\"dock_id\": {\"a\": 1}, \"rows\": []}"), out _, out _) is null, "オブジェクトの dock_id は受け付けない");
        MiniDockContent? empty = MiniDockContent.Parse(Parse("{\"dock_id\": 5, \"rows\": []}"), out _, out _);
        Program.Check(empty is { Rows.Count: 0 }, "行が0件でも読める（何も並べない）");

        string manyRows = "{\"dock_id\": 1, \"rows\": [" + string.Join(",", Enumerable.Range(0, 30).Select(i => "{\"entry_id\": " + i + ", \"file_name\": \"f" + i + ".txt\"}")) + "]}";
        MiniDockContent? many = MiniDockContent.Parse(Parse(manyRows), out _, out int manySkipped);
        Program.Check(many is not null && many.Rows.Count == MiniDockContent.MaxRows && manySkipped == 30 - MiniDockContent.MaxRows, "並べる行は上限まで");

        string longName = new string('長', 1000);
        MiniDockContent? longContent = MiniDockContent.Parse(Parse("{\"dock_id\": 1, \"rows\": [{\"entry_id\": 1, \"file_name\": \"" + longName + "\"}]}"), out _, out _);
        Program.Check(longContent is not null && longContent.Rows[0].FileName.Length <= 300 && longContent.Rows[0].FileName.EndsWith("…", StringComparison.Ordinal), "長すぎる名前は切って「…」を付ける");
    }

    private static void DeskChecks()
    {
        string ghostPath = SamplePath.Of(@"C:\Users\u\pip0\予算.xlsx");
        string presentPath = SamplePath.Of(@"C:\Users\u\pip0\b.pdf");
        Payload payload = Parse(@"{
            ""desk_id"": 12,
            ""context_label"": ""Slack（#予算）"",
            ""partner_label"": ""チャット相手：取得不可"",
            ""dialog_hwnd"": 1311234,
            ""dialog_rect"": {""left"": 400, ""top"": 300, ""right"": 1200, ""bottom"": 900},
            ""items"": [
                {""path"": " + SamplePath.Json(ghostPath) + @", ""name"": ""予算.xlsx"", ""status"": ""ghost"", ""reasons"": [""名前に「予算」""]},
                {""path"": " + SamplePath.Json(presentPath) + @", ""status"": ""present""},
                {""path"": ""relative\\c.pdf"", ""name"": ""c.pdf""},
                {""name"": ""no-path.pdf""}
            ]
        }");
        DeskContent desk = DeskContent.Parse(payload, out int skipped);
        Program.Check(desk.Items.Count == 2 && skipped == 2, "絶対パスでない候補・パスのない候補は飛ばす");
        if (desk.Items.Count != 2)
        {
            return;
        }
        Program.Check(desk.Items[0].IsGhost && !desk.Items[1].IsGhost, "ghost は「退避中」として出す");
        Program.Check(desk.Items[1].Name == "b.pdf", "name がなければ、パスのファイル名を使う");
        Program.Check(desk.Items[0].Path == ghostPath, "path は受け取ったまま送り返す");
        Program.Check(desk.ForDialog && desk.DialogHwnd == 1311234 && desk.DialogRect == new PixelRect(400, 300, 1200, 900), "ダイアログの番号と位置を読む");
        Program.Check(desk.DeskId == new EchoId(null, 12), "desk_id を読む");

        DeskContent edge = DeskContent.Parse(Parse("{\"items\": [], \"dialog_hwnd\": 0, \"dialog_rect\": null}"), out _);
        Program.Check(!edge.ForDialog && edge.Items.Count == 0 && edge.DeskId is null, "ダイアログの番号 0・位置なしなら画面の端に出す");

        Program.Check(DeskContent.ParseRect(Parse("{\"left\": 10, \"top\": 10, \"right\": 5, \"bottom\": 20}")) is null, "幅が負の位置は使わない");
        Program.Check(DeskContent.ParseRect(Parse("{\"left\": 10, \"top\": 10, \"right\": 20}")) is null, "値の欠けた位置は使わない");
        Program.Check(DeskContent.ParseRect(Parse("{\"left\": 1e300, \"top\": 0, \"right\": 1e301, \"bottom\": 10}")) is null, "大きすぎる値の位置は使わない");
        Program.Check(DeskContent.ParseRect(Parse("{\"left\": -1920, \"top\": 0, \"right\": -100, \"bottom\": 900}")) == new PixelRect(-1920, 0, -100, 900), "左側の画面（負の座標）の位置は使える");

        string manyItems = "{\"items\": [" + string.Join(",", Enumerable.Range(0, 15).Select(i => "{\"path\": " + SamplePath.Json(SamplePath.Of(@"C:\a\f" + i + ".txt")) + "}")) + "]}";
        DeskContent many = DeskContent.Parse(Parse(manyItems), out int manySkipped);
        Program.Check(many.Items.Count == DeskContent.MaxItems && manySkipped == 15 - DeskContent.MaxItems, "候補は上限まで（届いた順）");
    }

    private static void HazardChecks()
    {
        HazardContent sensitive = HazardContent.Parse(Parse(@"{""level"": ""sensitive"", ""message"": ""機密のファイルです"",
            ""items"": [{""name"": ""給与.xlsx"", ""level"": ""sensitive"", ""reasons"": [""名前に「給与」""]}, {""name"": ""b.pdf""},
                        {""name"": ""c.pdf""}, {""name"": ""d.pdf""}, {""name"": ""  ""}]}"), out bool unknownLevel);
        Program.Check(sensitive.IsSensitive && !unknownLevel && sensitive.Message == "機密のファイルです", "sensitive は赤");
        Program.Check(sensitive.Items.Count == 4, "名前のない項目は除く");
        Program.Check(sensitive.NamesLine() == "給与.xlsx、b.pdf、c.pdf ほか 1 件", "名前は3件まで、残りは件数");

        HazardContent unknown = HazardContent.Parse(Parse("{\"level\": \"unknown\", \"items\": []}"), out bool unknownFlag);
        Program.Check(!unknown.IsSensitive && !unknownFlag && unknown.Message.Contains("未判定", StringComparison.Ordinal), "unknown は橙。文がなければ決まった文");
        Program.Check(unknown.NamesLine() == "", "項目がなければ名前の行は空");

        HazardContent strange = HazardContent.Parse(Parse("{\"level\": \"severe\"}"), out bool strangeFlag);
        Program.Check(strangeFlag && strange.Level == HazardContent.LevelUnknown && !strange.IsSensitive, "知らない level は橙で出す（警告を消さない）");
        HazardContent missing = HazardContent.Parse(Payload.Empty, out bool missingFlag);
        Program.Check(missingFlag && missing.Message.Length > 0, "payload が空でも橙で出す");
    }

    private static void StatusChecks()
    {
        StatusText status = StatusText.Parse(Parse(@"{
            ""automation"": ""running"",
            ""throttle"": {""allowed"": false, ""power"": ""battery"", ""idle_seconds"": 42.7, ""reason"": ""電源につながっていません""},
            ""restore"": {""total"": 10, ""restored"": 7, ""conflict"": 1, ""local_newer"": 0, ""missing"": 0, ""failed"": 1, ""remaining"": 1, ""finished"": false},
            ""features"": [{""feature"": ""mouse_hook"", ""ok"": true, ""reason"": ""動いています""},
                           {""feature"": ""cloud_files"", ""ok"": false, ""reason"": ""NTFS ではありません""},
                           {""feature"": ""new_feature"", ""ok"": false},
                           {""ok"": true}]
        }"));
        string text = string.Join("\n", status.Lines);
        Program.Check(status.AutomationLabel == "動作中" && status.Tooltip() == "pip0（自動処理：動作中）／使えない機能 2 件", "ツールチップに自動処理の状態と使えない機能の数");
        Program.Check(text.Contains("高負荷の処理（解析・退避）：待機中", StringComparison.Ordinal) && text.Contains("バッテリー", StringComparison.Ordinal) && text.Contains("42 秒", StringComparison.Ordinal), "高負荷の処理の条件を日本語で");
        Program.Check(text.Contains("全 10 件", StringComparison.Ordinal) && text.Contains("残り 1", StringComparison.Ordinal) && text.Contains("途中です", StringComparison.Ordinal), "全復元の進み具合");
        Program.Check(text.Contains("○ ドラッグの検知：動いています", StringComparison.Ordinal) && text.Contains("× ゴースト（Cloud Files API）：NTFS ではありません", StringComparison.Ordinal), "機能の状態を日本語の名前で");
        Program.Check(text.Contains("× new_feature", StringComparison.Ordinal), "知らない機能は名前のまま出す");

        StatusText stopped = StatusText.Parse(Parse("{\"automation\": \"stopped\"}"));
        Program.Check(stopped.AutomationLabel == "停止中" && stopped.Tooltip() == "pip0（自動処理：停止中）", "停止中");
        StatusText empty = StatusText.Parse(Payload.Empty);
        Program.Check(empty.AutomationLabel == "不明" && empty.Lines.Count == 1, "空の状態は「不明」");
        Program.Check(StatusText.Waiting.Tooltip().Length <= 127, "ツールチップは Windows の上限 127 文字以内");

        string manyFeatures = "{\"automation\": \"running\", \"features\": [" + string.Join(",", Enumerable.Range(0, 80).Select(i => "{\"feature\": \"f" + i + "\", \"ok\": false}")) + "]}";
        StatusText many = StatusText.Parse(Parse(manyFeatures));
        Program.Check(many.Lines.Count <= 60, "機能の行は上限まで");
    }

    private static void OpenableChecks()
    {
        Program.Check(OpenableFile.IsRunnable(@"C:\Users\u\Downloads\請求書.pdf.exe"), "二重の拡張子の .exe は開かない");
        Program.Check(OpenableFile.IsRunnable(@"C:\a\setup.MSI") && OpenableFile.IsRunnable(@"C:\a\run.ps1") && OpenableFile.IsRunnable(@"C:\a\link.lnk"), "大文字小文字によらず、実行される種類は開かない");
        Program.Check(OpenableFile.IsRunnable(@"C:\a\trick.exe. ."), "末尾の点・空白で隠した .exe も開かない");
        Program.Check(!OpenableFile.IsRunnable(@"C:\a\予算.xlsx") && !OpenableFile.IsRunnable(@"C:\a\report.pdf") && !OpenableFile.IsRunnable(@"C:\a\noext"), "文書・画像・拡張子なしは開ける");
    }

    private static void EchoIdChecks()
    {
        Payload payload = Parse("{\"s\": \"a\", \"n\": 42, \"f\": 1.5, \"b\": true, \"o\": {}, \"big\": 9007199254740993}");
        Program.Check(payload.GetEchoId("s") == new EchoId("a", null) && payload.GetEchoId("n") == new EchoId(null, 42), "文字列と整数の ID を読む");
        Program.Check(payload.GetEchoId("f") is null && payload.GetEchoId("b") is null && payload.GetEchoId("o") is null && payload.GetEchoId("x") is null, "小数・真偽・オブジェクト・ないものは ID にしない");
        Program.Check(payload.GetEchoId("big")!.Value.ToJson()!.ToJsonString() == "9007199254740993", "大きな整数もそのまま送り返す");
        Program.Check(new EchoId("1", null) != new EchoId(null, 1), "文字列の \"1\" と整数の 1 は別の ID");
        Program.Check(default(EchoId).ToJson() is null, "空の ID は null として送る");

        Payload arrays = Parse("{\"a\": [\"x\", 1, null, \"y\"], \"n\": \"text\"}");
        Program.Check(arrays.GetStringArray("a")!.SequenceEqual(new[] { "x", "y" }), "文字列の配列は、文字列だけを読む");
        Program.Check(arrays.GetStringArray("n") is null && arrays.GetStringArray("missing") is null, "配列でなければ null");
    }

    private static Payload Parse(string json)
    {
        return Payload.From(JsonDocument.Parse(json).RootElement.Clone());
    }
}
