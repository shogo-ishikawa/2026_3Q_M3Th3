"""公開用Notebookを再生成。ソースを内包し、単体でもColabで実行できます。"""

from pathlib import Path
import json

PROJECT = Path(__file__).resolve().parents[1]


def markdown(text):
    return {"cell_type": "markdown", "metadata": {}, "source": text.strip().splitlines(keepends=True)}


def code(text, cell_id):
    return {"cell_type": "code", "metadata": {}, "id": cell_id,
            "execution_count": None, "outputs": [], "source": text.splitlines(keepends=True)}


def build():
    cells = [
        markdown("""
# AI作曲アレンジ — 音を聴き、設定を変え、伴奏を作ろう

**YouTube・手持ちの音声・デモ音源から、コード伴奏とドラムを加えて聴き比べる教材です。**

2026年度3Q（月3木3クラス）の学生2名による作品をもとに、公開用に整理・改良しました。
音源を解析し、ボタンや選択欄で音作りを試せる、元の作品の工夫を引き継いでいます。

## 最初の操作

1. Google Colabで開き、編集・保存する場合は「ファイル → ドライブにコピーを保存」を選びます。
2. 「ランタイム → すべてのセルを実行」で、下の **1 → 2 → 3** を実行します。CPUのままで使えます。
3. 最後の操作画面で **「デモ音源を用意」→「音源を解析」→「アレンジを生成」** と進みます。
4. 原曲・追加パート・ミックスを聴き比べ、WAVとMIDIをダウンロードします。

初回の準備や解析には数分かかることがあります。左の実行マークが止まるまで待ってください。
Notebook内に全コードを収録しているので、このファイルだけでも実行できます。

[詳しい操作マニュアル](https://github.com/shogo-ishikawa/2026_3Q_M3Th3/blob/main/projects/ai-music-arranger/docs/manual.md)
／ [コードと改良内容](https://github.com/shogo-ishikawa/2026_3Q_M3Th3/tree/main/projects/ai-music-arranger)

### できることと、結果の読み方

- YouTube URLから、開始位置と長さ（3〜60秒）を指定して音声を取得できます。
- BPMとキーを推定し、pYINで連続した音の高さを音符に変換します。推定は耳で確かめ、修正できます。
- キー・スケール・楽器・各パートの音量を変えて、規則に基づく伴奏を作ります。
- 「AI作曲アレンジ」という作品名を引き継いでいますが、大規模な音楽生成AIやLSTMは使いません。
  ボーカルと伴奏を分離したり、原曲のコード進行を正確に認識したりする機能ではありません。
- BPMは追加パートの速さを変えます。原曲の再生速度は変わりません。
- 試聴は内蔵の簡易音源です。MIDIの音色は再生ソフトによって異なります。

音源は、自分で制作したものや利用が認められたものを使ってください。
YouTube側の接続制限で取得できない場合もあります。失敗時には理由を表示し、別の音源を選べます。
"""),
        markdown("""
## 1. 環境を準備する

左の ▶ を押します。音声解析ライブラリ、FFmpeg、YouTube取得に使う実行環境を確認します。
このセルは通常、接続したランタイムごとに1回だけ実行します。APIキーやGPUは不要です。
YouTube用の追加準備に失敗した場合は、その案内を確認してください。デモとファイル入力は試せます。
"""),
        code((PROJECT / "setup_environment.py").read_text(), "environment-setup"),
        markdown("""
## 2. プログラムを読み込む（3つのセル）

続く3つのセルは、役割ごとに分けたPythonコードを作業用フォルダーへ保存します。
**3つとも上から順に実行**してください。実行すると `Writing ...py` と表示されます。

初めて使うときは、コードを変更せずに進めて構いません。
処理を学ぶ場合は、まず音の間隔を並べた `SCALE_DEFS`、チェックボックスに対応する `if`、
音符を並べる `for`、処理をまとめた `def` を探してみてください。

### 2-a. 音源の取り込み

YouTubeのURLを確認し、指定した区間だけを取り込みます。失敗したときは、前の音源を保持します。
"""),
    ]
    for filename, cell_id in [("audio_input.py", "audio-input"),
                              ("music_core.py", "music-core"),
                              ("colab_app.py", "colab-app")]:
        if filename == "music_core.py":
            cells.append(markdown("""
### 2-b. 解析と伴奏生成

テンポ・キー・音の高さを推定し、コードとドラムを並べます。
伴奏の規則を変更したいときは、このセルにある `chord_pitches` や `progression` を読んでみましょう。
"""))
        if filename == "colab_app.py":
            cells.append(markdown("""
### 2-c. ボタンで操作する画面

音源の取り込み、解析、アレンジ、保存をつなぎます。
音源や設定を変えた際の結果の更新も、このコードで管理しています。
"""))
        cells.append(code(f"%%writefile {filename}\n" + (PROJECT / filename).read_text(), cell_id))
    cells.extend([
        markdown("""
## 3. 操作画面を開く

左の ▶ を押すと操作画面が表示されます。まずは画面の①から、デモ音源で試してみましょう。
画面を作り直したい場合も、このセルを再実行できます（前の操作状態はリセットされます）。
"""),
        code("""import importlib
import audio_input, music_core, colab_app

# セル2でコードを変更した場合も、その内容を読み直します。
for module in (audio_input, music_core, colab_app):
    importlib.reload(module)

from IPython.display import display
app = colab_app.launch_app()
display(app)
""", "launch-panel"),
        markdown("""
## 4. 設定を一つずつ変えて確かめる

1. デモで「原曲」を0、「メロディ」をオフにし、コードとドラムだけを聴きます。
2. キーをCに固定し、スケールを長調から自然短音階へ変えます。和音の響きはどう変わりますか。
3. ドラムをオフにして、ありの場合と比べます。リズムの印象はどう変わりますか。
4. 「ゆらぎの強さ」を変え、同じ乱数シードと異なる乱数シードで生成して比べます。
5. 単音のはっきりした音源と多重奏の音源で、メロディの音符の取り出しやすさを比べます。

変更した値と、聴いて分かったことをメモしてみましょう。
設定を変えた後は「アレンジを生成」を押して、新しい結果に更新します。

### 保存時の注意

WAVは実際に聴ける音声、MIDIは音の高さ・長さ・楽器などの演奏情報です。
MIDIには原曲の録音は含まれません。ランタイムを切断すると作業ファイルが消えるため、
残したい結果は画面のダウンロードボタンで自分のPCに保存してください。
公開・再配布するNotebookでは「編集 → 出力をすべて消去」を行い、URLやファイル名なども確認しましょう。
"""),
    ])
    for i, cell in enumerate(cells):
        cell.setdefault("id", f"guide-{i:02d}")
    notebook = {"cells": cells, "nbformat": 4, "nbformat_minor": 5,
                "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
                             "language_info": {"name": "python"},
                             "colab": {"name": "ai_music_arranger.ipynb", "provenance": []}}}
    output = PROJECT / "ai_music_arranger.ipynb"
    output.write_text(json.dumps(notebook, ensure_ascii=False, indent=1) + "\n")
    print(f"Created {output.name}: {len(cells)} cells; outputs and execution counts cleared")


if __name__ == "__main__":
    build()
