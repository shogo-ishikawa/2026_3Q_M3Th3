"""公開するHTMLが参照するプログラムとアイコンを、照合用のハッシュとともに列挙します。"""
import base64
import hashlib
import json
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
IMPORT_MAP = r'<script type="importmap" id="app-module-map">(.*?)</script>'


def digest(data):
    return 'sha256-' + base64.b64encode(hashlib.sha256(data).digest()).decode('ascii')


class EntryFiles(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = {'index.html'}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'link' and attrs.get('rel') in {
                'stylesheet', 'icon', 'mask-icon', 'manifest', 'apple-touch-icon'}:
            self.paths.add(attrs['href'])
        if tag == 'img':
            for attribute in ('src', 'data-src'):
                if attrs.get(attribute):
                    self.paths.add(attrs[attribute])
        if tag == 'script' and 'src' in attrs:
            self.paths.add(attrs['src'])


def offline_outputs(root=ROOT):
    html = (root / 'index.html').read_text()
    mapping = re.search(IMPORT_MAP, html, re.S).group(1)
    # 許可するインラインスクリプトは、この版の対応表だけです。
    html, count = re.subn(r"script-src 'self'(?: 'sha256-[A-Za-z0-9+/=]+')?(?=[ ;])",
                          "script-src 'self' '" + digest(mapping.encode()) + "'", html, count=1)
    if count != 1:
        raise ValueError('index.html の script-src を確認してください。')

    config = root / 'assets/firebase/config.json'
    auth_domain = '*.firebaseapp.com'
    if config.is_file():
        auth_domain = json.loads(config.read_text())['authDomain']
        if not re.fullmatch(r'[a-z0-9-]+\.firebaseapp\.com', auth_domain):
            raise ValueError('Firebase 認証ドメインを確認してください。')
    # 設定を組み込んだビルドでは、そのプロジェクトのログイン用 iframe だけを許可します。
    html = re.sub(r"(frame-src [^;\"]*?https://)(?:\*|[a-z0-9-]+)\.firebaseapp\.com",
                  lambda match: match[1] + auth_domain, html, count=1)
    entries = EntryFiles()
    entries.feed(html)
    entries.paths.update(json.loads(mapping)['imports'].values())
    entries.paths.update(icon['src'] for icon in json.loads(
        (root / 'manifest.webmanifest').read_text())['icons'])
    if config.is_file():
        entries.paths.update(('assets/firebase/config.json', 'assets/firebase/firebase-sdk.js'))

    files = {}
    for url in sorted({name.removeprefix('./') for name in entries.paths}):
        parts = urlsplit(url)
        relative = Path(parts.path)
        if parts.scheme or parts.netloc or relative.is_absolute() or '..' in relative.parts:
            raise ValueError(f'保存対象はこのアプリのファイルに限ります：{url}')
        if parts.path == 'service-worker.js':
            continue  # Worker 自身とその importScripts はブラウザーが別に管理します。
        content = html.encode() if parts.path == 'index.html' else (root / relative).read_bytes()
        files[url] = digest(content)

    listing = json.dumps(files, indent=2, ensure_ascii=False)
    revision = hashlib.sha256(listing.encode()).hexdigest()[:24]
    script = ('/* tools/update_module_map.py が作成します。 */\n'
              f'const SHELL_REVISION = "{revision}";\nconst SHELL_FILES = {listing};\n')
    return {'index.html': html, 'assets/pwa-shell.js': script}


def update():
    for filename, content in offline_outputs().items():
        (ROOT / filename).write_text(content)


if __name__ == '__main__':
    update()
