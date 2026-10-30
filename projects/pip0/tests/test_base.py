"""基盤（設定、時刻、暗号化DB、鍵）のテスト"""

import os
import time
from datetime import datetime

import pytest

from pip0 import config as config_module
from pip0 import database, keystore, timeutil


def set_timezone(monkeypatch, tz):
    monkeypatch.setenv("TZ", tz)
    time.tzset()


@pytest.fixture
def tokyo(monkeypatch):
    set_timezone(monkeypatch, "Asia/Tokyo")
    yield
    monkeypatch.undo()
    time.tzset()


# ---------------------------------------------------------------------- 設定


def test_config_rejects_vault_inside_pip0_root(tmp_path):
    config = config_module.load_config(
        overrides={"PIP0_ROOT": tmp_path / "pip0", "DATA_DIR": tmp_path / "data",
                   "VAULT_DIR": tmp_path / "pip0" / "vault", "DOWNLOADS_DIR": tmp_path / "dl"},
        read_user_file=False,
    )
    assert any("保管庫" in message for message in config["CONFIG_ERRORS"])


def test_config_reads_user_file_and_ignores_unknown_keys(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "config.json").write_text('{"MINI_DOCK_SECONDS": 5, "NO_SUCH_KEY": 1}', encoding="utf-8")
    config = config_module.load_config(overrides={"DATA_DIR": data_dir})
    assert config["MINI_DOCK_SECONDS"] == 5
    assert any("NO_SUCH_KEY" in message for message in config["CONFIG_WARNINGS"])
    assert config["DB_PATH"] == data_dir.resolve() / "pip0.db"


# ---------------------------------------------------------------------- 時刻


def test_last_week_is_monday_to_sunday_in_local_time(tokyo):
    now_ts = datetime(2026, 10, 29, 10, 0).timestamp()  # 木曜日
    period = timeutil.find_period("先週の予算資料", now_ts)
    assert period["word"] == "先週"
    assert datetime.fromtimestamp(period["start"]) == datetime(2026, 10, 19, 0, 0)
    assert datetime.fromtimestamp(period["end"]) == datetime(2026, 10, 26, 0, 0)
    assert "2026-10-19（月）〜2026-10-25（日）" in period["label"]
    assert period["span"] == (0, 2)


def test_week_can_start_on_sunday(tokyo):
    now_ts = datetime(2026, 10, 29, 10, 0).timestamp()
    period = timeutil.find_period("先週", now_ts, week_starts_on=6)
    assert datetime.fromtimestamp(period["start"]) == datetime(2026, 10, 18, 0, 0)


def test_relative_days_and_kanji_numbers(tokyo):
    now_ts = datetime(2026, 10, 29, 10, 0).timestamp()
    period = timeutil.find_period("三日前にもらった", now_ts)
    assert datetime.fromtimestamp(period["start"]) == datetime(2026, 10, 26, 0, 0)
    period = timeutil.find_period("2か月前", now_ts)
    assert datetime.fromtimestamp(period["start"]) == datetime(2026, 8, 1, 0, 0)
    assert timeutil.find_period("予算資料", now_ts) is None


def test_period_follows_daylight_saving_time(monkeypatch):
    # 夏時間のある地域でも、現地の0時を境にする（ニューヨークは 2026-11-01 に夏時間が終わる）
    set_timezone(monkeypatch, "America/New_York")
    try:
        now_ts = datetime(2026, 11, 4, 12, 0).timestamp()
        period = timeutil.find_period("先週", now_ts)
        assert datetime.fromtimestamp(period["start"]) == datetime(2026, 10, 26, 0, 0)
        assert datetime.fromtimestamp(period["end"]) == datetime(2026, 11, 2, 0, 0)
        assert period["end"] - period["start"] == 7 * 24 * 3600 + 3600  # 夏時間の終わりで1時間長い
    finally:
        monkeypatch.undo()
        time.tzset()


# ---------------------------------------------------------------------- 暗号化DB


def test_database_is_encrypted_on_disk_including_wal(env, key_store):
    conn = database.open_database(env, keystore=key_store)
    marker = "PLAINTEXT_MARKER_予算資料_0123456789"
    database.set_setting(conn, "marker", marker)
    database.log_operation(conn, "test", actor="system", status="done", reasons=[marker])
    # 接続を開いたまま（WAL が残っている状態）で、ファイルの中身を調べる
    files = [p for p in env["DB_PATH"].parent.iterdir() if p.name.startswith("pip0.db")]
    assert any(p.name.endswith("-wal") for p in files)
    for path in files:
        raw = path.read_bytes()
        assert marker.encode("utf-8") not in raw
        assert b"PLAINTEXT_MARKER" not in raw
        assert b"SQLite format 3" not in raw[:16]
    assert database.check_encryption(conn)["temp_store"] == 2
    conn.close()


def test_database_needs_the_right_key(env):
    store = keystore.MemoryKeystore()
    conn = database.open_database(env, keystore=store)
    database.set_setting(conn, "x", "1")
    conn.close()
    with pytest.raises(database.DatabaseKeyError):
        database.open_encrypted(env["DB_PATH"], keystore.new_key_hex())
    # 鍵がない（OS の鍵保管機構から消えた）ときは、新しい鍵を作らずに止まる
    with pytest.raises(keystore.KeyMissing):
        database.open_database(env, keystore=keystore.MemoryKeystore())
    conn = database.open_database(env, keystore=store)
    assert database.get_setting(conn, "x") == "1"
    conn.close()


def test_plain_sqlite_cannot_read_the_database(env, key_store):
    import sqlite3

    conn = database.open_database(env, keystore=key_store)
    database.set_setting(conn, "x", "1")
    conn.close()
    with pytest.raises(sqlite3.DatabaseError):
        sqlite3.connect(env["DB_PATH"]).execute("SELECT * FROM settings_kv").fetchall()


def test_missing_sqlcipher_does_not_fall_back_to_plain_sqlite(env, key_store, monkeypatch):
    import builtins

    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name.startswith("sqlcipher3"):
            raise ImportError("no sqlcipher3")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    with pytest.raises(database.EncryptionUnavailable):
        database.open_database(env, keystore=key_store)
    assert not env["DB_PATH"].exists()


def test_os_keystore_refuses_plaintext_backends(monkeypatch):
    import keyring
    from keyring.backends import fail

    monkeypatch.setattr(keyring, "get_keyring", lambda: fail.Keyring())
    with pytest.raises(keystore.KeystoreUnavailable):
        keystore.OsKeystore()


def test_transaction_rolls_back_on_error(db):
    with pytest.raises(RuntimeError):
        with database.transaction(db):
            database.set_setting(db, "a", "1")
            raise RuntimeError("途中で失敗")
    assert database.get_setting(db, "a") is None


def test_first_creation_by_two_processes_makes_only_one_key(env):
    # 受け口（ブラウザーが起動）と常駐処理が、初めて同時に DB を作る場面をまねる
    import threading

    class SlowKeystore(keystore.MemoryKeystore):
        def get_key(self):
            value = super().get_key()
            time.sleep(0.05)  # 確かめてから作るまでの間に、もう一方が割り込めるようにする
            return value

    shared = SlowKeystore()
    results = []

    def open_once():
        conn = database.open_database(env, keystore=shared)
        database.set_setting(conn, "opened", "1")
        results.append(conn)

    threads = [threading.Thread(target=open_once) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert len(results) == 2
    for conn in results:
        conn.close()
    conn = database.open_encrypted(env["DB_PATH"], shared.get_key())  # 保管された鍵で読める
    assert database.get_setting(conn, "opened") == "1"
    conn.close()


def test_wal_and_journal_files_stay_in_data_dir(env, key_store):
    conn = database.open_database(env, keystore=key_store)
    database.set_setting(conn, "x", "1")
    names = sorted(os.listdir(env["DB_PATH"].parent))
    assert all(name.startswith("pip0.db") for name in names)
    conn.close()
