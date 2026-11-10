"""収支・確率・再現性を、実際のPython抽選で確認します。"""
from pathlib import Path
import math
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lottery import (PAYOUTS, compare_settings, expected_delta, pick_result, probabilities, simulate,
                     theoretical_stats, simulate_distribution, tail_estimate, money_comparison)


class LotteryTests(unittest.TestCase):
    def test_probabilities_and_boundary(self):
        for setting in range(1, 7):
            lottery = probabilities(setting)
            self.assertAlmostEqual(sum(p for _, p in lottery), 1)
            self.assertTrue(all(0 <= p <= 1 for _, p in lottery))
            self.assertEqual(pick_result(0, lottery), "BIG")
            self.assertEqual(pick_result(lottery[0][1], lottery), "REG")
            self.assertEqual(pick_result(math.nextafter(1.0, 0.0), lottery), "ハズレ")

    def test_points_counts_and_reproducibility(self):
        result = simulate(setting=3, games=1000, seed=21)
        self.assertEqual(sum(result["counts"].values()), 1000)
        self.assertEqual(result["spent"], 3000)
        self.assertEqual(result["earned"], sum(PAYOUTS[name] * count for name, count in result["counts"].items()))
        self.assertEqual(result["balance"], 50 + result["earned"] - result["spent"])
        self.assertEqual(result["history"][-1], result["balance"])
        self.assertEqual(len(result["history"]), 1001)
        self.assertEqual(simulate(setting=3, games=1000, seed=21), result)

    def test_can_continue_with_negative_points(self):
        result = simulate(setting=1, games=100, initial_points=0, play_cost=100, seed=42)
        self.assertEqual(result["games"], 100)
        self.assertLess(result["balance"], 0)

    def test_comparison_matches_individual_runs(self):
        rows = compare_settings(games=50, runs=3, seed=73)
        for row in rows:
            singles = [simulate(setting=row["setting"], games=50, seed=73 + run) for run in range(3)]
            nets = [result["net"] for result in singles]
            self.assertEqual(row["net_results"], nets)
            self.assertEqual(row["mean_net"], sum(nets) / 3)
            self.assertEqual(row["min_net"], min(nets))
            self.assertEqual(row["max_net"], max(nets))
            self.assertAlmostEqual(row["mean_history"][-1], 50 + row["mean_net"])
            self.assertAlmostEqual(row["expected_net"], 50 * expected_delta(row["setting"]))

    def test_invalid_inputs(self):
        for kwargs in [{"setting": 7}, {"games": 0}, {"games": 1.5}, {"games": True},
                       {"initial_points": -1}, {"play_cost": 0}, {"seed": -1}, {"seed": 2**32}]:
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                simulate(**kwargs)
        for runs in [0, 101, 1.5, True]:
            with self.subTest(runs=runs), self.assertRaises(ValueError):
                compare_settings(runs=runs)

    def test_theory_matches_exact_two_draw_distribution_and_distinguishes_real_machine(self):
        for setting in range(1, 7):
            lottery = probabilities(setting)
            pairs = [(PAYOUTS[first] + PAYOUTS[second] - 6, p * q)
                     for first, p in lottery for second, q in lottery]
            pair_mean = sum(value * chance for value, chance in pairs)
            pair_variance = sum((value - pair_mean) ** 2 * chance for value, chance in pairs)
            stats = theoretical_stats(setting)
            self.assertAlmostEqual(pair_mean, 2 * stats["mean"])
            self.assertAlmostEqual(pair_variance, 2 * stats["variance"])
            self.assertAlmostEqual(stats["sd"] ** 2, stats["variance"])
            self.assertNotAlmostEqual(stats["return_rate"], stats["official_return_rate"])
        self.assertAlmostEqual(theoretical_stats(1)["official_return_rate"], 0.970)
        self.assertAlmostEqual(theoretical_stats(6)["official_return_rate"], 1.055)

    def test_distribution_reuses_actual_draws_with_wrapped_seed_and_reproduces(self):
        result = simulate_distribution(setting=2, games=40, runs=5, seed=2**32 - 2, play_cost=4)
        singles = [simulate(setting=2, games=40, seed=(2**32 - 2 + index) % 2**32, play_cost=4)
                   for index in range(5)]
        self.assertEqual(result["nets"], [row["net"] for row in singles])
        self.assertEqual(result, simulate_distribution(setting=2, games=40, runs=5, seed=2**32 - 2, play_cost=4))
        self.assertLessEqual(result["lower95"], result["upper95"])
        self.assertAlmostEqual(result["mean_net"], sum(row["net"] for row in singles) / 5)
        single = simulate_distribution(setting=2, games=1, runs=1, seed=0)
        self.assertEqual(single["lower95"], single["nets"][0])
        self.assertEqual(single["upper95"], single["nets"][0])

    def test_tail_is_inclusive_and_uses_all_trials_in_both_directions(self):
        distribution = {"nets": [-5, -2, 0, 2, 2, 10]}
        upper = tail_estimate(distribution, 2)
        lower = tail_estimate(distribution, -2)
        self.assertEqual((upper["direction"], upper["count"], upper["total"]), ("upper", 3, 6))
        self.assertEqual((lower["direction"], lower["count"], lower["total"]), ("lower", 2, 6))
        self.assertEqual(tail_estimate(distribution, 0)["count"], 4)
        self.assertEqual(upper["one_in"], 2)
        rare = tail_estimate(distribution, 11)
        self.assertEqual(rare["count"], 0)
        self.assertIsNone(rare["one_in"])
        self.assertEqual(rare["lower95"], 0)
        self.assertGreater(rare["upper95"], 0)
        self.assertLess(upper["lower95"], upper["probability"])
        self.assertGreater(upper["upper95"], upper["probability"])

    def test_money_uses_net_not_balance_and_never_treats_a_gain_as_loss(self):
        result = simulate(setting=1, games=1, initial_points=50, seed=42)
        money = money_comparison(result["net"], 20)
        self.assertEqual(money["yen_net"], result["net"] * 20)
        self.assertEqual(money["loss_yen"], 60)
        self.assertEqual(money_comparison(1000)["loss_yen"], 0)
        self.assertTrue(all(example["count"] == 0 for example in money_comparison(1000)["examples"]))
        lunch = money_comparison(-200)["examples"][0]
        self.assertEqual((lunch["name"], lunch["price"], lunch["count"]), ("昼食", 800, 5))

    def test_risk_analysis_rejects_invalid_limits_and_nonfinite_values(self):
        for kwargs in [{"runs": 0}, {"runs": 10001}, {"games": 5001}, {"seed": -1}, {"play_cost": 0}]:
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                simulate_distribution(**kwargs)
        for value in [True, math.inf, math.nan, "10"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                money_comparison(value)
            with self.subTest(value=value), self.assertRaises(ValueError):
                tail_estimate({"nets": [0]}, value)
        for distribution in [{"nets": []}, {"nets": [math.nan]}, None]:
            with self.subTest(distribution=distribution), self.assertRaises(ValueError):
                tail_estimate(distribution, 1)

    def test_published_model_matches_average_without_changing_bonus_or_other_small_roles(self):
        for setting in range(1, 7):
            student = dict(probabilities(setting, "student"))
            published = dict(probabilities(setting, "published"))
            self.assertAlmostEqual(sum(published.values()), 1)
            self.assertTrue(all(0 <= p <= 1 for p in published.values()))
            for name in PAYOUTS:
                if name not in {"ブドウ", "ハズレ"}:
                    self.assertEqual(published[name], student[name])
            stats = theoretical_stats(setting, model="published")
            self.assertAlmostEqual(stats["return_rate"], stats["official_return_rate"], places=13)
            self.assertAlmostEqual(expected_delta(setting, model="published"),
                                   3 * (stats["official_return_rate"] - 1), places=13)
        self.assertGreater(expected_delta(3, model="student"), 0)
        self.assertLess(expected_delta(3, model="published"), 0)

    def test_model_is_recorded_and_used_in_comparison_and_distribution(self):
        self.assertEqual(simulate(seed=21), simulate(seed=21, model="student"))
        self.assertEqual(probabilities(6), probabilities(6, "student"))
        self.assertEqual(theoretical_stats(6), theoretical_stats(6, model="student"))
        rows = compare_settings(games=30, runs=3, seed=21, model="published")
        for row in rows:
            self.assertEqual(row["model"], "published")
            singles = [simulate(setting=row["setting"], games=30, seed=21 + run, model="published")
                       for run in range(3)]
            self.assertEqual(row["net_results"], [value["net"] for value in singles])
            self.assertAlmostEqual(row["expected_net"], 30 * expected_delta(row["setting"], model="published"))
        distribution = simulate_distribution(setting=2, games=30, runs=3, seed=21, model="published")
        self.assertEqual(distribution["model"], "published")
        self.assertEqual(distribution["nets"], rows[1]["net_results"])
        for function in [probabilities, expected_delta, theoretical_stats]:
            with self.subTest(function=function.__name__), self.assertRaises(ValueError):
                function(1, model="official-exact")
        for function in [simulate, compare_settings, simulate_distribution]:
            with self.subTest(function=function.__name__), self.assertRaises(ValueError):
                function(model="official-exact")


if __name__ == "__main__":
    unittest.main()
