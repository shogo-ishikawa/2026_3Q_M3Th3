"""リアルタイム実行(カメラ映像 → 検出 → 照合 + 表情分類 → 表示・記録)。"""
from __future__ import annotations

import time
from datetime import datetime

import cv2
import numpy as np

from . import config, render
from .camera import open_source
from .liveness import Challenge
from .quality import assess
from .registry import FaceDB, UNKNOWN
from .session_log import SessionLog
from .tracker import Tracker, current_identity

MAX_WIDTH = 960
KEY_EMOTION ={ord(str(i + 1)): i for i in range(8)}


def analyze(engine, db, frame, faces, tracker, threshold):
    """1フレーム分の解析。照合と表情分類はそれぞれ独立に行い、結果を追跡に渡す。"""
    pairs = tracker.step(faces)
    bests = {}
    for track, face in pairs:
        track.quality = assess(frame, face.box, face.landmarks)
        feat = engine.embed(frame, face)                      # 照合
        name, sim, best = db.match(feat, threshold)
        probs = engine.emotion(frame, face)                   # 表情分類
        track.update(name, sim, probs)
        bests[track.id] = best
    return bests


def run(engine, source=0, threshold=config.DEFAULT_THRESHOLD, mirror=True,
        headless=False, max_frames=None, log_every=1, on_frame=None,
        auth=False, confirm_frames=8, greet_sec=3.0):
    """auth=True のときは「認証モード」: 登録者を確認できたらあいさつを表示して終了する。"""
    db = FaceDB()
    if not db.names:
        print("[注意] 登録者がいません。全員「未登録」になります。先に register を実行してください。")
    cap = open_source(source)
    tracker = Tracker()
    log = SessionLog()
    text = render.Text()
    st = {"threshold": threshold, "privacy": True, "avatar": True, "fps": 0.0,
          "challenge": None, "toast": "", "auth": auth, "auth_msg": ""}
    auth_name, streak, last_name = None, 0, None
    toast_until = 0.0
    frame_no, t_prev = 0, time.time()
    canvas = None
    win = "Face Recognition + Emotion"
    print(f"記録先: {log.path}")
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            frame_no += 1
            if frame.shape[1] > MAX_WIDTH:                       # 大きすぎる映像は縮小(速度と画面サイズのため)
                s = MAX_WIDTH / frame.shape[1]
                frame = cv2.resize(frame, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
            if mirror:
                frame = cv2.flip(frame, 1)

            faces = engine.detect(frame)
            bests = analyze(engine, db, frame, faces, tracker, st["threshold"])
            visible = tracker.visible()
            main = max(visible, key=lambda t: t.box[2] * t.box[3]) if visible else None

            # 動作チャレンジの進行
            ch = st["challenge"]
            if ch is not None and ch.state == "running":
                target = next((t for t in visible if t.id == ch.track_id), None)
                if ch.update(target) != "running":
                    log.event(frame_no, f"challenge_{ch.state}:{ch.message}")

            # 認証モード: 同じ登録者だと続けて確定できたら成功
            if auth:
                n = current_identity(main, st["threshold"]) if main is not None else None
                if n is None:
                    streak, st["auth_msg"] = 0, "カメラの方を見てください"
                elif n == "未登録":
                    streak, st["auth_msg"] = 0, "登録されていない方です"
                elif n == "判定中":
                    streak, st["auth_msg"] = 0, "確認しています…"
                else:
                    streak = streak + 1 if n == last_name else 1
                    st["auth_msg"] = f"確認しています… {min(100, streak * 100 // confirm_frames)}%"
                last_name = n
                if streak >= confirm_frames:
                    auth_name = n
                    log.event(frame_no, f"auth_success:{n}")
                    print(f"AUTH_SUCCESS:{n}", flush=True)

            # キー入力
            key = 0xFF
            if not headless:
                key = cv2.waitKey(1) & 0xFF
            elif on_frame is not None:
                key = on_frame(frame_no, st, tracker) or 0xFF
            self_report = ""
            if key in (ord("q"), 27):
                break
            elif key in KEY_EMOTION and main is not None:
                i = KEY_EMOTION[key]
                self_report = config.EMOTIONS_EN[i]
                est = config.EMOTIONS_JA[main.emotion_index] if main.emotion is not None else "-"
                st["toast"] = f"申告:{config.EMOTIONS_JA[i]} / 推定:{est}"
                toast_until = time.time() + 3
            elif key in (ord("+"), ord("=")):
                st["threshold"] = round(min(0.95, st["threshold"] + 0.01), 3)
            elif key in (ord("-"), ord("_")):
                st["threshold"] = round(max(0.05, st["threshold"] - 0.01), 3)
            elif key == ord("b"):
                st["privacy"] = not st["privacy"]
            elif key == ord("a"):
                st["avatar"] = not st["avatar"]
            elif key == ord("c") and main is not None:
                st["challenge"] = Challenge(main.id, main.name)
                log.event(frame_no, f"challenge_start:#{main.id}:{main.name}")
            if time.time() > toast_until:
                st["toast"] = ""

            # 記録
            if frame_no % log_every == 0 or self_report:
                for t in visible:
                    rep = self_report if (self_report and t is main) else ""
                    log.row(frame_no, t, bests.get(t.id), st["threshold"], self_report=rep)

            # 表示
            now = time.time()
            st["fps"] = 0.9 * st["fps"] + 0.1 * (1.0 / max(1e-3, now - t_prev))
            t_prev = now
            st.update(main=main, mood=render.mood_index(visible), n_faces=len(visible))
            canvas = compose(frame, visible, st, text)
            if key == ord("s"):
                config.SHOT_DIR.mkdir(parents=True, exist_ok=True)
                p = config.SHOT_DIR / f"shot_{datetime.now():%Y%m%d_%H%M%S}.png"
                cv2.imencode(".png", canvas)[1].tofile(str(p))   # 日本語のパスでも保存できる
                st["toast"] = f"保存しました: {p.name}"
                toast_until = time.time() + 3
            if not headless:
                cv2.imshow(win, canvas)
                if frame_no > 2 and cv2.getWindowProperty(win, cv2.WND_PROP_VISIBLE) < 1:
                    break                                        # ×ボタンで閉じられた
            if auth_name:
                emo = config.EMOTIONS_JA[main.emotion_index] if main.emotion is not None else None
                canvas = greeting(canvas.shape, auth_name, emo, text)
                if not headless:
                    end = time.time() + greet_sec
                    while time.time() < end:
                        cv2.imshow(win, canvas)
                        if cv2.waitKey(30) & 0xFF in (ord("q"), 27, 13, 32):
                            break
                break
            if max_frames and frame_no >= max_frames:
                break
    finally:
        cap.release()
        log.close()
        if not headless:
            cv2.destroyAllWindows()
    print(f"終了しました。記録: {log.path}\n  レポート作成: python main.py report \"{log.path}\"")
    return log.path, canvas, auth_name


def greeting(shape, name, emotion, text):
    """認証成功のあいさつ画面。"""
    H, W = shape[:2]
    img = np.zeros((H, W, 3), np.uint8)
    for y in range(H):                                   # 上から下へのグラデーション
        img[y, :] = (int(60 + 50 * y / H), int(110 + 60 * y / H), int(40 + 30 * y / H))
    cv2.circle(img, (W // 2, H // 2 - 150), 60, (255, 255, 255), 6)
    cv2.line(img, (W // 2 - 28, H // 2 - 150), (W // 2 - 6, H // 2 - 126), (255, 255, 255), 8)
    cv2.line(img, (W // 2 - 6, H // 2 - 126), (W // 2 + 32, H // 2 - 176), (255, 255, 255), 8)
    text.add_center((W // 2, H // 2 - 60), "認証しました", (230, 255, 230), 34)
    honor = "" if name.endswith(("さん", "くん", "君", "ちゃん", "様", "先生")) else "さん"
    text.add_center((W // 2, H // 2), f"{name}{honor}", render.WHITE, 72)
    text.add_center((W // 2, H // 2 + 95), "こんにちは!", render.WHITE, 60)
    if emotion:
        text.add_center((W // 2, H // 2 + 185), f"今日の表情: {emotion}", (220, 240, 220), 24)
    text.add_center((W // 2, H - 50), "まもなくホーム画面に戻ります", (200, 220, 200), 18)
    return text.flush(img)


def compose(frame, tracks, st, text):
    H, W = frame.shape[:2]
    ch = max(H, 780)
    canvas = np.zeros((ch, W + render.PANEL_W, 3), np.uint8)
    view = frame.copy()
    render.draw_faces(view, tracks, text, st["privacy"], st["threshold"])
    if st.get("auth"):
        cv2.rectangle(view, (0, 0), (W, 56), (40, 40, 40), -1)
        text.add((16, 12), "顔認証  " + st.get("auth_msg", ""), render.WHITE, 24)
    canvas[:H, :W] = view
    render.draw_panel(canvas, W, text, st)
    return text.flush(canvas)
