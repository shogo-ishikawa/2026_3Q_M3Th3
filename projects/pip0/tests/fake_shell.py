"""テスト用の「代役の pip0 シェル」（tests/test_shell_link.py が子プロセスとして起動する）

本物のシェル（C#）と同じ形（docs/ipc-protocol.md の1節）で、標準入出力に JSON を1行ずつ読み書きします。
ネットワークは使いません。pip0 のモジュールも読み込みません。

起動するとすぐに知らせ shell.ready を送り、次の要求に答えます（要求ごとに別のスレッドで答える点も本物と同じ）。

- shell.ping：{"time"}
- echo：受け取った payload をそのまま返す
- fail：ok=false（code "test_failure"）で答える
- slow：payload の seconds 秒だけ待ってから答える（その間もほかの要求に答える）
- crash：答えずに、終了コード 1 ですぐに終わる
- emit：payload の type と payload の知らせを送ってから答える
- events_seen：これまでに受け取った知らせの一覧を返す
- garbage：読めない行・形の違う行・大きすぎる行などを書いてから答える
- boundary_events：ちょうど 1 MiB の行の知らせと、1 MiB を 1 バイト超える行の知らせを送ってから答える
- stderr：標準エラー出力に記録を書いてから答える
知らない type には、本物と同じく ok=false（code "unknown_type"）で答えます。
知らせ shell.quit を受けるか、標準入力が閉じられたら、終了コード 0 で終わります。

引数：
  --exit-code N   shell.ready を送った後、すぐに終了コード N で終わる
  --ignore-quit   shell.quit と標準入力の終わりを無視して動き続ける（stop() の強制終了を試すため）
"""

import json
import os
import sys
import threading
import time

MAX_LINE_BYTES = 1024 * 1024

write_lock = threading.Lock()
received_events = []


def write_raw(data):
    with write_lock:
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()


def encode(message):
    return json.dumps(message, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def send(message):
    write_raw(encode(message) + b"\n")


def respond(request_id, payload):
    send({"kind": "response", "id": request_id, "ok": True, "payload": payload})


def respond_failure(request_id, code, message):
    send({"kind": "response", "id": request_id, "ok": False, "error": {"code": code, "message": message}})


def event_line_of_size(event_type, size):
    """ちょうど size バイト（改行を除く）になる知らせの1行を作る"""
    base = encode({"kind": "event", "type": event_type, "payload": {"pad": ""}})
    padded = encode({"kind": "event", "type": event_type, "payload": {"pad": "x" * (size - len(base))}})
    assert len(padded) == size
    return padded + b"\n"


def handle_request(message):
    request_id = message.get("id")
    request_type = message.get("type")
    payload = message.get("payload") or {}

    if request_type == "shell.ping":
        respond(request_id, {"time": time.time()})
    elif request_type == "echo":
        respond(request_id, payload)
    elif request_type == "fail":
        respond_failure(request_id, "test_failure", "テスト用の失敗の答えです")
    elif request_type == "slow":
        time.sleep(float(payload.get("seconds", 1.0)))
        respond(request_id, {"slept": payload.get("seconds", 1.0)})
    elif request_type == "crash":
        os._exit(1)
    elif request_type == "emit":
        send({"kind": "event", "type": payload["type"], "payload": payload.get("payload", {})})
        respond(request_id, {"emitted": True})
    elif request_type == "events_seen":
        respond(request_id, {"events": list(received_events)})
    elif request_type == "garbage":
        write_raw(b"this is not json\n")
        write_raw(b"\xff\xfe broken utf-8\n")
        write_raw(b"[1, 2, 3]\n")
        write_raw(b'{"kind": "mystery"}\n')
        write_raw(b'{"kind": "event", "type": "", "payload": {}}\n')
        write_raw(b'{"kind": "event", "type": "shell.exited", "payload": {"returncode": 0}}\n')
        write_raw(b'{"kind": "response", "id": 999999, "ok": true, "payload": {}}\n')
        write_raw(b"y" * (MAX_LINE_BYTES + 10) + b"\n")
        write_raw(b"\n")
        respond(request_id, {"after_garbage": True})
    elif request_type == "boundary_events":
        write_raw(event_line_of_size("big.ok", MAX_LINE_BYTES))
        write_raw(event_line_of_size("big.too_long", MAX_LINE_BYTES + 1))
        respond(request_id, {"sent": 2})
    elif request_type == "stderr":
        # 本物のシェルと同じく、UTF-8 で1行ずつ書く
        log_prefix = "2026-10-29T01:00:00.000Z [pip0-shell] [情報] "  # シェル自身の記録の形
        sys.stderr.buffer.write((log_prefix + "短い記録です\n").encode("utf-8"))
        sys.stderr.buffer.write((log_prefix + "長" * 500 + "\n").encode("utf-8"))
        # .NET の実行環境が異常終了のときに書く説明の形（パスを含む）。内容は記録に残らないこと
        sys.stderr.buffer.write("Unhandled exception. System.IO.IOException: C:\\Users\\u\\給与明細.pdf\n".encode("utf-8"))
        sys.stderr.buffer.write(b'{"kind": "event", "type": "from.stderr", "payload": {}}\n')
        sys.stderr.buffer.flush()
        respond(request_id, {"written": 3})
    else:
        respond_failure(request_id, "unknown_type", "知らない種類の要求です")


def main(argv):
    exit_code = None
    ignore_quit = "--ignore-quit" in argv
    if "--exit-code" in argv:
        exit_code = int(argv[argv.index("--exit-code") + 1])

    send({"kind": "event", "type": "shell.ready",
          "payload": {"shell_version": "fake", "capabilities": {"cloud_files": False, "trash": False,
                                                                "ui": False, "hooks": False}}})
    if exit_code is not None:
        return exit_code

    for raw in sys.stdin.buffer:
        line = raw.rstrip(b"\r\n")
        if not line:
            continue
        try:
            message = json.loads(line.decode("utf-8"))
        except ValueError:
            continue
        if message.get("kind") == "event":
            received_events.append({"type": message.get("type"), "payload": message.get("payload")})
            if message.get("type") == "shell.quit" and not ignore_quit:
                return 0
        elif message.get("kind") == "request":
            threading.Thread(target=handle_request, args=(message,), daemon=True).start()

    while ignore_quit:
        time.sleep(1)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
