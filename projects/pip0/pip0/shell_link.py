"""pip0 シェル（C#）との通信（標準入出力で JSON を1行ずつ）

pip0 本体は、Windows の機能を使う部分（pip0 シェル、shell/ フォルダー）を子プロセスとして起動し、
標準入出力（パイプ）で、1行に1つの JSON のメッセージをやり取りします。ネットワークは使いません。
メッセージの形は docs/ipc-protocol.md の1節にあります。

- request(type, payload, timeout)：要求を送り、同じ番号（id）の答えを待って、答えの payload（辞書）を返す
  - シェルが ok=false で答えた → ShellError（code と message を持つ）
  - シェルが動いていない・答える前に終わった → ShellUnavailable（ShellError の一種）
  - 時間内に答えがない → ShellTimeout（ShellError の一種）
- send_event(type, payload)：返事のいらない知らせ（画面の表示の指示など）を送る
- シェルからの知らせ（shell.ready、context.foreground など）は、on_event({"type", "payload"}) で受け取る。
  シェルが終わったときは、pip0 本体が作る知らせ shell.exited（{"returncode", "requested_stop"}）が届く

シェルの標準出力は、専用のスレッドで読みます。on_event はそのスレッドから呼ばれるので、
受け取った知らせはキュー（queue.Queue）に入れるだけにして、DB への書き込みなどはメインのスレッドで行ってください。
on_event の中で start() や stop() を呼ばないでください。

シェルの標準エラー出力は、動作の記録（ファイル名・パス・URL を含まない約束）です。
メッセージとしては読まず、logging の DEBUG に、1行 200 文字までを残すだけです。
"""

import json
import logging
import os
import re
import subprocess
import sys
import threading
import time

from pip0.netguard import NetworkBlocked

logger = logging.getLogger(__name__)

MAX_LINE_BYTES = 1024 * 1024      # 1行の上限（改行を除くバイト数）。シェルと同じ値（docs/ipc-protocol.md）
DISCARD_CHUNK_BYTES = 64 * 1024   # 上限を超えた行を読み捨てるときの、1回に読む量
STDERR_READ_BYTES = 64 * 1024     # 標準エラー出力を1回に読む量
STDERR_MAX_CHARS = 200            # ★シェルの標準エラー出力の1行を、記録に残す最大の文字数
# シェル自身の記録の行の形（shell/Core/Log.cs）：「2026-10-29T01:00:00.000Z [pip0-shell] [情報] …」
SHELL_LOG_LINE = re.compile(r"^\d{4}-\d\d-\d\dT[\d:.]+Z \[pip0-shell\] ")
EXIT_WAIT_SECONDS = 5             # 標準出力が閉じた後、シェルの終了を待つ秒数
WRITE_WAIT_SECONDS = 10           # ほかのスレッドの書き込みが終わるのを待つ秒数
WAIT_SLICE_SECONDS = 0.2          # 答えを待つ区切り（Ctrl+C が効くように、短く区切って待つ）
EXITED_EVENT = "shell.exited"     # シェルが終わったときに、pip0 本体が作る知らせの名前

# 数えておく出来事（counters() で読める）
COUNTER_NAMES = [
    "invalid_lines",         # JSON として読めない・形の違う行（読み捨てた）
    "oversized_lines",       # 1 MiB を超える行（読み捨てた）
    "unexpected_responses",  # 待っていない番号の答え（時間切れの後に届いた答えなど）
    "dropped_events",        # 送れなかった知らせ（シェルが動いていない等）
    "callback_errors",       # on_event の中で起きたエラー
    "timeouts",              # 時間内に答えがなかった要求
    "stderr_lines",          # 標準エラー出力の行
    "stderr_other_lines",    # そのうち、シェルの記録の形でない行（内容は残さない）
]


class ShellError(Exception):
    """シェルへの要求が失敗した（シェルが ok=false で答えた、など）。code は失敗の種類"""

    def __init__(self, code, message):
        super().__init__(f"{message}（{code}）")
        self.code = code
        self.message = message


class ShellUnavailable(ShellError):
    """シェルが動いていない、または答える前に終わった"""

    def __init__(self, message):
        super().__init__("unavailable", message)


class ShellTimeout(ShellError):
    """時間内に答えがなかった"""

    def __init__(self, message):
        super().__init__("timeout", message)


class ShellLink:
    """pip0 シェル（子プロセス）とのつながり。シェルが終わった後も、start() でもう一度起動できる

    command：起動するコマンドのリスト（例 ["C:\\...\\Pip0Shell.exe"]、表示なしなら "--headless" を加える）
    on_event：シェルからの知らせを受け取る関数（引数は {"type", "payload"} の辞書）。None なら知らせを捨てる
    """

    def __init__(self, command, on_event):
        if isinstance(command, (str, bytes, os.PathLike)):
            command = [command]
        self.command = [os.fspath(part) for part in command]
        self.on_event = on_event
        self._lock = threading.Lock()              # 状態（プロセス、答えを待つ要求、回数）を守る
        self._write_lock = threading.Lock()        # 標準入力へ、行が混ざらないように1行ずつ書く
        self._lifecycle_lock = threading.Lock()    # start() と stop() を同時に動かさない
        self._process = None
        self._receiving = False                    # シェルの標準出力を読めている間は True
        self._stop_requested = False
        self._threads = []
        self._pending = {}                         # 要求の番号 → 答えを待つための辞書
        self._next_id = 1
        self._counters = {name: 0 for name in COUNTER_NAMES}

    # ------------------------------------------------------------------
    # 起動と停止
    # ------------------------------------------------------------------

    def start(self):
        """シェルを起動する。返す辞書：{"ok", "reason"}（起動できないことは例外にしない）"""
        with self._lifecycle_lock:
            old = self._process
            if old is not None and old.poll() is None and self.is_alive():
                return {"ok": True, "reason": "すでに動いています"}
            # 前の回のシェルの読み取りが終わるのを待つ（終わらないシェルは、読み取りのスレッドが止める）
            join_threads(self._threads, EXIT_WAIT_SECONDS * 3)
            if old is not None and old.poll() is None:
                return {"ok": False, "reason": "前に起動した pip0 シェルが終わらないため、新しく起動できません"}

            options = {}
            if sys.platform == "win32":
                options["creationflags"] = subprocess.CREATE_NO_WINDOW   # コンソールの窓を出さない
            try:
                process = subprocess.Popen(
                    self.command,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    **options,
                )
            except OSError as error:
                logger.warning("pip0 シェルを起動できませんでした（%s）", type(error).__name__)
                return {"ok": False, "reason": start_failure_reason(error)}

            with self._lock:
                self._process = process
                self._receiving = True
                self._stop_requested = False
            self._threads = [
                threading.Thread(target=self._read_stdout, args=(process,), name="pip0-shell-stdout", daemon=True),
                threading.Thread(target=self._read_stderr, args=(process,), name="pip0-shell-stderr", daemon=True),
            ]
            for thread in self._threads:
                thread.start()
            logger.info("pip0 シェルを起動しました（プロセス番号 %d）", process.pid)
            return {"ok": True, "reason": ""}

    def stop(self, timeout=5):
        """シェルを止める。shell.quit を送って標準入力を閉じ、timeout 秒待つ。終わらなければ terminate、さらに kill

        返す辞書：{"stopped", "returncode", "method"}
        method は "quit"（自分で終わった）、"terminate"、"kill"、"already_exited"（もう終わっていた）、"not_started"
        """
        with self._lifecycle_lock:
            process = self._process
            if process is None:
                return {"stopped": False, "returncode": None, "method": "not_started"}
            with self._lock:
                self._stop_requested = True
            if process.poll() is not None:
                method = "already_exited"
            else:
                self.send_event("shell.quit", {})
                self._close_stdin(process)   # 標準入力の終わりでも、シェルは終了する
                method = finish_process(process, timeout)
                if method == "exited":
                    method = "quit"
            join_threads(self._threads, timeout)
            logger.info("pip0 シェルを止めました（%s、終了コード %s）", method, process.returncode)
            return {"stopped": True, "returncode": process.returncode, "method": method}

    def is_alive(self):
        """シェルが動いていて、答えを受け取れる状態なら True"""
        with self._lock:
            process = self._process
            receiving = self._receiving
        return process is not None and receiving and process.poll() is None

    def counters(self):
        """読み捨てた行・送れなかった知らせなどの回数（確認と表示用）"""
        with self._lock:
            return dict(self._counters)

    # ------------------------------------------------------------------
    # 送る
    # ------------------------------------------------------------------

    def request(self, type, payload=None, timeout=10.0):
        """要求を送り、答えの payload（辞書）を返す。失敗は ShellError（ShellUnavailable、ShellTimeout を含む）

        type：要求の名前（docs/ipc-protocol.md の2節。例 "cf.status"）
        timeout：答えを待つ秒数。None なら、シェルが動いている間は待ち続ける
        """
        check_name(type)
        payload = check_payload(payload)
        with self._lock:
            process = self._process
            if process is None or not self._receiving or process.poll() is not None:
                raise ShellUnavailable("pip0 シェルが動いていません。")
            request_id = self._next_id
            self._next_id += 1
            waiter = {"done": threading.Event(), "reply": None, "lost": False, "process": process}
            self._pending[request_id] = waiter

        message = {"kind": "request", "id": request_id, "type": type, "payload": payload}
        try:
            data = encode_message(message)
            sent = self._write_line(process, data)
        except BaseException:
            self._forget(request_id)
            raise
        if not sent:
            self._forget(request_id)
            raise ShellUnavailable("pip0 シェルへ送れませんでした（シェルが終了した可能性があります）。")

        if not wait_for(waiter["done"], timeout):
            if self._forget(request_id):
                self._count("timeouts")
                logger.warning("pip0 シェルから時間内に答えがありませんでした（%s）", type)
                raise ShellTimeout(f"pip0 シェルから {timeout:g} 秒以内に答えがありませんでした（{type}）。")
            # ちょうど読み取りのスレッドが答えを渡しているところなので、少しだけ待つ
            waiter["done"].wait(EXIT_WAIT_SECONDS)
        if waiter["lost"] or waiter["reply"] is None:
            raise ShellUnavailable("pip0 シェルが答える前に終了しました。")
        return read_reply(waiter["reply"])

    def send_event(self, type, payload=None):
        """返事のいらない知らせを送る。送れたら True

        シェルが動いていないときや、大きすぎて送れないときは、送らずに数えて False を返す（例外にしない）。
        """
        check_name(type)
        payload = check_payload(payload)
        with self._lock:
            process = self._process if self._receiving else None
        if process is None or process.poll() is not None:
            self._count("dropped_events")
            return False
        try:
            data = encode_message({"kind": "event", "type": type, "payload": payload})
        except ShellError as error:
            self._count("dropped_events")
            logger.warning("知らせ（%s）を送れませんでした（%s）", type, error.code)
            return False
        if not self._write_line(process, data):
            self._count("dropped_events")
            return False
        return True

    def _write_line(self, process, data):
        """1行（data と改行）を、ほかのスレッドと混ざらないように書く。書けたら True"""
        if not self._write_lock.acquire(timeout=WRITE_WAIT_SECONDS):
            return False
        try:
            stdin = process.stdin
            if stdin is None or stdin.closed:
                return False
            stdin.write(data + b"\n")
            stdin.flush()
            return True
        except (OSError, ValueError):
            return False   # シェルが終わってパイプが閉じた
        finally:
            self._write_lock.release()

    def _close_stdin(self, process):
        """シェルの標準入力を閉じる（ほかのスレッドの書き込みと重ならないようにする）"""
        if self._write_lock.acquire(timeout=WRITE_WAIT_SECONDS):
            try:
                close_quietly(process.stdin)
            finally:
                self._write_lock.release()

    def _forget(self, request_id):
        """答えを待つのをやめる。まだ待っていたなら True"""
        with self._lock:
            return self._pending.pop(request_id, None) is not None

    def _count(self, name):
        with self._lock:
            self._counters[name] += 1

    # ------------------------------------------------------------------
    # 受け取る（読み取りのスレッド）
    # ------------------------------------------------------------------

    def _read_stdout(self, process):
        """標準出力を1行ずつ読む。終わりまで読んだら、待っている要求を失敗にして、終了を知らせる"""
        try:
            while True:
                status, line = read_line(process.stdout)
                if status == "eof":
                    break
                if status == "too_long":
                    self._count("oversized_lines")
                    logger.warning("pip0 シェルから 1 MiB を超える行が届いたため、読み捨てました")
                    continue
                if line.strip() == b"":
                    continue
                self._handle_line(line)
        except (OSError, ValueError) as error:
            logger.warning("pip0 シェルの出力を読めなくなりました（%s）", type(error).__name__)
        finally:
            self._after_exit(process)

    def _handle_line(self, line):
        try:
            message = json.loads(line.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            self._invalid("JSON として読めない行")
            return
        if not isinstance(message, dict):
            self._invalid("JSON のオブジェクトではない行")
            return
        kind = message.get("kind")
        if kind == "response":
            self._handle_response(message)
        elif kind == "event":
            self._handle_event(message)
        else:
            self._invalid("kind が response・event のどちらでもない行")

    def _handle_response(self, message):
        request_id = message.get("id")
        if not isinstance(request_id, int) or isinstance(request_id, bool):
            self._invalid("番号（id）のない答え")
            return
        with self._lock:
            waiter = self._pending.pop(request_id, None)
        if waiter is None:
            self._count("unexpected_responses")
            logger.info("待っていない番号の答えを読み捨てました（番号 %d）", request_id)
            return
        waiter["reply"] = message
        waiter["done"].set()

    def _handle_event(self, message):
        event_type = message.get("type")
        payload = message.get("payload")
        if payload is None:
            payload = {}
        if not isinstance(event_type, str) or event_type == "" or not isinstance(payload, dict):
            self._invalid("type か payload の形が正しくない知らせ")
            return
        if event_type == EXITED_EVENT:
            # shell.exited は pip0 本体が作る知らせなので、シェルから届いたものは使わない
            self._invalid("pip0 本体が作る名前（shell.exited）の知らせ")
            return
        self._deliver({"type": event_type, "payload": payload})

    def _invalid(self, what):
        self._count("invalid_lines")
        logger.warning("pip0 シェルからの行を読み捨てました（%s）", what)

    def _deliver(self, event):
        """on_event を呼ぶ。on_event の中のエラーで、読み取りのスレッドを止めない"""
        if self.on_event is None:
            return
        try:
            self.on_event(event)
        except Exception as error:
            self._count("callback_errors")
            logger.error("知らせ（%s）の処理でエラーが起きました（%s）", event["type"], type(error).__name__)

    def _after_exit(self, process):
        """標準出力が閉じた後：待っている要求を失敗にし、終了を待ってから shell.exited を知らせる"""
        with self._lock:
            if self._process is process:
                self._receiving = False
            lost = []
            for request_id in list(self._pending):
                if self._pending[request_id]["process"] is process:
                    lost.append(self._pending.pop(request_id))
        for waiter in lost:
            waiter["lost"] = True
            waiter["done"].set()

        # 標準出力を閉じたのに終わらないシェルは、話ができないので止める
        method = finish_process(process, EXIT_WAIT_SECONDS)
        if method != "exited":
            logger.warning("pip0 シェルが標準出力を閉じた後も終わらなかったため、止めました（%s）", method)
        close_quietly(process.stdout)
        self._close_stdin(process)
        with self._lock:
            requested = self._stop_requested and self._process is process
        logger.info("pip0 シェルが終了しました（終了コード %s）", process.returncode)
        self._deliver({"type": EXITED_EVENT,
                       "payload": {"returncode": process.returncode, "requested_stop": requested}})

    def _read_stderr(self, process):
        """標準エラー出力（シェルの動作の記録）を、DEBUG の記録に残す。メッセージとしては読まない

        残すのは、シェル自身の記録の形（SHELL_LOG_LINE）の行だけです。それ以外の行（.NET の実行環境が
        異常終了のときに書く説明など。ファイルのパスを含むことがある）は、数えるだけで内容は残しません。
        """
        try:
            while True:
                raw = process.stderr.readline(STDERR_READ_BYTES)
                if raw == b"":
                    break
                self._count("stderr_lines")
                text = raw.decode("utf-8", errors="replace").rstrip("\r\n")
                if not text:
                    continue
                if SHELL_LOG_LINE.match(text):
                    logger.debug("pip0 シェルの記録：%s", text[:STDERR_MAX_CHARS])
                else:
                    self._count("stderr_other_lines")
                    logger.debug("pip0 シェルの標準エラー出力に、記録の形でない行がありました（内容は残しません）")
        except (OSError, ValueError):
            pass
        finally:
            close_quietly(process.stderr)


# ----------------------------------------------------------------------
# 部品（ShellLink の外でも使える、短い関数）
# ----------------------------------------------------------------------


def read_line(stream, max_bytes=MAX_LINE_BYTES):
    """stream から1行を読む

    返す値：("line", 改行を除いた中身)、("too_long", b"")（上限を超えたので改行まで読み捨てた）、("eof", b"")
    改行で終わらないまま入力が終わった最後の行も、"line" として返します。
    """
    data = stream.readline(max_bytes + 1)
    if data == b"":
        return "eof", b""
    if data.endswith(b"\n"):
        data = data[:-1]
        if data.endswith(b"\r"):
            data = data[:-1]
        return "line", data
    if len(data) <= max_bytes:
        return "line", data
    while True:
        rest = stream.readline(DISCARD_CHUNK_BYTES)
        if rest == b"" or rest.endswith(b"\n"):
            return "too_long", b""


def encode_message(message):
    """メッセージを、送る1行のバイト列（改行は含まない）にする

    1 MiB を超えるとき（code "too_large"）、UTF-8 にできない文字があるとき（code "bad_request"）は ShellError。
    JSON にできない値（関数など）や NaN は、プログラムの誤りなので、そのまま例外（TypeError、ValueError）にします。
    """
    text = json.dumps(message, ensure_ascii=False, separators=(",", ":"), allow_nan=False, default=json_default)
    try:
        data = text.encode("utf-8")
    except UnicodeEncodeError:
        raise ShellError("bad_request", "送る内容に、UTF-8 にできない文字が含まれています。") from None
    if len(data) > MAX_LINE_BYTES:
        raise ShellError("too_large", "送る内容が 1 MiB を超えるため、送れません。")
    return data


def json_default(value):
    """json.dumps が知らない値のうち、パス（pathlib.Path など）だけを文字列にする"""
    if isinstance(value, os.PathLike):
        return os.fspath(value)
    raise TypeError(f"JSON にできない値です（{type(value).__name__}）")


def read_reply(message):
    """答え（response）から payload を取り出す。ok=false なら ShellError（シェルの code と message）"""
    ok = message.get("ok")
    if ok is True:
        payload = message.get("payload")
        if payload is None:
            return {}
        if isinstance(payload, dict):
            return payload
        raise ShellError("bad_response", "pip0 シェルの答えの形が正しくありません（payload が辞書ではありません）。")
    if ok is False:
        error = message.get("error")
        if not isinstance(error, dict):
            error = {}
        code = error.get("code")
        text = error.get("message")
        if not isinstance(code, str) or code == "":
            code = "unknown"
        if not isinstance(text, str) or text == "":
            text = "pip0 シェルが、理由を示さずに失敗を答えました。"
        raise ShellError(code, text)
    raise ShellError("bad_response", "pip0 シェルの答えの形が正しくありません（ok がありません）。")


def check_name(name):
    """要求・知らせの名前が、空でない文字列かを確かめる（違えばプログラムの誤り）"""
    if not isinstance(name, str) or name == "":
        raise ValueError("要求・知らせの名前（type）には、空でない文字列が必要です。")


def check_payload(payload):
    """payload が辞書かを確かめる（None は空の辞書にする）。辞書でなければプログラムの誤り"""
    if payload is None:
        return {}
    if not isinstance(payload, dict):
        raise TypeError("payload は辞書（dict）で渡してください。")
    return payload


def wait_for(event, timeout):
    """event が立つまで待つ。時間内に立てば True。Ctrl+C が効くように、短く区切って待つ"""
    deadline = None if timeout is None else time.monotonic() + timeout
    while not event.is_set():
        if deadline is None:
            event.wait(WAIT_SLICE_SECONDS)
            continue
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return False
        event.wait(min(remaining, WAIT_SLICE_SECONDS))
    return True


def finish_process(process, timeout):
    """プロセスの終了を待つ。timeout 秒で終わらなければ terminate、それでも終わらなければ kill

    返す値：どう終わったか（"exited"、"terminate"、"kill"）
    """
    try:
        process.wait(timeout)
        return "exited"
    except subprocess.TimeoutExpired:
        pass
    process.terminate()
    try:
        process.wait(timeout)
        return "terminate"
    except subprocess.TimeoutExpired:
        pass
    process.kill()
    process.wait()
    return "kill"


def join_threads(threads, timeout):
    """スレッドの終わりを待つ（自分自身のスレッドは待たない）"""
    current = threading.current_thread()
    for thread in threads:
        if thread is not current and thread.is_alive():
            thread.join(timeout)


def close_quietly(stream):
    """閉じる。すでに閉じている・壊れているときのエラーは無視する"""
    if stream is None:
        return
    try:
        stream.close()
    except (OSError, ValueError):
        pass


def start_failure_reason(error):
    """シェルを起動できなかった理由（日本語。パスは含めない）"""
    if isinstance(error, NetworkBlocked):
        return ("外部コマンドの起動の禁止（netguard）で止められました。"
                "netguard.install の allowed_executables に pip0 シェルの実行ファイルを入れてください")
    if isinstance(error, FileNotFoundError):
        return "pip0 シェルの実行ファイルが見つかりません（設定の SHELL_EXE と、導入の手順を確かめてください）"
    if isinstance(error, PermissionError):
        return "pip0 シェルを起動する権限がありません"
    return f"pip0 シェルを起動できませんでした（{type(error).__name__}）"
