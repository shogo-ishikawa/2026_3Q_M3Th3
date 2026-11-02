"""外部通信の禁止（pip0 のプロセスの中の層）

pip0 は、処理したデータ（ファイルの中身、作業中のアプリの文脈、URL、解析結果）を外部へ送りません。
このモジュールは、それを pip0 のプロセスの中で守るための「監査フック」（sys.addaudithook）を入れます。

install() を呼んだ後は、次の呼び出しが NetworkBlocked（PermissionError の一種）で止まります。

- ソケットの接続・待ち受け・送信（socket.connect、bind、sendto、sendmsg）
- 名前解決（socket.getaddrinfo、gethostbyname など）。DNS の問い合わせそのものを起こしません
- HTTP・メールなどのライブラリ（urllib、http.client、ftplib、smtplib、poplib、imaplib、nntplib）と webbrowser
- 外部コマンドの起動（subprocess、os.exec*、os.spawn*、os.posix_spawn）。
  ただし、allowed_executables に絶対パスで登録した実行ファイル（pip0 シェル）だけは起動できます
- os.system と os.startfile は、何が起動するかを確かめられないため、いつも止めます

これは「アプリの中の層」です。

- 監査フックは、一度入れると外せません（テストでは、子プロセスの中で試します）。
- Python の説明書にあるとおり、監査フックはサンドボックスではありません。悪意のあるコードや、
  Python を通らない部分（ctypes で OS の関数を直接呼ぶ、C で書かれたライブラリ等）は止められません。
  すでに接続済みのソケットの send() も、監査の対象外です。
  pip0 自身のコードの誤り（うっかり通信する処理を足した等）を見つけて止めるためのものです。
- OS の層での遮断は、Windows Defender ファイアウォールの規則（scripts/network-policy.ps1）が受け持ちます。
  2つは別々に確かめて報告します（docs/network.md）。

止めた記録（blocked_attempts）には、呼び出しの名前と回数だけを残します。宛先・URL・パスは残しません。
"""

import logging
import os
import sys
import threading

logger = logging.getLogger(__name__)

# ----------------------------------------------------------------------
# 止める呼び出し（Python の監査イベントの名前）★
# 一覧：https://docs.python.org/ja/3/library/audit_events.html
# ----------------------------------------------------------------------

# 外部と通信する呼び出し（ソケット、名前解決、HTTP、メール等）
NETWORK_EVENTS = frozenset([
    "socket.connect",
    "socket.bind",
    "socket.sendto",
    "socket.sendmsg",
    "socket.getaddrinfo",
    "socket.gethostbyname",      # gethostbyname_ex もこの名前で知らせる
    "socket.gethostbyname_ex",
    "socket.gethostbyaddr",
    "socket.getnameinfo",
    "urllib.Request",
    "http.client.connect",
    "http.client.send",
    "ftplib.connect",
    "smtplib.connect",
    "poplib.connect",
    "imaplib.open",
    "nntplib.connect",           # Python 3.12 まで
    "telnetlib.Telnet.open",     # Python 3.12 まで
    "webbrowser.open",
])

# 外部コマンドの起動のうち、許可した実行ファイル（絶対パス）なら通すもの
CHECKED_PROCESS_EVENTS = frozenset([
    "subprocess.Popen",
    "os.exec",
    "os.posix_spawn",
    "os.spawn",
    "_winapi.CreateProcess",     # Windows で subprocess が使う
])

# 外部コマンドの起動のうち、いつも止めるもの（シェルや関連付けを通すため、何が起動するか確かめられない）
ALWAYS_BLOCKED_PROCESS_EVENTS = frozenset([
    "os.system",
    "os.startfile",
    "os.startfile/2",
])

WATCHED_EVENTS = NETWORK_EVENTS | CHECKED_PROCESS_EVENTS | ALWAYS_BLOCKED_PROCESS_EVENTS


class NetworkBlocked(PermissionError):
    """外部との通信、または許可していない外部コマンドの起動を止めた"""

    def __init__(self, event, message):
        super().__init__(message)
        self.event = event


# 監査フックの状態（1つのプロセスに1つだけ）
_lock = threading.Lock()
_installed = False
_allowed = frozenset()   # 起動を許可する実行ファイル（normalise_program で整えた絶対パス）
_counts = {}             # 止めた呼び出しの名前 → 回数


# ----------------------------------------------------------------------
# 入れる・確かめる
# ----------------------------------------------------------------------


def install(allowed_executables=()):
    """監査フックを入れる。何度呼んでもフックは1つだけで、外すことはできない

    allowed_executables：起動を許可する実行ファイルの絶対パスのリスト（例：pip0 シェルの Pip0Shell.exe）。
    2回目以降の呼び出しでは、許可する実行ファイルを加えるだけです（減らすことはできません）。
    相対パスや名前だけ（"python" など）は、どの実行ファイルが起動するか決まらないため、ValueError にします。
    リストにせず、パスを1つだけ（文字列のまま）渡した場合は TypeError にします。
    """
    global _installed, _allowed
    if isinstance(allowed_executables, (str, bytes, os.PathLike)):
        raise TypeError("allowed_executables は、パスのリストで渡してください（1つでもリストにします）。")
    additions = set()
    for path in allowed_executables:
        normalised = normalise_program(os.fsdecode(os.fspath(path)))
        if normalised is None:
            raise ValueError("allowed_executables には、実行ファイルの絶対パスを指定してください。")
        additions.add(normalised)

    with _lock:
        _allowed = _allowed | additions
        already = _installed
        if not already:
            sys.addaudithook(audit_hook)
            _installed = True
        allowed_count = len(_allowed)

    if already:
        logger.info("外部通信の禁止はすでに入っています（起動を許可する実行ファイル %d 件）", allowed_count)
    else:
        logger.info("外部通信の禁止（監査フック）を入れました（起動を許可する実行ファイル %d 件）", allowed_count)


def is_installed():
    """このプロセスに監査フックが入っていれば True"""
    return _installed


def blocked_attempts():
    """止めた呼び出しの名前と回数の辞書（例：{"socket.connect": 2}）。宛先・URL・パスは含まない"""
    with _lock:
        return dict(sorted(_counts.items()))


# ----------------------------------------------------------------------
# 監査フック
# ----------------------------------------------------------------------


def audit_hook(event, args, watched=WATCHED_EVENTS):
    """Python の監査イベントのたびに呼ばれる。止める呼び出しなら NetworkBlocked を出す

    ファイルを開く・モジュールを読み込むなど、ほとんどのイベントは最初の行で素通りさせます。
    watched を既定値として持たせているのは、Python の終了の処理中にモジュールの変数が消えても、
    関係のないイベントの邪魔をしないためです。
    """
    if event not in watched:
        return
    if event in CHECKED_PROCESS_EVENTS:
        program = program_from_event(event, args)
        if program is not None and is_allowed_program(program, _allowed):
            return
        raise blocked_error(event, "process")
    if event in ALWAYS_BLOCKED_PROCESS_EVENTS:
        raise blocked_error(event, "process")
    raise blocked_error(event, "network")


def blocked_error(event, kind):
    """止めた回数を数え、出す例外（NetworkBlocked）を作る。記録（ログ）に残すのは、その名前の1回目だけ"""
    with _lock:
        count = _counts.get(event, 0) + 1
        _counts[event] = count
    if count == 1:
        logger.warning("外部通信・外部コマンドの起動を止めました（%s）。2回目からは回数だけを数えます", event)
    if kind == "process":
        message = f"pip0 が許可していない外部コマンドの起動を止めました（{event}）。"
    else:
        message = f"pip0 は外部と通信しないため、この呼び出しを止めました（{event}）。"
    return NetworkBlocked(event, message)


# ----------------------------------------------------------------------
# 起動しようとしている実行ファイルを調べる
# ----------------------------------------------------------------------


def program_from_event(event, args):
    """監査イベントの引数から、起動しようとしている実行ファイルのパス（文字列）を取り出す。分からなければ None

    - subprocess.Popen：(executable, args, cwd, env)。Windows では executable が None で、args が1つの文字列のことがある
    - _winapi.CreateProcess：(application_name, command_line, current_directory)
    - os.spawn：(mode, path, args, env)
    - os.exec、os.posix_spawn：(path, args, env)
    """
    try:
        if event in ("subprocess.Popen", "_winapi.CreateProcess"):
            executable, command = args[0], args[1]
        elif event == "os.spawn":
            executable, command = args[1], None
        else:
            executable, command = args[0], None
    except (IndexError, TypeError):
        return None

    if executable is not None:
        return to_text(executable)
    if isinstance(command, (str, bytes)):
        text = to_text(command)
        return program_from_command_line(text) if text is not None else None
    if isinstance(command, (list, tuple)) and command:
        return to_text(command[0])
    return None


def to_text(value):
    """str・bytes・パスのオブジェクトを文字列にする。できなければ None"""
    try:
        return os.fsdecode(os.fspath(value))
    except (TypeError, ValueError):
        return None


def program_from_command_line(command_line):
    """Windows のコマンドライン（1つの文字列）の最初の部分（起動する実行ファイル）を取り出す

    '"C:\\Program Files\\pip0\\Pip0Shell.exe" --headless' → 'C:\\Program Files\\pip0\\Pip0Shell.exe'
    引用符がなければ、最初の空白までを取り出します。
    """
    text = command_line.lstrip()
    if text.startswith('"'):
        end = text.find('"', 1)
        return text[1:end] if end > 0 else text[1:]
    parts = text.split(None, 1)
    return parts[0] if parts else None


def normalise_program(path, pathmod=os.path):
    """実行ファイルのパスを、比べられる形（絶対パス、..の解決、Windows では小文字）にする。絶対パスでなければ None

    pathmod は、パスの扱い方（既定は動いている OS の os.path）。テストでは ntpath を渡して Windows の動きを確かめます。
    """
    if not path or "\x00" in path or not pathmod.isabs(path):
        return None
    return pathmod.normcase(pathmod.normpath(path))


def is_allowed_program(program, allowed, pathmod=os.path):
    """program が、許可した実行ファイル（normalise_program で整えたものの集合）のどれかと同じなら True"""
    normalised = normalise_program(program, pathmod)
    return normalised is not None and normalised in allowed


# ----------------------------------------------------------------------
# 働いているかの確認（python -m pip0 check-network が使う）
# ----------------------------------------------------------------------

# 起動を試すための、存在しない実行ファイル（許可していない絶対パス）
CHECK_PROGRAM_NAME = "netguard-check-not-allowed.exe"


def self_check():
    """監査フックが働いているかを、このプロセスの中で確かめる

    フックが働いていれば、どの呼び出しも OS に届く前に止まるため、実際の通信は起きません。
    宛先はこの PC の中（localhost、127.0.0.1）だけで、外部コマンドには存在しないパスを使います。
    フックが入っていないときは、何も試しません。
    返す辞書：{"ok", "reason", "checks": [{"name", "blocked", "detail"}]}
    """
    if not _installed:
        return {"ok": False, "reason": "外部通信の禁止（監査フック）がまだ入っていません。install() を先に呼んでください。",
                "checks": []}
    checks = [
        run_check("名前解決（socket.getaddrinfo）", try_name_lookup),
        run_check("ソケットの接続（127.0.0.1）", try_socket_connect),
        run_check("HTTP の要求（urllib）", try_http_request),
        run_check("許可していない外部コマンドの起動（subprocess）", try_start_program),
    ]
    ok = all(check["blocked"] for check in checks)
    reason = "" if ok else "止まらなかった呼び出しがあります。"
    return {"ok": ok, "reason": reason, "checks": checks}


def run_check(name, attempt):
    """attempt() を呼び、NetworkBlocked で止まったかを確かめる"""
    try:
        attempt()
    except NetworkBlocked:
        return {"name": name, "blocked": True, "detail": "止まりました"}
    except Exception as error:
        # urllib が、止めた理由を URLError で包んだ場合も「止まった」と数える
        if isinstance(getattr(error, "reason", None), NetworkBlocked):
            return {"name": name, "blocked": True, "detail": "止まりました"}
        return {"name": name, "blocked": False, "detail": f"止まらずに {type(error).__name__} になりました"}
    return {"name": name, "blocked": False, "detail": "止まらずに成功しました"}


def try_name_lookup():
    import socket
    socket.getaddrinfo("localhost", 80)


def try_socket_connect():
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as connection:
        connection.settimeout(1)
        connection.connect(("127.0.0.1", 9))


def try_http_request():
    import urllib.request
    urllib.request.urlopen("http://127.0.0.1:9/", timeout=1)


def try_start_program():
    import subprocess
    program = os.path.join(os.path.dirname(os.path.abspath(__file__)), CHECK_PROGRAM_NAME)
    subprocess.run([program], capture_output=True, timeout=5)
