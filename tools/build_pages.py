"""登録したWeb作品を1つのGitHub Pages公開フォルダーへまとめます。"""
from pathlib import Path, PurePosixPath
import json
import shutil
import tempfile


ROOT = Path(__file__).resolve().parents[1]


def relative_path(value, name):
    """設定に書くパスは、隠しファイルを含まない相対パスに限ります。"""
    if not isinstance(value, str) or not value or "\\" in value:
        raise ValueError(f"{name}には相対パスを指定してください。")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {".", ".."} or part.startswith(".") for part in path.parts):
        raise ValueError(f"{name}に絶対パス、親ディレクトリ、隠しファイルは使えません。")
    if not path.parts:
        raise ValueError(f"{name}が空です。")
    return path


def checked_source(root, relative):
    """公開元までの途中を含め、シンボリックリンクはコピーしません。"""
    current = root
    for part in relative.parts:
        current /= part
        if current.is_symlink():
            raise ValueError(f"シンボリックリンクは公開できません：{relative}")
    if not current.resolve().is_relative_to(root):
        raise ValueError(f"公開元がリポジトリの外です：{relative}")
    if not current.exists():
        raise ValueError(f"公開元が見つかりません：{relative}")
    return current


def collect_files(root, manifest):
    """コピー前に全作品を確認し、公開先と元ファイルの対応を作ります。"""
    if not isinstance(manifest, dict) or not isinstance(manifest.get("projects"), list):
        raise ValueError("pages-projects.jsonにはprojectsのリストが必要です。")
    planned = {PurePosixPath("index.html"): checked_source(root, PurePosixPath("index.html"))}
    destinations = set()

    def register(destination, source):
        if not source.is_file():
            raise ValueError(f"通常のファイルを指定してください：{source.relative_to(root)}")
        if destination in planned or any(destination in other.parents or other in destination.parents for other in planned):
            raise ValueError(f"公開先が重複しています：{destination}")
        planned[destination] = source

    for project in manifest["projects"]:
        if not isinstance(project, dict):
            raise ValueError("作品の設定はオブジェクトで指定してください。")
        source_relative = relative_path(project.get("source"), "source")
        destination = relative_path(project.get("destination"), "destination")
        if source_relative.parts[0] != "projects" or len(source_relative.parts) < 2:
            raise ValueError("sourceはprojects/作品名/以下にしてください。")
        if len(destination.parts) != 2 or destination.parts[0] != "projects":
            raise ValueError("destinationはprojects/作品名の形にしてください。")
        if destination in destinations:
            raise ValueError(f"作品の公開先が重複しています：{destination}")
        destinations.add(destination)
        source_dir = checked_source(root, source_relative)
        if not source_dir.is_dir():
            raise ValueError(f"sourceにはディレクトリを指定してください：{source_relative}")
        files = project.get("files")
        if not isinstance(files, list) or not files:
            raise ValueError("filesには公開するファイルやディレクトリを列挙してください。")
        for item in files:
            included = relative_path(item, "files")
            path = checked_source(root, source_relative / included)
            if path.is_dir():
                for child in sorted(path.rglob("*")):
                    relative = child.relative_to(source_dir)
                    if child.is_symlink():
                        raise ValueError(f"シンボリックリンクは公開できません：{child.relative_to(root)}")
                    if any(part.startswith(".") for part in relative.parts):
                        continue
                    if child.is_file():
                        register(destination / relative.as_posix(), child)
            else:
                register(destination / included, path)
        if destination / "index.html" not in planned:
            raise ValueError(f"作品のindex.htmlをfilesに含めてください：{destination}")
    return planned


def build(root=ROOT):
    """出力先はリポジトリ直下の_siteに固定し、元コードを削除しません。"""
    root = Path(root).resolve()
    output = root / "_site"
    if output.is_symlink() or (output.exists() and not output.is_dir()):
        raise ValueError("_siteは通常の出力ディレクトリである必要があります。")
    manifest = json.loads((root / "pages-projects.json").read_text(encoding="utf-8"))
    planned = collect_files(root, manifest)
    # 入力の確認とコピーが終わるまでは、前回の公開フォルダーを残します。
    with tempfile.TemporaryDirectory(prefix=".pages-", dir=root) as temporary:
        stage = Path(temporary)
        for destination, source in planned.items():
            target = stage / destination
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (stage / ".nojekyll").write_text("", encoding="utf-8")
        if output.exists():
            shutil.rmtree(output)
        shutil.move(str(stage), str(output))
    return output


if __name__ == "__main__":
    destination = build()
    print(f"Created {destination.relative_to(ROOT)}: gallery and registered projects")
