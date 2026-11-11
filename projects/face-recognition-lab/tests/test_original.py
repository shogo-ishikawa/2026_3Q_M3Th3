"""学生の提出ZIPを変更せず、そのまま配布していることを確認します。"""
import importlib.util
import hashlib
from pathlib import Path
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SUBMITTED_SHA256 = '6f03852b146354896d8e6f95ba5222407aa19ac6ebd432195d1cc7d04669c876'


class OriginalTests(unittest.TestCase):
    def test_submitted_archive_is_byte_identical_and_unchanged(self):
        path = ROOT / 'original/facegate-submitted.zip'
        self.assertEqual(path.stat().st_size, 93731)
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), SUBMITTED_SHA256)
        with zipfile.ZipFile(path) as archive:
            self.assertEqual(len(archive.infolist()), 30)
            self.assertIsNone(archive.testzip())
            self.assertIn('face_app/main.py', archive.namelist())

    def test_release_verifies_original_before_packaging(self):
        spec = importlib.util.spec_from_file_location('original_release', ROOT / 'tools/build_release.py')
        release = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(release)
        self.assertEqual(release.verify_original(ROOT), ROOT / 'original/facegate-submitted.zip')


if __name__ == '__main__':
    unittest.main()
