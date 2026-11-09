"""音源から伴奏を作る、画面表示と分離した処理。

2026年度3Qの学生作品にあったpYIN・コード伴奏・ドラムを引き継ぐ。
音声の分離モデルや大規模な生成モデルは使わず、推定と規則で編曲する。
"""
from dataclasses import dataclass
import math

import librosa
import numpy as np
import pretty_midi

SAMPLE_RATE = 22050
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
SCALE_DEFS = {
    "major": [0, 2, 4, 5, 7, 9, 11],
    "natural_minor": [0, 2, 3, 5, 7, 8, 10],
    "harmonic_minor": [0, 2, 3, 5, 7, 8, 11],
    "dorian": [0, 2, 3, 5, 7, 9, 10],
    "mixolydian": [0, 2, 4, 5, 7, 9, 10],
    "pentatonic": [0, 2, 4, 7, 9],
}
INSTRUMENTS = {"Electric Piano": 4, "Acoustic Grand Piano": 0,
               "Acoustic Guitar": 24, "Electric Guitar": 27,
               "Strings": 48, "Synth Lead": 80, "Music Box": 10}


@dataclass(frozen=True)
class Note:
    pitch: int
    start: float
    end: float
    velocity: int = 90


@dataclass
class ArrangementConfig:
    bpm: float = 120.0
    root: str = "C"
    scale: str = "major"
    instrument: str = "Electric Piano"
    add_chords: bool = True
    add_drums: bool = True
    add_melody: bool = True
    original_gain: float = 0.7
    chord_gain: float = 0.6
    drum_gain: float = 0.8
    melody_gain: float = 0.6
    beat_offset: float = 0.0
    humanise: float = 0.0
    seed: int = 42


def _audio(y, sr):
    y = np.asarray(y, dtype=np.float64)
    if y.ndim != 1 or y.size == 0 or not np.isfinite(y).all():
        raise ValueError("音源は空でない、有限の数値からなるモノラル音声にしてください。")
    if isinstance(sr, bool) or not isinstance(sr, (int, np.integer)) or not 8000 <= sr <= 192000:
        raise ValueError("サンプリング周波数は8000〜192000 Hzの整数にしてください。")
    return y


def _validate(config):
    if config.root not in NOTE_NAMES or config.scale not in SCALE_DEFS:
        raise ValueError("キーまたはスケールが選択肢にありません。")
    if config.instrument not in INSTRUMENTS:
        raise ValueError("楽器が選択肢にありません。")
    for name, low, high in [("bpm", 40, 240), ("beat_offset", 0, 60),
                            ("humanise", 0, 1), ("original_gain", 0, 2),
                            ("chord_gain", 0, 2), ("drum_gain", 0, 2),
                            ("melody_gain", 0, 2)]:
        value = getattr(config, name)
        if not isinstance(value, (int, float, np.number)) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError(f"{name}は{low}〜{high}の有限の数値にしてください。")
    if not isinstance(config.seed, (int, np.integer)) or not 0 <= config.seed < 2**32:
        raise ValueError("乱数シードは0〜4294967295の整数にしてください。")


def make_demo(duration=12.0, sr=SAMPLE_RATE):
    """外部の曲を使わない、C長調・120 BPMの短い動作確認用フレーズ。"""
    if not isinstance(duration, (int, float)) or not math.isfinite(duration) or not 0.2 <= duration <= 60:
        raise ValueError("デモの長さは0.2〜60秒にしてください。")
    y = np.zeros(round(duration * sr))
    _audio(y, sr)
    pitches = [60, 64, 67, 72, 65, 64, 62, 60, 60, 64, 65, 69, 67, 65, 62, 60]
    for i, start in enumerate(np.arange(0, duration, 0.5)):
        left, right = round(start * sr), min(len(y), round((start + 0.45) * sr))
        t = np.arange(right - left) / sr
        freq = librosa.midi_to_hz(pitches[i % len(pitches)])
        envelope = np.minimum(t / 0.012, 1) * np.minimum((len(t) / sr - t) / 0.035, 1)
        y[left:right] += 0.4 * envelope * np.exp(-1.5 * t) * np.sin(2 * np.pi * freq * t)
    return y.astype(np.float32)


def analyse_audio(y, sr=SAMPLE_RATE):
    """BPM・拍の位相・長調/短調を推定する。confidenceは比較用の目安。"""
    y = _audio(y, sr)
    result = dict(bpm=120.0, key="C", scale="major", beat_offset=0.0,
                  confidence=0.0, note="推定値は目安です。原曲を聴きながら修正してください。")
    if len(y) < sr * 0.12 or np.max(np.abs(y)) < 1e-6:
        result["note"] = "音源が短いか無音のため、仮の設定（C長調・120 BPM）を表示しています。"
        return result
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, trim=False)
    bpm = float(np.asarray(tempo).reshape(-1)[0])
    if math.isfinite(bpm) and bpm > 0:
        while bpm < 60:
            bpm *= 2
        while bpm > 200:
            bpm /= 2
        result["bpm"] = round(bpm, 2)
        if len(beats):
            first = float(librosa.frames_to_time(beats[0], sr=sr))
            result["beat_offset"] = round(first % (60 / bpm), 3)
    # 一番大きな音を主音とせず、12音全体と調のプロファイルを比較する。
    padded = np.pad(y, (0, max(0, 4096 - len(y))))
    chroma = librosa.feature.chroma_stft(y=padded, sr=sr, n_fft=4096).mean(axis=1)
    profiles = {
        "major": np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]),
        "natural_minor": np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]),
    }
    scores = []
    if np.std(chroma) > 1e-8:
        for mode, profile in profiles.items():
            for root in range(12):
                score = float(np.corrcoef(chroma, np.roll(profile, root))[0, 1])
                scores.append((score, root, mode))
        scores.sort(reverse=True)
        best, root, mode = scores[0]
        result.update(key=NOTE_NAMES[root], scale=mode,
                      confidence=round(max(0.0, best - scores[1][0]), 3))
    return result


def pitches_to_notes(f0, voiced, sr, hop_length, duration, min_duration=0.08):
    """ピッチの連続区間を音符にする。最後に続いている音も確定する。"""
    notes = []
    current, start = None, 0.0
    for index, (freq, is_voiced) in enumerate(zip(f0, voiced)):
        t = min(index * hop_length / sr, duration)
        pitch = int(round(librosa.hz_to_midi(freq))) if is_voiced and np.isfinite(freq) and freq > 0 else None
        if pitch is not None and not 0 <= pitch <= 127:
            pitch = None
        if pitch != current:
            if current is not None and t - start >= min_duration:
                notes.append(Note(current, start, t))
            current, start = pitch, t
    if current is not None and duration - start >= min_duration:
        notes.append(Note(current, start, duration))
    return notes


def extract_melody(y, sr=SAMPLE_RATE):
    """pYINで単音の高さを推定。多重奏の主旋律を分離する処理ではない。"""
    y = _audio(y, sr)
    if len(y) < sr * 0.08 or np.max(np.abs(y)) < 1e-6:
        return []
    frame_length, hop_length = 2048, 512
    padded = np.pad(y, (0, max(0, frame_length - len(y))))
    f0, voiced, _ = librosa.pyin(padded, fmin=librosa.note_to_hz("C3"),
                                fmax=min(librosa.note_to_hz("C6"), sr / 2 - 1),
                                sr=sr, frame_length=frame_length, hop_length=hop_length,
                                n_thresholds=50, resolution=0.2)
    return pitches_to_notes(f0, voiced, sr, hop_length, len(y) / sr)


def chord_pitches(root, scale, degree):
    """スケール上の音を1音おきに3つ重ねる。degreeは0から数える。"""
    intervals = SCALE_DEFS[scale]
    tonic = 48 + NOTE_NAMES.index(root)
    pitches = []
    for step in (0, 2, 4):
        octave, index = divmod(degree + step, len(intervals))
        pitches.append(tonic + 12 * octave + intervals[index])
    return pitches


def _scaled_note(pitch, start, end, velocity, gain, duration, rng, humanise):
    if gain <= 0 or velocity <= 0:
        return None
    start = max(0, start + rng.uniform(-0.018, 0.018) * humanise)
    end = min(duration, end)
    velocity = int(np.clip(round((velocity + rng.uniform(-10, 10) * humanise) * gain), 1, 127))
    if start >= end:
        return None
    return Note(int(pitch), float(start), float(end), velocity)


def _render(notes, sr, sample_count, program=4, drums=False, seed=42):
    """サンプル音源なしで聴ける簡易合成。GM音源の忠実な再現ではない。"""
    audio = np.zeros(sample_count)
    rng = np.random.default_rng(seed)
    for note in notes:
        left, right = round(note.start * sr), min(sample_count, round(note.end * sr))
        if right <= left:
            continue
        t = np.arange(right - left) / sr
        if drums:
            if note.pitch == 36:
                wave = np.sin(2 * np.pi * (48 * t + 24 * (1 - np.exp(-30 * t)) / 30)) * np.exp(-22 * t)
            else:
                noise = rng.uniform(-1, 1, len(t))
                wave = noise * np.exp(-(65 if note.pitch == 42 else 28) * t)
            amplitude = 0.28
        else:
            frequency = librosa.midi_to_hz(note.pitch)
            # 倍音を変えることで音色の違いを作る。高域の折り返しを避ける。
            weights = {0: [1, .22, .10], 4: [1, .35, .08], 24: [1, .30, .18],
                       27: [1, .45, .23], 48: [1, .55, .27], 80: [1, .45, .30],
                       10: [1, .05, .30]}[program]
            wave = np.zeros(len(t))
            for harmonic, weight in enumerate(weights, 1):
                if harmonic * frequency < sr / 2:
                    wave += weight * np.sin(2 * np.pi * frequency * harmonic * t)
            decay = 0.6 if program in (48, 80) else 3.0
            wave *= np.exp(-decay * t)
            amplitude = 0.16
        attack = np.minimum(t / 0.008, 1)
        release = np.minimum((len(t) / sr - t) / 0.025, 1)
        audio[left:right] += amplitude * (note.velocity / 100) * wave * attack * release
    return audio


def arrange(y, sr, config, melody_notes=None):
    """伴奏の拍を指定BPMで配置し、元の音源と同じ長さにミックスする。

    元の音声の速度や音程は変えない。BPM変更は追加する伴奏に作用する。
    """
    y = _audio(y, sr)
    _validate(config)
    duration = len(y) / sr
    rng = np.random.default_rng(config.seed)
    tracks = {"chords": [], "drums": [], "melody": []}
    warnings = []
    beat = 60 / config.bpm
    bar = 4 * beat
    # 7音のスケールは I–V–vi–IV。5音ではスケール上の対応音を使う。
    progression = [0, 4, 5, 3] if len(SCALE_DEFS[config.scale]) == 7 else [0, 3, 4, 2]
    for step, t in enumerate(np.arange(config.beat_offset, duration, beat / 4)):
        step_in_bar = step % 16
        if config.add_chords and step_in_bar in [0, 3, 6, 8, 10, 12, 14]:
            degree = progression[(step // 16) % 4]
            for index, pitch in enumerate(chord_pitches(config.root, config.scale, degree)):
                start = t + index * 0.012
                note = _scaled_note(pitch, start, start + min(.25, beat * .6), 85,
                                    config.chord_gain, duration, rng, config.humanise)
                if note:
                    tracks["chords"].append(note)
        if config.add_drums:
            for pitch, pattern, velocity, length in [(36, [0, 10, 14], 110, .15),
                                                      (38, [4, 12], 100, .15),
                                                      (42, list(range(0, 16, 2)), 75, .05)]:
                if step_in_bar in pattern:
                    note = _scaled_note(pitch, t, t + length, velocity,
                                        config.drum_gain, duration, rng, config.humanise)
                    if note:
                        tracks["drums"].append(note)
    if config.add_melody and config.melody_gain > 0:
        source_notes = extract_melody(y, sr) if melody_notes is None else melody_notes
        for source in source_notes:
            if (not 0 <= source.pitch <= 127 or not math.isfinite(source.start)
                    or not math.isfinite(source.end) or source.start < 0
                    or source.end <= source.start or not 0 <= source.velocity <= 127):
                raise ValueError("メロディの音符データに不正な値があります。")
            note = _scaled_note(source.pitch, source.start, source.end, source.velocity,
                                config.melody_gain, duration, rng, 0)
            if note:
                tracks["melody"].append(note)
        if not tracks["melody"]:
            warnings.append("メロディの音符が見つかりませんでした。単音がはっきりした区間を試してください。")
    midi = pretty_midi.PrettyMIDI(initial_tempo=config.bpm)
    accompaniment = np.zeros(len(y))
    for name, notes in tracks.items():
        program = INSTRUMENTS[config.instrument] if name == "chords" else (0 if name == "drums" else 80)
        instrument = pretty_midi.Instrument(program, is_drum=name == "drums", name=name)
        for note in notes:
            instrument.notes.append(pretty_midi.Note(note.velocity, note.pitch, note.start, note.end))
        if notes:
            midi.instruments.append(instrument)
        accompaniment += _render(notes, sr, len(y), program, name == "drums", config.seed)
    mixed = y * config.original_gain + accompaniment
    peak = np.max(np.abs(mixed))
    if peak > 1:
        mixed /= peak
        accompaniment /= peak
        warnings.append("音割れを防ぐため、ミックス全体の音量を調整しました。")
    return dict(mixed=mixed.astype(np.float32), accompaniment=accompaniment.astype(np.float32),
                midi=midi, notes=tracks, warnings=warnings)
