"""記録(CSV)からレポート(HTML)を作る。複数の記録を渡すと条件どうしを比較する。

・人物ごとの照合結果と類似度の推移
・表情の推定ラベルの推移(仕様の発展アイデア「表情の変化のグラフ化」)
・【独自機能】気持ちの答え合わせ: 本人が申告した気持ちと推定ラベルの一致率・混同表
・照明・顔の向きと類似度の関係
・動作チャレンジの記録
"""
from __future__ import annotations

import base64
import csv
import html
import io
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

from . import config

E = config.EMOTIONS_EN
JA = dict(zip(config.EMOTIONS_EN, config.EMOTIONS_JA))


def load(path):
    with open(path, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def fnum(v, default=np.nan):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def fig_html(fig):
    from .plotting import plt
    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight")
    plt.close(fig)
    return f'<img src="data:image/png;base64,{base64.b64encode(buf.getvalue()).decode()}">'


def table(headers, rows):
    h = "".join(f"<th>{html.escape(str(x))}</th>" for x in headers)
    b = "".join("<tr>" + "".join(f"<td>{html.escape(str(c))}</td>" for c in r) + "</tr>" for r in rows)
    return f"<table><tr>{h}</tr>{b}</table>"


def summarize(rows):
    data = [r for r in rows if r.get("track_id")]
    by_track = defaultdict(list)
    for r in data:
        by_track[r["track_id"]].append(r)
    return data, by_track


def session_stats(path, rows):
    data, _ = summarize(rows)
    if not data:
        return [Path(path).name, 0, "-", "-", "-", "-", "-"]
    names = Counter(r["name"] for r in data)
    known = sum(1 for r in data if r["name"] not in ("未登録", "判定中"))
    sims = [fnum(r["raw_similarity"]) for r in data]
    br = [fnum(r["brightness"]) for r in data]
    yaw = [abs(fnum(r["yaw"])) for r in data]
    emo = Counter(r["emotion"] for r in data if r["emotion"]).most_common(1)
    return [Path(path).name, len(data), f"{known / len(data) * 100:.0f}%",
            f"{np.nanmean(sims):.3f}", f"{np.nanmean(br):.0f}", f"{np.nanmean(yaw):.2f}",
            JA.get(emo[0][0], "-") if emo else "-"]


def build(paths, out=None):
    from .plotting import plt

    paths = [Path(p) for p in paths]
    sessions = [(p, load(p)) for p in paths]
    parts = [f"<h1>顔照合・表情分析 レポート</h1><p>対象の記録: {', '.join(p.name for p in paths)}</p>"]

    if len(sessions) > 1:
        parts.append("<h2>記録どうしの比較(照明・距離など条件を変えた記録を並べる)</h2>")
        parts.append(table(["記録", "行数", "登録者と確定した割合", "平均類似度", "平均の明るさ",
                            "平均の向きのずれ", "最も多い推定ラベル"],
                           [session_stats(p, r) for p, r in sessions]))

    for p, rows in sessions:
        data, by_track = summarize(rows)
        parts.append(f"<h2>記録: {html.escape(p.name)}</h2>")
        if not data:
            parts.append("<p>顔の記録がありません。</p>")
            continue
        # --- 人物ごとのまとめ
        trs = []
        for tid, rs in sorted(by_track.items(), key=lambda kv: -len(kv[1])):
            nm = Counter(r["name"] for r in rs).most_common(1)[0][0]
            emo = Counter(r["emotion"] for r in rs if r["emotion"])
            top = "、".join(f"{JA.get(k, k)} {v / len(rs) * 100:.0f}%" for k, v in emo.most_common(3))
            trs.append([f"#{tid}", nm, len(rs), f"{np.nanmean([fnum(r['raw_similarity']) for r in rs]):.3f}", top])
        parts.append("<h3>人物ごとのまとめ</h3>")
        parts.append(table(["追跡番号", "判定(多数決)", "フレーム数", "平均類似度", "推定ラベルの内訳(上位3)"], trs))

        main_tracks = [tid for tid, rs in sorted(by_track.items(), key=lambda kv: -len(kv[1]))][:3]
        # --- 類似度と表情ラベルの推移
        fig, axes = plt.subplots(len(main_tracks), 2, figsize=(14, 3.2 * len(main_tracks)), squeeze=False)
        for i, tid in enumerate(main_tracks):
            rs = by_track[tid]
            t = [fnum(r["elapsed"]) for r in rs]
            axes[i, 0].plot(t, [fnum(r["raw_similarity"]) for r in rs], lw=1, label="各フレーム")
            axes[i, 0].plot(t, [fnum(r["similarity"]) for r in rs], lw=2, label="平滑化後")
            axes[i, 0].plot(t, [fnum(r["threshold"]) for r in rs], "k--", lw=1, label="しきい値")
            axes[i, 0].set(title=f"#{tid} 類似度の推移", xlabel="経過秒", ylim=(-0.1, 1))
            axes[i, 0].legend(fontsize=8)
            probs = np.array([[fnum(r[f"p_{e}"], 0) for e in E] for r in rs])
            # 移動平均で見やすくする
            k = max(1, min(15, len(probs) // 10))
            norm = np.convolve(np.ones(len(probs)), np.ones(k), mode="same")
            sm = np.array([np.convolve(probs[:, j], np.ones(k), mode="same") / norm for j in range(8)])
            cols = [tuple(c / 255 for c in col[::-1]) for col in config.EMOTION_COLORS]
            axes[i, 1].stackplot(t, sm, labels=config.EMOTIONS_JA, colors=cols)
            for r in rs:
                if r["self_report"]:
                    axes[i, 1].axvline(fnum(r["elapsed"]), color="k", lw=1)
                    axes[i, 1].text(fnum(r["elapsed"]), 0.97, " 申告:" + JA.get(r["self_report"], ""), fontsize=8, va="top",
                                    bbox=dict(fc="white", alpha=0.8, lw=0))
            axes[i, 1].set(title=f"#{tid} 表情からの推定ラベルの推移(縦線=本人の申告)", xlabel="経過秒", ylim=(0, 1))
            axes[i, 1].legend(fontsize=7, loc="upper left", bbox_to_anchor=(1, 1))
        fig.tight_layout()
        parts.append("<h3>類似度と表情の推移</h3>" + fig_html(fig))

        # --- 答え合わせ
        reps = [r for r in data if r["self_report"]]
        parts.append("<h3>気持ちの答え合わせ(本人の申告 と 表情からの推定)</h3>")
        if reps:
            agree = sum(1 for r in reps if r["self_report"] == r["emotion"])
            parts.append(f"<p>申告 {len(reps)} 回のうち、推定ラベルと一致したのは <b>{agree} 回"
                         f"({agree / len(reps) * 100:.0f}%)</b>。一致しない例は「表情に出ていない気持ち」"
                         "や「推定の誤り」の可能性があり、どちらかを話し合う材料になります。</p>")
            cm = np.zeros((8, 8), int)
            for r in reps:
                if r["emotion"] in E:
                    cm[E.index(r["self_report"]), E.index(r["emotion"])] += 1
            used = [i for i in range(8) if cm[i].sum() or cm[:, i].sum()]
            parts.append(table(["申告 \\ 推定"] + [config.EMOTIONS_JA[j] for j in used],
                               [[config.EMOTIONS_JA[i]] + [cm[i, j] for j in used] for i in used]))
            parts.append(table(["経過秒", "追跡番号", "申告", "推定", "一致"],
                               [[r["elapsed"], r["track_id"], JA[r["self_report"]], JA.get(r["emotion"], "-"),
                                 "○" if r["self_report"] == r["emotion"] else "×"] for r in reps]))
        else:
            parts.append("<p>申告はありませんでした(実行中に 1〜8 キーで申告できます)。</p>")

        # --- 撮影条件との関係
        b = np.array([fnum(r["brightness"]) for r in data])
        y = np.array([abs(fnum(r["yaw"])) for r in data])
        s = np.array([fnum(r["raw_similarity"]) for r in data])
        known = np.array([r["name"] not in ("未登録", "判定中") for r in data])
        fig, ax = plt.subplots(1, 2, figsize=(12, 3.8))
        for a, xv, xl in [(ax[0], b, "顔の明るさ"), (ax[1], y, "顔の向きのずれ |yaw|")]:
            a.scatter(xv[known], s[known], s=6, alpha=0.5, label="登録者と判定")
            a.scatter(xv[~known], s[~known], s=6, alpha=0.5, color="tab:red", label="未登録/判定中")
            a.set(xlabel=xl, ylabel="類似度", title=f"{xl}と類似度")
            a.legend(fontsize=8)
        fig.tight_layout()
        parts.append("<h3>照明・顔の向きと照合結果</h3>" + fig_html(fig))

        # --- イベント
        ev = [r for r in rows if r.get("event")]
        if ev:
            parts.append("<h3>動作チャレンジなどの記録</h3>")
            parts.append(table(["経過秒", "内容"], [[r["elapsed"], r["event"]] for r in ev]))

    css = ("body{font-family:sans-serif;max-width:1200px;margin:24px auto;color:#222}"
           "table{border-collapse:collapse;margin:8px 0 16px}td,th{border:1px solid #ccc;padding:4px 8px;font-size:13px}"
           "th{background:#f0f0f0}img{max-width:100%}h2{border-bottom:2px solid #333;margin-top:36px}")
    doc = f"<!DOCTYPE html><html lang='ja'><head><meta charset='utf-8'><title>レポート</title><style>{css}</style></head><body>{''.join(parts)}</body></html>"
    config.REPORT_DIR.mkdir(parents=True, exist_ok=True)
    out = Path(out) if out else config.REPORT_DIR / f"report_{paths[-1].stem}.html"
    out.write_text(doc, encoding="utf-8")
    print(f"レポートを作成しました: {out}")
    return out
