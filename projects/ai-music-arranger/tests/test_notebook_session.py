"""標準フォームから呼ぶ処理を、ウィジェットを使わずに確認する。"""
from pathlib import Path
import base64
import io
import json
import re
import sys
import zipfile

import numpy as np
import pretty_midi
import pytest
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import notebook_session as session_module
from audio_input import AudioInputError
from music_core import Note, get_demo_info


@pytest.fixture
def session(tmp_path, monkeypatch):
    monkeypatch.setattr(session_module, "display", lambda *args: None)
    monkeypatch.setattr(session_module.NotebookSession, "_plot_notes", lambda *args: None)
    return session_module.NotebookSession(tmp_path)


def test_native_demo_manual_generation_exports_actual_audio_and_tempo(session):
    assert session.prepare_source()
    assert session.generate(auto_tempo=False, bpm=96, auto_key_scale=False,
                            root="D", scale="natural_minor", add_melody=False)
    config = session.state["config"]
    assert config.bpm == 96 and config.root == "D" and config.scale == "natural_minor"
    paths = session.state["artifacts"]
    audio, sr = sf.read(paths["mixed.wav"])
    assert sr == 22050 and len(audio) == 12 * 22050
    midi = pretty_midi.PrettyMIDI(str(paths["arrangement.mid"]))
    assert abs(midi.get_tempo_changes()[1][0] - 96) < .001
    with zipfile.ZipFile(paths["arrangement_results.zip"]) as zipped:
        assert set(zipped.namelist()) == {"mixed.wav", "accompaniment.wav", "arrangement.mid", "settings.json", "README.txt"}
        settings = json.loads(zipped.read("settings.json"))
        assert settings["version"] == "1.0.4"
        assert settings["source"]["kind"] == "デモ音源"
        assert "http" not in json.dumps(settings)


def test_automatic_values_override_manual_fields_and_extraction_is_cached(session, monkeypatch):
    calls = []
    monkeypatch.setattr(session_module, "extract_melody",
                        lambda audio, sr: calls.append(len(audio)) or [Note(69, 0, .5)])
    assert session.prepare_source()
    analysis = session.state["analysis"]
    assert session.generate(bpm=88, root="D", scale="natural_minor", beat_offset=2)
    config = session.state["config"]
    assert config.bpm == analysis["bpm"]
    assert config.root == analysis["key"]
    assert config.scale == analysis["scale"]
    assert config.beat_offset == analysis["beat_offset"]
    assert session.generate(chord_gain=.2)
    assert len(calls) == 1
    assert session.prepare_source()
    assert session.generate()
    assert len(calls) == 2


def test_failed_source_preserves_old_input_but_invalidates_results(session, monkeypatch):
    assert session.prepare_source()
    assert session.generate(add_melody=False)
    old_audio = session.state["audio"]
    old_revision = session.state["source_revision"]
    def fail(*args, **kwargs):
        raise AudioInputError("取得できませんでした。")
    monkeypatch.setattr(session_module, "download_youtube", fail)
    assert not session.prepare_source("YouTube", youtube_url="https://youtu.be/example1234")
    assert session.state["audio"] is old_audio
    assert session.state["source_revision"] == old_revision
    assert session.state["analysis"] is not None
    assert not session.state["artifacts"]
    assert not session.download()


def test_actual_pc_upload_uses_generic_source_and_resets_melody(session):
    buffer = io.BytesIO()
    samples = .2 * np.sin(2 * np.pi * 440 * np.arange(22050 * 4) / 22050)
    sf.write(buffer, samples, 22050, format="WAV")
    assert session.prepare_source("PCの音源", start=1, duration=3,
                                  uploaded={"private-singer-name.wav": buffer.getvalue()})
    assert session.state["source"] == dict(kind="PCの音源", start_seconds=1., duration_seconds=3.)
    assert session.state["melody_notes"] is None
    assert len(session.state["audio"]) == 3 * 22050


def test_invalid_settings_and_empty_upload_do_not_leave_saveable_results(session):
    assert not session.generate()
    assert session.prepare_source()
    assert session.generate(add_melody=False)
    assert not session.generate(auto_tempo=False, bpm=0, add_melody=False)
    assert not session.state["artifacts"]
    assert not session.prepare_source("PCの音源", uploaded={})
    assert session.state["audio"] is not None


def test_local_download_is_primitive_html_and_exact_file_bytes(session, monkeypatch):
    assert session.prepare_source()
    assert session.generate(add_melody=False)
    outputs = []
    monkeypatch.setattr(session_module, "display", outputs.append)
    assert session.download("MIDI")
    assert type(outputs[0]).__name__ == "HTML"
    match = re.search(r"base64,([^\"]+)", outputs[0].data)
    assert base64.b64decode(match.group(1)) == Path(session.state["artifacts"]["arrangement.mid"]).read_bytes()
    assert not session.download("unknown")


def test_pasted_url_uses_youtube_with_default_source(session, monkeypatch):
    calls = []
    def download(url, destination, start, duration):
        calls.append((url, start, duration))
        sf.write(destination, .2 * np.sin(2 * np.pi * 440 * np.arange(22050 * 3) / 22050), 22050)
        return destination
    def no_demo(*args, **kwargs):
        raise AssertionError("A pasted URL must reach YouTube, not a demo")
    monkeypatch.setattr(session_module, "download_youtube", download)
    monkeypatch.setattr(session_module, "make_demo", no_demo)
    url = "https://youtu.be/AbcDEF_12-3"
    assert session.prepare_source(youtube_url=url, start=5, duration=3)
    assert calls == [(url, 5, 3)]
    assert session.state["source"]["kind"] == "YouTube"


def test_auto_youtube_failure_never_falls_back_to_demo(session, monkeypatch):
    def fail(*args, **kwargs):
        raise AudioInputError("YouTubeが接続を受け付けませんでした。")
    monkeypatch.setattr(session_module, "download_youtube", fail)
    assert not session.prepare_source(youtube_url="https://youtu.be/AbcDEF_12-3")
    assert session.state["audio"] is None
    assert not session.state["artifacts"]


@pytest.mark.parametrize("name", ["オリジナル（ゆったり）", "きらきら星（冒頭）", "歓喜の歌（冒頭）"])
def test_selected_demo_sets_its_known_tempo_and_length(session, name):
    info = get_demo_info(name)
    assert session.prepare_source(demo_song=name)
    assert session.state["source"]["demo_song"] == name
    assert len(session.state["audio"]) == round(info["duration_seconds"] * 22050)
    assert session.state["analysis"]["bpm"] == info["bpm"]
    assert session.generate(add_melody=False)
    assert session.state["config"].bpm == info["bpm"]


def test_explicit_demo_with_url_explains_selection(session, capsys):
    assert session.prepare_source("デモ音源", youtube_url="https://youtu.be/AbcDEF_12-3")
    assert "「デモ音源」が選ばれています" in capsys.readouterr().out
    assert session.state["source"]["kind"] == "デモ音源"
