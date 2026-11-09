"""画面をまたぐ状態管理と、実際の保存ファイルを確認する。"""
from pathlib import Path
import ast
import json
import sys
import zipfile

import nbformat
import numpy as np
import pretty_midi
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import colab_app
import setup_environment
from audio_input import AudioInputError
from music_core import Note


def prepare_app(tmp_path, monkeypatch):
    # 音を鳴らすブラウザ表示は別途確認し、ここでは状態と生成ファイルを調べる。
    monkeypatch.setattr(colab_app, "display", lambda *args, **kwargs: None)
    monkeypatch.setattr(colab_app.MusicArrangerApp, "_plot_notes", lambda *args: None)
    app = colab_app.MusicArrangerApp(tmp_path)
    app._on_demo()
    app._on_analyse()
    assert app.state["analysis"] is not None
    return app


def test_real_demo_exports_have_full_audio_and_midi_tempo(tmp_path, monkeypatch):
    app = prepare_app(tmp_path, monkeypatch)
    app.controls["add_melody"].value = False
    app.controls["bpm"].value = 96
    app._on_generate()
    assert app.state["result"] is not None
    paths = app.state["artifacts"]
    for name in ["mixed.wav", "accompaniment.wav"]:
        audio, sr = sf.read(paths[name])
        assert sr == 22050 and len(audio) == len(app.state["audio"])
        assert np.isfinite(audio).all()
    midi = pretty_midi.PrettyMIDI(str(paths["arrangement.mid"]))
    assert abs(midi.get_tempo_changes()[1][0] - 96) < .001
    with zipfile.ZipFile(paths["arrangement_results.zip"]) as zipped:
        assert set(zipped.namelist()) == {"mixed.wav", "accompaniment.wav", "arrangement.mid", "settings.json", "README.txt"}
        settings = json.loads(zipped.read("settings.json"))
        assert settings["source"]["kind"] == "デモ"
        assert settings["arrangement"]["bpm"] == 96
        assert not any(x in json.dumps(settings) for x in ["http", "input_song", "uploaded"])


def test_settings_changes_invalidate_files_and_melody_cache_is_per_source(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(colab_app, "extract_melody", lambda y, sr: calls.append(len(y)) or [Note(69, 0, .4)])
    app = prepare_app(tmp_path, monkeypatch)
    app._on_generate()
    before = app.state["result"]["mixed"].copy()
    app.controls["chord_gain"].value = .1
    assert app.state["result"] is None and not app.state["artifacts"]
    assert app.controls["download_zip"].disabled
    app._on_generate()
    assert len(calls) == 1
    assert not np.array_equal(before, app.state["result"]["mixed"])
    app._on_demo()
    assert app.state["analysis"] is None and app.state["melody_notes"] is None
    app._on_analyse()
    app._on_generate()
    assert len(calls) == 2


def test_failed_input_preserves_source_but_clears_old_exports(tmp_path, monkeypatch):
    app = prepare_app(tmp_path, monkeypatch)
    app.controls["add_melody"].value = False
    app._on_generate()
    original = app.state["audio"]
    revision = app.state["source_revision"]
    def fail(*args, **kwargs):
        raise AudioInputError("取得できませんでした。")
    monkeypatch.setattr(colab_app, "download_youtube", fail)
    app._on_youtube()
    assert app.state["audio"] is original
    assert app.state["source_revision"] == revision
    assert not app.state["artifacts"] and app.controls["download_zip"].disabled
    assert "現在の音源はそのまま" in app.status.value


def test_notebook_is_valid_self_contained_and_unexecuted():
    project = Path(__file__).resolve().parents[1]
    notebook = nbformat.read(project / "ai_music_arranger.ipynb", as_version=4)
    nbformat.validate(notebook)
    sources = [cell.source for cell in notebook.cells if cell.cell_type == "code"]
    assert len(sources) == 7
    assert sources[0].split("\n", 1)[1] == (project / "setup_environment.py").read_text()
    for filename, source in zip(["audio_input.py", "music_core.py", "notebook_session.py"], sources[1:4]):
        tree = ast.parse(source)
        embedded = next(ast.literal_eval(node.value) for node in tree.body
                        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "module_code" for t in node.targets))
        assert embedded == (project / filename).read_text()
        assert "%%writefile" not in source
    for cell in notebook.cells:
        if cell.cell_type == "code":
            assert not cell.outputs and cell.execution_count is None
            assert cell.source.startswith("#@title ")
            assert 'display-mode: "form"' in cell.source.splitlines()[0]
            assert cell.metadata["cellView"] == "form"
            assert not cell.metadata.get("collapsed", False)
            ast.parse(cell.source)
    assert "widgets" not in notebook.metadata
    source_form = next(cell.source for cell in notebook.cells if cell.id == "prepare-source")
    assert 'input_source = "デモ音源" #@param ["デモ音源", "YouTube", "PCの音源"]' in source_form
    assert 'youtube_url = "" #@param {type:"string"}' in source_form
    assert "colab_app.launch_app" not in "\n".join(sources)


def test_setup_rerun_stays_in_same_directory_and_updates_youtube(tmp_path, monkeypatch):
    commands = []
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(setup_environment.subprocess, "run", lambda command, **kw: commands.append(command))
    monkeypatch.setattr(setup_environment.shutil, "which", lambda name: "/usr/bin/ffmpeg" if name == "ffmpeg" else None)
    monkeypatch.setattr(setup_environment, "supported_js_runtime", lambda: "node")
    setup_environment.setup_environment()
    first = Path.cwd()
    setup_environment.setup_environment()
    assert Path.cwd() == first
    assert not (first / ".ai_music_arranger_runtime").exists()
    updates = [c for c in commands if "yt-dlp[default]" in c]
    assert len(updates) == 2 and all("--upgrade" in c for c in updates)
