"""公開用の一式をvX.Y.Zフォルダーへまとめます。"""
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = "1.0.0"
EXCLUDES = {"dist", "__pycache__", ".pytest_cache", ".git"}


def build():
    output = ROOT / "dist" / f"password-lab_v{VERSION}.zip"
    output.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(ROOT.rglob("*")):
            relative = path.relative_to(ROOT)
            if any(part in EXCLUDES or part.startswith(".") for part in relative.parts):
                continue
            if path.is_file() and not path.is_symlink():
                archive.write(path, Path(f"v{VERSION}") / relative)
    return output


if __name__ == "__main__":
    print(build())
