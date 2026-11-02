"""netguard（pip0 のプロセスの中の外部通信の禁止）のテスト

監査フックは一度入れると外せないため、フックを入れる試験は、すべて子プロセス
（python -c ...）の中で行います。このテストのプロセス（pytest）には入れません。
宛先はこの PC の中（127.0.0.1、localhost、数字だけのアドレス）だけで、
フックが働いていれば OS に届く前に止まるため、実際の通信は必要ありません。
"""

import json
import ntpath
import os
import posixpath
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

from pip0 import netguard

PROJECT_DIR = Path(__file__).resolve().parents[1]

# 子プロセスの最初に入れる、共通の部品
CHILD_PRELUDE = '''
import json
import os
import sys
from pip0 import netguard
from pip0.netguard import NetworkBlocked


def attempt(function):
    """function() を呼び、NetworkBlocked で止まったかを辞書で返す"""
    try:
        function()
    except NetworkBlocked as error:
        return {"blocked": True, "event": error.event, "message": str(error),
                "permission_error": isinstance(error, PermissionError)}
    except Exception as error:
        return {"blocked": False, "error": type(error).__name__}
    return {"blocked": False, "error": None}


def listener():
    """フックを入れる前に、この PC の中だけで待ち受けるソケットを作る（届いた接続がないことを確かめるため）"""
    import socket
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    server.setblocking(False)
    return server


def nothing_arrived(server):
    try:
        server.accept()
    except BlockingIOError:
        return True
    return False
'''


def run_child(code, *arguments):
    """子プロセスで code を動かし、最後の行（JSON）を辞書にして返す"""
    environment = dict(os.environ)
    environment["PYTHONPATH"] = str(PROJECT_DIR) + (
        os.pathsep + environment["PYTHONPATH"] if environment.get("PYTHONPATH") else "")
    environment["PYTHONIOENCODING"] = "utf-8"
    completed = subprocess.run(
        [sys.executable, "-c", CHILD_PRELUDE + textwrap.dedent(code), *arguments],
        stdin=subprocess.DEVNULL, capture_output=True, encoding="utf-8", errors="replace",
        timeout=120, env=environment, cwd=str(PROJECT_DIR),
    )
    assert completed.returncode == 0, completed.stderr
    lines = completed.stdout.strip().splitlines()
    assert lines, "子プロセスが結果を書きませんでした：" + completed.stderr
    return json.loads(lines[-1])


# ----------------------------------------------------------------------
# 子プロセスで、本物の監査フックを入れて確かめる
# ----------------------------------------------------------------------


def test_loopback_connect_bind_and_send_are_blocked_before_reaching_the_os():
    results = run_child('''
        import socket
        server = listener()
        port = server.getsockname()[1]
        netguard.install()

        def raw_connect():
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as client:
                client.settimeout(2)
                client.connect(("127.0.0.1", port))

        def udp_send():
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as udp:
                udp.sendto(b"x", ("127.0.0.1", port))

        def bind_new():
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as other:
                other.bind(("127.0.0.1", 0))

        results = {
            "raw_connect": attempt(raw_connect),
            "create_connection": attempt(lambda: socket.create_connection(("127.0.0.1", port), timeout=2)),
            "udp_sendto": attempt(udp_send),
            "bind": attempt(bind_new),
            "nothing_arrived": nothing_arrived(server),
        }
        print(json.dumps(results))
    ''')
    assert results["raw_connect"]["blocked"] is True
    assert results["raw_connect"]["event"] == "socket.connect"
    assert results["raw_connect"]["permission_error"] is True
    assert "外部と通信しない" in results["raw_connect"]["message"]
    # create_connection は、接続の前の名前解決で止まる
    assert results["create_connection"]["blocked"] is True
    assert results["create_connection"]["event"] == "socket.getaddrinfo"
    assert results["udp_sendto"]["event"] == "socket.sendto"
    assert results["bind"]["event"] == "socket.bind"
    # 待ち受けていたソケットには、何も届いていない（通信は起きていない）
    assert results["nothing_arrived"] is True


def test_name_lookups_are_blocked():
    results = run_child('''
        import socket
        netguard.install()
        results = {
            "getaddrinfo": attempt(lambda: socket.getaddrinfo("localhost", 80)),
            "gethostbyname": attempt(lambda: socket.gethostbyname("localhost")),
            "gethostbyname_ex": attempt(lambda: socket.gethostbyname_ex("localhost")),
            "gethostbyaddr": attempt(lambda: socket.gethostbyaddr("127.0.0.1")),
            "getnameinfo": attempt(lambda: socket.getnameinfo(("127.0.0.1", 80), 0)),
        }
        print(json.dumps(results))
    ''')
    for name, result in results.items():
        assert result["blocked"] is True, name
        assert result["event"].startswith("socket."), name


def test_urllib_http_and_mail_libraries_are_blocked():
    results = run_child('''
        server = listener()
        port = server.getsockname()[1]
        netguard.install()
        import ftplib
        import http.client
        import smtplib
        import urllib.request

        def http_client():
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
            connection.request("GET", "/")

        results = {
            "urlopen": attempt(lambda: urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=2)),
            "http_client": attempt(http_client),
            "smtplib": attempt(lambda: smtplib.SMTP("127.0.0.1", port, timeout=2)),
            "ftplib": attempt(lambda: ftplib.FTP("127.0.0.1", timeout=2)),
            "nothing_arrived": nothing_arrived(server),
        }
        print(json.dumps(results))
    ''')
    assert results["urlopen"]["event"] == "urllib.Request"
    assert results["http_client"]["event"] == "http.client.connect"
    assert results["smtplib"]["event"] == "smtplib.connect"
    assert results["ftplib"]["event"] == "ftplib.connect"
    assert results["nothing_arrived"] is True


def test_events_that_cannot_be_triggered_here_are_still_watched():
    # ブラウザー・メールの受信・Windows のプロセス作成などは、この環境で実際に起こせないため、
    # 同じ名前の監査イベントを sys.audit で起こして、フックが止めることを確かめる
    results = run_child('''
        netguard.install(allowed_executables=[sys.executable])
        events = {
            "webbrowser.open": ("http://127.0.0.1/",),
            "imaplib.open": (None, "127.0.0.1", 143),
            "poplib.connect": (None, "127.0.0.1", 110),
            "nntplib.connect": (None, "127.0.0.1", 119),
            "http.client.send": (None, b"GET / HTTP/1.1"),
            "socket.sendmsg": (None, ("127.0.0.1", 9)),
            "os.startfile": ("C:\\\\x\\\\a.txt", "open"),
            "os.startfile/2": ("C:\\\\x\\\\a.txt", "open", "", None, 1),
            "os.spawn": (0, "C:\\\\x\\\\b.exe", ["b"], None),
            "_winapi.CreateProcess": (None, '"C:\\\\x y\\\\c.exe" --z', None),
        }
        results = {name: attempt(lambda name=name, args=args: sys.audit(name, *args))
                   for name, args in events.items()}
        results["allowed_create_process"] = attempt(
            lambda: sys.audit("_winapi.CreateProcess", sys.executable, "python -c pass", None))
        print(json.dumps(results))
    ''')
    allowed = results.pop("allowed_create_process")
    assert allowed == {"blocked": False, "error": None}
    for name, result in results.items():
        assert result["blocked"] is True, name
        assert result["event"] == name


def test_only_allowed_executables_can_be_started():
    results = run_child('''
        import subprocess
        other = os.environ.get("ComSpec", r"C:\\Windows\\System32\\cmd.exe") if os.name == "nt" else "/bin/sh"
        other_arguments = [other, "/c", "exit 0"] if os.name == "nt" else [other, "-c", "exit 0"]
        netguard.install(allowed_executables=[sys.executable])

        def run_allowed():
            completed = subprocess.run([sys.executable, "-c", "print('allowed')"],
                                       capture_output=True, text=True, timeout=60)
            return completed.stdout.strip()

        results = {
            "allowed_output": run_allowed(),
            "other_absolute": attempt(lambda: subprocess.run(other_arguments, capture_output=True, timeout=60)),
            "relative_name": attempt(lambda: subprocess.run(["python3", "-c", "pass"], capture_output=True, timeout=60)),
            "shell_true": attempt(lambda: subprocess.run("exit 0", shell=True, capture_output=True, timeout=60)),
            "os_system": attempt(lambda: os.system("exit 0")),
            "execv": attempt(lambda: os.execv(other, [other])),
        }
        if hasattr(os, "posix_spawn"):
            results["posix_spawn"] = attempt(lambda: os.posix_spawn(other, other_arguments, dict(os.environ)))
        if hasattr(os, "startfile"):
            # 止まらなかった場合も何も起動しないよう、存在しないファイルを指定する
            results["startfile"] = attempt(lambda: os.startfile(os.path.abspath("pip0-no-such-file.txt")))
        results["attempts"] = netguard.blocked_attempts()
        print(json.dumps(results))
    ''')
    # 許可した実行ファイル（絶対パス）は起動できる
    assert results["allowed_output"] == "allowed"
    # それ以外は、起動する前に止まる
    assert results["other_absolute"]["blocked"] is True
    assert results["other_absolute"]["event"] == "subprocess.Popen"
    assert "外部コマンド" in results["other_absolute"]["message"]
    assert results["relative_name"]["blocked"] is True
    assert results["shell_true"]["blocked"] is True
    assert results["os_system"]["event"] == "os.system"
    assert results["execv"]["event"] == "os.exec"
    if "posix_spawn" in results:
        assert results["posix_spawn"]["event"] == "os.posix_spawn"
    if "startfile" in results:
        assert results["startfile"]["event"] == "os.startfile"
    # 許可したコマンドの起動は数えない
    assert "subprocess.Popen" in results["attempts"]
    assert results["attempts"]["subprocess.Popen"] == 3


def test_install_is_idempotent_and_records_only_names_and_counts():
    results = run_child('''
        import io
        import logging
        import socket

        log_stream = io.StringIO()
        logger = logging.getLogger("pip0.netguard")
        logger.addHandler(logging.StreamHandler(log_stream))
        logger.setLevel(logging.INFO)

        hooks_added = []
        real_add = sys.addaudithook

        def counting_add(hook):
            hooks_added.append(hook)
            real_add(hook)

        sys.addaudithook = counting_add
        results = {"installed_before": netguard.is_installed()}
        netguard.install()
        netguard.install()
        results["installed_after"] = netguard.is_installed()
        results["hooks_added"] = len(hooks_added)

        secret_address = "10.20.30.40"
        for _ in range(2):
            attempt(lambda: socket.socket().connect((secret_address, 9)))
        attempt(lambda: socket.getaddrinfo(secret_address, 443))
        results["attempts"] = netguard.blocked_attempts()
        results["log"] = log_stream.getvalue()

        try:
            netguard.install(allowed_executables=["relative/shell.exe"])
            results["relative"] = "accepted"
        except ValueError:
            results["relative"] = "rejected"
        try:
            netguard.install(allowed_executables=os.path.abspath("shell.exe"))
            results["bare_string"] = "accepted"
        except TypeError:
            results["bare_string"] = "rejected"
        results["hooks_added_at_end"] = len(hooks_added)
        print(json.dumps(results))
    ''')
    assert results["installed_before"] is False
    assert results["installed_after"] is True
    assert results["hooks_added"] == 1
    assert results["hooks_added_at_end"] == 1
    assert results["attempts"] == {"socket.connect": 2, "socket.getaddrinfo": 1}
    # 宛先は、記録にもログにも残らない
    assert "10.20.30.40" not in json.dumps(results["attempts"])
    assert "10.20.30.40" not in results["log"]
    # ログに残すのは、その名前の1回目だけ
    assert results["log"].count("socket.connect") == 1
    assert results["log"].count("socket.getaddrinfo") == 1
    assert results["relative"] == "rejected"
    assert results["bare_string"] == "rejected"


def test_ordinary_local_work_still_works_under_the_guard(tmp_path):
    results = run_child('''
        import hashlib
        import pathlib
        import sqlite3
        import threading
        import zipfile

        folder = pathlib.Path(sys.argv[1])
        netguard.install()

        note = folder / "メモ.txt"
        note.write_text("予算", encoding="utf-8")
        results = {"text": note.read_text(encoding="utf-8")}

        plain = sqlite3.connect(":memory:")
        plain.execute("CREATE TABLE t (x)")
        plain.execute("INSERT INTO t VALUES (1)")
        results["sqlite"] = plain.execute("SELECT count(*) FROM t").fetchone()[0]

        from pip0 import database, keystore
        encrypted = database.open_encrypted(folder / "pip0.db", keystore.new_key_hex())
        database.set_setting(encrypted, "marker", "ok")
        results["encrypted_db"] = database.get_setting(encrypted, "marker")
        encrypted.close()

        digests = []
        worker = threading.Thread(target=lambda: digests.append(hashlib.sha256(b"x").hexdigest()))
        worker.start()
        worker.join()
        results["thread"] = len(digests)

        with zipfile.ZipFile(folder / "a.zip", "w") as archive:
            archive.writestr("a.txt", "x")
        with zipfile.ZipFile(folder / "a.zip") as archive:
            results["zip"] = archive.namelist()

        results["attempts"] = netguard.blocked_attempts()
        print(json.dumps(results))
    ''', str(tmp_path))
    assert results == {
        "text": "予算", "sqlite": 1, "encrypted_db": "ok", "thread": 1, "zip": ["a.txt"], "attempts": {},
    }


def test_self_check_reports_whether_the_guard_works():
    results = run_child('''
        results = {"before": netguard.self_check()}
        netguard.install()
        results["after"] = netguard.self_check()
        print(json.dumps(results))
    ''')
    assert results["before"]["ok"] is False
    assert results["before"]["checks"] == []      # 入っていないときは、何も試さない
    after = results["after"]
    assert after["ok"] is True, after
    assert len(after["checks"]) == 4
    assert all(check["blocked"] for check in after["checks"])


# ----------------------------------------------------------------------
# フックを入れずに確かめられる部品
# ----------------------------------------------------------------------


@pytest.mark.parametrize("command_line, expected", [
    ('"C:\\Program Files\\pip0\\shell\\Pip0Shell.exe" --headless', "C:\\Program Files\\pip0\\shell\\Pip0Shell.exe"),
    ("C:\\pip0\\Pip0Shell.exe --headless", "C:\\pip0\\Pip0Shell.exe"),
    ("   C:\\pip0\\Pip0Shell.exe\t--x", "C:\\pip0\\Pip0Shell.exe"),
    ('"C:\\no end quote', "C:\\no end quote"),
    ("", None),
])
def test_program_from_command_line(command_line, expected):
    assert netguard.program_from_command_line(command_line) == expected


def test_program_from_event_reads_each_event_shape():
    # Windows の subprocess：executable が None で、コマンドラインが1つの文字列
    assert netguard.program_from_event(
        "subprocess.Popen", (None, '"C:\\x y\\Pip0Shell.exe" --headless', None, None)) == "C:\\x y\\Pip0Shell.exe"
    # executable があれば、それが起動する
    assert netguard.program_from_event("subprocess.Popen", ("/usr/bin/a", ["b"], None, None)) == "/usr/bin/a"
    assert netguard.program_from_event("subprocess.Popen", (b"/usr/bin/a", [b"a"], None, None)) == "/usr/bin/a"
    assert netguard.program_from_event("subprocess.Popen", (None, ["/usr/bin/c", "-x"], None, None)) == "/usr/bin/c"
    assert netguard.program_from_event("_winapi.CreateProcess", (None, "C:\\a.exe -x", None)) == "C:\\a.exe"
    assert netguard.program_from_event("os.spawn", (0, "C:\\b.exe", ["b"], None)) == "C:\\b.exe"
    assert netguard.program_from_event("os.exec", (Path("/usr/bin/d"), ["d"], None)) == str(Path("/usr/bin/d"))
    assert netguard.program_from_event("os.posix_spawn", ("/usr/bin/e", ["e"], {})) == "/usr/bin/e"
    # 読めない形は None（呼ぶ側は「許可しない」として止める）
    assert netguard.program_from_event("subprocess.Popen", ()) is None
    assert netguard.program_from_event("subprocess.Popen", (None, None, None, None)) is None
    assert netguard.program_from_event("os.exec", (12345, [], None)) is None


def test_windows_paths_are_compared_case_insensitively():
    allowed = {netguard.normalise_program("C:/Users/u/AppData/Local/Programs/pip0/shell/Pip0Shell.exe", ntpath)}
    assert netguard.is_allowed_program(
        "c:\\users\\U\\appdata\\local\\programs\\pip0\\SHELL\\pip0shell.EXE", allowed, ntpath)
    assert netguard.is_allowed_program(
        "C:\\Users\\u\\AppData\\Local\\Programs\\pip0\\runtime\\..\\shell\\Pip0Shell.exe", allowed, ntpath)
    assert not netguard.is_allowed_program("C:\\Windows\\System32\\cmd.exe", allowed, ntpath)
    # 名前だけ・ドライブからの相対パスは、どれが起動するか決まらないので許可しない
    assert netguard.normalise_program("Pip0Shell.exe", ntpath) is None
    assert netguard.normalise_program("C:Pip0Shell.exe", ntpath) is None
    # Windows 以外では、大文字・小文字を区別する
    posix_allowed = {netguard.normalise_program("/opt/pip0/shell", posixpath)}
    assert netguard.is_allowed_program("/opt/pip0/./shell", posix_allowed, posixpath)
    assert not netguard.is_allowed_program("/opt/pip0/SHELL", posix_allowed, posixpath)


def test_audit_hook_decisions_without_installing(monkeypatch):
    # フックの関数を直接呼んで確かめる（このテストのプロセスには、フックを入れない）
    monkeypatch.setattr(netguard, "_allowed", frozenset({netguard.normalise_program(sys.executable)}))
    assert netguard.audit_hook("open", ("a.txt", "r", 0)) is None
    assert netguard.audit_hook("import", ("json", None, [], [], [])) is None
    assert netguard.audit_hook("subprocess.Popen", (sys.executable, [sys.executable], None, None)) is None
    with pytest.raises(netguard.NetworkBlocked) as caught:
        netguard.audit_hook("subprocess.Popen", (os.path.abspath("not-allowed"), ["x"], None, None))
    assert caught.value.event == "subprocess.Popen"
    assert isinstance(caught.value, PermissionError)
    with pytest.raises(netguard.NetworkBlocked):
        netguard.audit_hook("os.system", (b"ls",))
    with pytest.raises(netguard.NetworkBlocked):
        netguard.audit_hook("os.startfile", (sys.executable, "open"))
    with pytest.raises(netguard.NetworkBlocked) as caught:
        netguard.audit_hook("socket.connect", (None, ("127.0.0.1", 9)))
    assert "127.0.0.1" not in str(caught.value)
    assert netguard.is_installed() is False
