"""フォルダーの監視とダウンロードの完了の確認（watcher.py）のテスト

FolderWatcher は本物の watchdog で、一時フォルダー（tmp_path）だけを監視します。
DownloadTracker は、時刻（now）を決めて、代役の OS 連携（FakePlatform）で確かめます。
"""

import os
import queue
import time

from pip0 import rules, watcher

NOW = 1_793_250_000.0  # テストで使う決まった時刻


def make_file(path, data=b"0123456789"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path


def wait_for(events, matches, timeout=10.0):
    """キューから知らせを読み、matches に合うものが届くまで待つ（届かなければ失敗）"""
    deadline = time.monotonic() + timeout
    seen = []
    while time.monotonic() < deadline:
        try:
            event = events.get(timeout=0.1)
        except queue.Empty:
            continue
        seen.append((event["kind"], os.path.basename(event["path"])))
        if matches(event):
            return event
    raise AssertionError(f"知らせが届きませんでした（届いたもの：{seen}）")


def event(kind, path, dest_path=None, is_dir=False):
    return {"kind": kind, "path": str(path), "dest_path": str(dest_path) if dest_path else None,
            "is_dir": is_dir, "location_kind": "downloads", "at": NOW}


def browser_row(path, size, event_id=1):
    """download_events の行の形（使う項目だけ）"""
    return {"id": event_id, "filename": str(path), "file_size": size, "ended_at": NOW,
            "url": "https://files.slack.com/files-pri/T0-F0/report.pdf", "state": "pending"}


# ---------------------------------------------------------------------- 名前


def test_temporary_download_names():
    for name in ["report.pdf.crdownload", "Unconfirmed 123456.crdownload", "REPORT.PDF.CRDOWNLOAD",
                 "movie.mp4.part", "setup.exe.partial", "~$予算.docx", "x.tmp", "desktop.ini"]:
        assert watcher.is_temporary_download_name(name, rules) is True, name
    for name in ["report.pdf", "予算.xlsx", "crdownload.pdf"]:
        assert watcher.is_temporary_download_name(name, rules) is False, name
    assert watcher.is_partial_download_name("a.pdf.CRDOWNLOAD") is True
    assert watcher.is_partial_download_name("~WRD0001.tmp") is False  # Word の一時ファイルはダウンロードではない


# ---------------------------------------------------------------------- pip0 自身の変更


def test_self_change_registry_expires(tmp_path):
    registry = watcher.SelfChangeRegistry()
    path = tmp_path / "Downloads" / "a.pdf"
    registry.expect(str(path), NOW)
    assert registry.is_expected(str(path), NOW + 5) is True
    assert registry.is_expected(str(tmp_path / "Downloads" / "b.pdf"), NOW + 5) is False
    assert registry.is_expected(str(path), NOW + 10.5) is False  # 10 秒を過ぎたら忘れる
    assert registry.expected == {}


def test_self_change_registry_normalises_paths(tmp_path):
    registry = watcher.SelfChangeRegistry()
    registry.expect(tmp_path / "Downloads" / "Report.PDF", NOW, seconds=30)
    assert registry.is_expected(f"{tmp_path}//Downloads/./report.pdf", NOW + 1) is True
    assert registry.is_expected(None, NOW + 1) is False


def test_self_change_registry_keeps_the_later_expiry(tmp_path):
    registry = watcher.SelfChangeRegistry()
    path = str(tmp_path / "a.pdf")
    registry.expect(path, NOW, seconds=60)
    registry.expect(path, NOW + 1, seconds=5)  # 短い期限で上書きしても、長い方を残す
    assert registry.is_expected(path, NOW + 30) is True


# ---------------------------------------------------------------------- 本物の watchdog での監視


def test_folder_watcher_reports_created_moved_modified_and_deleted(env):
    downloads = env["DOWNLOADS_DIR"]
    events = queue.Queue()
    folder_watcher = watcher.FolderWatcher([(downloads, "downloads"), (None, "extra")], events)
    result = folder_watcher.start()
    try:
        assert result == {"ok": True, "reason": "", "watching": 1}
        partial = make_file(downloads / "report.pdf.crdownload")
        created = wait_for(events, lambda e: e["kind"] == "created" and e["path"] == str(partial))
        assert created["is_dir"] is False
        assert created["dest_path"] is None
        assert created["location_kind"] == "downloads"
        assert isinstance(created["at"], float)

        final = downloads / "report.pdf"
        os.rename(partial, final)
        moved = wait_for(events, lambda e: e["kind"] == "moved")
        assert moved["path"] == str(partial)
        assert moved["dest_path"] == str(final)

        with open(final, "ab") as f:
            f.write(b"more")
        wait_for(events, lambda e: e["kind"] == "modified" and e["path"] == str(final))

        sub = downloads / "sub"
        sub.mkdir()
        made = wait_for(events, lambda e: e["kind"] == "created" and e["path"] == str(sub))
        assert made["is_dir"] is True
        inner = make_file(sub / "inner.txt")
        wait_for(events, lambda e: e["kind"] == "created" and e["path"] == str(inner))

        os.remove(final)
        deleted = wait_for(events, lambda e: e["kind"] == "deleted" and e["path"] == str(final))
        assert deleted["is_dir"] is False
    finally:
        folder_watcher.stop()
    assert folder_watcher.observer is None


def test_folder_watcher_reports_missing_folders(env, tmp_path):
    events = queue.Queue()
    nothing = watcher.FolderWatcher([(tmp_path / "missing", "extra")], events)
    result = nothing.start()
    assert result["ok"] is False
    assert result["watching"] == 0
    assert "見つからない" in result["reason"]
    assert str(tmp_path) not in result["reason"]  # 理由にパスを書かない
    nothing.stop()  # 始まっていなくても止められる

    partly = watcher.FolderWatcher([(env["DOWNLOADS_DIR"], "downloads"), (tmp_path / "missing", "extra")], events)
    result = partly.start()
    try:
        assert result["ok"] is False
        assert result["watching"] == 1
        assert "追加の対象フォルダー" in result["reason"]
    finally:
        partly.stop()


def test_folder_watcher_start_failure_stops_partial_threads(env, monkeypatch):
    class FailingObserver:
        """watchdog の Observer の代役：始めるときに OS の上限（inotify の数など）で失敗する"""

        def __init__(self):
            self.scheduled = []
            self.stopped = False

        def schedule(self, handler, path, recursive):
            self.scheduled.append((path, recursive))

        def start(self):
            raise OSError(28, "監視の数の上限に達しました")

        def stop(self):
            self.stopped = True

    made = []

    def make_observer():
        made.append(FailingObserver())
        return made[-1]

    monkeypatch.setattr(watcher, "Observer", make_observer)
    folder_watcher = watcher.FolderWatcher([(env["DOWNLOADS_DIR"], "downloads")], queue.Queue())
    result = folder_watcher.start()
    assert result == {"ok": False, "reason": "フォルダーの監視を始められませんでした（OSError）", "watching": 0}
    assert made[0].scheduled == [(str(env["DOWNLOADS_DIR"]), True)]
    assert made[0].stopped is True
    assert folder_watcher.observer is None


def test_folder_watcher_start_twice_keeps_one_observer(env):
    folder_watcher = watcher.FolderWatcher([(env["DOWNLOADS_DIR"], "downloads")], queue.Queue())
    try:
        assert folder_watcher.start()["ok"] is True
        first = folder_watcher.observer
        assert folder_watcher.start() == {"ok": True, "reason": "", "watching": 1}
        assert folder_watcher.observer is first
    finally:
        folder_watcher.stop()


# ---------------------------------------------------------------------- ダウンロードの完了の確認


def test_browser_record_reports_at_once_and_only_once(env, platform):
    tracker = watcher.DownloadTracker(env, rules, platform)
    path = make_file(env["DOWNLOADS_DIR"] / "report.pdf")
    tracker.observe(event("created", path), NOW)
    row = browser_row(path, 10)
    assert tracker.add_browser_event(row, NOW + 0.1) is True
    assert tracker.ready(NOW + 0.2) == [
        {"path": str(path), "completed_at": NOW + 0.2, "via": "browser_extension", "download_event": row},
    ]
    assert tracker.ready(NOW + 5) == []
    tracker.add_browser_event(row, NOW + 6)  # 同じ記録をもう一度渡されても、もう報告しない
    tracker.observe(event("modified", path), NOW + 6)
    assert tracker.ready(NOW + 60) == []


def test_browser_record_with_unknown_size(env, platform):
    tracker = watcher.DownloadTracker(env, rules, platform)
    path = make_file(env["DOWNLOADS_DIR"] / "report.pdf")
    tracker.add_browser_event(browser_row(path, None), NOW)
    assert tracker.ready(NOW)[0]["via"] == "browser_extension"


def test_browser_record_waits_while_file_is_locked(env, platform):
    tracker = watcher.DownloadTracker(env, rules, platform)
    path = make_file(env["DOWNLOADS_DIR"] / "report.pdf")
    platform.locked.add(str(path))  # ウイルス対策ソフトなどが使用中
    tracker.add_browser_event(browser_row(path, 10), NOW)
    assert tracker.ready(NOW) == []
    assert tracker.ready(NOW + 10) == []
    platform.locked.discard(str(path))
    assert tracker.ready(NOW + 11)[0]["via"] == "browser_extension"


def test_browser_record_with_other_size_falls_back_after_waiting(env, platform):
    tracker = watcher.DownloadTracker(env, rules, platform)
    path = make_file(env["DOWNLOADS_DIR"] / "report.pdf")
    row = browser_row(path, 999)
    tracker.add_browser_event(row, NOW)
    assert tracker.ready(NOW) == []
    tracker.add_browser_event(row, NOW + 20)  # 同じ記録をもう一度渡されても、待つ時間を数え直さない
    assert tracker.ready(NOW + 29) == []
    results = tracker.ready(NOW + 31)
    assert len(results) == 1
    assert results[0]["via"] == "stable_size"
    assert results[0]["download_event"] is None  # 大きさが違う記録は、このファイルに結び付けない


def test_crdownload_rename_counts_as_creation(env, platform):
    tracker = watcher.DownloadTracker(env, rules, platform)
    partial = make_file(env["DOWNLOADS_DIR"] / "x.pdf.crdownload")
    tracker.observe(event("created", partial), NOW)
    tracker.observe(event("modified", partial), NOW)
    assert tracker.candidates == {}  # ダウンロード途中の名前は候補にしない
    assert tracker.ready(NOW + 100) == []

    final = env["DOWNLOADS_DIR"] / "x.pdf"
    os.rename(partial, final)
    tracker.observe(event("moved", partial, final), NOW + 100)
    assert tracker.ready(NOW + 100) == []
    assert tracker.ready(NOW + 101) == []  # 大きさの安定は 2 秒から
    assert tracker.ready(NOW + 102.1) == [
        {"path": str(final), "completed_at": NOW + 102.1, "via": "stable_size", "download_event": None},
    ]


def test_temporary_names_are_never_reported(env, platform):
    tracker = watcher.DownloadTracker(env, rules, platform)
    partial = make_file(env["DOWNLOADS_DIR"] / "a.zip.crdownload")
    office = make_file(env["DOWNLOADS_DIR"] / "~$予算.docx")
    assert tracker.add_browser_event(browser_row(partial, 10), NOW) is False
    tracker.observe(event("created", office), NOW)
    tracker.observe(event("moved", env["DOWNLOADS_DIR"] / "a.zip", partial), NOW)  # 最終的な名前 → 途中の名前
    assert tracker.ready(NOW) == []
    assert tracker.ready(NOW + 100) == []


def test_stable_size_rule_waits_while_the_file_grows(env, platform):
    tracker = watcher.DownloadTracker(env, rules, platform)
    path = make_file(env["DOWNLOADS_DIR"] / "copy.iso", b"part 1")
    tracker.observe(event("created", path), NOW)
    assert tracker.ready(NOW) == []
    with open(path, "ab") as f:
        f.write(b" and part 2")
    os.utime(path, (NOW + 1, NOW + 1))
    assert tracker.ready(NOW + 1.5) == []  # 大きさが変わったので、数え直す
    assert tracker.ready(NOW + 3.0) == []
    results = tracker.ready(NOW + 3.6)
    assert [r["via"] for r in results] == ["stable_size"]


def test_stable_size_rule_waits_while_the_file_is_locked(env, platform):
    tracker = watcher.DownloadTracker(env, rules, platform)
    path = make_file(env["DOWNLOADS_DIR"] / "a.pdf")
    platform.locked.add(str(path))
    tracker.observe(event("created", path), NOW)
    assert tracker.ready(NOW) == []
    assert tracker.ready(NOW + 10) == []
    platform.locked.discard(str(path))
    assert tracker.ready(NOW + 11)[0]["via"] == "stable_size"


def test_waits_for_a_possible_browser_record(env, platform):
    config = dict(env)
    config["DOWNLOAD_STABLE_SECONDS"] = 0.5
    config["DOWNLOAD_EVENT_WAIT_SECONDS"] = 1.5
    tracker = watcher.DownloadTracker(config, rules, platform)
    path = make_file(env["DOWNLOADS_DIR"] / "a.pdf")
    tracker.observe(event("created", path), NOW)
    assert tracker.ready(NOW) == []
    assert tracker.ready(NOW + 1.0) == []  # 安定したが、拡張機能の記録をまだ待つ
    row = browser_row(path, 10)
    tracker.add_browser_event(row, NOW + 1.2)
    assert tracker.ready(NOW + 1.3) == [
        {"path": str(path), "completed_at": NOW + 1.3, "via": "browser_extension", "download_event": row},
    ]


def test_each_file_is_reported_once_even_after_rename(env, platform):
    tracker = watcher.DownloadTracker(env, rules, platform)
    path = make_file(env["DOWNLOADS_DIR"] / "download.pdf")
    tracker.observe(event("created", path), NOW)
    tracker.ready(NOW)
    assert len(tracker.ready(NOW + 2.5)) == 1

    renamed = env["DOWNLOADS_DIR"] / "2026-10-30_予算_Slack.pdf"
    os.rename(path, renamed)
    tracker.observe(event("moved", path, renamed), NOW + 3)  # すでにあるファイルの名前の変更
    assert tracker.candidates == {}
    tracker.observe(event("created", renamed), NOW + 3)  # 作成として知らされても、同じ実体なので報告しない
    assert tracker.ready(NOW + 10) == []


def test_editing_an_existing_file_is_not_a_download(env, platform):
    tracker = watcher.DownloadTracker(env, rules, platform)
    path = make_file(env["DOWNLOADS_DIR"] / "old.xlsx")
    with open(path, "ab") as f:
        f.write(b"edited")
    tracker.observe(event("modified", path), NOW)
    assert tracker.ready(NOW + 100) == []


def test_only_files_in_the_downloads_folder(env, platform):
    tracker = watcher.DownloadTracker(env, rules, platform)
    elsewhere = make_file(env["PIP0_ROOT"] / "a.pdf")
    tracker.observe(event("created", elsewhere), NOW)
    assert tracker.add_browser_event(browser_row(elsewhere, 10), NOW) is False
    folder = env["DOWNLOADS_DIR"] / "folder"
    folder.mkdir()
    tracker.observe(event("created", folder, is_dir=True), NOW)  # フォルダーの知らせは使わない
    tracker.observe(event("created", folder), NOW)  # フォルダーの印がなくても、確かめたときに外す
    assert tracker.ready(NOW + 100) == []
    assert tracker.candidates == {}

    config = dict(env)
    config["DOWNLOADS_DIR"] = None
    assert watcher.DownloadTracker(config, rules, platform).add_browser_event(browser_row(elsewhere, 10), NOW) is False


def test_empty_file_needs_a_browser_record(env, platform):
    tracker = watcher.DownloadTracker(env, rules, platform)
    path = make_file(env["DOWNLOADS_DIR"] / "placeholder.pdf", b"")
    tracker.observe(event("created", path), NOW)
    assert tracker.ready(NOW) == []
    assert tracker.ready(NOW + 100) == []  # 0 バイトは、場所を確保しただけのことがある
    tracker.add_browser_event(browser_row(path, 0), NOW + 101)
    assert tracker.ready(NOW + 101)[0]["via"] == "browser_extension"


def test_deleted_and_vanished_candidates_are_dropped(env, platform):
    tracker = watcher.DownloadTracker(env, rules, platform)
    first = make_file(env["DOWNLOADS_DIR"] / "first.pdf")
    second = make_file(env["DOWNLOADS_DIR"] / "second.pdf")
    tracker.observe(event("created", first), NOW)
    tracker.observe(event("created", second), NOW)
    os.remove(first)
    tracker.observe(event("deleted", first), NOW + 1)
    os.remove(second)  # 消えた知らせが届かなくても、確かめたときに外す
    assert tracker.ready(NOW + 1) == []
    assert tracker.candidates == {}


def test_browser_record_can_arrive_before_the_file(env, platform):
    tracker = watcher.DownloadTracker(env, rules, platform)
    path = env["DOWNLOADS_DIR"] / "late.pdf"
    tracker.add_browser_event(browser_row(path, 10), NOW)
    assert tracker.ready(NOW) == []
    make_file(path)
    assert tracker.ready(NOW + 1)[0]["via"] == "browser_extension"

    never = env["DOWNLOADS_DIR"] / "never.pdf"
    tracker.add_browser_event(browser_row(never, 10, event_id=2), NOW)
    assert tracker.ready(NOW + 29) == []
    assert tracker.ready(NOW + 31) == []
    assert tracker.candidates == {}  # 30 秒待っても現れなければ外す


def test_reported_files_are_forgotten_after_a_day(env, platform):
    tracker = watcher.DownloadTracker(env, rules, platform)
    path = make_file(env["DOWNLOADS_DIR"] / "a.pdf")
    tracker.add_browser_event(browser_row(path, 10), NOW)
    assert len(tracker.ready(NOW)) == 1
    assert tracker.reported != {}
    tracker.ready(NOW + 2 * 24 * 3600)
    assert tracker.reported == {}
