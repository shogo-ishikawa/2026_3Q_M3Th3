"""Notebookを上から動かし、正解情報・分母・CSVと日本語図を確認する。"""
from contextlib import redirect_stdout
import io
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

os.environ.setdefault("MPLBACKEND", "Agg")
ROOT = Path(__file__).resolve().parents[1]


class NotebookTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.notebook = json.loads((ROOT / "face_recognition_lab.ipynb").read_text(encoding="utf-8"))
        cls.output = tempfile.TemporaryDirectory()
        cls.env = {}
        previous = Path.cwd()
        try:
            os.chdir(cls.output.name)
            with redirect_stdout(io.StringIO()):
                for index, cell in enumerate(cls.notebook["cells"]):
                    if cell["cell_type"] == "code":
                        source = "".join(cell["source"])
                        exec(compile(source, f"facegate-cell-{index}", "exec"), cls.env)
        finally:
            os.chdir(previous)

    @classmethod
    def tearDownClass(cls):
        cls.env["plt"].close("all")
        cls.output.cleanup()

    def test_notebook_rebuild_is_exact_and_outputs_are_clear(self):
        for cell in self.notebook["cells"]:
            if cell["cell_type"] == "code":
                self.assertEqual(cell["outputs"], [])
                self.assertIsNone(cell["execution_count"])
        with tempfile.TemporaryDirectory() as temporary:
            copy = Path(temporary)
            (copy / "tools").mkdir()
            shutil.copyfile(ROOT / "tools/build_notebook.py", copy / "tools/build_notebook.py")
            subprocess.run([sys.executable, str(copy / "tools/build_notebook.py")], check=True, capture_output=True)
            self.assertEqual((copy / "face_recognition_lab.ipynb").read_bytes(),
                             (ROOT / "face_recognition_lab.ipynb").read_bytes())

    def test_cosine_uses_vector_direction_and_rejects_undefined_inputs(self):
        cosine = self.env["cosine_similarity"]
        self.assertAlmostEqual(cosine([1, 0], [2, 0]), 1)
        self.assertAlmostEqual(cosine([1, 0], [1, 1]), math.sqrt(0.5))
        self.assertAlmostEqual(cosine([1, 0], [0, 1]), 0)
        self.assertAlmostEqual(cosine([1, 0], [-1, 0]), -1)
        for first, second in [([], []), ([1], [1, 2]), ([0, 0], [1, 1]), ([math.nan], [1])]:
            with self.assertRaises(ValueError):
                cosine(first, second)

    def test_threshold_equality_and_independent_truth_give_expected_counts(self):
        count = self.env["count_errors"]
        records = self.env["pairs"]
        self.assertEqual(count(records, 0.70), {"本人受入": 6, "本人拒否": 6, "別人受入": 0, "別人拒否": 12})
        self.assertEqual(count(records, 0.55), {"本人受入": 10, "本人拒否": 2, "別人受入": 1, "別人拒否": 11})
        self.assertEqual(count(records, 0.80), {"本人受入": 2, "本人拒否": 10, "別人受入": 0, "別人拒否": 12})
        self.assertEqual(count([{"same_person": True, "similarity": 0.7}], 0.7)["本人受入"], 1)
        for bad in [{"same_person": "False", "similarity": 0.5}, {"same_person": True, "similarity": math.inf}]:
            with self.assertRaises(ValueError):
                count([bad], 0.7)
        with self.assertRaises(ValueError):
            count(records, 1.01)

    def test_rates_use_separate_denominators_and_no_sample_stays_undefined(self):
        rates = self.env["error_rates"]
        self.assertEqual(rates({"本人受入": 3, "本人拒否": 1, "別人受入": 2, "別人拒否": 8}),
                         {"本人拒否率": 0.25, "別人受入率": 0.2})
        self.assertEqual(rates(self.env["count_errors"]([], 0.5)), {"本人拒否率": None, "別人受入率": None})
        false_reject = [row["本人拒否率"] for row in self.env["sweep"]]
        false_accept = [row["別人受入率"] for row in self.env["sweep"]]
        self.assertEqual(false_reject, sorted(false_reject))
        self.assertEqual(false_accept, sorted(false_accept, reverse=True))

    def test_browser_and_python_csv_do_not_treat_predictions_as_ground_truth(self):
        read = self.env["read_session_csv"]
        rows, skipped = read("\ufeff" + self.env["sample_csv"])
        self.assertEqual((len(rows), skipped), (6, 0))
        self.assertEqual(rows[-1]["elapsed"], 5)
        python_csv = ("time,raw_name,similarity,brightness,yaw\n"
                      "2026-01-01T00:00:00,A,0.7,128,0.1\n"
                      "2026-01-01T00:00:01,A,nan,128,0.1\n")
        rows, skipped = read(python_csv)
        self.assertEqual((len(rows), skipped), (1, 1))
        self.assertNotIn("raw_name", rows[0])
        self.assertNotIn("same_person", rows[0])
        self.assertFalse(self.env["LOAD_MY_CSV"])
        self.assertIn("合成", self.env["session_source"])
        invalid_files = [
            "timestamp,name\n2026-01-01T00:00:00,A\n",
            "timestamp,similarity,brightness,yaw\ninvalid,0.2,128,0.1\n",
            "timestamp,similarity,brightness,yaw\n2026-01-01T00:00:00,0.2,128,0.1\n2026-01-01T00:00:01Z,0.3,128,0.2\n",
        ]
        for text in invalid_files:
            with self.assertRaises(ValueError):
                read(text)

    def test_complete_execution_writes_two_figures_with_a_japanese_font(self):
        for filename in ["facegate_threshold_sweep.png", "facegate_session_analysis.png"]:
            self.assertGreater((Path(self.output.name) / filename).stat().st_size, 10_000)
        font_names = self.env["plt"].rcParams["font.family"]
        self.assertTrue(any(any(fragment in name for fragment in ["IPA", "CJK", "Yu Gothic", "Hiragino"])
                            for name in font_names), font_names)


if __name__ == "__main__":
    unittest.main()
