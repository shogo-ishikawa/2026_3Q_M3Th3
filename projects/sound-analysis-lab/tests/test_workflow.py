import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import zipfile

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sound_core import AudioData, make_demo, write_audio
import sound_workflow as workflow


class SessionTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.lab = workflow.StudySession(self.folder.name)

    def tearDown(self):
        self.folder.cleanup()

    def prepare_short_band(self):
        self.lab.prepare(range_mode="区間を指定", start=0.1, end=0.5)
        self.lab.separate()

    def test_known_demos_do_not_download_a_model(self):
        with patch.object(workflow, "separate_demucs", side_effect=AssertionError("不要なモデル取得")):
            for demo, expected in (("tone", 0), ("harmonics", 0), ("band", 4)):
                self.lab.prepare(demo_name=demo, range_mode="区間を指定", start=0.1, end=0.3)
                self.assertEqual(len(self.lab.separate()), expected)
                for audio in self.lab.stems.values():
                    self.assertEqual(audio.data.shape, self.lab.source.data.shape)

    def test_entire_range_ignores_old_start_end(self):
        whole = self.lab.prepare(range_mode="全体", start=1000, end=-1)
        self.assertEqual(whole.duration, 8)
        last = self.lab.prepare(range_mode="区間を指定", start=7, end=0)
        self.assertEqual(last.duration, 1)
        with self.assertRaises(ValueError):
            self.lab.prepare(range_mode="区間を指定", start=2, end=1)
        self.assertIsNone(self.lab.source)
        self.assertIsNone(self.lab.analysis)
        with self.assertRaises(RuntimeError):
            self.lab.export_zip()

    def test_file_selected_before_reading_and_metadata_is_private(self):
        audio, _ = make_demo("tone", duration=2, sr=8000)
        source = write_audio(audio, Path(self.folder.name) / "private-person-name.wav")
        selected = self.lab.prepare(source_mode="PCの音声ファイル", path=source,
                                    range_mode="区間を指定", start=0.5, end=1)
        self.assertEqual(selected.data.shape, (4000, 1))
        self.assertNotIn("private", json.dumps(self.lab.input_info))
        self.lab.separate(mode="分離しない")
        with patch.object(workflow, "plot_analysis", return_value=[]):
            self.lab.analyse(n_fft=512, hop=128)
        archive = zipfile.ZipFile(io.BytesIO(self.lab.export_zip()))
        self.assertFalse(any(name.endswith(".wav") for name in archive.namelist()))
        self.assertNotIn("private", archive.read("settings.json").decode())
        self.assertEqual(json.loads(archive.read("settings.json"))["input"]["start_seconds"], 0.5)

    def test_successful_analysis_and_processing_export_and_failure_clears_state(self):
        self.prepare_short_band()
        with patch.object(workflow, "plot_analysis", return_value=[]):
            analysis = self.lab.analyse(n_fft=512, hop=128, silence_db=-40)
            processed = self.lab.process(target="bass", mode="lowpass", cutoff=1000)
            self.assertEqual(processed["settings"]["reference_peak"], analysis["settings"]["reference_peak"])
            data = self.lab.export_zip(include_audio=True)
            archive = zipfile.ZipFile(io.BytesIO(data))
            self.assertIn("analysis/frames_bass.csv", archive.namelist())
            self.assertIn("processing/processed.wav", archive.namelist())
            exported, sr = sf.read(io.BytesIO(archive.read("analysis/bass.wav")), always_2d=True)
            np.testing.assert_allclose(exported, analysis["tracks"]["bass"].data, atol=1e-7)
            settings = json.loads(archive.read("settings.json"))
            self.assertEqual(settings["analysis"]["n_fft"], 512)
            self.assertEqual(settings["processing"]["target"], "bass")
            with self.assertRaises(ValueError):
                self.lab.process(mode="lowpass", cutoff=1e9)
            self.assertIsNone(self.lab.processing)
            self.assertNotIn("processing/summary.csv", zipfile.ZipFile(io.BytesIO(self.lab.export_zip())).namelist())
            with self.assertRaises(ValueError):
                self.lab.analyse(n_fft=8)
            self.assertIsNone(self.lab.analysis)
            with self.assertRaises(RuntimeError):
                self.lab.export_zip()

    def test_separation_and_youtube_failures_cannot_reuse_an_old_track(self):
        self.prepare_short_band()
        with patch.object(workflow, "separate_demucs", side_effect=RuntimeError("分離失敗")):
            with self.assertRaises(RuntimeError):
                self.lab.separate(mode="Demucsで4パート分離")
        self.assertEqual(self.lab.stems, {})
        self.assertIsNone(self.lab.separation_info)
        with patch.object(workflow, "fetch_youtube", side_effect=RuntimeError("取得失敗")):
            with self.assertRaises(RuntimeError):
                self.lab.prepare(source_mode="YouTube URL", youtube_url="https://youtu.be/example")
        self.assertIsNone(self.lab.source)
        self.assertEqual(self.lab.stems, {})
        self.assertIsNone(self.lab.analysis)

    def test_youtube_validation_and_fresh_folders(self):
        for url in ("file:///etc/passwd", "http://youtu.be/x", "https://youtu.be.example.org/x", "https://x:y@youtube.com/watch?v=x"):
            with self.assertRaises(ValueError):
                workflow.validate_youtube_url(url)
        outputs = []
        def fake_run(command, **kwargs):
            pattern = command[command.index("-o") + 1]
            path = Path(pattern.replace("%(ext)s", "wav"))
            path.write_bytes(b"audio")
            outputs.append(path)
        with patch.object(workflow.shutil, "which", return_value="/usr/bin/ffmpeg"), patch.object(workflow.importlib.util, "find_spec", return_value=True), patch.object(workflow, "_run", side_effect=fake_run):
            for _ in range(2):
                workflow.fetch_youtube("https://youtu.be/example", self.folder.name)
        self.assertNotEqual(outputs[0].parent, outputs[1].parent)
        with patch.object(workflow.shutil, "which", return_value="/usr/bin/ffmpeg"), patch.object(workflow.importlib.util, "find_spec", return_value=True), patch.object(workflow, "_run", side_effect=subprocess.CalledProcessError(1, "yt-dlp")):
            with self.assertRaisesRegex(RuntimeError, "取得できません"):
                workflow.fetch_youtube("https://youtu.be/example", self.folder.name)

    def test_large_decoded_audio_is_rejected_before_soundfile_read(self):
        path = Path(self.folder.name) / "compressed.flac"
        path.write_bytes(b"compressed")
        info = types.SimpleNamespace(duration=60, samplerate=768000, channels=8)
        with patch.object(sf, "info", return_value=info), patch.object(sf, "read", side_effect=AssertionError("巨大な読込")):
            with self.assertRaisesRegex(ValueError, "区間を短く"):
                self.lab.prepare(source_mode="PCの音声ファイル", path=path)
        self.assertIsNone(self.lab.source)

    def test_large_ffmpeg_input_is_rejected_after_probe_before_decode(self):
        path = Path(self.folder.name) / "compressed.audio"
        path.write_bytes(b"compressed")
        probe = types.SimpleNamespace(stdout=json.dumps({"format": {"duration": "60"},
                    "streams": [{"sample_rate": "384000", "channels": 8}]}))
        with patch.object(sf, "info", side_effect=RuntimeError("unsupported")), patch.object(workflow.shutil, "which", return_value="ffmpeg"), patch.object(workflow, "_run", return_value=probe) as run:
            with self.assertRaisesRegex(ValueError, "区間を短く"):
                self.lab.prepare(source_mode="PCの音声ファイル", path=path)
            self.assertEqual(run.call_count, 1)
            self.assertEqual(run.call_args.args[0][0], "ffprobe")
        self.assertIsNone(self.lab.source)

    def test_duration_limit_and_common_playback_gain(self):
        with self.assertRaises(ValueError):
            workflow._selected_bounds(1201, "全体", 0, 0)
        self.assertEqual(workflow._selected_bounds(3600, "区間を指定", 100, 200), (100, 200))
        original = AudioData(np.array([2., -2.]), 8000)
        quiet = AudioData(np.array([0.2, -0.2]), 8000)
        gain = workflow.common_playback_gain([original, quiet])
        self.assertEqual(gain, 0.45)
        self.assertAlmostEqual(float(quiet.data.max() * gain / (original.data.max() * gain)), 0.1)


class FakeTensor:
    def __init__(self, values): self.values = np.asarray(values)
    def __getitem__(self, key): return FakeTensor(self.values[key])
    def detach(self): return self
    def cpu(self): return self
    def numpy(self): return self.values


class FakeContext:
    def __enter__(self): return self
    def __exit__(self, *args): return False


class ModelTests(unittest.TestCase):
    def test_cpu_fallback_alignment_and_shared_gain_without_model_download(self):
        original, _ = make_demo("tone", duration=0.1, sr=8000)
        class Model:
            samplerate = 44100
            audio_channels = 2
            sources = ["drums", "bass", "other", "vocals"]
            def eval(self): pass
        fake_torch = types.SimpleNamespace(Tensor=FakeTensor, cuda=types.SimpleNamespace(is_available=lambda: False),
                                           from_numpy=FakeTensor, no_grad=FakeContext)
        used = {}
        def apply(model, tensor, **kwargs):
            used.update(kwargs)
            return FakeTensor(np.stack([tensor.values * weight for weight in (0.1, 0.2, 0.3, 0.4)], axis=1))
        modules = {"torch": fake_torch,
                   "demucs.pretrained": types.SimpleNamespace(get_model=lambda name: Model()),
                   "demucs.apply": types.SimpleNamespace(apply_model=apply)}
        with patch.dict(sys.modules, modules), patch.object(workflow.importlib.util, "find_spec", return_value=True):
            aligned, stems, info = workflow.separate_demucs(original, install=False)
            self.assertEqual(info["device"], "cpu")
            self.assertEqual(used["device"], "cpu")
            self.assertEqual(aligned.data.shape, (4410, 2))
            self.assertEqual(aligned.sr, 44100)
            for stem in stems.values():
                self.assertEqual(stem.data.shape, aligned.data.shape)
            # 同じ倍率を戻すので、各パートの振幅比が失われない。
            self.assertAlmostEqual(float(np.std(stems["vocals"].data) / np.std(stems["drums"].data)), 4, places=5)
            with self.assertRaisesRegex(RuntimeError, "GPUを利用できません"):
                workflow.separate_demucs(original, device="GPU", install=False)


if __name__ == "__main__":
    unittest.main()
