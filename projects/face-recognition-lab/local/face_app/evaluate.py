"""照合精度の評価と、しきい値の調整(仕様の「確かめるポイント」に対応)。

確認用画像フォルダの構成:
    data/test/<登録した名前>/*.jpg   … 本人の確認用画像(登録に使った画像とは別のもの)
    data/test/_unknown/*.jpg         … 登録していない人の画像

数える誤り:
    本人拒否   … 登録者なのに「未登録」と判定された
    他人と取違え … 登録者Aなのに登録者Bと判定された
    未登録受入 … 未登録の人なのに誰かとして受け入れられた
しきい値を少しずつ変えて誤りの数を数え、グラフと推奨しきい値を出す。
"""
from __future__ import annotations

import csv
from datetime import datetime
from pathlib import Path

import numpy as np

from . import config
from .engine import largest_face
from .enroll import file_hash, imread, list_images
from .quality import assess
from .registry import FaceDB, UNKNOWN

UNKNOWN_DIR = "_unknown"


def collect(engine, db: FaceDB, test_dir: Path):
    """確認用画像すべてについて、人ごとの類似度を計算する。"""
    registered_hashes = {h for m in db.meta.values() for h in m.get("image_hashes", [])}
    probes, overlap = [], []
    for sub in sorted(p for p in Path(test_dir).iterdir() if p.is_dir()):
        truth = UNKNOWN if sub.name == UNKNOWN_DIR else sub.name
        if truth != UNKNOWN and truth not in db.names:
            print(f"[注意] {sub.name} は登録されていないため、未登録者として扱います")
            truth = UNKNOWN
        for p in list_images(sub):
            if file_hash(p) in registered_hashes:
                overlap.append(p)
            img = imread(p)
            if img is None:
                continue
            face = largest_face(engine.detect(img))
            if face is None:
                probes.append({"file": str(p), "truth": truth, "detected": False})
                continue
            q = assess(img, face.box, face.landmarks)
            scores = db.scores(engine.embed(img, face))
            probes.append({"file": str(p), "truth": truth, "detected": True, "scores": scores,
                           "brightness": q.brightness, "yaw": q.yaw, "quality": q.score})
    if overlap:
        print(f"[警告] 登録に使った画像が確認用にも {len(overlap)} 枚含まれています。"
              "結果が実際より良く見えるので、別の画像を使ってください。")
    return probes


def decide(scores: dict, thr: float):
    if not scores:
        return UNKNOWN, 0.0
    best = max(scores, key=scores.get)
    return (best if scores[best] >= thr else UNKNOWN), scores[best]


def count_errors(probes, thr):
    c = {"本人の画像": 0, "未登録者の画像": 0, "正解": 0, "本人拒否": 0,
         "他人と取違え": 0, "未登録受入": 0, "顔検出失敗": 0}
    for pr in probes:
        is_reg = pr["truth"] != UNKNOWN
        c["本人の画像" if is_reg else "未登録者の画像"] += 1
        if not pr["detected"]:
            c["顔検出失敗"] += 1
            if is_reg:
                c["本人拒否"] += 1
            else:
                c["正解"] += 1
            continue
        pred, _ = decide(pr["scores"], thr)
        if pred == pr["truth"]:
            c["正解"] += 1
        elif is_reg and pred == UNKNOWN:
            c["本人拒否"] += 1
        elif is_reg:
            c["他人と取違え"] += 1
        else:
            c["未登録受入"] += 1
    return c


def rates(c):
    g, u = max(1, c["本人の画像"]), max(1, c["未登録者の画像"])
    return {"本人拒否率": c["本人拒否"] / g, "取違え率": c["他人と取違え"] / g,
            "未登録受入率": c["未登録受入"] / u}


def sweep(probes, lo=0.0, hi=0.9, step=0.005):
    rows = []
    for thr in np.arange(lo, hi + 1e-9, step):
        c = count_errors(probes, float(thr))
        rows.append((round(float(thr), 3), c, rates(c)))
    return rows


def recommend(rows):
    # バランス重視: 誤り率の合計が最小(同点なら中央の値)
    totals = [r["本人拒否率"] + r["取違え率"] + r["未登録受入率"] for _, _, r in rows]
    m = min(totals)
    idx = [i for i, t in enumerate(totals) if abs(t - m) < 1e-12]
    balanced = rows[idx[len(idx) // 2]][0]
    # 安全重視: 未登録受入・取違えが 0 になる最小のしきい値
    safe = next((thr for thr, _, r in rows if r["未登録受入率"] == 0 and r["取違え率"] == 0), None)
    return balanced, safe


def run_evaluation(engine, test_dir, threshold=config.DEFAULT_THRESHOLD, out_dir=None):
    from .plotting import plt

    out_dir = out_dir or config.REPORT_DIR

    db = FaceDB()
    if not db.names:
        raise SystemExit("登録者がいません。先に register を実行してください。")
    probes = collect(engine, db, Path(test_dir))
    if not probes:
        raise SystemExit(f"確認用画像がありません: {test_dir}")
    out_dir = Path(out_dir); out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    rows = sweep(probes)
    balanced, safe = recommend(rows)
    cur = count_errors(probes, threshold)

    # 画像ごとの結果
    csv_path = out_dir / f"eval_{stamp}_images.csv"
    with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["file", "正解", "判定", "最良類似度", "明るさ", "向き(yaw)", "撮影条件点", "結果"])
        for pr in probes:
            if not pr["detected"]:
                w.writerow([pr["file"], pr["truth"], "顔検出失敗", "", "", "", "", "×"]); continue
            pred, s = decide(pr["scores"], threshold)
            w.writerow([pr["file"], pr["truth"], pred, f"{s:.4f}", f"{pr['brightness']:.0f}",
                        f"{pr['yaw']:+.2f}", pr["quality"], "○" if pred == pr["truth"] else "×"])

    # しきい値と誤り率のグラフ + 類似度の分布 + 撮影条件との関係
    fig, ax = plt.subplots(1, 3, figsize=(16, 4.6))
    th = [r[0] for r in rows]
    for k, col in [("本人拒否率", "tab:blue"), ("取違え率", "tab:orange"), ("未登録受入率", "tab:red")]:
        ax[0].plot(th, [r[2][k] * 100 for r in rows], label=k, color=col)
    ax[0].axvline(threshold, color="k", ls="--", label=f"現在 {threshold:.3f}")
    ax[0].axvline(balanced, color="g", ls=":", label=f"推奨(バランス) {balanced:.3f}")
    ax[0].set(xlabel="しきい値", ylabel="誤り率 (%)", title="しきい値と誤りの関係")
    ax[0].legend(fontsize=8)

    gen = [pr["scores"].get(pr["truth"], 0) for pr in probes if pr["detected"] and pr["truth"] != UNKNOWN]
    imp = []
    for pr in probes:
        if not pr["detected"]:
            continue
        imp += [s for n, s in pr["scores"].items() if n != pr["truth"]]
    bins = np.linspace(-0.2, 1.0, 49)
    ax[1].hist(gen, bins=bins, alpha=0.6, label="本人どうし", color="tab:green")
    ax[1].hist(imp, bins=bins, alpha=0.6, label="他人どうし", color="tab:red")
    ax[1].axvline(threshold, color="k", ls="--")
    ax[1].set(xlabel="類似度", ylabel="件数", title="類似度の分布(重なりが少ないほど良い)")
    ax[1].legend(fontsize=8)

    gp = [pr for pr in probes if pr["detected"] and pr["truth"] != UNKNOWN]
    if gp:
        sc = ax[2].scatter([pr["brightness"] for pr in gp], [pr["scores"].get(pr["truth"], 0) for pr in gp],
                           c=[abs(pr["yaw"]) for pr in gp], cmap="viridis", vmin=0, vmax=0.6)
        fig.colorbar(sc, ax=ax[2], label="顔の向きのずれ |yaw|")
        ax[2].axhline(threshold, color="k", ls="--")
    ax[2].set(xlabel="顔の明るさ", ylabel="本人との類似度", title="照明・顔の向きと照合結果")
    fig.tight_layout()
    png = out_dir / f"eval_{stamp}.png"
    fig.savefig(png); plt.close(fig)

    lines = [
        f"評価日時: {stamp}", f"登録者: {', '.join(db.names)}",
        f"確認用画像: 本人 {cur['本人の画像']}枚 / 未登録者 {cur['未登録者の画像']}枚",
        "", f"■ しきい値 {threshold:.3f} での結果",
        f"  正解           {cur['正解']}",
        f"  本人拒否       {cur['本人拒否']}  (本人を別人・未登録とした例)",
        f"  他人と取違え   {cur['他人と取違え']}",
        f"  未登録受入     {cur['未登録受入']}  (未登録者を本人とした例)",
        f"  顔検出失敗     {cur['顔検出失敗']}",
        "", "■ 推奨しきい値",
        f"  バランス重視: {balanced:.3f}  (誤り率の合計が最小)",
        f"  安全重視    : {safe:.3f}  (未登録受入・取違えが0になる最小値)" if safe is not None
        else "  安全重視    : 見つかりません(本人と他人の類似度が重なっています)",
        "", f"画像ごとの結果: {csv_path}", f"グラフ: {png}",
    ]
    txt = out_dir / f"eval_{stamp}.txt"
    txt.write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))
    return {"counts": cur, "balanced": balanced, "safe": safe, "png": png, "csv": csv_path, "txt": txt}
