"""shell_link（pip0 シェルとの通信）のテスト

本物のシェル（C#）の代わりに、同じ形で話す代役（tests/fake_shell.py）を子プロセスとして起動します。
やり取りは標準入出力のパイプだけで、ネットワークは使いません。
"""

import io
import json
import logging
import sys
import threading
import time
from pathlib import Path

import pytest

from pip0 import shell_link
from pip0.shell_link import ShellError, ShellLink, ShellTimeout, ShellUnavailable

FAKE_SHELL = Path(__file__).with_name("fake_shell.py")


class EventRecorder:
    """on_event に渡す代役。受け取った知らせを覚えておき、届くまで待てるようにする"""

    def __init__(self, fail_on=None):
        self.events = []
        self.fail_on = fail_on
        self.condition = threading.Condition()

    def __call__(self, event):
        with self.condition:
            self.events.append(event)
            self.condition.notify_all()
        if event["type"] == self.fail_on:
            raise RuntimeError("テスト用の失敗")

    def count(self, event_type):
        with self.condition:
            return sum(1 for event in self.events if event["type"] == event_type)

    def types(self):
        with self.condition:
            return [event["type"] for event in self.events]

    def wait_for(self, event_type, number=1, timeout=15):
        """event_type の知らせが number 個届くまで待ち、最後のものを返す"""
        deadline = time.monotonic() + timeout
        with self.condition:
            while True:
                matching = [event for event in self.events if event["type"] == event_type]
                if len(matching) >= number:
                    return matching[number - 1]
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise AssertionError(f"知らせ {event_type} が届きませんでした（届いたもの：{self.types()}）")
                self.condition.wait(remaining)


def wait_until(condition, timeout=15):
    deadline = time.monotonic() + timeout
    while not condition():
        if time.monotonic() > deadline:
            raise AssertionError("時間内に条件を満たしませんでした")
        time.sleep(0.02)


@pytest.fixture
def make_link():
    """代役のシェルを起動する ShellLink を作る。テストの終わりに必ず止める"""
    links = []

    def make(*arguments, on_event=None):
        recorder = on_event if on_event is not None else EventRecorder()
        link = ShellLink([sys.executable, str(FAKE_SHELL), *arguments], recorder)
        links.append(link)
        return link, recorder

    yield make
    for link in links:
        link.stop(timeout=2)


def started(make_link, *arguments, on_event=None):
    link, recorder = make_link(*arguments, on_event=on_event)
    assert link.start() == {"ok": True, "reason": ""}
    recorder.wait_for("shell.ready")
    return link, recorder


# ----------------------------------------------------------------------
# 要求と答え
# ----------------------------------------------------------------------


def test_request_returns_the_payload_and_ready_event_arrives(make_link):
    link, recorder = started(make_link)
    assert link.is_alive()
    assert recorder.wait_for("shell.ready")["payload"]["shell_version"] == "fake"
    assert link.request("echo", {"text": "予算資料", "count": 3}) == {"text": "予算資料", "count": 3}
    assert "time" in link.request("shell.ping")
    # パス（pathlib.Path）は文字列にして送る
    folder = Path("pip0") / "予算 資料.pdf"
    assert link.request("echo", {"path": folder}) == {"path": str(folder)}
    # 2回目の start() は、新しいシェルを起動しない
    assert link.start() == {"ok": True, "reason": "すでに動いています"}
    assert recorder.count("shell.ready") == 1


def test_failure_answer_raises_shell_error_with_its_code(make_link):
    link, _ = started(make_link)
    with pytest.raises(ShellError) as caught:
        link.request("fail")
    assert caught.value.code == "test_failure"
    assert caught.value.message == "テスト用の失敗の答えです"
    assert not isinstance(caught.value, (ShellUnavailable, ShellTimeout))
    with pytest.raises(ShellError) as caught:
        link.request("no.such.type")
    assert caught.value.code == "unknown_type"
    assert link.request("echo", {"still": "works"}) == {"still": "works"}


def test_timeout_then_the_late_answer_is_discarded(make_link):
    link, _ = started(make_link)
    began = time.monotonic()
    with pytest.raises(ShellTimeout) as caught:
        link.request("slow", {"seconds": 1.0}, timeout=0.2)
    assert time.monotonic() - began < 0.9
    assert caught.value.code == "timeout"
    assert isinstance(caught.value, ShellError)      # 約束どおり、失敗はすべて ShellError の仲間
    wait_until(lambda: link.counters()["unexpected_responses"] == 1)
    assert link.counters()["timeouts"] == 1
    assert link.request("echo", {"after": "timeout"}) == {"after": "timeout"}


def test_concurrent_requests_get_their_own_answers(make_link):
    link, _ = started(make_link)
    answers = {}
    errors = []

    def worker(number):
        try:
            for index in range(20):
                key = f"{number}-{index}"
                reply = link.request("echo", {"key": key, "pad": "z" * (number * 1500)})
                answers[key] = reply["key"]
        except Exception as error:   # テストで原因を見せるため
            errors.append(error)

    threads = [threading.Thread(target=worker, args=(number,)) for number in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(60)
    assert errors == []
    assert len(answers) == 160
    assert all(key == value for key, value in answers.items())
    assert link.counters()["invalid_lines"] == 0


def test_messages_that_cannot_be_sent_are_refused_before_sending(make_link):
    link, _ = started(make_link)
    with pytest.raises(ShellError) as caught:
        link.request("echo", {"pad": "x" * shell_link.MAX_LINE_BYTES})
    assert caught.value.code == "too_large"
    with pytest.raises(ShellError) as caught:
        link.request("echo", {"text": "\ud800"})        # UTF-8 にできない文字
    assert caught.value.code == "bad_request"
    with pytest.raises(ValueError):
        link.request("", {})
    with pytest.raises(TypeError):
        link.request("echo", ["not", "a", "dict"])     # payload は辞書だけ（プログラムの誤り）
    with pytest.raises(TypeError):
        link.send_event("ui.notify", "not a dict")
    assert link.send_event("ui.notify", {"pad": "x" * shell_link.MAX_LINE_BYTES}) is False
    assert link.counters()["dropped_events"] == 1
    assert link.request("echo", {"ok": True}) == {"ok": True}


# ----------------------------------------------------------------------
# 知らせ
# ----------------------------------------------------------------------


def test_events_flow_in_both_directions(make_link):
    link, recorder = started(make_link)
    assert link.send_event("test.note", {"n": 1, "text": "メモ"}) is True
    seen = link.request("events_seen")["events"]
    assert {"type": "test.note", "payload": {"n": 1, "text": "メモ"}} in seen

    link.request("emit", {"type": "context.foreground", "payload": {"process_name": "slack.exe"}})
    # 知らせの行は答えより前に届くので、request が戻った時点で on_event は呼ばれている
    assert {"type": "context.foreground", "payload": {"process_name": "slack.exe"}} in recorder.events


def test_errors_in_on_event_do_not_stop_reading(make_link):
    recorder = EventRecorder(fail_on="shell.ready")
    link, _ = started(make_link, on_event=recorder)
    assert link.request("echo", {"x": 1}) == {"x": 1}
    assert link.counters()["callback_errors"] == 1


def test_invalid_and_oversized_lines_are_discarded_and_counted(make_link):
    link, recorder = started(make_link)
    assert link.request("garbage") == {"after_garbage": True}
    counters = link.counters()
    # 読めない JSON、壊れた UTF-8、配列、知らない kind、type が空の知らせ、シェルが送った shell.exited
    assert counters["invalid_lines"] == 6
    assert counters["oversized_lines"] == 1
    assert counters["unexpected_responses"] == 1     # 待っていない番号の答え
    assert "shell.exited" not in recorder.types()
    assert "" not in recorder.types()
    assert link.is_alive()
    assert link.request("echo", {"after": "garbage"}) == {"after": "garbage"}


def test_a_line_of_exactly_one_mebibyte_is_accepted(make_link):
    link, recorder = started(make_link)
    assert link.request("boundary_events") == {"sent": 2}
    big = [event for event in recorder.events if event["type"] == "big.ok"]
    assert len(big) == 1
    assert len(big[0]["payload"]["pad"]) > 1_000_000
    assert "big.too_long" not in recorder.types()
    assert link.counters()["oversized_lines"] == 1


def test_stderr_goes_to_the_debug_log_truncated_and_is_never_parsed(make_link, caplog):
    caplog.set_level(logging.DEBUG, logger="pip0.shell_link")
    link, recorder = started(make_link)
    link.request("stderr")
    prefix = "pip0 シェルの記録："

    def shell_records():
        return [record for record in caplog.records
                if record.name == "pip0.shell_link" and record.getMessage().startswith(prefix)]

    wait_until(lambda: len(shell_records()) >= 2)
    assert all(record.levelno == logging.DEBUG for record in shell_records())
    messages = [record.getMessage() for record in shell_records()]
    assert any("短い記録です" in message for message in messages)
    long_message = [message for message in messages if "長長" in message][0]
    assert len(long_message) == len(prefix) + shell_link.STDERR_MAX_CHARS
    # 標準エラー出力に JSON の知らせの形の行があっても、知らせとしては扱わない
    assert "from.stderr" not in recorder.types()
    # シェルの記録の形でない行（パスを含むかもしれない）は、内容を残さない
    wait_until(lambda: link.counters().get("stderr_other_lines", 0) >= 2)
    assert not any("給与明細" in record.getMessage() or "from.stderr" in record.getMessage()
                   for record in caplog.records)


# ----------------------------------------------------------------------
# 終了・異常終了・起動し直し
# ----------------------------------------------------------------------


def test_crash_fails_pending_requests_and_reports_the_exit(make_link):
    link, recorder = started(make_link)
    outcome = {}

    def wait_for_slow_answer():
        try:
            link.request("slow", {"seconds": 30}, timeout=25)
        except ShellError as error:
            outcome["error"] = error

    waiter = threading.Thread(target=wait_for_slow_answer)
    waiter.start()
    time.sleep(0.3)   # slow の要求が届くのを待つ
    began = time.monotonic()
    with pytest.raises(ShellUnavailable):
        link.request("crash", timeout=20)
    waiter.join(20)
    assert isinstance(outcome["error"], ShellUnavailable)
    assert time.monotonic() - began < 10              # 時間切れを待たずに失敗になる

    exited = recorder.wait_for("shell.exited")
    assert exited["payload"] == {"returncode": 1, "requested_stop": False}
    assert not link.is_alive()
    with pytest.raises(ShellUnavailable):
        link.request("shell.ping")
    assert link.send_event("ui.notify", {"title": "t", "message": "m", "level": "info"}) is False
    assert link.counters()["dropped_events"] == 1

    # 落ちたシェルは、同じ ShellLink でもう一度起動できる
    assert link.start() == {"ok": True, "reason": ""}
    recorder.wait_for("shell.ready", number=2)
    assert link.request("echo", {"again": True}) == {"again": True}


def test_clean_stop_sends_quit_and_reports_the_exit(make_link):
    link, recorder = started(make_link)
    assert link.stop(timeout=5) == {"stopped": True, "returncode": 0, "method": "quit"}
    exited = recorder.wait_for("shell.exited")
    assert exited["payload"] == {"returncode": 0, "requested_stop": True}
    assert not link.is_alive()
    with pytest.raises(ShellUnavailable):
        link.request("shell.ping")
    assert link.send_event("ui.status", {}) is False
    assert link.stop()["method"] == "already_exited"


def test_stop_forces_a_shell_that_ignores_quit(make_link):
    link, recorder = started(make_link, "--ignore-quit")
    result = link.stop(timeout=0.5)
    assert result["stopped"] is True
    assert result["method"] in ("terminate", "kill")
    assert result["returncode"] != 0
    assert recorder.wait_for("shell.exited")["payload"]["requested_stop"] is True


def test_a_shell_that_exits_at_once_is_reported(make_link):
    link, recorder = make_link("--exit-code", "3")
    assert link.start()["ok"] is True
    exited = recorder.wait_for("shell.exited")
    assert exited["payload"] == {"returncode": 3, "requested_stop": False}
    assert not link.is_alive()
    with pytest.raises(ShellUnavailable):
        link.request("shell.ping", timeout=5)


def test_a_missing_program_is_reported_without_an_exception(tmp_path):
    link = ShellLink([str(tmp_path / "no-such-shell.exe")], EventRecorder())
    result = link.start()
    assert result["ok"] is False
    assert "見つかりません" in result["reason"]
    assert str(tmp_path) not in result["reason"]     # 理由にパスを入れない
    assert not link.is_alive()
    with pytest.raises(ShellUnavailable):
        link.request("shell.ping")
    assert link.send_event("ui.notify", {}) is False
    assert link.stop() == {"stopped": False, "returncode": None, "method": "not_started"}


# ----------------------------------------------------------------------
# 部品
# ----------------------------------------------------------------------


def test_read_line_limits_the_length_and_discards_long_lines():
    stream = io.BytesIO(b"abc\r\n" + b"x" * 11 + b"\n" + b"y" * 10 + b"\nlast")
    assert shell_link.read_line(stream, max_bytes=10) == ("line", b"abc")
    assert shell_link.read_line(stream, max_bytes=10) == ("too_long", b"")
    assert shell_link.read_line(stream, max_bytes=10) == ("line", b"y" * 10)   # ちょうど上限は読める
    assert shell_link.read_line(stream, max_bytes=10) == ("line", b"last")     # 改行なしの最後の行
    assert shell_link.read_line(stream, max_bytes=10) == ("eof", b"")
    tail = io.BytesIO(b"z" * 25)
    assert shell_link.read_line(tail, max_bytes=10) == ("too_long", b"")
    assert shell_link.read_line(tail, max_bytes=10) == ("eof", b"")


def test_read_reply_handles_every_shape():
    assert shell_link.read_reply({"kind": "response", "id": 1, "ok": True, "payload": {"a": 1}}) == {"a": 1}
    assert shell_link.read_reply({"ok": True}) == {}
    with pytest.raises(ShellError) as caught:
        shell_link.read_reply({"ok": True, "payload": [1, 2]})
    assert caught.value.code == "bad_response"
    with pytest.raises(ShellError) as caught:
        shell_link.read_reply({"ok": False, "error": {"code": "not_initialised", "message": "init の前です"}})
    assert (caught.value.code, caught.value.message) == ("not_initialised", "init の前です")
    with pytest.raises(ShellError) as caught:
        shell_link.read_reply({"ok": False})
    assert caught.value.code == "unknown"
    with pytest.raises(ShellError) as caught:
        shell_link.read_reply({"id": 3})
    assert caught.value.code == "bad_response"


def test_encode_message_makes_one_utf8_line():
    data = shell_link.encode_message(
        {"kind": "event", "type": "ui.notify", "payload": {"message": "改行\nあり", "path": Path("a") / "b"}})
    assert b"\n" not in data
    decoded = json.loads(data.decode("utf-8"))
    assert decoded["payload"] == {"message": "改行\nあり", "path": str(Path("a") / "b")}
    assert "改行".encode("utf-8") in data        # 日本語は \\u の形にせず、そのまま送る
    with pytest.raises(TypeError):
        shell_link.encode_message({"payload": object()})
    with pytest.raises(ValueError):
        shell_link.encode_message({"payload": float("nan")})
