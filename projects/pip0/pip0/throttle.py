"""高負荷処理の条件（電源接続中 かつ OS 全体で3分間無操作）

解析（本文の取り出し、画像の色と形）、ハッシュの計算、保管庫へのコピー（M4 の退避）は、
次の2つの条件を両方満たすときだけ行います（指示書 3-2、docs/design.md 4-2）。

1. 電源が「AC」（電源につないでいる）。Windows では GetSystemPowerStatus で調べます
2. セッション全体の無操作時間が HEAVY_IDLE_SECONDS（180秒）以上。Windows では GetLastInputInfo で調べます
   （pip0 のウィンドウだけでなく、サインイン中のキーボードとマウスのすべての入力が対象です）

どちらかの値を取得できないとき（電源が「不明」、無操作時間が None）は、条件を満たさないものとして扱います。
「満たした」と偽ることはしません。値は platform（Windows では platform_windows.py）が読みます。

- check()：今、条件を満たしているかを1回調べる
- HeavyGate：常駐処理が使う「門」。may_run()（始めてよいか）と should_continue()（続けてよいか）
"""

import threading
import time

RECHECK_SECONDS = 0.5  # ★ should_continue() が OS に問い合わせ直す、最も短い間隔（秒）
HISTORY_LENGTH = 10    # 状態の変化を何件まで覚えておくか（状態の表示用）


def check(platform, config, now=None):
    """高負荷処理の条件を満たしているかを調べる

    返す辞書：{"allowed": True/False, "power": "ac"/"battery"/"unknown", "idle_seconds": 秒数 または None,
              "reason": 日本語の説明, "checked_at": 調べた時刻}
    """
    now = time.time() if now is None else now
    needed = config["HEAVY_IDLE_SECONDS"]
    power = read_power(platform)
    idle = read_idle(platform)

    problems = []
    if power == "battery":
        problems.append("バッテリーで動作中です")
    elif power != "ac":
        problems.append("電源の状態を取得できません（条件を満たしたことにはしません）")
    if idle is None:
        problems.append("無操作の時間を取得できません（条件を満たしたことにはしません）")
    elif idle < needed:
        problems.append(f"操作中です（無操作 {idle:.0f}秒、必要 {needed:.0f}秒）")

    if problems:
        reason = "。".join(problems) + "。高負荷の処理は待機します"
    else:
        reason = f"電源接続中で、{idle:.0f}秒間操作がありません（条件：{needed:.0f}秒以上）"
    return {"allowed": not problems, "power": power, "idle_seconds": idle, "reason": reason, "checked_at": now}


def read_power(platform):
    """電源の種類。"ac"、"battery" 以外の値や、読み取りの失敗は "unknown" にする"""
    try:
        power = platform.get_power_source()
    except OSError:
        return "unknown"
    if power in ("ac", "battery"):
        return power
    return "unknown"


def read_idle(platform):
    """無操作の秒数。読めない、または負の値（時計の異常）のときは None にする"""
    try:
        idle = platform.get_idle_seconds()
    except OSError:
        return None
    if idle is None or idle < 0:
        return None
    return float(idle)


class HeavyGate:
    """高負荷処理の「門」

    常駐処理のメインループは may_run() で「新しい処理を始めてよいか」を確かめ、
    解析やコピーのワーカーは、区切りごとに should_continue() で「続けてよいか」を確かめます。

    - may_run()：THROTTLE_CHECK_SECONDS（5秒）ごとに OS に問い合わせ直し、その間は前の結果を使う
    - should_continue()：RECHECK_SECONDS（0.5秒）より短い間隔では問い合わせ直さない（区切りが細かくても軽い）
    - extra_stop：True を返すと、条件に関係なく止める関数（キルスイッチ、終了の依頼など）。なくてもよい
    - state：最後に調べた結果（check() の辞書）
    - history：条件の状態が変わった記録 [{"at", "allowed", "reason"}, ...]（新しいものが後ろ、最大10件）
    """

    def __init__(self, platform, config, clock=time.time, extra_stop=None):
        self.platform = platform
        self.config = config
        self.clock = clock
        self.extra_stop = extra_stop
        self.history = []
        self.state = None
        self.last_checked = None
        # メインのスレッドとワーカーのスレッドの両方から呼ばれるため、調べ直す処理は1つずつ行う
        self.lock = threading.Lock()
        self.refresh()

    def refresh(self):
        """OS に問い合わせ直し、状態が変わったら history に記録する"""
        with self.lock:
            now = self.clock()
            state = check(self.platform, self.config, now=now)
            if self.state is None or state["allowed"] != self.state["allowed"]:
                self.history.append({"at": now, "allowed": state["allowed"], "reason": state["reason"]})
                self.history = self.history[-HISTORY_LENGTH:]
            self.state = state
            self.last_checked = now
            return state

    def is_older_than(self, seconds):
        """最後に調べてから seconds 秒以上たっていれば True。時計が戻ったとき（時刻の修正など）も True"""
        elapsed = self.clock() - self.last_checked
        return elapsed >= seconds or elapsed < 0

    def stop_requested(self):
        return self.extra_stop is not None and bool(self.extra_stop())

    def may_run(self):
        """新しい高負荷処理を始めてよければ True"""
        if self.is_older_than(self.config["THROTTLE_CHECK_SECONDS"]):
            self.refresh()
        return self.state["allowed"] and not self.stop_requested()

    def should_continue(self):
        """実行中の高負荷処理を続けてよければ True（偽なら、呼び出し側は区切りで一時停止する）"""
        if self.stop_requested():
            return False
        if self.is_older_than(RECHECK_SECONDS):
            self.refresh()
        return self.state["allowed"]
