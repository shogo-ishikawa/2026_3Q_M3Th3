"""実際の配布物に欠落や実行履歴が入らないことを確認します。"""
from pathlib import Path
import importlib.util
import json
import re
import tempfile
import unittest
import zipfile
import ast
import colorsys
import io
import math
import contextlib

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('lumen_release', ROOT / 'tools/build_release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def test_notebook_executes_in_a_clean_namespace(self):
        notebook = json.loads((ROOT / 'lumen_lab.ipynb').read_text())
        environment = {'__name__': '__main__'}
        with contextlib.redirect_stdout(io.StringIO()):
            for cell in notebook['cells']:
                if cell['cell_type'] == 'code':
                    exec(compile(''.join(cell['source']), '<lumen-teaching-cell>', 'exec'), environment)
        self.assertEqual(environment['freq_hz'], 880)
        self.assertIn('#f59e09', environment['result_html'](880, 95))

    def test_release_is_complete_and_repeatable(self):
        first = release.build().read_bytes()
        self.assertEqual(first, release.build().read_bytes())
        with zipfile.ZipFile(release.build()) as archive:
            names = set(archive.namelist())
            self.assertTrue(all(name.startswith('v1.0.0/') and '..' not in Path(name).parts for name in names))
            self.assertFalse(any('/dist/' in name or '__pycache__' in name or '/.git/' in name for name in names))
            for name in names:
                if name.endswith('.js'):
                    for target in re.findall(r"from\s+['\"](\./[^'\"]+)['\"]", archive.read(name).decode()):
                        self.assertIn(str(Path(name).parent / target), names, (name, target))

    def test_public_teaching_notebook_has_no_execution_history(self):
        notebook = json.loads((ROOT / 'lumen_lab.ipynb').read_text())
        self.assertGreater(len(notebook['cells']), 5)
        for cell in notebook['cells']:
            self.assertFalse(cell.get('outputs'))
            self.assertIsNone(cell.get('execution_count'))
            self.assertEqual(cell.get('metadata', {}), {})

    def test_stage_contains_the_current_version(self):
        with tempfile.TemporaryDirectory() as folder:
            release.stage(folder)
            self.assertEqual((Path(folder) / 'VERSION').read_text(), (ROOT / 'VERSION').read_text())
            self.assertEqual((Path(folder) / 'audio.js').read_bytes(), (ROOT / 'audio.js').read_bytes())
            self.assertTrue((Path(folder) / 'docs/provenance.md').is_file())

    def test_teaching_functions_match_student_truth_and_produce_wav(self):
        notebook = json.loads((ROOT / 'lumen_lab.ipynb').read_text())
        environment = {'math': math, 'colorsys': colorsys, 'io': io, 'struct': __import__('struct'), 'wave': __import__('wave')}
        for cell in notebook['cells']:
            if cell['cell_type'] != 'code':
                continue
            functions = [item for item in ast.parse(''.join(cell['source'])).body if isinstance(item, ast.FunctionDef)]
            exec(compile(ast.Module(body=functions, type_ignores=[]), '<teaching-functions>', 'exec'), environment)
        fixtures = json.loads((ROOT / 'tests/original-parity.json').read_text())
        for fixture in fixtures['cases']:
            inputs, expected = fixture['input'], fixture['expected']
            value = environment['compute_targets'](inputs['frequency'], inputs['volume'], inputs['reversed'])
            self.assertEqual(value['colour'], expected['hexColour'])
            self.assertEqual(value['number'], expected['numberValue'])
            self.assertEqual(value['vertices'], expected['vertexCount'])
            self.assertEqual(len(value['points']), expected['shapePointCount'])
        wav = environment['make_sound'](440, 50)
        with __import__('wave').open(io.BytesIO(wav)) as stream:
            self.assertEqual(stream.getframerate(), 22050)
            self.assertEqual(stream.getnframes(), 13230)
            self.assertEqual(stream.getsampwidth(), 2)
            self.assertEqual(stream.getnchannels(), 1)
