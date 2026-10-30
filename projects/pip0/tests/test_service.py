"""常駐処理（service.py）のテスト：知らせ → 各機能のモジュール → 画面への指示 のつながり

OS 連携は代役（FakePlatform）、画面は記録するだけの RecordingUi、時刻は FakeClock で決めます。
start_threads=False にして、ワーカーのスレッドとフォルダーの監視を使わずに、step の中で1つずつ処理します
（最後の1つのテストだけ、本物のスレッドとフォルダーの監視で、短く通して確かめます）。
ここで確かめたことは「代役での確認」で、Windows の実機での確認ではありません。
"""

import hashlib
import json
import os
import time
from pathlib import Path

import pytest
from pypdf import PdfWriter

from pip0 import analysis_queue, database, killswitch, provenance, rules, service, timeutil, vault
from pip0.ui import RecordingUi

T0 = 1_793_235_600.0          # 2026-10-29 10:00（日本時間、木曜日）
DAY = 24 * 3600
OLD_MTIME = T0 - 200 * DAY    # 長い間使われていないファイルの、最終更新日時
SLACK_ZONE = "[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://files.slack.com/files-pri/T0-F0/download.pdf\r\n"


# ---------------------------------------------------------------------- 準備


class FakeClock:
    """決まった時刻を返す時計（advance で進める）"""

    def __init__(self, start):
        self.now = start

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds
        return self.now


class FakeLink:
    """pip0 シェルの代役（ShellLink と同じ名前のメソッド）。要求を記録し、決まった答えを返す"""

    def __init__(self, start_ok=True):
        self.start_ok = start_ok
        self.alive = False
        self.on_event = None
        self.requests = []
        self.events = []
        self.starts = 0
        self.stops = 0
        self.replies = {
            "init": {"shell_version": "0.1.0-test",
                     "capabilities": {"cloud_files": True, "trash": True, "ui": True, "hooks": True}},
            "shell.open_file": {"ok": True, "reason": ""},
            "shell.reveal_file": {"ok": True, "reason": ""},
            "shell.fill_file_dialog": {"ok": True, "reason": ""},
        }

    def start(self):
        self.starts += 1
        if not self.start_ok:
            return {"ok": False, "reason": "実行ファイルが見つかりません"}
        self.alive = True
        return {"ok": True, "reason": ""}

    def stop(self, timeout=5):
        self.stops += 1
        self.alive = False
        return {"stopped": True, "returncode": 0, "method": "quit"}

    def is_alive(self):
        return self.alive

    def request(self, type, payload=None, timeout=10.0):
        self.requests.append((type, payload))
        if not self.alive:
            raise service.shell_link.ShellUnavailable("pip0 シェルが動いていません。")
        return dict(self.replies[type])

    def send_event(self, type, payload=None):
        self.events.append((type, payload))
        return self.alive

    def request_types(self):
        return [name for name, _payload in self.requests]


@pytest.fixture
def clock():
    return FakeClock(T0)


@pytest.fixture
def config(env):
    # 遅い PC でも文書のタイトルを読み切れるよう、待つ時間を長くする（本番は 0.3 秒）。
    # 小さなファイルも区切り（4KB）ごとに確かめ、退避できるようにする
    return dict(env, LIGHT_METADATA_BUDGET_SECONDS=10.0, HASH_CHUNK_BYTES=4096, EVACUATE_MIN_SIZE_BYTES=1024)


def make_service(config, platform, db, ui, clock, link=None, start_threads=False, keystore=None):
    return service.Service(config, rules, platform, ui, db, link=link, clock=clock, start_threads=start_threads,
                           keystore=keystore)


@pytest.fixture
def resident(config, platform, db, ui, clock):
    """起動した常駐処理（スレッドなし、シェルなし）。テストの最後に終了する"""
    svc = make_service(config, platform, db, ui, clock)
    assert svc.start()["ok"]
    yield svc
    svc.shutdown()


def make_pdf(path, title):
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    writer.add_metadata({"/Title": title})
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        writer.write(f)
    return path


def make_file(path, size=20_000, mtime=None, text=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    if text is not None:
        path.write_text(text, encoding="utf-8")
    else:
        path.write_bytes(bytes((i * 31 + len(path.name)) % 251 for i in range(size)))
    if mtime is not None:
        os.utime(path, (mtime, mtime))
    return path


def file_event(kind, path, location_kind, at, dest_path=None):
    return {"kind": kind, "path": str(path), "dest_path": str(dest_path) if dest_path else None, "is_dir": False,
            "location_kind": location_kind, "at": at}


def shell_event(event_type, **payload):
    return {"type": event_type, "payload": payload}


def finish_download(svc, path, clock):
    """ダウンロードフォルダーに現れたファイルの知らせを渡し、大きさが安定するまで時間を進める（ミニドックが出る）"""
    svc.handle_file_event(file_event("created", path, "downloads", clock()), clock())
    svc.step()
    clock.advance(2.5)
    svc.step()


def sha256_of(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def evacuated(db, platform, config, path):
    """テストの準備として、ファイルを退避してゴーストにする（ユーザーの操作として）"""
    result = vault.evacuate(db, platform, str(path), config, reasons=["テストの準備"], should_continue=lambda: True,
                            actor="user", now=T0)
    assert result["ok"], result
    return result["item_id"]


class InterruptingReader:
    """ファイルを読む途中で、決めた回数目の read の前に action を呼ぶ（「途中で何かが起きた」をまねる）"""

    def __init__(self, f, at_read, action):
        self.f = f
        self.at_read = at_read
        self.action = action
        self.reads = 0

    def read(self, size=-1):
        self.reads += 1
        if self.reads == self.at_read:
            self.action()
        return self.f.read(size)

    def fileno(self):
        return self.f.fileno()

    def close(self):
        self.f.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.f.close()


# ---------------------------------------------------------------------- M1 ダウンロード → ミニドック → 仕分けと改名


def test_completed_download_shows_the_mini_dock_and_is_sorted_and_renamed_after_three_seconds(
        resident, config, platform, db, ui, clock):
    path = make_pdf(Path(config["DOWNLOADS_DIR"]) / "download (3).pdf", "2026年度 予算案")
    platform.zone_identifiers[str(path)] = SLACK_ZONE

    resident.handle_file_event(file_event("created", path, "downloads", clock()), clock())
    resident.step()
    assert "ui.mini_dock.show" not in ui.names()  # 大きさが安定するまでは、完了とみなさない

    completed_at = clock.advance(2.5)
    resident.step()
    shown = ui.last("ui.mini_dock.show")
    row = shown["rows"][0]
    new_name = f"{timeutil.local_date_str(completed_at)}_2026年度 予算案_Slack.pdf"
    assert (row["file_name"], row["status"], row["dest_label"], row["new_name"]) == \
           ("download (3).pdf", "proposed", "予算・会計", new_name)
    assert row["remaining_seconds"] == 3.0

    clock.advance(2.9)
    resident.step()
    assert path.exists()  # 3秒たつまでは動かさない

    clock.advance(0.2)
    resident.step()
    destination = Path(config["PIP0_ROOT"]) / "予算・会計" / new_name
    assert destination.exists() and not path.exists()
    assert ui.last("ui.mini_dock.close") == {"dock_id": shown["dock_id"], "reason": "empty"}
    operation = database.query_one(db, "SELECT * FROM operations WHERE kind = 'sort_rename'")
    assert (operation["status"], operation["actor"]) == ("done", "auto")
    assert (operation["before_path"], operation["after_path"]) == (str(path), str(destination))
    reasons = json.loads(operation["reasons_json"])
    assert reasons[0] == "ミニドックの表示時間が過ぎたため、自動で実行しました"
    assert any("Zone.Identifier" in reason for reason in reasons)

    # pip0 自身の移動の知らせは無視する（自分の改名を、新しいダウンロードとして扱わない）
    resident.handle_file_event(file_event("moved", path, "downloads", clock(), dest_path=destination), clock())
    clock.advance(5)
    resident.step()
    assert len([name for name in ui.names() if name == "ui.mini_dock.show"]) == 1


def test_browser_record_is_used_at_once_and_a_user_button_runs_immediately(resident, config, platform, db, ui, clock):
    path = make_pdf(Path(config["DOWNLOADS_DIR"]) / "document.pdf", "研究室の議事録")
    message = {
        "type": "download_completed", "browser": "chrome",
        "download": {"id": 7, "filename": str(path), "url": "https://files.slack.com/files-pri/T0-F1/document.pdf",
                     "final_url": "https://files.slack.com/files-pri/T0-F1/document.pdf",
                     "referrer_url": "https://app.slack.com/", "mime": "application/pdf",
                     "started_at": T0 - 3, "ended_at": T0 - 1, "file_size": path.stat().st_size, "danger": "safe"},
        "page": {"tab_url": "https://app.slack.com/client/T0/C0", "tab_title": "会議 - Slack", "captured_at": T0 - 3},
    }
    provenance.store_download_event(db, message, "chrome-extension://pip0-test/", T0)

    resident.step()  # 拡張機能の記録を読み、大きさが報告どおりで使用中でないので、すぐに完了とみなす
    shown = ui.last("ui.mini_dock.show")
    row = shown["rows"][0]
    assert row["new_name"] == f"{timeutil.local_date_str(T0 - 1)}_研究室の議事録_Slack.pdf"
    assert row["dest_label"] == "会議・議事録"

    resident.handle_event(shell_event("ui.mini_dock.action", dock_id=shown["dock_id"], entry_id=row["entry_id"],
                                      action="accept", alternative_index=None), clock.advance(1.0))
    destination = Path(config["PIP0_ROOT"]) / "会議・議事録" / row["new_name"]
    assert destination.exists()
    operation = database.query_one(db, "SELECT * FROM operations WHERE kind = 'sort_rename'")
    assert operation["actor"] == "user"
    event = database.query_one(db, "SELECT state FROM download_events WHERE browser_download_id = 7")
    assert event["state"] == "matched"


def test_browser_record_from_before_start_records_the_source_but_does_not_move_the_file(
        resident, config, platform, db, ui, clock):
    path = make_pdf(Path(config["DOWNLOADS_DIR"]) / "document.pdf", "研究室の議事録")
    missing = Path(config["DOWNLOADS_DIR"]) / "moved-away.pdf"  # 記録の後に、ユーザーが動かしたファイル
    for download_id, filename, size in ((8, path, path.stat().st_size), (9, missing, 100)):
        message = {
            "type": "download_completed", "browser": "chrome",
            "download": {"id": download_id, "filename": str(filename),
                         "url": "https://files.slack.com/files-pri/T0-F1/document.pdf", "final_url": None,
                         "referrer_url": "https://app.slack.com/", "mime": "application/pdf",
                         "started_at": T0 - 3603, "ended_at": T0 - 3601, "file_size": size, "danger": "safe"},
            "page": {"tab_url": None, "tab_title": None, "captured_at": None},
        }
        # pip0 が動いていなかった1時間前に、受け口が書いた記録
        provenance.store_download_event(db, message, "chrome-extension://pip0-test/", T0 - 3600)

    for _ in range(3):
        resident.step(clock.advance(5))

    assert "ui.mini_dock.show" not in ui.names()  # 提案は出さない
    assert path.exists()  # ファイルは動かさない
    assert database.query_one(db, "SELECT COUNT(*) AS n FROM inflow")["n"] == 0
    states = {row["browser_download_id"]: row["state"]
              for row in database.query_all(db, "SELECT browser_download_id, state FROM download_events")}
    assert states == {8: "matched", 9: "pending"}  # ファイルがない記録は、そのまま（24時間で期限切れ）
    file_row = database.query_one(db, "SELECT id FROM files WHERE name = 'document.pdf'")
    assert provenance.get_provenance(db, file_row["id"])["source_label"] == "Slack"


def test_hovering_the_mini_dock_pauses_the_countdown(resident, config, platform, db, ui, clock):
    path = make_pdf(Path(config["DOWNLOADS_DIR"]) / "download.pdf", "2026年度 予算案")
    finish_download(resident, path, clock)
    shown = ui.last("ui.mini_dock.show")
    resident.handle_event(shell_event("ui.mini_dock.interaction", dock_id=shown["dock_id"], state="enter"),
                          clock.advance(1.0))
    clock.advance(30)
    resident.step()
    assert path.exists()  # マウスが上にある間は、時間切れにしない
    resident.handle_event(shell_event("ui.mini_dock.interaction", dock_id=shown["dock_id"], state="leave"), clock())
    clock.advance(2.1)
    resident.step()
    assert not path.exists()


def test_kill_switch_stops_the_automatic_sorting_of_a_shown_download(resident, config, platform, db, ui, clock):
    path = make_pdf(Path(config["DOWNLOADS_DIR"]) / "download.pdf", "2026年度 予算案")
    finish_download(resident, path, clock)
    assert ui.last("ui.mini_dock.show") is not None
    resident.handle_event(shell_event("tray.command", command="kill_switch"), clock())
    clock.advance(3.5)
    resident.step()
    assert path.exists()  # キルスイッチの後は、時間が過ぎても自動では移動しない
    skipped = database.query_one(db, "SELECT * FROM operations WHERE kind = 'sort_rename'")
    assert skipped["status"] == "skipped"


# ---------------------------------------------------------------------- 高負荷の処理（電源接続中かつ3分間無操作）


def test_heavy_analysis_runs_only_on_ac_power_after_three_idle_minutes_and_pauses_when_used(
        resident, config, platform, db, clock):
    text = "2026年度の予算の報告書です。\n" * 3000  # 区切り（4KB）がたくさんあるファイル
    path = make_file(Path(config["PIP0_ROOT"]) / "報告書.txt", text=text)
    resident.step()  # 見直しで索引に入り、解析の順番待ちに入る
    row = database.query_one(db, "SELECT id FROM files WHERE path = ?", (str(path),))

    def analysis_status():
        return database.query_one(db, "SELECT status FROM analysis WHERE file_id = ?", (row["id"],))["status"]

    for power, idle in [("ac", 179), ("battery", 600), ("unknown", 600), ("ac", None)]:
        platform.power = power
        platform.idle_seconds = idle
        clock.advance(config["THROTTLE_CHECK_SECONDS"] + 1)
        resident.step()
        assert analysis_status() == "pending", (power, idle)

    # 電源接続中・180秒無操作になった。ただし、ハッシュの途中でユーザーが操作を始める
    platform.power = "ac"
    platform.idle_seconds = 180
    real_open = platform.open_for_analysis

    def user_comes_back():
        platform.idle_seconds = 3
        clock.advance(1.0)  # 条件を確かめ直す間隔（0.5秒）を過ぎる

    platform.open_for_analysis = lambda p: InterruptingReader(real_open(p), 3, user_comes_back)
    clock.advance(config["THROTTLE_CHECK_SECONDS"] + 1)
    resident.step()
    assert analysis_status() == "pending"  # 一時停止：結果を保存しない
    task = database.query_one(db, "SELECT state FROM tasks WHERE file_id = ? AND kind = 'analyse'", (row["id"],))
    assert task["state"] == "queued"  # 順番待ちに戻り、次はこのファイルの最初から

    platform.open_for_analysis = real_open
    platform.idle_seconds = 600
    clock.advance(config["THROTTLE_CHECK_SECONDS"] + 1)
    resident.step()
    analysis = database.query_one(db, "SELECT * FROM analysis WHERE file_id = ?", (row["id"],))
    assert analysis["status"] == "done"
    assert analysis["sha256"] == sha256_of(path)
    assert resident.build_status(clock())["throttle"]["allowed"] is True


def test_locked_file_analysis_is_retried_at_the_next_scan(resident, config, platform, db, clock):
    path = make_file(Path(config["PIP0_ROOT"]) / "使用中.txt", text="予算\n" * 100)
    resident.step()
    real_open = platform.open_for_analysis

    def locked(p):
        raise PermissionError("使用中")

    platform.open_for_analysis = locked
    platform.idle_seconds = 600
    clock.advance(config["THROTTLE_CHECK_SECONDS"] + 1)
    resident.step()
    file_id = database.query_one(db, "SELECT id FROM files WHERE path = ?", (str(path),))["id"]
    task = database.query_one(db, "SELECT state FROM tasks WHERE file_id = ?", (file_id,))
    assert task["state"] == "failed"
    platform.open_for_analysis = real_open
    clock.advance(config["SCAN_MINUTES"] * 60 + 1)
    resident.step()  # 見直し：待ちに戻す
    clock.advance(1)
    resident.step()  # 解析する
    assert database.query_one(db, "SELECT status FROM analysis WHERE file_id = ?", (file_id,))["status"] == "done"


# ---------------------------------------------------------------------- M2 浮上式デスクとシェイク


def shake_samples(start_ms):
    """左右に素早く振る（120〜200px の振りを4回折り返す）マウスの位置の列"""
    samples = []
    t = start_ms
    x = 500
    for target in [620, 420, 620, 420, 620]:
        while x != target:
            x += 40 if target > x else -40
            t += 33
            samples.append([t, x, 300])
    return samples


def slack_foreground(at):
    return shell_event("context.foreground", hwnd=101, process_name="slack.exe",
                       window_title="予算2026 (Channel) - 研究室 - Slack", window_class="Chrome_WidgetWin_1",
                       is_file_dialog=False, dialog_rect=None, inaccessible=False, reason=None, at=at)


def test_slack_context_shows_at_most_three_files_and_a_shake_hides_the_desk(resident, config, db, ui, clock):
    root = Path(config["PIP0_ROOT"])
    for name in ["予算2026_案A.txt", "予算2026_案B.txt", "予算_メモ.txt", "予算_比較.txt", "議事録.txt"]:
        make_file(root / name, text="メモ\n")
    resident.step()

    resident.handle_event(slack_foreground(clock()), clock())
    desk_payload = ui.last("ui.desk.show")
    assert 1 <= len(desk_payload["items"]) <= 3
    assert all("予算" in item["name"] for item in desk_payload["items"])
    assert desk_payload["partner_label"] == "チャット相手：予算2026（チャンネル）"
    assert ui.last("shell.cursor_stream") == {"enabled": True}

    resident.handle_event(shell_event("input.cursor_batch", samples=shake_samples(int(clock() * 1000))),
                          clock.advance(0.5))
    assert ui.last("ui.desk.hide") == {"reason": "shake"}
    assert ui.last("shell.cursor_stream") == {"enabled": False}

    # シェイクの後は、文脈が変わり、かつ60秒たつまで出さない。通知領域の「デスクを表示」では、すぐに出す
    shows = ui.names().count("ui.desk.show")
    resident.handle_event(slack_foreground(clock()), clock.advance(1))
    assert ui.names().count("ui.desk.show") == shows
    resident.handle_event(shell_event("tray.command", command="show_desk"), clock.advance(1))
    assert ui.names().count("ui.desk.show") == shows + 1


def test_desk_buttons_only_act_on_shown_files(config, platform, db, ui, clock):
    link = FakeLink()
    svc = make_service(config, platform, db, ui, clock, link=link)
    assert svc.start()["ok"]
    try:
        make_file(Path(config["PIP0_ROOT"]) / "予算2026_案A.txt", text="メモ\n")
        svc.step()
        svc.handle_event(slack_foreground(clock()), clock())
        desk_payload = ui.last("ui.desk.show")
        shown_path = desk_payload["items"][0]["path"]
        svc.handle_event(shell_event("ui.desk.action", desk_id=desk_payload["desk_id"], action="open",
                                     path=shown_path, dialog_hwnd=None), clock.advance(1))
        assert ("shell.open_file", {"path": shown_path}) in link.requests
        file_id = database.query_one(db, "SELECT id FROM files WHERE path = ?", (shown_path,))["id"]
        assert database.query_one(db, "SELECT kind FROM usage_events WHERE file_id = ?", (file_id,))["kind"] \
            == "user_action"
        # 出していないパスの操作は、シェルに頼まない
        before = len(link.requests)
        svc.handle_event(shell_event("ui.desk.action", desk_id=desk_payload["desk_id"], action="open",
                                     path=str(Path(config["PIP0_ROOT"]) / "別のファイル.exe"), dialog_hwnd=None),
                         clock.advance(1))
        assert len(link.requests) == before
    finally:
        svc.shutdown()


# ---------------------------------------------------------------------- M5 ドラッグの警告と消音


def drag_started(drag_id, paths, at, status="ok"):
    return shell_event("drag.started", drag_id=drag_id, source_process="explorer.exe", source="explorer",
                       items=[str(path) for path in paths], items_status=status, unidentified_count=0,
                       reason=None, at=at)


def test_sensitive_drag_warns_a_continued_drop_mutes_the_pair_and_a_lock_clears_it(resident, config, platform,
                                                                                    ui, clock):
    secret = make_file(Path(config["PIP0_ROOT"]) / "社外秘_計画.txt", text="計画\n")
    resident.step()

    def shows():
        return ui.names().count("ui.hazard.show")

    resident.handle_event(drag_started("a" * 32, [secret], clock()), clock())
    assert shows() == 1 and ui.last("ui.hazard.show")["level"] == "sensitive"
    resident.handle_event(shell_event("drag.target_changed", drag_id="a" * 32, target_process="slack.exe"),
                          clock.advance(0.6))
    resident.handle_event(shell_event("drag.ended", drag_id="a" * 32, target_process="slack.exe",
                                      dropped_on_other_process=True, reason=None), clock.advance(0.4))
    assert ui.names()[-1] == "ui.hazard.hide"
    key = platform.get_file_key(str(secret))
    assert resident.hazard_session.muted_pairs() == [(key, "slack.exe")]

    # 同じファイル × 同じアプリは警告しない。別のアプリの上では警告する
    resident.handle_event(drag_started("b" * 32, [secret], clock()), clock.advance(5))
    resident.handle_event(shell_event("drag.target_changed", drag_id="b" * 32, target_process="slack.exe"),
                          clock.advance(0.3))
    assert shows() == 1
    resident.handle_event(shell_event("drag.target_changed", drag_id="b" * 32, target_process="outlook.exe"),
                          clock.advance(0.3))
    assert shows() == 2
    # ボタンを離したことを確かめられなかった（reason がある）ドロップは、続行とみなさない
    resident.handle_event(shell_event("drag.ended", drag_id="b" * 32, target_process=None,
                                      dropped_on_other_process=False,
                                      reason="ボタンを離したことを確かめられませんでした"),
                          clock.advance(1.0))
    assert resident.hazard_session.muted_pairs() == [(key, "slack.exe")]
    # 送り先が分かっていても、理由（確かめられなかった）が付いた終わり方は、続行とみなさない
    resident.handle_event(drag_started("e" * 32, [secret], clock()), clock.advance(1))
    resident.handle_event(shell_event("drag.target_changed", drag_id="e" * 32, target_process="outlook.exe"),
                          clock.advance(0.3))
    resident.handle_event(shell_event("drag.ended", drag_id="e" * 32, target_process="outlook.exe",
                                      dropped_on_other_process=True,
                                      reason="フックを入れ直したため、確かめられませんでした"),
                          clock.advance(1.0))
    assert resident.hazard_session.muted_pairs() == [(key, "slack.exe")]
    assert shows() == 3  # outlook.exe の上に来たときに出した

    # 画面のロックでセッションが終わり、消音が消える
    resident.handle_event(shell_event("session.event", kind="lock"), clock.advance(1))
    assert resident.hazard_session.muted_pairs() == []
    resident.handle_event(drag_started("c" * 32, [secret], clock()), clock.advance(1))
    assert shows() == 4

    # ファイルを特定できないドラッグは、判定できないので警告しない
    resident.handle_event(drag_started("d" * 32, [], clock(), status="unavailable"), clock.advance(1))
    assert shows() == 4


# ---------------------------------------------------------------------- キルスイッチ（1クリック全復元）


def test_kill_switch_stops_an_evacuation_in_progress_restores_every_ghost_and_never_resumes_by_itself(
        resident, config, platform, db, ui, clock):
    root = Path(config["PIP0_ROOT"])
    ghosts = {}
    for name in ["退避済み1.pdf", "退避済み2.docx"]:
        path = make_file(root / name, size=12_000, mtime=OLD_MTIME)
        ghosts[path] = sha256_of(path)
        evacuated(db, platform, config, path)
    video = make_file(root / "大きな動画.mp4", size=200_000, mtime=OLD_MTIME)  # 4KB ごとに区切って49回
    video_hash = sha256_of(video)
    resident.step()  # 見直し（観測の始まり）
    resident.handle_event(shell_event("usage.recent_items", tracking_enabled=True, items=[]), clock())

    # 91日後、電源接続中・無操作。動画は長期間未読なので、自動退避の候補になる
    clock.advance(91 * DAY)
    platform.idle_seconds = 600
    real_open = platform.open_for_copy
    pressed = []

    def press_kill_switch():
        pressed.append(True)
        # 通知領域の「全復元」が押された（シェルの読み取りのスレッドから届く知らせ）
        resident.receive_event(shell_event("tray.command", command="kill_switch"))

    platform.open_for_copy = lambda p: InterruptingReader(real_open(p), 3, press_kill_switch)
    for _ in range(5):
        clock.advance(1)
        resident.step()
        if pressed:
            break
    assert pressed, "退避が始まりませんでした"
    item = database.query_one(db, "SELECT * FROM vault_items WHERE current_path = ?", (str(video),))
    assert item["state"] == "failed"  # コピーの途中（次の区切り）で止まった。原本はそのまま
    assert sha256_of(video) == video_hash and str(video) not in platform.ghosts

    platform.open_for_copy = real_open
    clock.advance(1)
    resident.step()  # 知らせを受けて停止の印を書き、全復元する
    assert killswitch.is_engaged(db, config)
    assert platform.ghosts == {}
    for path, digest in ghosts.items():
        assert sha256_of(path) == digest
    states = sorted(row["state"] for row in vault.list_items(db))
    assert states == ["cancelled", "restored", "restored"]
    progress = killswitch.read_progress(config)
    assert (progress["finished"], progress["restored"], progress["failed"]) == (True, 2, 0)
    notices = [payload["title"] for name, payload in ui.calls if name == "ui.notify"]
    assert "全復元を始めます" in notices and "全復元が終わりました" in notices
    statuses = [payload for name, payload in ui.calls if name == "ui.status"]
    assert any(status["restore"].get("remaining") == 1 for status in statuses)  # 1件ごとの進み具合
    assert statuses[-1]["automation"] == "stopped"

    # 勝手に再開しない：時間がたっても、新しいファイルがあっても、解析も退避も始めない
    calls_before = list(platform.calls)
    new_file = make_file(root / "新しい予算.txt", text="予算\n")
    clock.advance(7 * 3600)
    resident.step()
    clock.advance(10)
    resident.step()
    new_id = database.query_one(db, "SELECT id FROM files WHERE path = ?", (str(new_file),))["id"]
    assert database.query_one(db, "SELECT status FROM analysis WHERE file_id = ?", (new_id,))["status"] == "pending"
    assert [call for call in platform.calls if call[0] == "make_ghost"] == \
           [call for call in calls_before if call[0] == "make_ghost"]
    assert killswitch.is_engaged(db, config)

    # 確認のない「再開」は受け付けない。確認された再開だけで、自動処理が動き出す
    resident.handle_event(shell_event("tray.command", command="resume"), clock.advance(1))
    assert killswitch.is_engaged(db, config)
    assert ui.last("ui.notify")["title"] == "自動処理は止まったままです"
    resident.handle_event(shell_event("tray.command", command="resume", confirmed=True), clock.advance(1))
    assert not killswitch.is_engaged(db, config)
    clock.advance(config["THROTTLE_CHECK_SECONDS"] + 1)
    for _ in range(5):  # 1回の step で1件ずつ解析する（戻したファイルも、解析の順番待ちに入っている）
        resident.step()
        clock.advance(1)
    assert database.query_one(db, "SELECT status FROM analysis WHERE file_id = ?", (new_id,))["status"] == "done"


def test_recently_read_file_is_not_evacuated_when_access_times_are_reliable(resident, config, platform, db, clock):
    root = Path(config["PIP0_ROOT"])
    read_recently = make_file(root / "最近読んだ資料.pdf", size=12_000, mtime=OLD_MTIME)
    untouched = make_file(root / "読んでいない資料.pdf", size=12_000, mtime=OLD_MTIME)
    platform.idle_seconds = 600
    for _ in range(4):  # 見直しと、2つのファイルの解析（解析の読み取りの後で、最終アクセス日時を決める）
        clock.advance(config["THROTTLE_CHECK_SECONDS"] + 1)
        resident.step()
    assert analysis_queue.pending_count(db, "analyse") == 0

    clock.advance(91 * DAY)
    os.utime(read_recently, (clock() - DAY, OLD_MTIME))  # 1日前に読まれた（変更はしていない）
    os.utime(untouched, (OLD_MTIME, OLD_MTIME))
    platform.access_time_reliable_value = True  # 「最近使ったファイル」は分からないが、最終アクセス日時は信頼できる
    for _ in range(4):
        clock.advance(1)
        resident.step()
    assert str(untouched) in platform.ghosts
    assert str(read_recently) not in platform.ghosts
    recorded = database.query_one(db, "SELECT u.at FROM usage_events AS u JOIN files AS f ON f.id = u.file_id "
                                      "WHERE f.path = ? AND u.kind = 'access_time'", (str(read_recently),))
    assert recorded["at"] == pytest.approx(clock() - 4 - DAY, abs=2)


def test_restore_request_file_from_the_command_line_is_handled(resident, config, platform, db, clock):
    path = make_file(Path(config["PIP0_ROOT"]) / "退避済み.pdf", size=12_000, mtime=OLD_MTIME)
    digest = sha256_of(path)
    evacuated(db, platform, config, path)
    assert killswitch.request_restore_all(config)["ok"]
    clock.advance(service.CONTROL_POLL_SECONDS + 0.1)
    resident.step()
    assert platform.ghosts == {} and sha256_of(path) == digest
    assert killswitch.take_restore_request(config) is None  # 依頼は受け取り済み
    assert killswitch.read_progress(config)["finished"] is True
    assert killswitch.is_engaged(db, config)


def test_unfinished_restore_continues_at_start(config, platform, db, ui, clock):
    path = make_file(Path(config["PIP0_ROOT"]) / "退避済み.pdf", size=12_000, mtime=OLD_MTIME)
    evacuated(db, platform, config, path)
    killswitch.restore_all(db, platform, config, should_stop=lambda: True, now=T0)  # すぐ止めた（途中）
    assert killswitch.read_progress(config)["finished"] is False
    svc = make_service(config, platform, db, ui, clock)
    assert svc.start()["ok"]
    try:
        svc.step()
        assert platform.ghosts == {}
        assert killswitch.read_progress(config)["finished"] is True
    finally:
        svc.shutdown()


def test_stop_from_the_command_line_stops_heavy_work_without_restoring(resident, config, platform, db, ui, clock):
    path = make_file(Path(config["PIP0_ROOT"]) / "退避済み.pdf", size=12_000, mtime=OLD_MTIME)
    evacuated(db, platform, config, path)
    killswitch.engage(None, config, "テスト（python -m pip0 stop）")
    clock.advance(service.CONTROL_POLL_SECONDS + 0.1)
    resident.step()
    assert resident.automation_engaged and resident.kill_event.is_set()
    assert str(path) in platform.ghosts  # stop は復元しない
    assert ui.last("ui.status")["automation"] == "stopped"


# ---------------------------------------------------------------------- 機能の状態（権限の不足など）


def test_failed_feature_is_shown_with_its_reason_and_other_features_keep_working(resident, config, db, ui, clock):
    reason = "低レベルのマウスフックを入れられませんでした（アクセスが拒否されました）"
    resident.handle_event(shell_event("feature.status", feature="mouse_hook", ok=False, reason=reason), clock())
    features = ui.last("ui.status")["features"]
    entry = next(feature for feature in features if feature["feature"] == "mouse_hook")
    assert (entry["ok"], entry["reason"], entry["label"]) == (False, reason, "ドラッグの検知")
    resident.step()
    notice = ui.last("ui.notify")
    assert notice["level"] == "warning" and reason in notice["message"]
    recorded = service.read_status_file(config)
    assert any(f["feature"] == "mouse_hook" and f["ok"] is False for f in recorded["features"])

    # ほかの機能（M2 のデスク）は動き続ける
    make_file(Path(config["PIP0_ROOT"]) / "予算2026_案A.txt", text="メモ\n")
    clock.advance(config["SCAN_MINUTES"] * 60 + 1)
    resident.step()
    resident.handle_event(slack_foreground(clock()), clock())
    assert ui.last("ui.desk.show")["items"]


def test_sync_root_failure_is_reported_and_downloads_are_still_sorted(config, platform, db, ui, clock):
    platform.filesystems[str(config["PIP0_ROOT"])] = "exFAT"
    svc = make_service(config, platform, db, ui, clock)
    assert svc.start()["ok"]
    try:
        entry = svc.features["sync_root"]
        assert entry["ok"] is False and "exFAT" in entry["reason"]
        path = make_pdf(Path(config["DOWNLOADS_DIR"]) / "download.pdf", "2026年度 予算案")
        finish_download(svc, path, clock)
        clock.advance(3.1)
        svc.step()
        assert not path.exists()
        assert list((Path(config["PIP0_ROOT"]) / "予算・会計").iterdir())
    finally:
        svc.shutdown()


# ---------------------------------------------------------------------- pip0 シェル（起動、init、起動し直し）


def test_shell_is_initialised_registered_and_restarted_with_the_mini_dock_resent(config, platform, db, ui, clock):
    link = FakeLink()
    svc = make_service(config, platform, db, ui, clock, link=link)
    assert link.on_event == svc.receive_event
    assert svc.start()["ok"]
    try:
        init = link.requests[0]
        assert init[0] == "init"
        payload = init[1]
        assert payload["protocol"] == 1 and payload["headless"] is False
        assert payload["pip0_root"] == str(config["PIP0_ROOT"])
        assert payload["watched_roots"] == [str(config["DOWNLOADS_DIR"]), str(config["PIP0_ROOT"])]
        assert payload["settings"]["mini_dock_max_rows"] == config["MINI_DOCK_MAX_ROWS"]
        assert svc.features["shell"]["ok"] and svc.features["sync_root"]["ok"]
        assert ("register_sync_root", str(config["PIP0_ROOT"])) in platform.calls

        path = make_pdf(Path(config["DOWNLOADS_DIR"]) / "download.pdf", "2026年度 予算案")
        finish_download(svc, path, clock)
        dock_id = ui.last("ui.mini_dock.show")["dock_id"]

        # シェルが落ちた（pip0 が止めたのではない）：本体は動き続け、しばらく後に起動し直す
        link.alive = False
        svc.receive_event(shell_event("shell.exited", returncode=1, requested_stop=False))
        svc.step()
        assert svc.features["shell"]["ok"] is False and "終了コード 1" in svc.features["shell"]["reason"]
        shows = ui.names().count("ui.mini_dock.show")
        clock.advance(service.SHELL_RESTART_DELAYS[0] + 0.1)
        svc.step()
        assert link.starts == 2 and link.request_types().count("init") == 2
        assert svc.features["shell"]["ok"] is True
        assert ui.names().count("ui.mini_dock.show") > shows  # 表示中のミニドックを送り直す
        assert ui.last("ui.mini_dock.show")["dock_id"] == dock_id
    finally:
        svc.shutdown()
    assert link.stops == 1


def test_downloads_wait_while_the_shell_is_down_so_nothing_moves_unseen(config, platform, db, ui, clock):
    link = FakeLink()
    svc = make_service(config, platform, db, ui, clock, link=link)
    assert svc.start()["ok"]
    try:
        link.alive = False
        svc.receive_event(shell_event("shell.exited", returncode=1, requested_stop=False))
        path = make_pdf(Path(config["DOWNLOADS_DIR"]) / "download.pdf", "2026年度 予算案")
        link.start_ok = False  # 起動し直しにも失敗する
        finish_download(svc, path, clock)
        clock.advance(10)
        svc.step()
        assert "ui.mini_dock.show" not in ui.names()
        assert path.exists()  # ミニドックが見えない間は、自動で動かさない
        link.start_ok = True
        clock.advance(service.SHELL_RESTART_DELAYS[-1])
        svc.step()  # シェルが戻ったので、提案を出す
        assert ui.last("ui.mini_dock.show")["rows"][0]["file_name"] == "download.pdf"
        clock.advance(3.1)
        svc.step()
        assert not path.exists()
    finally:
        svc.shutdown()


def test_no_evacuation_is_started_when_the_sync_root_cannot_be_used(config, platform, db, ui, clock):
    platform.fail_next["register_sync_root"] = {"ok": False, "reason": "テスト：同期ルートにつなげません"}
    svc = make_service(config, platform, db, ui, clock)
    assert svc.start()["ok"]
    try:
        assert svc.features["sync_root"]["ok"] is False
        old = make_file(Path(config["PIP0_ROOT"]) / "長い間使っていない動画.mp4", size=50_000, mtime=OLD_MTIME)
        svc.step()
        svc.handle_event(shell_event("usage.recent_items", tracking_enabled=True, items=[]), clock())
        clock.advance(91 * DAY)
        platform.idle_seconds = 600
        for _ in range(4):
            clock.advance(1)
            svc.step()
        assert vault.list_items(db) == []  # 保管庫へコピーもしない
        assert old.exists() and str(old) not in platform.ghosts
    finally:
        svc.shutdown()


def test_shell_that_cannot_start_is_reported_and_retried_with_backoff(config, platform, db, ui, clock):
    link = FakeLink(start_ok=False)
    svc = make_service(config, platform, db, ui, clock, link=link)
    assert svc.start()["ok"]  # シェルがなくても、本体は起動する
    try:
        assert svc.features["shell"]["ok"] is False and "起動できませんでした" in svc.features["shell"]["reason"]
        svc.step()
        clock.advance(service.SHELL_RESTART_DELAYS[0] + 0.1)
        svc.step()
        clock.advance(service.SHELL_RESTART_DELAYS[1] - 1)
        svc.step()
        assert link.starts == 2  # 2回目の失敗の後は、もっと長く待つ
        clock.advance(2)
        svc.step()
        assert link.starts == 3
    finally:
        svc.shutdown()


def test_no_shell_mode_never_restarts_and_reports_why(config, platform, db, ui, clock):
    svc = make_service(config, platform, db, ui, clock, link=service.NoShellLink())
    assert svc.start()["ok"]
    try:
        assert svc.features["shell"]["reason"] == service.NO_SHELL_REASON
        clock.advance(120)
        svc.step()
        assert svc.shell_restart_at is None
    finally:
        svc.shutdown()


def test_no_shell_mode_never_sorts_downloads_it_cannot_show(config, platform, db, ui, clock):
    svc = make_service(config, platform, db, ui, clock, link=service.NoShellLink())
    assert svc.start()["ok"]
    try:
        path = make_pdf(Path(config["DOWNLOADS_DIR"]) / "download.pdf", "2026年度 予算案")
        platform.zone_identifiers[str(path)] = SLACK_ZONE
        finish_download(svc, path, clock)
        for _ in range(3):
            svc.step(clock.advance(5))  # ミニドックがあれば、時間切れで自動の仕分けが動くころ
        assert path.exists()  # ミニドックを見せられないので、ファイルを動かさない
        assert database.query_one(db, "SELECT COUNT(*) AS n FROM inflow")["n"] == 0
        file_row = database.query_one(db, "SELECT id FROM files WHERE name = 'download.pdf'")
        assert provenance.get_provenance(db, file_row["id"])["source_label"] == "Slack"  # 由来だけは記録する
    finally:
        svc.shutdown()


# ---------------------------------------------------------------------- 1つだけ動かす・終了の依頼


def test_second_instance_is_refused_and_the_lock_is_released_at_shutdown(config, platform, db, ui, clock):
    first = make_service(config, platform, db, ui, clock)
    assert first.start()["ok"]
    assert service.is_running(config) is True
    second = make_service(config, platform, db, RecordingUi(), clock)
    assert second.start() == {"ok": False, "reason": service.ALREADY_RUNNING_REASON}
    first.shutdown()
    assert service.is_running(config) is False
    assert service.read_status_file(config)["running"] is False


def test_shutdown_request_stops_only_a_service_started_before_it(config, platform, db, ui, clock):
    service.request_shutdown(config, now=time.time() - 3600)  # 前の常駐処理への、古い依頼
    svc = make_service(config, platform, db, ui, clock)
    assert svc.start()["ok"]
    try:
        clock.advance(2)
        svc.step()
        assert not svc.stop_event.is_set()
        assert service.request_shutdown(config)["ok"]
        clock.advance(2)
        svc.step()
        assert svc.stop_event.is_set()
    finally:
        svc.shutdown()


def test_tray_quit_stops_the_loop(resident, clock):
    resident.receive_event(shell_event("tray.command", command="quit"))
    assert resident.stop_event.is_set()  # ワーカーの処理も、次の区切りで止まる
    resident.step()
    assert resident.stop_reason == "通知領域の「終了」"


def test_config_errors_refuse_to_start(config, platform, db, ui, clock):
    problem = "保管庫（VAULT_DIR）を pip0 専用フォルダー（PIP0_ROOT）の中に置くことはできません。"
    bad = dict(config, CONFIG_ERRORS=[problem])
    result = make_service(bad, platform, db, ui, clock).start()
    assert result["ok"] is False and "保管庫" in result["reason"]
    assert service.is_running(config) is False


# ---------------------------------------------------------------------- M4 ゴーストの知らせ（cf.*）


def test_ghost_events_record_use_restore_after_opening_and_track_rename_and_delete(resident, config, platform, db,
                                                                                   ui, clock):
    root = Path(config["PIP0_ROOT"])
    opened = make_file(root / "開くファイル.pdf", size=12_000, mtime=OLD_MTIME)
    renamed = make_file(root / "名前を変えるファイル.pdf", size=12_000, mtime=OLD_MTIME)
    deleted = make_file(root / "消すファイル.pdf", size=12_000, mtime=OLD_MTIME)
    resident.step()  # 索引に入れる（退避の項目が索引の行を持つように）
    ids = {path: evacuated(db, platform, config, path) for path in [opened, renamed, deleted]}
    digest = sha256_of(opened) if str(opened) not in platform.ghosts else None

    # アプリが開いた：中身が戻り、利用として記録し、応答時間を覚える。pip0 自身の読み取りは数えない
    platform.simulate_app_open(str(opened))
    resident.handle_event(shell_event("cf.fetch", item_id=ids[opened], path=str(opened), process_name="AcroRd32.exe",
                                      process_id=10, by_pip0=False, result="served", reason="", elapsed_ms=42),
                          clock())
    resident.handle_event(shell_event("cf.fetch", item_id=ids[opened], path=str(opened), process_name="Pip0Shell.exe",
                                      process_id=11, by_pip0=True, result="served", reason="", elapsed_ms=7), clock())
    uses = database.query_all(db, "SELECT kind, process_name FROM usage_events WHERE kind = 'ghost_open'")
    assert uses == [{"kind": "ghost_open", "process_name": "AcroRd32.exe"}]
    assert resident.build_status(clock())["ghost_open"]["count"] == 2

    # 中身がすべて戻った：RESTORE_AFTER_OPEN_SECONDS 後に、通常のファイルへ戻す
    resident.handle_event(shell_event("cf.hydrated", item_id=ids[opened], path=str(opened), by_pip0=False), clock())
    clock.advance(config["RESTORE_AFTER_OPEN_SECONDS"] - 1)
    resident.step()
    assert str(opened) in platform.ghosts
    clock.advance(2)
    resident.step()
    assert str(opened) not in platform.ghosts
    assert vault.read_manifest(config, ids[opened])["state"] == "restored"
    assert digest is None or sha256_of(opened) == digest

    # 名前が変わった：保管庫の項目の今の場所を書き直す
    new_path = root / "新しい名前.pdf"
    platform.simulate_user_rename(str(renamed), str(new_path))
    resident.handle_event(shell_event("cf.notify_rename", item_id=ids[renamed], old_path=str(renamed),
                                      new_path=str(new_path), inside_root=True), clock())
    assert vault.read_manifest(config, ids[renamed])["current_path"] == str(new_path)

    # 削除された：少し待って確かめ、ゴーストなし（中身は保管庫に残る）にする
    platform.simulate_user_delete(str(deleted))
    resident.handle_event(shell_event("cf.notify_delete", item_id=ids[deleted], path=str(deleted)), clock())
    clock.advance(service.NOTIFY_DELETE_CHECK_SECONDS + 0.1)
    resident.step()
    manifest = vault.read_manifest(config, ids[deleted])
    assert manifest["state"] == "ghost_missing"
    assert vault.content_path(config, ids[deleted]).exists()
    assert ui.last("ui.notify")["title"] == "退避したファイルのゴーストが削除されました"

    # 形の正しくない項目ID は無視する
    resident.handle_event(shell_event("cf.hydrated", item_id="../../etc", path="x", by_pip0=False), clock())
    assert "../../etc" not in resident.reopened


def test_status_has_no_paths_or_window_titles(resident, config, ui, clock):
    make_file(Path(config["PIP0_ROOT"]) / "予算2026_秘密の名前.txt", text="メモ\n")
    resident.step()
    resident.handle_event(slack_foreground(clock()), clock())
    resident.update_status(clock.advance(5), force=True)
    text = json.dumps(service.read_status_file(config), ensure_ascii=False)
    for secret in ["秘密の名前", str(config["PIP0_ROOT"]), "予算2026 (Channel)", "研究室"]:
        assert secret not in text


def test_logs_have_no_file_names_or_titles(resident, config, platform, ui, clock, caplog):
    caplog.set_level("DEBUG", logger="pip0")
    path = make_pdf(Path(config["DOWNLOADS_DIR"]) / "download (9).pdf", "秘密の題名の予算")
    finish_download(resident, path, clock)
    resident.handle_event(slack_foreground(clock()), clock())
    clock.advance(3.5)
    resident.step()
    for record in caplog.records:
        message = record.getMessage()
        for secret in ["download (9)", "秘密の題名", "予算2026", str(config["DOWNLOADS_DIR"])]:
            assert secret not in message


# ---------------------------------------------------------------------- 本物のスレッドとフォルダーの監視（短く通す）


def test_threads_watch_folders_analyse_in_the_worker_and_stop_cleanly(config, platform, db, key_store, ui):
    platform.idle_seconds = 600  # 電源接続中・無操作（代役）
    svc = service.Service(config, rules, platform, ui, db, clock=time.time, start_threads=True, keystore=key_store)
    assert svc.start()["ok"]
    try:
        svc.step()  # 最初の見直し
        path = make_file(Path(config["PIP0_ROOT"]) / "監視で見つけるファイル.txt", text="予算の報告\n" * 50)
        deadline = time.time() + 15
        done = False
        while time.time() < deadline and not done:
            svc.step()
            row = database.query_one(db, "SELECT a.status FROM files AS f JOIN analysis AS a ON a.file_id = f.id "
                                         "WHERE f.path = ?", (str(path),))
            done = row is not None and row["status"] == "done"
            time.sleep(0.05)
        assert done, "フォルダーの監視で見つけたファイルが、ワーカーで解析されませんでした"
        assert svc.features["folder_watcher"]["ok"] is True
    finally:
        svc.shutdown()
    assert not svc.worker.thread.is_alive()
    assert service.is_running(config) is False
    assert analysis_queue.pending_count(db, "analyse") == 0
