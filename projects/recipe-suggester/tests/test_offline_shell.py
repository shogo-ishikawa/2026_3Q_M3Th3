"""公開されるプログラムとホーム画面アイコンを、オフラインで同じ版として使えることを検査。"""
import importlib.util
import json
from pathlib import Path
import re
import struct
import unittest
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('offline_shell', ROOT / 'tools/update_offline_shell.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class OfflineShellTests(unittest.TestCase):
    def test_release_and_import_map_hash_match_sources(self):
        for filename, expected in builder.offline_outputs().items():
            self.assertEqual((ROOT / filename).read_text(), expected,
                             f'{filename} を更新するには python3 tools/update_module_map.py を実行してください。')
        generated = (ROOT / 'assets/pwa-shell.js').read_text()
        files = json.loads(re.search(r'const SHELL_FILES = (\{.*\});', generated, re.S)[1])
        paths = {urlsplit(url).path for url in files}
        self.assertTrue({'index.html', 'manifest.webmanifest', 'app.js', 'pwa-ui.js',
                         'launch-screen.js', 'assets/brand/meal-palette-splash.jpg'} <= paths)
        self.assertFalse(any(path.startswith(('assets/recipe-art/', 'dist/', 'docs/')) for path in paths))
        self.assertLess(sum((ROOT / path).stat().st_size for path in paths), 6 * 1024 * 1024)

    def test_home_screen_icons_and_scope(self):
        manifest = json.loads((ROOT / 'manifest.webmanifest').read_text())
        self.assertEqual(manifest['scope'], './')
        self.assertEqual(manifest['start_url'], './')
        self.assertEqual(manifest['display'], 'standalone')
        icons = {(icon['purpose'], icon['sizes']): icon['src'] for icon in manifest['icons']}
        self.assertTrue({('any', '192x192'), ('any', '512x512'), ('maskable', '512x512')} <= icons.keys())
        html = (ROOT / 'index.html').read_text()
        for size in (32, 48):
            filename = f'assets/icons/favicon-{size}.png'
            self.assertIn(f'rel="icon" href="{filename}" sizes="{size}x{size}"', html)
            icons[('favicon', f'{size}x{size}')] = filename
        icons[('apple', '180x180')] = 'assets/icons/apple-touch-icon.png'
        for (_, size), filename in icons.items():
            self.assertEqual((ROOT / filename).read_bytes()[25], 2, 'Icons must be opaque RGB PNGs')
            self.assertEqual(struct.unpack('>II', (ROOT / filename).read_bytes()[16:24]),
                             tuple(map(int, size.split('x'))))
