"""動作チャレンジ。

顔の向きや表情ラベルがランダムな指示に合うかを確認する教育用の実験。
録画や画面提示などへの耐性を評価した生体検知機能ではない。
通常の顔照合による成功判定とは独立している。
"""
from __future__ import annotations

import random
import time

from . import config

STEPS = {
    "right": "画面の右を向いてください",
    "left": "画面の左を向いてください",
    "smile": "笑顔を見せてください",
    "front": "正面を向いてください",
}
HOLD_FRAMES = 4


class Challenge:
    def __init__(self, track_id: int, start_name: str, rng=None, clock=time.monotonic):
        self.rng = rng or random.Random()
        self.clock = clock
        self.track_id = track_id
        self.start_name = start_name
        pool = ["right", "left", "smile"]
        steps = []
        while len(steps) < config.CHALLENGE_STEPS:
            s = self.rng.choice(pool)
            if not steps or steps[-1] != s:
                steps.append(s)
        # 向きの指示のあとは正面に戻してから次へ(同じ姿勢のまま通過するのを防ぐ)
        self.steps = []
        for s in steps:
            self.steps.append(s)
            if s in ("left", "right"):
                self.steps.append("front")
        if self.steps[-1] == "front":
            self.steps.pop()
        self.index = 0
        self.hold = 0
        self.step_started = self.clock()
        self.state = "running"     # running / passed / failed
        self.message = ""

    @property
    def instruction(self) -> str:
        if self.state != "running":
            return self.message
        return f"[{self.index + 1}/{len(self.steps)}] {STEPS[self.steps[self.index]]}"

    @property
    def remaining(self) -> float:
        return max(0.0, config.CHALLENGE_STEP_SEC - (self.clock() - self.step_started))

    def _ok(self, step, yaw, probs) -> bool:
        if step == "right":
            return yaw > config.YAW_TURN
        if step == "left":
            return yaw < -config.YAW_TURN
        if step == "front":
            return abs(yaw) < config.YAW_TURN * 0.5
        if step == "smile":
            return probs is not None and probs[1] > config.SMILE_PROB
        return False

    def update(self, track) -> str:
        """毎フレーム呼ぶ。track は対象の顔の追跡(見失ったら None)。"""
        if self.state != "running":
            return self.state
        if track is None or track.id != self.track_id:
            return self._fail("顔を見失いました。もう一度 C キーで開始してください")
        if self.remaining <= 0:
            return self._fail("時間切れです。もう一度 C キーで開始してください")
        # 途中で別人に入れ替わったら失敗(多数決で確定した名前で判断)
        if track.name not in ("判定中", self.start_name):
            return self._fail("途中で人物が変わりました")
        yaw = track.quality.yaw if track.quality else 0.0
        if self._ok(self.steps[self.index], yaw, track.raw_emotion):
            self.hold += 1
        else:
            self.hold = 0
        if self.hold >= HOLD_FRAMES:
            self.index += 1
            self.hold = 0
            self.step_started = self.clock()
            if self.index >= len(self.steps):
                self.state = "passed"
                if self.start_name in ("未登録", "判定中"):
                    self.message = "指示どおりの動作を確認しました(未登録)"
                else:
                    self.message = f"指示どおりの動作を確認しました: {self.start_name}"
        return self.state

    def _fail(self, msg):
        self.state = "failed"
        self.message = msg
        return self.state
