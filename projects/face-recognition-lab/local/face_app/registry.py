"""登録者データベース。

【独自機能】プライバシー配慮: 顔写真そのものは保存せず、照合用の数値(特徴量)だけを保存する。
同意日時を記録する。この部品の delete はDB内の情報を消す。
画面とCLIの削除は privacy.delete_person で記録と生成物も処理する。
"""
from __future__ import annotations

import json
from datetime import datetime

import numpy as np

from . import config

UNKNOWN = "未登録"


class FaceDB:
    def __init__(self, db_path=None, meta_path=None):
        self.db_path = db_path or config.DB_PATH
        self.meta_path = meta_path or config.DB_META_PATH
        self.feats = np.zeros((0, 128), np.float32)
        self.labels: list[str] = []
        self.meta: dict = {}
        self.load()

    # ---- 保存・読み込み ----
    def load(self):
        if self.db_path.exists():
            d = np.load(self.db_path, allow_pickle=False)
            self.feats = d["feats"].astype(np.float32)
            self.labels = [str(s) for s in d["labels"]]
        if self.meta_path.exists():
            self.meta = json.loads(self.meta_path.read_text(encoding="utf-8"))

    def save(self):
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        np.savez(self.db_path, feats=self.feats,
                 labels=np.array(self.labels, dtype=str))
        self.meta_path.write_text(json.dumps(self.meta, ensure_ascii=False, indent=2),
                                  encoding="utf-8")

    # ---- 操作 ----
    @property
    def names(self) -> list[str]:
        return sorted(set(self.labels))

    def add(self, name: str, feats: list[np.ndarray], source: str):
        if not feats:
            return
        arr = np.stack(feats).astype(np.float32)
        if self.feats.shape[1] != arr.shape[1] and len(self.feats) == 0:
            self.feats = np.zeros((0, arr.shape[1]), np.float32)
        self.feats = np.vstack([self.feats, arr])
        self.labels += [name] * len(feats)
        m = self.meta.setdefault(name, {"consent_at": datetime.now().isoformat(timespec="seconds"),
                                        "sources": []})
        m["sources"].append(source)
        m["templates"] = self.labels.count(name)

    def delete(self, name: str) -> bool:
        if name not in self.labels:
            return False
        keep = [i for i, l in enumerate(self.labels) if l != name]
        self.feats = self.feats[keep]
        self.labels = [self.labels[i] for i in keep]
        self.meta.pop(name, None)
        return True

    # ---- 照合 ----
    def scores(self, feat: np.ndarray) -> dict[str, float]:
        """人ごとの類似度(その人の登録データとのコサイン類似度の最大値)。"""
        if len(self.labels) == 0:
            return {}
        sims = self.feats @ feat
        out: dict[str, float] = {}
        for s, l in zip(sims, self.labels):
            if s > out.get(l, -1.0):
                out[l] = float(s)
        return out

    def match(self, feat: np.ndarray, threshold: float):
        """(判定名, 最良類似度, 最良候補名) を返す。しきい値未満なら判定名は「未登録」。"""
        sc = self.scores(feat)
        if not sc:
            return UNKNOWN, 0.0, None
        best = max(sc, key=sc.get)
        return (best if sc[best] >= threshold else UNKNOWN), sc[best], best
