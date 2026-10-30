"""保管庫（vault.py）のテスト：退避・復元・途中の失敗・起動時の点検

OS 連携は代役（FakePlatform）です。代役のゴーストは、元の大きさのまま中身を 0 にしたファイルで、
simulate_app_open() が「アプリが開くと OS が保管庫から中身を戻す」動きをまねます。
ここで確かめたことは「代役での確認」で、Windows の実機（Cloud Files API）での確認ではありません。

どのテストでも、最後に次を確かめます（vault_guard）。
- テスト中に書いた manifest.json が、すべて残っていること
- 保管庫に確かめたコピーがあるはずの項目は、content が残っていて、ハッシュが manifest.json と同じこと
"""

import errno
import hashlib
import logging
import os
from pathlib import Path

import pytest

from pip0 import database, fsutil, killswitch, vault

NOW = 1_793_000_000.0
MTIME_NS = 1_700_000_000_123_456_789  # 元のファイルの更新日時（ナノ秒）


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
    assert_vault_content_intact(env)


def assert_vault_content_intact(config):
    items = Path(config["VAULT_DIR"]) / "items"
    if not items.exists():
        return
    for folder in items.iterdir():
        if not vault.is_valid_item_id(folder.name) or not (folder / "manifest.json").exists():
            continue
        manifest = fsutil.read_json(folder / "manifest.json")
        if manifest["state"] in vault.STATES_WITH_CONTENT:
            assert (folder / "content").exists(), "確かめたコピーがあるはずの content が消えています"
            assert sha256_of(folder / "content") == manifest["sha256"]


@pytest.fixture
def config(env):
    """小さな区切り（4KB）で、小さなファイルも退避できる設定"""
    return dict(env, HASH_CHUNK_BYTES=4096, EVACUATE_MIN_SIZE_BYTES=1024)


def make_file(path, size=20_000, mtime_ns=MTIME_NS):
    path.parent.mkdir(parents=True, exist_ok=True)
    data = bytes((i * 31 + len(path.name) * 7) % 251 for i in range(size))
    path.write_bytes(data)
    os.utime(path, ns=(mtime_ns, mtime_ns))
    return path


def sha256_of(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def fingerprint(path):
    """内容のハッシュ、大きさ、更新日時"""
    info = os.stat(path)
    return (sha256_of(path), info.st_size, info.st_mtime_ns)


def evacuate(conn, platform, path, config, should_continue=None, actor="auto"):
    return vault.evacuate(conn, platform, path, config, reasons=["長期間未読（テスト）"],
                          should_continue=should_continue or (lambda: True), actor=actor, now=NOW)


def restore(conn, platform, item_id, config, actor="user"):
    return vault.restore(conn, platform, item_id, config, actor=actor, now=NOW + 60)


def item_folder(config, item_id):
    return Path(config["VAULT_DIR"]) / "items" / item_id


def row_of(conn, item_id):
    """vault_items の行（DB の記録）"""
    return database.query_one(conn, "SELECT * FROM vault_items WHERE item_id = ?", (item_id,))


def operations(conn, kind):
    return database.query_all(conn, "SELECT * FROM operations WHERE kind = ? ORDER BY id", (kind,))


def is_ghost(platform, path):
    return platform.ghost_status(str(path))["is_ghost"] is True


def crash_once(monkeypatch, owner, name, after=False):
    """owner.name を、最初の 1 回だけ RuntimeError を出すものに差し替える（強制終了のまね）

    after=True なら、本物を呼んだ後で例外を出す（処理は終わったが、記録する前に止まった場合）。
    """
    real = getattr(owner, name)
    state = {"done": False}

    def wrapper(*args, **kwargs):
        if state["done"]:
            return real(*args, **kwargs)
        state["done"] = True
        if after:
            real(*args, **kwargs)
        raise RuntimeError("テストのための強制終了")

    monkeypatch.setattr(owner, name, wrapper)


@pytest.fixture
def report(env):
    return make_file(env["PIP0_ROOT"] / "報告" / "最終報告.docx")


# ---------------------------------------------------------------------- 1・2 退避 → 再起動 → 復元


def test_evacuate_restart_and_restore_keep_hash_size_and_mtime(config, platform, key_store, report):
    before = fingerprint(report)
    conn = database.open_database(config, keystore=key_store)
    result = evacuate(conn, platform, report, config)
    assert result["ok"] is True and result["state"] == "evacuated" and result["reason"] == ""
    item_id = result["item_id"]
    assert vault.is_valid_item_id(item_id)

    # 元の場所には同じ名前・同じ大きさのゴースト（代役では中身を 0 にしたファイル）
    assert is_ghost(platform, report)
    assert os.stat(report).st_size == before[1]
    assert sha256_of(report) != before[0]
    # 保管庫には確かめたコピーと manifest.json
    manifest = vault.read_manifest(config, item_id)
    assert manifest["state"] == "evacuated"
    assert manifest["sha256"] == before[0]
    assert (manifest["size"], manifest["mtime_ns"]) == (before[1], before[2])
    assert sha256_of(item_folder(config, item_id) / "content") == before[0]
    assert row_of(conn, item_id)["state"] == "evacuated"
    assert [op["status"] for op in operations(conn, "evacuate")] == ["done"]
    conn.close()

    # アプリの再起動：DB を閉じて、同じ鍵で開き直す（OS 連携の代役はそのまま残る）
    conn = database.open_database(config, keystore=key_store)
    vault.recover_incomplete(conn, platform, config, now=NOW + 30)
    restored = restore(conn, platform, item_id, config)
    assert restored == {"ok": True, "state": "restored", "path": str(report),
                        "reason": restored["reason"], "already": False}
    assert fingerprint(report) == before
    assert not is_ghost(platform, report)
    assert [op["status"] for op in operations(conn, "restore")] == ["done"]
    # 復元した後も、保管庫の content と manifest.json は残す
    assert (item_folder(config, item_id) / "content").exists()
    assert vault.read_manifest(config, item_id)["state"] == "restored"
    conn.close()


def test_ghost_opens_transparently_and_then_restores(config, platform, db, report):
    original = report.read_bytes()
    item_id = evacuate(db, platform, report, config)["item_id"]
    # アプリがゴーストを開くと、OS（代役）が保管庫から中身を戻してから読ませる
    assert platform.simulate_app_open(report) == original
    restored = restore(db, platform, item_id, config)
    assert restored["ok"] is True and restored["state"] == "restored"
    assert report.read_bytes() == original


def test_manifest_has_every_field_and_readme_is_written(config, platform, db, report):
    item_id = evacuate(db, platform, report, config)["item_id"]
    manifest = fsutil.read_json(item_folder(config, item_id) / "manifest.json")
    for key in ("format", "item_id", "state", "original_path", "current_path", "file_key", "size", "mtime_ns",
                "sha256", "created_at", "updated_at", "restored_path", "history"):
        assert key in manifest
    assert manifest["format"] == 1
    assert [entry["state"] for entry in manifest["history"]] == ["copying", "copied", "ghosting", "evacuated"]
    readme = (Path(config["VAULT_DIR"]) / "README.txt").read_bytes().decode("utf-8-sig")
    assert "手作業で取り出す方法" in readme
    assert "Get-FileHash" in readme


# ---------------------------------------------------------------------- 3 一時停止


@pytest.mark.parametrize("stop_at_call", [3, 8], ids=["during_copy", "during_verification"])
def test_pause_leaves_original_and_retry_succeeds(config, platform, db, report, stop_at_call):
    before = fingerprint(report)
    calls = []

    def should_continue():
        calls.append(1)
        return len(calls) < stop_at_call

    result = evacuate(db, platform, report, config, should_continue=should_continue)
    assert result["ok"] is False
    assert result["state"] == "failed"
    assert "一時停止" in result["reason"]
    assert fingerprint(report) == before
    assert not is_ghost(platform, report)
    folder = item_folder(config, result["item_id"])
    assert not (folder / "content").exists()
    assert not (folder / "content.partial").exists()  # 途中までのコピーは消して容量を返す
    assert vault.read_manifest(config, result["item_id"])["state"] == "failed"

    # 後でやり直すと、同じ項目で新しくコピーし直して退避できる
    again = evacuate(db, platform, report, config)
    assert again["ok"] is True and again["item_id"] == result["item_id"]
    assert row_of(db, again["item_id"])["attempts"] == 2
    assert restore(db, platform, again["item_id"], config)["state"] == "restored"
    assert fingerprint(report) == before


# ---------------------------------------------------------------------- 4 途中で強制終了したとき


EVACUATE_CRASHES = {
    # 名前: (差し替え, 点検の後の状態)
    "after_copying_manifest": (lambda mp, platform: crash_once(mp, vault, "save_row"), "failed"),
    "during_copy": (lambda mp, platform: crash_once_on_call(mp, vault, "write_chunk", 3), "failed"),
    "after_copied": (lambda mp, platform: crash_once(mp, vault, "ghost_step"), "copied"),
    "inside_make_ghost": (lambda mp, platform: platform.fail_next.update(make_ghost=RuntimeError("終了")), "copied"),
    "after_make_ghost": (lambda mp, platform: crash_once(mp, platform, "make_ghost", after=True), "evacuated"),
}


def crash_once_on_call(monkeypatch, owner, name, number):
    """owner.name の number 回目の呼び出しだけ、RuntimeError を出す"""
    real = getattr(owner, name)
    calls = []

    def wrapper(*args, **kwargs):
        calls.append(1)
        if len(calls) == number:
            raise RuntimeError("テストのための強制終了")
        return real(*args, **kwargs)

    monkeypatch.setattr(owner, name, wrapper)


@pytest.mark.parametrize("step", list(EVACUATE_CRASHES))
def test_crash_during_evacuation_is_recovered(config, platform, key_store, monkeypatch, report, step):
    before = fingerprint(report)
    inject, state_after_check = EVACUATE_CRASHES[step]
    inject(monkeypatch, platform)
    conn = database.open_database(config, keystore=key_store)
    with pytest.raises(RuntimeError):
        evacuate(conn, platform, report, config)
    conn.close()  # 強制終了

    # 再起動して点検する（新しい接続）
    conn = database.open_database(config, keystore=key_store)
    summary = vault.recover_incomplete(conn, platform, config, now=NOW + 30)
    items = vault.list_items(conn)
    assert len(items) == 1
    item = items[0]
    assert item["state"] == state_after_check
    assert vault.read_manifest(config, item["item_id"])["state"] == state_after_check
    assert summary["unresolved"] == 0

    # 原本は失われていない：通常のファイルのままか、ゴーストで中身が保管庫にある
    target_id = item["item_id"]
    if state_after_check == "evacuated":
        assert is_ghost(platform, report)
        assert sha256_of(item_folder(config, item["item_id"]) / "content") == before[0]
    else:
        assert not is_ghost(platform, report)
        assert fingerprint(report) == before
        # やり直すと退避できる。前回の項目に中身（content）があれば使い直さず、新しい項目で退避する
        # （前回の content は上書きせずに残す。どこかにその項目のゴーストがあるかもしれないため）
        old_content = item_folder(config, item["item_id"]) / "content"
        had_content = old_content.exists()
        again = evacuate(conn, platform, report, config)
        assert again["ok"] is True
        assert (again["item_id"] != item["item_id"]) is had_content
        if had_content:
            assert sha256_of(old_content) == before[0]
        target_id = again["item_id"]

    restored = restore(conn, platform, target_id, config)
    assert restored["ok"] is True and restored["state"] == "restored"
    assert fingerprint(report) == before
    conn.close()


@pytest.mark.parametrize("after", [False, True], ids=["inside_restore_ghost", "after_restore_ghost"])
def test_crash_during_restore_is_recovered(config, platform, key_store, monkeypatch, report, after):
    before = fingerprint(report)
    conn = database.open_database(config, keystore=key_store)
    item_id = evacuate(conn, platform, report, config)["item_id"]
    crash_once(monkeypatch, platform, "restore_ghost", after=after)
    with pytest.raises(RuntimeError):
        restore(conn, platform, item_id, config)
    conn.close()
    assert vault.read_manifest(config, item_id)["state"] == "restoring"

    conn = database.open_database(config, keystore=key_store)
    summary = vault.recover_incomplete(conn, platform, config, now=NOW + 120)
    assert summary["resolved"] == 1
    assert vault.read_manifest(config, item_id)["state"] == "restored"
    assert fingerprint(report) == before
    conn.close()


def test_crash_while_putting_a_copy_beside_does_not_duplicate(config, platform, key_store, monkeypatch, report):
    before = fingerprint(report)
    conn = database.open_database(config, keystore=key_store)
    item_id = evacuate(conn, platform, report, config)["item_id"]
    platform.simulate_user_delete(report)
    report.write_bytes(b"another file")
    # 横に戻す名前へ変えた直後に止まる（manifest.json には行き先を書いてある）
    crash_once(monkeypatch, fsutil, "no_overwrite_rename", after=True)
    with pytest.raises(RuntimeError):
        restore(conn, platform, item_id, config)
    conn.close()

    conn = database.open_database(config, keystore=key_store)
    vault.recover_incomplete(conn, platform, config, now=NOW + 120)
    again = restore(conn, platform, item_id, config)
    assert again["state"] == "restored_conflict"
    copies = sorted(p.name for p in report.parent.iterdir() if "pip0復元" in p.name)
    assert copies == ["最終報告 (pip0復元).docx"]
    assert fingerprint(report.parent / copies[0]) == before
    assert report.read_bytes() == b"another file"
    conn.close()


def test_check_continues_after_an_unexpected_error(config, platform, db, env, report):
    other = make_file(env["PIP0_ROOT"] / "二つ目.pdf")
    ids = [evacuate(db, platform, path, config)["item_id"] for path in (report, other)]
    for item_id in ids:  # どちらも「復元の途中で止まった」状態にする
        vault.set_state(db, config, vault.read_manifest(config, item_id), "restoring", "テスト", NOW)
    platform.fail_next["restore_ghost"] = RuntimeError("予想外のエラー")

    summary = vault.recover_incomplete(db, platform, config, now=NOW + 30)

    assert (summary["resolved"], summary["unresolved"]) == (1, 1)
    assert any("RuntimeError" in problem["reason"] for problem in summary["problems"])
    again = vault.recover_incomplete(db, platform, config, now=NOW + 60)
    assert again["resolved"] == 1
    assert [vault.read_manifest(config, item_id)["state"] for item_id in ids] == ["restored", "restored"]


def test_crash_after_copy_beside_then_other_file_removed(config, platform, key_store, monkeypatch, report):
    # 横に戻した直後に止まり、その後ユーザーが元の場所の別のファイルを消した：ghost_missing にはしない
    before = fingerprint(report)
    conn = database.open_database(config, keystore=key_store)
    item_id = evacuate(conn, platform, report, config)["item_id"]
    platform.simulate_user_delete(report)
    report.write_bytes(b"another file")
    crash_once(monkeypatch, fsutil, "no_overwrite_rename", after=True)
    with pytest.raises(RuntimeError):
        restore(conn, platform, item_id, config)
    conn.close()
    report.unlink()

    conn = database.open_database(config, keystore=key_store)
    vault.recover_incomplete(conn, platform, config, now=NOW + 120)
    manifest = vault.read_manifest(config, item_id)
    assert manifest["state"] == "restored_conflict"
    assert fingerprint(manifest["restored_path"]) == before
    conn.close()


def fail_manifest_write_once(monkeypatch, state):
    """manifest.json に state を書こうとしたときだけ、1 回「容量不足」にする"""
    real_write = vault.write_manifest
    done = []

    def write(config, manifest):
        if manifest["state"] == state and not done:
            done.append(1)
            raise OSError(errno.ENOSPC, "No space left on device")
        return real_write(config, manifest)

    monkeypatch.setattr(vault, "write_manifest", write)


def test_record_error_before_ghosting_marks_failed(config, platform, db, monkeypatch, report):
    before = fingerprint(report)
    fail_manifest_write_once(monkeypatch, "copied")
    result = evacuate(db, platform, report, config)
    assert result["ok"] is False and result["state"] == "failed"
    assert "OS のエラー" in result["reason"] and "原本はそのまま" in result["reason"]
    assert fingerprint(report) == before and not is_ghost(platform, report)
    assert evacuate(db, platform, report, config)["state"] == "evacuated"


def test_record_error_after_ghosting_is_left_for_the_check(config, platform, db, monkeypatch, report):
    before = fingerprint(report)
    fail_manifest_write_once(monkeypatch, "evacuated")
    result = evacuate(db, platform, report, config)
    assert result["ok"] is False and result["state"] == "ghosting"  # failed にはしない（ゴーストになっている）
    assert "起動時の点検" in result["reason"]
    assert is_ghost(platform, report)
    vault.recover_incomplete(db, platform, config, now=NOW + 30)
    assert vault.read_manifest(config, result["item_id"])["state"] == "evacuated"
    assert restore(db, platform, result["item_id"], config)["state"] == "restored"
    assert fingerprint(report) == before


def test_record_error_during_restore_keeps_the_ghost(config, platform, db, monkeypatch, report):
    before = fingerprint(report)
    item_id = evacuate(db, platform, report, config)["item_id"]
    fail_manifest_write_once(monkeypatch, "restoring")
    result = restore(db, platform, item_id, config)
    assert result["ok"] is False and result["state"] == "evacuated"
    assert "OS のエラー" in result["reason"]
    assert is_ghost(platform, report)
    assert restore(db, platform, item_id, config)["state"] == "restored"
    assert fingerprint(report) == before


def test_crash_while_copying_out_leaves_no_temp_file(config, platform, db, monkeypatch, report):
    item_id = evacuate(db, platform, report, config)["item_id"]
    platform.simulate_user_delete(report)
    report.write_bytes(b"another file")
    crash_once_on_call(monkeypatch, vault, "write_chunk", 2)
    with pytest.raises(RuntimeError):
        restore(db, platform, item_id, config)
    assert sorted(p.name for p in report.parent.iterdir()) == ["最終報告.docx"]
    assert vault.read_manifest(config, item_id)["state"] == "evacuated"
    assert restore(db, platform, item_id, config)["state"] == "restored_conflict"


# ---------------------------------------------------------------------- 5 容量不足


def test_disk_full_fails_safely_and_can_retry(config, platform, db, monkeypatch, report):
    before = fingerprint(report)
    real_write_chunk = vault.write_chunk

    def disk_full(target, chunk):
        raise OSError(errno.ENOSPC, "No space left on device")

    monkeypatch.setattr(vault, "write_chunk", disk_full)
    result = evacuate(db, platform, report, config)
    assert result["ok"] is False and result["state"] == "failed"
    assert "容量" in result["reason"]
    assert fingerprint(report) == before
    assert not is_ghost(platform, report)
    folder = item_folder(config, result["item_id"])
    assert sorted(p.name for p in folder.iterdir()) == ["manifest.json"]
    assert [op["status"] for op in operations(db, "evacuate")] == ["failed"]

    monkeypatch.setattr(vault, "write_chunk", real_write_chunk)
    assert evacuate(db, platform, report, config)["state"] == "evacuated"


def test_bad_write_is_caught_by_reading_the_copy_again(config, platform, db, monkeypatch, report):
    before = fingerprint(report)
    real_write_chunk = vault.write_chunk

    def garbled_write(target, chunk):
        # ディスクへの書き込みが化けた（ハッシュは、原本から読んだ正しい内容で計算されている）
        real_write_chunk(target, bytes([chunk[0] ^ 0xFF]) + chunk[1:])

    monkeypatch.setattr(vault, "write_chunk", garbled_write)
    result = evacuate(db, platform, report, config)
    assert result["ok"] is False and result["state"] == "failed"
    assert "読み直したところ、ハッシュが一致しませんでした" in result["reason"]
    assert fingerprint(report) == before
    assert not is_ghost(platform, report)
    assert not (item_folder(config, result["item_id"]) / "content").exists()


# ---------------------------------------------------------------------- 6 コピー中の変更


def test_change_during_copy_is_not_saved(config, platform, db, report):
    original = report.read_bytes()
    calls = []

    def should_continue():
        calls.append(1)
        if len(calls) == 3:  # コピーの途中で、ほかのアプリが書き足した
            with open(report, "ab") as f:
                f.write(b"user edit")
        return True

    result = evacuate(db, platform, report, config, should_continue=should_continue)
    assert result["ok"] is False and result["state"] == "failed"
    assert "コピー中に変更されました" in result["reason"]
    assert report.read_bytes() == original + b"user edit"  # 書き足された原本はそのまま
    assert not is_ghost(platform, report)
    assert not (item_folder(config, result["item_id"]) / "content").exists()
    row = database.query_one(db, "SELECT state, sha256 FROM vault_items WHERE item_id = ?", (result["item_id"],))
    assert row["state"] == "failed" and row["sha256"] is None


def test_same_size_change_is_detected_by_modification_time(config, platform, db, report):
    calls = []

    def should_continue():
        calls.append(1)
        if len(calls) == 2:
            with open(report, "r+b") as f:
                f.write(b"XYZ")
            os.utime(report, ns=(MTIME_NS + 5_000_000_000, MTIME_NS + 5_000_000_000))
        return True

    result = evacuate(db, platform, report, config, should_continue=should_continue)
    assert result["state"] == "failed"
    assert report.read_bytes().startswith(b"XYZ")


# ---------------------------------------------------------------------- 7 ゴーストにできないとき


@pytest.mark.parametrize("answer", ["changed", "locked", "not_in_root", "unavailable", "error"])
def test_make_ghost_refusal_leaves_original(config, platform, db, report, answer):
    before = fingerprint(report)
    platform.fail_next["make_ghost"] = {"result": answer, "reason": f"代役の答え：{answer}"}
    result = evacuate(db, platform, report, config)
    assert result["ok"] is False and result["state"] == "failed"
    assert f"代役の答え：{answer}" in result["reason"]
    assert fingerprint(report) == before
    assert not is_ghost(platform, report)
    # やり直すと、新しい項目で退避する（前回の項目の content は、上書きせずに残す）
    again = evacuate(db, platform, report, config)
    assert again["ok"] is True and again["item_id"] != result["item_id"]
    assert sha256_of(item_folder(config, result["item_id"]) / "content") == before[0]


def test_ghost_status_unknown_keeps_ghosting_for_the_check(config, platform, db, monkeypatch, report):
    real_status = platform.ghost_status

    def unknown_after_make_ghost(path):
        # make_ghost の後だけ、OS 連携が答えない（ゴーストになったかを確かめられない）
        if any(call[0] == "make_ghost" for call in platform.calls):
            return {"exists": None, "is_ghost": None, "item_id": None, "dehydrated": None,
                    "in_sync": None, "pinned": None, "reason": "OS 連携が答えません"}
        return real_status(path)

    monkeypatch.setattr(platform, "ghost_status", unknown_after_make_ghost)
    result = evacuate(db, platform, report, config)
    assert result["ok"] is False and result["state"] == "ghosting"
    monkeypatch.setattr(platform, "ghost_status", real_status)
    vault.recover_incomplete(db, platform, config, now=NOW + 30)
    assert vault.read_manifest(config, result["item_id"])["state"] == "evacuated"


# ---------------------------------------------------------------------- 8・9・10・11 復元の表（7-3）


def test_other_file_at_the_place_gives_conflict_copy(config, platform, db, report):
    before = fingerprint(report)
    item_id = evacuate(db, platform, report, config)["item_id"]
    platform.simulate_user_delete(report)  # ユーザーがゴーストを消して
    report.write_bytes(b"a different file made by the user")  # 同じ名前で別のファイルを作った
    other_before = fingerprint(report)

    result = restore(db, platform, item_id, config)

    copy = report.parent / "最終報告 (pip0復元).docx"
    assert result == {"ok": True, "state": "restored_conflict", "path": str(copy),
                      "reason": result["reason"], "already": False}
    assert fingerprint(report) == other_before  # 別のファイルには触れない
    assert fingerprint(copy) == before  # 横のコピーは元のハッシュと更新日時
    assert not [p for p in report.parent.iterdir() if p.name.endswith(".partial")]
    assert [op["status"] for op in operations(db, "restore")] == ["conflict"]
    assert vault.read_manifest(config, item_id)["restored_path"] == str(copy)


def test_deleted_ghost_becomes_ghost_missing_and_is_not_recreated(config, platform, db, report):
    item_id = evacuate(db, platform, report, config)["item_id"]
    platform.simulate_user_delete(report)

    first = restore(db, platform, item_id, config)
    second = restore(db, platform, item_id, config)

    for result in (first, second):
        assert result["ok"] is False and result["state"] == "ghost_missing"
    assert not report.exists()  # 勝手に作り直さない
    folder = item_folder(config, item_id)
    assert (folder / "content").exists() and (folder / "manifest.json").exists()
    assert row_of(db, item_id)["state"] == "ghost_missing"


def test_restoring_twice_gives_the_same_result(config, platform, db, report):
    item_id = evacuate(db, platform, report, config)["item_id"]
    first = restore(db, platform, item_id, config)
    second = restore(db, platform, item_id, config)
    assert (first["state"], first["path"]) == (second["state"], second["path"]) == ("restored", str(report))
    assert second["already"] is True
    assert sorted(p.name for p in report.parent.iterdir()) == ["最終報告.docx"]
    assert len(operations(db, "restore")) == 1


def test_conflict_restore_twice_makes_one_copy(config, platform, db, report):
    item_id = evacuate(db, platform, report, config)["item_id"]
    platform.simulate_user_delete(report)
    report.write_bytes(b"another file")
    first = restore(db, platform, item_id, config)
    second = restore(db, platform, item_id, config)
    assert first["state"] == second["state"] == "restored_conflict"
    assert first["path"] == second["path"]
    assert sorted(p.name for p in report.parent.iterdir()) == ["最終報告 (pip0復元).docx", "最終報告.docx"]


def test_conflict_name_skips_existing_names(config, platform, db, report):
    item_id = evacuate(db, platform, report, config)["item_id"]
    platform.simulate_user_delete(report)
    report.write_bytes(b"another file")
    taken = report.parent / "最終報告 (pip0復元).docx"
    taken.write_bytes(b"older copy kept by the user")
    result = restore(db, platform, item_id, config)
    assert result["path"] == str(report.parent / "最終報告 (pip0復元) (2).docx")
    assert taken.read_bytes() == b"older copy kept by the user"


def test_ghost_edited_after_opening_keeps_the_users_content(config, platform, db, report):
    original_sha = sha256_of(report)
    item_id = evacuate(db, platform, report, config)["item_id"]
    platform.simulate_app_open(report)
    platform.simulate_app_modify(report, b"edited by the user after opening")

    result = restore(db, platform, item_id, config)

    assert result["ok"] is True and result["state"] == "restored_local_newer"
    assert result["path"] == str(report)
    assert report.read_bytes() == b"edited by the user after opening"
    assert sha256_of(item_folder(config, item_id) / "content") == original_sha  # 保管庫はそのまま


def test_regular_file_with_the_same_content_is_already_restored(config, platform, db, report):
    original = report.read_bytes()
    item_id = evacuate(db, platform, report, config)["item_id"]
    platform.simulate_user_delete(report)
    report.write_bytes(original)  # ユーザーが別の場所の写しを戻した
    result = restore(db, platform, item_id, config)
    assert result["ok"] is True and result["state"] == "restored" and result["already"] is True


def test_shell_not_running_keeps_evacuated_and_records_failure(config, platform, db, report):
    before = fingerprint(report)
    item_id = evacuate(db, platform, report, config)["item_id"]
    platform.provider_running = False
    result = restore(db, platform, item_id, config)
    assert result["ok"] is False and result["state"] == "evacuated"
    assert is_ghost(platform, report)
    assert [op["status"] for op in operations(db, "restore")] == ["failed"]
    row = database.query_one(db, "SELECT state, last_error FROM vault_items WHERE item_id = ?", (item_id,))
    assert row["state"] == "evacuated" and row["last_error"]

    platform.provider_running = True
    assert restore(db, platform, item_id, config)["state"] == "restored"
    assert fingerprint(report) == before


def test_broken_vault_content_is_kept_and_not_served(config, platform, db, report):
    item_id = evacuate(db, platform, report, config)["item_id"]
    content = item_folder(config, item_id) / "content"
    good = content.read_bytes()
    content.write_bytes(b"broken" + good[6:])
    try:
        result = restore(db, platform, item_id, config)
        assert result["ok"] is False and result["state"] == "evacuated"
        assert is_ghost(platform, report)
        assert content.exists()
        # 別のファイルがある場合も、壊れた内容は横に戻さない
        platform.simulate_user_delete(report)
        report.write_bytes(b"another file")
        beside = restore(db, platform, item_id, config)
        assert beside["ok"] is False and beside["state"] == "evacuated"
        assert sorted(p.name for p in report.parent.iterdir()) == ["最終報告.docx"]
    finally:
        content.write_bytes(good)
    assert restore(db, platform, item_id, config)["state"] == "restored_conflict"


def test_moved_ghost_is_restored_at_its_new_place(config, platform, db, report):
    before = fingerprint(report)
    item_id = evacuate(db, platform, report, config)["item_id"]
    new_place = report.parent / "名前を変えた報告.docx"
    platform.simulate_user_rename(report, new_place)
    assert vault.record_moved(db, config, item_id, new_place, now=NOW + 10) == {"ok": True, "reason": ""}
    result = restore(db, platform, item_id, config)
    assert result["state"] == "restored" and result["path"] == str(new_place)
    assert fingerprint(new_place) == before


# ---------------------------------------------------------------------- 退避の前の確認


def test_evacuate_twice_does_not_make_a_second_item(config, platform, db, report):
    first = evacuate(db, platform, report, config)
    second = evacuate(db, platform, report, config)
    assert second["ok"] is True and second["item_id"] == first["item_id"] and second["state"] == "evacuated"
    assert len(list((Path(config["VAULT_DIR"]) / "items").iterdir())) == 1


def test_evacuate_checks_the_location_rules_first(config, platform, db, env):
    outside = make_file(env["DOWNLOADS_DIR"] / "外.pdf")
    before = fingerprint(outside)
    result = evacuate(db, platform, outside, config)
    assert result == {"ok": False, "item_id": None, "state": None, "reason": result["reason"]}
    assert "pip0 専用フォルダーの外" in result["reason"]
    assert fingerprint(outside) == before
    assert not Path(config["VAULT_DIR"]).exists()
    assert [op["status"] for op in operations(db, "evacuate")] == ["skipped"]


def test_evacuate_uses_the_rules_it_is_given(config, platform, db, report):
    class NoDocx:
        EXCLUDED_NAME_PATTERNS = [r"\.docx$"]

    result = vault.evacuate(db, platform, report, config, reasons=[], should_continue=None, actor="user",
                            now=NOW, rules=NoDocx)
    assert result["ok"] is False and "名前の規則" in result["reason"]
    assert not is_ghost(platform, report)


def test_automatic_evacuation_stops_with_the_kill_switch(config, platform, db, report):
    killswitch.engage(None, config, "テスト")
    refused = evacuate(db, platform, report, config, actor="auto")
    assert refused["ok"] is False and "キルスイッチ" in refused["reason"]
    assert not is_ghost(platform, report)
    # ユーザー自身の操作は止めない
    assert evacuate(db, platform, report, config, actor="user")["state"] == "evacuated"


def test_automatic_evacuation_respects_the_feature_switch(config, platform, db, report):
    switched_off = dict(config, AUTO_EVACUATE_ENABLED=False)
    refused = evacuate(db, platform, report, switched_off, actor="auto")
    assert refused["ok"] is False and "AUTO_EVACUATE_ENABLED" in refused["reason"]
    assert not is_ghost(platform, report)
    assert evacuate(db, platform, report, switched_off, actor="user")["state"] == "evacuated"


def test_kill_switch_pressed_during_copy_cancels_before_ghosting(config, platform, db, report):
    before = fingerprint(report)
    calls = []

    def should_continue():
        calls.append(1)
        if len(calls) == 2:  # コピーの途中でキルスイッチが押された（このワーカーは印を見ていない）
            killswitch.engage(None, config, "テスト")
        return True

    result = evacuate(db, platform, report, config, should_continue=should_continue)
    assert result["ok"] is False and result["state"] == "cancelled"
    assert fingerprint(report) == before
    assert not is_ghost(platform, report)
    assert [op["status"] for op in operations(db, "evacuate")] == ["cancelled"]


def test_same_path_is_not_handled_twice_at_once(config, platform, db, report):
    assert vault.claim_path(str(report))
    try:
        result = evacuate(db, platform, report, config)
    finally:
        vault.release_path(str(report))
    assert result["ok"] is False and "ほかの処理" in result["reason"]
    assert not is_ghost(platform, report)


# ---------------------------------------------------------------------- manifest.json と DB


def test_restore_rejects_bad_item_ids(config, platform, db):
    bad = restore(db, platform, "../../etc/passwd", config)
    assert bad["ok"] is False and "項目ID" in bad["reason"]
    unknown = restore(db, platform, "0" * 32, config)
    assert unknown["ok"] is False and "manifest.json" in unknown["reason"]


def test_sync_from_manifests_rebuilds_rows_and_manifest_wins(config, platform, db, report, env):
    item_id = evacuate(db, platform, report, config)["item_id"]
    second = make_file(env["PIP0_ROOT"] / "二つ目.pdf")
    second_id = evacuate(db, platform, second, config)["item_id"]
    db.execute("DELETE FROM vault_items WHERE item_id = ?", (item_id,))
    db.execute("UPDATE vault_items SET state = 'restored', created_at = 1.0 WHERE item_id = ?", (second_id,))
    (Path(config["VAULT_DIR"]) / "items" / "not-an-item").mkdir()

    summary = vault.sync_from_manifests(db, config)

    assert (summary["loaded"], summary["updated"], summary["unchanged"]) == (1, 1, 0)
    assert len(summary["problems"]) == 1
    again = vault.sync_from_manifests(db, config)  # そろえた後は、食い違いがない
    assert (again["loaded"], again["updated"], again["unchanged"]) == (0, 0, 2)
    states = {row["item_id"]: row["state"] for row in vault.list_items(db)}
    assert states == {item_id: "evacuated", second_id: "evacuated"}
    assert sorted(row["item_id"] for row in vault.list_items(db, ["evacuated"])) == sorted([item_id, second_id])
    assert vault.list_items(db, "restored") == []


def test_cancel_only_touches_items_before_ghosting(config, platform, db, report, env):
    ghost_id = evacuate(db, platform, report, config)["item_id"]
    paused = make_file(env["PIP0_ROOT"] / "一時停止.pdf")
    paused_id = evacuate(db, platform, paused, config, should_continue=lambda: False)["item_id"]
    assert vault.cancel(db, config, ghost_id, "テスト") is False
    assert vault.cancel(db, config, paused_id, "テスト", now=NOW) is True
    assert vault.read_manifest(config, paused_id)["state"] == "cancelled"
    assert vault.read_manifest(config, ghost_id)["state"] == "evacuated"


def test_logs_do_not_contain_names_or_paths(config, platform, db, report, caplog):
    caplog.set_level(logging.DEBUG)
    item_id = evacuate(db, platform, report, config)["item_id"]
    platform.simulate_user_delete(report)
    report.write_bytes(b"another file")
    restore(db, platform, item_id, config)
    messages = [record.getMessage() for record in caplog.records]
    assert messages
    for message in messages:
        assert "最終報告" not in message
        assert str(config["PIP0_ROOT"]) not in message
        assert str(config["VAULT_DIR"]) not in message


# ---------------------------------------------------------------------- R1 の見直しで加えた確認


MISREPORTED_REGULAR = {"exists": True, "is_ghost": False, "item_id": None, "dehydrated": False,
                       "in_sync": None, "pinned": False, "reason": ""}
UNKNOWN_STATUS = {"exists": None, "is_ghost": None, "item_id": None, "dehydrated": None,
                  "in_sync": None, "pinned": None, "reason": "OS 連携が答えません"}
SLACK_ZONE = ("[ZoneTransfer]\r\nZoneId=3\r\nReferrerUrl=https://app.slack.com/\r\n"
              "HostUrl=https://files.slack.com/files-pri/T0-F0/report.docx\r\n")
MINIMAL_ZONE = "[ZoneTransfer]\r\nZoneId=3\r\n"


def test_wrong_regular_answer_after_ghosting_never_loses_the_only_copy(config, platform, db, report):
    before = fingerprint(report)
    # 退避の前の確認はいつもどおり。ゴーストにした直後の確認だけ、OS 連携が「通常のファイル」と誤って答える
    platform.fail_next["ghost_status"] = [None, MISREPORTED_REGULAR]
    result = evacuate(db, platform, report, config)
    assert result["ok"] is False and result["state"] == "ghosting"  # 「原本はそのまま」とは記録しない
    assert "原本はそのまま" not in result["reason"]
    assert is_ghost(platform, report)  # 本当はゴーストになっている
    item_id = result["item_id"]

    # pip0 シェルが動いていない間に、ユーザーがゴーストの名前を変え、元の名前で別のファイルを保存した
    renamed = report.parent / "最終報告_旧.docx"
    platform.simulate_user_rename(report, renamed)
    make_file(report, size=30_000, mtime_ns=MTIME_NS + 10**12)
    newer = fingerprint(report)

    # 同じ場所の新しいファイルの退避は断る（古い項目の中身を上書きしない）
    refused = evacuate(db, platform, report, config)
    assert refused["ok"] is False and refused["item_id"] == item_id

    # 全復元：点検で、名前を変えたゴーストを見つけて戻す。新しいファイルには触れない
    counts = killswitch.restore_all(db, platform, config, now=NOW + 60)
    assert (counts["restored"], counts["failed"], counts["missing"]) == (1, 0, 0)
    assert fingerprint(renamed) == before
    assert fingerprint(report) == newer
    assert platform.ghosts == {}


def test_unclear_search_after_ghosting_keeps_the_item_for_the_kill_switch(config, platform, db, report):
    before = fingerprint(report)
    platform.fail_next["ghost_status"] = [None, MISREPORTED_REGULAR]
    item_id = evacuate(db, platform, report, config)["item_id"]  # ghosting のまま（本当はゴーストになっている）
    renamed = report.parent / "最終報告_旧.docx"
    platform.simulate_user_rename(report, renamed)
    make_file(report, size=30_000, mtime_ns=MTIME_NS + 10**12)
    newer = fingerprint(report)

    # 全復元の点検で、ゴーストを探し切れなかった（シェルが答えない等）。copied にして対象から外さない
    platform.fail_next["locate_ghost"] = {"result": "unknown", "paths": [], "reason": "時間内に探し終わりませんでした"}
    counts = killswitch.restore_all(db, platform, config, now=NOW + 60)
    assert (counts["restored"], counts["failed"], counts["missing"]) == (1, 0, 0)  # 2回目の探索で見つけて戻す
    assert fingerprint(renamed) == before
    assert fingerprint(report) == newer
    assert vault.read_manifest(config, item_id)["state"] == "restored"


def test_existing_vault_content_is_never_replaced(config, platform, db, report, env):
    item_id = evacuate(db, platform, report, config)["item_id"]
    content = item_folder(config, item_id) / "content"
    kept = sha256_of(content)
    other = make_file(env["PIP0_ROOT"] / "別の資料.docx", size=5_000)
    result = vault.copy_into_vault(platform, str(other), config, item_id, vault.path_snapshot(platform, str(other)),
                                   None)
    assert result["ok"] is False and "上書きしませんでした" in result["reason"]
    assert sha256_of(content) == kept
    assert not (item_folder(config, item_id) / "content.partial").exists()


def test_interrupted_conflict_restore_of_a_missing_ghost_goes_back_to_missing(config, platform, db, monkeypatch,
                                                                              report):
    item_id = evacuate(db, platform, report, config)["item_id"]
    platform.simulate_user_delete(report)
    assert restore(db, platform, item_id, config)["state"] == "ghost_missing"
    report.write_bytes(b"a different file saved later by the user")
    crash_once(monkeypatch, fsutil, "no_overwrite_rename")  # 横に戻す名前の変更の直前で止まった
    with pytest.raises(RuntimeError):
        restore(db, platform, item_id, config)
    manifest = vault.read_manifest(config, item_id)
    assert (manifest["state"], manifest["restore_from"]) == ("restoring", "ghost_missing")

    platform.fail_next["ghost_status"] = UNKNOWN_STATUS  # 次の試しでは、OS 連携が答えない
    result = restore(db, platform, item_id, config)
    assert result["ok"] is False and result["state"] == "ghost_missing"  # 「ゴーストがある」（evacuated）にしない


def test_download_mark_is_kept_without_urls_and_put_back_on_a_conflict_copy(config, platform, db, report):
    platform.zone_identifiers[str(report)] = SLACK_ZONE
    item_id = evacuate(db, platform, report, config)["item_id"]
    assert vault.read_manifest(config, item_id)["zone_identifier"] == MINIMAL_ZONE
    assert "slack" not in (item_folder(config, item_id) / "manifest.json").read_text(encoding="utf-8")

    platform.simulate_user_delete(report)
    report.write_bytes(b"another file")
    result = restore(db, platform, item_id, config)
    copy = Path(result["path"])
    assert result["state"] == "restored_conflict" and copy != report
    assert platform.read_zone_identifier(copy) == MINIMAL_ZONE
    assert "Zone.Identifier を付け直しました" in result["reason"]
    assert os.stat(copy).st_mtime_ns == MTIME_NS


def test_download_mark_lost_with_the_ghost_is_put_back_in_place(config, platform, db, report):
    platform.zone_identifiers[str(report)] = SLACK_ZONE
    item_id = evacuate(db, platform, report, config)["item_id"]
    platform.zone_identifiers.pop(str(report))  # ゴーストの間に、印がなくなった場合
    result = restore(db, platform, item_id, config)
    assert result["state"] == "restored"
    assert platform.read_zone_identifier(report) == MINIMAL_ZONE
    assert os.stat(report).st_mtime_ns == MTIME_NS


def test_file_without_a_download_mark_gets_none(config, platform, db, report):
    item_id = evacuate(db, platform, report, config)["item_id"]
    assert vault.read_manifest(config, item_id)["zone_identifier"] is None
    platform.simulate_user_delete(report)
    report.write_bytes(b"another file")
    assert restore(db, platform, item_id, config)["state"] == "restored_conflict"
    assert not [call for call in platform.calls if call[0] == "write_zone_identifier"]


def test_manifest_pointing_outside_the_pip0_folder_is_not_used(config, platform, db, report, tmp_path):
    item_id = evacuate(db, platform, report, config)["item_id"]
    # 誰かが、pip0 専用フォルダーの外のファイルを指す manifest.json を、保管庫に置いた
    victim = make_file(tmp_path / "Documents" / "report.docm")
    planted_id = "f" * 32
    planted_dir = Path(config["VAULT_DIR"]) / "items" / planted_id
    planted_dir.mkdir()
    (planted_dir / "content").write_bytes((item_folder(config, item_id) / "content").read_bytes())
    planted = dict(vault.read_manifest(config, item_id), item_id=planted_id, state="evacuated",
                   original_path=str(victim), current_path=str(victim))
    fsutil.atomic_write_json(planted_dir / "manifest.json", planted)

    summary = vault.sync_from_manifests(db, config)
    assert [problem["item_id"] for problem in summary["problems"]] == [planted_id]
    assert "pip0 専用フォルダー" in summary["problems"][0]["reason"]
    assert row_of(db, planted_id) is None
    assert vault.restore(db, platform, planted_id, config, actor="user")["ok"] is False
    killswitch.restore_all(db, platform, config, now=NOW + 60)
    assert sorted(p.name for p in victim.parent.iterdir()) == ["report.docm"]  # 横にコピーを作らない


def test_ghost_moved_out_of_the_pip0_folder_becomes_missing(config, platform, db, report, tmp_path):
    item_id = evacuate(db, platform, report, config)["item_id"]
    result = vault.record_moved(db, config, item_id, tmp_path / "Desktop" / "最終報告.docx", now=NOW + 10)
    assert result["ok"] is True and "外へ移されました" in result["reason"]
    manifest = vault.read_manifest(config, item_id)
    assert manifest["state"] == "ghost_missing" and manifest["current_path"] == str(report)


def test_ghosts_in_a_renamed_folder_are_found_and_restored(config, platform, db, env):
    folder = env["PIP0_ROOT"] / "予算・会計"
    path = make_file(folder / "予算案.xlsx")
    before = fingerprint(path)
    item_id = evacuate(db, platform, path, config)["item_id"]
    renamed_folder = env["PIP0_ROOT"] / "2026予算"
    platform.simulate_user_rename(folder, renamed_folder)  # フォルダーの名前の変更は、ゴーストごとの知らせがない

    counts = killswitch.restore_all(db, platform, config, now=NOW + 60)
    assert (counts["restored"], counts["missing"]) == (1, 0)
    new_path = renamed_folder / "予算案.xlsx"
    assert fingerprint(new_path) == before
    assert vault.read_manifest(config, item_id)["current_path"] == str(new_path)
    assert platform.ghosts == {}


@pytest.mark.parametrize("answer, phrase", [
    ({"result": "unknown", "paths": [], "reason": "シェルが動いていません"}, "探せませんでした"),
    ({"result": "found", "paths": ["A", "B"], "reason": ""}, "複数ある"),
], ids=["unknown", "several"])
def test_unclear_search_does_not_guess_and_tries_again_later(config, platform, db, report, answer, phrase):
    item_id = evacuate(db, platform, report, config)["item_id"]
    renamed = report.parent / "名前を変えた報告.docx"
    platform.simulate_user_rename(report, renamed)
    if answer["paths"]:
        answer = dict(answer, paths=[str(renamed), str(report.parent / "もう一つ.docx")])
    platform.fail_next["locate_ghost"] = answer
    first = restore(db, platform, item_id, config)
    assert first["ok"] is False and first["state"] == "ghost_missing" and phrase in first["reason"]
    second = restore(db, platform, item_id, config)  # 次の試しでは、1 か所だけ見つかる
    assert second["ok"] is True and second["state"] == "restored" and second["path"] == str(renamed)
