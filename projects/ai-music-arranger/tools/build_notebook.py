"""コードを内包した、Colab標準フォームの公開Notebookを作ります。"""
from pathlib import Path
import json

PROJECT = Path(__file__).resolve().parents[1]
TITLES = {
    "environment-setup": "1. 環境を準備する",
    "load-programs": "2. プログラムを読み込む",
    "prepare-source": "3. 音源を選んで読み込む",
    "generate-arrangement": "4. アレンジを生成する",
    "save-results": "5. 結果を保存する",
}


def markdown(text):
    return {"cell_type": "markdown", "metadata": {}, "source": text.strip().splitlines(keepends=True)}


def code(text, cell_id):
    header = f'#@title {TITLES[cell_id]} {{ display-mode: "form" }}\n'
    return {"cell_type": "code", "metadata": {"cellView": "form"}, "id": cell_id,
            "execution_count": None, "outputs": [], "source": (header + text).splitlines(keepends=True)}


def program_cell():
    # 3つのプログラムを内包し、1回の実行で保存・読み込みまで行う。
    # %%writefile は先頭の @title と併用できないので、通常のPythonを使う。
    entries = []
    for filename in ("audio_input.py", "music_core.py", "notebook_session.py"):
        source = (PROJECT / filename).read_text()
        literal = "r'''" + source + "'''" if "'''" not in source and source.endswith("\n") else repr(source)
        entries.append(f"    {filename!r}: {literal},\n")
    body = ("from pathlib import Path\nimport importlib\nimport importlib.util\nimport sys\n\n"
            + "module_sources = {\n" + "".join(entries) + "}\n\n"
            + '''for filename, source in module_sources.items():
    path = Path(filename)
    path.write_text(source, encoding="utf-8")
    # 同じセルを再実行したときも、今保存したコードを読みます。
    Path(importlib.util.cache_from_source(str(path))).unlink(missing_ok=True)

for filename in reversed(module_sources):
    sys.modules.pop(Path(filename).stem, None)
importlib.invalidate_caches()
for filename in module_sources:
    importlib.import_module(Path(filename).stem)

# 読み込み直したコードで、次のセルから新しく音源を扱います。
globals().pop("music_session", None)
print("プログラムの準備ができました。セル3で音源を選んでください。")
''')
    return code(body, "load-programs")


def build():
    cells = [
        markdown("""
# AI作曲アレンジ（v1.0.3）

好きな音源に伴奏やドラムを加えてみましょう。音色や音量を変えると、同じメロディでも雰囲気が変わります。

2026年度3Q（月3木3クラス）の学生2名による作品をもとに、公開用に整理・改良しました。

## 最初の操作

1. **セル1 → セル2** の左の ▶ を順に押します。CPUのままで使えます。
2. **セル3** でYouTubeのURLを貼るか、デモの曲を選んで ▶ を押します。
3. **セル4** の ▶ を押します。原曲・追加パート・ミックスの再生欄が表示されます。
4. 保存したい場合は、**セル5** で形式を選んで ▶ を押します。

セル3は、URLがあればYouTube、空欄ならデモを使います。設定を変えた後は、そのセルをもう一度実行してください。

コードは折りたたんであります。読みたいときはセルのメニューから「コードを表示」を選べます。

初回の準備や解析には数分かかる場合があります。実行マークが止まるまで待ってください。
[操作マニュアル](https://github.com/shogo-ishikawa/2026_3Q_M3Th3/blob/main/projects/ai-music-arranger/docs/manual.md)
／ [コードと改良内容](https://github.com/shogo-ishikawa/2026_3Q_M3Th3/tree/main/projects/ai-music-arranger)

音源は、自分で制作したものや利用が認められたものを使ってください。
"""),
        markdown("""
## 1. 環境を準備する

▶ を押して準備が終わるまで待ちます。初回は数分かかることがあります。
APIキーやGPUは不要です。
"""),
        code((PROJECT / "setup_environment.py").read_text(), "environment-setup"),
        markdown("""
## 2. プログラムを読み込む

▶ を1回押すと、音源の取り込み・解析・再生に使うプログラムをまとめて読み込みます。
準備ができたらセル3へ進みましょう。
"""),
        program_cell(),
        markdown("""
## 3. 音源を選んで読み込む

**YouTubeならURLを貼って ▶ を押します。** URLを空欄にすると、`demo_song` で選んだ曲を使います。
デモには「きらきら星」「歓喜の歌」もあります。まずは聴き慣れた曲で試してみてください。

PCのファイルを使うときは `input_source` を「PCの音源」に変えて実行します。
YouTube・PC音源は開始位置と長さを指定できます。たとえば開始30秒・長さ20秒なら、30〜50秒の区間を使います。

YouTubeから取れないときは、公式配布元のMP3を「PCの音源」で読み込めます。
フリー音源でも接続が制限される場合があります。
"""),
        code('''#@markdown **YouTubeを使う：** 動画のURLを貼り、左の ▶ を押してください。
youtube_url = "" #@param {type:"string"}
#@markdown 通常は「URLがあればYouTube」のままでOKです。
input_source = "URLがあればYouTube" #@param ["URLがあればYouTube", "YouTube", "PCの音源", "デモ音源"]
#@markdown **デモで試す：** URLを空欄にして曲を選びます。
demo_song = "オリジナル（ポップ）" #@param ["オリジナル（ポップ）", "オリジナル（ゆったり）", "きらきら星（冒頭）", "歓喜の歌（冒頭）"]
#@markdown **使う区間：** YouTube・PC音源の開始位置と長さです。デモは曲ごとの長さで再生します。
start_seconds = 0 #@param {type:"number"}
duration_seconds = 20 #@param {type:"number"}

from notebook_session import NotebookSession
if "music_session" not in globals() or not isinstance(music_session, NotebookSession):
    music_session = NotebookSession()
source_ready = music_session.prepare_source(input_source, youtube_url=youtube_url,
                                            start=start_seconds, duration=duration_seconds,
                                            demo_song=demo_song)
''', "prepare-source"),
        markdown("""
## 4. アレンジを生成する

最初はそのまま ▶ を押してみましょう。原曲・追加パート・ミックスを聴き比べられます。
慣れたらドラムを外したり、楽器を変えたりしてみてください。

手動でテンポやキーを変えるときは、対応する `auto_…` のチェックを外します。
テンポが変わるのは追加する伴奏だけです。原曲の速さは変わりません。
メロディ抽出は音の高さを拾う処理なので、歌声だけを分離するものではありません。
"""),
        code('''#@markdown **テンポと拍の位置**：自分で調整したい項目だけ、自動設定のチェックを外します。
auto_tempo = True #@param {type:"boolean"}
bpm = 120 #@param {type:"number"}
auto_beat = True #@param {type:"boolean"}
beat_offset = 0.0 #@param {type:"number"}
#@markdown **キー・音階・音色**：長調と短調を聴き比べるときは auto_key_scale をオフにします。
auto_key_scale = True #@param {type:"boolean"}
root = "C" #@param ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
scale = "major" #@param ["major", "natural_minor", "harmonic_minor", "dorian", "mixolydian", "pentatonic"]
instrument = "Electric Piano" #@param ["Electric Piano", "Acoustic Grand Piano", "Acoustic Guitar", "Electric Guitar", "Strings", "Synth Lead", "Music Box"]
#@markdown **加えるパート**：必要な音だけをオンにしてください。
add_chords = True #@param {type:"boolean"}
add_drums = True #@param {type:"boolean"}
add_melody = True #@param {type:"boolean"}
#@markdown **音量と揺らぎ**：original_gain を0にすると、加えた音だけを聴けます。
original_gain = 0.7 #@param {type:"slider", min:0, max:1.5, step:0.05}
chord_gain = 0.6 #@param {type:"slider", min:0, max:1.5, step:0.05}
drum_gain = 0.8 #@param {type:"slider", min:0, max:1.5, step:0.05}
melody_gain = 0.6 #@param {type:"slider", min:0, max:1.5, step:0.05}
humanise = 0.0 #@param {type:"slider", min:0, max:1, step:0.1}
seed = 42 #@param {type:"integer"}

if "music_session" not in globals():
    print("先にセル3で音源を読み込んでください。")
else:
    music_session.generate(auto_tempo=auto_tempo, bpm=bpm, auto_beat=auto_beat,
                           beat_offset=beat_offset, auto_key_scale=auto_key_scale,
                           root=root, scale=scale, instrument=instrument,
                           add_chords=add_chords, add_drums=add_drums, add_melody=add_melody,
                           original_gain=original_gain, chord_gain=chord_gain,
                           drum_gain=drum_gain, melody_gain=melody_gain,
                           humanise=humanise, seed=seed)
''', "generate-arrangement"),
        markdown("""
## 5. 結果を保存する

形式を選び、▶ を押します。「ZIP一式」にはミックス・追加パートのWAV、MIDI、設定が入ります。
WAVは音声、MIDIは音符データです。MIDIには原曲の録音は含まれません。
ランタイムを切断する前に、残したい結果を自分のPCへ保存してください。
"""),
        code('''save_format = "ZIP一式" #@param ["ZIP一式", "ミックスWAV", "MIDI", "追加パートWAV"]

if "music_session" not in globals():
    print("先にセル3で音源を読み込み、セル4で生成してください。")
else:
    music_session.download(save_format)
''', "save-results"),
        markdown("""
## こんな聴き比べもできます

- `auto_key_scale` をオフにし、Cのmajorとnatural_minorを比べます。
- `add_drums` をオフにし、リズムの印象がどう変わるかを聴きます。
- `original_gain` を0にし、追加されたパートだけを聴きます。
- `humanise` を少し上げ、演奏のタイミングや強弱を揺らしてみます。

変更したらセル4を実行して聴き比べます。気に入ったらセル5で保存しましょう。
"""),
    ]
    for i, cell in enumerate(cells):
        cell.setdefault("id", f"guide-{i:02d}")
    notebook = {"cells": cells, "nbformat": 4, "nbformat_minor": 5,
                "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
                             "language_info": {"name": "python"},
                             "colab": {"name": "ai_music_arranger.ipynb", "provenance": []}}}
    output = PROJECT / "ai_music_arranger.ipynb"
    output.write_text(json.dumps(notebook, ensure_ascii=False, indent=1) + "\n")
    print(f"Created {output.name}: {len(cells)} cells; {len(TITLES)} folded code cells")


if __name__ == "__main__":
    build()
