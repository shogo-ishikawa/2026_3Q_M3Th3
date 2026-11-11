"""多数決に残った古い名前だけで照合成功としない。"""
from types import SimpleNamespace

import numpy as np

from face_app import config, render
from face_app.registry import FaceDB
from face_app.tracker import Track, current_identity
from face_app.webapp import DEFAULT_SETTINGS, Worker


def stale_track():
    track = Track(1, (10, 10, 100, 100))
    for _ in range(14):
        track.update("A", 0.9, None)
    track.update("未登録", 0.1, None)
    assert track.name == "A"
    return track


def test_current_frame_overrides_stale_vote_and_nonfinite_similarity():
    track = stale_track()
    assert current_identity(track, 0.70) == "未登録"
    track.raw_name, track.raw_sim = "A", float("nan")
    assert current_identity(track, 0.70) == "未登録"
    track.raw_sim, track.missed = 0.9, 1
    assert current_identity(track, 0.70) == "未登録"


def test_auth_streak_restarts_after_current_frame_fails(tmp_path, monkeypatch):
    from face_app import webapp
    monkeypatch.setattr(webapp, "ACCESS_LOG", tmp_path / "access.csv")
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "db.npz")
    monkeypatch.setattr(config, "DB_META_PATH", tmp_path / "db.json")
    worker = Worker.__new__(Worker)
    worker._reset_mode_state()
    worker.settings = dict(DEFAULT_SETTINGS, threshold=0.70, confirm_frames=5, show_sec=0)
    worker.db = FaceDB()
    worker.auth_start, worker.auth_track = 1.0, 1
    worker.last_name, worker.streak = "A", 4
    track = stale_track()
    worker.auth_step(track)
    assert worker.phase != "complete" and worker.result is None and worker.streak == 0
    for expected in range(1, 5):
        track.update("A", 0.9, None)
        worker.auth_step(track)
        assert worker.streak == expected and worker.phase != "complete"
    track.update("A", 0.9, None)
    worker.auth_step(track)
    assert worker.phase == "complete" and worker.result["name"] == "A"


def test_privacy_blurs_current_unknown_face_even_with_old_known_vote():
    track = stale_track()
    image = np.random.default_rng(7).integers(0, 256, (130, 130, 3), dtype=np.uint8)
    original = image.copy()
    text = SimpleNamespace(add=lambda *args, **kwargs: None)
    render.draw_faces(image, [track], text, privacy=True, threshold=0.70)
    assert not np.array_equal(image[30:90, 30:90], original[30:90, 30:90])
