"""アプリ本体: PCの中だけで動く小さなWebサーバー + カメラ処理スレッド。

画面(face_app/web/)は専用ウィンドウ(Microsoft Edge のアプリモード)で開く。
通信先は 127.0.0.1(このPC自身)だけで、外部には一切送信しない。
"""
from __future__ import annotations

import base64
import csv
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import traceback
import urllib.request
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

import cv2
import numpy as np

from . import config
from .liveness import Challenge
from .quality import assess
from .registry import FaceDB, UNKNOWN
from .session_log import SessionLog
from .tracker import Tracker, current_identity

WEB_DIR = Path(__file__).resolve().parent / "web"
SETTINGS_PATH = config.DATA_DIR / "settings.json"
ACCESS_LOG = config.DATA_DIR / "access_log.csv"
ACCESS_FIELDS = ["time", "name", "result", "similarity", "emotion", "location"]
MAX_WIDTH = 960
DEFAULT_PORT = 8765

DEFAULT_SETTINGS = {
    "camera": 0,
    "threshold": config.DEFAULT_THRESHOLD,
    "confirm_frames": 8,
    "return_sec": 5,
    "location": "メインエントランス",
    "privacy_blur": True,
    "mirror": True,
    "register_shots": 10,
    "show_sec": 3.5,          # 認証の演出時間(0 にすると最速)
}

MIME = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8", ".png": "image/png",
        ".svg": "image/svg+xml", ".json": "application/json; charset=utf-8"}


# ------------------------------------------------------------------ 保存データ
def load_settings() -> dict:
    s = dict(DEFAULT_SETTINGS)
    try:
        s.update(json.loads(SETTINGS_PATH.read_text(encoding="utf-8")))
    except Exception:
        pass
    return s


def save_settings(s: dict):
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_PATH.write_text(json.dumps(s, ensure_ascii=False, indent=2), encoding="utf-8")


def append_access(row: dict):
    ACCESS_LOG.parent.mkdir(parents=True, exist_ok=True)
    new = not ACCESS_LOG.exists()
    with open(ACCESS_LOG, "a", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=ACCESS_FIELDS)
        if new:
            w.writeheader()
        w.writerow({k: row.get(k, "") for k in ACCESS_FIELDS})


def read_access(limit=500) -> list:
    if not ACCESS_LOG.exists():
        return []
    with open(ACCESS_LOG, encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    return rows[::-1][:limit]


def models_ready() -> bool:
    from .downloader import all_ready
    return all_ready()


def make_engine():
    if os.environ.get("FACEAPP_MOCK"):                      # テスト用の模擬エンジン
        sys.path.insert(0, str(config.ROOT / "tests"))
        from mock_engine import MockEngine
        return MockEngine(seed=1)
    from .engine import Engine
    return Engine()


def users_info(db: FaceDB) -> list:
    out = []
    for n in db.names:
        m = db.meta.get(n, {})
        out.append({"name": n, "templates": db.labels.count(n),
                    "consent_at": m.get("consent_at", ""),
                    "sources": len(m.get("sources", []))})
    return out


# ------------------------------------------------------------------ カメラ処理
class Worker:
    """カメラの読み込み・解析を行い、最新の映像(JPEG)と状態(JSON)を用意する。"""

    def __init__(self):
        self.lock = threading.Lock()          # state / jpeg 用
        self.engine_lock = threading.Lock()   # 推論エンジンは同時に1か所からだけ使う
        self.settings = load_settings()
        self.engine = None
        self.engine_error = ""
        self.db = FaceDB()
        self.mode = "idle"                    # idle / auth / analysis / register
        self.cap = None
        self.jpeg = None
        self.frame_id = 0
        self.frame_size = (640, 480)
        self.running = True
        self.download = {"active": False, "progress": 0.0, "error": "", "file": "", "detail": ""}
        self.camtest = {"active": False, "lines": [], "found": None}
        self._reset_mode_state()
        self.load_engine()
        self.thread = threading.Thread(target=self.loop, daemon=True)
        self.thread.start()

    # ---- 準備
    def load_engine(self):
        if self.engine is not None:
            return
        if not (models_ready() or os.environ.get("FACEAPP_MOCK")):
            return
        try:
            self.engine = make_engine()
            self.engine_error = ""
        except Exception as e:
            self.engine_error = str(e)

    def _reset_mode_state(self):
        self.tracker = Tracker()
        self.phase = "idle"                   # detecting / analyzing / matching / complete / unknown
        self.streak, self.last_name = 0, None
        self.auth_start, self.auth_track, self.elapsed, self.progress = None, None, 0.0, 0.0
        self.auth_msg = ""
        self.result = None
        self.unknown_logged = set()
        self.challenge = None
        self.toast, self.toast_until = "", 0.0
        self.reg = None
        self.session = None
        self.last_reg_t = 0.0
        self.faces_state = []
        self.main_id = None
        self.mood = None
        self.fps = 0.0
        self.error = ""

    def set_mode(self, mode, **kw):
        with self.engine_lock, self.lock:      # 解析の途中で状態を入れ替えないように両方の鍵を取る
            if self.session is not None:
                self.session.close()
            self._reset_mode_state()
            self.mode = mode
            if mode == "analysis":
                self.session = SessionLog()
            if mode == "register":
                self.reg = {"name": kw["name"], "feats": [], "target": int(self.settings["register_shots"]),
                            "msg": "カメラに顔を映してください", "done": False, "saved": 0}
            if mode == "idle":
                self.jpeg = None

    # ---- カメラ
    def _open_camera(self):
        src = os.environ.get("FACEAPP_SOURCE")
        if src:
            cap = cv2.VideoCapture(src)
            if not cap.isOpened():
                raise RuntimeError(f"動画を開けません: {src}")
            return cap
        from .camera import open_source
        return open_source(int(self.settings["camera"]))

    def _release(self):
        if self.cap is not None:
            self.cap.release()
            self.cap = None

    def _read(self):
        ok, frame = self.cap.read()
        if not ok and os.environ.get("FACEAPP_SOURCE"):      # 動画は最初に戻してくり返す
            self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ok, frame = self.cap.read()
        return ok, frame

    # ---- メインループ
    def loop(self):
        t_prev = time.time()
        while self.running:
            if self.mode == "idle" or self.engine is None or self.camtest["active"]:
                self._release()
                time.sleep(0.05)
                continue
            try:
                if self.cap is None:
                    self.cap = self._open_camera()
                ok, frame = self._read()
                if not ok:
                    raise RuntimeError("カメラから映像を取得できませんでした")
                if frame.shape[1] > MAX_WIDTH:
                    s = MAX_WIDTH / frame.shape[1]
                    frame = cv2.resize(frame, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
                if self.settings["mirror"] and not os.environ.get("FACEAPP_SOURCE"):
                    frame = cv2.flip(frame, 1)
                with self.engine_lock:
                    self.process(frame)
                now = time.time()
                self.fps = 0.9 * self.fps + 0.1 / max(1e-3, now - t_prev)
                t_prev = now
                if os.environ.get("FACEAPP_SOURCE"):
                    time.sleep(0.04)
            except Exception as e:
                traceback.print_exc()
                with self.lock:
                    self.error = str(e)
                    self.mode = "idle"
                self._release()

    def process(self, frame):
        mode = self.mode
        view = frame.copy()
        st = self.settings
        if mode in ("auth", "analysis"):
            faces = self.engine.detect(frame)
            pairs = self.tracker.step(faces)
            for track, face in pairs:
                track.quality = assess(frame, face.box, face.landmarks)
                feat = self.engine.embed(frame, face)
                name, sim, best = self.db.match(feat, float(st["threshold"]))
                probs = self.engine.emotion(frame, face)
                track.update(name, sim, probs)
                track.best = best
            visible = self.tracker.visible()
            main = max(visible, key=lambda t: t.box[2] * t.box[3]) if visible else None
            self.main_id = main.id if main else None
            if st["privacy_blur"]:
                for t in visible:
                    if current_identity(t, float(st["threshold"])) in (UNKNOWN, "判定中"):
                        blur(view, t.box)
            if mode == "auth":
                self.auth_step(main)
            else:
                self.analysis_step(visible, main)
            self.faces_state = [self.face_json(t, frame.shape) for t in visible]
            vals = [float(np.dot(t.emotion, config.MOOD_WEIGHTS)) for t in visible if t.emotion is not None]
            self.mood = float(np.clip(np.mean(vals), -1, 1)) if vals else None
        elif mode == "register":
            self.register_step(frame)
        ok, buf = cv2.imencode(".jpg", view, [cv2.IMWRITE_JPEG_QUALITY, 82])
        with self.lock:
            if ok:
                self.jpeg = buf.tobytes()
                self.frame_id += 1
                self.frame_size = (frame.shape[1], frame.shape[0])

    # ---- 認証
    def auth_step(self, main):
        """認証の進行。照合は毎フレーム行い、表示の段階は「演出時間」に合わせて進める。

        演出時間(show_sec)の間も照合を続け、最後まで同じ登録者だった場合だけ成功にする。
        """
        if self.phase == "complete":
            return
        need = int(self.settings["confirm_frames"])
        total = max(0.0, float(self.settings.get("show_sec", 3.5)))
        now = time.time()
        if main is None:
            self.phase, self.streak, self.auth_msg = "detecting", 0, "カメラの方を見てください"
            self.auth_start, self.auth_track, self.elapsed = None, None, 0.0
            self.progress = 0.0
            return
        if self.auth_start is None or main.id != self.auth_track:     # 新しい顔をとらえた
            self.auth_start, self.auth_track, self.streak = now, main.id, 0
        n = current_identity(main, float(self.settings["threshold"]))
        if n in (UNKNOWN, "判定中"):
            self.streak, self.last_name = 0, None
            self.auth_start, self.elapsed, self.progress = now, 0.0, 0.0
            self.phase = "unknown" if n == UNKNOWN else "analyzing"
            self.auth_msg = "現在の顔を登録者と照合できません" if n == UNKNOWN else "判定を確認しています"
            if n == UNKNOWN and len(main.names) >= 3 and main.id not in self.unknown_logged:
                self.unknown_logged.add(main.id)
                append_access({"time": now_str(), "name": "-", "result": "未登録",
                               "similarity": f"{main.raw_sim:.3f}", "location": self.settings["location"]})
            return
        if n != self.last_name:
            self.auth_start, self.streak = now, 1
        else:
            self.streak += 1
        self.last_name = n
        el = now - self.auth_start
        self.elapsed = el

        # 表示の段階(時間で進む)
        if el < total * 0.2:
            self.phase, self.auth_msg = "detecting", "顔をとらえました"
        elif el < total * 0.55:
            self.phase, self.auth_msg = "analyzing", "顔の特徴を解析しています"
        else:
            self.phase, self.auth_msg = "matching", "登録者と照合しています"

        if el >= total and self.streak >= need:
            emo = config.EMOTIONS_JA[main.emotion_index] if main.emotion is not None else ""
            m = self.db.meta.get(n, {})
            self.result = {"name": n, "similarity": round(main.sim, 3), "emotion": emo,
                           "time": now_str(), "location": self.settings["location"],
                           "consent_at": m.get("consent_at", ""),
                           "templates": self.db.labels.count(n)}
            self.phase, self.auth_msg = "complete", "認証が完了しました"
            append_access({"time": self.result["time"], "name": n, "result": "成功",
                           "similarity": f"{main.sim:.3f}", "emotion": emo,
                           "location": self.settings["location"]})
        if self.phase == "complete":
            self.progress = 1.0
        else:
            t_part = min(1.0, el / total) if total > 0 else 1.0
            self.progress = 0.97 * min(t_part, max(t_part * 0.9, self.streak / max(1, need)))

    # ---- 分析
    def analysis_step(self, visible, main):
        if self.challenge is not None and self.challenge.state == "running":
            target = next((t for t in visible if t.id == self.challenge.track_id), None)
            if self.challenge.update(target) != "running" and self.session:
                self.session.event(self.frame_id, f"challenge_{self.challenge.state}:{self.challenge.message}")
        if self.session:
            for t in visible:
                self.session.row(self.frame_id, t, getattr(t, "best", None), float(self.settings["threshold"]))

    def self_report(self, idx):
        with self.lock:
            main = next((t for t in self.tracker.visible() if t.id == self.main_id), None)
            if main is None or self.session is None:
                return "顔が映っていません"
            self.session.row(self.frame_id, main, getattr(main, "best", None),
                             float(self.settings["threshold"]), self_report=config.EMOTIONS_EN[idx])
            est = config.EMOTIONS_JA[main.emotion_index] if main.emotion is not None else "-"
            msg = f"申告: {config.EMOTIONS_JA[idx]} / 推定: {est}"
            self.toast, self.toast_until = msg, time.time() + 3
            return msg

    def start_challenge(self):
        with self.lock:
            main = next((t for t in self.tracker.visible() if t.id == self.main_id), None)
            if main is None:
                return False
            self.challenge = Challenge(main.id, main.name)
            if self.session:
                self.session.event(self.frame_id, f"challenge_start:#{main.id}:{main.name}")
            return True

    # ---- 登録
    def register_step(self, frame):
        from .engine import largest_face
        r = self.reg
        if r["done"]:
            return
        face = largest_face(self.engine.detect(frame))
        self.faces_state = []
        if face is None:
            r["msg"], r["ok"] = "カメラに顔を映してください", False
            return
        q = assess(frame, face.box, face.landmarks)
        good = q.score >= 80
        r["ok"] = good
        r["msg"] = "そのままでお待ちください" if good else (q.advice[0] if q.advice else "調整してください")
        tips = ["正面を向いてください", "少し右を向いてください", "少し左を向いてください",
                "自然な表情で", "少し笑ってください"]
        r["tip"] = tips[(len(r["feats"]) // 2) % len(tips)]
        self.faces_state = [{"id": 0, "box": norm_box(face.box, frame.shape),
                             "lm": norm_lm(face.landmarks, frame.shape), "name": r["name"],
                             "quality": {"score": q.score, "advice": q.advice}}]
        if good and time.time() - self.last_reg_t > 0.5:
            r["feats"].append(self.engine.embed(frame, face))
            fl = cv2.flip(frame, 1)
            f2 = largest_face(self.engine.detect(fl))
            r["feats"].append(self.engine.embed(fl, f2) if f2 is not None else r["feats"][-1])
            self.last_reg_t = time.time()
        if len(r["feats"]) // 2 >= r["target"]:
            db = FaceDB()
            db.add(r["name"], r["feats"], source="camera")
            db.save()
            self.db = db
            r["done"], r["saved"], r["msg"] = True, len(r["feats"]) // 2, "登録が完了しました"

    # ---- 状態(画面へ渡すJSON)
    def face_json(self, t, shape):
        q = t.quality
        return {
            "id": t.id, "box": norm_box(t.box, shape),
            "lm": norm_lm(t.face.landmarks, shape) if t.face is not None else [],
            "name": t.name, "sim": round(t.sim, 3), "best": getattr(t, "best", None),
            "emotion": int(t.emotion_index) if t.emotion is not None else None,
            "probs": [round(float(p), 3) for p in t.emotion] if t.emotion is not None else None,
            "history": [[round(float(p), 2) for p in h] for h in list(t.history)[-90:]] if t.id == self.main_id else None,
            "quality": {"score": q.score, "advice": q.advice, "yaw": round(q.yaw, 2),
                        "brightness": round(q.brightness)} if q else None,
            "main": t.id == self.main_id,
        }

    def state(self) -> dict:
        with self.lock:
            ch = self.challenge
            reg = None
            if self.reg:
                reg = {k: self.reg.get(k) for k in ("name", "target", "msg", "done", "saved", "ok", "tip")}
                reg["count"] = len(self.reg["feats"]) // 2
            if time.time() > self.toast_until:
                self.toast = ""
            return {
                "mode": self.mode, "phase": self.phase, "frame_id": self.frame_id,
                "frame_size": self.frame_size, "fps": round(self.fps, 1),
                "faces": self.faces_state if self.mode != "idle" else [],
                "auth": {"msg": self.auth_msg, "progress": round(self.progress, 3),
                         "result": self.result, "elapsed": round(self.elapsed, 2),
                         "total": float(self.settings.get("show_sec", 3.5)),
                         "candidates": self.db.names if self.mode == "auth" else []},
                "register": reg,
                "challenge": {"state": ch.state, "text": ch.instruction,
                              "remaining": round(ch.remaining, 1)} if ch else None,
                "mood": self.mood, "toast": self.toast, "error": self.error,
                "models_ready": models_ready() or bool(os.environ.get("FACEAPP_MOCK")),
                "engine_ready": self.engine is not None, "engine_error": self.engine_error,
                "download": self.download, "camtest": self.camtest,
                "has_session": self.session is not None,
            }

    # ---- モデルのダウンロード
    def start_download(self):
        if self.download.get("active"):
            return
        from .downloader import download_all
        self.download = {"active": True, "progress": 0.0, "error": "", "file": "", "detail": "準備中…"}

        def work():
            try:
                if download_all(self.download):
                    self.engine = None
                    self.load_engine()
            except Exception as e:
                self.download.update(active=False, error=f"予期しないエラー: {e}")
            self.download["active"] = False

        threading.Thread(target=work, daemon=True).start()

    def import_model(self, filename, data):
        from .downloader import import_file
        ok, msg = import_file(filename, data)
        if ok and models_ready():
            self.engine = None
            self.load_engine()
        return ok, msg

    # ---- カメラ診断
    def start_camtest(self):
        if self.camtest["active"]:
            return
        self.set_mode("idle")
        self.camtest = {"active": True, "lines": [], "found": None}

        def work():
            import io
            from contextlib import redirect_stdout
            from .camera import diagnose
            time.sleep(0.3)
            buf = io.StringIO()
            try:
                with redirect_stdout(buf):
                    found = diagnose()
            except Exception as e:
                found, buf = [], io.StringIO(str(e))
            self.camtest = {"active": False, "lines": buf.getvalue().splitlines(),
                            "found": found[0][0] if found else -1}

        threading.Thread(target=work, daemon=True).start()


def now_str():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def norm_box(box, shape):
    H, W = shape[:2]
    x, y, w, h = box
    return [round(x / W, 4), round(y / H, 4), round(w / W, 4), round(h / H, 4)]


def norm_lm(lm, shape):
    H, W = shape[:2]
    return [[round(float(px) / W, 4), round(float(py) / H, 4)] for px, py in lm]


def blur(img, box):
    x, y, w, h = box
    H, W = img.shape[:2]
    x0, y0, x1, y1 = max(0, x), max(0, y), min(W, x + w), min(H, y + h)
    if x1 - x0 > 4 and y1 - y0 > 4:
        roi = img[y0:y1, x0:x1]
        small = cv2.resize(roi, (10, 10), interpolation=cv2.INTER_LINEAR)
        img[y0:y1, x0:x1] = cv2.resize(small, (x1 - x0, y1 - y0), interpolation=cv2.INTER_NEAREST)


# ------------------------------------------------------------------ HTTP
class App:
    def __init__(self):
        self.worker = Worker()
        self.last_seen = time.time()
        self.had_client = False
        self.bye_at = None


def make_handler(app: App):
    w = app.worker

    class H(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *a):
            pass

        # -- 応答の共通処理
        def send_json(self, obj, code=200):
            body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def send_file(self, path: Path):
            if not path.exists() or not path.is_file():
                self.send_error(404)
                return
            body = path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", MIME.get(path.suffix.lower(), "application/octet-stream"))
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def body(self):
            n = int(self.headers.get("Content-Length") or 0)
            if n == 0:
                return {}
            try:
                return json.loads(self.rfile.read(n).decode("utf-8"))
            except Exception:
                return {}

        def touch(self):
            app.last_seen = time.time()
            app.had_client = True
            app.bye_at = None

        def trusted_request(self):
            """別サイトやDNSリバインディング経由でこのPCのAPIを操作させない。"""
            port = self.server.server_address[1]
            hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
            if self.headers.get("Host", "").lower() not in hosts:
                self.send_json({"ok": False, "error": "このPCのアプリ画面から操作してください。"}, 403)
                return False
            origin = self.headers.get("Origin")
            if origin is not None and origin.lower() not in {f"http://{h}" for h in hosts}:
                self.send_json({"ok": False, "error": "別サイトからの操作は受け付けません。"}, 403)
                return False
            return True

        # -- GET
        def do_GET(self):
            if not self.trusted_request():
                return
            path = urlparse(self.path).path
            if path in ("/", "/index.html"):
                return self.send_file(WEB_DIR / "index.html")
            if path.startswith("/static/"):
                p = (WEB_DIR / unquote(path[len("/static/"):])).resolve()
                if WEB_DIR.resolve() not in p.parents:
                    return self.send_error(403)
                return self.send_file(p)
            if path.startswith("/reports/"):
                p = (config.REPORT_DIR / unquote(path[len("/reports/"):])).resolve()
                if config.REPORT_DIR.resolve() not in p.parents:
                    return self.send_error(403)
                return self.send_file(p)
            if path == "/api/ping":
                return self.send_json({"app": "facegate"})
            if path == "/api/state":
                self.touch()
                return self.send_json(w.state())
            if path == "/api/users":
                return self.send_json({"users": users_info(w.db)})
            if path == "/api/logs":
                return self.send_json({"logs": read_access()})
            if path == "/api/settings":
                return self.send_json(w.settings)
            if path == "/api/summary":
                logs = read_access(5000)
                today = datetime.now().strftime("%Y-%m-%d")
                ok_today = [r for r in logs if r["time"].startswith(today) and r["result"] == "成功"]
                last = next((r for r in logs if r["result"] == "成功"), None)
                return self.send_json({"users": len(w.db.names), "today": len(ok_today),
                                       "last": last, "recent": logs[:6],
                                       "unknown_today": sum(1 for r in logs if r["time"].startswith(today)
                                                            and r["result"] == "未登録")})
            if path == "/stream.mjpg":
                return self.stream()
            self.send_error(404)

        def stream(self):
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            last = -1
            try:
                while w.running:
                    with w.lock:
                        fid, data = w.frame_id, w.jpeg
                    if data is None or fid == last:
                        time.sleep(0.02)
                        if w.mode == "idle" and data is None:
                            time.sleep(0.2)
                        continue
                    last = fid
                    self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                                     + str(len(data)).encode() + b"\r\n\r\n" + data + b"\r\n")
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                pass
            self.close_connection = True

        # -- POST
        def do_POST(self):
            if not self.trusted_request():
                return
            u = urlparse(self.path)
            path = u.path
            if path == "/api/models/upload":            # モデルファイルの取り込み(生のバイト列で受け取る)
                from urllib.parse import parse_qs
                name = parse_qs(u.query).get("name", [""])[0]
                n = int(self.headers.get("Content-Length") or 0)
                data = self.rfile.read(n)
                try:
                    ok, msg = w.import_model(name, data)
                except Exception as e:
                    ok, msg = False, str(e)
                return self.send_json({"ok": ok, "msg": msg, "ready": models_ready(),
                                       "engine_ready": w.engine is not None})
            d = self.body()
            try:
                if path == "/api/mode":
                    mode = d.get("mode", "idle")
                    if mode != "idle" and w.engine is None:
                        return self.send_json({"ok": False, "error": "先にモデルの準備をしてください"})
                    if mode == "auth" and not w.db.names:
                        return self.send_json({"ok": False, "error": "まだ誰も登録されていません"})
                    if mode == "register":
                        name = (d.get("name") or "").strip()
                        if not name:
                            return self.send_json({"ok": False, "error": "名前を入力してください"})
                        if not d.get("consent"):
                            return self.send_json({"ok": False, "error": "本人の同意が必要です"})
                        w.set_mode("register", name=name)
                    else:
                        w.set_mode(mode)
                    return self.send_json({"ok": True})
                if path == "/api/users/delete":
                    from .privacy import delete_person
                    # セッションを閉じてから消す。古い顔の追跡や書込みを続けない。
                    w.set_mode("idle")
                    with w.engine_lock, w.lock:
                        db = FaceDB()
                        result = delete_person(d.get("name", ""), db=db, access_log=ACCESS_LOG)
                        w.db = db
                    return self.send_json(result)
                if path == "/api/privacy/reset":
                    from .privacy import clear_local_data
                    if d.get("confirm") != "DELETE":
                        return self.send_json({"ok": False, "error": "削除の確認が必要です。"})
                    w.set_mode("idle")
                    with w.engine_lock, w.lock:
                        result = clear_local_data(access_log=ACCESS_LOG, settings_path=SETTINGS_PATH)
                        w.db = FaceDB()
                        w.settings = dict(DEFAULT_SETTINGS)
                    return self.send_json(result)
                if path == "/api/register/upload":
                    return self.send_json(self.upload_register(d))
                if path == "/api/settings":
                    s = dict(w.settings)
                    for k, v in d.items():
                        if k in DEFAULT_SETTINGS:
                            s[k] = type(DEFAULT_SETTINGS[k])(v)
                    s["threshold"] = float(np.clip(s["threshold"], 0.05, 0.95))
                    s["confirm_frames"] = int(np.clip(s["confirm_frames"], 2, 60))
                    s["show_sec"] = float(np.clip(s["show_sec"], 0, 15))
                    w.settings = s
                    save_settings(s)
                    if w.mode != "idle":
                        w.set_mode(w.mode, name=(w.reg or {}).get("name", ""))
                    return self.send_json({"ok": True, "settings": s})
                if path == "/api/selfreport":
                    return self.send_json({"ok": True, "msg": w.self_report(int(d.get("index", 0)))})
                if path == "/api/challenge":
                    return self.send_json({"ok": w.start_challenge()})
                if path == "/api/download":
                    w.start_download()
                    return self.send_json({"ok": True})
                if path == "/api/camtest":
                    w.start_camtest()
                    return self.send_json({"ok": True})
                if path == "/api/report":
                    return self.send_json(self.make_report())
                if path == "/api/evaluate":
                    return self.send_json(self.evaluate(d.get("path", "")))
                if path == "/api/open":
                    target = {"data": config.DATA_DIR, "reports": config.REPORT_DIR,
                              "logs": config.LOG_DIR, "root": config.ROOT}.get(d.get("what"), config.ROOT)
                    target.mkdir(parents=True, exist_ok=True)
                    open_path(target)
                    return self.send_json({"ok": True})
                if path == "/api/bye":
                    app.bye_at = time.time()
                    return self.send_json({"ok": True})
            except Exception as e:
                traceback.print_exc()
                return self.send_json({"ok": False, "error": str(e)})
            self.send_error(404)

        def upload_register(self, d):
            from .enroll import features_from_image
            name = (d.get("name") or "").strip()
            if not name or not d.get("consent"):
                return {"ok": False, "error": "名前と本人の同意が必要です"}
            if w.engine is None:
                return {"ok": False, "error": "先にモデルの準備をしてください"}
            feats, results = [], []
            for item in d.get("images", []):
                fname = item.get("name", "image")
                try:
                    raw = base64.b64decode(item["data"].split(",", 1)[-1])
                    img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
                    if img is None:
                        results.append({"file": fname, "ok": False, "msg": "画像を読み込めません"})
                        continue
                    if max(img.shape[:2]) > 1600:
                        s = 1600 / max(img.shape[:2])
                        img = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
                    with w.engine_lock:
                        f, q, why = features_from_image(w.engine, img, config.REGISTER_MIN_QUALITY)
                    feats += f
                    results.append({"file": fname, "ok": bool(f),
                                    "msg": f"撮影条件 {q.score}点" if f else why})
                except Exception as e:
                    results.append({"file": fname, "ok": False, "msg": str(e)})
            if feats:
                db = FaceDB()
                db.add(name, feats, source="upload")
                db.save()
                w.db = db
            return {"ok": bool(feats), "results": results,
                    "saved": sum(1 for r in results if r["ok"])}

        def make_report(self):
            from .report import build
            logs = sorted(config.LOG_DIR.glob("session_*.csv"), key=lambda p: p.stat().st_mtime) \
                if config.LOG_DIR.exists() else []
            logs = [p for p in logs if p.stat().st_size > 400]
            if not logs:
                return {"ok": False, "error": "分析モードの記録がまだありません"}
            if w.session is not None and w.session.path == logs[-1]:
                w.session.f.flush()
            out = build([logs[-1]])
            return {"ok": True, "url": "/reports/" + out.name}

        def evaluate(self, path):
            from .evaluate import run_evaluation
            p = Path(path or (config.DATA_DIR / "test"))
            if not p.exists():
                return {"ok": False, "error": f"フォルダが見つかりません: {p}"}
            if w.engine is None:
                return {"ok": False, "error": "先にモデルの準備をしてください"}
            with w.engine_lock:
                res = run_evaluation(w.engine, p, threshold=float(w.settings["threshold"]))
            return {"ok": True, "text": res["txt"].read_text(encoding="utf-8"),
                    "image": "/reports/" + res["png"].name,
                    "balanced": res["balanced"], "safe": res["safe"]}

    return H


def open_path(p):
    p = str(p)
    if sys.platform == "win32":
        os.startfile(p)  # noqa: S606
    elif sys.platform == "darwin":
        subprocess.Popen(["open", p])
    else:
        subprocess.Popen(["xdg-open", p])


def find_browser():
    cands = []
    if sys.platform == "win32":
        for base in (os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"),
                     os.environ.get("LOCALAPPDATA")):
            if base:
                cands += [Path(base) / "Microsoft/Edge/Application/msedge.exe",
                          Path(base) / "Google/Chrome/Application/chrome.exe"]
    for c in cands:
        if c.exists():
            return str(c)
    for n in ("msedge", "google-chrome", "chromium", "chromium-browser"):
        p = shutil.which(n)
        if p:
            return p
    return None


def open_window(url):
    """専用ウィンドウ(アドレスバーのないアプリ画面)で開く。"""
    b = find_browser()
    if b:
        prof = config.DATA_DIR / "window_profile"
        prof.mkdir(parents=True, exist_ok=True)
        subprocess.Popen([b, f"--app={url}", "--window-size=1440,900",
                          f"--user-data-dir={prof}", "--no-first-run", "--no-default-browser-check"])
    else:
        webbrowser.open(url)


def already_running(port):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/ping", timeout=0.5) as r:
            return json.loads(r.read()).get("app") == "facegate"
    except Exception:
        return False


def serve(port=DEFAULT_PORT, open_ui=True, idle_exit=True):
    if already_running(port):                       # 二重起動なら画面だけ開く
        if open_ui:
            open_window(f"http://127.0.0.1:{port}/")
        return None
    app = App()
    httpd = None
    for p in [port] + list(range(port + 1, port + 20)):
        try:
            httpd = ThreadingHTTPServer(("127.0.0.1", p), make_handler(app))
            port = p
            break
        except OSError:
            continue
    if httpd is None:
        raise RuntimeError("アプリ用の通信ポートを確保できませんでした")
    httpd.daemon_threads = True
    url = f"http://127.0.0.1:{port}/"
    print(f"起動しました: {url}", flush=True)

    def watchdog():
        # 画面(ウィンドウ)が閉じられたらアプリも終了する
        while True:
            time.sleep(1)
            now = time.time()
            closed = app.bye_at is not None and now - app.bye_at > 4
            lost = app.had_client and now - app.last_seen > 180
            never = not app.had_client and now - app.last_seen > 120
            if idle_exit and (closed or lost or never):
                app.worker.running = False
                app.worker._release()
                httpd.shutdown()
                return

    threading.Thread(target=watchdog, daemon=True).start()
    if open_ui:
        open_window(url)
    try:
        httpd.serve_forever()
    finally:
        app.worker.running = False
        if app.worker.session is not None:
            app.worker.session.close()
        httpd.server_close()
    return app


def main():
    log_path = config.ROOT / "error_log.txt"
    try:
        serve()
    except Exception:
        log_path.write_text(traceback.format_exc(), encoding="utf-8")
        raise
