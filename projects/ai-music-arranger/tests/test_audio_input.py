"""URL検査・失敗時の保護・FFmpegの区間変換を確認します。"""

from pathlib import Path
import os
import subprocess
import sys
from types import SimpleNamespace
import wave

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import audio_input as audio


VIDEO_ID = "AbcDEF_12-3"


@pytest.mark.parametrize("url", [
    f"https://www.youtube.com/watch?v={VIDEO_ID}&list=anything&t=30",
    f"https://youtu.be/{VIDEO_ID}?si=anything",
    f"https://youtube.com/shorts/{VIDEO_ID}",
    f"https://m.youtube.com/live/{VIDEO_ID}",
    f"https://music.youtube.com/watch?v={VIDEO_ID}",
])
def test_normalises_supported_single_video_links(url):
    assert audio.normalise_youtube_url(url) == f"https://www.youtube.com/watch?v={VIDEO_ID}"


@pytest.mark.parametrize("url", [
    "", "--exec anything", f"http://youtube.com/watch?v={VIDEO_ID}",
    f"https://youtube.com.evil.test/watch?v={VIDEO_ID}",
    f"https://youtube.com@evil.test/watch?v={VIDEO_ID}",
    f"https://name:password@youtube.com/watch?v={VIDEO_ID}",
    f"https://youtube.com:444/watch?v={VIDEO_ID}",
    "https://youtube.com/playlist?list=example", "https://youtube.com/watch?v=short",
    f"https://youtube.com/watch?v={VIDEO_ID}&v=another1234",
    f"https://youtu.be/{VIDEO_ID}/more", None,
])
def test_rejects_invalid_or_misleading_links(url):
    with pytest.raises(audio.AudioInputError):
        audio.normalise_youtube_url(url)


@pytest.mark.parametrize("start,duration", [(-1, 3), (0, 2), (0, 61), (float("nan"), 3), (0, float("inf"))])
def test_rejects_invalid_sections_before_running_process(tmp_path, start, duration):
    with pytest.raises(audio.AudioInputError):
        audio.load_audio_file(tmp_path / "missing.wav", start, duration)


def _mock_runtime(monkeypatch):
    monkeypatch.setattr(audio, "find_js_runtime", lambda: ("node", "/bin/node"))
    monkeypatch.setattr(audio.shutil, "which", lambda executable: "/bin/" + executable)


def test_download_requests_section_and_validates_before_replace(tmp_path, monkeypatch):
    _mock_runtime(monkeypatch)
    commands = []

    def fake_run(command, **kwargs):
        commands.append((command, kwargs))
        if "yt_dlp" in command:
            output = Path(command[command.index("-o") + 1].replace("%(ext)s", "wav"))
            output.write_bytes(b"staged audio")
            return SimpleNamespace(returncode=0, stdout="", stderr="")
        return SimpleNamespace(returncode=0, stdout=np.full(22050 * 3, 0.1, dtype="<f4").tobytes(), stderr=b"")

    monkeypatch.setattr(audio, "_run_process", fake_run)
    target = tmp_path / "input.wav"
    assert audio.download_youtube(f"https://youtu.be/{VIDEO_ID}", target, 12.5, 3) == target
    cmd, options = commands[0]
    assert cmd[:3] == [sys.executable, "-m", "yt_dlp"]
    assert "--no-playlist" in cmd and "--ignore-config" in cmd
    assert cmd[cmd.index("--download-sections") + 1] == "*12.500000-15.500000"
    assert cmd[-2:] == ["--", f"https://www.youtube.com/watch?v={VIDEO_ID}"]
    assert "shell" not in options and options["timeout"] == 180
    data, sr = audio.sf.read(target)
    assert sr == 22050 and len(data) == 66150
    assert not list(tmp_path.glob("youtube-*"))


@pytest.mark.parametrize("failure", ["exit", "timeout", "invalid_audio"])
def test_failed_download_preserves_previous_file(tmp_path, monkeypatch, failure):
    _mock_runtime(monkeypatch)
    target = tmp_path / "input.wav"
    target.write_bytes(b"previous successful input")

    def fake_run(command, **kwargs):
        if failure == "timeout":
            raise subprocess.TimeoutExpired(command, 180)
        if failure == "invalid_audio" and "yt_dlp" in command:
            output = Path(command[command.index("-o") + 1].replace("%(ext)s", "wav"))
            output.write_bytes(b"not audio")
            return SimpleNamespace(returncode=0, stdout="", stderr="")
        return SimpleNamespace(returncode=1, stdout=b"", stderr=b"private network detail")

    monkeypatch.setattr(audio, "_run_process", fake_run)
    with pytest.raises(audio.AudioInputError) as error:
        audio.download_youtube(f"https://youtu.be/{VIDEO_ID}", target, duration=3)
    assert "private network detail" not in str(error.value)
    assert target.read_bytes() == b"previous successful input"
    assert not list(tmp_path.glob("youtube-*"))


@pytest.mark.parametrize("version,expected", [("v22.1.0", True), ("v20.19.0", False), ("v24.0.1", True)])
def test_node_version_requirement(monkeypatch, version, expected):
    monkeypatch.setattr(audio.shutil, "which", lambda name: "/bin/node" if name == "node" else None)
    monkeypatch.setattr(audio.subprocess, "run", lambda *a, **k: SimpleNamespace(returncode=0, stdout=version))
    assert (audio.find_js_runtime() is not None) is expected


def test_actual_ffmpeg_reads_only_requested_section_and_resamples(tmp_path):
    if not audio.shutil.which("ffmpeg"):
        pytest.skip("FFmpeg is not installed")
    sr = 44100
    t = np.arange(sr * 6) / sr
    samples = np.zeros(sr * 6)
    samples[sr * 2:] = 0.25 * np.sin(2 * np.pi * 440 * t[sr * 2:])
    source = tmp_path / "source.wav"
    with wave.open(str(source), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sr)
        wav.writeframes((samples * 32767).astype("<i2").tobytes())
    result = audio.load_audio_file(source, start=2, duration=3)
    assert len(result) == 22050 * 3
    assert np.isfinite(result).all()
    assert np.std(result) > 0.1
    tail = audio.load_audio_file(source, start=5, duration=3)
    assert 22049 <= len(tail) <= 22051
    with pytest.raises(audio.AudioInputError):
        audio.load_audio_file(source, start=60, duration=3)


def test_invalid_audio_has_actionable_error(tmp_path):
    if not audio.shutil.which("ffmpeg"):
        pytest.skip("FFmpeg is not installed")
    source = tmp_path / "broken.wav"
    source.write_text("not audio")
    with pytest.raises(audio.AudioInputError):
        audio.load_audio_file(source, duration=3)


@pytest.mark.parametrize("configured_ca", [False, True])
def test_custom_ca_is_respected_without_disabling_tls(tmp_path, monkeypatch, configured_ca):
    _mock_runtime(monkeypatch)
    if configured_ca:
        monkeypatch.setenv("SSL_CERT_FILE", "/configured/custom-ca.pem")
    else:
        monkeypatch.delenv("SSL_CERT_FILE", raising=False)
    calls = []

    def fake_run(command, **kwargs):
        calls.append(command)
        return SimpleNamespace(returncode=1, stdout="", stderr="")

    monkeypatch.setattr(audio, "_run_process", fake_run)
    with pytest.raises(audio.AudioInputError):
        audio.download_youtube(f"https://youtu.be/{VIDEO_ID}", tmp_path / "input.wav", duration=3)
    command = calls[0]
    assert ("no-certifi" in command) is configured_ca
    assert "--no-check-certificates" not in command
    if configured_ca:
        assert os.environ["SSL_CERT_FILE"] == "/configured/custom-ca.pem"


@pytest.mark.skipif(os.name != "posix", reason="Colab process group behaviour is POSIX-specific")
def test_timeout_stops_download_child_process_too(tmp_path):
    child_pid = tmp_path / "child.pid"
    script = (
        "import subprocess,sys,time; "
        "child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)']); "
        "open(sys.argv[1],'w').write(str(child.pid)); time.sleep(30)"
    )
    with pytest.raises(subprocess.TimeoutExpired):
        audio._run_process([sys.executable, "-c", script, str(child_pid)], timeout=1)
    pid = int(child_pid.read_text())
    # 終了済みの子がinitに回収されるまで、短時間ゾンビとして残る環境もあります。
    proc_stat = Path(f"/proc/{pid}/stat")
    if proc_stat.exists():
        assert proc_stat.read_text().split()[2] == "Z"
