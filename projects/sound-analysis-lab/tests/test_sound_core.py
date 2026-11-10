"""比較の意味が保たれることを、既知の合成信号で確認します。"""
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock
import warnings

import matplotlib
matplotlib.use("Agg")
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sound_core import (AudioData, analyse_audio, apply_processing, compare_summary,
                        ensure_japanese_font, load_audio, make_demo, plot_analysis,
                        select_interval, write_audio)


def tone(frequency=512, amplitude=0.1, duration=1, sr=16384):
    time = np.arange(round(duration * sr)) / sr
    return AudioData(amplitude * np.sin(2 * np.pi * frequency * time), sr)


class AudioCoreTests(unittest.TestCase):
    def test_invalid_audio_is_rejected(self):
        for values, sr in [(np.array([]), 22050), ([1, np.nan], 22050), ([1j], 22050),
                           (np.zeros((3, 9)), 22050), ([0], 0), ([0], True)]:
            with self.subTest(values=str(values), sr=sr), self.assertRaises(ValueError):
                AudioData(values, sr)

    def test_demo_components_are_known_and_repeatable(self):
        original, parts = make_demo("band", duration=0.5)
        second, _ = make_demo("band", duration=0.5)
        self.assertEqual(set(parts), {"vocals", "drums", "bass", "other"})
        np.testing.assert_array_equal(original.data, sum(part.data for part in parts.values()))
        np.testing.assert_array_equal(original.data, second.data)
        self.assertIn("合成", original.label)
        self.assertEqual(original.data.dtype, np.float32)

    def test_pure_and_harmonic_demo_have_equal_rms_but_different_centroids(self):
        pure, _ = make_demo("tone", duration=1)
        rich, _ = make_demo("harmonics", duration=1)
        a, b = analyse_audio(pure)["summary"], analyse_audio(rich)["summary"]
        self.assertAlmostEqual(a["rms"], b["rms"], places=5)
        self.assertAlmostEqual(a["centroid_median_hz"], 440, delta=2)
        self.assertGreater(b["centroid_median_hz"], a["centroid_median_hz"] + 200)

    def test_centroid_is_amplitude_weighted_and_gain_invariant(self):
        base = tone()
        harmonics = AudioData(base.data + 0.5 * tone(1024).data + 0.25 * tone(1536).data, base.sr)
        result = analyse_audio(harmonics)
        expected = (512 + 0.5 * 1024 + 0.25 * 1536) / 1.75
        self.assertAlmostEqual(result["summary"]["centroid_median_hz"], expected, delta=0.01)
        quieter = analyse_audio(AudioData(harmonics.data * 0.04, harmonics.sr))
        self.assertAlmostEqual(result["summary"]["centroid_median_hz"], quieter["summary"]["centroid_median_hz"], delta=0.01)
        self.assertAlmostEqual(quieter["summary"]["rms_dbfs"] - result["summary"]["rms_dbfs"], 20 * np.log10(0.04), places=5)

    def test_higher_tone_has_higher_centroid(self):
        low = analyse_audio(tone(128))["summary"]
        high = analyse_audio(tone(4096))["summary"]
        self.assertAlmostEqual(low["centroid_median_hz"], 128, delta=0.01)
        self.assertAlmostEqual(high["centroid_median_hz"], 4096, delta=0.01)

    def test_opposite_phase_stereo_does_not_disappear(self):
        mono = tone()
        stereo = AudioData(np.column_stack([mono.data[:, 0], -mono.data[:, 0]]), mono.sr)
        self.assertEqual(float(np.abs(stereo.data.mean(axis=1)).max()), 0)
        a, b = analyse_audio(mono), analyse_audio(stereo)
        np.testing.assert_allclose(a["rms"], b["rms"], rtol=1e-6)
        np.testing.assert_allclose(a["centroid_hz"], b["centroid_hz"], rtol=1e-6)

    def test_silence_is_missing_centroid_and_shared_threshold_is_used(self):
        silent = analyse_audio(AudioData(np.zeros(4000), 22050))
        self.assertTrue(np.isnan(silent["centroid_hz"]).all())
        self.assertIsNone(silent["summary"]["centroid_mean_hz"])
        self.assertIsNone(silent["summary"]["rms_dbfs"])
        self.assertEqual(silent["summary"]["active_fraction"], 0)
        original = tone()
        quiet = AudioData(original.data * 0.0001, original.sr)
        self.assertGreater(analyse_audio(quiet)["summary"]["active_fraction"], 0.9)
        comparison = compare_summary(original, {"other": quiet})
        self.assertEqual(comparison[1]["有効時間率（%）"], 0)
        self.assertIsNone(comparison[1]["重心平均（Hz）"])
        overridden = compare_summary(quiet, {}, reference_peak=0.1)
        self.assertEqual(overridden[0]["有効時間率（%）"], 0)

    def test_short_constant_and_zero_audio_are_supported(self):
        for values in [[0], [1], np.ones(31), np.zeros(15)]:
            with self.subTest(size=len(values), first=values[0]):
                result = analyse_audio(AudioData(values, 8000), n_fft=32, hop=8)
                self.assertTrue(np.isfinite(result["rms"]).all())
                self.assertEqual(result["summary"]["n_fft"], 32)
                self.assertEqual(result["summary"]["hop"], 8)
                self.assertEqual(result["summary"]["sample_rate"], 8000)

    def test_visual_aggregation_preserves_all_numerical_frames(self):
        audio = tone(duration=2)
        full = analyse_audio(audio, hop=64, max_spectrogram_frames=1000)
        small = analyse_audio(audio, hop=64, max_spectrogram_frames=17)
        self.assertEqual(small["magnitude"].shape[1], 17)
        self.assertEqual(len(small["spectrogram_times"]), 17)
        self.assertTrue(small["spectrogram_averaged"])
        np.testing.assert_array_equal(small["times"], full["times"])
        np.testing.assert_array_equal(small["centroid_hz"], full["centroid_hz"])
        np.testing.assert_array_equal(small["mean_spectrum"], full["mean_spectrum"])

    def test_interval_and_track_alignment(self):
        audio = tone(duration=2)
        selected = select_interval(audio, 0.5, 1.25)
        self.assertEqual(len(selected.data), round(0.75 * audio.sr))
        np.testing.assert_array_equal(selected.data, audio.data[8192:20480])
        for start, end in [(1, 0), (-0.1, 1), (0, 3), (0, 0.00000001)]:
            with self.subTest(start=start, end=end), self.assertRaises(ValueError):
                select_interval(audio, start, end)
        with self.assertRaises(ValueError):
            compare_summary(audio, {"bass": selected})

    def test_lowpass_attenuates_high_tone_without_rescaling(self):
        low, high = tone(512, duration=2), tone(5000, duration=2)
        original = AudioData(low.data + high.data, low.sr)
        processed = apply_processing(original, "lowpass", cutoff=1800)
        centre = slice(1000, -1000)
        projection = lambda x, y: float(np.sum(x[centre] * y[centre]) / np.sum(y[centre]**2))
        self.assertAlmostEqual(projection(processed.data, low.data), 1, delta=0.01)
        self.assertLess(abs(projection(processed.data, high.data)), 0.01)
        self.assertEqual(processed.data.shape, original.data.shape)
        self.assertEqual(processed.sr, original.sr)
        self.assertEqual(processed.data.dtype, np.float32)
        self.assertTrue(np.isfinite(apply_processing(AudioData([1], 8000), "lowpass", cutoff=1000).data).all())

    def test_gate_identity_and_silence(self):
        audio = tone(duration=0.2)
        unchanged = apply_processing(audio, "gate", strength=1)
        np.testing.assert_allclose(unchanged.data, audio.data, atol=1e-7)
        silent = AudioData(np.zeros((17, 2)), 22050)
        gated = apply_processing(silent, "gate", strength=0)
        np.testing.assert_array_equal(gated.data, silent.data)
        np.testing.assert_allclose(apply_processing(audio, "none").data, audio.data)

    def test_processing_and_fft_bounds(self):
        audio = tone(duration=0.1)
        for settings in [dict(n_fft=1), dict(hop=0), dict(hop=4096), dict(silence_db=10), dict(reference_peak=-1)]:
            with self.subTest(settings=settings), self.assertRaises(ValueError):
                analyse_audio(audio, **settings)
        for mode, settings in [("unknown", {}), ("gate", {"strength": 2}), ("lowpass", {"cutoff": audio.sr})]:
            with self.subTest(mode=mode), self.assertRaises(ValueError):
                apply_processing(audio, mode, **settings)

    def test_float_wav_roundtrip_does_not_normalise(self):
        audio = AudioData(np.array([[0, -1.5], [1.25, 0.125]], dtype=np.float32), 22050)
        with tempfile.TemporaryDirectory() as folder:
            target = write_audio(audio, Path(folder) / "audio.wav")
            restored = load_audio(target)
            self.assertEqual(restored.sr, audio.sr)
            np.testing.assert_array_equal(restored.data, audio.data)

    def test_japanese_graphs_render_four_png_files(self):
        self.assertTrue(ensure_japanese_font())
        audio, stems = make_demo("band", duration=0.3)
        with tempfile.TemporaryDirectory() as folder, warnings.catch_warnings(record=True) as captured:
            warnings.simplefilter("always")
            paths = plot_analysis(audio, stems, folder)
            self.assertEqual({p.name for p in paths}, {"waveforms.png", "spectra.png", "spectrograms.png", "features.png"})
            for path in paths:
                self.assertEqual(path.read_bytes()[:8], b"\x89PNG\r\n\x1a\n")
                self.assertGreater(path.stat().st_size, 10000)
            self.assertFalse(any("Glyph" in str(w.message) and "missing" in str(w.message) for w in captured))

    def test_bundled_japanese_font_without_legacy_package_import(self):
        import builtins
        from importlib.util import find_spec
        from matplotlib import font_manager, ft2font
        package = find_spec("japanize_matplotlib")
        self.assertIsNotNone(package, "テスト環境にはjapanize-matplotlibが必要です。")
        bundled = Path(package.origin).parent / "fonts" / "ipaexg.ttf"
        self.assertTrue(bundled.is_file())
        original_import = builtins.__import__

        def forbid_legacy_import(name, *args, **kwargs):
            if name == "japanize_matplotlib" or name.startswith("japanize_matplotlib."):
                raise AssertionError("旧distutilsへ依存するパッケージ本体をimportしてはいけません。")
            return original_import(name, *args, **kwargs)

        with matplotlib.rc_context(), mock.patch.object(font_manager.fontManager, "ttflist", []), mock.patch("builtins.__import__", side_effect=forbid_legacy_import):
            family = ensure_japanese_font()
            self.assertEqual(family, "IPAexGothic")
            self.assertEqual(matplotlib.rcParams["font.family"], [family])
            registered = Path(font_manager.findfont(family, fallback_to_default=False))
            self.assertEqual(registered.resolve(), bundled.resolve())
            self.assertTrue(all(ord(char) in ft2font.FT2Font(str(registered)).get_charmap() for char in "時間周波数重心振幅原曲"))


if __name__ == "__main__":
    unittest.main()
