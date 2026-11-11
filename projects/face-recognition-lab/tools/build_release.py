"""公開用ソースと検査済み推論アセットを1つの配布ZIPにまとめます。"""
from pathlib import Path
import json
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ROOT_FILES = ('README.md', '.gitignore', 'VERSION', 'package.json', 'THIRD_PARTY_NOTICES.md',
              'index.html', 'styles.css', 'app.js', 'engine.js', 'model-config.js', 'browser-store.js',
              'face_recognition_lab.ipynb')
SOURCE_SUFFIXES = {'.md', '.py', '.js', '.mjs', '.json', '.html', '.css', '.bat', '.sh', '.txt'}
OMIT_PARTS = {'__pycache__', '.pytest_cache', '.venv', 'node_modules', '_artifacts', 'data',
              'logs', 'reports', 'screenshots', 'models', 'dist'}


def public_sources(root=ROOT):
    root = Path(root)
    for name in ROOT_FILES:
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


def build(root=ROOT):
    root = Path(root)
    version = (root / 'VERSION').read_text().strip()
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('VERSIONにはX.Y.Zを指定してください。')
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
