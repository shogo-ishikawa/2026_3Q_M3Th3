"""ブラウザー拡張の受け口（native_host.py）のテスト

ブラウザーの代わりに、io.BytesIO を標準入出力として渡します。鍵は MemoryKeystore（メモリーだけ）、
DB は一時フォルダーの暗号化DB です。外部通信の禁止（netguard）は、テストのプロセスに入れないよう
install_guard=False で呼びます（入れる順序のテストでは、代役のモジュールを使います）。
"""

import io
import json
import struct
import sys
import types

import pytest

import pip0
from pip0 import database, keystore, native_host, provenance

ORIGIN = "chrome-extension://jfaghnlhhcojgeodhjalkchddhphnmhi/"  # settings.ALLOWED_EXTENSION_ORIGINS


def frame(obj):
    """ブラウザーと同じ形（4バイトの長さ＋UTF-8 の JSON）にする"""
    body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    return struct.pack("=I", len(body)) + body


def download_message(filename, **download_values):
    """docs/ipc-protocol.md の5節の例と同じ形のメッセージ"""
    download = {
        "id": 42,
        "url": "https://files.slack.com/files-pri/T0-F0/report.pdf?t=xoxe-SECRET-TOKEN",
        "finalUrl": "https://files.slack.com/files-pri/T0-F0/report.pdf?t=xoxe-SECRET-TOKEN#page=2",
        "referrer": "https://app.slack.com/client/T0/C0?cdn_fallback=1",
        "filename": str(filename),
        "mime": "application/pdf",
        "startTime": "2026-10-29T03:12:00.000Z",
        "endTime": "2026-10-29T03:12:04.500Z",
        "fileSize": 123456,
        "danger": "safe",
        "incognito": False,
    }
    download.update(download_values)
    return {
        "type": "download_completed",
        "protocol": 1,
        "browser": "chrome",
        "download": download,
        "page": {
            "tabUrl": "https://app.slack.com/client/T0/C0?redir=secret",
            "tabTitle": "予算 (Channel) - ws - Slack",
            "capturedAt": "2026-10-29T03:12:00.010Z",
            "capture": "active_tab_at_download_start",
        },
    }


def run_host(env, key_store, data, argv=None, install_guard=False):
    """受け口を1回動かし、(終了コード, 返事の辞書, 返事のバイト列, 入力) を返す"""
    stdin = io.BytesIO(data)
    stdout = io.BytesIO()
    code = native_host.main(argv or ["pip0.native_host", ORIGIN], stdin=stdin, stdout=stdout,
                            config=env, keystore=key_store, install_guard=install_guard)
    raw = stdout.getvalue()
    length = struct.unpack("=I", raw[:4])[0]
    assert len(raw) == 4 + length  # 返事はちょうど1件
    return code, json.loads(raw[4:].decode("utf-8")), raw, stdin


def stored(db):
    return database.query_all(db, "SELECT * FROM download_events ORDER BY id")


@pytest.fixture
def downloaded(env):
    return env["DOWNLOADS_DIR"] / "report.pdf"


# ---------------------------------------------------------------------- 記録する場合


def test_valid_message_is_stored_without_query_strings(env, db, key_store, downloaded):
    message = download_message(downloaded)
    message["page"]["tabTitle"] = "予算\n(Channel)\x00 - ws - Slack; rm -rf ~ && calc.exe"
    code, reply, raw, _ = run_host(env, key_store, frame(message))
    assert code == 0
    assert reply == {"ok": True, "stored": True}

    rows = stored(db)
    assert len(rows) == 1
    row = rows[0]
    assert row["extension_origin"] == ORIGIN
    assert row["browser"] == "chrome"
    assert row["browser_download_id"] == 42
    assert row["filename"] == str(downloaded)
    assert row["url"] == "https://files.slack.com/files-pri/T0-F0/report.pdf"
    assert row["final_url"] == "https://files.slack.com/files-pri/T0-F0/report.pdf"
    assert row["referrer_url"] == "https://app.slack.com/client/T0/C0"
    assert row["tab_url"] == "https://app.slack.com/client/T0/C0"
    # ページの題名は、制御文字を除いて記録するだけ（コマンドとして扱わない）
    assert row["tab_title"] == "予算 (Channel)  - ws - Slack; rm -rf ~ && calc.exe"
    assert row["mime"] == "application/pdf"
    assert row["started_at"] == 1793243520.0
    assert row["ended_at"] == 1793243524.5
    assert row["file_size"] == 123456
    assert row["state"] == "pending"
    for table_row in rows:
        assert "SECRET" not in json.dumps(table_row, ensure_ascii=False)

    # 受け取った内容を返事に入れない
    for text in ["files.slack.com", "SECRET", "予算", "report.pdf"]:
        assert text.encode("utf-8") not in raw



def test_downloads_saved_outside_the_downloads_folder_are_not_stored(env, db, key_store):
    # 「名前を付けて保存」で別のフォルダーへ保存したものは、pip0 の対象外。URL もタブの題名も残さない
    message = download_message(env["PIP0_ROOT"] / "給与明細.pdf")
    code, reply, _raw, _ = run_host(env, key_store, frame(message))
    assert code == 0
    assert reply["ok"] is True and reply["stored"] is False
    assert stored(db) == []

def test_parent_window_argument_is_ignored(env, db, key_store, downloaded):
    argv = ["pip0.native_host", ORIGIN, "--parent-window=1234"]
    code, reply, _, _ = run_host(env, key_store, frame(download_message(downloaded)), argv=argv)
    assert reply == {"ok": True, "stored": True}
    assert len(stored(db)) == 1


def test_database_is_created_when_missing(env, key_store, downloaded):
    # pip0 本体を一度も起動していなくても、受け口は鍵と暗号化DB を作って記録する
    assert not env["DB_PATH"].exists()
    _, reply, _, _ = run_host(env, key_store, frame(download_message(downloaded)))
    assert reply == {"ok": True, "stored": True}
    conn = database.open_database(env, keystore=key_store)
    try:
        assert len(stored(conn)) == 1
    finally:
        conn.close()


def test_ping_stores_nothing_and_does_not_open_the_database(env, key_store):
    code, reply, _, _ = run_host(env, key_store, frame({"type": "ping", "protocol": 1}))
    assert code == 0
    assert reply == {"ok": True, "pong": True}
    assert not env["DB_PATH"].exists()
    assert key_store.get_key() is None


# ---------------------------------------------------------------------- 断る場合


@pytest.mark.parametrize("argv", [
    ["pip0.native_host", "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"],
    ["pip0.native_host", ORIGIN.rstrip("/")],
    ["pip0.native_host", "--parent-window=1234", ORIGIN],
    ["pip0.native_host"],
])
def test_unknown_origin_is_refused_without_reading(env, db, key_store, downloaded, argv):
    code, reply, raw, stdin = run_host(env, key_store, frame(download_message(downloaded)), argv=argv)
    assert code == 0
    assert reply["ok"] is False
    assert "許可されていない" in reply["error"]
    assert stdin.tell() == 0  # メッセージを読んでいない
    assert stored(db) == []
    assert b"aaaaaaaa" not in raw


def test_origin_must_match_exactly_even_if_configured_as_text(env, db, key_store, downloaded):
    config = dict(env)
    config["ALLOWED_EXTENSION_ORIGINS"] = ORIGIN  # config.json にリストでなく文字列で書いた場合
    _, reply, _, _ = run_host(config, key_store, frame(download_message(downloaded)),
                              argv=["pip0.native_host", "chrome-extension://"])
    assert reply["ok"] is False  # 部分一致では許可しない
    _, reply, _, _ = run_host(config, key_store, frame(download_message(downloaded)))
    assert reply == {"ok": True, "stored": True}
    assert len(stored(db)) == 1


class RecordingStream(io.BytesIO):
    """read で求められたバイト数を記録する（大きすぎるメッセージを読んでいないことの確認）"""

    def __init__(self, data):
        super().__init__(data)
        self.requested = []

    def read(self, size=-1):
        self.requested.append(size)
        return super().read(size)


def test_oversized_message_is_refused_without_reading_it(env, db, key_store):
    stdin = RecordingStream(struct.pack("=I", 2 * 1024 * 1024) + b"{" * 64)
    stdout = io.BytesIO()
    assert native_host.main(["pip0.native_host", ORIGIN], stdin=stdin, stdout=stdout, config=env,
                            keystore=key_store, install_guard=False) == 0
    reply = json.loads(stdout.getvalue()[4:].decode("utf-8"))
    assert reply["ok"] is False
    assert "大きすぎる" in reply["error"]
    assert stdin.requested == [4]  # 長さの4バイトだけを読んだ
    assert stored(db) == []


@pytest.mark.parametrize("data, words", [
    (b"", "長さを読めません"),
    (b"\x05\x00", "長さを読めません"),
    (struct.pack("=I", 0), "空です"),
    (struct.pack("=I", 100) + b'{"type": "ping"', "途中で終わっています"),
    (struct.pack("=I", 9) + b"not json!", "JSON として読めません"),
    (struct.pack("=I", 4) + b"\xff\xfe{}", "JSON として読めません"),
    (struct.pack("=I", 3) + b"NaN", "JSON として読めません"),
    (frame(["download_completed"]), "オブジェクトではありません"),
    (frame("ping"), "オブジェクトではありません"),
])
def test_broken_messages_are_refused(env, db, key_store, data, words):
    code, reply, _, _ = run_host(env, key_store, data)
    assert code == 0
    assert reply["ok"] is False
    assert words in reply["error"]
    assert stored(db) == []


def test_deeply_nested_json_is_refused(env, db, key_store):
    body = b'{"a": ' + b"[" * 100000 + b"]" * 100000 + b"}"
    code, reply, _, _ = run_host(env, key_store, struct.pack("=I", len(body)) + body)
    assert reply["ok"] is False
    assert stored(db) == []


def test_incognito_download_is_refused(env, db, key_store, downloaded):
    _, reply, _, _ = run_host(env, key_store, frame(download_message(downloaded, incognito=True)))
    assert reply["ok"] is False
    assert "シークレット ウィンドウのダウンロードは記録しません" in reply["error"]
    message = download_message(downloaded)
    del message["download"]["incognito"]
    _, reply, _, _ = run_host(env, key_store, frame(message))
    assert reply["ok"] is False
    assert stored(db) == []


def test_invalid_message_reply_does_not_echo_content(env, db, key_store):
    message = download_message("relative\\report.pdf", id="not-a-number")
    _, reply, raw, _ = run_host(env, key_store, frame(message))
    assert reply["ok"] is False
    assert "番号（id）" in reply["error"]
    assert "絶対パスではありません" in reply["error"]
    for text in ["not-a-number", "relative", "files.slack.com", "予算"]:
        assert text.encode("utf-8") not in raw
    assert stored(db) == []


def test_database_problems_are_reported(env, db, key_store, downloaded):
    wrong_key = keystore.MemoryKeystore(keystore.new_key_hex())
    code, reply, _, _ = run_host(env, wrong_key, frame(download_message(downloaded)))
    assert code == 0
    assert reply["ok"] is False
    assert "暗号化DB を開けない" in reply["error"]

    no_data_dir = dict(env)
    no_data_dir["DB_PATH"] = None
    _, reply, _, _ = run_host(no_data_dir, key_store, frame(download_message(downloaded)))
    assert reply["ok"] is False
    assert "DATA_DIR" in reply["error"]
    assert stored(db) == []


def test_unexpected_errors_still_get_a_reply(env, db, key_store, downloaded, monkeypatch):
    def broken_store(*args):
        raise RuntimeError("予想していない失敗 C:\\Users\\u\\secret.pdf")

    monkeypatch.setattr(provenance, "store_download_event", broken_store)
    code, reply, raw, _ = run_host(env, key_store, frame(download_message(downloaded)))
    assert code == 0
    assert reply == {"ok": False, "error": "受け口でエラーが起きたため、記録しませんでした（RuntimeError）"}
    assert b"secret" not in raw


# ---------------------------------------------------------------------- 外部通信の禁止と標準入出力


def fake_netguard(monkeypatch, install):
    """pip0.netguard の代役を入れる（本物の監査フックは、テストのプロセスから外せないため）"""
    module = types.ModuleType("pip0.netguard")
    module.install = install
    monkeypatch.setitem(sys.modules, "pip0.netguard", module)
    monkeypatch.setattr(pip0, "netguard", module, raising=False)


def test_network_guard_is_installed_first(env, db, key_store, downloaded, monkeypatch):
    data = frame(download_message(downloaded))
    stdin = io.BytesIO(data)
    positions = []
    fake_netguard(monkeypatch, lambda allowed_executables=(): positions.append(stdin.tell()))
    stdout = io.BytesIO()
    native_host.main(["pip0.native_host", ORIGIN], stdin=stdin, stdout=stdout, config=env,
                     keystore=key_store, install_guard=True)
    assert positions == [0]  # メッセージを読む前に入れた
    assert json.loads(stdout.getvalue()[4:]) == {"ok": True, "stored": True}


def test_nothing_is_stored_when_the_guard_cannot_be_installed(env, db, key_store, downloaded, monkeypatch):
    def failing_install(allowed_executables=()):
        raise RuntimeError("監査フックを入れられない")

    fake_netguard(monkeypatch, failing_install)
    _, reply, _, stdin = run_host(env, key_store, frame(download_message(downloaded)), install_guard=True)
    assert reply["ok"] is False
    assert "netguard" in reply["error"]
    assert stdin.tell() == 0
    assert stored(db) == []


def test_standard_streams_and_stray_prints(env, db, key_store, downloaded, monkeypatch, capsys):
    out_bytes = io.BytesIO()
    fake_stdout = io.TextIOWrapper(out_bytes, encoding="utf-8")
    monkeypatch.setattr(sys, "stdin", io.TextIOWrapper(io.BytesIO(frame(download_message(downloaded))),
                                                       encoding="utf-8"))
    monkeypatch.setattr(sys, "stdout", fake_stdout)
    monkeypatch.setattr(sys, "argv", ["pip0.native_host", ORIGIN, "--parent-window=1"])
    real_store = provenance.store_download_event

    def noisy_store(*args):
        print("うっかり print した文字")  # 返事に混ざってはいけない
        return real_store(*args)

    monkeypatch.setattr(provenance, "store_download_event", noisy_store)
    assert native_host.main(config=env, keystore=key_store, install_guard=False) == 0
    assert sys.stdout is fake_stdout  # print の行き先を元に戻した
    raw = out_bytes.getvalue()
    assert json.loads(raw[4:].decode("utf-8")) == {"ok": True, "stored": True}
    assert len(raw) == 4 + struct.unpack("=I", raw[:4])[0]
    assert "うっかり".encode("utf-8") not in raw
    assert "うっかり" in capsys.readouterr().err
    assert len(stored(db)) == 1


def test_binary_stream_sets_binary_mode_on_windows(monkeypatch):
    # Windows の msvcrt の代役で、標準入出力の改行の変換を止める呼び出しを確かめる
    calls = []
    fake_msvcrt = types.ModuleType("msvcrt")
    fake_msvcrt.setmode = lambda file_number, mode: calls.append((file_number, mode))
    monkeypatch.setitem(sys.modules, "msvcrt", fake_msvcrt)
    monkeypatch.setattr(native_host.sys, "platform", "win32")
    monkeypatch.setattr(native_host.os, "O_BINARY", 0x8000, raising=False)

    class ConsoleStream:
        buffer = io.BytesIO()

        def fileno(self):
            return 7

    console = ConsoleStream()
    assert native_host.binary_stream(console) is console.buffer
    assert calls == [(7, 0x8000)]
    in_memory = io.TextIOWrapper(io.BytesIO(), encoding="utf-8")  # ファイル番号がない
    assert native_host.binary_stream(in_memory) is in_memory.buffer
    assert calls == [(7, 0x8000)]


# ---------------------------------------------------------------------- 読み書きの部品


def test_write_and_read_round_trip():
    stream = io.BytesIO()
    native_host.write_message(stream, {"ok": False, "error": "日本語の理由"})
    raw = stream.getvalue()
    assert struct.unpack("=I", raw[:4])[0] == len(raw) - 4
    stream.seek(0)
    assert native_host.read_message(stream) == {"ok": False, "error": "日本語の理由"}


def test_write_message_refuses_replies_over_one_mebibyte():
    with pytest.raises(ValueError):
        native_host.write_message(io.BytesIO(), {"error": "x" * (1024 * 1024)})


def test_read_message_errors():
    with pytest.raises(native_host.ProtocolError):
        native_host.read_message(io.BytesIO(b""))
    with pytest.raises(native_host.ProtocolError):
        native_host.read_message(io.BytesIO(struct.pack("=I", 1024 * 1024 + 1)))
    body = b'{"type": "ping", "protocol": 1}'
    assert native_host.read_message(io.BytesIO(struct.pack("=I", len(body)) + body))["type"] == "ping"


# ---------------------------------------------------------------------- 内容の検査


def protocol_example():
    message = download_message("C:\\Users\\u\\Downloads\\report.pdf")
    message["download"]["url"] = "https://files.slack.com/files-pri/T0/F0/report.pdf"
    message["download"]["finalUrl"] = "https://files.slack.com/files-pri/T0/F0/report.pdf"
    message["download"]["referrer"] = "https://app.slack.com/"
    message["page"]["tabUrl"] = "https://app.slack.com/client/T0/C0"
    return message


def test_validate_message_produces_the_documented_dict():
    clean, errors = native_host.validate_message(protocol_example())
    assert errors == []
    assert clean == {
        "type": "download_completed",
        "browser": "chrome",
        "download": {
            "id": 42, "filename": "C:\\Users\\u\\Downloads\\report.pdf",
            "url": "https://files.slack.com/files-pri/T0/F0/report.pdf",
            "final_url": "https://files.slack.com/files-pri/T0/F0/report.pdf",
            "referrer_url": "https://app.slack.com/",
            "mime": "application/pdf", "started_at": 1793243520.0, "ended_at": 1793243524.5,
            "file_size": 123456, "danger": "safe",
        },
        "page": {"tab_url": "https://app.slack.com/client/T0/C0", "tab_title": "予算 (Channel) - ws - Slack",
                 "captured_at": 1793243520.01},
    }


def test_validate_ping():
    assert native_host.validate_message({"type": "ping", "protocol": 1}) == ({"type": "ping"}, [])
    assert native_host.validate_message({"type": "ping", "protocol": 2})[0] is None


@pytest.mark.parametrize("changes", [
    {"type": "run_command"},
    {"type": None},
    {"protocol": 2},
    {"protocol": "1"},
    {"protocol": True},
    {"protocol": 1.0},
    {"download": None},
    {"download": "C:\\x"},
    {"page": "https://app.slack.com/"},
])
def test_validate_rejects_bad_top_level_fields(changes):
    message = protocol_example()
    message.update(changes)
    clean, errors = native_host.validate_message(message)
    assert clean is None
    assert errors


@pytest.mark.parametrize("field, value", [
    ("id", -1), ("id", True), ("id", "42"), ("id", 1.5), ("id", 2 ** 53), ("id", None),
    ("filename", None), ("filename", ""), ("filename", "report.pdf"), ("filename", "Downloads\\report.pdf"),
    ("filename", "\\\\?\\C:\\Users\\u\\report.pdf"), ("filename", "\\\\.\\pipe\\pip0"),
    ("filename", "C:\\Users\\u\\re\x00port.pdf"), ("filename", "C:\\Users\\u\\re\nport.pdf"),
    ("filename", "C:\\Users\\u\\\ud800.pdf"), ("filename", "C:\\" + "a" * 1022),
    ("fileSize", -2), ("fileSize", "10"), ("fileSize", True), ("fileSize", 1.5), ("fileSize", 2 ** 53),
    ("incognito", True), ("incognito", None), ("incognito", "false"), ("incognito", 0),
])
def test_validate_rejects_bad_download_fields(field, value):
    message = protocol_example()
    message["download"][field] = value
    clean, errors = native_host.validate_message(message)
    assert clean is None
    assert len(errors) == 1


@pytest.mark.parametrize("filename", [
    "C:\\Users\\u\\Downloads\\report.pdf", "d:/Data/report.pdf", "\\\\server\\share\\report.pdf",
    "C:\\" + "a" * 1021,
])
def test_validate_accepts_absolute_paths(filename):
    message = protocol_example()
    message["download"]["filename"] = filename
    clean, errors = native_host.validate_message(message)
    assert errors == []
    assert clean["download"]["filename"] == filename


@pytest.mark.skipif(sys.platform == "win32", reason="Windows では / で始まるパスは絶対パスではない")
def test_validate_accepts_posix_paths_outside_windows():
    message = protocol_example()
    message["download"]["filename"] = "/tmp/pip0/Downloads/report.pdf"
    clean, errors = native_host.validate_message(message)
    assert errors == []
    assert clean["download"]["filename"] == "/tmp/pip0/Downloads/report.pdf"


def test_validate_normalises_optional_fields():
    message = protocol_example()
    message["browser"] = "firefox"
    message["command"] = "del C:\\"  # 知らない項目は無視する
    download = message["download"]
    download.update({"fileSize": -1, "mime": "x" * 300, "danger": 5, "startTime": "yesterday",
                     "endTime": "2026-10-29T03:12:04", "url": "javascript:alert(1)", "finalUrl": None,
                     "referrer": "file:///C:/secret.txt", "extra": {"run": "calc.exe"}})
    message["page"] = {"tabUrl": "data:text/html,<script>", "tabTitle": "a\x00b\x1b[31m\x7fc\u0085d\ud800e" + "x" * 600,
                       "capturedAt": 12345}
    clean, errors = native_host.validate_message(message)
    assert errors == []
    assert clean["browser"] is None
    assert "command" not in clean
    assert set(clean["download"]) == {"id", "filename", "url", "final_url", "referrer_url", "mime",
                                      "started_at", "ended_at", "file_size", "danger"}
    assert set(clean["page"]) == {"tab_url", "tab_title", "captured_at"}
    assert clean["download"]["file_size"] is None  # -1 は「分からない」
    assert len(clean["download"]["mime"]) == 255
    assert clean["download"]["danger"] is None
    assert clean["download"]["started_at"] is None
    assert clean["download"]["ended_at"] is None  # 時差のない時刻は使わない
    assert clean["download"]["url"] == "javascript:"
    assert clean["download"]["final_url"] is None
    assert clean["download"]["referrer_url"] == "file:"
    assert clean["page"]["tab_url"] == "data:"
    title = clean["page"]["tab_title"]
    assert title.startswith("a b [31m c d\ufffde")
    assert len(title) == 512
    assert clean["page"]["captured_at"] is None


def test_validate_accepts_missing_page_and_edge_browser():
    message = protocol_example()
    message["browser"] = "edge"
    message["page"] = None
    clean, errors = native_host.validate_message(message)
    assert errors == []
    assert clean["browser"] == "edge"
    assert clean["page"] == {"tab_url": None, "tab_title": None, "captured_at": None}
    del message["page"]
    assert native_host.validate_message(message)[0]["page"]["tab_url"] is None


def test_validate_rejects_non_dicts():
    assert native_host.validate_message(["download_completed"]) == (
        None, ["メッセージが JSON のオブジェクトではありません"])
