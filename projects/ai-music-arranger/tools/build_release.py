"""公開用ファイルを vX.Y.Z/ にまとめる。実行結果や音源は含めません。"""
from pathlib import Path
import zipfile

PROJECT = Path(__file__).resolve().parents[1]


def build():
    version = PROJECT.joinpath("VERSION").read_text().strip()
    output = PROJECT / "dist" / f"ai-music-arranger_v{version}.zip"
    output.parent.mkdir(exist_ok=True)
    files = [PROJECT / name for name in (
        "VERSION", "README.md", "requirements.txt", "requirements-dev.txt",
        "ai_music_arranger.ipynb", "setup_environment.py", "music_core.py",
        "audio_input.py", "colab_app.py", ".gitignore",
    )]
    for folder, pattern in [("docs", "*.md"), ("tests", "*.py"), ("tools", "*.py")]:
        files.extend(sorted((PROJECT / folder).glob(pattern)))
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, arcname=str(Path(f"v{version}") / path.relative_to(PROJECT)))
    print(f"Created {output} ({len(files)} files)")


if __name__ == "__main__":
    build()
