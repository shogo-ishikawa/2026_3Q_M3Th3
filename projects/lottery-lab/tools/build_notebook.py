"""Pythonの学習用Notebookを、抽選プログラムを内包して作ります。"""
from pathlib import Path
import json


PROJECT = Path(__file__).resolve().parents[1]


def markdown(source):
    return {"cell_type": "markdown", "metadata": {}, "source": source.strip().splitlines(keepends=True)}


def code(title, source, cell_id):
    source = f'#@title {title} {{ display-mode: "form" }}\n' + source.strip() + "\n"
    return {
        "cell_type": "code", "id": cell_id, "metadata": {"cellView": "form"},
        "execution_count": None, "outputs": [], "source": source.splitlines(keepends=True),
    }


def build():
    cells = [
        markdown("""
# くじびきラボ：Pythonで試す（v1.0.1）

くじを何度も引くと、ポイントはどう変わるでしょうか。設定を変えたり、同じ条件で繰り返したりして比べてみましょう。

2026年度3Q（月3木3クラス）の学生作品をもとにした学習版です。元作品の当選確率と配当を受け継いでいます。

**すぐ遊びたい方は[ブラウザ版](https://shogo-ishikawa.github.io/2026_3Q_M3Th3/projects/lottery-lab/)へ。**

## 最初の操作

1. セル1の ▶ を押します。追加インストールやGPUは不要です。
2. セル2で設定と回数を選び、▶ を押します。
3. 全設定を繰り返し比べたい場合は、セル3も実行します。

リンクからそのまま実行できます。変更したコードや設定を残したい場合だけ「ファイル → ドライブにコピーを保存」を選んでください。

[操作マニュアル](https://github.com/shogo-ishikawa/2026_3Q_M3Th3/blob/main/projects/lottery-lab/docs/manual.md) ／ [コードの読み方](https://github.com/shogo-ishikawa/2026_3Q_M3Th3/blob/main/projects/lottery-lab/docs/development.md)
"""),
        markdown("""
## 1. 抽選プログラムを準備する

▶ を押してから、セル2へ進みます。
"""),
        code("1. 抽選プログラムを準備する", (PROJECT / "lottery.py").read_text() + '\nprint("準備ができました。セル2で設定を選びましょう。")', "prepare-program"),
        markdown("""
## 2. くじを引いてみる

最初はそのまま ▶ を押してみましょう。初期ポイントは50点、1回につき3点を使います。仮想ポイントなので、マイナスになっても指定回数まで続けます。

同じ乱数の種 `seed` なら、同じ結果を再現できます。違う結果を見たいときは `seed` を変えて再実行してください。
点線は確率から計算した平均です。1回の実験がこの線どおりになるわけではありません。
"""),
        code("2. くじを引いてみる", '''setting = 6 #@param [1, 2, 3, 4, 5, 6] {type:"raw"}
games = 1000 #@param {type:"integer"}
initial_points = 50 #@param {type:"integer"}
play_cost = 3 #@param {type:"integer"}
seed = 42 #@param {type:"integer"}

import matplotlib.pyplot as plt
from IPython.display import display, Markdown

try:
    result = simulate(setting, games, initial_points, play_cost, seed)
except ValueError as error:
    print(error)
else:
    print(f"設定{setting}で{games}回：最終ポイント {result['balance']:,}点／収支 {result['net']:+,}点")
    print(f"消費 {result['spent']:,}点／獲得 {result['earned']:,}点")
    rows = ["| 役 | 当選回数 |", "| --- | ---: |"]
    for name, count in result["counts"].items():
        rows.append(f"| {name} | {count} |")
    display(Markdown("\\n".join(rows)))
    expected = [initial_points + game * expected_delta(setting, play_cost) for game in range(games + 1)]
    fig, ax = plt.subplots(figsize=(10, 4))
    ax.plot(result["history"], label="This run", color="#28645b")
    ax.plot(expected, linestyle="--", label="Expected average", color="#c0783d")
    ax.axhline(initial_points, color="#bbb", linewidth=0.8)
    ax.set(xlabel="Draws", ylabel="Points", title=f"Setting {setting}")
    ax.grid(alpha=0.2)
    ax.legend()
    plt.show()
''', "single-experiment"),
        markdown("""
## 3. 全設定を繰り返し比べる

1000回のくじ引きを50回ずつ繰り返し、平均収支と結果の幅を比べます。`comparison_games` は1試行の抽選回数、`repeat_runs` は試行数です。

同じ試行番号では全設定に同じ乱数列を使います。確率の違いを比べやすくするためです。
表の最低・最高は今回の試行で出た値です。今後の結果がこの範囲に収まる保証ではありません。

ブラウザ版とPython版では乱数の作り方が異なるため、同じseedでも結果は一致しません。それぞれの版の中では再現できます。
"""),
        code("3. 全設定を繰り返し比べる", '''comparison_games = 1000 #@param {type:"integer"}
repeat_runs = 50 #@param {type:"integer"}
comparison_seed = 42 #@param {type:"integer"}

import matplotlib.pyplot as plt
from IPython.display import display, Markdown

try:
    comparison = compare_settings(games=comparison_games, runs=repeat_runs,
                                 seed=comparison_seed, initial_points=50, play_cost=3)
except ValueError as error:
    print(error)
else:
    print(f"各設定：{comparison_games:,}回のくじ引きを{repeat_runs}試行。初期50点、1回3点です。")
    rows = ["| 設定 | 平均収支 | 最低 | 最高 | プラスの割合 | 理論上の平均収支 |",
            "| --- | ---: | ---: | ---: | ---: | ---: |"]
    for row in comparison:
        rows.append(f"| {row['setting']} | {row['mean_net']:+.1f} | {row['min_net']:+,} | {row['max_net']:+,} | {row['positive_rate']:.0%} | {row['expected_net']:+.1f} |")
    display(Markdown("\\n".join(rows)))
    fig, ax = plt.subplots(figsize=(10, 4))
    for row in comparison:
        ax.plot(row["mean_history"], label=f"Setting {row['setting']}")
    ax.set(xlabel="Draws", ylabel="Average points", title=f"Average of {repeat_runs} runs")
    ax.grid(alpha=0.2)
    ax.legend(ncol=3)
    plt.show()
''', "compare-settings"),
        markdown("""
## 仕組みを変えてみる

セル1のコードを開くと、当選確率の辞書 `BONUS_PROBABILITIES` と配当の辞書 `PAYOUTS` が見つかります。例えばBIGの配当を変えると、ポイント推移と平均収支はどう変わるでしょうか。

変更後はセル1から実行し直します。確率の合計は1以下にし、残りをハズレにする考え方を守ってください。
元の結果と比べたい場合は、変更前後で同じseedを使ってみましょう。
"""),
    ]
    for index, cell in enumerate(cells):
        cell.setdefault("id", f"guide-{index:02d}")
    notebook = {
        "cells": cells, "nbformat": 4, "nbformat_minor": 5,
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python"},
            "colab": {"name": "lottery_lab.ipynb", "provenance": []},
        },
    }
    target = PROJECT / "lottery_lab.ipynb"
    target.write_text(json.dumps(notebook, ensure_ascii=False, indent=1) + "\n")
    print(f"Created {target.name}: 3 folded code cells")


if __name__ == "__main__":
    build()
