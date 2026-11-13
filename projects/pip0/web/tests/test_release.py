"""配布ZIPの完全性と、公開コードに含めない情報の混入を確認します。"""
from pathlib import Path
import importlib.util
import json
import re
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('pip0_web_release', ROOT / 'tools/build_release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def test_archive_is_repeatable_and_has_one_complete_version_root(self):
        first = release.build().read_bytes()
        self.assertEqual(first, release.build().read_bytes())
        version = (ROOT / 'VERSION').read_text().strip()
        self.assertEqual(json.loads((ROOT / 'package.json').read_text())['version'], version)
        with zipfile.ZipFile(release.build()) as archive:
            self.assertIsNone(archive.testzip())
            names = set(archive.namelist())
            expected = {f'v{version}/{p.relative_to(ROOT).as_posix()}' for p in release.public_files()}
            self.assertEqual(names, expected)
            self.assertTrue(all(Path(name).parts[0] == f'v{version}' for name in names))
            self.assertFalse(any('..' in Path(name).parts or '/dist/' in name or '__pycache__' in name for name in names))
            for name in names:
                if name.endswith('.js'):
                    for target in re.findall(r"(?:from\s+|import\s*)['\"](\./[^'\"]+)['\"]", archive.read(name).decode()):
                        self.assertIn((Path(name).parent / target).as_posix(), names, (name, target))

    def test_stage_does_not_touch_sibling_desktop_code(self):
        with tempfile.TemporaryDirectory() as folder:
            desktop = Path(folder) / 'projects/pip0/pip0'
            desktop.mkdir(parents=True)
            sentinel = desktop / 'original.py'
            sentinel.write_bytes(b'original desktop source\n')
            destination = Path(folder) / 'projects/pip0/web'
            release.stage(destination)
            self.assertEqual(sentinel.read_bytes(), b'original desktop source\n')
            self.assertEqual((destination / 'VERSION').read_bytes(), (ROOT / 'VERSION').read_bytes())
            self.assertEqual((destination / 'io.js').read_bytes(), (ROOT / 'io.js').read_bytes())
            self.assertTrue((destination / 'docs/provenance.md').is_file())

    def test_only_browser_material_is_distributed(self):
        paths = [p.relative_to(ROOT).as_posix() for p in release.public_files()]
        self.assertFalse(any(name.endswith(('.ipynb', '.exe', '.dll', '.pdb', '.db', '.sqlite', '.pdf', '.zip')) for name in paths))
        self.assertFalse(any(name.startswith(('student_source/', 'pip0/', 'shell/', 'browser-extension/')) for name in paths))
        self.assertNotIn('CONTRACT.md', paths)

    def test_runtime_has_no_outbound_file_data_channel_or_embedded_credentials(self):
        # 認証情報や作業環境のパスが実行用ファイルへ混入していないことを検査します。
        prohibited = [
            r'\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(',
            r'\bsendBeacon\s*\(', r'\bimport\s*\(\s*[\'\"]https?://',
            r'(?:src|action)\s*=\s*[\'\"]https?://',
            r'(?:ghp_|github_pat_)[A-Za-z0-9_]{15,}',
            r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
            r'/workspace/(?:scratch|shared)/', r'/Users/[^/\s]+/',
            r'[A-Za-z]:\\\\Users\\\\',
        ]
        for filename in release.RUNTIME:
            if not filename.endswith(('.html', '.js', '.css', '.svg')):
                continue
            source = (ROOT / filename).read_text()
            for pattern in prohibited:
                self.assertIsNone(re.search(pattern, source, re.I), (filename, pattern))

    def test_sync_stages_only_the_web_subdirectory_over_https(self):
        source = (ROOT / 'tools/sync_project.sh').read_text()
        self.assertIn('https://github.com/shogo-ishikawa/2026_3Q_M3Th3.git', source)
        self.assertIn('"$CLASS_CHECKOUT/projects/pip0/web"', source)
        self.assertNotRegex(source, r'\brm\s+-rf|\brsync\b[^\n]*--delete')


if __name__ == '__main__':
    unittest.main()
