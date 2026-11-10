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
# くじびきラボ：Pythonで試す（v1.1.0）

くじを何度も引くと、ポイントはどう変わるでしょうか。設定を変えたり、同じ条件で繰り返したりして比べてみましょう。

2026年度3Q（月3木3クラス）の学生作品をもとにした学習版です。元作品の当選確率と配当を受け継いでいます。

**すぐ遊びたい方は[ブラウザ版](https://shogo-ishikawa.github.io/2026_3Q_M3Th3/projects/lottery-lab/)へ。**

## 最初の操作

1. セル1の ▶ を押します。追加インストールやGPUは不要です。
2. セル2で設定と回数を選び、▶ を押します。
3. 全設定を繰り返し比べたい場合は、セル3も実行します。
4. 自分の結果の珍しさや仮の金額を見たい場合は、セル4へ進みます。

モデルを選んで試せます。`published` は[メーカー公表値](https://www.kitadenshi.co.jp/slot/neoimjugglerex/)に平均出玉率を合わせたモデル、`student` は学生作品の確率を保ったモデルです。

公表値モデルではBIG・REGの確率を保ち、ブドウの確率を補正しています。補正した小役確率は教材用の仮定で、メーカー公表値ではありません。どちらも実機のリール配列やボーナス中のゲームを再現するものではなく、収支のばらつきも実機と一致するとは限りません。

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
公表値モデルの出玉率は1回3点が基準です。`play_cost` を変えると公表値には一致しなくなります。

同じ乱数の種 `seed` なら、同じ結果を再現できます。違う結果を見たいときは `seed` を変えて再実行してください。
点線は確率から計算した平均です。1回の実験がこの線どおりになるわけではありません。
"""),
        code("2. くじを引いてみる", '''#@markdown **モデル：** publishedは公表値に平均を合わせたモデル、studentは学生作品のモデルです。
model = "published" #@param ["published", "student"]
setting = 1 #@param [1, 2, 3, 4, 5, 6] {type:"raw"}
games = 1000 #@param {type:"integer"}
initial_points = 50 #@param {type:"integer"}
play_cost = 3 #@param {type:"integer"}
seed = 42 #@param {type:"integer"}

import matplotlib.pyplot as plt
from IPython.display import display, Markdown

result = None
try:
    result = simulate(setting, games, initial_points, play_cost, seed, model=model)
except ValueError as error:
    print(error)
else:
    print(f"設定{setting}で{games}回：最終ポイント {result['balance']:,}点／収支 {result['net']:+,}点")
    print("公表値に合わせたモデル（小役の補正は教材用の仮定）" if model == "published" else "学生モデル（元作品の確率）")
    print(f"消費 {result['spent']:,}点／獲得 {result['earned']:,}点")
    stats = theoretical_stats(setting, play_cost, model)
    expected_net = games * stats["mean"]
    print(f"理論上の平均収支 {expected_net:+.1f}点／今回との差 {result['net'] - expected_net:+.1f}点")
    print(f"このモデルの理論出玉率 {stats['return_rate']:.3%}")
    if play_cost == 3:
        print(f"参考：実機のメーカー公表出玉率 {stats['official_return_rate']:.1%}")
    rows = ["| 役 | 当選回数 |", "| --- | ---: |"]
    for name, count in result["counts"].items():
        rows.append(f"| {name} | {count} |")
    display(Markdown("\\n".join(rows)))
    expected = [initial_points + game * expected_delta(setting, play_cost, model) for game in range(games + 1)]
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
        code("3. 全設定を繰り返し比べる", '''#@markdown **比較するモデル：** publishedは公表値に平均を合わせたモデル、studentは学生作品のモデルです。
comparison_model = "published" #@param ["published", "student"]
comparison_games = 1000 #@param {type:"integer"}
repeat_runs = 50 #@param {type:"integer"}
comparison_seed = 42 #@param {type:"integer"}

import matplotlib.pyplot as plt
from IPython.display import display, Markdown

try:
    comparison = compare_settings(games=comparison_games, runs=repeat_runs,
                                 seed=comparison_seed, initial_points=50, play_cost=3,
                                 model=comparison_model)
except ValueError as error:
    print(error)
else:
    print(f"各設定：{comparison_games:,}回のくじ引きを{repeat_runs}試行。初期50点、1回3点です。")
    print("公表値に合わせたモデル（小役の補正は教材用の仮定）" if comparison_model == "published" else "学生モデル（元作品の確率）")
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
## 4. 自分の結果を振り返る

セル2と同じモデル・設定・回数・消費ポイントで何度も抽選し、自分の結果と比べます。プラスなら「今回以上の収支」、マイナスなら「今回以下の収支」になった回数を数えます。分母は勝ち・負けを含む全試行です。

表示する割合は再試行による推定です。0回でも発生確率が0とは限りません。中央95%の範囲は、再試行で出た結果の幅です。平均値の信頼区間ではありません。

円換算は比較のための仮定です。実際の交換額や支出額を表しません。初期50点は収支に含めず、最終ポイントから初期ポイントを引いた差額を換算します。
"""),
        code("4. 自分の結果を振り返る", '''analysis_runs = 5000 #@param {type:"integer"}
analysis_seed = 20261110 #@param {type:"integer"}
yen_per_point = 20 #@param {type:"integer"}

import matplotlib.pyplot as plt
from IPython.display import display, Markdown

if not isinstance(globals().get("result"), dict):
    print("先にセル2でくじを引いてください。")
else:
    try:
        # 画面の入力欄ではなく、最後に実行したセル2の結果を使います。
        money = money_comparison(result["net"], yen_per_point)
        distribution = simulate_distribution(setting=result["setting"], games=result["games"],
                                             runs=analysis_runs, seed=analysis_seed,
                                             play_cost=result["play_cost"], model=result["model"])
        rarity = tail_estimate(distribution, result["net"])
    except ValueError as error:
        print(error)
    else:
        theory = theoretical_stats(result["setting"], result["play_cost"], result["model"])
        expected_net = result["games"] * theory["mean"]
        print(f"設定{result['setting']}・{result['games']:,}回を{analysis_runs:,}試行しました。")
        print("公表値に合わせたモデル（小役の補正は教材用の仮定）" if result["model"] == "published" else "学生モデル（元作品の確率）")
        print(f"今回の収支 {result['net']:+,}点／理論上の平均 {expected_net:+.1f}点")
        print(f"比較実験の平均 {distribution['mean_net']:+.1f}点／中央95%の範囲 {distribution['lower95']:+.1f}〜{distribution['upper95']:+.1f}点")
        direction = "以上" if rarity["direction"] == "upper" else "以下"
        print(f"今回{direction}の収支になったのは {rarity['count']:,} / {rarity['total']:,} 試行です。")
        if rarity["count"]:
            print(f"推定割合 {rarity['probability']:.2%}（約{rarity['one_in']:.1f}回に1回）")
            if rarity["count"] < 10:
                print("該当した試行が少ないため、珍しさの推定は不安定です。")
        else:
            print("この再試行では0回でした。発生確率が0という意味ではありません。")
        print(f"推定割合の95%区間：{rarity['lower95']:.2%}〜{rarity['upper95']:.2%}（Wilson区間）")

        fig, ax = plt.subplots(figsize=(10, 4))
        ax.hist(distribution["nets"], bins=40, color="#96b5aa", edgecolor="white")
        ax.axvline(result["net"], color="#be5b40", linewidth=2, label="Your result")
        ax.axvline(expected_net, color="#245d56", linestyle="--", linewidth=2, label="Theoretical mean")
        ax.set(xlabel="Net points", ylabel="Runs", title=f"Same-setting simulations ({analysis_runs:,} runs)")
        ax.legend()
        plt.show()

        print(f"1点={yen_per_point:,}円と仮定すると、差し引き {money['yen_net']:+,}円です。")
        if money["loss_yen"] > 0:
            print(f"同じ金額を使わずに残せたと考えると、{money['loss_yen']:,}円分です。")
            affordable = [row for row in money["examples"] if row["count"] > 0]
            if affordable:
                rows = ["| 比較用の予算例 | 仮の1回分 | 同じ金額でできる回数 |", "| --- | ---: | ---: |"]
                for row in affordable:
                    rows.append(f"| {row['name']} | {row['price']:,}円 | {row['count']:,}回分 |")
                display(Markdown("\\n".join(rows)))
            print("予算例は比較のための仮定で、実売価格ではありません。")
        else:
            print("今回は損失がありません。次の抽選も独立で、今回のプラスは次回の結果を保証しません。")
''', "reflect-result"),
        markdown("""
## 仕組みを変えてみる

セル1のコードを開くと、当選確率の辞書 `BONUS_PROBABILITIES` と配当の辞書 `PAYOUTS` が見つかります。例えばBIGの配当を変えると、ポイント推移と平均収支はどう変わるでしょうか。

変更後はセル1から実行し直します。確率の合計は1以下にし、残りをハズレにする考え方を守ってください。
元の結果と比べたい場合は、変更前後で同じseedを使ってみましょう。
配当を書き換える実験では、まず `student` を使います。`published` は配当を変えると平均を合わせる補正値も変わるためです。
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
    print(f"Created {target.name}: 4 code cells")


if __name__ == "__main__":
    build()
