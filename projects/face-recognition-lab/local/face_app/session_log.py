"""結果の記録(CSV)。1フレーム×1人を1行として保存し、あとでレポートや比較に使う。"""
from __future__ import annotations

import csv
import time
from datetime import datetime

from . import config

FIELDS = (["time", "elapsed", "frame", "track_id", "raw_name", "raw_similarity",
           "best_candidate", "name", "similarity", "threshold", "emotion", "emotion_raw"]
          + [f"p_{e}" for e in config.EMOTIONS_EN]
          + ["quality", "brightness", "sharpness", "face_size", "yaw", "roll",
             "self_report", "event"])


class SessionLog:
    def __init__(self, path=None):
        config.LOG_DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.path = path or config.LOG_DIR / f"session_{stamp}.csv"
        self.f = open(self.path, "w", newline="", encoding="utf-8-sig")
        self.w = csv.DictWriter(self.f, fieldnames=FIELDS)
        self.w.writeheader()
        self.t0 = time.time()

    def row(self, frame, track, best, threshold, self_report="", event=""):
        q = track.quality
        p = track.raw_emotion
        r = {
            "time": datetime.now().isoformat(timespec="milliseconds"),
            "elapsed": round(time.time() - self.t0, 3),
            "frame": frame, "track_id": track.id,
            "raw_name": track.raw_name, "raw_similarity": round(track.raw_sim, 4),
            "best_candidate": best or "", "name": track.name,
            "similarity": round(track.sim, 4), "threshold": threshold,
            "emotion": config.EMOTIONS_EN[track.emotion_index] if track.emotion is not None else "",
            "emotion_raw": config.EMOTIONS_EN[int(p.argmax())] if p is not None else "",
            "self_report": self_report, "event": event,
        }
        for i, e in enumerate(config.EMOTIONS_EN):
            r[f"p_{e}"] = round(float(p[i]), 4) if p is not None else ""
        if q:
            r.update(quality=q.score, brightness=round(q.brightness, 1),
                     sharpness=round(q.sharpness, 1), face_size=q.face_size,
                     yaw=round(q.yaw, 3), roll=round(q.roll, 1))
        self.w.writerow(r)

    def event(self, frame, text):
        r = {k: "" for k in FIELDS}
        r.update(time=datetime.now().isoformat(timespec="milliseconds"),
                 elapsed=round(time.time() - self.t0, 3), frame=frame, event=text)
        self.w.writerow(r)

    def close(self):
        self.f.close()
