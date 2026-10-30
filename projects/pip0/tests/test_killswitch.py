"""キルスイッチ（killswitch.py）のテスト：停止、全復元、中断と再開、鍵をなくしたとき

OS 連携は代役（FakePlatform）です。ここで確かめたことは「代役での確認」で、Windows の実機での確認ではありません。
どのテストでも、最後に「テスト中に書いた manifest.json がすべて残っていること」と
「確かめたコピーがあるはずの項目の content が残っていること」を確かめます（vault_guard）。
"""

import hashlib
import json
import os
import threading
from pathlib import Path

import pytest

from pip0 import database, fsutil, keystore, killswitch, vault

NOW = 1_793_000_000.0
MTIME_NS = 1_700_000_000_123_456_789
ALL_RESTORED_3 = {"total": 3, "restored": 3, "conflict": 0, "local_newer": 0, "missing": 0, "failed": 0,
                  "already": 0, "remaining": 0, "finished": True}


# ---------------------------------------------------------------------- 準備


@pytest.fixture(autouse=True)
def vault_guard(monkeypatch, env):
    """仕様の確認 17：テスト中に書いた manifest.json が最後まで残り、確かめた content も残っていること"""
    written = []
    real_write = fsutil.atomic_write_json

    def recording_write(path, value):
        if Path(path).name == "manifest.json":
            written.append(Path(path))
        return real_write(path, value)

    monkeypatch.setattr(fsutil, "atomic_write_json", recording_write)
    yield written
    for path in written:
        assert path.exists(), "テスト中に書いた manifest.json が消えています"
    items = Path(env["VAULT_DIR"]) / "items"
    for folder in items.iterdir() if items.exists() else []:
        if not vault.is_valid_item_id(folder.name) or not (folder / "manifest.json").exists():
            continue
        manifest = fsutil.read_json(folder / "manifest.json")
        if manifest["state"] in vault.STATES_WITH_CONTENT:
            assert sha256_of(folder / "content") == manifest["sha256"]


@pytest.fixture
def config(env):
    """小さな区切り（4KB）で、小さなファイルも退避できる設定"""
    return dict(env, HASH_CHUNK_BYTES=4096, EVACUATE_MIN_SIZE_BYTES=1024)


def make_file(path, size=20_000):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(bytes((i * 17 + len(path.name) * 13) % 251 for i in range(size)))
    os.utime(path, ns=(MTIME_NS, MTIME_NS))
    return path


def sha256_of(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def fingerprint(path):
    info = os.stat(path)
    return (sha256_of(path), info.st_size, info.st_mtime_ns)


def is_ghost(platform, path):
    return platform.ghost_status(str(path))["is_ghost"] is True


def evacuate(conn, platform, path, config, should_continue=None):
    return vault.evacuate(conn, platform, path, config, reasons=["長期間未読（テスト）"],
                          should_continue=should_continue or (lambda: True), actor="auto", now=NOW)


def evacuated_files(conn, platform, config, names):
    """names のファイルを作って退避し、{パス: (項目ID, 退避前の fingerprint)} を返す"""
    result = {}
    for name in names:
        path = make_file(Path(config["PIP0_ROOT"]) / name)
        before = fingerprint(path)
        outcome = evacuate(conn, platform, path, config)
        assert outcome["state"] == "evacuated"
        result[path] = (outcome["item_id"], before)
    return result


def marker_path(config):
    return Path(config["CONTROL_DIR"]) / "automation.stopped"


def operations(conn, kind):
    return database.query_all(conn, "SELECT * FROM operations WHERE kind = ? ORDER BY id", (kind,))


# ---------------------------------------------------------------------- 停止（engage）


def test_engage_without_database_writes_the_marker(config):
    result = killswitch.engage(None, config, "画面が動かないため", actor="user", now=NOW)
    assert result == {"ok": True, "marker": True, "database": False, "reason": ""}
    assert marker_path(config).name == killswitch.STOP_MARKER_NAME == "automation.stopped"
    assert fsutil.read_json(marker_path(config)) == {"at": NOW, "reason": "画面が動かないため", "actor": "user"}
    assert killswitch.is_engaged(None, config) is True


def test_engage_with_database_records_setting_and_operation(config, db):
    result = killswitch.engage(db, config, "テスト", now=NOW)
    assert result["ok"] and result["marker"] and result["database"]
    assert database.get_setting(db, "automation_enabled") == "0"
    rows = operations(db, "kill_switch")
    assert [(row["actor"], row["status"]) for row in rows] == [("user", "done")]
    # 印がなくなっても、DB の設定だけで「停止中」
    marker_path(config).unlink()
    assert killswitch.is_engaged(db, config) is True
    assert killswitch.is_engaged(None, config) is False


def test_engage_needs_some_place_to_write(config):
    no_place = dict(config, CONTROL_DIR=None)
    result = killswitch.engage(None, no_place, "テスト", now=NOW)
    assert result["ok"] is False and "データフォルダー" in result["reason"]
    assert killswitch.is_engaged(None, no_place) is False


def test_marker_that_cannot_be_checked_counts_as_stopped(config, tmp_path):
    not_a_folder = tmp_path / "control-is-a-file"
    not_a_folder.write_text("x")
    assert killswitch.is_engaged(None, dict(config, CONTROL_DIR=not_a_folder)) is True


def test_automatic_evacuation_is_refused_after_engage(config, platform, db):
    path = make_file(Path(config["PIP0_ROOT"]) / "資料.pdf")
    before = fingerprint(path)
    killswitch.engage(None, config, "テスト", now=NOW)
    result = evacuate(db, platform, path, config)
    assert result["ok"] is False and "キルスイッチ" in result["reason"]
    assert fingerprint(path) == before and not is_ghost(platform, path)


# ---------------------------------------------------------------------- 全復元（restore_all）


def test_restore_all_restores_every_ghost_and_reports_progress(config, platform, db):
    files = evacuated_files(db, platform, config, ["資料1.pdf", "資料2.xlsx", "写真.png"])
    killswitch.engage(db, config, "全復元", now=NOW)
    seen = []

    counts = killswitch.restore_all(db, platform, config, progress=seen.append, now=NOW + 10)

    assert counts == ALL_RESTORED_3
    assert [c["restored"] for c in seen] == [1, 2, 3]
    assert [c["remaining"] for c in seen] == [2, 1, 0]
    for path, (_item_id, before) in files.items():
        assert fingerprint(path) == before
        assert not is_ghost(platform, path)
    # 進み具合のファイルは件数（と時刻）だけで、パスや名前を含まない
    progress_file = Path(config["CONTROL_DIR"]) / "restore_all.progress.json"
    stored = json.loads(progress_file.read_text(encoding="utf-8"))
    assert set(stored) == set(counts) | {"updated_at"}
    assert {key: stored[key] for key in counts} == counts
    text = progress_file.read_text(encoding="utf-8")
    for path in files:
        assert path.stem not in text
    assert str(config["PIP0_ROOT"]) not in text
    assert killswitch.read_progress(config) == stored
    # 自動処理は止まったまま
    assert killswitch.is_engaged(db, config) is True
    assert [row["status"] for row in operations(db, "restore_all")] == ["done"]


def test_restore_all_can_be_interrupted_and_continued(config, platform, db):
    files = evacuated_files(db, platform, config, ["a.pdf", "b.pdf", "c.pdf"])
    killswitch.engage(db, config, "全復元", now=NOW)
    seen = []

    first = killswitch.restore_all(db, platform, config, progress=seen.append,
                                   should_stop=lambda: len(seen) >= 1, now=NOW + 10)
    assert (first["total"], first["restored"], first["remaining"], first["finished"]) == (3, 1, 2, False)
    assert killswitch.read_progress(config)["finished"] is False
    assert sum(is_ghost(platform, path) for path in files) == 2
    # 全復元が途中のあいだは、確認があっても自動処理を再開しない
    assert killswitch.resume(db, config, confirmed=True)["ok"] is False

    second = killswitch.restore_all(db, platform, config, now=NOW + 20)
    assert (second["total"], second["restored"], second["remaining"], second["finished"]) == (2, 2, 0, True)
    for path, (_item_id, before) in files.items():
        assert fingerprint(path) == before
    assert [row["status"] for row in operations(db, "restore_all")] == ["cancelled", "done"]


def test_resume_needs_explicit_confirmation(config, platform, db):
    evacuated_files(db, platform, config, ["a.pdf"])
    killswitch.engage(db, config, "全復元", now=NOW)
    killswitch.restore_all(db, platform, config, now=NOW + 10)

    for answer in (False, None, "yes", 1):
        refused = killswitch.resume(db, config, confirmed=answer, now=NOW + 20)
        assert refused["ok"] is False and "確認" in refused["reason"]
        assert killswitch.is_engaged(db, config) is True

    resumed = killswitch.resume(db, config, confirmed=True, now=NOW + 30)
    assert resumed == {"ok": True, "reason": ""}
    assert killswitch.is_engaged(db, config) is False
    assert not marker_path(config).exists()
    assert database.get_setting(db, "automation_enabled") == "1"
    assert [row["status"] for row in operations(db, "resume_automation")] == ["done"]


def test_resume_without_database_is_refused(config):
    killswitch.engage(None, config, "テスト", now=NOW)
    assert killswitch.resume(None, config, confirmed=True)["ok"] is False
    assert killswitch.is_engaged(None, config) is True


def test_restore_all_stops_automation_by_itself(config, platform, db):
    evacuated_files(db, platform, config, ["a.pdf"])
    assert killswitch.is_engaged(db, config) is False
    killswitch.restore_all(db, platform, config, now=NOW + 10)
    assert killswitch.is_engaged(db, config) is True
    assert [row["actor"] for row in operations(db, "kill_switch")] == ["kill_switch"]


def test_restore_all_records_the_stop_in_both_places(config, platform, db):
    # 依頼（停止の印だけ）から始まった全復元でも、DB にも停止を記録する。
    # 印のファイルが消されても、確認なしでは自動処理が動き出さない
    evacuated_files(db, platform, config, ["a.pdf"])
    killswitch.request_restore_all(config, now=NOW)
    assert killswitch.take_restore_request(config) == {"at": NOW}
    killswitch.restore_all(db, platform, config, now=NOW + 10)
    assert database.get_setting(db, "automation_enabled") == "0"
    marker_path(config).unlink()
    assert killswitch.is_engaged(db, config) is True
    # 反対に、DB の設定だけのときは、印のファイルも書き足す
    killswitch.restore_all(db, platform, config, now=NOW + 20)
    assert marker_path(config).exists()


def test_restore_all_cancels_items_before_ghosting(config, platform, db, monkeypatch):
    root = Path(config["PIP0_ROOT"])
    ghosted = evacuated_files(db, platform, config, ["退避済み.pdf"])
    paused = make_file(root / "一時停止.pdf")
    paused_before = fingerprint(paused)
    paused_id = evacuate(db, platform, paused, config, should_continue=lambda: False)["item_id"]
    copied = make_file(root / "コピー済み.pdf")
    copied_before = fingerprint(copied)
    real_ghost_step = vault.ghost_step

    def crash(*args):
        raise RuntimeError("テストのための強制終了")  # コピーを確かめた後、ゴーストにする前に止まった

    monkeypatch.setattr(vault, "ghost_step", crash)
    with pytest.raises(RuntimeError):
        evacuate(db, platform, copied, config)
    monkeypatch.setattr(vault, "ghost_step", real_ghost_step)
    copied_id = vault.list_items(db, ["copied"])[0]["item_id"]

    counts = killswitch.restore_all(db, platform, config, now=NOW + 10)

    assert counts["total"] == 1 and counts["restored"] == 1 and counts["finished"] is True
    for item_id in (paused_id, copied_id):
        assert vault.read_manifest(config, item_id)["state"] == "cancelled"
    assert fingerprint(paused) == paused_before and fingerprint(copied) == copied_before
    path, (_item_id, before) = next(iter(ghosted.items()))
    assert fingerprint(path) == before


def test_restore_all_counts_every_kind_of_result(config, platform, db):
    root = Path(config["PIP0_ROOT"])
    files = evacuated_files(db, platform, config, ["戻る.pdf", "衝突.pdf", "ない.pdf", "編集.pdf", "戻っていた.pdf"])
    by_name = {path.name: path for path in files}
    platform.simulate_user_delete(by_name["衝突.pdf"])
    by_name["衝突.pdf"].write_bytes(b"another file")
    platform.simulate_user_delete(by_name["ない.pdf"])
    platform.simulate_app_open(by_name["編集.pdf"])
    platform.simulate_app_modify(by_name["編集.pdf"], b"edited")
    original = files[by_name["戻っていた.pdf"]][1]
    platform.simulate_user_delete(by_name["戻っていた.pdf"])
    make_file(by_name["戻っていた.pdf"])  # 同じ内容のファイルを、ユーザーが自分で戻した
    assert fingerprint(by_name["戻っていた.pdf"]) == original

    counts = killswitch.restore_all(db, platform, config, now=NOW + 10)

    assert counts == {"total": 5, "restored": 1, "conflict": 1, "local_newer": 1, "missing": 1, "failed": 0,
                      "already": 1, "remaining": 0, "finished": True}
    assert (root / "衝突 (pip0復元).pdf").exists()
    assert by_name["衝突.pdf"].read_bytes() == b"another file"
    assert by_name["編集.pdf"].read_bytes() == b"edited"
    assert not by_name["ない.pdf"].exists()
    # もう一度実行すると、ゴーストが見つからない項目だけを探し直す
    again = killswitch.restore_all(db, platform, config, now=NOW + 20)
    assert (again["total"], again["missing"], again["finished"]) == (1, 1, True)


def test_restore_all_without_the_shell_keeps_everything_and_can_retry(config, platform, db):
    files = evacuated_files(db, platform, config, ["a.pdf", "b.pdf"])
    platform.provider_running = False
    counts = killswitch.restore_all(db, platform, config, now=NOW + 10)
    assert (counts["total"], counts["failed"], counts["finished"]) == (2, 2, True)
    assert [row["state"] for row in vault.list_items(db)] == ["evacuated", "evacuated"]

    platform.provider_running = True
    again = killswitch.restore_all(db, platform, config, now=NOW + 20)
    assert (again["total"], again["restored"]) == (2, 2)
    for path, (_item_id, before) in files.items():
        assert fingerprint(path) == before


def test_restore_all_continues_after_an_unexpected_error(config, platform, db):
    files = evacuated_files(db, platform, config, ["a.pdf", "b.pdf"])
    platform.fail_next["restore_ghost"] = RuntimeError("予想外のエラー")
    counts = killswitch.restore_all(db, platform, config, now=NOW + 10)
    assert (counts["total"], counts["restored"], counts["failed"], counts["finished"]) == (2, 1, 1, True)
    assert [row["state"] for row in vault.list_items(db, ["restoring"])] != []
    # もう一度実行すると、起動時の点検で残りを戻す
    killswitch.restore_all(db, platform, config, now=NOW + 20)
    for path, (_item_id, before) in files.items():
        assert fingerprint(path) == before


# ---------------------------------------------------------------------- 13 実行中の退避があるとき


@pytest.mark.parametrize("worker_watches_the_switch", [True, False], ids=["worker_pauses", "evacuate_rechecks"])
def test_kill_switch_while_an_evacuation_runs_in_a_worker(config, platform, db, key_store, worker_watches_the_switch):
    files = evacuated_files(db, platform, config, ["退避済み1.pdf", "退避済み2.pdf"])
    big = make_file(Path(config["PIP0_ROOT"]) / "大きな動画.mp4", size=200_000)  # 4KB ごとに 49 区切り
    big_before = fingerprint(big)
    started = threading.Event()
    stop = threading.Event()
    calls = []
    results = {}

    def should_continue():
        calls.append(1)
        if len(calls) == 2:
            started.set()  # コピーの途中まで進んだ
            stop.wait(timeout=10)
        if worker_watches_the_switch:
            return not stop.is_set()
        return True  # 印を見ないワーカー：vault.evacuate が、ゴーストにする前に確かめ直す

    def worker():
        conn = database.open_database(config, keystore=key_store)  # ワーカーのスレッド用の接続
        try:
            results["evacuate"] = evacuate(conn, platform, big, config, should_continue=should_continue)
        finally:
            conn.close()

    thread = threading.Thread(target=worker)
    thread.start()
    assert started.wait(timeout=10)
    # キルスイッチ：停止の印を書き、ワーカーに知らせて、区切りで止まるのを待ってから全復元する
    killswitch.engage(db, config, "全復元", now=NOW)
    stop.set()
    thread.join(timeout=10)
    assert not thread.is_alive()

    evacuation = results["evacuate"]
    assert evacuation["ok"] is False
    assert evacuation["state"] == ("failed" if worker_watches_the_switch else "cancelled")
    counts = killswitch.restore_all(db, platform, config, now=NOW + 10)

    assert (counts["total"], counts["restored"], counts["finished"]) == (2, 2, True)
    assert vault.read_manifest(config, evacuation["item_id"])["state"] == "cancelled"
    assert fingerprint(big) == big_before and not is_ghost(platform, big)
    for path, (_item_id, before) in files.items():
        assert fingerprint(path) == before


# ---------------------------------------------------------------------- 14 DB の鍵をなくしたとき


@pytest.mark.parametrize("sync_first", [True, False], ids=["sync_then_restore_all", "restore_all_alone"])
def test_restore_all_after_losing_the_database_key(config, platform, key_store, sync_first):
    conn = database.open_database(config, keystore=key_store)
    files = evacuated_files(conn, platform, config, ["a.pdf", "b.docx"])
    conn.close()

    # 鍵をなくした：古い DB は消さずに名前を変え、新しい鍵で新しい DB を作る（docs/setup-windows.md 8節）
    db_path = Path(config["DB_PATH"])
    for old in list(db_path.parent.glob("pip0.db*")):
        old.rename(old.with_name(old.name.replace("pip0.db", "pip0.db.lost")))
    new_store = keystore.MemoryKeystore()
    conn = database.open_database(config, keystore=new_store)
    assert vault.list_items(conn) == []

    if sync_first:
        summary = vault.sync_from_manifests(conn, config)
        assert (summary["loaded"], summary["problems"]) == (2, [])
    # restore_all だけでも、manifest.json を読み直してから戻す（cli の restore-all がこの形）
    counts = killswitch.restore_all(conn, platform, config, now=NOW + 10)
    assert (counts["total"], counts["restored"], counts["finished"]) == (2, 2, True)
    for path, (_item_id, before) in files.items():
        assert fingerprint(path) == before
    conn.close()
    # 古い DB は残っていて、新しい鍵では読めない
    with pytest.raises(database.DatabaseKeyError):
        database.open_encrypted(db_path.with_name("pip0.db.lost"), new_store.get_key())


# ---------------------------------------------------------------------- 依頼と進み具合のファイル


def test_request_and_take_restore_all(config, db):
    assert killswitch.take_restore_request(config) is None
    assert killswitch.read_progress(config) is None

    assert killswitch.request_restore_all(config, now=NOW)["ok"] is True
    assert killswitch.is_engaged(None, config) is True  # 依頼と同時に、新しい自動処理を止める
    assert killswitch.resume(db, config, confirmed=True)["ok"] is False  # 依頼が残っている間は再開しない

    assert killswitch.take_restore_request(config) == {"at": NOW}
    assert killswitch.take_restore_request(config) is None  # 同じ依頼を二度受け取らない

    no_place = dict(config, CONTROL_DIR=None)
    assert killswitch.request_restore_all(no_place)["ok"] is False
    assert killswitch.take_restore_request(no_place) is None
    assert killswitch.read_progress(no_place) is None


def test_broken_request_file_still_counts_as_a_request(config):
    request = Path(config["CONTROL_DIR"]) / "restore_all.request.json"
    request.parent.mkdir(parents=True)
    request.write_text("{壊れた", encoding="utf-8")
    assert killswitch.take_restore_request(config) == {}
    assert not request.exists()
