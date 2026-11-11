"""テスト用の模擬エンジン。本物のモデルなしで処理全体の流れを確認するために使う。

合成画像の「顔」= 色付きの楕円。色(色相)が人物、口の位置の四角の濃さが表情、
黒い点(鼻)の位置が顔の向きを表す。
"""
from __future__ import annotations

import cv2
import numpy as np

from face_app.engine import Face

PEOPLE = {"Aさん": 10, "Bさん": 60, "Cさん": 120, "Dさん": 160}   # 色相(OpenCV 0-179)


def draw_face(img, cx, cy, hue, emotion=0, yaw=0.0, r=70, value=210):
    hsv = np.uint8([[[hue, 200, value]]])
    col = tuple(int(c) for c in cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)[0, 0])
    cv2.ellipse(img, (cx, cy), (r, int(r * 1.25)), 0, 0, 360, col, -1)
    for sx in (-1, 1):                                   # 目(模様としてエッジを作る)
        cv2.circle(img, (cx + sx * r // 3, cy - r // 4), r // 10, (250, 250, 250), -1)
    nx = int(cx + yaw * (2 * r / 3))                     # 鼻 = 黒い点
    cv2.circle(img, (nx, cy + r // 10), r // 12, (0, 0, 0), -1)
    g = 20 + emotion * 28                                 # 口 = 表情コード
    cv2.rectangle(img, (cx - r // 4, cy + r // 2), (cx + r // 4, cy + r // 2 + r // 8), (g, g, g), -1)


class MockEngine:
    def __init__(self, seed=0):
        self.rng = np.random.default_rng(seed)
        base = np.random.default_rng(123)
        self.centers = {h: base.normal(size=128) for h in range(0, 180, 2)}

    def detect(self, img):
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        mask = ((hsv[..., 1] > 120) & (hsv[..., 2] > 40)).astype(np.uint8) * 255
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((25, 25), np.uint8))
        cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        faces = []
        for c in cnts:
            x, y, w, h = cv2.boundingRect(c)
            if w < 30 or h < 30:
                continue
            roi = img[y:y + h, x:x + w]
            dark = np.argwhere(roi.max(axis=2) < 15)
            nose = (dark.mean(axis=0)[::-1] + (x, y)) if len(dark) else np.array([x + w / 2, y + h * 0.55])
            lm = np.array([[x + 0.33 * w, y + 0.4 * h], [x + 0.67 * w, y + 0.4 * h], nose,
                           [x + 0.38 * w, y + 0.78 * h], [x + 0.62 * w, y + 0.78 * h]], np.float32)
            f = Face((x, y, w, h), lm, 0.99)
            f._hue = int(np.median(hsv[y:y + h, x:x + w, 0][mask[y:y + h, x:x + w] > 0]))
            # 口の四角の濃さを読む
            r = w // 2
            my = y + h // 2 + r // 2 + r // 16
            f._mouth = int(img[min(img.shape[0] - 1, my), x + w // 2].mean())
            faces.append(f)
        return faces

    def embed(self, img, face):
        hue = int(round(face._hue / 2) * 2) % 180
        v = self.centers[hue] + self.rng.normal(scale=0.45, size=128)
        return (v / np.linalg.norm(v)).astype(np.float32)

    def emotion(self, img, face):
        k = int(np.clip(round((face._mouth - 20) / 28), 0, 7))
        p = np.full(8, 0.02, np.float32)
        p[k] = 0.86
        return p / p.sum()


def make_image(hue, emotion=0, yaw=0.0, w=480, h=480, bg=90, value=210, blur=0):
    img = np.full((h, w, 3), bg, np.uint8)
    draw_face(img, w // 2, h // 2, hue, emotion, yaw, r=110, value=value)
    if blur:
        img = cv2.GaussianBlur(img, (blur, blur), 0)
    return img
