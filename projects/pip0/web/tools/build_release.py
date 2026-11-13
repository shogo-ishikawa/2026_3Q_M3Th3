"""Web版の公開用ファイルだけを単一のバージョンフォルダーへ梱包します。"""
from pathlib import Path
import argparse
import re
import shutil
import stat
import zipfile

PROJECT = Path(__file__).resolve().parents[1]
RUNTIME = (
    'index.html', 'styles.css', 'app.js', 'core.js', 'io.js', 'demo.js',
    'icon.svg', 'VERSION', 'package.json', 'README.md',
)
DOCUMENTS = ('docs/manual.md', 'docs/provenance.md', 'docs/validation.md')
TOOLS = ('tools/build_release.py', 'tools/sync_project.sh')


def public_files(project=PROJECT):
    """明示したWeb用ファイルと検証コードだけを返します。"""
    project = Path(project)
    files = [project / name for name in (*RUNTIME, *DOCUMENTS, *TOOLS)]
    tests = project / 'tests'
    if tests.is_symlink():
        raise ValueError('検証用フォルダーにシンボリックリンクは使えません。')
    files += sorted(path for path in tests.iterdir()
                    if path.name.endswith('.test.js') or path.name == 'test_release.py')
    for path in files:
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(project.resolve()):
            raise ValueError(f'公開用ファイルを確認してください：{path.name}')
    return sorted(files)


def stage(destination, project=PROJECT):
    project, destination = Path(project), Path(destination)
    if destination.resolve() == project.resolve():
        raise ValueError('展開先は元のソースとは別にしてください。')
    for source in public_files(project):
        target = destination / source.relative_to(project)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)


def build(project=PROJECT):
    project = Path(project)
    version = (project / 'VERSION').read_text().strip()
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('VERSIONには1.0.0のような番号を指定してください。')
    output = project / 'dist' / f'pip0-web_v{version}.zip'
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for source in public_files(project):
            info = zipfile.ZipInfo(
                f'v{version}/{source.relative_to(project).as_posix()}',
                date_time=(2026, 1, 1, 0, 0, 0),
            )
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            mode = 0o755 if source.suffix == '.sh' else 0o644
            info.external_attr = (stat.S_IFREG | mode) << 16
            archive.writestr(info, source.read_bytes())
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--stage', type=Path)
    args = parser.parse_args()
    if args.stage:
        stage(args.stage)
    else:
        print(build())
