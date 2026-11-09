"""音源の取り込み。YouTube取得と音声の切り出しを音楽処理から分けます。"""

from pathlib import Path
import contextlib
import math
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
from urllib.parse import parse_qs, urlsplit

import numpy as np
import soundfile as sf


SAMPLE_RATE = 22050
MIN_DURATION = 3.0
MAX_DURATION = 60.0
DOWNLOAD_TIMEOUT = 180
DECODE_TIMEOUT = 60


class AudioInputError(ValueError):
    """利用者が次の操作を判断できる、短い取り込みエラー。"""


def _run_process(command, timeout, text=False):
    """Colabでは子のFFmpegも同じグループに置き、時間切れ時に止めます。"""
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=text, start_new_session=(os.name == "posix"))
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except BaseException:
        # yt-dlpだけを止めると、その子のFFmpegが通信を続ける場合があります。
        with contextlib.suppress(ProcessLookupError):
            if os.name == "posix":
                os.killpg(process.pid, signal.SIGKILL)
            else:
                process.kill()
        process.communicate()
        raise
    return subprocess.CompletedProcess(command, process.returncode, stdout, stderr)


def normalise_youtube_url(url):
    """通常の動画・短縮URL・Shorts・ライブのURLを単一動画URLに直します。"""
    if not isinstance(url, str):
        raise AudioInputError("YouTubeの動画URLを入力してください。")
    value = url.strip()
    try:
        parts = urlsplit(value)
        # 不正なポート番号もここで検出します。
        port = parts.port
    except ValueError:
        raise AudioInputError("YouTubeの動画URLを確認してください。") from None
    if (parts.scheme != "https" or parts.username or parts.password
            or port not in (None, 443)):
        raise AudioInputError("https:// で始まるYouTubeの動画URLを入力してください。")
    host = (parts.hostname or "").lower()
    if host == "youtu.be":
        video_id = parts.path.strip("/")
    elif host in {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}:
        if parts.path == "/watch":
            ids = parse_qs(parts.query).get("v", [])
            video_id = ids[0] if len(ids) == 1 else ""
        else:
            match = re.fullmatch(r"/(?:shorts|live|embed)/([A-Za-z0-9_-]{11})/?", parts.path)
            video_id = match.group(1) if match else ""
    else:
        raise AudioInputError("YouTubeまたはyoutu.beの動画URLを入力してください。")
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        raise AudioInputError("単一動画のURLを入力してください。チャンネルや再生リストは使えません。")
    return "https://www.youtube.com/watch?v=" + video_id


def _validate_section(start, duration):
    try:
        start, duration = float(start), float(duration)
    except (ValueError, TypeError):
        raise AudioInputError("開始位置と長さは秒数で入力してください。") from None
    if not math.isfinite(start) or start < 0:
        raise AudioInputError("開始位置は0秒以上にしてください。")
    if not math.isfinite(duration) or not MIN_DURATION <= duration <= MAX_DURATION:
        raise AudioInputError("取り込む長さは3〜60秒にしてください。")
    return start, duration


def find_js_runtime():
    """yt-dlpが対応するDenoまたはNodeを探します。見つからなければNone。"""
    for name, minimum in (("deno", (2, 3)), ("node", (22, 0))):
        path = shutil.which(name)
        if not path:
            continue
        try:
            result = subprocess.run([path, "--version"], capture_output=True,
                                    text=True, timeout=10, check=False)
            match = re.search(r"(?:^|\s|v)(\d+)\.(\d+)", result.stdout)
            if result.returncode == 0 and match:
                version = tuple(int(x) for x in match.groups())
                if version >= minimum:
                    return name, path
        except (OSError, subprocess.TimeoutExpired):
            continue
    return None


def load_audio_file(path, start=0.0, duration=20.0, sr=SAMPLE_RATE):
    """FFmpegで指定区間だけを読み、モノラルのfloat32配列を返します。

    取り込む長さは3〜60秒。曲末まではそれより短くても読み込めます。
    ファイル全体をメモリに展開せず、変換は最大60秒で打ち切ります。
    """
    start, duration = _validate_section(start, duration)
    if isinstance(sr, bool) or not isinstance(sr, int) or not 8000 <= sr <= 48000:
        raise AudioInputError("サンプリング周波数は8000〜48000 Hzの整数にしてください。")
    source = Path(path)
    if not source.is_file():
        raise AudioInputError("音声ファイルが見つかりません。ファイルを選び直してください。")
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise AudioInputError("FFmpegがありません。先に環境セットアップのセルを実行してください。")
    command = [ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error",
               "-ss", f"{start:.6f}", "-i", str(source.resolve()),
               "-t", f"{duration:.6f}", "-vn", "-ac", "1", "-ar", str(sr),
               "-f", "f32le", "pipe:1"]
    try:
        result = _run_process(command, timeout=DECODE_TIMEOUT)
    except subprocess.TimeoutExpired:
        raise AudioInputError("音声の変換が60秒以内に終わりませんでした。短い区間で試してください。") from None
    except OSError:
        raise AudioInputError("音声の変換を開始できません。環境セットアップをやり直してください。") from None
    if result.returncode != 0 or len(result.stdout) % 4:
        raise AudioInputError("音声を読み込めません。WAV・MP3などの音声ファイルを選んでください。")
    samples = np.frombuffer(result.stdout, dtype="<f4").copy()
    # 万一デコーダーが長めに返しても、指定区間のサンプル数に制限します。
    samples = samples[:int(round(duration * sr))]
    if samples.size == 0 or not np.all(np.isfinite(samples)):
        raise AudioInputError("指定した区間に読み込める音声がありません。開始位置を確認してください。")
    return samples


def _youtube_error_message(stderr):
    """診断文は表示せず、分かった原因だけを短い案内に置き換えます。"""
    if isinstance(stderr, bytes):
        stderr = stderr.decode("utf-8", errors="replace")
    detail = str(stderr or "").casefold()
    if any(text in detail for text in (
            "no module named yt_dlp", "no module named 'yt_dlp'",
            "no supported javascript runtime", "ffmpeg not found",
            "ffprobe or ffmpeg not found")):
        return "取得ツールの準備ができていません。セル1を実行してから、もう一度試してください。"
    if any(text in detail for text in (
            "private video", "video is private", "video unavailable", "this video is unavailable",
            "video has been removed", "not available in your country",
            "not available in your region", "not made this video available")):
        return "この動画は公開状態や地域などの制限で取得できません。別の動画で試してください。"
    if any(text in detail for text in (
            "sign in", "log in", "login required", "authentication required",
            "not a bot", "confirm your age", "age-restricted", "http error 401", "http 401")):
        return "YouTubeからログインや追加の確認を求められました。別の音源で試してください。"
    if any(text in detail for text in (
            "http error 429", "http 429", "too many requests", "rate limit")):
        return "取得が一時的に制限されています。少し時間をおいて、セル3を実行してください。"
    if any(text in detail for text in (
            "http error 403", "http 403", "403 forbidden", "access denied",
            "request blocked")):
        return "音声の配信先から接続を拒否されました。時間をおいて試すか、別の音源を選んでください。"
    if any(text in detail for text in (
            "certificate_verify_failed", "certificate verify failed",
            "ssl error", "ssl:", "tls handshake")):
        return "YouTubeへの安全な接続を確認できませんでした。接続環境を確認してから、もう一度試してください。"
    if any(text in detail for text in (
            "timed out", "timeout", "name or service not known",
            "temporary failure in name resolution", "unable to resolve",
            "network is unreachable", "connection refused", "connection reset",
            "remote end closed connection")):
        return "YouTubeへ接続できませんでした。接続を確認し、もう一度試してください。"
    if any(text in detail for text in (
            "postprocessing:", "post-processing:", "ffmpeg exited",
            "ffmpeg returned", "invalid data found when processing input",
            "error opening input", "audio conversion failed")):
        return "取得したデータを音声に変換できませんでした。別の動画や短い区間で試してください。"
    return "YouTubeから音声を取得できませんでした。URLと動画の公開状態を確認し、もう一度試してください。"


def download_youtube(url, destination, start=0.0, duration=20.0):
    """指定区間をYouTubeから取得し、22050 Hz・モノラルWAVとして保存。

    yt-dlpには指定した区間だけを要求します。配信方式によって通信量が
    区間長に比例するとは限りません。取得は最大180秒、続く変換は最大60秒。
    失敗時には、前回成功したdestinationを変更しません。
    """
    canonical_url = normalise_youtube_url(url)
    start, duration = _validate_section(start, duration)
    if not shutil.which("ffmpeg"):
        raise AudioInputError("FFmpegがありません。先に環境セットアップのセルを実行してください。")
    runtime = find_js_runtime()
    if runtime is None:
        raise AudioInputError("YouTube取得にはDeno 2.3以上またはNode 22以上が必要です。環境セットアップをやり直してください。")
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    name, executable = runtime
    with tempfile.TemporaryDirectory(prefix="youtube-", dir=destination.parent) as staging:
        staging = Path(staging)
        template = staging / "source.%(ext)s"
        command = [sys.executable, "-m", "yt_dlp", "--ignore-config", "--no-playlist",
                   "--no-progress", "--no-warnings", "--socket-timeout", "20",
                   "--retries", "2", "--fragment-retries", "2",
                   "--js-runtimes", f"{name}:{executable}", "-f", "bestaudio/best",
                   "--download-sections", f"*{start:.6f}-{start + duration:.6f}",
                   "-x", "--audio-format", "wav", "-o", str(template)]
        if os.environ.get("SSL_CERT_FILE"):
            # 明示的に設定されたCAを尊重します。TLSの証明書・ホスト名検証は継続。
            command += ["--compat-options", "no-certifi"]
        command += ["--", canonical_url]
        try:
            result = _run_process(command, text=True, timeout=DOWNLOAD_TIMEOUT)
        except subprocess.TimeoutExpired:
            raise AudioInputError("YouTubeからの取得が180秒以内に終わりませんでした。短い区間で再試行してください。") from None
        except OSError:
            raise AudioInputError("YouTube取得を開始できません。環境セットアップをやり直してください。") from None
        source = staging / "source.wav"
        if result.returncode != 0 or not source.is_file():
            raise AudioInputError(_youtube_error_message(result.stderr))
        try:
            samples = load_audio_file(source, start=0.0, duration=duration)
        except AudioInputError:
            raise AudioInputError("取得した音声を読み込めませんでした。短い区間や別の動画で試してください。") from None
        converted = staging / "validated.wav"
        try:
            sf.write(converted, samples, SAMPLE_RATE, subtype="PCM_16")
            os.replace(converted, destination)
        except (OSError, RuntimeError):
            raise AudioInputError("取得した音源を保存できません。保存先の空き容量を確認してください。") from None
    return destination
