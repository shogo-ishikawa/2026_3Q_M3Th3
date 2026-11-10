"""配布Notebook単体を上から実行し、結果保存まで確認します。"""
import ast
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


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

    def test_notebook_is_reproducible(self):
        original = (ROOT / "password_lab.ipynb").read_bytes()
        subprocess.run([sys.executable, str(ROOT / "tools/build_notebook.py")], check=True)
        self.assertEqual((ROOT / "password_lab.ipynb").read_bytes(), original)

    def test_standalone_notebook_demo_and_export(self):
        nb = json.loads((ROOT / "password_lab.ipynb").read_text(encoding="utf-8"))
        sources = ["".join(c["source"]) for c in nb["cells"] if c["cell_type"] == "code"]
        # Notebookの埋め込み部品を使います。リポジトリからのimportはしません。
        sources[0] = sources[0].replace("gpu_enabled = True", "gpu_enabled = False")
        script = "\n".join(sources)
        script += '''
import zipfile, json
assert experiment is not None
assert any(row["state"] == "発見" for row in experiment["trials"])
with zipfile.ZipFile("password_lab_results.zip") as archive:
    saved = json.loads(archive.read("results.json"))
    assert set(archive.namelist()) == {"results.json", "search_results.csv", "README.txt"}
    assert "password" not in saved and "digest" not in saved and "mask" not in saved
    assert all("candidate" not in row for row in saved["trials"])
    assert saved["length"] == 4 and saved["alphabet_size"] == 10
print("Standalone notebook and export passed")
'''
        with tempfile.TemporaryDirectory() as directory:
            completed = subprocess.run(
                [sys.executable, "-c", script], cwd=directory,
                text=True, capture_output=True, timeout=180,
            )
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        self.assertIn("Standalone notebook and export passed", completed.stdout)


if __name__ == "__main__":
    unittest.main()
