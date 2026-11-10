"""正解から独立した探索条件・予算・推定・保存内容を検証します。"""
import hashlib
import importlib.util
import json
import unittest
from unittest.mock import patch

from password_core import (
    ALL_CHARACTERS, alphabet_for, generate_password, validate_password,
    make_attack, structure_candidates, candidate_allowed, search_candidates,
    rule_candidates, estimate, brute_search, benchmark, pbkdf2_comparison,
    run_experiment,
)


def measured_python(*args, **kwargs):
    return ([{"engine": "Python", "state": "実測", "count": 8,
              "rate": 100.0, "seconds": 0.08, "prepare_seconds": 0.0}],
            "Python", lambda start, count: None)


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
        for value in ("", "あ", "a b", "a" * 33):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    validate_password(value)

    def test_no_clues_uses_94_characters_and_all_lengths(self):
        attack = make_attack(search_max_length=3, digits=False, search_length=1)
        self.assertEqual(attack["alphabet"], ALL_CHARACTERS)
        self.assertEqual((attack["min_length"], attack["max_length"]), (1, 3))
        self.assertEqual(attack["candidates"], 94 + 94**2 + 94**3)

    def test_attacker_charset_and_known_or_unknown_length(self):
        fixed = make_attack("文字の種類・文字数を指定", search_length=4)
        self.assertEqual(fixed["alphabet"], "0123456789")
        self.assertEqual((fixed["min_length"], fixed["max_length"]), (4, 4))
        varying = make_attack("文字の種類・文字数を指定", length_known=False, search_max_length=4)
        self.assertEqual(varying["candidates"], 11110)
        self.assertTrue(candidate_allowed("0", varying))
        self.assertFalse(candidate_allowed("12345", varying))
        self.assertFalse(candidate_allowed("a", varying))

    def test_intuitive_structure_keeps_fixed_characters_literal(self):
        attack = make_attack("文字の並び・一部を指定", prefix="ab?", suffix="!",
                             group1="小文字", group1_count=2, group2="数字", group2_count=1)
        self.assertEqual(attack["preview"], "ab?＋小文字2文字＋数字1文字＋!")
        self.assertEqual(attack["candidates"], 26**2 * 10)
        self.assertEqual(attack["positions"][2], "?")
        self.assertEqual(next(structure_candidates(attack["positions"])), "ab?aa0!")
        self.assertTrue(candidate_allowed("ab?zz9!", attack))
        self.assertFalse(candidate_allowed("ab?zz!9", attack))
        omitted = make_attack("文字の並び・一部を指定", prefix="sakura",
                              group1="数字", group1_count=4, group2="なし", group2_count=7)
        self.assertEqual(omitted["preview"], "sakura＋数字4文字")
        self.assertEqual(omitted["candidates"], 10000)
        self.assertEqual(omitted["public"]["groups"], [{"kind": "数字", "count": 4}])

    def test_invalid_attack_settings(self):
        bad = [
            {"knowledge": "unknown"}, {"search_max_length": 0},
            {"knowledge": "文字の種類・文字数を指定", "search_length": True},
            {"knowledge": "文字の種類・文字数を指定", "digits": False},
            {"knowledge": "文字の並び・一部を指定", "prefix": "あ"},
            {"knowledge": "文字の並び・一部を指定", "group1": "unknown"},
            {"knowledge": "文字の並び・一部を指定", "group1_count": -1},
            {"knowledge": "文字の並び・一部を指定", "group1_count": 0},
            {"knowledge": "文字の並び・一部を指定", "prefix": "a" * 32},
        ]
        for settings in bad:
            with self.subTest(settings=settings):
                with self.assertRaises(ValueError):
                    make_attack(**settings)

    def test_dictionary_found_and_exhausted(self):
        digest = hashlib.sha256(b"b").digest()
        found = search_candidates("test", ["a", "a", "b"], digest)
        self.assertEqual((found["state"], found["tested"]), ("発見", 2))
        absent = search_candidates("test", ["a"], digest)
        self.assertEqual(absent["state"], "この候補群では未発見")

    def test_dictionary_and_rules_are_filtered_to_attacker_conditions(self):
        digest = hashlib.sha256(b"sakura2026").digest()
        attack = make_attack("文字の種類・文字数を指定", search_length=10)
        row = search_candidates("rule", rule_candidates(), digest, attack=attack)
        self.assertNotEqual(row["state"], "発見")
        self.assertEqual(row["tested"], 4)  # 123456＋2024〜2027だけが条件に合う。
        structure = make_attack("文字の並び・一部を指定", prefix="sakura")
        row = search_candidates("rule", rule_candidates(), digest, attack=structure)
        self.assertEqual(row["state"], "発見")
        self.assertLess(row["tested"], 1000)

    def test_count_limit_really_stops(self):
        digest = hashlib.sha256(b"99").digest()
        row = search_candidates("test", (str(i) for i in range(100)), digest, limit=3)
        self.assertEqual((row["state"], row["tested"]), ("打切り", 3))

    def test_expected_and_exhaustive_times(self):
        row = estimate("0123456789", 4, 100)
        self.assertEqual(row["candidates"], 10000)
        self.assertEqual(row["average_seconds"], 50.005)
        self.assertEqual(row["exhaustive_seconds"], 100.0)
        varying = estimate("0123456789", 4, 100, min_length=1)
        self.assertEqual(varying["candidates"], 11110)
        self.assertEqual(varying["average_seconds"], 55.555)
        self.assertEqual(varying["exhaustive_seconds"], 111.1)
        for bad in (0, float("nan"), float("inf")):
            with self.assertRaises(ValueError):
                estimate("01", 4, bad)

    def test_large_candidate_space_keeps_exact_integer_count(self):
        row = estimate("0123456789", 32, 1000)
        self.assertEqual(row["candidates"], 10**32)

    def test_brute_short_lengths_first_and_shared_candidate_limit(self):
        attack = {"mode": "charset", "alphabet": "01", "min_length": 1, "max_length": 3}
        digest = hashlib.sha256(b"111").digest()
        calls = []
        def factory(name, alphabet, length, target):
            self.assertEqual(target, digest)
            calls.append(length)
            return lambda start, count: None
        with patch("password_core.make_engine", side_effect=factory):
            row = brute_search(attack, digest, limit=5)
        self.assertEqual(calls, [1, 2])
        self.assertEqual((row["state"], row["tested"]), ("打切り", 5))
        row = brute_search(attack, hashlib.sha256(b"11").digest(), limit=14)
        self.assertEqual((row["state"], row["tested"]), ("発見", 6))
        row = brute_search(attack, hashlib.sha256(b"x").digest(), limit=14)
        self.assertEqual((row["state"], row["tested"]), ("全候補で未発見", 14))

    def test_time_limit_is_shared_across_lengths(self):
        attack = {"mode": "charset", "alphabet": "01", "min_length": 1, "max_length": 3}
        clock, lengths = [0.0], []
        def factory(name, alphabet, length, digest):
            lengths.append(length)
            def engine(start, count):
                clock[0] += 0.6
                return None
            return engine
        with patch("password_core.make_engine", side_effect=factory), patch(
                "password_core.time.perf_counter", side_effect=lambda: clock[0]):
            row = brute_search(attack, b"x" * 32, seconds=1, limit=100)
        self.assertEqual(lengths, [1, 2])
        self.assertEqual((row["state"], row["tested"]), ("打切り", 6))

    @patch("password_core.benchmark", side_effect=measured_python)
    def test_correct_answer_never_sets_attacker_range_or_benchmark_length(self, fake):
        attack = make_attack("文字の種類・文字数を指定", search_length=4)
        result = run_experiment("different!", attack, limit=3, include_gpu=False)
        self.assertEqual(fake.call_args.args[0:2], ("0123456789", 4))
        self.assertEqual(result["estimate"]["candidates"], 10000)
        self.assertNotIn("length", result)
        self.assertNotIn("input_within_alphabet", result)
        self.assertEqual(result["trials"][-1]["state"], "打切り")
        self.assertEqual(result["trials"][-1]["tested"], 3)

    @patch("password_core.benchmark", side_effect=measured_python)
    def test_no_clues_does_not_infer_target_length(self, fake):
        attack = make_attack(search_max_length=6)
        run_experiment("a", attack, limit=3, include_gpu=False)
        self.assertEqual(fake.call_args.args[0:2], (ALL_CHARACTERS, 6))

    def test_structure_search_has_separate_measurement_and_no_secret_export(self):
        attack = make_attack("文字の並び・一部を指定", prefix="private", suffix="#",
                             group1="数字", group1_count=2)
        with patch("password_core.benchmark") as generic:
            output = run_experiment("private00#", attack, limit=3, include_gpu=True)
        generic.assert_not_called()
        self.assertEqual([row["method"] for row in output["trials"]],
                         ["辞書", "単語の変形", "指定した並び"])
        self.assertEqual(output["trials"][-1]["state"], "発見")
        self.assertEqual(output["estimate"]["candidates"], 100)
        saved = json.dumps(output)
        for secret in ("private", "private00#", hashlib.sha256(b"private00#").hexdigest()):
            self.assertNotIn(secret, saved)
        self.assertNotIn("positions", saved)
        self.assertNotIn('"prefix"', saved)
        self.assertNotIn('"suffix"', saved)
        self.assertNotIn('"mask"', saved)
        self.assertEqual(output["attack"]["prefix_length"], 7)
        self.assertEqual(output["attack"]["groups"], [{"kind": "数字", "count": 2}])

    def test_all_cpu_engines_use_same_benchmark_candidate_count(self):
        rows, fastest, engine = benchmark("0123", 3,
            hashlib.sha256(b"333").digest(), include_gpu=False, batch=64)
        self.assertTrue(callable(engine))
        measured = [row for row in rows if row["state"] == "実測"]
        self.assertGreaterEqual(len(measured), 1, rows)
        if all(importlib.util.find_spec(name) for name in ("numpy", "numba")):
            self.assertEqual(len(measured), 3, rows)
        self.assertEqual({row["count"] for row in measured}, {64})
        self.assertIn(fastest, {row["engine"] for row in measured})

    def test_pbkdf2_separate_measurement(self):
        rows = pbkdf2_comparison("demo", iterations=10000)
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(row["seconds_per_check"] > 0 for row in rows))


if __name__ == "__main__":
    unittest.main()
