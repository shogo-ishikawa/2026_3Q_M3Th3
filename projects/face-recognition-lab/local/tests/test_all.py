"""テスト: python -m pytest tests -q  (本物のモデルは不要)"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

import cv2
import numpy as np
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).parent))

from face_app import config  # noqa: E402
from mock_engine import PEOPLE, MockEngine, draw_face, make_image  # noqa: E402


@pytest.fixture()
def sandbox(tmp_path, monkeypatch):
    """保存先をすべて一時フォルダに切り替える。"""
    for attr, sub in [("DATA_DIR", "data"), ("LOG_DIR", "logs"), ("REPORT_DIR", "reports"),
                      ("SHOT_DIR", "shots")]:
        monkeypatch.setattr(config, attr, tmp_path / sub)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "data" / "face_db.npz")
    monkeypatch.setattr(config, "DB_META_PATH", tmp_path / "data" / "face_db.json")
    return tmp_path


def write(p: Path, img):
    p.parent.mkdir(parents=True, exist_ok=True)
    cv2.imencode(".png", img)[1].tofile(str(p))


# ------------------------------------------------------------------ 部品のテスト
def test_head_pose_and_quality():
    from face_app.quality import assess, head_pose
    lm = np.array([[100, 100], [160, 100], [130, 130], [110, 160], [150, 160]], np.float32)
    yaw, roll, pitch = head_pose(lm)
    assert abs(yaw) < 1e-6 and abs(roll) < 1e-6 and 0.4 < pitch < 0.6
    lm2 = lm.copy(); lm2[2, 0] = 150
    assert head_pose(lm2)[0] > 0.3                         # 鼻が右 → 右向き

    eng = MockEngine()
    good = make_image(PEOPLE["Aさん"])
    f = eng.detect(good)[0]
    qg = assess(good, f.box, f.landmarks)
    dark = (good * 0.2).astype(np.uint8)
    qd = assess(dark, f.box, f.landmarks)
    assert qg.score > qd.score
    assert any("暗" in a for a in qd.advice)


def test_registry_match_and_delete(sandbox):
    from face_app.registry import FaceDB, UNKNOWN
    db = FaceDB()
    a = np.eye(128, dtype=np.float32)[0]; b = np.eye(128, dtype=np.float32)[1]
    db.add("A", [a], "t"); db.add("B", [b], "t"); db.save()
    db2 = FaceDB()
    assert db2.names == ["A", "B"]
    assert db2.match(a, 0.5)[0] == "A"
    c = np.eye(128, dtype=np.float32)[2]
    assert db2.match(c, 0.5)[0] == UNKNOWN
    assert db2.delete("A") and "A" not in db2.names and "A" not in db2.meta


def test_tracker_vote_smooths_flicker():
    from face_app.engine import Face
    from face_app.tracker import Tracker
    tr = Tracker()
    lm = np.zeros((5, 2), np.float32)
    for i in range(12):
        (t, _), = tr.step([Face((100 + i, 100, 80, 80), lm, 0.9)])
        name = "B" if i == 5 else "A"                     # 1フレームだけ誤判定
        t.update(name, 0.6, np.eye(8, dtype=np.float32)[1])
    assert t.name == "A" and len(tr.tracks) == 1
    assert t.emotion_index == 1


def test_challenge_pass_and_timeout():
    import random
    from face_app.liveness import Challenge
    from face_app.quality import Quality

    class T:  # 追跡の代わり
        id = 1; name = "A"; raw_name = "A"; raw_emotion = None; quality = None

    clock = [0.0]
    ch = Challenge(1, "A", rng=random.Random(3), clock=lambda: clock[0])
    t = T()
    for _ in range(200):
        step = ch.steps[ch.index]
        yaw = {"right": 0.4, "left": -0.4}.get(step, 0.0)
        t.quality = Quality(90, 120, 40, 100, 120, yaw, 0, 0.5)
        t.raw_emotion = np.eye(8, dtype=np.float32)[1] if step == "smile" else np.eye(8, dtype=np.float32)[0]
        clock[0] += 0.05
        if ch.update(t) != "running":
            break
    assert ch.state == "passed", ch.message

    clock = [0.0]
    ch = Challenge(1, "A", rng=random.Random(1), clock=lambda: clock[0])
    t.quality = Quality(90, 120, 40, 100, 120, 0.0, 0, 0.5); t.raw_emotion = np.eye(8)[0]
    # 写真のように動かない → 時間切れ(1つ目の指示は正面ではないので満たせない)
    for _ in range(300):
        clock[0] += 0.1
        if ch.update(t) != "running":
            break
    assert ch.state == "failed" and "時間切れ" in ch.message


def test_count_errors_and_recommend():
    from face_app.evaluate import count_errors, recommend, sweep
    probes = [
        {"truth": "A", "detected": True, "scores": {"A": 0.7, "B": 0.1}},
        {"truth": "A", "detected": True, "scores": {"A": 0.35, "B": 0.1}},
        {"truth": "B", "detected": True, "scores": {"A": 0.2, "B": 0.6}},
        {"truth": "未登録", "detected": True, "scores": {"A": 0.3, "B": 0.1}},
    ]
    c = count_errors(probes, 0.25)
    assert c["未登録受入"] == 1 and c["本人拒否"] == 0
    c = count_errors(probes, 0.5)
    assert c["本人拒否"] == 1 and c["未登録受入"] == 0
    balanced, safe = recommend(sweep(probes))
    assert 0.3 <= balanced <= 0.35 and safe is not None and 0.3 <= safe <= 0.35


# ------------------------------------------------------------------ 全体の流れ(模擬エンジン)
def test_end_to_end(sandbox):
    from face_app import enroll
    from face_app.app import run
    from face_app.evaluate import run_evaluation
    from face_app.registry import FaceDB
    from face_app.report import build

    eng = MockEngine(seed=1)
    reg = sandbox / "register"; test = sandbox / "test"
    for name in ("Aさん", "Bさん"):
        for k, yaw in enumerate([0.0, 0.1, -0.1, 0.05]):
            write(reg / name / f"{k}.png", make_image(PEOPLE[name], yaw=yaw, bg=80 + k))
        write(reg / name / "dark.png", make_image(PEOPLE[name], value=40, bg=10))   # 品質で除外されるはず
        for k in range(5):
            write(test / name / f"t{k}.png", make_image(PEOPLE[name], yaw=0.03 * k, bg=100 + k))
    for k in range(5):
        write(test / "_unknown" / f"u{k}.png", make_image(PEOPLE["Cさん"], bg=70 + k))
    write(test / "_unknown" / "dup.png", cv2.imdecode(np.fromfile(str(reg / "Aさん" / "0.png"), np.uint8), 1))

    assert enroll.register_folder(eng, "Aさん", reg / "Aさん") == 4
    assert enroll.register_folder(eng, "Bさん", reg / "Bさん") == 4
    db = FaceDB()
    assert db.names == ["Aさん", "Bさん"] and db.labels.count("Aさん") == 8   # 鏡像込み

    res = run_evaluation(eng, test)
    assert res["counts"]["本人拒否"] == 0
    assert res["png"].exists() and res["csv"].exists()

    # 動画: Aさんが左右を向き、笑う。途中から未登録のCさんも映る
    vid = sandbox / "demo.avi"
    W, H = 640, 480
    vw = cv2.VideoWriter(str(vid), cv2.VideoWriter_fourcc(*"MJPG"), 20, (W, H))
    for i in range(160):
        img = np.full((H, W, 3), 90, np.uint8)
        yaw = 0.0
        if 20 <= i < 160:
            phase = (i - 20) // 12 % 4
            yaw = [0.45, 0.0, -0.45, 0.0][phase]
        emo = 1 if (i // 10) % 3 == 0 else 0
        draw_face(img, 200, 230, PEOPLE["Aさん"], emotion=emo, yaw=yaw, r=80)
        if i > 60:
            draw_face(img, 480, 230, PEOPLE["Cさん"], emotion=4, yaw=0.0, r=55)
        vw.write(img)
    vw.release()

    keys = {12: ord("c"), 25: ord("s"), 40: ord("2"), 70: ord("1"), 100: ord("s"), 120: ord("b")}
    states = {}

    def on_frame(n, st, tracker):
        ch = st.get("challenge")
        if ch is not None:
            states["challenge"] = ch.state
        return keys.get(n)

    log_path, canvas, _ = run(eng, source=str(vid), mirror=False, headless=True, on_frame=on_frame)
    assert log_path.exists() and canvas is not None
    cv2.imwrite(str(sandbox / "frame.png"), canvas)
    rows = log_path.read_text(encoding="utf-8-sig").splitlines()
    assert any("Aさん" in r for r in rows) and any("未登録" in r for r in rows)
    assert any("challenge_start" in r for r in rows)
    assert sum(1 for r in rows if ",happiness," in r and r.count("happiness") >= 1) > 0
    assert list((sandbox / "shots").glob("*.png"))

    out = build([log_path, log_path])
    html = out.read_text(encoding="utf-8")
    assert "答え合わせ" in html and "記録どうしの比較" in html and "data:image/png" in html
    # 確認用に成果物を残す
    keep = ROOT / "tests" / "_artifacts"
    keep.mkdir(exist_ok=True)
    shutil.copy(sandbox / "frame.png", keep / "frame.png")
    shutil.copy(sorted((sandbox / "shots").glob("*.png"))[0], keep / "shot_challenge.png")
    shutil.copy(out, keep / "report.html")
    shutil.copy(res["png"], keep / "eval.png")
    shutil.copy(res["txt"], keep / "eval.txt")
    shutil.copy(log_path, keep / "session.csv")


def test_auth_mode_greets_and_exits(sandbox):
    from face_app import enroll
    from face_app.app import run
    eng = MockEngine(seed=2)
    reg = sandbox / "register"
    for k in range(3):
        write(reg / "Aさん" / f"{k}.png", make_image(PEOPLE["Aさん"], bg=80 + k))
    enroll.register_folder(eng, "Aさん", reg / "Aさん")
    vid = sandbox / "auth.avi"
    vw = cv2.VideoWriter(str(vid), cv2.VideoWriter_fourcc(*"MJPG"), 20, (640, 480))
    for i in range(200):
        img = np.full((480, 640, 3), 90, np.uint8)
        if i < 20:   # 最初は未登録の人
            draw_face(img, 320, 240, PEOPLE["Cさん"], r=80)
        else:
            draw_face(img, 320, 240, PEOPLE["Aさん"], emotion=1, r=80)
        vw.write(img)
    vw.release()
    log_path, canvas, name = run(eng, source=str(vid), mirror=False, headless=True, auth=True)
    assert name == "Aさん"
    rows = log_path.read_text(encoding="utf-8-sig")
    assert "auth_success:Aさん" in rows
    n_frames = sum(1 for r in rows.splitlines()[1:] if ",Aさん," in r or ",判定中," in r or ",未登録," in r)
    assert n_frames < 80        # 動画の最後まで行かずに終わっている
    keep = ROOT / "tests" / "_artifacts"; keep.mkdir(exist_ok=True)
    cv2.imwrite(str(keep / "greeting.png"), canvas)


def test_webapp_api(sandbox, monkeypatch):
    """アプリ画面用のサーバー: 認証 → あいさつ用の結果 → アクセスログ、登録・削除・設定。"""
    import json
    import threading
    import time
    import urllib.request
    from face_app import enroll, webapp

    eng = MockEngine(seed=4)
    reg = sandbox / "register"
    for k in range(3):
        write(reg / "Aさん" / f"{k}.png", make_image(PEOPLE["Aさん"], bg=80 + k))
    enroll.register_folder(eng, "Aさん", reg / "Aさん")
    vid = sandbox / "web.avi"
    vw = cv2.VideoWriter(str(vid), cv2.VideoWriter_fourcc(*"MJPG"), 20, (640, 480))
    for i in range(60):
        img = np.full((480, 640, 3), 90, np.uint8)
        draw_face(img, 320, 240, PEOPLE["Aさん"], emotion=1, r=80)
        vw.write(img)
    vw.release()
    monkeypatch.setenv("FACEAPP_MOCK", "1")
    monkeypatch.setenv("FACEAPP_SOURCE", str(vid))
    monkeypatch.setattr(webapp, "SETTINGS_PATH", sandbox / "data" / "settings.json")
    monkeypatch.setattr(webapp, "ACCESS_LOG", sandbox / "data" / "access_log.csv")
    port = 8890
    th = threading.Thread(target=webapp.serve, kwargs={"port": port, "open_ui": False, "idle_exit": False}, daemon=True)
    th.start()
    base = f"http://127.0.0.1:{port}"

    def call(path, body=None):
        req = urllib.request.Request(base + path, data=None if body is None else json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())

    for _ in range(50):
        try:
            call("/api/ping"); break
        except Exception:
            time.sleep(0.1)
    assert "FACEGATE" in urllib.request.urlopen(base + "/").read().decode()
    assert call("/api/mode", {"mode": "auth"})["ok"]
    for _ in range(100):
        s = call("/api/state")
        if s["phase"] == "complete":
            break
        time.sleep(0.1)
    assert s["phase"] == "complete" and s["auth"]["result"]["name"] == "Aさん"
    assert call("/api/logs")["logs"][0]["result"] == "成功"
    assert call("/api/summary")["today"] == 1
    # 同意なしの登録は拒否される
    assert not call("/api/mode", {"mode": "register", "name": "X"})["ok"]
    r = call("/api/settings", {"threshold": 0.5, "location": "テスト室"})
    assert r["ok"] and r["settings"]["location"] == "テスト室"
    assert call("/api/users/delete", {"name": "Aさん"})["ok"]
    assert call("/api/users")["users"] == []
    assert call("/api/state")["mode"] == "idle"
    assert call("/api/logs")["logs"] == []
    call("/api/mode", {"mode": "idle"})


def test_downloader_recovers(sandbox, monkeypatch):
    """通信が止まる取得先・中身が違う取得先があっても、次の取得先で最後まで終わる。"""
    import threading
    import time
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    from face_app import downloader

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            if self.path == "/stall":                      # ヘッダーだけ送って止まる
                self.send_response(200); self.send_header("Content-Length", "5000000"); self.end_headers()
                self.wfile.write(b"x" * 1000); self.wfile.flush(); time.sleep(5); return
            if self.path == "/pointer":                    # Git LFS の案内ファイル
                body = b"version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 123\n"
            elif self.path == "/html":
                body = b"<!DOCTYPE html><html>blocked</html>"
            else:
                body = b"GOOD" + b"\0" * 300_000
            self.send_response(200); self.send_header("Content-Length", str(len(body))); self.end_headers()
            self.wfile.write(body)

    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    monkeypatch.setattr(config, "MODEL_DIR", sandbox / "models")
    monkeypatch.setattr(downloader, "LOG_PATH", sandbox / "download_log.txt")
    monkeypatch.setattr(downloader, "TIMEOUT", 1)
    monkeypatch.setattr(downloader, "RETRIES", 1)
    real_check = downloader.check_model
    monkeypatch.setattr(downloader, "check_model",
                        lambda k, p: None if p.exists() and p.read_bytes()[:4] == b"GOOD" else real_check(k, p) or "NG")
    monkeypatch.setattr(downloader, "SOURCES", {
        "detector": {"min_size": 1000, "urls": [base + "/stall", base + "/good"]},
        "recognizer": {"min_size": 1000, "urls": [base + "/pointer", base + "/good"]},
        "emotion": {"min_size": 1000, "urls": [base + "/html", base + "/good"]},
    })
    st = {}
    t0 = time.time()
    assert downloader.download_all(st)
    assert time.time() - t0 < 20 and st["progress"] == 1.0 and not st["active"]
    log = (sandbox / "download_log.txt").read_text(encoding="utf-8")
    assert "timed out" in log.lower() and "案内用" in log and "Webページ" in log
    assert all((config.MODEL_DIR / m["file"]).exists() for m in config.MODELS.values())

    # すべての取得先がだめなら、止まらずにエラーで終わる
    for m in config.MODELS.values():
        (config.MODEL_DIR / m["file"]).unlink()
    monkeypatch.setattr(downloader, "SOURCES", {k: {"min_size": 1000, "urls": [base + "/stall"]}
                                                 for k in ("detector", "recognizer", "emotion")})
    st = {}
    assert not downloader.download_all(st)
    assert st["error"] and not st["active"]

    # 手元のファイルの取り込み
    ok, msg = downloader.import_file("face_detection_yunet_2023mar.onnx", b"GOOD" + b"\0" * 2000)
    assert ok, msg
    ok, msg = downloader.import_file("something.onnx", b"GOOD")
    assert not ok and "モデルではありません" in msg
    srv.shutdown()


def test_modelio_non_ascii_path(tmp_path, monkeypatch):
    """日本語を含む場所のモデルは、英数字だけの場所へコピーして読めるようにする(古いOpenCV向けの予備策)。"""
    from face_app import modelio
    src_dir = tmp_path / "山田のフォルダ"
    src_dir.mkdir()
    src = src_dir / "model.onnx"
    src.write_bytes(b"x" * 1234)
    monkeypatch.setenv("PUBLIC", str(tmp_path / "public"))
    dst = modelio.ascii_copy(src)
    assert str(dst).isascii() and dst.read_bytes() == src.read_bytes()
    assert modelio.ascii_copy(dst) == dst                 # 英数字だけのパスはそのまま
    assert modelio.read_bytes(src).size == 1234           # 日本語のパスでも中身を読める
