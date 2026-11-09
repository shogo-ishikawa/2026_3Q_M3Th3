"""くじびきラボのPython学習版。標準ライブラリだけで抽選できます。"""
import random


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


def check_integer(name, value, minimum, maximum):
    """入力が範囲内の整数か確認します。"""
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ValueError(f"{name}は{minimum}〜{maximum}の整数にしてください。")


def probabilities(setting):
    """設定番号から、役と当選確率のリストを作ります。"""
    check_integer("設定", setting, 1, 6)
    lottery = list(BONUS_PROBABILITIES[setting].items())
    grape_probability = 1 / 5.79 if setting == 6 else 1 / 6.05
    lottery.extend([
        ("ブドウ", grape_probability),
        ("チェリー", 1 / 35.6),
        ("リプレイ", 1 / 7.3),
        ("ベル", 1 / 1024),
        ("ピエロ", 1 / 1024),
    ])
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


def expected_delta(setting, play_cost=3):
    """1回あたりの理論上の平均収支。1回ごとの結果とは異なります。"""
    check_integer("1回の消費ポイント", play_cost, 1, 100)
    return sum(probability * PAYOUTS[name] for name, probability in probabilities(setting)) - play_cost


def simulate(setting=6, games=1000, initial_points=50, play_cost=3, seed=42):
    """くじを指定回数引き、収支・回数・ポイント推移を返します。"""
    check_integer("回数", games, 1, 5000)
    check_integer("初期ポイント", initial_points, 0, 1_000_000)
    check_integer("1回の消費ポイント", play_cost, 1, 100)
    check_integer("乱数の種", seed, 0, 2**32 - 1)
    lottery = probabilities(setting)
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


def compare_settings(games=1000, runs=50, seed=42, initial_points=50, play_cost=3):
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
            result = simulate(setting, games, initial_points, play_cost, (seed + run) % 2**32)
            net_results.append(result["net"])
            for index, balance in enumerate(result["history"]):
                total_history[index] += balance
        comparison.append({
            "setting": setting,
            "mean_net": sum(net_results) / runs,
            "min_net": min(net_results),
            "max_net": max(net_results),
            "positive_rate": sum(net > 0 for net in net_results) / runs,
            "expected_net": expected_delta(setting, play_cost) * games,
            "net_results": net_results,
            "mean_history": [balance / runs for balance in total_history],
        })
    return comparison
