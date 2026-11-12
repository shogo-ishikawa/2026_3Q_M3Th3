"""Publishable LOOP ROOM files only, packed beneath one versioned directory."""

from pathlib import Path
import re
import stat
import zipfile


PROJECT = Path(__file__).resolve().parents[1]
RUNTIME = (
    "index.html", "styles.css", "app.js", "core.js", "engine.js", "demo.js",
    "storage.js", "README.md", "VERSION", "docs/manual.md", "docs/source-review.md",
)


def build(project=PROJECT):
    project = Path(project)
    version = (project / "VERSION").read_text(encoding="utf-8").strip()
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("VERSION must contain a semantic version such as 1.0.0")
    missing = [name for name in RUNTIME if not (project / name).is_file()]
    if missing:
        raise FileNotFoundError("Missing release files: " + ", ".join(missing))

    output = project / "dist" / f"dj-lab_v{version}.zip"
    output.parent.mkdir(exist_ok=True)
    root = f"v{version}/"
    launchers = {
        "start_windows.bat": (
            '@echo off\r\ncd /d "%~dp0"\r\n'
            'echo Open http://localhost:8000/ in your browser.\r\n'
            'echo Press Ctrl+C to stop the server.\r\n'
            'py -m http.server 8000 --bind 127.0.0.1\r\npause\r\n'
        ).encode("ascii"),
        "start_mac.command": (
            '#!/bin/sh\ncd -- "$(dirname -- "$0")" || exit 1\n'
            'printf "%s\\n" "Open http://localhost:8000/ in your browser." '
            '"Press Ctrl+C to stop the server."\n'
            'python3 -m http.server 8000 --bind 127.0.0.1\n'
        ).encode("ascii"),
    }

    # Fixed timestamps and explicit files keep repeated builds reproducible.
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in sorted((*RUNTIME, *launchers)):
            content = launchers[name] if name in launchers else (project / name).read_bytes()
            info = zipfile.ZipInfo(root + name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            mode = 0o755 if name.endswith(".command") else 0o644
            info.external_attr = (stat.S_IFREG | mode) << 16
            archive.writestr(info, content)
    print(f"Created {output.name}: {len(RUNTIME) + len(launchers)} files under {root}")
    return output


if __name__ == "__main__":
    build()
