"""コマンド（cli.py）のテスト

場所は --data-dir、--pip0-root、--downloads-dir で一時フォルダー（tmp_path）にし、鍵は MemoryKeystore、
OS 連携は代役（FakePlatform）を渡します。本物のホームフォルダーやデスクトップには触れません。
check-network だけは、監査フックをこの pytest のプロセスに入れないように、子プロセスで実行します。
"""

import hashlib
import io
import logging
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

from pip0 import cli, fsutil, killswitch, keystore, netguard, rules, scanner, service, vault
from pip0.platform_fake import FakePlatform

PROJECT_DIR = Path(__file__).resolve().parents[1]
NOW = 1_793_235_600.0


# ---------------------------------------------------------------------- 準備


def places(env):
    """一時フォルダーの場所を指定する引数"""
    return ["--data-dir", str(env["DATA_DIR"]), "--pip0-root", str(env["PIP0_ROOT"]),
            "--downloads-dir", str(env["DOWNLOADS_DIR"])]


def run(argv, **kwargs):
    """cli.main を実行し、(終了コード, 表示した文) を返す"""
    out = io.StringIO()
    code = cli.main(argv, out=out, **kwargs)
    return code, out.getvalue()


@pytest.fixture(autouse=True)
def restore_pip0_logger():
    """serve が加える記録の書き先を、テストの後に外す（ほかのテストに影響しないように）"""
    logger = logging.getLogger("pip0")
    handlers = list(logger.handlers)
    level = logger.level
    yield
    for handler in list(logger.handlers):
        if handler not in handlers:
            logger.removeHandler(handler)
            handler.close()
    logger.setLevel(level)


@pytest.fixture
def small(env):
    """小さなファイルも退避できる設定（テストの準備で使う）"""
    return dict(env, HASH_CHUNK_BYTES=4096, EVACUATE_MIN_SIZE_BYTES=1024)


def make_file(path, size=12_000, text=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    if text is not None:
        path.write_text(text, encoding="utf-8")
    else:
        path.write_bytes(bytes((i * 7 + len(path.name)) % 251 for i in range(size)))
    return path


def sha256_of(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def ghost(db, platform, config, path):
    result = vault.evacuate(db, platform, str(path), config, reasons=["テストの準備"], should_continue=lambda: True,
                            actor="user", now=NOW)
    assert result["ok"], result
    return result["item_id"]


class UnregisteringPlatform(FakePlatform):
    """同期ルートの登録の解除もできる代役（WindowsPlatform にだけある操作をまねる）"""

    def unregister_sync_root(self, path):
        self.registered_roots.discard(str(Path(path)))
        return {"ok": True, "reason": ""}


# ---------------------------------------------------------------------- demo


def test_demo_runs_end_to_end_and_prints_the_three_searches_naming_and_sensitivity(env, tmp_path):
    code, text = run(places(env) + ["demo", "--dir", str(tmp_path / "demo")])
    assert code == 0, text
    for expected in [
        "検索「青いグラフ」：一致あり（一致 1 件）", "IMG_2041.png", "色：青系", "見た目：グラフらしさ",
        "検索「Slackで貰った」：一致あり（一致 2 件）", "F0A1B2C3.pdf",
        "入手経路：Slack（ブラウザー拡張の記録：files.slack.com からのダウンロード）",
        "検索「先週の予算資料」：一致あり（一致 1 件）", "document (1).docx", "内容：タイトル・本文に「予算」",
        "M1 の改名の提案", "_青いグラフ_Slack.png", "_2026年度 予算案_Gmail.docx", "送信元不明",
        "機密の判定", "社外秘_打ち合わせメモ.txt：機密", "申請書_下書き.txt：機密",
    ]:
        assert expected in text, expected
    assert text.rstrip().endswith("結果：すべて期待どおりです")
    assert "✗" not in text
    # 作ったのは指定したフォルダーの中だけで、設定のダウンロードフォルダー・pip0 専用フォルダーには何も作らない
    assert list(Path(env["DOWNLOADS_DIR"]).iterdir()) == []
    assert list(Path(env["PIP0_ROOT"]).iterdir()) == []


def test_demo_refuses_a_folder_that_is_not_empty(env, tmp_path):
    target = tmp_path / "used"
    make_file(target / "大事なファイル.txt", text="消さないで")
    code, text = run(places(env) + ["demo", "--dir", str(target)])
    assert code == 1
    assert "空でないフォルダー" in text
    assert sorted(path.name for path in target.iterdir()) == ["大事なファイル.txt"]


# ---------------------------------------------------------------------- status、stop、resume


def test_status_shows_automation_throttle_vault_and_recorded_features(env, db, key_store):
    status_file = service.control_file(env, service.STATUS_FILE_NAME)
    status_file.parent.mkdir(parents=True, exist_ok=True)
    fsutil.atomic_write_json(status_file, {
        "running": True, "updated_at": NOW,
        "features": [{"feature": "mouse_hook", "ok": False, "label": "ドラッグの検知",
                      "reason": "低レベルのマウスフックを入れられませんでした"},
                     {"feature": "sync_root", "ok": True, "label": "pip0 専用フォルダーの同期ルート", "reason": ""}],
    })
    platform = FakePlatform(idle_seconds=12, power="ac")
    code, text = run(places(env) + ["status"], keystore=key_store, platform=platform)
    assert code == 0, text
    for expected in ["常駐処理：動いていません", "自動処理：動いてよい状態です",
                     "高負荷の処理（解析・退避）：今は待機します",
                     "操作中です（無操作 12秒、必要 180秒）", "解析の順番待ち：0 件", "保管庫：項目はありません",
                     "今は動いていません", "× ドラッグの検知：低レベルのマウスフックを入れられませんでした",
                     "○ pip0 専用フォルダーの同期ルート"]:
        assert expected in text, expected


def test_status_without_a_platform_does_not_pretend_the_conditions_are_met(env, key_store):
    code, text = run(["status"] + places(env), keystore=key_store)  # 場所の指定はコマンドの後でもよい
    assert code == 0
    assert "電源と無操作の時間を読み取れません" in text and "条件を満たしたことにはしません" in text
    assert "暗号化DB はまだありません" in text  # 表示だけのコマンドは、DB を作らない
    assert not Path(env["DB_PATH"]).exists()


def test_stop_then_resume_needs_the_word_hai(env, db, key_store, monkeypatch):
    code, text = run(places(env) + ["stop"], keystore=key_store)
    assert code == 0 and "自動処理を止めました" in text
    assert killswitch.is_engaged(db, env)
    code, text = run(places(env) + ["status"], keystore=key_store, platform=FakePlatform())
    assert "自動処理：止まっています" in text

    monkeypatch.setattr(sys, "stdin", io.StringIO("いいえ\n"))
    code, text = run(places(env) + ["resume"], keystore=key_store)
    assert code == 1 and "再開しませんでした" in text
    assert killswitch.is_engaged(db, env)

    monkeypatch.setattr(sys, "stdin", io.StringIO(""))  # 入力がない（画面のないプロセスなど）も、再開しない
    assert run(places(env) + ["resume"], keystore=key_store)[0] == 1

    monkeypatch.setattr(sys, "stdin", io.StringIO("はい\n"))
    code, text = run(places(env) + ["resume"], keystore=key_store)
    assert code == 0 and "自動処理を再開しました" in text
    assert not killswitch.is_engaged(db, env)

    assert run(places(env) + ["stop"], keystore=key_store)[0] == 0
    assert run(places(env) + ["resume", "--yes"], keystore=key_store)[0] == 0
    assert not killswitch.is_engaged(db, env)


def test_stop_works_without_the_database_key(env, db):
    code, text = run(places(env) + ["stop"], keystore=keystore.MemoryKeystore())  # 鍵がない
    assert code == 0
    assert "停止の印のファイルで止めています" in text
    assert killswitch.is_engaged(None, env)


def test_resume_is_refused_while_a_restore_all_is_unfinished(env, db, key_store, platform, small):
    ghost(db, platform, small, make_file(Path(env["PIP0_ROOT"]) / "退避済み.pdf"))
    killswitch.restore_all(db, platform, env, should_stop=lambda: True)
    code, text = run(places(env) + ["resume", "--yes"], keystore=key_store)
    assert code == 1 and "全復元が途中です" in text


# ---------------------------------------------------------------------- vault、restore-all


def test_vault_list_reads_the_database_and_falls_back_to_manifests_without_the_key(env, db, key_store, platform,
                                                                                   small):
    item_id = ghost(db, platform, small, make_file(Path(env["PIP0_ROOT"]) / "退避済み.pdf"))
    code, text = run(places(env) + ["vault", "list"], keystore=key_store)
    assert code == 0
    assert item_id in text and "退避中（元の場所にゴースト）" in text and "退避済み.pdf" in text

    code, text = run(places(env) + ["vault", "list"], keystore=keystore.MemoryKeystore())
    assert code == 0
    assert "manifest.json から読み直して" in text and item_id in text


def test_vault_restore_brings_back_one_item_and_refuses_malformed_ids(env, db, key_store, platform, small):
    path = make_file(Path(env["PIP0_ROOT"]) / "退避済み.pdf")
    digest = sha256_of(path)
    item_id = ghost(db, platform, small, path)
    code, text = run(places(env) + ["vault", "restore", "../../etc/passwd"], keystore=key_store, platform=platform)
    assert code == 2 and "項目ID の形が正しくありません" in text
    code, text = run(places(env) + ["vault", "restore", item_id.upper()], keystore=key_store, platform=platform)
    assert code == 0, text
    assert "復元済み" in text
    assert platform.ghosts == {} and sha256_of(path) == digest


def test_vault_restore_needs_windows_without_a_platform(env, key_store):
    code, text = run(places(env) + ["vault", "restore", "0" * 32], keystore=key_store)
    assert code == 2 and "Windows" in text


def test_restore_all_without_a_running_service_restores_everything(env, db, key_store, platform, small):
    paths = [make_file(Path(env["PIP0_ROOT"]) / name) for name in ["a.pdf", "b.docx"]]
    digests = [sha256_of(path) for path in paths]
    for path in paths:
        ghost(db, platform, small, path)
    code, text = run(places(env) + ["restore-all"], keystore=key_store, platform=platform)
    assert code == 0, text
    assert "結果：全 2 件中 2 件：復元 2" in text
    assert "自動処理は止まったままです" in text
    assert platform.ghosts == {} and [sha256_of(path) for path in paths] == digests
    assert killswitch.is_engaged(db, env)
    assert service.is_running(env) is False  # 使い終わったロックは放している


def test_restore_all_works_after_losing_the_database_key(env, db, platform, small):
    path = make_file(Path(env["PIP0_ROOT"]) / "a.pdf")
    ghost(db, platform, small, path)
    code, text = run(places(env) + ["restore-all"], keystore=keystore.MemoryKeystore(), platform=platform)
    assert code == 0, text
    assert "manifest.json から読み直して" in text
    assert platform.ghosts == {}
    assert Path(env["DB_PATH"]).exists()  # 古い DB は消さない・上書きしない


def test_restore_all_exit_code_is_not_zero_when_a_ghost_is_missing(env, db, key_store, platform, small):
    path = make_file(Path(env["PIP0_ROOT"]) / "a.pdf")
    ghost(db, platform, small, path)
    platform.simulate_user_delete(str(path))
    code, text = run(places(env) + ["restore-all"], keystore=key_store, platform=platform)
    assert code == 1
    assert "見つからない 1" in text and "中身は保管庫に残っています" in text


def test_restore_all_on_a_pc_without_windows_lists_the_vault_and_explains(env, db, platform, small):
    item_id = ghost(db, platform, small, make_file(Path(env["PIP0_ROOT"]) / "a.pdf"))
    code, text = run(places(env) + ["restore-all"], keystore=keystore.MemoryKeystore())
    assert code == 2
    assert item_id in text and "Windows" in text
    assert str(Path(env["PIP0_ROOT"]) / "a.pdf") in platform.ghosts  # 何も変えていない


def test_restore_all_asks_a_running_service_and_shows_its_progress(env, db, platform, small, monkeypatch):
    monkeypatch.setattr(cli, "PROGRESS_POLL_SECONDS", 0.05)
    ghost(db, platform, small, make_file(Path(env["PIP0_ROOT"]) / "a.pdf"))
    lock = service.InstanceLock(env)  # 常駐処理が動いている（ロックを持っている）ことをまねる
    assert lock.acquire()
    results = {}
    try:
        def ask():
            results["code"], results["text"] = run(places(env) + ["restore-all"])

        thread = threading.Thread(target=ask)
        thread.start()
        # 常駐処理の役：依頼を受け取り、全復元する
        deadline = time.time() + 10
        request = None
        while request is None and time.time() < deadline:
            request = killswitch.take_restore_request(env)
            time.sleep(0.02)
        assert request is not None
        assert killswitch.is_engaged(None, env)  # 依頼と同時に、停止の印も書かれている
        killswitch.restore_all(db, platform, env)
        thread.join(timeout=10)
        assert not thread.is_alive()
    finally:
        lock.release()
    assert results["code"] == 0, results["text"]
    assert "動いている pip0 に全復元を依頼しました" in results["text"]
    assert "結果：全 1 件中 1 件：復元 1" in results["text"]
    assert platform.ghosts == {}


# ---------------------------------------------------------------------- serve、shutdown


def test_serve_needs_windows_and_suggests_the_demo(env, key_store):
    code, text = run(places(env) + ["serve"], keystore=key_store)
    assert code == 2
    assert "Windows 11 でだけ動きます" in text and "python -m pip0 demo" in text


def test_serve_runs_until_shutdown_and_refuses_a_second_instance(env, key_store, monkeypatch):
    monkeypatch.setattr(netguard, "install", lambda allowed=(): None)  # 監査フックは pytest のプロセスに入れない
    platform = FakePlatform(vault_dir=env["VAULT_DIR"])
    results = {}

    def serve():
        results["code"], results["text"] = run(places(env) + ["serve", "--no-shell"], keystore=key_store,
                                               platform=platform)

    thread = threading.Thread(target=serve)
    thread.start()
    try:
        deadline = time.time() + 15
        while service.read_status_file(env) is None and time.time() < deadline:
            time.sleep(0.05)
        assert service.is_running(env) is True
        code, text = run(places(env) + ["serve", "--no-shell"], keystore=key_store, platform=FakePlatform())
        assert code == 1 and service.ALREADY_RUNNING_REASON in text
        code, text = run(places(env) + ["status"], keystore=key_store, platform=platform)
        assert "常駐処理：動いています" in text and "pip0 シェルなしで動いています" in text
    finally:
        code, text = run(places(env) + ["shutdown"])
        thread.join(timeout=30)
    assert code == 0 and "終了しました" in text
    assert not thread.is_alive()
    assert results["code"] == 0, results["text"]
    assert service.is_running(env) is False
    log_text = (Path(env["LOG_DIR"]) / cli.LOG_FILE_NAME).read_text(encoding="utf-8")
    assert "常駐処理を始めました" in log_text and str(env["PIP0_ROOT"]) not in log_text


def test_shutdown_when_nothing_is_running(env):
    code, text = run(places(env) + ["shutdown"])
    assert code == 0 and "動いていません" in text


def test_serve_without_the_database_key_records_why_it_did_not_start(env, db, monkeypatch):
    monkeypatch.setattr(netguard, "install", lambda allowed=(): None)
    code, text = run(places(env) + ["serve", "--no-shell"], keystore=keystore.MemoryKeystore(), platform=FakePlatform())
    assert code == 1 and "暗号化DB を開けないため" in text
    code, text = run(places(env) + ["status"], keystore=keystore.MemoryKeystore(), platform=FakePlatform())
    assert "前回、起動できなかった理由" in text


# ---------------------------------------------------------------------- search、delete


def test_search_prints_matches_with_their_reasons(env, db, key_store, platform):
    make_file(Path(env["PIP0_ROOT"]) / "2026年度予算メモ.txt", text="メモ\n")
    scanner.scan_all(db, platform, env, rules, NOW)
    code, text = run(places(env) + ["search", "予算"], keystore=key_store)
    assert code == 0, text
    assert "検索「予算」：一致あり" in text and "2026年度予算メモ.txt" in text
    code, text = run(places(env) + ["search", "赤い写真"], keystore=key_store)
    assert code == 1


def test_delete_moves_to_the_recycle_bin_only_after_approval(env, db, key_store, platform):
    path = make_file(Path(env["PIP0_ROOT"]) / "要らないファイル.txt", text="x")
    platform.dialog_answer = "cancel"
    code, text = run(places(env) + ["delete", str(path)], keystore=key_store, platform=platform)
    assert code == 1 and "承認されなかったため、何も削除していません" in text
    assert path.exists()
    platform.dialog_answer = "approve"
    code, text = run(places(env) + ["delete", str(path)], keystore=key_store, platform=platform)
    assert code == 0, text
    assert not path.exists() and (platform.trash_dir / "要らないファイル.txt").exists()
    assert len(platform.dialog_requests) == 2  # 削除のたびに確認画面を出す


def test_delete_without_a_recycle_bin_is_refused_and_never_falls_back(env, db, key_store, platform):
    platform.recycle_bin_available = False
    path = make_file(Path(env["PIP0_ROOT"]) / "ごみ箱のない場所.txt", text="x")
    platform.dialog_answer = "approve"
    code, text = run(places(env) + ["delete", str(path)], keystore=key_store, platform=platform)
    assert code == 1 and "ごみ箱を使えないため、削除しませんでした" in text
    assert path.exists()


def test_delete_needs_windows_without_a_platform(env, key_store):
    path = make_file(Path(env["PIP0_ROOT"]) / "a.txt", text="x")
    code, text = run(places(env) + ["delete", str(path)], keystore=key_store)
    assert code == 2 and path.exists()


# ---------------------------------------------------------------------- register-root、unregister-root


def test_register_root_with_the_given_platform(env, key_store):
    platform = FakePlatform()
    code, text = run(places(env) + ["register-root"], keystore=key_store, platform=platform)
    assert code == 0, text
    assert platform.is_sync_root_registered(env["PIP0_ROOT"]) is True


def test_unregister_root_is_refused_while_a_ghost_remains(env, db, key_store, small):
    platform = UnregisteringPlatform(vault_dir=env["VAULT_DIR"])
    platform.register_sync_root(env["PIP0_ROOT"], "pip0")
    path = make_file(Path(env["PIP0_ROOT"]) / "a.pdf")
    item_id = ghost(db, platform, small, path)
    code, text = run(places(env) + ["unregister-root"], keystore=key_store, platform=platform)
    assert code == 1 and "解除しません" in text
    assert platform.is_sync_root_registered(env["PIP0_ROOT"]) is True
    vault.restore(db, platform, item_id, env, actor="user")
    code, text = run(places(env) + ["unregister-root"], keystore=key_store, platform=platform)
    assert code == 0, text
    assert platform.is_sync_root_registered(env["PIP0_ROOT"]) is False


def test_unregister_root_skips_folders_without_a_record_or_content(env, key_store):
    """項目ではないフォルダーと、manifest.json も中身もない項目のフォルダーでは止めない（uninstall.ps1 と同じ決まり）

    中身（content、content.partial）があって manifest.json がない項目では、中身を失わないように止める。
    """
    platform = UnregisteringPlatform(vault_dir=env["VAULT_DIR"])
    platform.register_sync_root(env["PIP0_ROOT"], "pip0")
    items = Path(env["VAULT_DIR"]) / "items"
    (items / ("a" * 32)).mkdir(parents=True)  # 最初の manifest.json を書く前に止まった項目
    (items / ("b" * 32)).mkdir()
    (items / ("b" * 32) / "manifest.json.tmp").write_text("{", encoding="utf-8")
    (items / "not-an-item").mkdir()
    code, text = run(places(env) + ["unregister-root"], keystore=key_store, platform=platform)
    assert code == 0, text
    assert platform.is_sync_root_registered(env["PIP0_ROOT"]) is False

    platform.register_sync_root(env["PIP0_ROOT"], "pip0")
    (items / ("c" * 32)).mkdir()
    (items / ("c" * 32) / "content").write_bytes(b"the only copy")
    code, text = run(places(env) + ["unregister-root"], keystore=key_store, platform=platform)
    assert code == 1 and "読めない manifest.json が 1 件" in text
    assert platform.is_sync_root_registered(env["PIP0_ROOT"]) is True


# ---------------------------------------------------------------------- check-encryption、check-network、使い方


def test_check_encryption_reports_an_encrypted_database(env, db, key_store):
    code, text = run(places(env) + ["check-encryption"], keystore=key_store)
    assert code == 0, text
    assert "暗号化されています" in text and "temp_store=2" in text


def test_check_encryption_without_the_key_fails_clearly(env, db):
    code, text = run(places(env) + ["check-encryption"], keystore=keystore.MemoryKeystore())
    assert code == 1 and "鍵" in text


def test_check_network_runs_in_its_own_process_and_everything_is_blocked(tmp_path):
    result = subprocess.run([sys.executable, "-m", "pip0", "--data-dir", str(tmp_path / "data"), "check-network"],
                            cwd=PROJECT_DIR, capture_output=True, text=True, encoding="utf-8", timeout=120,
                            env=dict(os.environ, PYTHONPATH=str(PROJECT_DIR)))
    assert result.returncode == 0, result.stdout + result.stderr
    assert "結果：すべて止まりました" in result.stdout
    assert "network-policy.ps1" in result.stdout


def test_usage_errors_and_help(env):
    assert run(["no-such-command"])[0] == 2
    code, text = run([])
    assert code == 2 and "restore-all" in text
    assert run(["vault"] + places(env))[0] == 2
