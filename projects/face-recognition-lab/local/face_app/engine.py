"""顔検出(YuNet)・顔照合用の特徴量(SFace)・表情分類(FER+)。

三つは独立した部品で、app.py で組み合わせて使う(仕様: 照合と表情分類は別の機能)。
"""
from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

from . import config, modelio


@dataclass
class Face:
    box: tuple            # (x, y, w, h)
    landmarks: np.ndarray # (5, 2): 右目, 左目, 鼻, 右口角, 左口角 (画像上の座標)
    score: float
    raw: np.ndarray = field(repr=False, default=None)  # YuNet の生出力 (15,)


def softmax(x: np.ndarray) -> np.ndarray:
    x = x - np.max(x)
    e = np.exp(x)
    return e / e.sum()


class Engine:
    """本物のモデルを使うエンジン。"""

    def __init__(self, model_dir=config.MODEL_DIR, detect_score=config.DETECT_SCORE):
        paths = {k: model_dir / v["file"] for k, v in config.MODELS.items()}
        missing = [str(p) for p in paths.values() if not p.exists()]
        if missing:
            raise FileNotFoundError(
                "モデルがありません。アプリを起動し直して「はじめての準備」を行ってください:\n  "
                + "\n  ".join(missing))
        from .downloader import matches_digest
        altered = [str(path) for kind, path in paths.items() if not matches_digest(kind, path)]
        if altered:
            raise RuntimeError("固定したモデルのSHA256と一致しません。モデルを取得し直してください:\n"
                               + "\n  ".join(altered))
        # 保存場所に日本語が含まれていても読めるよう、中身をメモリから渡して読み込む
        self.detector = modelio.create_detector(paths["detector"], (320, 320), detect_score, 0.3, 5000)
        self.recognizer = modelio.create_recognizer(paths["recognizer"])
        self.emotion_net = modelio.create_onnx_net(paths["emotion"])
        self._size = None

    # ---- 検出 ----
    def detect(self, img: np.ndarray) -> list[Face]:
        h, w = img.shape[:2]
        if self._size != (w, h):
            self.detector.setInputSize((w, h))
            self._size = (w, h)
        _, faces = self.detector.detect(img)
        out = []
        if faces is None:
            return out
        for f in faces:
            x, y, bw, bh = [int(round(v)) for v in f[:4]]
            lm = f[4:14].reshape(5, 2).astype(np.float32)
            out.append(Face((x, y, bw, bh), lm, float(f[14]), f.copy()))
        return out

    # ---- 照合用の特徴量 ----
    def embed(self, img: np.ndarray, face: Face) -> np.ndarray:
        aligned = self.recognizer.alignCrop(img, face.raw)
        feat = self.recognizer.feature(aligned).flatten().astype(np.float32)
        return feat / (np.linalg.norm(feat) + 1e-9)

    # ---- 表情分類 ----
    def emotion(self, img: np.ndarray, face: Face) -> np.ndarray:
        crop = crop_face(img, face.box, margin=0.1)
        if crop is None:
            return np.full(8, 1 / 8, np.float32)
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        gray = cv2.resize(gray, (64, 64)).astype(np.float32)
        blob = gray.reshape(1, 1, 64, 64)
        self.emotion_net.setInput(blob)
        logits = self.emotion_net.forward().flatten()
        return softmax(logits).astype(np.float32)


def crop_face(img, box, margin=0.0):
    x, y, w, h = box
    mx, my = int(w * margin), int(h * margin)
    H, W = img.shape[:2]
    x0, y0 = max(0, x - mx), max(0, y - my)
    x1, y1 = min(W, x + w + mx), min(H, y + h + my)
    if x1 - x0 < 8 or y1 - y0 < 8:
        return None
    return img[y0:y1, x0:x1]


def largest_face(faces: list[Face]) -> Face | None:
    if not faces:
        return None
    return max(faces, key=lambda f: f.box[2] * f.box[3])
