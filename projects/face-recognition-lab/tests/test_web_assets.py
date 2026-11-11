"""配布用推論アセットの欠落・破損・任意ファイル混入を確認。通信はしない。"""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('web_assets', Path(__file__).resolve().parents[1] / 'tools' / 'fetch_web_assets.py')
assets = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(assets)


class WebAssetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'tools').mkdir()
        self.model = self.item('models-web/model.onnx', b'fixed-model')
        self.notice = self.item('docs/licences/model.txt', b'fixed-notice')
        self.runtime = self.item('vendor/runtime.wasm', b'fixed-runtime')
        self.runtime['member'] = 'package/dist/runtime.wasm'
        self.lock = {'version': 1, 'assets': [self.model, self.notice],
                     'runtime': {'url': 'https://example.invalid/fixed.tgz', 'files': [self.runtime]}}
        self.save()

    def item(self, path, data):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return {'path': path, 'url': 'https://example.invalid/' + path,
                'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}

    def save(self):
        (self.root / 'tools/web_assets.json').write_text(json.dumps(self.lock))

    def test_verified_allowlist_excludes_unlisted_files_and_source_notices(self):
        (self.root / 'models-web/private.txt').write_text('do not distribute')
        self.assertEqual({p.relative_to(self.root).as_posix() for p in assets.asset_paths(self.root)},
                         {'models-web/model.onnx', 'vendor/runtime.wasm'})
        with patch.object(assets, 'download', side_effect=AssertionError('Unexpected network access')):
            assets.prepare(self.root)

    def test_same_size_corruption_and_missing_notice_fail_before_packaging(self):
        path = self.root / self.model['path']
        path.write_bytes(b'x' * self.model['size'])
        with self.assertRaisesRegex(ValueError, '検査に失敗'):
            assets.asset_paths(self.root)
        path.write_bytes(b'fixed-model')
        (self.root / self.notice['path']).unlink()
        with self.assertRaisesRegex(ValueError, 'licences'):
            assets.asset_paths(self.root)

    def test_links_and_parent_traversal_are_rejected(self):
        path = self.root / self.model['path']
        path.unlink()
        path.symlink_to(self.root / self.runtime['path'])
        with self.assertRaisesRegex(ValueError, 'リンク'):
            assets.asset_paths(self.root)
        with self.assertRaises(ValueError):
            assets.checked_path(self.root, '../outside.onnx')

    def test_archive_only_copies_verified_members_and_ignores_traversal_entries(self):
        (self.root / self.runtime['path']).unlink()
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode='w:gz') as archive:
            for name, value in [('package/dist/runtime.wasm', b'fixed-runtime'), ('../escape.txt', b'escape')]:
                member = tarfile.TarInfo(name)
                member.size = len(value)
                archive.addfile(member, io.BytesIO(value))
        payload = data.getvalue()
        self.lock['runtime'].update(size=len(payload), sha256=hashlib.sha256(payload).hexdigest())
        self.save()
        with patch.object(assets, 'download', return_value=payload):
            assets.prepare(self.root)
        self.assertEqual((self.root / self.runtime['path']).read_bytes(), b'fixed-runtime')
        self.assertFalse((self.root / 'escape.txt').exists())
        self.assertFalse((self.root.parent / 'escape.txt').exists())


if __name__ == '__main__':
    unittest.main()
