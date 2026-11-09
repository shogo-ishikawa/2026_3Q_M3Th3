"""Colab の初回準備。ノートブックにも同じコードを収録します。"""

from pathlib import Path
import hashlib
import importlib
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile


PACKAGES = [
    "librosa>=0.11,<0.12", "soundfile>=0.13,<0.14",
    "pretty_midi>=0.2.10,<0.3", "ipywidgets>=8.1,<9",
    "matplotlib>=3.9,<4",
]
DENO_VERSION = "v2.9.5"


def supported_js_runtime():
    """yt-dlp が対応する JavaScript 実行環境があるか調べます。"""
    for name, minimum in [("deno", (2, 3, 0)), ("node", (22, 0, 0))]:
        executable = shutil.which(name)
        if not executable:
            continue
        try:
            result = subprocess.run(
                [executable, "--version"], capture_output=True,
                text=True, timeout=10, check=True,
            )
            match = re.search(r"(\d+)\.(\d+)\.(\d+)", result.stdout)
            if match and tuple(map(int, match.groups())) >= minimum:
                return name
        except (OSError, subprocess.SubprocessError):
            continue
    return None


def install_deno(bin_dir):
    """公式配布の Deno をチェックサムで照合して配置します（Linux Colab 用）。"""
    if platform.system() != "Linux" or platform.machine() not in {"x86_64", "AMD64"}:
        raise RuntimeError("この環境では Deno または Node.js を手動で導入してください。")
    filename = "deno-x86_64-unknown-linux-gnu.zip"
    base = f"https://github.com/denoland/deno/releases/download/{DENO_VERSION}/"
    with urllib.request.urlopen(base + filename + ".sha256sum", timeout=30) as response:
        expected = response.read(4096).decode("utf-8").split()[0]
    if not re.fullmatch(r"[a-fA-F0-9]{64}", expected):
        raise RuntimeError("Deno のチェックサムを確認できませんでした。")
    bin_dir = Path(bin_dir)
    bin_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=bin_dir) as temporary:
        archive = Path(temporary) / filename
        size = 0
        with urllib.request.urlopen(base + filename, timeout=60) as response, archive.open("wb") as out:
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                if size > 100 * 1024 * 1024:
                    raise RuntimeError("Deno の取得サイズが想定を超えました。")
                out.write(chunk)
        if hashlib.sha256(archive.read_bytes()).hexdigest() != expected.lower():
            raise RuntimeError("Deno の照合に失敗しました。時間をおいて準備セルを再実行してください。")
        with zipfile.ZipFile(archive) as zipped:
            executable = Path(temporary) / "deno"
            executable.write_bytes(zipped.read("deno"))
        executable.chmod(0o755)
        executable.replace(bin_dir / "deno")
    os.environ["PATH"] = str(bin_dir.resolve()) + os.pathsep + os.environ.get("PATH", "")


def setup_environment():
    """準備が済んだら、セル 2 のプログラムを保存する場所へ移動します。"""
    try:
        import google.colab  # noqa: F401
        in_colab = True
    except ImportError:
        in_colab = False
    base = Path("/content") if in_colab else Path.cwd()
    runtime_dir = base if base.name == ".ai_music_arranger_runtime" else base / ".ai_music_arranger_runtime"
    runtime_dir.mkdir(parents=True, exist_ok=True)
    print("1/3 音声解析と操作画面に必要なライブラリを準備しています。")
    subprocess.run(
        [sys.executable, "-m", "pip", "install", "--quiet", *PACKAGES],
        check=True, timeout=360,
    )
    # YouTubeの仕様変更に備え、取得ツールと対応するEJSを一緒に更新します。
    subprocess.run(
        [sys.executable, "-m", "pip", "install", "--quiet", "--upgrade", "yt-dlp[default]"],
        check=True, timeout=180,
    )
    importlib.invalidate_caches()

    print("2/3 音声を変換する FFmpeg を確認しています。")
    if not shutil.which("ffmpeg"):
        if not in_colab:
            raise RuntimeError("FFmpeg がありません。README のローカル実行手順を確認してください。")
        subprocess.run(["apt-get", "-qq", "update"], check=True, timeout=120)
        subprocess.run(["apt-get", "-qq", "install", "-y", "ffmpeg"], check=True, timeout=180)

    bin_dir = runtime_dir / "bin"
    if bin_dir.exists():
        os.environ["PATH"] = str(bin_dir.resolve()) + os.pathsep + os.environ.get("PATH", "")
    print("3/3 YouTube 取得に必要な JavaScript 実行環境を確認しています。")
    if not supported_js_runtime():
        try:
            install_deno(bin_dir)
        except Exception:
            print("YouTube 用の追加準備が完了しませんでした。準備セルを再実行してください。")
            print("デモ音源と PC からのファイル読み込みはそのまま試せます。")
    runtime = supported_js_runtime()
    print(f"YouTube 用実行環境: {runtime or '未準備（操作マニュアルの対処方法を参照）'}")

    if in_colab:
        from google.colab import output
        output.enable_custom_widget_manager()
    os.chdir(runtime_dir)
    if str(runtime_dir.resolve()) not in sys.path:
        sys.path.insert(0, str(runtime_dir.resolve()))
    print("準備が完了しました。続けてセル 2 の各プログラムと、セル 3 を実行してください。")


if __name__ == "__main__":
    setup_environment()
