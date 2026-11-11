"""保存データ削除とlocalhost APIの回帰試験。本物の顔やカメラは使わない。"""
from __future__ import annotations

import csv
import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from face_app import config
from face_app.privacy import clear_local_data, delete_person
from face_app.registry import FaceDB


@pytest.fixture()
def stored(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "ROOT", tmp_path)
    for attr, sub in [("DATA_DIR", "data"), ("LOG_DIR", "logs"),
                      ("REPORT_DIR", "reports"), ("SHOT_DIR", "screenshots")]:
        path = tmp_path / sub
        path.mkdir()
        monkeypatch.setattr(config, attr, path)
    monkeypatch.setattr(config, "DB_PATH", config.DATA_DIR / "face_db.npz")
    monkeypatch.setattr(config, "DB_META_PATH", config.DATA_DIR / "face_db.json")
    db = FaceDB()
    db.add("A", [np.eye(128, dtype=np.float32)[0]], "test")
    db.add("AA", [np.eye(128, dtype=np.float32)[1]], "test")
    db.save()
    return db


def put_csv(path, fields, rows):
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def read_csv(path):
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def test_delete_person_removes_all_identity_columns_without_partial_name_match(stored):
    access = config.DATA_DIR / "access_log.csv"
    put_csv(access, ["name", "result"], [{"name": "A", "result": "成功"}, {"name": "AA", "result": "成功"}])
    session = config.LOG_DIR / "session_test.csv"
    fields = ["name", "raw_name", "best_candidate", "event"]
    put_csv(session, fields, [
        {"name": "A"}, {"name": "未登録", "raw_name": "A"},
        {"name": "未登録", "best_candidate": "A"},
        {"event": "challenge_passed:old free text A"},
        {"name": "AA", "raw_name": "AA", "best_candidate": "AA"},
    ])
    (config.REPORT_DIR / "mixed.html").write_text("A and AA")
    (config.SHOT_DIR / "mixed.png").write_bytes(b"screen")
    original = config.DATA_DIR / "test" / "A"
    original.mkdir(parents=True)
    (original / "input.png").write_bytes(b"original input")
    result = delete_person("A", db=stored)
    assert result == {"ok": True, "rows_removed": 5, "reports_removed": 1, "screenshots_removed": 1}
    assert FaceDB().names == ["AA"]
    assert read_csv(access) == [{"name": "AA", "result": "成功"}]
    assert read_csv(session) == [{"name": "AA", "raw_name": "AA", "best_candidate": "AA", "event": ""}]
    assert not list(config.REPORT_DIR.iterdir()) and not list(config.SHOT_DIR.iterdir())
    assert (original / "input.png").read_bytes() == b"original input"


def test_unknown_person_does_not_delete_any_generated_data(stored):
    report = config.REPORT_DIR / "existing.html"
    report.write_text("existing")
    assert not delete_person("missing", db=stored)["ok"]
    assert report.read_text() == "existing" and FaceDB().names == ["A", "AA"]


def test_clear_local_data_preserves_models_and_input_photos(stored):
    (config.DATA_DIR / "settings.json").write_text("{}")
    (config.DATA_DIR / "access_log.csv").write_text("name\nA\n")
    (config.LOG_DIR / "session_x.csv").write_text("name\nA\n")
    (config.REPORT_DIR / "plot.png").write_bytes(b"report")
    (config.SHOT_DIR / "screen.png").write_bytes(b"screen")
    model = config.ROOT / "models" / "model.onnx"
    model.parent.mkdir()
    model.write_bytes(b"model")
    photo = config.DATA_DIR / "register" / "A.png"
    photo.parent.mkdir()
    photo.write_bytes(b"input")
    assert clear_local_data()["ok"]
    assert FaceDB().names == []
    assert not (config.DATA_DIR / "settings.json").exists()
    assert not (config.DATA_DIR / "access_log.csv").exists()
    assert not list(config.LOG_DIR.iterdir())
    assert not list(config.REPORT_DIR.iterdir()) and not list(config.SHOT_DIR.iterdir())
    assert model.read_bytes() == b"model" and photo.read_bytes() == b"input"


def test_generated_symlink_never_deletes_the_external_target(stored, tmp_path):
    external = tmp_path / "outside.txt"
    external.write_text("keep")
    (config.REPORT_DIR / "link.txt").symlink_to(external)
    delete_person("A", db=stored)
    assert external.read_text() == "keep" and not (config.REPORT_DIR / "link.txt").exists()


def test_storage_directory_symlink_stops_before_changing_database(stored, tmp_path, monkeypatch):
    outside = tmp_path / "outside"
    outside.mkdir()
    log = outside / "session_outside.csv"
    log.write_text("name\nA\n")
    link = tmp_path / "linked-logs"
    link.symlink_to(outside, target_is_directory=True)
    monkeypatch.setattr(config, "LOG_DIR", link)
    with pytest.raises(ValueError, match="リンク"):
        delete_person("A", db=stored)
    with pytest.raises(ValueError, match="リンク"):
        clear_local_data()
    assert log.read_text() == "name\nA\n" and FaceDB().names == ["A", "AA"]


def test_local_api_rejects_other_origins_and_rebound_host(stored):
    from face_app.webapp import make_handler
    app = SimpleNamespace(worker=SimpleNamespace())
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(app))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        with urllib.request.urlopen(url + "/api/ping", timeout=5) as response:
            assert json.load(response)["app"] == "facegate"
        for headers in [{"Origin": "https://another.example"}, {"Origin": "null"}, {"Host": "rebound.example"}]:
            with pytest.raises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(urllib.request.Request(url + "/api/ping", headers=headers), timeout=5)
            assert error.value.code == 403
        request = urllib.request.Request(url + "/api/privacy/reset", data=b'{}',
                                         headers={"Origin": url, "Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=5) as response:
            assert not json.load(response)["ok"]
        assert FaceDB().names == ["A", "AA"]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
