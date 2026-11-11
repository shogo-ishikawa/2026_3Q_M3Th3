"""【独自機能】顔の追跡 + 多数決による安定化。

1フレームごとの判定はばらつく(一瞬だけ別人と判定される等)ため、
同じ顔を追跡し、直近の判定の多数決と表情スコアの移動平均で表示を安定させる。
"""
from __future__ import annotations

from collections import Counter, deque

import numpy as np

from . import config
from .registry import UNKNOWN


def current_identity(track, threshold: float) -> str:
    """過去の多数決だけで、最新フレームの別人や低い類似度を受け入れない。"""
    raw_name = getattr(track, "raw_name", UNKNOWN)
    raw_similarity = getattr(track, "raw_sim", float("nan"))
    if (getattr(track, "missed", 0) or not np.isfinite(raw_similarity)
            or raw_similarity < threshold or raw_name == UNKNOWN):
        return UNKNOWN
    return track.name if track.name == raw_name else "判定中"


def iou(a, b) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    x0, y0 = max(ax, bx), max(ay, by)
    x1, y1 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    inter = max(0, x1 - x0) * max(0, y1 - y0)
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


class Track:
    def __init__(self, tid: int, box):
        self.id = tid
        self.box = box
        self.missed = 0
        self.age = 0
        self.names = deque(maxlen=config.VOTE_WINDOW)
        self.sims = deque(maxlen=config.VOTE_WINDOW)
        self.emotion = None                       # 平滑化後の確率
        self.history = deque(maxlen=300)          # 表情ラベルの推移(グラフ用)
        # 最新フレームの情報(表示用)
        self.face = None
        self.quality = None
        self.raw_name = UNKNOWN
        self.raw_sim = 0.0
        self.raw_emotion = None

    def update(self, name, sim, probs):
        self.names.append(name)
        self.sims.append(sim)
        self.raw_name, self.raw_sim, self.raw_emotion = name, sim, probs
        if probs is not None:
            a = config.EMOTION_EMA
            self.emotion = probs.copy() if self.emotion is None else (1 - a) * self.emotion + a * probs
            self.history.append(self.emotion.copy())

    @property
    def name(self) -> str:
        """多数決で確定した名前。票が割れているときは「判定中」。"""
        if not self.names:
            return "判定中"
        name, n = Counter(self.names).most_common(1)[0]
        if len(self.names) < 3:
            return "判定中"
        return name if n / len(self.names) >= config.VOTE_MIN_RATIO else "判定中"

    @property
    def sim(self) -> float:
        return float(np.mean(self.sims)) if self.sims else 0.0

    @property
    def emotion_index(self) -> int:
        return int(np.argmax(self.emotion)) if self.emotion is not None else 0


class Tracker:
    def __init__(self, iou_thr=0.3, max_missed=10):
        self.tracks: list[Track] = []
        self.iou_thr, self.max_missed = iou_thr, max_missed
        self._next = 1

    def step(self, faces) -> list[tuple[Track, object]]:
        """検出結果を既存の追跡に割り当て、(track, face) の組を返す。"""
        pairs, used = [], set()
        cand = sorted(((iou(t.box, f.box), ti, fi)
                       for ti, t in enumerate(self.tracks)
                       for fi, f in enumerate(faces)), reverse=True)
        t_used = set()
        for s, ti, fi in cand:
            if s < self.iou_thr or ti in t_used or fi in used:
                continue
            t_used.add(ti); used.add(fi)
            pairs.append((self.tracks[ti], faces[fi]))
        for fi, f in enumerate(faces):
            if fi not in used:
                t = Track(self._next, f.box); self._next += 1
                self.tracks.append(t)
                pairs.append((t, f))
        matched = {id(t) for t, _ in pairs}
        for t in self.tracks:
            if id(t) in matched:
                t.missed = 0
            else:
                t.missed += 1
        for t, f in pairs:
            t.box, t.face = f.box, f
            t.age += 1
        self.tracks = [t for t in self.tracks if t.missed <= self.max_missed]
        return pairs

    def visible(self) -> list[Track]:
        return [t for t in self.tracks if t.missed == 0]
