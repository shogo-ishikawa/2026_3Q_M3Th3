"""配布Notebook単体を上から実行し、独立した攻撃条件と保存まで確認します。"""
import ast
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from password_core import alphabet_for, generate_password, validate_password

ROOT = Path(__file__).resolve().parents[1]
HAS_NOTEBOOK_DEPENDENCIES = all(
    importlib.util.find_spec(name) is not None for name in ("numpy", "numba", "IPython")
)


class NotebookTests(unittest.TestCase):
    def test_clean_form_cells_and_embedded_source(self):
        nb = json.loads((ROOT / "password_lab.ipynb").read_text(encoding="utf-8"))
        code = [c for c in nb["cells"] if c["cell_type"] == "code"]
        self.assertEqual(len(code), 5)
        for cell in code:
            source = "".join(cell["source"])
            self.assertTrue(source.startswith("#@title"))
            self.assertEqual(cell["metadata"]["cellView"], "form")
            self.assertIsNone(cell["execution_count"])
            self.assertEqual(cell["outputs"], [])
            ast.parse(source)
        setup = "".join(code[0]["source"])
        self.assertNotIn("__HASH_MODULE_LITERAL__", setup)
        self.assertNotIn("__CORE_MODULE_LITERAL__", setup)
        search = "".join(code[2]["source"])
        self.assertIn('attack_knowledge = "手がかりなし"', search)
        self.assertIn('"文字の種類・文字数を指定"', search)
        self.assertIn('"文字の並び・一部を指定"', search)
        self.assertNotIn("mask_pattern", search)
        self.assertNotIn("?d", search)
        self.assertNotIn("len(password)", search)
        self.assertNotIn("generation_alphabet", search)

    def test_notebook_is_reproducible(self):
        original = (ROOT / "password_lab.ipynb").read_bytes()
        subprocess.run([sys.executable, str(ROOT / "tools/build_notebook.py")], check=True)
        self.assertEqual((ROOT / "password_lab.ipynb").read_bytes(), original)

    def test_generation_options_do_not_block_demo_or_manual_input(self):
        nb = json.loads((ROOT / "password_lab.ipynb").read_text(encoding="utf-8"))
        cell = next(c for c in nb["cells"] if c["metadata"]["id"] == "prepare-password")
        source = "".join(cell["source"])
        for flag in ("use_digits", "use_lower", "use_upper"):
            source = source.replace(f"{flag} = True", f"{flag} = False")
        namespace = {"alphabet_for": alphabet_for, "generate_password": generate_password,
                     "validate_password": validate_password}
        exec(source, namespace)
        self.assertEqual(namespace["password"], "4729")
        manual = source.replace('source_mode = "デモ：数字4桁"', 'source_mode = "自分で入力"')
        with patch("getpass.getpass", return_value="safe-demo"):
            exec(manual, namespace)
        self.assertEqual(namespace["password"], "safe-demo")
        automatic = source.replace('source_mode = "デモ：数字4桁"', 'source_mode = "自動生成"')
        with self.assertRaises(ValueError):
            exec(automatic, namespace)
        self.assertIsNone(namespace["password"])
        self.assertIsNone(namespace["experiment"])

    @unittest.skipUnless(HAS_NOTEBOOK_DEPENDENCIES, "単体実行にはNumPy・Numba・IPythonが必要")
    def test_standalone_notebook_all_attack_modes_and_export(self):
        nb = json.loads((ROOT / "password_lab.ipynb").read_text(encoding="utf-8"))
        sources = ["".join(c["source"]) for c in nb["cells"] if c["cell_type"] == "code"]
        sources[0] = sources[0].replace("gpu_enabled = True", "gpu_enabled = False")
        known = sources[2].replace(
            'attack_knowledge = "手がかりなし"', 'attack_knowledge = "文字の種類・文字数を指定"'
        )
        script = "\n".join([sources[0], sources[1], known, sources[3], sources[4]])
        script += '''
import zipfile, json
assert experiment is not None
assert any(row["state"] == "発見" for row in experiment["trials"])
with zipfile.ZipFile("password_lab_results.zip") as archive:
    saved = json.loads(archive.read("results.json"))
    assert set(archive.namelist()) == {"results.json", "search_results.csv", "README.txt"}
    assert "password" not in saved and "digest" not in saved and "mask" not in saved
    assert all("candidate" not in row for row in saved["trials"])
    assert saved["attack"]["max_length"] == 4 and saved["attack"]["alphabet_size"] == 10
    assert "length" not in saved and "input_within_alphabet" not in saved
print("Standalone notebook and export passed")
'''
        unknown = sources[2].replace("search_max_length = 6", "search_max_length = 2").replace(
            "candidate_limit = 100000", "candidate_limit = 20"
        )
        structured = sources[2].replace(
            'attack_knowledge = "手がかりなし"', 'attack_knowledge = "文字の並び・一部を指定"'
        ).replace('fixed_prefix = ""', 'fixed_prefix = "private"').replace(
            'fixed_suffix = ""', 'fixed_suffix = "#"'
        ).replace("group_1_count = 4", "group_1_count = 2")
        script += f'''
exec({unknown!r})
assert experiment["attack"]["min_length"] == 1
assert experiment["attack"]["max_length"] == 2
assert experiment["attack"]["alphabet_size"] == 94
assert experiment["estimate"]["candidates"] == 94 + 94**2
password = "private00#"
exec({structured!r})
assert [r["method"] for r in experiment["trials"]] == ["辞書", "単語の変形", "指定した並び"]
assert experiment["trials"][-1]["state"] == "発見"
with zipfile.ZipFile(io.BytesIO(results_zip_bytes(experiment, None))) as archive:
    encoded = archive.read("results.json").decode()
    assert "private" not in encoded and "positions" not in encoded
    assert '"prefix"' not in encoded and '"suffix"' not in encoded
password = "outside!"
exec({known.replace("candidate_limit = 100000", "candidate_limit = 3")!r})
assert experiment["trials"][-1]["state"] == "打切り"
assert experiment["trials"][-1]["tested"] == 3
assert experiment["estimate"]["candidates"] == 10000
print("Independent attack settings passed")
'''
        invalid_storage = sources[3].replace("pbkdf2_iterations = 100000", "pbkdf2_iterations = 0")
        invalid_input = sources[1].replace(
            'source_mode = "デモ：数字4桁"', 'source_mode = "自動生成"'
        ).replace("password_length = 4", "password_length = 0")
        script += f'''
try:
    exec({invalid_storage!r})
except ValueError:
    pass
else:
    raise AssertionError("invalid storage setting was accepted")
assert storage_comparison is None
try:
    exec({invalid_input!r})
except ValueError:
    pass
else:
    raise AssertionError("invalid password length was accepted")
assert password is None and experiment is None
try:
    exec({known!r})
except ValueError:
    pass
else:
    raise AssertionError("stale password was searched after an input error")
'''
        with tempfile.TemporaryDirectory() as directory:
            completed = subprocess.run(
                [sys.executable, "-c", script], cwd=directory,
                text=True, capture_output=True, timeout=180,
            )
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        self.assertIn("Standalone notebook and export passed", completed.stdout)
        self.assertIn("Independent attack settings passed", completed.stdout)


if __name__ == "__main__":
    unittest.main()
