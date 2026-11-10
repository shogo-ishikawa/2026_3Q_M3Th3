"""配布NotebookをリポジトリのPythonファイルなしで実行する確認。"""
import base64
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile
import zlib

ROOT = Path(__file__).resolve().parents[1]


class NotebookTests(unittest.TestCase):
    def test_six_form_cells_and_embedded_sources_match(self):
        notebook = json.loads((ROOT / "sound_analysis_lab.ipynb").read_text())
        self.assertEqual(len(notebook["cells"]), 6)
        for cell in notebook["cells"]:
            self.assertEqual(cell["cell_type"], "code")
            self.assertEqual(cell["metadata"]["cellView"], "form")
            self.assertTrue("".join(cell["source"]).startswith("#@title"))
            self.assertEqual(cell["outputs"], [])
        source = "".join(notebook["cells"][0]["source"])
        import ast
        tree = ast.parse(source)
        assignment = next(node for node in tree.body if isinstance(node, ast.Assign)
                          and any(isinstance(target, ast.Name) and target.id == "embedded_modules" for target in node.targets))
        embedded = ast.literal_eval(assignment.value)
        for filename, encoded in embedded.items():
            self.assertEqual(zlib.decompress(base64.b64decode(encoded)), (ROOT / filename).read_bytes())

    def test_standalone_demo_through_export_and_error_reset(self):
        # 別プロセス・別作業フォルダーなので、隣の.pyを偶然importしない。
        script = r'''
import io, json, os, sys, tempfile, zipfile
from pathlib import Path
from unittest.mock import patch
import IPython.display
notebook = json.loads(Path(sys.argv[1]).read_text())
space = {"__name__": "__main__"}
with patch.object(IPython.display, "display", lambda *args, **kwargs: None):
    for index, cell in enumerate(notebook["cells"]):
        source = "".join(cell["source"])
        if index == 1:
            source = source.replace('range_mode = "全体"', 'range_mode = "区間を指定"').replace('end_seconds = 0 ', 'end_seconds = 0.35 ')
        if index == 4:
            source = source.replace('processing_mode = "加工しない"', 'processing_mode = "高い音を抑える"')
        exec(compile(source, f"cell-{index+1}", "exec"), space)
    lab = space["lab"]
    assert len(lab.analysis["images"]) == 4
    assert len(lab.processing["images"]) == 4
    assert lab.analysis["settings"]["n_fft"] == 2048
    archive = zipfile.ZipFile(io.BytesIO(lab.export_zip()))
    assert len([name for name in archive.namelist() if name.endswith(".png")]) == 8
    assert not any(name.endswith(".wav") for name in archive.namelist())
    assert "analysis/frames_vocals.csv" in archive.namelist()
    metadata = json.loads(archive.read("settings.json"))
    assert metadata["input"]["duration_seconds"] < 0.36
    assert metadata["processing"]["mode"] == "lowpass"
    assert lab.analysis["settings"]["reference_peak"] == lab.processing["settings"]["reference_peak"]
    try:
        lab.analyse(n_fft=8)
    except ValueError:
        pass
    else:
        raise AssertionError("invalid FFT accepted")
    assert lab.analysis is None and lab.processing is None
    try:
        lab.export_zip()
    except RuntimeError:
        pass
    else:
        raise AssertionError("old result exported")
print("standalone demo OK")
'''
        with tempfile.TemporaryDirectory() as folder:
            environment = dict(os.environ, MPLBACKEND="Agg")
            environment.pop("PYTHONPATH", None)
            completed = subprocess.run([sys.executable, "-c", script, str(ROOT / "sound_analysis_lab.ipynb")],
                                       cwd=folder, env=environment, capture_output=True, text=True, timeout=180)
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        self.assertIn("standalone demo OK", completed.stdout)


if __name__ == "__main__":
    unittest.main()
