import hashlib
import importlib.util
import os
import unittest

from hash_engines import (
    MAX_BATCH, MAX_INDEX, candidate_from_index, make_engine,
)


class CandidateTests(unittest.TestCase):
    def test_base_conversion(self):
        self.assertEqual(candidate_from_index(0, "abc", 3), "aaa")
        self.assertEqual(candidate_from_index(5, "abc", 3), "abc")
        self.assertEqual(candidate_from_index(26, "abc", 3), "ccc")
        self.assertEqual(
            candidate_from_index(MAX_INDEX, "0123", 32), "1" + "3" * 31
        )

    def test_invalid_settings(self):
        digest = hashlib.sha256(b"a").digest()
        for alphabet, length in [
            ("", 1), ("aa", 1), ("あ", 1),
            ("a", 0), ("a", 33), ("a", True), ("a", 1.5),
        ]:
            with self.subTest(alphabet=alphabet, length=length):
                with self.assertRaises(ValueError):
                    make_engine("Python", alphabet, length, digest)

    def test_invalid_digest_and_name(self):
        for name, digest in [
            ("Python", b"x"), ("Python", "x" * 32), ("unknown", b"x" * 32),
        ]:
            with self.assertRaises(ValueError):
                make_engine(name, "abc", 3, digest)

    def test_invalid_indices(self):
        for index in (-1, 27, True, 0.5):
            with self.assertRaises(ValueError):
                candidate_from_index(index, "abc", 3)
        with self.assertRaises(ValueError):
            candidate_from_index(MAX_INDEX + 1, "0123", 32)

    def test_invalid_ranges(self):
        engine = make_engine("Python", "abc", 3, hashlib.sha256(b"abc").digest())
        for start, count in [
            (-1, 1), (0, -1), (26, 2), (28, 0),
            (True, 1), (0, 1.5), (0, MAX_BATCH + 1),
        ]:
            with self.subTest(start=start, count=count):
                with self.assertRaises(ValueError):
                    engine(start, count)
        self.assertIsNone(engine(27, 0))


class EngineCases:
    """すべての実装を標準hashlibの照合値で確認する。"""

    ENGINE = "Python"

    def check_search(self, alphabet, length, index, start, count):
        text = candidate_from_index(index, alphabet, length)
        digest = hashlib.sha256(text.encode("ascii")).digest()
        engine = make_engine(self.ENGINE, alphabet, length, digest)
        expected = index if start <= index < start + count else None
        self.assertEqual(engine(start, count), expected)

    def test_standard_abc(self):
        engine = make_engine(
            self.ENGINE, "abc", 3, hashlib.sha256(b"abc").digest()
        )
        self.assertEqual(engine(0, 27), 5)
        self.assertIsNone(engine(0, 5))
        self.assertEqual(engine(5, 1), 5)
        self.assertIsNone(engine(6, 21))

    def test_batch_positions(self):
        for index in (10, 15, 19):
            with self.subTest(index=index):
                self.check_search("0123456789", 2, index, 10, 10)

    def test_padding_boundaries(self):
        for length in (1, 3, 4, 7, 8, 15, 16, 31, 32):
            with self.subTest(length=length):
                self.check_search("x", length, 0, 0, 1)

    def test_mixed_characters(self):
        self.check_search("aA0! ", 4, 247, 240, 16)

    def test_no_match(self):
        engine = make_engine(
            self.ENGINE, "abc", 3, hashlib.sha256(b"outside").digest()
        )
        self.assertIsNone(engine(0, 27))

    def test_empty_range(self):
        engine = make_engine(
            self.ENGINE, "abc", 3, hashlib.sha256(b"abc").digest()
        )
        self.assertIsNone(engine(0, 0))
        self.assertIsNone(engine(27, 0))

    def test_signed_index_boundary(self):
        # 4**32 > 2**63でも、表現可能な接頭範囲の実探索は可能。
        self.check_search("0123", 32, MAX_INDEX, MAX_INDEX - 2, 3)
        engine = make_engine(
            self.ENGINE, "0123", 32, hashlib.sha256(b"x").digest()
        )
        self.assertIsNone(engine(MAX_INDEX + 1, 0))
        with self.assertRaises(ValueError):
            engine(MAX_INDEX, 2)


class PythonTests(EngineCases, unittest.TestCase):
    ENGINE = "Python"


@unittest.skipUnless(importlib.util.find_spec("numba"), "Numba未導入")
class NumbaTests(EngineCases, unittest.TestCase):
    ENGINE = "Numba"


@unittest.skipUnless(importlib.util.find_spec("numba"), "Numba未導入")
class NumbaParallelTests(EngineCases, unittest.TestCase):
    ENGINE = "Numba parallel"


@unittest.skipUnless(
    os.environ.get("PASSWORD_LAB_TEST_GPU") == "1", "GPU試験は任意"
)
class GPUTests(EngineCases, unittest.TestCase):
    ENGINE = "GPU"


if __name__ == "__main__":
    unittest.main()
