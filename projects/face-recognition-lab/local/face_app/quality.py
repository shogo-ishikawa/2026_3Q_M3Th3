"""【独自機能】撮影条件ナビ: 明るさ・ピント・顔の大きさ・向きを点数化して助言する。

登録時は点数の低い画像を自動で除外し、実行中は記録に残して
「照明や顔の向きで照合結果がどう変わるか」をレポートで分析できるようにする。
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import cv2
import numpy as np

from . import config
from .engine import crop_face


@dataclass
class Quality:
    score: int
    brightness: float
    contrast: float
    sharpness: float
    face_size: int
    yaw: float
    roll: float
    pitch: float
    advice: list = field(default_factory=list)


def head_pose(lm: np.ndarray):
    """5点の目印から顔の向きを簡易推定する。

    yaw  : 鼻が目の中点から左右どれだけずれているか(目の間隔で割った値)。
           画面上で鼻が右にあれば + (=画面の右を向いている)。
    roll : 両目を結ぶ線の傾き(度)。
    pitch: 目-口の間で鼻がどの高さにあるか(0.5付近が正面、大きいと下向き)。
    """
    re, le, nose, rm, lmo = lm
    eye_mid = (re + le) / 2
    mouth_mid = (rm + lmo) / 2
    eye_dist = np.linalg.norm(le - re) + 1e-6
    # 画像上で x の小さい方の目→大きい方の目へのベクトル
    a, b = (re, le) if re[0] <= le[0] else (le, re)
    roll = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
    yaw = float((nose[0] - eye_mid[0]) / eye_dist)
    span = (mouth_mid[1] - eye_mid[1]) + 1e-6
    pitch = float((nose[1] - eye_mid[1]) / span)
    return yaw, roll, pitch


def assess(img: np.ndarray, box, lm) -> Quality:
    q = config.QUALITY
    crop = crop_face(img, box)
    if crop is None:
        return Quality(0, 0, 0, 0, 0, 0, 0, 0, ["顔が画面の端で切れています"])
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    g = cv2.resize(gray, (112, 112))
    brightness = float(g.mean())
    contrast = float(g.std())
    sharpness = float(cv2.Laplacian(g, cv2.CV_64F).var())
    size = int(min(box[2], box[3]))
    yaw, roll, pitch = head_pose(lm)

    advice = []
    pts = 100.0
    if brightness < q["bright_low"]:
        pts -= 25; advice.append("暗すぎます。正面から光を当ててください")
    elif brightness > q["bright_high"]:
        pts -= 20; advice.append("明るすぎます。逆光や強い光を避けてください")
    if contrast < q["min_contrast"]:
        pts -= 10; advice.append("コントラストが低いです")
    if sharpness < q["min_sharpness"]:
        pts -= 20; advice.append("ぼやけています。動きを止めてください")
    if size < q["min_face"]:
        pts -= 20; advice.append("カメラに近づいてください")
    if abs(yaw) > q["max_yaw"]:
        pts -= 20; advice.append("正面を向いてください")
    if abs(roll) > q["max_roll"]:
        pts -= 10; advice.append("顔を傾けないでください")
    return Quality(int(max(0, pts)), brightness, contrast, sharpness, size,
                   yaw, roll, pitch, advice)
