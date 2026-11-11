"""異なるモデルを同じファイル名に置いても受け入れない。"""
import hashlib

from face_app import config, downloader, modelio


def test_fixed_model_digest_checked_before_loading(tmp_path, monkeypatch):
    content = b"model content for integrity probe"
    path = tmp_path / "model.onnx"
    path.write_bytes(content)
    monkeypatch.setattr(config, "MODEL_DIR", tmp_path)
    monkeypatch.setattr(config, "MODELS", {"detector": {
        "file": path.name, "sha256": hashlib.sha256(content).hexdigest()}})
    monkeypatch.setattr(downloader, "SOURCES", {"detector": {"min_size": 1}})
    calls = []
    monkeypatch.setattr(modelio, "create_detector", lambda *args: calls.append(args))
    assert downloader.check_quick("detector")
    assert downloader.check_model("detector", path) is None
    assert len(calls) == 1
    path.write_bytes(b"changed" + content[7:])
    assert not downloader.check_quick("detector")
    assert "SHA256" in downloader.check_model("detector", path)
    assert len(calls) == 1
