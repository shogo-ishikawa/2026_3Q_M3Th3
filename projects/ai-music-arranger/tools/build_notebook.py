"""コードを内包した、Colab標準フォームの公開Notebookを作ります。"""
from pathlib import Path
import json

PROJECT = Path(__file__).resolve().parents[1]
TITLES = {
    "environment-setup": "1. 環境を準備する",
    "audio-input": "2-a. 音源の取り込みを読み込む",
    "music-core": "2-b. 解析と伴奏生成を読み込む",
    "notebook-session": "2-c. 再生と保存を読み込む",
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


def module_cell(filename, cell_id):
    source = (PROJECT / filename).read_text()
    # %%writefile は先頭の @title と併用できないので、Pythonで保存する。
    literal = "r'''" + source + "'''" if "'''" not in source and source.endswith("\n") else repr(source)
    body = ("from pathlib import Path\nmodule_code = " + literal + "\n"
            + f'Path("{filename}").write_text(module_code, encoding="utf-8")\n'
            + f'print("{TITLES[cell_id]}：完了")\n')
    return code(body, cell_id)


def build():
    cells = [
        markdown("""
# AI作曲アレンジ（v1.0.1）

**YouTube・PCの音源・デモ音源から、コード伴奏とドラムを加えて聴き比べる教材です。**

2026年度3Q（月3木3クラス）の学生2名による作品をもとに、公開用に整理・改良しました。
音源を解析し、設定を変えながら音作りを試せる、元の作品の工夫を引き継いでいます。

## 最初の操作

1. **1 → 2-a → 2-b → 2-c** の左の ▶ を順に押します。CPUのままで使えます。
2. **セル3** の `input_source` で「デモ音源」を選び、セル3の ▶ を押します。
3. **セル4** の ▶ を押します。原曲・追加パート・ミックスの再生欄が表示されます。
4. 保存したい場合は、**セル5** で形式を選んで ▶ を押します。

YouTubeを使う場合は、セル3の `input_source` を「YouTube」に変え、`youtube_url` へURLを入力します。
**各セルの入力欄を変更した後は、そのセルの ▶ を押して反映してください。**

コードは `@title` で折りたたんでいます。コードを読みたい場合は、セルのメニューから
「コードを表示」を選べます。フォームの入力欄と、実行後の再生欄は表示したまま使います。

初回の準備や解析には数分かかる場合があります。実行マークが止まるまで待ってください。
[操作マニュアル](https://github.com/shogo-ishikawa/2026_3Q_M3Th3/blob/main/projects/ai-music-arranger/docs/manual.md)
／ [コードと改良内容](https://github.com/shogo-ishikawa/2026_3Q_M3Th3/tree/main/projects/ai-music-arranger)

### 結果の読み方

- pYINは音の高さを推定します。ボーカルと伴奏を分離する処理ではありません。
- キーとテンポの推定は目安です。原曲を聴きながら手動で調整できます。
- 伴奏は音階とリズムの規則で生成します。LSTMや大規模な音楽生成AIは使いません。
- BPMを変更すると、追加する伴奏の速さが変わります。原曲の速さは変わりません。
- 音色は内蔵の簡易音源です。MIDIは再生ソフトによって響きが変わります。

音源は、自分で制作したものや利用が認められたものを使ってください。
"""),
        markdown("""
## 1. 環境を準備する

▶ を押すと、音声解析ライブラリ、FFmpeg、YouTube取得用の実行環境を準備します。
ランタイムに接続するたびに1回実行してください。APIキーやGPUは不要です。
"""),
        code((PROJECT / "setup_environment.py").read_text(), "environment-setup"),
        markdown("""
## 2. プログラムを読み込む

**2-a → 2-b → 2-c** の3つを順に実行します。各セルに「完了」と出たら次へ進みます。
Notebookに全コードが入っているので、別のPythonファイルをダウンロードする必要はありません。

### 2-a. 音源の取り込み
"""),
        module_cell("audio_input.py", "audio-input"),
        markdown("### 2-b. 音源の解析と伴奏生成"),
        module_cell("music_core.py", "music-core"),
        markdown("### 2-c. 再生と保存"),
        module_cell("notebook_session.py", "notebook-session"),
        markdown("""
## 3. 音源を選んで読み込む

下のフォームで選び、このセルの ▶ を押します。初めて使う場合は「デモ音源」のままで試せます。

| 入力欄 | 指定する内容 |
| --- | --- |
| `input_source` | デモ音源、YouTube、PCの音源から選択 |
| `youtube_url` | YouTubeを選んだときの動画URL |
| `start_seconds` | YouTube・PC音源の何秒目から使うか |
| `duration_seconds` | 取り込む長さ。3〜60秒 |

デモは12秒固定です。PCの音源を選ぶと、実行後にファイル選択が表示されます。
音源が読み込まれると原曲の再生欄と、推定BPM・キーが表示されます。
"""),
        code('''#@markdown 音源の種類を選んでください。まずは「デモ音源」で試せます。
input_source = "デモ音源" #@param ["デモ音源", "YouTube", "PCの音源"]
youtube_url = "" #@param {type:"string"}
#@markdown YouTube・PC音源に使う区間です。デモでは使用しません。
start_seconds = 0 #@param {type:"number"}
duration_seconds = 20 #@param {type:"number"}

from notebook_session import NotebookSession
if "music_session" not in globals() or not isinstance(music_session, NotebookSession):
    music_session = NotebookSession()
source_ready = music_session.prepare_source(input_source, youtube_url=youtube_url,
                                            start=start_seconds, duration=duration_seconds)
''', "prepare-source"),
        markdown("""
## 4. アレンジを生成する

最初は下の初期設定のまま ▶ を押してください。再生欄と音符の図が表示されます。
`auto_tempo`・`auto_key_scale`・`auto_beat` がオンの間は、セル3の推定値を使います。
手動で値を指定したい項目だけ、対応するチェックを外してください。

音量を0にすると、そのパートは聴こえなくなります。`humanise` は0〜1で揺らぎの強さを指定します。
**設定を変えたら、このセルを再実行して聴き比べます。** セル5は最後に生成した結果を保存します。
"""),
        code('''#@markdown **テンポと拍の位置**：自動をオンにすると、手動入力値ではなく推定値を使います。
auto_tempo = True #@param {type:"boolean"}
bpm = 120 #@param {type:"number"}
auto_beat = True #@param {type:"boolean"}
beat_offset = 0.0 #@param {type:"number"}
#@markdown **キー・スケール・音色**：手動で長調と短調を比べるときは auto_key_scale をオフにします。
auto_key_scale = True #@param {type:"boolean"}
root = "C" #@param ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
scale = "major" #@param ["major", "natural_minor", "harmonic_minor", "dorian", "mixolydian", "pentatonic"]
instrument = "Electric Piano" #@param ["Electric Piano", "Acoustic Grand Piano", "Acoustic Guitar", "Electric Guitar", "Strings", "Synth Lead", "Music Box"]
#@markdown **加えるパート**：必要な音だけをオンにしてください。
add_chords = True #@param {type:"boolean"}
add_drums = True #@param {type:"boolean"}
add_melody = True #@param {type:"boolean"}
#@markdown **音量（0〜1.5）と揺らぎ**：原曲を0にすると、加えた音だけを聴けます。
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
## 設定を一つずつ変えて確かめる

- `auto_key_scale` をオフにし、Cのmajorとnatural_minorを比べます。
- `add_drums` をオフにし、リズムの印象がどう変わるかを聴きます。
- `original_gain` を0にし、追加されたパートだけを聴きます。
- 同じ音源・設定・seedでhumaniseを変え、時刻や強弱の違いを比べます。

コードを読むときは、`SCALE_DEFS` の辞書、`if` の条件、音を並べる `for`、処理をまとめる `def` を探してみましょう。
公開・配布するNotebookは実行出力を消し、URLやファイル名などの個人情報も確認してください。
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
