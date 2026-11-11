"""顔の登録情報や実験記録が配布ZIPへ混ざらないことを確認します。"""
from pathlib import Path
import importlib.util
import json
import tempfile
import unittest
import zipfile
import hashlib

PROJECT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('face_release', PROJECT / 'tools' / 'build_release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def fixture(self, root):
        for name in release.ROOT_FILES:
            (root / name).parent.mkdir(parents=True, exist_ok=True)
            (root / name).write_text('{}')
        (root / 'VERSION').write_text('1.0.0\n')
        (root / 'face_recognition_lab.ipynb').write_text(json.dumps({'cells': []}))
        for folder in ('docs', 'tools', 'tests', 'local'):
            (root / folder).mkdir()
        (root / 'tools/fetch_web_assets.py').write_text('def asset_paths(root):\n    return []\n')
        (root / 'local/main.py').write_text('# public source\n')
        original = root / 'original'
        original.mkdir()
        (original / 'README.md').write_text('Original submission')
        archive = original / 'facegate-submitted.zip'
        with zipfile.ZipFile(archive, 'w') as zipped:
            zipped.writestr('face_app/main.py', '# original source')
        content = archive.read_bytes()
        (original / 'manifest.json').write_text(json.dumps({
            'file': archive.name, 'bytes': len(content),
            'sha256': hashlib.sha256(content).hexdigest()}))

    def test_personal_runtime_files_are_absent_and_archive_is_repeatable(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            for name in ('local/data/face_db.json', 'local/data/face_db.npz',
                         'local/logs/session_person.csv', 'local/reports/person.html',
                         'local/screenshots/person.png', 'local/error_log.txt',
                         'local/.venv/key.py', 'tools/__pycache__/private.py'):
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text('private registration or history')
            output = release.build(root)
            first = output.read_bytes()
            with zipfile.ZipFile(output) as archive:
                self.assertIn('v1.0.0/local/main.py', archive.namelist())
                self.assertFalse(any(b'private registration' in archive.read(name) for name in archive.namelist()))
                self.assertTrue(all(name.startswith('v1.0.0/') for name in archive.namelist()))
            self.assertEqual(first, release.build(root).read_bytes())

    def test_symlink_and_notebook_outputs_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            (root / 'local/linked.py').symlink_to(root / 'README.md')
            with self.assertRaises(ValueError):
                release.build(root)
            (root / 'local/linked.py').unlink()
            (root / 'face_recognition_lab.ipynb').write_text(json.dumps({'cells': [
                {'cell_type': 'code', 'execution_count': 1, 'outputs': [{'text': 'a personal result'}]}
            ]}))
            with self.assertRaises(ValueError):
                release.build(root)


if __name__ == '__main__':
    unittest.main()
