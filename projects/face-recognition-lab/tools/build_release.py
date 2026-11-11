"""公開用ソースと検査済み推論アセットを1つの配布ZIPにまとめます。"""
from pathlib import Path
import json
import re
import zipfile
import hashlib
import stat
from pathlib import PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
ROOT_FILES = ('README.md', '.gitignore', 'VERSION', 'package.json', 'THIRD_PARTY_NOTICES.md',
              'index.html', 'styles.css', 'app.js', 'engine.js', 'model-config.js', 'browser-store.js',
              'tracking.js', 'inference-client.js', 'inference-worker.js',
              'face_recognition_lab.ipynb')
ORIGINAL_FILES = ('original/README.md', 'original/manifest.json', 'original/facegate-submitted.zip')
SOURCE_SUFFIXES = {'.md', '.py', '.js', '.mjs', '.json', '.html', '.css', '.bat', '.sh', '.txt'}
OMIT_PARTS = {'__pycache__', '.pytest_cache', '.venv', 'node_modules', '_artifacts', 'data',
              'logs', 'reports', 'screenshots', 'models', 'dist'}


def public_sources(root=ROOT):
    root = Path(root)
    for name in (*ROOT_FILES, *ORIGINAL_FILES):
        path = root / name
        if not path.is_file() or path.is_symlink():
            raise ValueError(f'配布ファイルがありません：{name}')
        yield path
    for folder in ('docs', 'tools', 'tests', 'local'):
        directory = root / folder
        for path in sorted(directory.rglob('*')):
            relative = path.relative_to(root)
            if path.is_symlink():
                raise ValueError(f'リンクは配布しません：{relative}')
            if any(p.startswith('.') or p in OMIT_PARTS for p in relative.parts):
                continue
            if path.is_file() and path.suffix in SOURCE_SUFFIXES and not path.name.endswith('_log.txt'):
                yield path


def public_files(root=ROOT):
    root = Path(root)
    yield from public_sources(root)
    # 検査済みアセットの列挙は取得スクリプトと同じものを使います。
    import importlib.util
    import sys
    spec = importlib.util.spec_from_file_location('face_web_assets', root / 'tools' / 'fetch_web_assets.py')
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    for path in module.asset_paths(root):
        path = Path(path)
        if path.is_symlink() or not path.is_file():
            raise ValueError(f'検査済みアセットがありません：{path}')
        yield path


def verify_original(root=ROOT):
    root = Path(root)
    directory = root / 'original'
    if directory.is_symlink():
        raise ValueError('元提出版の保存先にリンクは使えません。')
    manifest = directory / 'manifest.json'
    archive = directory / 'facegate-submitted.zip'
    if manifest.is_symlink() or archive.is_symlink():
        raise ValueError('元提出版にリンクは使えません。')
    metadata = json.loads(manifest.read_text(encoding='utf-8'))
    if (metadata.get('file') != archive.name
            or type(metadata.get('bytes')) is not int
            or not re.fullmatch(r'[0-9a-f]{64}', metadata.get('sha256', ''))):
        raise ValueError('元提出版の検査情報を確認してください。')
    content = archive.read_bytes()
    if len(content) != metadata['bytes'] or hashlib.sha256(content).hexdigest() != metadata['sha256']:
        raise ValueError('元提出版のZIPが提出時の内容から変わっています。')
    with zipfile.ZipFile(archive) as zipped:
        for member in zipped.infolist():
            name = PurePosixPath(member.filename)
            if (name.is_absolute() or '..' in name.parts or '\\' in member.filename
                    or not name.parts or name.parts[0] != 'face_app'
                    or stat.S_ISLNK(member.external_attr >> 16)):
                raise ValueError('元提出版のZIP内に不正なパスがあります。')
        if zipped.testzip() is not None:
            raise ValueError('元提出版のZIPが壊れています。')
    return archive


def build(root=ROOT):
    root = Path(root)
    version = (root / 'VERSION').read_text().strip()
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('VERSIONにはX.Y.Zを指定してください。')
    verify_original(root)
    files = list(public_files(root))
    for nb in (root / 'face_recognition_lab.ipynb',):
        notebook = json.loads(nb.read_text())
        if any(c.get('outputs') or c.get('execution_count') is not None for c in notebook['cells']):
            raise ValueError('Notebookの出力を消去してください。')
    destination = root / 'dist' / f'facegate_v{version}.zip'
    destination.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            relative = path.relative_to(root)
            info = zipfile.ZipInfo(f'v{version}/{relative.as_posix()}', (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes())
    return destination


if __name__ == '__main__':
    print(build())
