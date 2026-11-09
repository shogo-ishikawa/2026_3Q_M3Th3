"""ブラウザ版・Python版・説明書をvX.Y.Zフォルダーにまとめます。"""
from pathlib import Path
import zipfile


PROJECT = Path(__file__).resolve().parents[1]


def build():
    version = (PROJECT / "VERSION").read_text().strip()
    output = PROJECT / "dist" / f"lottery-lab_v{version}.zip"
    output.parent.mkdir(exist_ok=True)
    files = [path for path in PROJECT.iterdir() if path.is_file() and path.suffix in {
        ".html", ".css", ".js", ".json", ".py", ".ipynb", ".md",
    }]
    files.append(PROJECT / "VERSION")
    for folder, pattern in [("docs", "*.md"), ("tests", "*.js"), ("tests", "*.py"), ("tools", "*.py")]:
        files.extend((PROJECT / folder).glob(pattern))
    files.append(PROJECT / "tools/index.template.html")
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(files):
            archive.write(path, str(Path(f"v{version}") / path.relative_to(PROJECT)))
    print(f"Created {output} ({len(files)} files)")


if __name__ == "__main__":
    build()
