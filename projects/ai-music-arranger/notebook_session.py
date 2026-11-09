"""Colab標準フォームから呼ぶ処理。ウィジェットの描画を必要としません。"""
from dataclasses import asdict
import base64
from html import escape
import json
from pathlib import Path
import tempfile
import zipfile

import numpy as np
import soundfile as sf
from IPython.display import Audio, HTML, display

from audio_input import AudioInputError, download_youtube, load_audio_file
from music_core import (
    SAMPLE_RATE, ArrangementConfig, analyse_audio, arrange, extract_melody, make_demo,
    DEMO_NAMES, get_demo_info,
)

VERSION = "1.0.3"
MAX_UPLOAD_BYTES = 50 * 1024 * 1024


class NotebookSession:
    """セル3で音源を用意し、セル4で生成、セル5で保存します。"""

    def __init__(self, work_dir=None):
        self.work_dir = Path(work_dir) if work_dir is not None else Path.cwd() / "music_work"
        self.work_dir.mkdir(parents=True, exist_ok=True)
        self.state = dict(audio=None, analysis=None, melody_notes=None, result=None,
                          artifacts={}, source_revision=0, source=None, config=None)

    def _invalidate_result(self):
        self.state.update(result=None, artifacts={}, config=None)

    @staticmethod
    def _read_uploaded(uploaded, temporary, start, duration):
        if not uploaded:
            raise AudioInputError("音源が選択されていません。セル3を実行し直して、ファイルを選んでください。")
        if len(uploaded) != 1:
            raise AudioInputError("音声ファイルを1つだけ選んでください。")
        filename, content = next(iter(uploaded.items()))
        suffix = Path(filename).suffix.lower()
        if suffix not in {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".aac", ".webm"}:
            raise AudioInputError("WAV・MP3などの音声ファイルを選んでください。")
        if not content or len(content) > MAX_UPLOAD_BYTES:
            raise AudioInputError("音源は50 MiB以下の空でないファイルを選んでください。")
        path = Path(temporary) / ("uploaded" + suffix)
        path.write_bytes(content)
        return load_audio_file(path, start=start, duration=duration, sr=SAMPLE_RATE)

    def prepare_source(self, kind="URLがあればYouTube", youtube_url="", start=0, duration=20,
                       uploaded=None, demo_song=DEMO_NAMES[0]):
        """取得と解析が両方成功した場合にだけ、現在の音源を置き換えます。"""
        self._invalidate_result()
        print("音源を用意しています。少しお待ちください。")
        try:
            if kind == "URLがあればYouTube":
                if not isinstance(youtube_url, str):
                    raise AudioInputError("YouTubeのURLを文字で入力してください。")
                kind = "YouTube" if youtube_url.strip() else "デモ音源"
            demo_info = None
            if kind == "デモ音源":
                demo_info = get_demo_info(demo_song)
                if isinstance(youtube_url, str) and youtube_url.strip():
                    print("「デモ音源」が選ばれています。YouTubeを使うときは音源の選び方を変更してください。")
                print(f"今回のデモ：{demo_info['title']}")
                audio = make_demo(duration=demo_info["duration_seconds"], sr=SAMPLE_RATE,
                                  demo_name=demo_song)
                source_start = 0
            elif kind == "YouTube":
                print(f"YouTubeの指定区間（{start}秒から{duration}秒分）を取得します。")
                with tempfile.TemporaryDirectory(dir=self.work_dir) as temporary:
                    path = download_youtube(youtube_url, Path(temporary) / "input.wav",
                                            start=start, duration=duration)
                    audio, rate = sf.read(path, dtype="float32")
                    if rate != SAMPLE_RATE:
                        raise AudioInputError("音源の形式を確認できません。セル3で取得し直してください。")
                source_start = float(start)
            elif kind == "PCの音源":
                if uploaded is None:
                    try:
                        from google.colab import files
                    except ImportError:
                        raise AudioInputError("PCのファイル選択はColabで利用してください。まずデモ音源でも試せます。") from None
                    uploaded = files.upload()
                with tempfile.TemporaryDirectory(dir=self.work_dir) as temporary:
                    audio = self._read_uploaded(uploaded, temporary, start, duration)
                source_start = float(start)
            else:
                raise AudioInputError("音源の種類をデモ音源・YouTube・PCの音源から選んでください。")
            audio = np.asarray(audio, dtype=np.float32)
            if audio.ndim != 1 or len(audio) == 0 or not np.all(np.isfinite(audio)):
                raise AudioInputError("音源を読み込めません。別の音源か短い区間で試してください。")
            peak = float(np.max(np.abs(audio)))
            if peak > 1:
                audio = audio / peak
            print("テンポとキーを解析しています。初回は少し時間がかかります。")
            analysis = analyse_audio(audio, SAMPLE_RATE)
            if demo_info is not None:
                # デモは演奏条件が分かるため、伴奏も同じテンポ・調にそろえます。
                analysis.update(bpm=demo_info["bpm"], key=demo_info["key"],
                                scale=demo_info["scale"], beat_offset=0.0,
                                note="デモのテンポとキーに合わせています。")
        except (AudioInputError, ValueError) as error:
            print("準備できませんでした：" + str(error))
            if self.state["audio"] is not None:
                print("前の音源は保持しています。保存結果は無効にしたため、必要ならセル4で生成し直してください。")
            return False
        except Exception:
            print("音源の準備または解析を完了できませんでした。準備セルを実行し直し、デモ音源で試してください。")
            if self.state["audio"] is not None:
                print("前の音源は保持しています。必要ならセル4で生成し直してください。")
            return False
        self.state.update(audio=audio, analysis=analysis, melody_notes=None,
                          source_revision=self.state["source_revision"] + 1,
                          source=dict(kind=kind, start_seconds=source_start,
                                      duration_seconds=round(len(audio) / SAMPLE_RATE, 3)))
        if demo_info is not None:
            self.state["source"]["demo_song"] = demo_song
        source_label = demo_info["title"] if demo_info else kind
        analysis_label = "テンポ" if demo_info else "推定テンポ"
        display(HTML(
            f"<h3>音源の準備ができました</h3><p>{escape(source_label)} / {len(audio) / SAMPLE_RATE:.1f}秒<br>"
            f"{analysis_label}：{analysis['bpm']:.1f} BPM / キー：{escape(analysis['key'])} / "
            f"スケール：{escape(analysis['scale'])}<br>{escape(analysis.get('note', ''))}</p>"
        ))
        display(Audio(audio, rate=SAMPLE_RATE, normalize=False))
        print("次にセル4の設定を選び、左の▶を押してアレンジを生成してください。")
        return True

    def generate(self, *, auto_tempo=True, bpm=120, auto_key_scale=True, root="C", scale="major",
                 auto_beat=True, beat_offset=0, instrument="Electric Piano", add_chords=True,
                 add_drums=True, add_melody=True, original_gain=.7, chord_gain=.6,
                 drum_gain=.8, melody_gain=.6, humanise=0, seed=42):
        """フォームの値で生成し、聴き比べ用音声と保存ファイルを用意します。"""
        self._invalidate_result()
        if self.state["audio"] is None or self.state["analysis"] is None:
            print("先にセル3で音源を用意してください。")
            return False
        analysis = self.state["analysis"]
        config = ArrangementConfig(
            bpm=analysis["bpm"] if auto_tempo else bpm,
            root=analysis["key"] if auto_key_scale else root,
            scale=analysis["scale"] if auto_key_scale else scale,
            beat_offset=analysis["beat_offset"] if auto_beat else beat_offset,
            instrument=instrument, add_chords=add_chords, add_drums=add_drums,
            add_melody=add_melody, original_gain=original_gain, chord_gain=chord_gain,
            drum_gain=drum_gain, melody_gain=melody_gain, humanise=humanise, seed=seed,
        )
        try:
            melody = self.state["melody_notes"]
            if add_melody and melody_gain > 0 and melody is None:
                print("メロディの音の高さを推定しています。初回は時間がかかる場合があります。")
                melody = extract_melody(self.state["audio"], SAMPLE_RATE)
                self.state["melody_notes"] = melody
            print("伴奏・ドラムを生成し、保存ファイルを作っています。")
            result = arrange(self.state["audio"], SAMPLE_RATE, config,
                             melody_notes=melody if add_melody else [])
            artifacts = self._write_artifacts(result, config)
        except ValueError as error:
            print("生成できませんでした：" + str(error))
            return False
        except Exception:
            print("生成を完了できませんでした。セル1から順に実行し直し、短いデモ音源で試してください。")
            return False
        self.state.update(result=result, artifacts=artifacts, config=config)
        self._render_result(result)
        print("生成が完了しました。設定を変えた後はセル4を再実行し、セル5で結果を保存してください。")
        return True

    def _write_artifacts(self, result, config):
        target = Path(tempfile.mkdtemp(prefix="result_", dir=self.work_dir))
        paths = {name: target / name for name in
                 ("mixed.wav", "accompaniment.wav", "arrangement.mid", "settings.json")}
        sf.write(paths["mixed.wav"], result["mixed"], SAMPLE_RATE, subtype="PCM_16")
        sf.write(paths["accompaniment.wav"], result["accompaniment"], SAMPLE_RATE, subtype="PCM_16")
        result["midi"].write(str(paths["arrangement.mid"]))
        settings = dict(version=VERSION, source=self.state["source"], arrangement=asdict(config),
                        sample_rate=SAMPLE_RATE,
                        note="BPM・開始位置は追加伴奏の設定です。原曲の速度は変えません。")
        paths["settings.json"].write_text(json.dumps(settings, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        archive = target / "arrangement_results.zip"
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zipped:
            for name, path in paths.items():
                zipped.write(path, arcname=name)
            zipped.writestr("README.txt", "AI作曲アレンジ\n\nmixed.wav：原曲と追加パートのミックス\naccompaniment.wav：追加パートだけ\narrangement.mid：追加パートの音符\nsettings.json：今回の設定\n\nMIDIには原曲の録音を含みません。ミックスの公開・共有は音源の利用条件を確認してください。\n")
        paths["arrangement_results.zip"] = archive
        return paths

    def _render_result(self, result):
        for title, audio in [("原曲（使用した区間）", self.state["audio"]),
                             ("追加パートだけ", result["accompaniment"]),
                             ("原曲と追加パートのミックス", result["mixed"])]:
            display(HTML(f"<h3>{title}</h3>"))
            display(Audio(audio, rate=SAMPLE_RATE, normalize=False))
        for warning in result.get("warnings", []):
            print(warning)
        self._plot_notes(result)

    @staticmethod
    def _plot_notes(result):
        import matplotlib.pyplot as plt
        fig, ax = plt.subplots(figsize=(10, 2.8))
        for name, colour, label in [("chords", "#0f766e", "Chords"),
                                    ("melody", "#2563eb", "Extracted melody")]:
            for i, note in enumerate(result.get("notes", {}).get(name, [])):
                ax.plot([note.start, note.end], [note.pitch, note.pitch], color=colour,
                        linewidth=3, alpha=.7, label=label if i == 0 else None)
        ax.set(xlabel="Time (s)", ylabel="MIDI note", title="Added notes (drums omitted)")
        ax.grid(alpha=.2)
        if ax.get_legend_handles_labels()[0]:
            ax.legend(loc="upper right")
        fig.tight_layout()
        display(HTML("<p>横軸は時間、縦軸は音の高さです。青は抽出メロディ、緑はコード伴奏です。</p>"))
        display(fig)
        plt.close(fig)

    def download(self, kind="ZIP一式"):
        """Colabではダウンロード、ローカルでは表示場所に依存しないリンクを作ります。"""
        filenames = {"ZIP一式": "arrangement_results.zip", "ミックスWAV": "mixed.wav",
                     "MIDI": "arrangement.mid", "追加パートWAV": "accompaniment.wav"}
        filename = filenames.get(kind)
        if filename is None:
            print("保存する形式をZIP一式・ミックスWAV・MIDI・追加パートWAVから選んでください。")
            return False
        path = self.state["artifacts"].get(filename)
        if path is None or not Path(path).is_file():
            print("保存できる結果がありません。先にセル4を実行して生成してください。")
            return False
        try:
            try:
                from google.colab import files
            except ImportError:
                encoded = base64.b64encode(Path(path).read_bytes()).decode("ascii")
                name = escape(filename, quote=True)
                display(HTML(f'<a download="{name}" href="data:application/octet-stream;base64,{encoded}">{name} をダウンロード</a>'))
            else:
                files.download(str(path))
        except Exception:
            print("ダウンロードを開始できませんでした。ブラウザのダウンロード設定を確認し、セル5を再実行してください。")
            return False
        return True
