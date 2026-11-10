"""音源の準備から分析・保存までをつなぐ、小さな実験セッション。"""
from __future__ import annotations

import csv
import importlib.util
import io
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit
import zipfile

import numpy as np
from scipy.signal import resample_poly

from sound_core import (
    AudioData, load_audio, make_demo, select_interval, analyse_audio,
    plot_analysis, compare_summary, apply_processing, write_audio,
)

VERSION = "1.0.0"
MAX_DURATION = 1200.0
MAX_UPLOAD_BYTES = 250 * 1024 * 1024
MAX_DECODED_BYTES = 512 * 1024 * 1024
STEM_LABELS = {"vocals": "ボーカル", "drums": "ドラム", "bass": "ベース", "other": "その他"}


def _run(command, **kwargs):
    return subprocess.run(command, check=True, text=True, capture_output=True, **kwargs)


def validate_youtube_url(url):
    try:
        parts = urlsplit(url.strip())
    except (AttributeError, ValueError) as exc:
        raise ValueError("YouTubeの動画URLを入力してください。") from exc
    host = (parts.hostname or "").lower()
    if parts.scheme != "https" or host not in {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}:
        raise ValueError("https://から始まるYouTubeの動画URLを指定してください。")
    if parts.username or parts.password:
        raise ValueError("動画URLを確認してください。")
    return url.strip()


def fetch_youtube(url, destination):
    """音声だけを取得する。成功した実ファイルが確定するまで結果を返さない。"""
    url = validate_youtube_url(url)
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("音声の変換にffmpegが必要です。Colabで開くか、PCの音声ファイルを使ってください。")
    if importlib.util.find_spec("yt_dlp") is None:
        try:
            _run([sys.executable, "-m", "pip", "install", "-q", "yt-dlp"], timeout=180)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            raise RuntimeError("取得用ツールを準備できませんでした。PCの音声ファイルで試してください。") from exc
    folder = Path(tempfile.mkdtemp(prefix="youtube-", dir=destination))
    command = [sys.executable, "-m", "yt_dlp", "--no-playlist", "--max-filesize", "250M",
               "--socket-timeout", "30", "--retries", "2", "-f", "bestaudio/best",
               "-x", "--audio-format", "wav", "-o", str(folder / "source.%(ext)s"), url]
    try:
        _run(command, timeout=600)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError("YouTubeの音声を取得できませんでした。動画の利用条件とは別に、配信側が取得を制限する場合があります。公式配布の音源を保存し、「PCの音声ファイル」で読み込んでください。") from exc
    path = folder / "source.wav"
    if not path.is_file() or path.stat().st_size == 0:
        raise RuntimeError("取得した音声ファイルを確認できませんでした。PCの音声ファイルで試してください。")
    return path


def _selected_bounds(duration, range_mode, start, end):
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("音源の長さを確認できませんでした。")
    if range_mode not in {"全体", "区間を指定"}:
        raise ValueError("解析する範囲を選んでください。")
    if range_mode == "全体":
        begin, finish = 0.0, duration
    else:
        begin = float(start)
        finish = duration if end is None or float(end) == 0 else float(end)
        if not math.isfinite(begin) or not math.isfinite(finish):
            raise ValueError("開始・終了時刻には有限の秒数を指定してください。")
    if begin < 0 or begin >= duration or finish <= begin or finish > duration + 1e-6:
        raise ValueError("0秒以上で、開始 < 終了 <= 音源の長さとなる区間を指定してください。")
    if finish - begin > MAX_DURATION:
        raise ValueError("1回に解析できる範囲は20分までです。「区間を指定」で範囲を短くしてください。")
    return begin, min(finish, duration)


def _check_decoded_size(samples, channels):
    if samples < 1 or not 1 <= channels <= 8:
        raise ValueError("1サンプル以上を含む、1〜8チャンネルの音源を選んでください。")
    if samples * channels * 4 > MAX_DECODED_BYTES:
        raise ValueError("展開後の音声が大きすぎます。区間を短くするか、サンプリング周波数やチャンネル数が少ない音源で試してください。")


def load_selected_file(path, destination, range_mode="全体", start=0, end=0):
    """長い音源を丸ごとメモリーへ展開する前に、解析区間を限定する。"""
    import soundfile as sf
    path = Path(path)
    if not path.is_file() or path.stat().st_size > MAX_UPLOAD_BYTES:
        raise ValueError("250 MB以下の音声ファイルを選んでください。")
    try:
        info = sf.info(path)
    except (RuntimeError, OSError):
        info = None
    if info is not None:
        begin, finish = _selected_bounds(float(info.duration), range_mode, start, end)
        first, last = int(round(begin * info.samplerate)), int(round(finish * info.samplerate))
        _check_decoded_size(last - first, info.channels)
        data, sr = sf.read(path, start=first, frames=last - first, always_2d=True, dtype="float32")
        return AudioData(data, sr, "元の音"), begin, finish
    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        raise RuntimeError("この形式の読み込みにはffmpegが必要です。WAVファイルで試すか、Colabで実行してください。")
    try:
        probe = _run(["ffprobe", "-v", "error", "-select_streams", "a:0",
                      "-show_entries", "format=duration:stream=sample_rate,channels,duration",
                      "-of", "json", str(path)], timeout=30)
        metadata = json.loads(probe.stdout)
        stream = metadata["streams"][0]
        duration = float(metadata.get("format", {}).get("duration", stream.get("duration")))
        sample_rate, channels = int(stream["sample_rate"]), int(stream["channels"])
        if not 1 <= sample_rate <= 768000:
            raise ValueError("音源のサンプリング周波数を確認してください。")
        begin, finish = _selected_bounds(duration, range_mode, start, end)
        _check_decoded_size(int(math.ceil((finish - begin) * sample_rate)), channels)
        converted = Path(destination) / "decoded.wav"
        _run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-ss", str(begin), "-i", str(path),
              "-t", str(finish - begin), "-map", "0:a:0", "-vn", "-c:a", "pcm_f32le", str(converted)], timeout=180)
        if converted.stat().st_size > MAX_DECODED_BYTES + 65536:
            raise ValueError("展開後の音声が大きすぎます。解析する区間を短くしてください。")
        audio = load_audio(converted)
        return AudioData(audio.data, audio.sr, "元の音"), begin, finish
    except (KeyError, IndexError, TypeError, json.JSONDecodeError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError("音声を読み込めませんでした。破損していないWAV・MP3などの音声で試してください。") from exc


def separate_demucs(original, device="自動", install=True):
    """Demucsの推論だけを使い、音声入出力と共通の倍率はここで管理する。"""
    if device not in {"自動", "CPU", "GPU"}:
        raise ValueError("計算に使う装置を選んでください。")
    if importlib.util.find_spec("demucs") is None:
        if not install:
            raise RuntimeError("Demucsが未導入です。分離を有効にしてColabで実行してください。")
        try:
            _run([sys.executable, "-m", "pip", "install", "-q", "demucs==4.0.1"], timeout=600)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            raise RuntimeError("音源分離の準備に失敗しました。ランタイムを再起動してセル1から実行するか、まず合成デモで試してください。") from exc
    try:
        import torch
        from demucs.pretrained import get_model
        from demucs.apply import apply_model
    except Exception as exc:
        raise RuntimeError("DemucsとPyTorchを読み込めませんでした。Colabのランタイムを再起動して、セル1から試してください。") from exc
    available = bool(torch.cuda.is_available())
    if device == "GPU" and not available:
        raise RuntimeError("GPUを利用できません。「自動」または「CPU」を選んでください。自動ではCPUで続けられます。")
    chosen = "cuda" if available and device != "CPU" else "cpu"
    try:
        model = get_model("htdemucs")
        sample_rate = int(model.samplerate)
        channels = int(model.audio_channels)
        names = list(model.sources)
        if set(names) != set(STEM_LABELS) or channels not in {1, 2}:
            raise RuntimeError("モデルのパート構成を確認できませんでした。")
        data = np.asarray(original.data, dtype=np.float32)
        if data.shape[1] not in {1, 2}:
            raise ValueError("音源分離はモノラルまたはステレオの音源で試してください。")
        divisor = math.gcd(original.sr, sample_rate)
        if original.sr != sample_rate:
            data = resample_poly(data, sample_rate // divisor, original.sr // divisor, axis=0).astype(np.float32)
        if data.shape[1] == 1 and channels == 2:
            data = np.repeat(data, 2, axis=1)
        elif channels == 1 and data.shape[1] == 2:
            raise ValueError("このモデルではステレオをそのまま扱えません。")
        # 全パート共通の倍率。逆相ステレオで平均が消える場合は全chの尺度へ戻す。
        reference = data.mean(axis=1)
        mean = float(reference.mean())
        scale = float(reference.std())
        if scale < 1e-8:
            scale = float(data.std())
        if scale < 1e-8:
            raise ValueError("ほぼ無音のため分離できません。音の入っている区間を選んでください。")
        wave = torch.from_numpy(((data - mean) / scale).T.copy())
        model.eval()
        with torch.no_grad():
            predicted = apply_model(model, wave[None], device=chosen, shifts=0,
                                    split=True, segment=7, overlap=0.25, progress=True)[0]
        separated = predicted.detach().cpu().numpy()
        if separated.shape != (len(names), channels, len(data)):
            raise RuntimeError("分離音声の長さが一致しませんでした。区間を短くして試してください。")
        stems = {name: AudioData((separated[i].T * scale + mean).astype(np.float32), sample_rate, STEM_LABELS[name])
                 for i, name in enumerate(names)}
        aligned = AudioData(data, sample_rate, "元の音")
        return aligned, stems, {"model": "htdemucs", "device": chosen,
                                "normalisation": "全パート共通の倍率を復元。個別の音量正規化なし"}
    except ValueError:
        raise
    except Exception as exc:
        raise RuntimeError("音源分離を完了できませんでした。モデル取得やメモリー不足が原因の場合があります。区間を短くするか、CPU・GPUの選択を変えて試してください。") from exc


def _json_safe(value):
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if isinstance(value, np.generic):
        return _json_safe(value.item())
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def _csv_bytes(rows):
    buffer = io.StringIO(newline="")
    if rows:
        fields = list(dict.fromkeys(key for row in rows for key in row))
        writer = csv.DictWriter(buffer, fieldnames=fields)
        writer.writeheader()
        writer.writerows(_json_safe(rows))
    return buffer.getvalue().encode("utf-8-sig")


def _public_label(key):
    return {"original": "元の音", "processed": "加工後", **STEM_LABELS}.get(key, "比較音")


class StudySession:
    """新しい段階を実行する前に、古い下流の結果を消して取り違えを防ぐ。"""
    def __init__(self, directory=None):
        self.directory = Path(directory or tempfile.mkdtemp(prefix="sound-lab-"))
        self.directory.mkdir(parents=True, exist_ok=True)
        self.source = None
        self.demo_stems = {}
        self.stems = {}
        self.input_info = None
        self.separation_info = None
        self.analysis = None
        self.processing = None

    def clear_analysis(self):
        self.analysis = None
        self.processing = None

    def prepare(self, source_mode="合成デモ", demo_name="band", path=None,
                youtube_url="", range_mode="全体", start=0, end=0):
        self.source = None
        self.demo_stems = {}
        self.stems = {}
        self.input_info = None
        self.separation_info = None
        self.clear_analysis()
        run = Path(tempfile.mkdtemp(prefix="input-", dir=self.directory))
        if source_mode == "合成デモ":
            original, stems = make_demo(demo_name)
            begin, finish = _selected_bounds(len(original.data) / original.sr, range_mode, start, end)
            selected = select_interval(original, begin, finish)
            selected_stems = {name: select_interval(audio, begin, finish) for name, audio in stems.items()}
            kind = "synthetic_demo"
        elif source_mode in {"PCの音声ファイル", "YouTube URL"}:
            if source_mode == "YouTube URL":
                path = fetch_youtube(youtube_url, run)
            if path is None:
                raise ValueError("音声ファイルを選んでください。")
            selected, begin, finish = load_selected_file(path, run, range_mode, start, end)
            selected_stems = {}
            kind = "uploaded_audio" if source_mode == "PCの音声ファイル" else "youtube_audio"
        else:
            raise ValueError("音源の種類を選んでください。")
        self.source = AudioData(selected.data, selected.sr, "元の音")
        self.demo_stems = selected_stems
        self.input_info = {"source_kind": kind, "demo": demo_name if kind == "synthetic_demo" else None,
                           "start_seconds": begin, "end_seconds": finish,
                           "duration_seconds": len(selected.data) / selected.sr}
        return self.source

    def separate(self, mode="自動", device="自動", install=True):
        self.stems = {}
        self.separation_info = None
        self.clear_analysis()
        if self.source is None:
            raise RuntimeError("先にセル2で音源を用意してください。")
        if mode not in {"自動", "分離しない", "Demucsで4パート分離"}:
            raise ValueError("分離方法を選んでください。")
        if mode == "分離しない":
            info = {"model": "none", "device": "cpu"}
            original, stems = self.source, {}
        elif self.input_info["source_kind"] == "synthetic_demo" and mode == "自動":
            original, stems = self.source, dict(self.demo_stems)
            info = {"model": "synthetic_known_parts", "device": "cpu"}
        else:
            original, stems, info = separate_demucs(self.source, device=device, install=install)
        self.source, self.stems, self.separation_info = original, stems, info
        return stems

    def _snapshot(self, tracks, settings, name):
        folder = Path(tempfile.mkdtemp(prefix=name + "-", dir=self.directory))
        original = tracks["original"]
        others = {key: audio for key, audio in tracks.items() if key != "original"}
        # グラフと時系列は同じ設定・同じ原音の基準を使う。
        peak = audio_peak(self.source)
        images = plot_analysis(original, others, folder, reference_peak=peak, **settings)
        summary = compare_summary(original, others, reference_peak=peak, **settings)
        frames = {}
        for key, audio in tracks.items():
            profile = analyse_audio(audio, reference_peak=peak, **settings)
            frames[key] = {field: np.array(profile[field], copy=True) for field in
                           ("times", "rms", "rms_dbfs", "centroid_hz", "active")}
        return {"tracks": dict(tracks), "settings": dict(settings, reference_peak=peak), "images": images,
                "summary": summary, "frames": frames}

    def analyse(self, n_fft=2048, hop=512, silence_db=-50):
        self.clear_analysis()
        if self.source is None or self.separation_info is None:
            raise RuntimeError("先にセル2・3を実行してください。")
        settings = {"n_fft": n_fft, "hop": hop, "silence_db": float(silence_db)}
        tracks = {"original": self.source, **self.stems}
        snapshot = self._snapshot(tracks, settings, "analysis")
        self.analysis = snapshot
        return snapshot

    def process(self, target="original", mode="none", cutoff=3000, strength=0.2):
        self.processing = None
        if self.analysis is None:
            raise RuntimeError("先にセル4で分析してください。")
        tracks = self.analysis["tracks"]
        if mode == "none":
            return None
        if target not in tracks:
            raise ValueError("この音源に含まれるパートを選んでください。")
        before = tracks[target]
        after = apply_processing(before, mode=mode, cutoff=float(cutoff), strength=float(strength))
        before = AudioData(before.data, before.sr, "加工前")
        after = AudioData(after.data, after.sr, "加工後")
        settings = {key: value for key, value in self.analysis["settings"].items() if key != "reference_peak"}
        snapshot = self._snapshot({"original": before, "processed": after}, settings, "processing")
        snapshot["processing_settings"] = {"target": target, "mode": mode,
                                           "cutoff_hz": float(cutoff), "strength": float(strength)}
        self.processing = snapshot
        return snapshot

    def export_zip(self, include_audio=False):
        if self.analysis is None:
            raise RuntimeError("先にセル4で分析してください。失敗した解析の前の結果は保存しません。")
        output = io.BytesIO()
        settings = {"version": VERSION, "input": self.input_info,
                    "separation": self.separation_info, "analysis": self.analysis["settings"],
                    "processing": self.processing["processing_settings"] if self.processing else None,
                    "notes": ["入力URL・元ファイル名・個人情報は記録しません。",
                              "重心は振幅スペクトルを重みにした周波数の平均で、音高そのものではありません。",
                              "無音判定は各パートの個別最大値ではなく、比較元の共通ピークを基準にします。"]}
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("settings.json", json.dumps(_json_safe(settings), ensure_ascii=False, indent=2, allow_nan=False))
            for prefix, snapshot in (("analysis", self.analysis), ("processing", self.processing)):
                if snapshot is None:
                    continue
                archive.writestr(prefix + "/summary.csv", _csv_bytes(snapshot["summary"]))
                for key, frame in snapshot["frames"].items():
                    rows = [{"時間（秒）": t, "RMS": r, "RMS（dBFS）": db,
                             "スペクトル重心（Hz）": c, "有効フレーム": bool(a)}
                            for t, r, db, c, a in zip(frame["times"], frame["rms"], frame["rms_dbfs"], frame["centroid_hz"], frame["active"])]
                    archive.writestr(prefix + f"/frames_{key}.csv", _csv_bytes(rows))
                for path in snapshot["images"]:
                    path = Path(path)
                    archive.write(path, prefix + "/" + path.name)
                if include_audio:
                    audio_dir = Path(tempfile.mkdtemp(prefix="export-audio-", dir=self.directory))
                    for key, audio in snapshot["tracks"].items():
                        path = write_audio(audio, audio_dir / f"{key}.wav")
                        archive.write(path, prefix + f"/{key}.wav")
            archive.writestr("README.txt", "音の実験室：分析結果\n\n音声は含める設定を選んだ場合だけ保存します。\n入力URLや元ファイル名は保存しません。\nグラフの時間は選択した区間の先頭を0秒とした値です。\nAI分離にはほかのパートの混入や人工的な成分が残る場合があります。\n")
        return output.getvalue()


def audio_peak(audio):
    return max(float(np.max(np.abs(audio.data[first:first + 65536])))
               for first in range(0, len(audio.data), 65536))


def common_playback_gain(audios):
    """音量比を保ったまま、すべての再生に同じ安全な倍率を使う。"""
    peak = max((audio_peak(a) for a in audios), default=0.0)
    return min(1.0, 0.9 / peak) if peak > 0 else 1.0
