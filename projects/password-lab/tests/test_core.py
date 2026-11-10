"""候補生成、推定の前提、探索結果を検証します。"""
import hashlib
import unittest

from password_core import (
    alphabet_for, generate_password, validate_password, mask_alphabets,
    mask_candidates, search_candidates, rule_candidates, estimate,
    brute_search, benchmark, pbkdf2_comparison,
)
from hash_engines import make_engine


class CoreTests(unittest.TestCase):
    def test_generation_obeys_length_and_alphabet(self):
        for length in (1, 4, 32):
            value = generate_password(length, "0123")
            self.assertEqual(len(value), length)
            self.assertLessEqual(set(value), set("0123"))

    def test_all_printable_character_types_have_94_characters(self):
        self.assertEqual(len(alphabet_for(True, True, True, True)), 94)

    def test_empty_alphabet_rejected(self):
        with self.assertRaises(ValueError):
            alphabet_for(False, False, False, False)

    def test_non_ascii_and_invalid_length_rejected(self):
        for value in ("", "あ", "a b", "a"*33):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    validate_password(value)

    def test_masks_include_fixed_characters_and_order(self):
        self.assertEqual(list(mask_candidates("a?d"))[:3], ["a0", "a1", "a2"])
        self.assertEqual(list(mask_candidates("??")), ["?"])
        for mask in ("", "?x", "?", "?d"*33):
            with self.assertRaises(ValueError):
                mask_alphabets(mask)

    def test_dictionary_found_and_exhausted(self):
        digest = hashlib.sha256(b"b").digest()
        found = search_candidates("test", ["a", "a", "b"], digest)
        self.assertEqual((found["state"], found["tested"]), ("発見", 2))
        absent = search_candidates("test", ["a"], digest)
        self.assertEqual(absent["state"], "この候補群では未発見")

    def test_count_limit_really_stops(self):
        digest = hashlib.sha256(b"99").digest()
        row = search_candidates("test", (str(i) for i in range(100)), digest, limit=3)
        self.assertEqual((row["state"], row["tested"]), ("打切り", 3))

    def test_rules_can_find_pattern_without_full_bruteforce(self):
        row = search_candidates("rule", rule_candidates(),
                                hashlib.sha256(b"sakura2026").digest())
        self.assertEqual(row["state"], "発見")
        self.assertLess(row["tested"], 1000)

    def test_expected_and_exhaustive_times(self):
        row = estimate("0123456789", 4, 100)
        self.assertEqual(row["candidates"], 10000)
        self.assertEqual(row["average_seconds"], 50.005)
        self.assertEqual(row["exhaustive_seconds"], 100.0)
        for bad in (0, float("nan"), float("inf")):
            with self.assertRaises(ValueError):
                estimate("01", 4, bad)

    def test_large_candidate_space_keeps_exact_integer_count(self):
        row = estimate("0123456789", 32, 1000)
        self.assertEqual(row["candidates"], 10**32)

    def test_brute_find_truncate_and_outside_alphabet(self):
        digest = hashlib.sha256(b"11").digest()
        engine = make_engine("Python", "01", 2, digest)
        row = brute_search("11", "01", engine, limit=4)
        self.assertEqual(row["state"], "発見")
        self.assertEqual(row["tested"], 4)
        row = brute_search("11", "01", engine, limit=2)
        self.assertEqual(row["state"], "打切り")
        row = brute_search("2", "01", engine)
        self.assertTrue(row["state"].startswith("対象外"))

    def test_all_cpu_engines_use_same_benchmark_candidate_count(self):
        rows, fastest, engine = benchmark("0123", 3,
            hashlib.sha256(b"333").digest(), include_gpu=False, batch=64)
        self.assertTrue(callable(engine))
        measured = [row for row in rows if row["state"] == "実測"]
        self.assertEqual(len(measured), 3, rows)
        self.assertEqual({row["count"] for row in measured}, {64})
        self.assertIn(fastest, {row["engine"] for row in measured})

    def test_pbkdf2_separate_measurement(self):
        rows = pbkdf2_comparison("demo", iterations=10000)
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(row["seconds_per_check"] > 0 for row in rows))


if __name__ == "__main__":
    unittest.main()
