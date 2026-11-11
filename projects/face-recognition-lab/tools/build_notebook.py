"""顔照合の計算とCSV分析を学ぶ、出力のないNotebookを再生成する。"""
from pathlib import Path
import json
import textwrap

ROOT = Path(__file__).resolve().parents[1]
cells = []


def markdown(source):
    cells.append({"cell_type": "markdown", "metadata": {}, "source": textwrap.dedent(source).strip().splitlines(keepends=True)})


def code(source, tags=()):
    cells.append({"cell_type": "code", "execution_count": None,
                  "metadata": {"tags": list(tags)} if tags else {}, "outputs": [],
                  "source": textwrap.dedent(source).strip().splitlines(keepends=True)})


markdown(r"""
# FACEGATE：顔照合の計算と、結果の可視化

[ブラウザのアプリを開く](https://shogo-ishikawa.github.io/2026_3Q_M3Th3/projects/face-recognition-lab/) ／ [使い方](https://github.com/shogo-ishikawa/2026_3Q_M3Th3/blob/main/projects/face-recognition-lab/docs/manual.md)

このNotebookでは、顔を表す数の並び、似ている度合い、しきい値による判定をPythonで追います。リスト・辞書・`for`・`if`・関数を使ってから、結果を日本語のグラフにします。GPUは不要です。

最初に使う値は、仕組みを学ぶための**合成データ**です。実在する人の顔から計算した値や、モデルの実測精度、学生の発表で示された測定値ではありません。実アプリのCSVを扱う項目は最後に分けています。

Colabでは「ランタイム」→「すべてのセルを実行」で、サンプルの最後まで進められます。自分のCSVを読み込む操作は、最初は無効にしています。
""")

markdown("""
## 1. 日本語のグラフを準備する

Google Colabでは、日本語フォントを含む`japanize-matplotlib`を準備します。ライブラリの導入時には通信を使います。手元の環境に日本語フォントがある場合は、そのフォントを使えます。
""")

code("""
import importlib.util
import subprocess
import sys

try:
    import google.colab
    IN_COLAB = True
except ImportError:
    IN_COLAB = False

if IN_COLAB and importlib.util.find_spec("japanize_matplotlib") is None:
    subprocess.check_call([
        sys.executable, "-m", "pip", "-q", "install", "japanize-matplotlib==1.1.3", "setuptools"
    ])
""", tags=("setup",))

code("""
import csv
import io
import math
from datetime import datetime
from pathlib import Path

import numpy as np
import matplotlib.pyplot as plt
from matplotlib import font_manager

if importlib.util.find_spec("japanize_matplotlib") is not None:
    import japanize_matplotlib
else:
    available_fonts = {font.name for font in font_manager.fontManager.ttflist}
    for font_name in ("Noto Sans CJK JP", "IPAexGothic", "IPAGothic", "Yu Gothic", "Hiragino Sans"):
        if font_name in available_fonts:
            plt.rcParams["font.family"] = font_name
            break
    else:
        raise RuntimeError("日本語フォントが見つかりません。Colabで準備セルを実行するか、日本語フォントを導入してください。")

plt.rcParams["axes.unicode_minus"] = False
plt.rcParams["figure.dpi"] = 110
print("日本語グラフの準備ができました。")
""")

markdown(r"""
## 2. 顔の「特徴量」を、数の並びとして考える

アプリのSFaceは、位置と大きさをそろえた顔を128個の数へ変換します。その数の並びが特徴量です。ここでは計算を追えるよう、まず2個の数で試します。

二つのベクトルの向きがどの程度そろうかを表す値が**コサイン類似度**です。

$$s=\frac{\sum_i a_i b_i}{\sqrt{\sum_i a_i^2}\sqrt{\sum_i b_i^2}}$$

特徴量の数値を一つずつ見ても、その値が目や鼻の形にどう対応するかを単純には説明できません。また、類似度は「本人である確率」ではありません。
""")

code("""
def cosine_similarity(a, b):
    if len(a) == 0 or len(a) != len(b):
        raise ValueError("二つの特徴量は同じ長さの、空でないリストにします。")
    if not all(math.isfinite(float(value)) for value in list(a) + list(b)):
        raise ValueError("特徴量には有限の数だけを使います。")

    dot_product = 0.0
    length_a_squared = 0.0
    length_b_squared = 0.0
    for value_a, value_b in zip(a, b):
        dot_product += value_a * value_b
        length_a_squared += value_a * value_a
        length_b_squared += value_b * value_b
    if length_a_squared == 0 or length_b_squared == 0:
        raise ValueError("長さが0のベクトルの類似度は計算できません。")
    return dot_product / math.sqrt(length_a_squared * length_b_squared)


examples = [
    {"名前": "同じ向き", "a": [1, 0], "b": [2, 0]},
    {"名前": "少し違う向き", "a": [1, 0], "b": [1, 1]},
    {"名前": "直角", "a": [1, 0], "b": [0, 1]},
    {"名前": "逆向き", "a": [1, 0], "b": [-1, 0]},
]
for example in examples:
    similarity = cosine_similarity(example["a"], example["b"])
    print(f'{example["名前"]}: {similarity:.3f}')
""")

markdown("""
`examples`は辞書を要素に持つリストです。`for`は辞書を一つずつ取り出し、関数に二つのベクトルを渡しています。`b`の値を変えて、類似度がどう変わるか試せます。

## 3. 正解情報を別に持って、判定の誤りを数える

ここでは、登録画像と確認画像を一組ずつ比べる**二者照合**を考えます。`same_person`は、判定する前から分かっている正解情報です。`True`は同じ人、`False`は別人の比較を表します。

アプリが表示した名前や「未登録」という結果を、そのまま正解情報にしてはいけません。そうすると、自分の判定を使って自分の判定を採点することになります。

この例の「別人受入」は、二者照合で別人の組を受け入れた誤りです。登録者全員から候補を選ぶアプリの「未登録受入」「登録者同士の取り違え」を、これ一つで評価できるわけではありません。
""")

code("""
# 説明用の合成データ。実測データではありません。
same_scores = [0.85, 0.82, 0.79, 0.76, 0.73, 0.70, 0.67, 0.64, 0.60, 0.56, 0.52, 0.48]
different_scores = [0.14, 0.18, 0.23, 0.28, 0.31, 0.34, 0.37, 0.41, 0.45, 0.49, 0.54, 0.58]
pairs = []
for index, score in enumerate(same_scores):
    pairs.append({"id": f"same-{index + 1}", "same_person": True, "similarity": score})
for index, score in enumerate(different_scores):
    pairs.append({"id": f"different-{index + 1}", "same_person": False, "similarity": score})

print(f"本人の組: {len(same_scores)}件 / 別人の組: {len(different_scores)}件")
print(pairs[0])
""")

code("""
def count_errors(records, threshold):
    if not math.isfinite(threshold) or not -1 <= threshold <= 1:
        raise ValueError("しきい値は-1から1の有限の数にします。")
    counts = {"本人受入": 0, "本人拒否": 0, "別人受入": 0, "別人拒否": 0}
    for record in records:
        truth = record["same_person"]
        score = record["similarity"]
        if not isinstance(truth, bool):
            raise ValueError("same_personにはTrueかFalseを指定します。")
        if not math.isfinite(score) or not -1 <= score <= 1:
            raise ValueError("類似度の値を確認してください。")
        accepted = score >= threshold
        if truth and accepted:
            counts["本人受入"] += 1
        elif truth and not accepted:
            counts["本人拒否"] += 1
        elif not truth and accepted:
            counts["別人受入"] += 1
        else:
            counts["別人拒否"] += 1
    return counts


def error_rates(counts):
    same_count = counts["本人受入"] + counts["本人拒否"]
    different_count = counts["別人受入"] + counts["別人拒否"]
    return {
        "本人拒否率": counts["本人拒否"] / same_count if same_count else None,
        "別人受入率": counts["別人受入"] / different_count if different_count else None,
    }


threshold = 0.70  # ここを0.55や0.80へ変えて、もう一度実行できます。
counts = count_errors(pairs, threshold)
print(f"しきい値: {threshold:.2f}")
print(counts)
for name, value in error_rates(counts).items():
    print(name, "比較対象なし" if value is None else f"{value:.1%}")
""")

markdown("""
本人拒否率の分母は「本人の組の数」、別人受入率の分母は「別人の組の数」です。二つをまとめた全件数で割ると、別の値になります。対象が0件の率は計算せず、`None`で表しています。

## 4. しきい値を少しずつ変える

`for`でしきい値を変え、同じ関数を繰り返し使います。横軸がしきい値、縦軸が合成データで数えた誤り率です。グラフを保存するPNGファイルも作ります。
""")

code("""
thresholds = np.linspace(0, 1, 201)
sweep = []
for value in thresholds:
    sweep.append({"threshold": float(value), **error_rates(count_errors(pairs, float(value)))})

fig, axes = plt.subplots(1, 2, figsize=(12, 4.5))
bins = np.linspace(0, 1, 21)
axes[0].hist(same_scores, bins=bins, alpha=0.65, label="本人の組", color="#2f7b68")
axes[0].hist(different_scores, bins=bins, alpha=0.65, label="別人の組", color="#d48245")
axes[0].axvline(threshold, color="#343d42", linestyle="--", label=f"しきい値 {threshold:.2f}")
axes[0].set(xlabel="コサイン類似度", ylabel="比較した組の数", title="類似度の分布（合成データ）")
axes[0].legend()

for name, colour in [("本人拒否率", "#2f7b68"), ("別人受入率", "#d48245")]:
    axes[1].plot(thresholds, [row[name] * 100 for row in sweep], label=name, color=colour)
axes[1].axvline(threshold, color="#343d42", linestyle="--")
axes[1].set(xlabel="しきい値", ylabel="誤り率（%）", title="しきい値と誤り（合成データ）", ylim=(-2, 102))
axes[1].legend()
axes[1].grid(alpha=0.2)
fig.tight_layout()
fig.savefig("facegate_threshold_sweep.png", dpi=160)
plt.show()
""")

markdown("""
この例では、本人と別人の分布が重なっています。しきい値だけを動かして両方の誤りを同時に0へできるとは限りません。

次の小さな変更から試せます。

- しきい値を`0.55`へ変え、本人拒否と別人受入の件数を確認する。
- しきい値を`0.80`へ変え、同じ件数を確認する。
- 合成データのうち一つの値だけを変え、グラフのどこが変わるかを見る。

実際の精度を報告する場合は、しきい値を調整するデータと、最終評価するデータを分けます。たくさんのフレームを撮っても、同じ人物・同じ撮影場面だけでは、別の人物や環境への性能まで確認したことにはなりません。

## 5. アプリのCSVと同じ列を持つ、サンプルを読む

次も合成データです。顔画像や名前を使わず、CSVの読み込みと可視化を試すために用意します。ブラウザ版は`timestamp`、Python版は`time`という日時列を使います。この読み込み関数は両方に対応します。

通常の分析ログには、正解情報がありません。この項目では類似度と撮影条件を可視化し、誤判定率は計算しません。
""")

code('''
def read_session_csv(csv_text):
    if len(csv_text.encode("utf-8")) > 10 * 1024 * 1024:
        raise ValueError("CSVは10 MB以内にしてください。")
    reader = csv.DictReader(io.StringIO(csv_text.lstrip("\\ufeff")))
    fields = set(reader.fieldnames or [])
    if not {"similarity", "brightness", "yaw"}.issubset(fields):
        raise ValueError("similarity・brightness・yaw列のある分析CSVを選んでください。")
    time_key = "timestamp" if "timestamp" in fields else "time" if "time" in fields else None
    if time_key is None:
        raise ValueError("timestampまたはtime列が必要です。")
    rows, skipped = [], 0
    for index, row in enumerate(reader):
        if index >= 100_000:
            raise ValueError("10万行以内のCSVを選んでください。")
        try:
            timestamp = datetime.fromisoformat(row[time_key].replace("Z", "+00:00"))
            similarity = float(row["similarity"])
            brightness = float(row["brightness"])
            yaw = float(row["yaw"])
            if not all(math.isfinite(value) for value in (similarity, brightness, yaw)):
                raise ValueError("有限でない値")
            if not -1 <= similarity <= 1 or not 0 <= brightness <= 255:
                raise ValueError("範囲外の値")
            rows.append({"timestamp": timestamp, "similarity": similarity, "brightness": brightness,
                         "yaw": yaw, "decision": row.get("decision", "")})
        except (ValueError, TypeError, KeyError, AttributeError):
            skipped += 1
    if not rows:
        raise ValueError("グラフに使える行がありません。日時と数値列を確認してください。")
    aware = [row["timestamp"].tzinfo is not None for row in rows]
    if any(aware) and not all(aware):
        raise ValueError("日時のタイムゾーン表記が混在しています。別々のCSVとして分析してください。")
    rows.sort(key=lambda row: row["timestamp"])
    first = rows[0]["timestamp"]
    for row in rows:
        row["elapsed"] = (row["timestamp"] - first).total_seconds()
    return rows, skipped


sample_csv = """timestamp,source,similarity,threshold,decision,brightness,yaw
2026-01-01T00:00:00Z,image,0.84,0.70,matched,128,0.02
2026-01-01T00:00:01Z,image,0.81,0.70,matched,123,0.05
2026-01-01T00:00:02Z,image,0.77,0.70,matched,117,0.10
2026-01-01T00:00:03Z,image,0.69,0.70,unknown,110,0.19
2026-01-01T00:00:04Z,image,0.65,0.70,unknown,103,0.25
2026-01-01T00:00:05Z,image,0.59,0.70,unknown,98,0.32
"""
session_rows, skipped_rows = read_session_csv(sample_csv)
session_source = "CSVの読み方を試す合成データ"
Path("facegate_sample_session.csv").write_text(sample_csv, encoding="utf-8-sig")
print(f"使える行: {len(session_rows)}件 / 読み飛ばした行: {skipped_rows}件")
''')

markdown("""
## 6. 自分のCSVを読み込む場合だけ実行する（任意）

FACEGATEの分析記録を書き出し、次の`LOAD_MY_CSV`を`True`にします。Colabではファイル選択が開きます。手元のPythonでは`CSV_PATH`へファイルの場所を指定します。

Colabへ読み込むと、そのCSVをGoogleの実行環境へ送ります。CSVに名前や日時が含まれる場合は、共有してよい内容か確認し、不要な名前の列を取り除いてください。このNotebookのグラフでは、名前や登録者IDを使いません。

ブラウザ版の分析CSV、またはPython版の`session_*.csv`を選びます。アクセス記録だけのCSVや、別形式の評価結果CSVは対象外です。
""")

code("""
LOAD_MY_CSV = False  # 自分のCSVを読み込む場合だけTrueにする
CSV_PATH = ""       # 手元のPythonの場合だけ、ファイル名を指定する

if LOAD_MY_CSV:
    if IN_COLAB:
        from google.colab import files
        uploaded = files.upload()
        if len(uploaded) != 1:
            raise ValueError("分析CSVを1ファイルだけ選んでください。")
        csv_bytes = next(iter(uploaded.values()))
    else:
        if not CSV_PATH:
            raise ValueError("CSV_PATHにCSVファイルの場所を指定してください。")
        csv_bytes = Path(CSV_PATH).read_bytes()
    session_rows, skipped_rows = read_session_csv(csv_bytes.decode("utf-8-sig"))
    session_source = "自分で読み込んだ分析CSV（正解情報なし）"
    print(f"使える行: {len(session_rows)}件 / 読み飛ばした行: {skipped_rows}件")
else:
    print("合成サンプルのまま進みます。")
""", tags=("optional-upload",))

code("""
fig, axes = plt.subplots(1, 3, figsize=(15, 4.4))
scores = [row["similarity"] for row in session_rows]
elapsed = [row["elapsed"] for row in session_rows]
brightness = [row["brightness"] for row in session_rows]
absolute_yaw = [abs(row["yaw"]) for row in session_rows]

axes[0].scatter(elapsed, scores, color="#2f7b68", s=24)
axes[0].set(xlabel="最初の記録からの時間（秒）", ylabel="類似度", title="類似度の推移")
axes[1].scatter(brightness, scores, color="#d48245", s=24)
axes[1].set(xlabel="顔の明るさ（0〜255）", ylabel="類似度", title="明るさと類似度")
axes[2].scatter(absolute_yaw, scores, color="#647bba", s=24)
axes[2].set(xlabel="顔の向きのずれ |yaw|", ylabel="類似度", title="向きと類似度")
for axis in axes:
    axis.set_ylim(-1.05, 1.05)
    axis.grid(alpha=0.2)
fig.suptitle(session_source)
fig.tight_layout()
fig.savefig("facegate_session_analysis.png", dpi=160)
plt.show()
""")

markdown("""
各点はCSVの1行です。複数人や複数の撮影場面が混ざることがあります。同じ人の連続フレームは独立した人数ではなく、散布図の見た目だけで原因や精度を確定できません。向きのずれ`yaw`は目や鼻の位置から求めた目安で、度単位の角度ではありません。

表情分類も、顔の見た目に付けられたラベルへの分類です。本人の気持ちと比較する場合は本人の申告を別に記録し、「予測ラベルが合っているはず」と決めてから評価しないようにします。

## 参考資料

- [OpenCV：顔検出と顔照合のチュートリアル](https://docs.opencv.org/4.11.0/d0/dd4/tutorial_dnn_face.html)
- [OpenCV Zoo：SFace](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface)
- [Microsoft FER+：表情ラベルの作り方](https://github.com/microsoft/FERPlus)
- [アプリの出典とモデル情報](https://github.com/shogo-ishikawa/2026_3Q_M3Th3/blob/main/projects/face-recognition-lab/docs/sources.md)
""")


def build():
    notebook = {
        "cells": cells,
        "metadata": {
            "colab": {"name": "FACEGATE：顔照合の計算と結果の可視化", "provenance": []},
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python", "version": "3.12"},
        },
        "nbformat": 4, "nbformat_minor": 5,
    }
    for index, cell in enumerate(notebook["cells"]):
        cell["id"] = f"facegate-{index:02d}"
    target = ROOT / "face_recognition_lab.ipynb"
    target.write_text(json.dumps(notebook, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return target


if __name__ == "__main__":
    print(build())
