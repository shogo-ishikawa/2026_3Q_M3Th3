"""AI作曲アレンジの操作画面。音の処理と画面を分けて読みやすくします。"""
from __future__ import annotations

from dataclasses import asdict
import base64
from html import escape
import json
from pathlib import Path
import tempfile
import zipfile

import ipywidgets as widgets
import numpy as np
import soundfile as sf
from IPython.display import Audio, clear_output, display

from audio_input import AudioInputError, download_youtube, load_audio_file
from music_core import (
    SAMPLE_RATE, NOTE_NAMES, SCALE_DEFS, INSTRUMENTS, ArrangementConfig,
    analyse_audio, arrange, extract_melody, make_demo,
)

SCALE_LABELS = {
    "major": "長調（major）", "natural_minor": "自然短音階（natural minor）",
    "harmonic_minor": "和声的短音階（harmonic minor）", "dorian": "ドリアン",
    "mixolydian": "ミクソリディアン", "pentatonic": "長調の五音音階",
}
MAX_UPLOAD_BYTES = 50 * 1024 * 1024


class MusicArrangerApp:
    """state が現在の音源、controls が画面の入力部品です。"""

    def __init__(self, work_dir=None):
        self.work_dir = Path(work_dir) if work_dir is not None else Path.cwd() / "music_work"
        self.work_dir.mkdir(parents=True, exist_ok=True)
        self.state = {
            "audio": None, "analysis": None, "melody_notes": None,
            "result": None, "artifacts": {}, "source_revision": 0,
            "source": None,
        }
        self.busy = False
        self.controls = self._make_controls()
        self.source_output = widgets.Output()
        self.analysis_output = widgets.Output()
        self.result_output = widgets.Output()
        self.download_output = widgets.Output()
        self.status = widgets.HTML("まずは「デモ音源を用意」を押すと、音源なしで試せます。")
        self.source_status = widgets.HTML("現在の音源：まだ読み込んでいません。")
        self.result_status = widgets.HTML("生成後に、原曲・追加パート・ミックスを聴き比べられます。")
        self._connect_events()
        self.widget = self._make_layout()
        self.widget._music_app = self
        self.widget._music_state = self.state
        self.widget._music_controls = self.controls
        self._update_enabled()

    def _make_controls(self):
        style = {"description_width": "130px"}
        wide = widgets.Layout(width="min(100%, 520px)")
        c = {
            "url": widgets.Text(description="YouTube URL", placeholder="https://www.youtube.com/watch?v=…", style=style, layout=wide),
            "start": widgets.BoundedFloatText(value=0, min=0, max=86400, step=1, description="開始位置（秒）", style=style),
            "duration": widgets.BoundedFloatText(value=20, min=3, max=60, step=1, description="使う長さ（秒）", style=style),
            "youtube": widgets.Button(description="YouTubeから取得", button_style="primary", layout=widgets.Layout(width="200px")),
            "upload": widgets.FileUpload(accept=".wav,.mp3,.m4a,.flac,.ogg,.aac,.webm", multiple=False, description="PCの音源を選択", layout=widgets.Layout(width="200px")),
            "demo": widgets.Button(description="デモ音源を用意", button_style="info", layout=widgets.Layout(width="200px")),
            "analyse": widgets.Button(description="音源を解析", button_style="primary", layout=widgets.Layout(width="200px")),
            "root": widgets.Dropdown(options=NOTE_NAMES, value="C", description="キー（主音）", style=style),
            "scale": widgets.Dropdown(options=[(SCALE_LABELS.get(x, x), x) for x in SCALE_DEFS], value="major", description="スケール", style=style),
            "bpm": widgets.FloatSlider(value=120, min=40, max=220, step=0.1, description="伴奏のBPM", continuous_update=False, style=style, layout=wide),
            "beat_offset": widgets.FloatSlider(value=0, min=0, max=4, step=0.01, description="伴奏の開始（秒）", continuous_update=False, style=style, layout=wide),
            "instrument": widgets.Dropdown(options=list(INSTRUMENTS), value="Electric Piano", description="伴奏の音色", style=style),
            "add_chords": widgets.Checkbox(value=True, description="コード伴奏を追加", indent=False),
            "add_drums": widgets.Checkbox(value=True, description="ドラムを追加", indent=False),
            "add_melody": widgets.Checkbox(value=True, description="抽出メロディを追加", indent=False),
            "original_gain": widgets.FloatSlider(value=0.7, min=0, max=1.5, step=0.05, description="原曲の音量", continuous_update=False, style=style, layout=wide),
            "chord_gain": widgets.FloatSlider(value=0.6, min=0, max=1.5, step=0.05, description="伴奏の音量", continuous_update=False, style=style, layout=wide),
            "drum_gain": widgets.FloatSlider(value=0.8, min=0, max=1.5, step=0.05, description="ドラムの音量", continuous_update=False, style=style, layout=wide),
            "melody_gain": widgets.FloatSlider(value=0.6, min=0, max=1.5, step=0.05, description="メロディの音量", continuous_update=False, style=style, layout=wide),
            "humanise": widgets.FloatSlider(value=0, min=0, max=1, step=0.1, description="ゆらぎの強さ", continuous_update=False, style=style, layout=wide),
            "seed": widgets.BoundedIntText(value=42, min=0, max=2147483647, description="乱数の種", style=style),
            "generate": widgets.Button(description="アレンジを生成", button_style="success", layout=widgets.Layout(width="200px")),
            "download_wav": widgets.Button(description="ミックスWAVを保存", layout=widgets.Layout(width="200px")),
            "download_midi": widgets.Button(description="MIDIを保存", layout=widgets.Layout(width="180px")),
            "download_zip": widgets.Button(description="結果をZIPで保存", button_style="info", layout=widgets.Layout(width="200px")),
        }
        return c

    @staticmethod
    def _panel(title, children):
        return widgets.VBox(
            [widgets.HTML(f"<h3 style='color:#164e63;margin:4px 0 12px'>{title}</h3>"), *children],
            layout=widgets.Layout(border="1px solid #cbd5e1", padding="18px", margin="12px 0", width="100%"),
        )

    def _make_layout(self):
        c = self.controls
        source_tabs = widgets.Tab(children=[
            widgets.VBox([c["url"], c["youtube"], widgets.HTML("動画の指定区間を取得します。取得には時間がかかる場合があります。")]),
            widgets.VBox([c["upload"], widgets.HTML("WAV・MP3など、50 MiB以下の音源を1つ選びます。選ぶと読み込みが始まります。")]),
            widgets.VBox([c["demo"], widgets.HTML("音階と拍が分かる12秒のオリジナル音源です。開始位置・長さの指定は使いません。")]),
        ])
        for i, title in enumerate(["YouTube", "PCの音源", "デモ"]):
            source_tabs.set_title(i, title)
        source_tabs.selected_index = 2
        return widgets.VBox([
            widgets.HTML("<div style='background:#123b4a;color:white;padding:22px;border-radius:12px'><h2 style='margin:0'>AI作曲アレンジ</h2><p style='margin-bottom:0'>音源を読み込み、伴奏とリズムを加えて聴き比べる音楽実験室</p></div>"),
            widgets.HTML("<p>最初は <b>デモ → 音源を解析 → アレンジを生成</b> の順で試してください。<br>自分で制作した音源や、利用許可のある音源を使いましょう。</p>"),
            self._panel("1　音源を用意する", [
                widgets.HBox([c["start"], c["duration"]], layout=widgets.Layout(flex_flow="row wrap")),
                widgets.HTML("YouTube・PC音源は指定した区間だけを使います。入力欄の変更は、次の読み込み時に反映されます。"),
                source_tabs, self.status, self.source_status, self.source_output,
            ]),
            self._panel("2　音源の特徴を調べる", [
                widgets.HTML("テンポ・キー・伴奏の開始位置を推定します。結果は目安です。聴いて違うと感じたら、次の設定で調整してください。"),
                c["analyse"], self.analysis_output,
            ]),
            self._panel("3　アレンジを設定する", [
                widgets.HBox([c["root"], c["scale"]], layout=widgets.Layout(flex_flow="row wrap")),
                c["instrument"], c["bpm"], c["beat_offset"],
                widgets.HTML("BPMと開始位置は<b>追加する伴奏・ドラム</b>の設定です。原曲の速さは変わりません。拍がずれる場合は短い区間で試してください。"),
                widgets.HBox([c["add_chords"], c["add_drums"], c["add_melody"]], layout=widgets.Layout(flex_flow="row wrap")),
                c["original_gain"], c["chord_gain"], c["drum_gain"], c["melody_gain"],
                c["humanise"], c["seed"],
                widgets.HTML("ゆらぎの強さは0で一定、1で最大約18ミリ秒の時刻のずれと音の強弱を加えます。同じ音源・設定・乱数の種で比較できます。"),
                c["generate"], self.result_status,
                widgets.HTML("<small>pYINは1本の音高の流れを推定します。歌声だけを分離する機能ではありません。伴奏は音階とリズムの規則で生成します。内蔵音源の音色は楽器を簡略化したものです。</small>"),
            ]),
            self._panel("4　聴き比べて保存する", [
                self.result_output,
                widgets.HBox([c["download_wav"], c["download_midi"], c["download_zip"]], layout=widgets.Layout(flex_flow="row wrap")),
                widgets.HTML("WAVは聴ける音声、MIDIは追加パートの音符です。MIDIには原曲の録音は入りません。ZIPにはミックス・追加パートのWAV、MIDI、設定をまとめます。ミックスには原曲の音が含まれます。"),
                self.download_output,
            ]),
        ], layout=widgets.Layout(width="100%", max_width="1120px"))

    def _connect_events(self):
        c = self.controls
        c["youtube"].on_click(self._on_youtube)
        c["demo"].on_click(self._on_demo)
        c["upload"].observe(self._on_upload, names="value")
        c["analyse"].on_click(self._on_analyse)
        c["generate"].on_click(self._on_generate)
        for name in asdict(ArrangementConfig()):
            c[name].observe(self._on_config_changed, names="value")
        for name, key in [("download_wav", "mixed.wav"), ("download_midi", "arrangement.mid"), ("download_zip", "arrangement_results.zip")]:
            c[name].on_click(lambda _, filename=key: self._on_download(filename))

    def _update_enabled(self):
        for control in self.controls.values():
            control.disabled = self.busy
        ready = self.state["audio"] is not None
        self.controls["analyse"].disabled = self.busy or not ready
        self.controls["generate"].disabled = self.busy or self.state["analysis"] is None
        for name in ("download_wav", "download_midi", "download_zip"):
            self.controls[name].disabled = self.busy or not self.state["artifacts"]

    def _message(self, text, error=False):
        colour = "#991b1b" if error else "#155e75"
        self.status.value = f"<p role='status' style='color:{colour}'>{escape(text)}</p>"

    def _invalidate_result(self):
        self.state["result"] = None
        self.state["artifacts"] = {}
        self.result_output.clear_output()
        self.download_output.clear_output()
        self.result_status.value = "設定を変更したら「アレンジを生成」を押してください。保存は生成後にできます。"
        self._update_enabled()

    def _on_config_changed(self, change):
        self._invalidate_result()

    def _run(self, action, message):
        if self.busy:
            return
        self.busy = True
        self._update_enabled()
        self._message(message)
        try:
            action()
        except (AudioInputError, ValueError) as exc:
            # audio_inputのエラーは、URLやローカルパスを含まない案内文です。
            note = " 現在の音源はそのままです。" if self.state["audio"] is not None else ""
            self._message(str(exc) + note, error=True)
        except Exception:
            self._message("処理を完了できませんでした。準備セルを実行し直し、短いデモ音源でお試しください。現在の音源は置き換えていません。", error=True)
        finally:
            self.busy = False
            self._update_enabled()

    def _accept_audio(self, audio, kind, start=0):
        audio = np.asarray(audio, dtype=np.float32)
        if audio.ndim != 1 or len(audio) == 0 or not np.all(np.isfinite(audio)):
            raise ValueError("音声を読み込めませんでした。別の音源をお試しください。")
        peak = float(np.max(np.abs(audio)))
        if peak > 1:
            audio = audio / peak
        self._invalidate_result()
        self.state.update(audio=audio, analysis=None, melody_notes=None,
                          source_revision=self.state["source_revision"] + 1,
                          source={"kind": kind, "start_seconds": float(start), "duration_seconds": round(len(audio) / SAMPLE_RATE, 3)})
        self.analysis_output.clear_output()
        self.source_status.value = f"<b>現在の音源：{escape(kind)} / {len(audio) / SAMPLE_RATE:.1f}秒</b>（読み込みごとに解析・生成結果を更新します）"
        with self.source_output:
            clear_output(wait=True)
            display(Audio(audio, rate=SAMPLE_RATE, normalize=False))
        self._message("音源の準備ができました。次に「音源を解析」を押してください。")

    def _on_demo(self, _=None):
        self._run(lambda: self._accept_audio(make_demo(duration=12, sr=SAMPLE_RATE), "デモ"), "デモ音源を作っています…")

    def _on_youtube(self, _=None):
        def prepare():
            self._invalidate_result()
            c = self.controls
            # 一時ファイルを使い、取得に失敗しても現在の音源を保ちます。
            with tempfile.TemporaryDirectory(dir=self.work_dir) as temp_dir:
                path = download_youtube(c["url"].value, Path(temp_dir) / "input.wav", start=c["start"].value, duration=c["duration"].value)
                audio, sr = sf.read(path, dtype="float32")
                if sr != SAMPLE_RATE:
                    raise ValueError("音声の形式を確認できませんでした。音源を再取得してください。")
                self._accept_audio(audio, "YouTube", c["start"].value)
        self._run(prepare, "YouTubeの指定区間を取得しています。しばらくお待ちください…")

    def _on_upload(self, change):
        if not change.get("new"):
            return
        def prepare():
            self._invalidate_result()
            value = change["new"]
            item = next(iter(value.values())) if isinstance(value, dict) else value[0]
            content = bytes(item["content"])
            if not content or len(content) > MAX_UPLOAD_BYTES:
                raise ValueError("音源は50 MiB以下の空でないファイルを選んでください。")
            suffix = Path(item.get("name", "audio.wav")).suffix.lower()
            if suffix not in {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".aac", ".webm"}:
                raise ValueError("WAV・MP3など、対応する音声ファイルを選んでください。")
            with tempfile.TemporaryDirectory(dir=self.work_dir) as temp_dir:
                path = Path(temp_dir) / ("uploaded" + suffix)
                path.write_bytes(content)
                audio = load_audio_file(path, start=self.controls["start"].value, duration=self.controls["duration"].value, sr=SAMPLE_RATE)
                self._accept_audio(audio, "アップロード", self.controls["start"].value)
        self._run(prepare, "選んだ音源の指定区間を読み込んでいます…")
        # 同じファイルを再選択できるよう、部品内のバイト列も解放します。
        self.controls["upload"].value = ()

    def _on_analyse(self, _=None):
        if self.state["audio"] is None:
            self._message("先に音源を用意してください。", error=True)
            return
        def analyse():
            self._invalidate_result()
            result = analyse_audio(self.state["audio"], SAMPLE_RATE)
            self.state["analysis"] = result
            c = self.controls
            for name, key in [("bpm", "bpm"), ("root", "key"), ("scale", "scale"), ("beat_offset", "beat_offset")]:
                value = result[key]
                if name in {"bpm", "beat_offset"}:
                    value = min(c[name].max, max(c[name].min, float(value)))
                c[name].value = value
            with self.analysis_output:
                clear_output(wait=True)
                display(widgets.HTML(f"<p><b>推定：BPM {c['bpm'].value:.1f} / {escape(str(c['root'].value))} / {escape(SCALE_LABELS.get(c['scale'].value, c['scale'].value))}</b><br>伴奏の開始：{c['beat_offset'].value:.2f}秒<br>{escape(str(result.get('note', '')))}</p>"))
            self._message("解析が終わりました。設定を選び「アレンジを生成」を押してください。")
        self._run(analyse, "テンポ・キー・拍の位置を解析しています。初回は少し時間がかかります…")

    def _config(self):
        return ArrangementConfig(**{name: self.controls[name].value for name in asdict(ArrangementConfig())})

    def _on_generate(self, _=None):
        if self.state["audio"] is None or self.state["analysis"] is None:
            self._message("先に音源を用意して解析してください。", error=True)
            return
        def generate():
            self._invalidate_result()
            config = self._config()
            melody = self.state["melody_notes"]
            if config.add_melody and melody is None:
                self._message("原曲の音高をpYINで推定しています。初回は時間がかかる場合があります…")
                melody = extract_melody(self.state["audio"], SAMPLE_RATE)
                self.state["melody_notes"] = melody
            self._message("伴奏・ドラムを作り、音声と保存ファイルを用意しています…")
            result = arrange(self.state["audio"], SAMPLE_RATE, config, melody_notes=melody if config.add_melody else [])
            artifacts = self._write_artifacts(result, config)
            self.state["result"] = result
            self.state["artifacts"] = artifacts
            self._render_result(result)
            self.result_status.value = "<b>生成できました。</b> 原曲と聴き比べ、気になる設定を1つずつ変えて再生成してみましょう。"
            self._message("生成が終わりました。「4 聴き比べて保存する」で再生・保存できます。")
        self._run(generate, "アレンジの生成を始めます…")

    def _write_artifacts(self, result, config):
        # ファイル名やURLを設定ファイルへ記録しません。
        target = Path(tempfile.mkdtemp(prefix="result_", dir=self.work_dir))
        paths = {name: target / name for name in ("mixed.wav", "accompaniment.wav", "arrangement.mid", "settings.json")}
        sf.write(paths["mixed.wav"], result["mixed"], SAMPLE_RATE, subtype="PCM_16")
        sf.write(paths["accompaniment.wav"], result["accompaniment"], SAMPLE_RATE, subtype="PCM_16")
        result["midi"].write(str(paths["arrangement.mid"]))
        settings = {"version": "1.0.0", "source": self.state["source"], "arrangement": asdict(config), "sample_rate": SAMPLE_RATE,
                    "note": "BPM・開始位置は追加伴奏の設定です。原曲の速度は変えません。"}
        paths["settings.json"].write_text(json.dumps(settings, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        archive = target / "arrangement_results.zip"
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as z:
            for name, path in paths.items():
                z.write(path, arcname=name)
            z.writestr("README.txt", "AI作曲アレンジ\n\nmixed.wav：原曲と追加パートを重ねた音声\naccompaniment.wav：追加パートだけの音声\narrangement.mid：追加パートの音符（原曲の録音は含みません）\nsettings.json：今回の設定\n\nミックスには入力音源の音が含まれます。公開・共有の際は音源の利用条件を確認してください。\n")
        paths["arrangement_results.zip"] = archive
        return paths

    def _render_result(self, result):
        with self.result_output:
            clear_output(wait=True)
            for title, audio in [("原曲（使用した区間）", self.state["audio"]), ("追加パートだけ", result["accompaniment"]), ("原曲と追加パートのミックス", result["mixed"])]:
                display(widgets.HTML(f"<h4>{title}</h4>"))
                display(Audio(audio, rate=SAMPLE_RATE, normalize=False))
            for warning in result.get("warnings", []):
                display(widgets.HTML(f"<p style='color:#92400e'>{escape(str(warning))}</p>"))
            self._plot_notes(result)

    @staticmethod
    def _plot_notes(result):
        try:
            import matplotlib.pyplot as plt
        except ImportError:
            return
        fig, ax = plt.subplots(figsize=(10, 2.8))
        colours = {"chords": "#0f766e", "melody": "#2563eb"}
        labels = {"chords": "Chords", "melody": "Extracted melody"}
        for name, colour in colours.items():
            notes = result.get("notes", {}).get(name, [])
            for i, note in enumerate(notes):
                ax.plot([note.start, note.end], [note.pitch, note.pitch], color=colour, linewidth=3, alpha=0.7, label=labels[name] if i == 0 else None)
        ax.set(xlabel="Time (s)", ylabel="MIDI note", title="Added notes (drums omitted)")
        ax.grid(alpha=0.2)
        if ax.get_legend_handles_labels()[0]:
            ax.legend(loc="upper right")
        fig.tight_layout()
        display(widgets.HTML("<p>横軸は時間、縦軸は音の高さです。青は抽出メロディ、緑はコード伴奏を示します。</p>"))
        display(fig)
        plt.close(fig)

    def _on_download(self, filename):
        path = self.state["artifacts"].get(filename)
        if path is None or not Path(path).is_file():
            self._message("設定を確認し、先に「アレンジを生成」を押してください。", error=True)
            return
        with self.download_output:
            clear_output(wait=True)
            try:
                from google.colab import files
            except ImportError:
                # Jupyterの公開フォルダとPythonの作業場所が違っていても
                # 保存できるよう、最大60秒分の生成ファイルをリンクに埋め込みます。
                encoded = base64.b64encode(Path(path).read_bytes()).decode("ascii")
                safe_name = escape(filename, quote=True)
                display(widgets.HTML(
                    f'<a download="{safe_name}" href="data:application/octet-stream;base64,{encoded}">'
                    f'{safe_name} をダウンロード</a>'
                ))
            else:
                files.download(str(path))


def launch_app(work_dir=None):
    """Notebookから呼び出し、表示するVBoxを返します。"""
    return MusicArrangerApp(work_dir=work_dir).widget
