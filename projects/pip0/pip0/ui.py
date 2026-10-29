"""常駐UI への指示（ミニドック、浮上式デスク、警告の枠、通知）

画面を描くのは C# の pip0 シェル（shell/ フォルダー）です。
Python 側は「何を表示するか」を決めて、このモジュールの関数でシェルに伝えます。

- ShellUi：本番用。shell_link を通して、JSON の1行としてシェルへ送ります。
- RecordingUi：テスト・デモ用。送る代わりに、呼ばれた内容を calls に記録します。

送る内容の形は docs/ipc-protocol.md にまとめています。
"""


class RecordingUi:
    """テスト・デモ用：表示の指示を記録するだけ"""

    def __init__(self):
        self.calls = []

    def _record(self, name, payload):
        self.calls.append((name, payload))

    def show_mini_dock(self, dock):
        self._record("ui.mini_dock.show", dock)

    def close_mini_dock(self, dock_id, reason):
        self._record("ui.mini_dock.close", {"dock_id": dock_id, "reason": reason})

    def show_desk(self, desk):
        self._record("ui.desk.show", desk)

    def hide_desk(self, reason):
        self._record("ui.desk.hide", {"reason": reason})

    def show_hazard(self, hazard):
        self._record("ui.hazard.show", hazard)

    def hide_hazard(self):
        self._record("ui.hazard.hide", {})

    def notify(self, title, message, level="info"):
        self._record("ui.notify", {"title": title, "message": message, "level": level})

    def update_status(self, status):
        self._record("ui.status", status)

    def set_cursor_stream(self, enabled):
        self._record("shell.cursor_stream", {"enabled": bool(enabled)})

    def names(self):
        """記録した指示の名前だけのリスト（テストで使う）"""
        return [name for name, _ in self.calls]

    def last(self, name):
        """name の指示のうち、最後のものの内容"""
        for call_name, payload in reversed(self.calls):
            if call_name == name:
                return payload
        return None


class ShellUi:
    """本番用：pip0 シェルへ表示の指示を送る（shell_link.ShellLink の send_event を使う）"""

    def __init__(self, link):
        self.link = link

    def show_mini_dock(self, dock):
        self.link.send_event("ui.mini_dock.show", dock)

    def close_mini_dock(self, dock_id, reason):
        self.link.send_event("ui.mini_dock.close", {"dock_id": dock_id, "reason": reason})

    def show_desk(self, desk):
        self.link.send_event("ui.desk.show", desk)

    def hide_desk(self, reason):
        self.link.send_event("ui.desk.hide", {"reason": reason})

    def show_hazard(self, hazard):
        self.link.send_event("ui.hazard.show", hazard)

    def hide_hazard(self):
        self.link.send_event("ui.hazard.hide", {})

    def notify(self, title, message, level="info"):
        self.link.send_event("ui.notify", {"title": title, "message": message, "level": level})

    def update_status(self, status):
        self.link.send_event("ui.status", status)

    def set_cursor_stream(self, enabled):
        self.link.send_event("shell.cursor_stream", {"enabled": bool(enabled)})
