"""固定版のモデルとONNX Runtimeを取得し、サイズとSHA-256を検査します。

追加ライブラリは不要です。利用者の画像や登録データは扱いません。
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import argparse
import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def manifest(root=ROOT):
    payload = json.loads((Path(root) / 'tools' / 'web_assets.json').read_text())
    if payload.get('version') != 1:
        raise ValueError('推論アセット一覧の版が違います。')
    return payload


def checked_path(root, relative):
    root = Path(root).resolve()
    path = root / relative
    if Path(relative).is_absolute() or '..' in Path(relative).parts or root not in path.resolve().parents:
        raise ValueError(f'配布先のパスが不正です：{relative}')
    if path.is_symlink() or any(p.is_symlink() for p in path.parents if p != root and root in p.parents):
        raise ValueError(f'リンク先には保存しません：{relative}')
    return path


def valid(path, item):
    if not path.is_file() or path.is_symlink() or path.stat().st_size != item['size']:
        return False
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest() == item['sha256']


def verify_bytes(data, item):
    if len(data) != item['size'] or hashlib.sha256(data).hexdigest() != item['sha256']:
        raise ValueError('取得したファイルのサイズまたはSHA-256が一致しません。')


def download(item):
    # The URLs are immutable model revisions or an exact npm release, not user input.
    error = None
    for attempt in range(3):
        try:
            request = urllib.request.Request(item['url'], headers={'User-Agent': 'FaceGate-educational-assets/1.0'})
            with urllib.request.urlopen(request, timeout=90) as response:
                if response.status != 200:
                    raise ValueError(f'HTTP {response.status}')
                chunks, size = [], 0
                while block := response.read(1024 * 1024):
                    size += len(block)
                    if size > item['size']:
                        raise ValueError('取得したファイルが指定サイズを超えています。')
                    chunks.append(block)
                data = b''.join(chunks)
            verify_bytes(data, item)
            return data
        except Exception as exc:
            error = exc
            if attempt < 2:
                time.sleep(attempt + 1)
    raise RuntimeError(f"推論アセットを取得できません：{item['url']} ({error})") from error


def write_atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix='face-asset-', delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(data)
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def prepare(root=ROOT):
    root = Path(root)
    lock = manifest(root)

    def fetch_one(item):
        path = checked_path(root, item['path'])
        if not valid(path, item):
            write_atomic(path, download(item))
        return path

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(fetch_one, lock['assets']))
    runtime = lock['runtime']
    if not all(valid(checked_path(root, item['path']), item) for item in runtime['files']):
        archive = download(runtime)
        with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as package:
            # Never unpack arbitrary archive paths; copy only the fixed allowlist.
            for item in runtime['files']:
                member = package.getmember(item['member'])
                if not member.isfile() or member.size != item['size']:
                    raise ValueError('ONNX Runtimeの配布内容が一致しません。')
                data = package.extractfile(member).read()
                verify_bytes(data, item)
                write_atomic(checked_path(root, item['path']), data)
    asset_paths(root)  # A completed fetch also verifies notices and all models.


def asset_paths(root=ROOT):
    """検査済みmodels-web/vendorを列挙。docsのライセンスは通常ソースとして配布。

    ライセンスを含め、1つでも欠落・変更があれば配布前に失敗します。
    アーカイブそのものや任意の追加ファイルは配布に入りません。
    """
    root = Path(root)
    lock = manifest(root)
    items = lock['assets'] + lock['runtime']['files']
    for item in items:
        path = checked_path(root, item['path'])
        if not valid(path, item):
            raise ValueError(f"推論アセットの検査に失敗しました：{item['path']}。python3 tools/fetch_web_assets.pyを実行してください。")
    return [checked_path(root, item['path']) for item in items
            if item['path'].startswith(('models-web/', 'vendor/'))]


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    if not args.verify_only:
        prepare(args.root)
    paths = asset_paths(args.root)
    print(f'検査済み推論アセット：{len(paths)}ファイル、合計{sum(p.stat().st_size for p in paths):,} bytes')
