"""収支・確率・再現性を、実際のPython抽選で確認します。"""
from pathlib import Path
import math
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lottery import PAYOUTS, compare_settings, expected_delta, pick_result, probabilities, simulate


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


if __name__ == "__main__":
    unittest.main()
