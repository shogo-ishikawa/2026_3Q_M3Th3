"""音を聴き比べる教材の数値処理。試聴用の音量調整は解析値に混ぜません。"""
from dataclasses import dataclass
from pathlib import Path
import math
import shutil
import subprocess
import tempfile

import numpy as np
from scipy import signal

PART_LABELS = {"original": "原曲・合成ミックス", "vocals": "ボーカル", "drums": "ドラム", "bass": "ベース", "other": "その他", "processed": "加工後"}


def _blocks(values):
    for first in range(0, len(values), 65536):
        yield values[first:first + 65536]


def _audio_stats(audio):
    """長いステレオ曲でも全体のfloat64コピーを作らず集計します。"""
    peak, squares, above_full_scale = 0.0, 0.0, 0
    for values in _blocks(audio.data):
        absolute = np.abs(values)
        peak = max(peak, float(absolute.max()))
        squares += float(np.sum(values.astype(np.float64)**2))
        above_full_scale += int(np.count_nonzero(absolute > 1))
    return peak, math.sqrt(squares / audio.data.size), above_full_scale / audio.data.size


@dataclass
class AudioData:
    data: np.ndarray
    sr: int
    label: str = "音源"

    def __post_init__(self):
        if isinstance(self.sr, bool) or not isinstance(self.sr, (int, np.integer)) or not 1 <= self.sr <= 768000:
            raise ValueError("サンプリング周波数は正の整数にしてください。")
        values = np.asarray(self.data)
        if np.iscomplexobj(values) or not np.issubdtype(values.dtype, np.number):
            raise ValueError("音声データは実数の配列にしてください。")
        if values.ndim == 1:
            values = values[:, None]
        if values.ndim != 2 or values.shape[0] == 0 or not 1 <= values.shape[1] <= 8:
            raise ValueError("音声は1〜8チャンネルの空でない配列にしてください。")
        if any(not np.all(np.isfinite(block)) for block in _blocks(values)):
            raise ValueError("音声にNaNまたは無限大が含まれています。")
        self.data = values.astype(np.float32, copy=False)
        if any(not np.all(np.isfinite(block)) for block in _blocks(self.data)):
            raise ValueError("音声の値が大きすぎます。")
        self.sr = int(self.sr)
        self.label = str(self.label)

    @property
    def duration(self):
        return len(self.data) / self.sr

    @property
    def channels(self):
        return self.data.shape[1]


def load_audio(path):
    """SoundFileで読み込み、対応しない形式はFFmpegでWAVへ変換します。"""
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError("音声ファイルが見つかりません。")
    try:
        import soundfile as sf
        data, sr = sf.read(path, dtype="float32", always_2d=True)
        return AudioData(data, sr, "読み込んだ音源")
    except (ImportError, RuntimeError, ValueError):
        if not shutil.which("ffmpeg"):
            raise RuntimeError("この形式を読むにはSoundFileまたはFFmpegが必要です。") from None
    with tempfile.TemporaryDirectory(prefix="sound-lab-decode-") as directory:
        decoded = Path(directory) / "decoded.wav"
        completed = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", str(path), "-vn", "-c:a", "pcm_f32le", str(decoded)], capture_output=True, text=True)
        if completed.returncode:
            raise ValueError("音声を読み込めませんでした。形式やファイルを確認してください。")
        from scipy.io import wavfile
        sr, data = wavfile.read(decoded)
        return AudioData(data, sr, "読み込んだ音源")


def write_audio(audio, path):
    """独立した音量正規化をせず、浮動小数点WAVで保存します。"""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        import soundfile as sf
        sf.write(path, audio.data, audio.sr, subtype="FLOAT", format="WAV")
    except ImportError:
        from scipy.io import wavfile
        wavfile.write(path, audio.sr, audio.data)
    return path


def select_interval(audio, start=0, end=None):
    start = float(start)
    end = audio.duration if end is None else float(end)
    if not math.isfinite(start) or not math.isfinite(end) or not 0 <= start < end <= audio.duration + 1 / audio.sr:
        raise ValueError("開始・終了は音源内の有効な区間にしてください。")
    first = int(round(start * audio.sr))
    last = min(len(audio.data), int(round(end * audio.sr)))
    if first >= last:
        raise ValueError("少なくとも1サンプルを含む区間を指定してください。")
    return AudioData(audio.data[first:last], audio.sr, audio.label)


def make_demo(name, duration=8, sr=22050):
    if name not in ("tone", "harmonics", "band"):
        raise ValueError("デモはtone・harmonics・bandから選んでください。")
    if not math.isfinite(duration) or not 0.1 <= duration <= 120 or not isinstance(sr, int) or sr < 8000:
        raise ValueError("デモは0.1〜120秒、8000 Hz以上にしてください。")
    time = np.arange(int(round(duration * sr))) / sr
    fade = np.minimum(1, time / 0.03) * np.minimum(1, (duration - time) / 0.03)
    if name in ("tone", "harmonics"):
        pure = np.sin(2 * np.pi * 440 * time)
        values = pure if name == "tone" else pure + 0.5 * np.sin(2 * np.pi * 880 * time) + 0.25 * np.sin(2 * np.pi * 1320 * time)
        values = 0.12 * values / np.sqrt(np.mean(values**2)) * fade
        return AudioData(values, sr, "440 Hzの純音" if name == "tone" else "440 Hz＋倍音"), {}
    # 歌声や実楽器を分離したものではなく、各成分を別々に作った合成デモです。
    rng = np.random.default_rng(2404)
    beat = np.mod(time, 0.5)
    envelope = np.minimum(1, beat / 0.012) * np.exp(-beat * 5)
    melody = np.take([440.0, 493.883, 523.251, 587.330], (time // 1).astype(int) % 4)
    phase = 2 * np.pi * np.cumsum(melody) / sr
    vocals = 0.10 * envelope * (np.sin(phase) + 0.32 * np.sin(2 * phase))
    bass = 0.17 * np.exp(-beat * 4) * np.sin(2 * np.pi * 110 * time)
    noise = rng.normal(size=len(time))
    high = np.r_[0, np.diff(noise)]
    drums = 0.045 * np.exp(-np.mod(time, 0.25) * 60) * high + 0.12 * np.exp(-beat * 30) * np.sin(2 * np.pi * 65 * time)
    other = 0.035 * (np.sin(2 * np.pi * 261.626 * time) + np.sin(2 * np.pi * 329.628 * time) + np.sin(2 * np.pi * 391.995 * time))
    stems = {key: AudioData(values * fade, sr, label) for key, values, label in [
        ("vocals", vocals, "合成メロディ（ボーカル風）"), ("drums", drums, "合成ドラム"),
        ("bass", bass, "合成ベース"), ("other", other, "合成コード")]
    }
    mixed = sum(audio.data for audio in stems.values())
    return AudioData(mixed, sr, "合成バンドのミックス"), stems


def _parameters(n_fft, hop):
    if isinstance(n_fft, bool) or not isinstance(n_fft, int) or not 32 <= n_fft <= 65536:
        raise ValueError("FFTの窓幅は32〜65536の整数にしてください。")
    if isinstance(hop, bool) or not isinstance(hop, int) or not 1 <= hop <= n_fft:
        raise ValueError("時間の刻みは1〜窓幅の整数にしてください。")


def _frames(audio, centres, n_fft):
    indices = np.asarray(centres)[:, None] + np.arange(n_fft) - n_fft // 2
    valid = (indices >= 0) & (indices < len(audio.data))
    values = audio.data[np.clip(indices, 0, len(audio.data) - 1)]
    values = np.where(valid[:, :, None], values, 0)
    return values.transpose(0, 2, 1), valid.sum(axis=1)


def _finite_stat(values, statistic):
    values = values[np.isfinite(values)]
    return float(statistic(values)) if values.size else None


def analyse_audio(audio, n_fft=2048, hop=512, silence_db=-50, reference_peak=None, max_spectrogram_frames=4000):
    """全フレームの指標を計算し、画像用STFTだけ時間方向に平均します。"""
    _parameters(n_fft, hop)
    if not math.isfinite(silence_db) or not -120 <= silence_db <= 0:
        raise ValueError("無音のしきい値は-120〜0 dBにしてください。")
    if not isinstance(max_spectrogram_frames, int) or max_spectrogram_frames < 1:
        raise ValueError("スペクトログラムの表示列数は正の整数にしてください。")
    peak, global_rms, clipped_fraction = _audio_stats(audio)
    reference_peak = peak if reference_peak is None else float(reference_peak)
    if not math.isfinite(reference_peak) or reference_peak < 0:
        raise ValueError("比較の基準振幅を確認してください。")
    if (len(audio.data) + hop - 1) // hop > 2000000:
        raise ValueError("解析フレーム数が多すぎます。時間の刻みを大きくするか、短い区間を指定してください。")
    centres = np.arange(0, len(audio.data), hop)
    times = centres / audio.sr
    frequencies = np.fft.rfftfreq(n_fft, 1 / audio.sr)
    frame_count = len(centres)
    # 窓幅を大きくしても画像用行列は約16 MB以内に抑えます。
    image_count = min(frame_count, max_spectrogram_frames, max(1, 4000000 // len(frequencies)))
    image_groups = np.arange(frame_count, dtype=np.int64) * image_count // frame_count
    counts = np.bincount(image_groups, minlength=image_count)
    magnitude = np.zeros((len(frequencies), image_count), dtype=np.float32)
    spectrum_sum = np.zeros(len(frequencies), dtype=np.float64)
    centroid = np.full(frame_count, np.nan)
    rms = np.empty(frame_count)
    window = signal.get_window("hann", n_fft, fftbins=True).astype(np.float32)
    spectral_peak = 0.0
    threshold = reference_peak * 10 ** (silence_db / 20)
    active = np.zeros(frame_count, dtype=bool)
    batch_size = max(1, min(256, 2000000 // (n_fft * audio.channels)))
    for first in range(0, frame_count, batch_size):
        last = min(first + batch_size, frame_count)
        samples, valid = _frames(audio, centres[first:last], n_fft)
        rms[first:last] = np.sqrt(np.sum(samples.astype(np.float64)**2, axis=(1, 2)) / (valid * audio.channels))
        values = np.mean(np.abs(np.fft.rfft(samples * window, axis=-1)), axis=1) / window.sum()
        spectral_peak = max(spectral_peak, float(np.max(values)))
        spectrum_sum += values.sum(axis=0)
        weights = values.sum(axis=1)
        valid_sound = (rms[first:last] > threshold) & (weights > 0)
        active[first:last] = valid_sound
        centroid[first:last] = np.divide(values @ frequencies, weights, out=np.full(last - first, np.nan), where=valid_sound)
        groups = image_groups[first:last]
        boundaries = np.r_[0, np.flatnonzero(np.diff(groups)) + 1]
        magnitude[:, groups[boundaries]] += np.add.reduceat(values, boundaries, axis=0).T
    magnitude /= counts[None, :]
    spectrogram_times = np.bincount(image_groups, weights=times, minlength=image_count) / counts
    summary = {
        "label": audio.label, "duration_seconds": audio.duration, "sample_rate": audio.sr,
        "channels": audio.channels, "n_fft": n_fft, "hop": hop, "peak": peak, "rms": global_rms,
        "rms_dbfs": float(20 * np.log10(global_rms)) if global_rms else None,
        "active_fraction": float(active.mean()),
        "centroid_mean_hz": _finite_stat(centroid, np.mean),
        "centroid_median_hz": _finite_stat(centroid, np.median),
        "centroid_p25_hz": _finite_stat(centroid, lambda x: np.percentile(x, 25)),
        "centroid_p75_hz": _finite_stat(centroid, lambda x: np.percentile(x, 75)),
        "silence_db": float(silence_db), "reference_peak": reference_peak,
        "clipped_sample_fraction": clipped_fraction,
    }
    return {"times": times, "time_frames": times, "frequencies": frequencies, "freq": frequencies,
            "magnitude": magnitude, "spectrogram_times": spectrogram_times,
            "mean_spectrum": spectrum_sum / frame_count, "spectral_peak": spectral_peak,
            "rms": rms, "rms_dbfs": 20 * np.log10(np.maximum(rms, 1e-6)),
            "centroid_hz": centroid, "active": active, "summary": summary,
            "spectrogram_averaged": frame_count > image_count}


def _tracks(original, stems):
    tracks = [("original", original), *stems.items()]
    for _, audio in tracks:
        if audio.sr != original.sr or len(audio.data) != len(original.data):
            raise ValueError("比較するパートのサンプリング周波数とサンプル数を原曲にそろえてください。")
    return tracks


def compare_summary(original, stems, reference_peak=None, **settings):
    rows = []
    reference = _audio_stats(original)[0] if reference_peak is None else reference_peak
    settings = dict(settings, reference_peak=reference)
    for key, audio in _tracks(original, stems):
        summary = analyse_audio(audio, **settings)["summary"]
        rows.append({"パート": audio.label, "長さ（秒）": summary["duration_seconds"],
                     "RMS（dBFS）": summary["rms_dbfs"], "重心平均（Hz）": summary["centroid_mean_hz"],
                     "重心中央値（Hz）": summary["centroid_median_hz"],
                     "重心25%点（Hz）": summary["centroid_p25_hz"], "重心75%点（Hz）": summary["centroid_p75_hz"],
                     "有効時間率（%）": 100 * summary["active_fraction"]})
    return rows


def ensure_japanese_font():
    """日本語グリフが実在するフォントだけを使い、豆腐文字を避けます。"""
    import matplotlib as mpl
    from matplotlib import font_manager, ft2font
    preferences = ["Noto Sans CJK JP", "Noto Sans JP", "IPAexGothic", "IPAGothic", "Yu Gothic", "Hiragino Sans"]
    candidates = sorted(font_manager.fontManager.ttflist, key=lambda f: preferences.index(f.name) if f.name in preferences else len(preferences))
    for font in candidates:
        if font.name not in preferences:
            continue
        try:
            glyphs = ft2font.FT2Font(font.fname).get_charmap()
            if all(ord(char) in glyphs for char in "時間周波数重心振幅原曲"):
                mpl.rcParams["font.family"] = [font.name]
                mpl.rcParams["axes.unicode_minus"] = False
                return font.name
        except (OSError, RuntimeError):
            continue
    try:
        # パッケージの実行コードは旧distutilsに依存するためimportしません。
        from importlib.util import find_spec
        package = find_spec("japanize_matplotlib")
        if package is not None and package.origin:
            path = Path(package.origin).parent / "fonts" / "ipaexg.ttf"
            font = ft2font.FT2Font(str(path))
            if all(ord(char) in font.get_charmap() for char in "時間周波数重心振幅原曲"):
                font_manager.fontManager.addfont(str(path))
                mpl.rcParams["font.family"] = [font.family_name]
                mpl.rcParams["axes.unicode_minus"] = False
                return font.family_name
    except (ImportError, ValueError, RuntimeError, OSError):
        pass
    raise RuntimeError("日本語フォントが見つかりません。セル1でjapanize-matplotlibを準備してください。")


def plot_analysis(original, stems, output_dir, n_fft=2048, hop=512, silence_db=-50, reference_peak=None):
    import matplotlib.pyplot as plt
    ensure_japanese_font()
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    tracks = _tracks(original, stems)
    reference = _audio_stats(original)[0] if reference_peak is None else reference_peak
    analyses = [analyse_audio(audio, n_fft, hop, silence_db, reference) for _, audio in tracks]
    waveform_limit = max(1e-6, max(a["summary"]["peak"] for a in analyses)) * 1.05
    count = len(tracks)
    paths = []
    colours = plt.get_cmap("tab10").colors
    fig, axes = plt.subplots(count, 1, figsize=(12, max(3.2, 2.1 * count)), sharex=True, squeeze=False)
    for index, ((key, audio), row) in enumerate(zip(tracks, axes)):
        ax = row[0]
        edges = np.linspace(0, len(audio.data), min(3500, len(audio.data)) + 1, dtype=int)
        lows, highs = [], []
        for a, b in zip(edges[:-1], edges[1:]):
            lows.append(float(audio.data[a:b].min())); highs.append(float(audio.data[a:b].max()))
        ax.fill_between((edges[:-1] + edges[1:]) / (2 * audio.sr), lows, highs, color=colours[index % 10], alpha=0.8)
        ax.set_ylabel("相対振幅")
        ax.set_title(audio.label, loc="left", fontsize=11)
        ax.set_ylim(-waveform_limit, waveform_limit)
        ax.grid(alpha=0.25)
    axes[-1, 0].set_xlabel("選択区間の時間（秒）")
    fig.suptitle("同じ時間軸で比べる波形（全チャンネルの振幅範囲）", fontsize=14)
    fig.tight_layout(rect=(0, 0, 1, 0.97)); paths.append(_save(fig, output_dir / "waveforms.png"))

    fig, ax = plt.subplots(figsize=(12, 5))
    for index, ((_, audio), analysis) in enumerate(zip(tracks, analyses)):
        ax.plot(analysis["frequencies"][1:], analysis["mean_spectrum"][1:], label=audio.label, color=colours[index % 10])
    ax.set(xscale="log", xlabel="周波数（Hz）", ylabel="平均の相対振幅", title="平均振幅スペクトル（選んだ全区間）")
    ax.set_xlim(max(1, original.sr / n_fft), original.sr / 2)
    ax.grid(alpha=0.25); ax.legend(fontsize=9)
    fig.tight_layout(); paths.append(_save(fig, output_dir / "spectra.png"))

    fig, axes = plt.subplots(count, 1, figsize=(12, max(3.5, 2.5 * count)), sharex=True, squeeze=False)
    spectral_reference = max(max(a["spectral_peak"] for a in analyses), 1e-12)
    image = None
    for (_, audio), analysis, row in zip(tracks, analyses, axes):
        ax = row[0]
        db = 20 * np.log10(np.maximum(analysis["magnitude"] / spectral_reference, 1e-6))
        image = ax.imshow(db, origin="lower", aspect="auto", extent=[0, audio.duration, 0, audio.sr / 2], vmin=-80, vmax=0, cmap="magma")
        ax.set_ylabel("周波数（Hz）"); ax.set_title(audio.label, loc="left", fontsize=11)
    axes[-1, 0].set_xlabel("選択区間の時間（秒）")
    fig.suptitle("スペクトログラム（全パート共通の色基準）", fontsize=14)
    fig.subplots_adjust(left=0.09, right=0.86, bottom=0.08, top=0.94, hspace=0.55)
    fig.colorbar(image, cax=fig.add_axes([0.89, 0.13, 0.018, 0.72]), label="共通基準に対する振幅（dB）")
    if any(a["spectrogram_averaged"] for a in analyses):
        fig.text(0.09, 0.012, "長い音源では画像だけ時間方向に平均しています。指標は全フレームで計算します。", fontsize=9)
    paths.append(_save(fig, output_dir / "spectrograms.png"))

    fig, axes = plt.subplots(2, 1, figsize=(12, 7), sharex=True)
    for index, ((_, audio), analysis) in enumerate(zip(tracks, analyses)):
        step = max(1, len(analysis["times"]) // 6000)
        axes[0].plot(analysis["times"][::step], analysis["centroid_hz"][::step], label=audio.label, color=colours[index % 10], alpha=0.85)
        axes[1].plot(analysis["times"][::step], analysis["rms_dbfs"][::step], color=colours[index % 10], alpha=0.85)
    axes[0].set(ylabel="スペクトル重心（Hz）", title="音色の明るさに関わる指標の時間変化（音高ではありません）")
    axes[1].set(xlabel="選択区間の時間（秒）", ylabel="RMS（dBFS）", title="波形の大きさの時間変化（0 dBFSは振幅1が基準）")
    axes[1].set_ylim(-120, max(3, max(float(a["rms_dbfs"].max()) for a in analyses) + 3))
    for ax in axes: ax.grid(alpha=0.25)
    axes[0].legend(fontsize=9, loc="upper right")
    fig.tight_layout(); paths.append(_save(fig, output_dir / "features.png"))
    return paths


def _save(fig, path):
    import matplotlib.pyplot as plt
    fig.savefig(path, dpi=140, facecolor="white")
    plt.close(fig)
    return path


def apply_processing(audio, mode="none", cutoff=3000, strength=0.2):
    if mode == "none":
        return AudioData(audio.data.copy(), audio.sr, audio.label)
    if mode == "lowpass":
        if not math.isfinite(cutoff) or not 0 < cutoff < audio.sr / 2:
            raise ValueError("通過させる上限周波数は0 Hzより大きく、ナイキスト周波数未満にしてください。")
        sos = signal.butter(6, cutoff, fs=audio.sr, output="sos")
        values = signal.sosfiltfilt(sos, audio.data, axis=0, padlen=min(len(audio.data) - 1, 3 * (2 * len(sos) + 1)))
        return AudioData(values, audio.sr, audio.label + "／低域通過後")
    if mode != "gate" or not math.isfinite(strength) or not 0 <= strength <= 1:
        raise ValueError("加工方法と減衰率（0〜1）を確認してください。")
    n_fft, hop = 2048, 512
    window = signal.get_window("hann", n_fft, fftbins=True).astype(np.float32)
    centres = np.arange(0, len(audio.data), hop)
    # 長い音源では最大2048フレームからノイズ床の目安を推定します。
    chosen = np.unique(np.linspace(0, len(centres) - 1, min(len(centres), 2048), dtype=int))
    sampled = []
    for first in range(0, len(chosen), 128):
        frames, _ = _frames(audio, centres[chosen[first:first + 128]], n_fft)
        sampled.append(np.abs(np.fft.rfft(frames * window, axis=-1)).astype(np.float32))
    floor = np.percentile(np.concatenate(sampled), 10, axis=0) * 1.5
    output = np.zeros((len(audio.data) + n_fft, audio.channels), dtype=np.float32)
    norm = np.zeros(len(audio.data) + n_fft, dtype=np.float32)
    for first in range(0, len(centres), 128):
        positions = centres[first:first + 128]
        frames, _ = _frames(audio, positions, n_fft)
        spectrum = np.fft.rfft(frames * window, axis=-1)
        spectrum *= np.where(np.abs(spectrum) > floor[None], 1, strength)
        restored = np.fft.irfft(spectrum, n=n_fft, axis=-1) * window
        for offset, position in enumerate(positions):
            output[position:position + n_fft] += restored[offset].T
            norm[position:position + n_fft] += window**2
    start, stop = n_fft // 2, n_fft // 2 + len(audio.data)
    values = output[start:stop] / np.maximum(norm[start:stop, None], 1e-12)
    return AudioData(values, audio.sr, audio.label + "／簡易ゲート後")
