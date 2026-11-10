"""くじびきラボのPython学習版。標準ライブラリだけで抽選できます。"""
import random
import math


# 元作品の6種類の設定と配当を受け継いでいます。
BONUS_PROBABILITIES = {
    1: {"BIG": 1 / 273.1, "REG": 1 / 439.8},
    2: {"BIG": 1 / 269.7, "REG": 1 / 399.6},
    3: {"BIG": 1 / 269.7, "REG": 1 / 331.0},
    4: {"BIG": 1 / 259.0, "REG": 1 / 315.1},
    5: {"BIG": 1 / 259.0, "REG": 1 / 255.0},
    6: {"BIG": 1 / 255.0, "REG": 1 / 255.0},
}
PAYOUTS = {
    "BIG": 252,
    "REG": 96,
    "ブドウ": 8,
    "チェリー": 2,
    "リプレイ": 3,
    "ベル": 14,
    "ピエロ": 10,
    "ハズレ": 0,
}

# ネオアイムジャグラーEXのメーカー公表値。学生モデルの計算値とは区別します。
OFFICIAL_RETURN_RATES = (0.970, 0.980, 0.995, 1.011, 1.033, 1.055)


def check_integer(name, value, minimum, maximum):
    """入力が範囲内の整数か確認します。"""
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ValueError(f"{name}は{minimum}〜{maximum}の整数にしてください。")


def probabilities(setting, model="student"):
    """設定番号から、役と当選確率のリストを作ります。"""
    check_integer("設定", setting, 1, 6)
    if model not in ("student", "published"):
        raise ValueError("モデルはstudentかpublishedを選んでください。")
    lottery = list(BONUS_PROBABILITIES[setting].items())
    grape_probability = 1 / 5.79 if setting == 6 else 1 / 6.05
    lottery.extend([
        ("ブドウ", grape_probability),
        ("チェリー", 1 / 35.6),
        ("リプレイ", 1 / 7.3),
        ("ベル", 1 / 1024),
        ("ピエロ", 1 / 1024),
    ])
    if model == "published":
        # 未公開の小役確率を推定した値ではなく、平均出玉率を合わせるための仮定です。
        # BIG・REG、配当、ほかの小役は保ち、ブドウと残余のハズレだけを補正します。
        other_payout = sum(p * PAYOUTS[name] for name, p in lottery if name != "ブドウ")
        if PAYOUTS["ブドウ"] <= 0:
            raise ValueError("公表値モデルには正のブドウ配当が必要です。")
        grape_probability = (3 * OFFICIAL_RETURN_RATES[setting - 1] - other_payout) / PAYOUTS["ブドウ"]
        lottery = [(name, grape_probability if name == "ブドウ" else p) for name, p in lottery]
        if not 0 <= grape_probability <= 1 or sum(p for _, p in lottery) > 1:
            raise ValueError("この配当では公表値モデルの確率表を作れません。")
    lottery.append(("ハズレ", 1 - sum(probability for _, probability in lottery)))
    return lottery


def pick_result(value, lottery):
    """0以上1未満の数を、累積確率で役に振り分けます。"""
    if not 0 <= value < 1:
        raise ValueError("乱数は0以上1未満にしてください。")
    cumulative = 0
    for name, probability in lottery:
        cumulative += probability
        if value < cumulative:
            return name
    return "ハズレ"


def expected_delta(setting, play_cost=3, model="student"):
    """1回あたりの理論上の平均収支。1回ごとの結果とは異なります。"""
    check_integer("1回の消費ポイント", play_cost, 1, 100)
    return sum(probability * PAYOUTS[name] for name, probability in probabilities(setting, model)) - play_cost


def simulate(setting=6, games=1000, initial_points=50, play_cost=3, seed=42, model="student"):
    """くじを指定回数引き、収支・回数・ポイント推移を返します。"""
    check_integer("回数", games, 1, 5000)
    check_integer("初期ポイント", initial_points, 0, 1_000_000)
    check_integer("1回の消費ポイント", play_cost, 1, 100)
    check_integer("乱数の種", seed, 0, 2**32 - 1)
    lottery = probabilities(setting, model)
    rng = random.Random(seed)
    balance = initial_points
    counts = {name: 0 for name in PAYOUTS}
    history = [balance]
    earned = 0

    for game in range(games):
        name = pick_result(rng.random(), lottery)
        payout = PAYOUTS[name]
        balance += payout - play_cost
        earned += payout
        counts[name] += 1
        history.append(balance)

    return {
        "setting": setting,
        "model": model,
        "games": games,
        "initial_points": initial_points,
        "play_cost": play_cost,
        "seed": seed,
        "balance": balance,
        "spent": games * play_cost,
        "earned": earned,
        "net": balance - initial_points,
        "counts": counts,
        "history": history,
    }


def compare_settings(games=1000, runs=50, seed=42, initial_points=50, play_cost=3, model="student"):
    """全設定を繰り返し、平均とばらつきを比べます。"""
    check_integer("繰り返し回数", runs, 1, 100)
    check_integer("回数", games, 1, 5000)
    check_integer("乱数の種", seed, 0, 2**32 - 1)
    comparison = []
    for setting in range(1, 7):
        net_results = []
        total_history = [0] * (games + 1)
        for run in range(runs):
            # 同じ試行番号では全設定に同じ乱数列を使います。
            result = simulate(setting, games, initial_points, play_cost, (seed + run) % 2**32, model=model)
            net_results.append(result["net"])
            for index, balance in enumerate(result["history"]):
                total_history[index] += balance
        comparison.append({
            "setting": setting,
            "model": model,
            "mean_net": sum(net_results) / runs,
            "min_net": min(net_results),
            "max_net": max(net_results),
            "positive_rate": sum(net > 0 for net in net_results) / runs,
            "expected_net": expected_delta(setting, play_cost, model) * games,
            "net_results": net_results,
            "mean_history": [balance / runs for balance in total_history],
        })
    return comparison


def theoretical_stats(setting, play_cost=3, model="student"):
    """1回の収支の平均と分散。実機ではなく、この抽選モデルの理論値です。"""
    check_integer("1回の消費ポイント", play_cost, 1, 100)
    lottery = probabilities(setting, model)
    average_payout = sum(p * PAYOUTS[name] for name, p in lottery)
    variance = sum(p * (PAYOUTS[name] - average_payout) ** 2 for name, p in lottery)
    return {
        "model": model,
        "mean": average_payout - play_cost,
        "variance": variance,
        "sd": math.sqrt(variance),
        "return_rate": average_payout / play_cost,
        "official_return_rate": OFFICIAL_RETURN_RATES[setting - 1],
        "bonus_probability": sum(p for name, p in lottery if name in {"BIG", "REG"}),
    }


def quantile(sorted_values, fraction):
    """小さい順の値から、指定した位置の値を線形補間で求めます。"""
    position = (len(sorted_values) - 1) * fraction
    lower = math.floor(position)
    upper = math.ceil(position)
    return sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * (position - lower)


def simulate_distribution(setting=1, games=1000, runs=5000, seed=20261110, play_cost=3, model="student"):
    """同じ条件の最終収支を繰り返し生成。初期ポイントは収支に影響しません。"""
    check_integer("回数", games, 1, 5000)
    check_integer("再試行数", runs, 1, 10000)
    check_integer("乱数の種", seed, 0, 2**32 - 1)
    check_integer("1回の消費ポイント", play_cost, 1, 100)
    if games * runs > 50_000_000:
        raise ValueError("再試行の合計は5000万回以下にしてください。")
    lottery = probabilities(setting, model)
    nets = []
    for run in range(runs):
        rng = random.Random((seed + run) % 2**32)
        net = 0
        for game in range(games):
            name = pick_result(rng.random(), lottery)
            net += PAYOUTS[name] - play_cost
        nets.append(net)
    sorted_nets = sorted(nets)
    return {
        "setting": setting, "model": model, "games": games, "runs": runs, "seed": seed,
        "play_cost": play_cost, "nets": nets, "sorted_nets": sorted_nets,
        "mean_net": sum(nets) / runs,
        "lower95": quantile(sorted_nets, 0.025),
        "upper95": quantile(sorted_nets, 0.975),
        "loss_rate": sum(net < 0 for net in nets) / runs,
    }


def tail_estimate(distribution, observed_net):
    """プラスなら同額以上、マイナスなら同額以下の収支を数えます。"""
    if isinstance(observed_net, bool) or not isinstance(observed_net, (int, float)) or not math.isfinite(observed_net):
        raise ValueError("観測した収支は有限の数にしてください。")
    nets = distribution.get("nets") if isinstance(distribution, dict) else None
    if not isinstance(nets, list) or not nets or any(
        isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in nets
    ):
        raise ValueError("再試行で得た収支のリストが必要です。")
    direction = "upper" if observed_net >= 0 else "lower"
    if direction == "upper":
        count = sum(net >= observed_net for net in nets)
    else:
        count = sum(net <= observed_net for net in nets)
    total = len(nets)
    probability = count / total
    # 二項比率のWilson区間。0件でも上限は0になりません。
    z = 1.959963984540054
    denominator = 1 + z * z / total
    centre = (probability + z * z / (2 * total)) / denominator
    radius = z * math.sqrt(probability * (1 - probability) / total + z * z / (4 * total * total)) / denominator
    return {
        "direction": direction, "count": count, "total": total,
        "probability": probability,
        "lower95": 0.0 if count == 0 else max(0.0, centre - radius),
        "upper95": 1.0 if count == total else min(1.0, centre + radius),
        "one_in": total / count if count else None,
    }


def money_comparison(net, yen_per_point=20):
    """純収支を仮の金額へ換算し、比較用の予算例を返します。実売価格ではありません。"""
    if isinstance(net, bool) or not isinstance(net, (int, float)) or not math.isfinite(net):
        raise ValueError("収支は有限の数にしてください。")
    check_integer("1ポイントの仮換算額", yen_per_point, 1, 1000)
    yen_net = net * yen_per_point
    loss_yen = max(0, -yen_net)
    budgets = [("昼食", 800), ("本", 1500), ("映画", 2000), ("イヤホン", 5000), ("小旅行", 20000)]
    examples = [dict(name=name, price=price, count=math.floor(loss_yen / price)) for name, price in budgets]
    return {"yen_net": yen_net, "loss_yen": loss_yen, "examples": examples}
