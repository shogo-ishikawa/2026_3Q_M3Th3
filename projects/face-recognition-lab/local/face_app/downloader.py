"""モデルのダウンロード(初回のみ)。

ネットワークが不安定な環境でも最後まで終わるように:
  ・通信が止まったら一定時間でやめて(タイムアウト)、自動で再試行する
  ・取得先を複数用意し、だめなら次の取得先を試す
  ・取得したファイルで実際にモデルを読み込めるか検査し、壊れていたら取り直す
  ・失敗の詳細を download_log.txt に残す
"""
from __future__ import annotations

import time
import hashlib
from functools import lru_cache
import urllib.request
from datetime import datetime
from pathlib import Path

from . import config, modelio

LOG_PATH = config.ROOT / "download_log.txt"
TIMEOUT = 30          # この秒数データが来なければ、通信が止まったとみなす
RETRIES = 2           # 1つの取得先につき何回まで試すか
CHUNK = 256 * 1024

# 取得先(上から順に試す)と、正しいファイルの最小サイズ
SOURCES = {
    kind: {
        "min_size": item["bytes"],
        "urls": [item["url"], item["url"].replace(
            "https://media.githubusercontent.com/media/", "https://github.com/", 1).replace(
            "/opencv_zoo/", "/opencv_zoo/raw/", 1).replace("/onnx/models/", "/onnx/models/raw/", 1)],
    }
    for kind, item in config.MODELS.items()
}

KIND_NAME = {"detector": "顔検出モデル", "recognizer": "顔照合モデル", "emotion": "表情分類モデル"}


def log(msg: str):
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {msg}\n")
    except Exception:
        pass


def model_path(kind: str) -> Path:
    return config.MODEL_DIR / config.MODELS[kind]["file"]


def check_model(kind: str, path: Path) -> str | None:
    """正しいモデルなら None、だめなら理由を返す。"""
    if not path.exists():
        return "ファイルがありません"
    size = path.stat().st_size
    if size < SOURCES[kind]["min_size"]:
        head = path.read_bytes()[:200]
        if b"git-lfs" in head:
            return "本体ではなく案内用の小さなファイルでした"
        if b"<html" in head.lower() or b"<!doctype" in head.lower():
            return "ファイルではなくWebページが届きました(通信が制限されている可能性があります)"
        return f"ファイルが小さすぎます({size:,} バイト)"
    if not matches_digest(kind, path):
        return "配布元で固定したモデルのSHA256と一致しません"
    try:
        if kind == "detector":
            modelio.create_detector(path)
        elif kind == "recognizer":
            modelio.create_recognizer(path)
        else:
            modelio.create_onnx_net(path)
    except Exception as e:
        msg = " ".join(str(e).split())
        return f"モデルとして読み込めません({msg[-160:]})"
    return None


def all_ready() -> bool:
    return all(check_quick(k) for k in SOURCES)


@lru_cache(maxsize=12)
def _digest(path: str, mtime_ns: int, size: int) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def matches_digest(kind: str, path: Path) -> bool:
    try:
        stat = path.stat()
        return _digest(str(path), stat.st_mtime_ns, stat.st_size) == config.MODELS[kind]["sha256"]
    except OSError:
        return False


def check_quick(kind: str) -> bool:
    p = model_path(kind)
    return p.exists() and p.stat().st_size >= SOURCES[kind]["min_size"] and matches_digest(kind, p)


def _fetch(url: str, dest: Path, on_bytes):
    req = urllib.request.Request(url, headers={"User-Agent": "FACEGATE-model-downloader/1.0"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        total = int(r.headers.get("Content-Length") or 0)
        done = 0
        with open(dest, "wb") as f:
            while True:
                chunk = r.read(CHUNK)          # TIMEOUT 秒データが来なければ例外になる
                if not chunk:
                    break
                f.write(chunk)
                done += len(chunk)
                on_bytes(done, total)
        if total and done < total:
            raise IOError(f"途中で切れました({done:,}/{total:,} バイト)")


def download_all(status: dict | None = None) -> bool:
    """足りないモデルをすべて取得する。status(dict)に進み具合を書き込む。"""
    st = status if status is not None else {}
    config.MODEL_DIR.mkdir(parents=True, exist_ok=True)
    kinds = list(SOURCES)
    st.update(active=True, error="", progress=0.0, file="", detail="", mb_done=0.0, mb_total=0.0, speed=0.0)
    log("==== ダウンロード開始 ====")
    for i, kind in enumerate(kinds):
        dest = model_path(kind)
        if check_quick(kind) and check_model(kind, dest) is None:
            st["progress"] = (i + 1) / len(kinds)
            continue
        st["file"] = KIND_NAME[kind]
        ok, reasons = False, []
        for u_i, url in enumerate(SOURCES[kind]["urls"]):
            for attempt in range(1, RETRIES + 1):
                host = url.split("/")[2]
                st["detail"] = f"取得先 {u_i + 1}/{len(SOURCES[kind]['urls'])}({host})" + (f" 再試行 {attempt}" if attempt > 1 else "")
                tmp = dest.with_name(dest.name + ".part")
                t0 = [time.time(), 0]

                def on_bytes(done, total, i=i):
                    now = time.time()
                    if now - t0[0] > 0.5:
                        st["speed"] = round((done - t0[1]) / (now - t0[0]) / 1e6, 2)
                        t0[0], t0[1] = now, done
                    st["mb_done"], st["mb_total"] = round(done / 1e6, 1), round(total / 1e6, 1)
                    frac = done / total if total else 0.0
                    st["progress"] = (i + min(1.0, frac)) / len(kinds)

                try:
                    _fetch(url, tmp, on_bytes)
                    tmp.replace(dest)
                    why = check_model(kind, dest)
                    if why is None:
                        log(f"OK {kind} <- {url}")
                        ok = True
                        break
                    reasons.append(f"{host}: {why}")
                    log(f"NG {kind} <- {url}: {why}")
                    dest.unlink(missing_ok=True)
                    break                      # 中身がおかしい取得先は再試行せず次へ
                except Exception as e:
                    reasons.append(f"{host}: {type(e).__name__}: {e}")
                    log(f"ERR {kind} <- {url} (試行{attempt}): {type(e).__name__}: {e}")
                    tmp.unlink(missing_ok=True)
                    time.sleep(1.5 * attempt)
            if ok:
                break
        if not ok:
            st["error"] = (f"{KIND_NAME[kind]}を取得できませんでした。"
                           "インターネット接続を確認して「再試行」を押すか、"
                           "別のPCで取得したファイルを「ファイルから取り込む」で入れてください。")
            st["reasons"] = reasons[-3:]
            st["active"] = False
            log("失敗: " + " / ".join(reasons))
            return False
        st["progress"] = (i + 1) / len(kinds)
    st.update(active=False, progress=1.0, file="", detail="完了")
    log("==== すべて完了 ====")
    return True


def import_file(filename: str, data: bytes) -> tuple[bool, str]:
    """手元のファイルをモデルとして取り込む(ネットにつながらない環境向け)。"""
    kind = next((k for k, m in config.MODELS.items() if m["file"] == Path(filename).name), None)
    if kind is None:
        names = "、".join(m["file"] for m in config.MODELS.values())
        return False, f"{filename} はこのアプリのモデルではありません(必要なファイル: {names})"
    config.MODEL_DIR.mkdir(parents=True, exist_ok=True)
    dest = model_path(kind)
    tmp = dest.with_name(dest.name + ".part")
    tmp.write_bytes(data)
    tmp.replace(dest)
    why = check_model(kind, dest)
    if why:
        dest.unlink(missing_ok=True)
        return False, f"{filename}: {why}"
    log(f"取り込み OK {kind} <- {filename}")
    return True, f"{KIND_NAME[kind]}を取り込みました"


def main():
    """コマンドから使う場合: python main.py download"""
    st = {}
    import threading
    th = threading.Thread(target=download_all, args=(st,), daemon=True)
    th.start()
    last = ""
    while th.is_alive():
        line = (f"\r{st.get('file', '')} {st.get('mb_done', 0):.1f}/{st.get('mb_total', 0):.1f} MB "
                f"{st.get('speed', 0):.2f} MB/s  全体 {st.get('progress', 0) * 100:.0f}%  {st.get('detail', '')}")
        if line != last:
            print(line.ljust(100), end="", flush=True)
            last = line
        time.sleep(0.3)
    print()
    if st.get("error"):
        print(st["error"])
        for r in st.get("reasons", []):
            print("  -", r)
        print(f"詳しい記録: {LOG_PATH}")
        return False
    print("すべてのモデルがそろいました。")
    return True

