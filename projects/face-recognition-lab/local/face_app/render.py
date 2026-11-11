"""画面表示(カメラ映像への重ね描き・情報パネル・アバター)。

日本語は OpenCV だけでは描けないため、Pillow とPC内の日本語フォントを使う。
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from . import config

FONT_CANDIDATES = [
    # Windows
    "C:/Windows/Fonts/meiryo.ttc", "C:/Windows/Fonts/YuGothM.ttc",
    "C:/Windows/Fonts/msgothic.ttc", "C:/Windows/Fonts/BIZ-UDGothicR.ttc",
    # macOS
    "/System/Library/Fonts/ヒラギノ角ゴシック W4.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/Library/Fonts/Arial Unicode.ttf",
    # Linux
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf",
]

PANEL_W = 360
GREEN, RED, YELLOW, WHITE, GRAY = (80, 220, 80), (60, 60, 240), (40, 220, 240), (255, 255, 255), (150, 150, 150)


def find_font():
    for p in FONT_CANDIDATES:
        if Path(p).exists():
            return p
    return None


class Text:
    """文字を溜めておき、1フレームに1回まとめて描く(高速化のため)。"""

    def __init__(self):
        self.path = find_font()
        self.cache = {}
        self.items = []
        if self.path is None:
            print("[注意] 日本語フォントが見つからないため、日本語が ? で表示されます。"
                  " render.py の FONT_CANDIDATES にフォントのパスを追加してください。", file=sys.stderr)

    def font(self, size):
        if size not in self.cache:
            self.cache[size] = ImageFont.truetype(self.path, size)
        return self.cache[size]

    def add(self, xy, text, color=WHITE, size=18, bg=None):
        self.items.append((xy, str(text), color, size, bg))

    def add_center(self, center, text, color=WHITE, size=18):
        """(cx, y) を中心に横方向へ中央そろえで描く。"""
        cx, y = center
        if self.path is not None:
            l, _, r, _ = self.font(size).getbbox(str(text))
            w = r - l
        else:
            w = len(str(text)) * size * 0.6
        self.add((cx - w / 2, y), text, color, size)

    def flush(self, img):
        if not self.items:
            return img
        if self.path is None:
            for (x, y), t, c, s, bg in self.items:
                cv2.putText(img, t.encode("ascii", "replace").decode(), (int(x), int(y + s)),
                            cv2.FONT_HERSHEY_SIMPLEX, s / 32, c, 1, cv2.LINE_AA)
            self.items.clear()
            return img
        pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        d = ImageDraw.Draw(pil)
        for (x, y), t, c, s, bg in self.items:
            f = self.font(s)
            if bg is not None:
                l, tp, r, b = d.textbbox((x, y), t, font=f)
                d.rectangle((l - 3, tp - 2, r + 3, b + 2), fill=bg[::-1])
            d.text((x, y), t, font=f, fill=c[::-1])
        self.items.clear()
        return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)


# ---------------------------------------------------------------- 映像への重ね描き
def name_color(name):
    if name == "判定中":
        return YELLOW
    return RED if name == "未登録" else GREEN


def blur_box(img, box):
    x, y, w, h = box
    H, W = img.shape[:2]
    x0, y0, x1, y1 = max(0, x), max(0, y), min(W, x + w), min(H, y + h)
    if x1 - x0 > 4 and y1 - y0 > 4:
        roi = img[y0:y1, x0:x1]
        small = cv2.resize(roi, (8, 8), interpolation=cv2.INTER_LINEAR)
        img[y0:y1, x0:x1] = cv2.resize(small, (x1 - x0, y1 - y0), interpolation=cv2.INTER_NEAREST)


def draw_faces(img, tracks, text: Text, privacy: bool, threshold: float):
    from .tracker import current_identity
    for t in tracks:
        x, y, w, h = t.box
        name = t.name
        if privacy and current_identity(t, threshold) in ("未登録", "判定中"):
            blur_box(img, t.box)
        c = name_color(name)
        cv2.rectangle(img, (x, y), (x + w, y + h), c, 2)
        if t.face is not None:
            for px, py in t.face.landmarks.astype(int):
                cv2.circle(img, (int(px), int(py)), 2, (255, 255, 0), -1)
        emo = config.EMOTIONS_JA[t.emotion_index] if t.emotion is not None else "-"
        label = f"#{t.id} {name}  類似度{t.sim:.2f}"
        text.add((x, max(0, y - 46)), label, WHITE, 18, bg=c)
        text.add((x, max(0, y - 22)), f"表情の推定: {emo}", WHITE, 16, bg=(50, 50, 50))


# ---------------------------------------------------------------- アバター
def draw_avatar(img, cx, cy, r, emotion_idx, yaw=0.0, probs=None):
    """【独自機能】表情に合わせて動くキャラクター。顔の向き(yaw)にも追従する。"""
    col = config.EMOTION_COLORS[emotion_idx]
    cv2.circle(img, (cx, cy), r, (90, 200, 250), -1)
    cv2.circle(img, (cx, cy), r, col, 4)
    dx = int(np.clip(yaw, -0.6, 0.6) * r * 0.6)
    ex, ey, er = int(r * 0.38), int(r * 0.18), max(3, r // 9)
    e = emotion_idx
    open_eye = er + (er if e in (2, 6) else 0)            # 驚き・恐れは目を大きく
    for sx in (-1, 1):
        px = cx + dx + sx * ex
        if e == 1:                                          # 喜び: にっこり目
            cv2.ellipse(img, (px, cy - ey), (er + 2, er), 0, 180, 360, (40, 40, 40), 3)
        else:
            cv2.circle(img, (px, cy - ey), open_eye, (40, 40, 40), -1)
        # 眉
        by = cy - ey - int(r * 0.25)
        inner_x, outer_x = px - sx * er * 2, px + sx * er * 2
        if e == 4:      # 怒り: 内側が下がる眉
            cv2.line(img, (inner_x, by + 6), (outer_x, by - 4), (40, 40, 40), 3)
        elif e == 3 or e == 6:  # 悲しみ・恐れ: 内側が上がる眉
            cv2.line(img, (inner_x, by - 6), (outer_x, by + 4), (40, 40, 40), 3)
        else:
            cv2.line(img, (px - er * 2, by), (px + er * 2, by), (40, 40, 40), 3)
    mx, my, mw = cx + dx, cy + int(r * 0.4), int(r * 0.4)
    if e == 1:
        cv2.ellipse(img, (mx, my - 8), (mw, int(mw * 0.7)), 0, 0, 180, (40, 40, 200), -1)
    elif e in (2, 6):
        cv2.ellipse(img, (mx, my), (mw // 2, int(mw * 0.6)), 0, 0, 360, (40, 40, 120), -1)
    elif e == 3:
        cv2.ellipse(img, (mx, my + 6), (mw, int(mw * 0.5)), 0, 180, 360, (40, 40, 40), 3)
    elif e in (4, 5, 7):
        pts = np.array([[mx - mw, my], [mx - mw // 3, my - 5], [mx + mw // 3, my + 5], [mx + mw, my]])
        cv2.polylines(img, [pts], False, (40, 40, 40), 3)
    else:
        cv2.line(img, (mx - mw, my), (mx + mw, my), (40, 40, 40), 3)


# ---------------------------------------------------------------- 情報パネル
def bar(img, x, y, w, h, ratio, color, marker=None):
    cv2.rectangle(img, (x, y), (x + w, y + h), (70, 70, 70), -1)
    cv2.rectangle(img, (x, y), (x + int(w * float(np.clip(ratio, 0, 1))), y + h), color, -1)
    if marker is not None:
        mx = x + int(w * float(np.clip(marker, 0, 1)))
        cv2.line(img, (mx, y - 3), (mx, y + h + 3), WHITE, 2)


def draw_timeline(img, x, y, w, h, history):
    cv2.rectangle(img, (x, y), (x + w, y + h), (45, 45, 45), -1)
    hist = list(history)[-150:]
    if len(hist) < 2:
        return
    arr = np.array(hist)
    n = len(arr)
    for k in range(arr.shape[1]):
        pts = np.array([[x + int(i * (w - 1) / max(1, n - 1)), y + h - int(arr[i, k] * (h - 2)) - 1]
                        for i in range(n)], np.int32)
        cv2.polylines(img, [pts], False, config.EMOTION_COLORS[k], 2 if k in (1, 3, 4) else 1)


def mood_index(tracks) -> float | None:
    """【独自機能】表情ラベルの合成スコア: 表情ラベル確率の重み付き平均。人物の気持ちや場の雰囲気を測定する値ではない。"""
    vals = [float(np.dot(t.emotion, config.MOOD_WEIGHTS)) for t in tracks if t.emotion is not None]
    return float(np.clip(np.mean(vals), -1, 1)) if vals else None


def draw_panel(canvas, x0, text: Text, st):
    """st: app から渡される表示用の状態(dict)。"""
    H = canvas.shape[0]
    cv2.rectangle(canvas, (x0, 0), (x0 + PANEL_W, H), (30, 30, 30), -1)
    x, y = x0 + 14, 10
    text.add((x, y), "顔照合・表情分析システム", WHITE, 20); y += 30
    text.add((x, y), f"FPS {st['fps']:.1f}   しきい値 {st['threshold']:.3f}"
             f"   ぼかし{'ON' if st['privacy'] else 'OFF'}", GRAY, 14); y += 24

    main = st.get("main")
    if main is None:
        text.add((x, y), "顔が映っていません", YELLOW, 18)
        y += 30
    else:
        c = name_color(main.name)
        text.add((x, y), f"照合: {main.name}", c, 22); y += 32
        text.add((x, y), f"類似度 {main.sim:.3f}(白線=しきい値)", GRAY, 14); y += 20
        bar(canvas, x, y, PANEL_W - 30, 10, main.sim, c, marker=st["threshold"]); y += 20

        text.add((x, y), "表情からの推定(本人の気持ちとは限りません)", GRAY, 13); y += 20
        if main.emotion is not None:
            for i, (ja, col) in enumerate(zip(config.EMOTIONS_JA, config.EMOTION_COLORS)):
                text.add((x, y - 3), ja, WHITE, 13)
                bar(canvas, x + 52, y, PANEL_W - 140, 10, main.emotion[i], col)
                text.add((x + PANEL_W - 80, y - 3), f"{main.emotion[i] * 100:4.0f}%", WHITE, 13)
                y += 17
        y += 4
        text.add((x, y), "表情ラベルの推移(直近)", GRAY, 13); y += 18
        draw_timeline(canvas, x, y, PANEL_W - 30, 60, main.history); y += 70

        if st["avatar"]:
            yaw = main.quality.yaw if main.quality else 0.0
            draw_avatar(canvas, x + 55, y + 55, 48, main.emotion_index, yaw)
        q = main.quality
        if q:
            qc = GREEN if q.score >= 80 else (YELLOW if q.score >= 60 else RED)
            text.add((x + 125, y), f"撮影条件 {q.score}点", qc, 16)
            text.add((x + 125, y + 22), f"明るさ{q.brightness:.0f} 向き{q.yaw:+.2f}", GRAY, 13)
            for k, a in enumerate(q.advice[:2]):
                text.add((x + 125, y + 42 + k * 18), a[:15], YELLOW, 13)
        y += 118

    mood = st.get("mood")
    if mood is not None:
        text.add((x, y), f"表情ラベルの合成スコア({st['n_faces']}人)", GRAY, 13); y += 18
        bar(canvas, x, y, PANEL_W - 30, 10, (mood + 1) / 2,
            GREEN if mood > 0.15 else (RED if mood < -0.15 else YELLOW), marker=0.5); y += 20

    ch = st.get("challenge")
    if ch is not None:
        col = GREEN if ch.state == "passed" else (RED if ch.state == "failed" else YELLOW)
        text.add((x, y), "動作チャレンジ", col, 15); y += 20
        msg = ch.instruction
        for k in range(0, len(msg), 21):
            text.add((x, y), msg[k:k + 21], col, 15); y += 19
        if ch.state == "running":
            text.add((x, y), f"残り {ch.remaining:.0f} 秒", col, 15); y += 19
    if st.get("toast"):
        text.add((x, y), st["toast"], (200, 200, 255), 14); y += 20

    keys = ["Q:終了  C:動作チャレンジ  B:ぼかし", "+/-:しきい値  A:アバター  S:保存",
            "1〜8:今の気持ちを申告して比較",
            "1中立 2喜び 3驚き 4悲しみ 5怒り 6嫌悪 7恐れ 8軽蔑"]
    yy = H - 20 * len(keys) - 6
    for k in keys:
        text.add((x, yy), k, GRAY, 13); yy += 20
