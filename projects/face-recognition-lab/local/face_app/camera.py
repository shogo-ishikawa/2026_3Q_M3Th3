"""カメラを確実に開くための処理。

Windows では OpenCV の既定の方式でカメラが開けないことがあるため、
DirectShow → Media Foundation → 既定 の順に試す。指定番号で開けなければ
0〜4 番を順に探す。実際に1枚撮れることまで確認する。
"""
from __future__ import annotations

import sys

import cv2


def _backends():
    if sys.platform == "win32":
        return [("DirectShow", cv2.CAP_DSHOW), ("Media Foundation", cv2.CAP_MSMF), ("既定", cv2.CAP_ANY)]
    if sys.platform == "darwin":
        return [("AVFoundation", cv2.CAP_AVFOUNDATION), ("既定", cv2.CAP_ANY)]
    return [("V4L2", cv2.CAP_V4L2), ("既定", cv2.CAP_ANY)]


def _try(index, api):
    cap = cv2.VideoCapture(index, api)
    if cap.isOpened():
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
        for _ in range(5):                       # 起動直後は失敗することがあるので数回試す
            ok, frame = cap.read()
            if ok and frame is not None and frame.size:
                return cap
    cap.release()
    return None


def open_source(source):
    """カメラ番号(int)または動画ファイルのパスを開く。"""
    if not isinstance(source, int):
        cap = cv2.VideoCapture(str(source))
        if not cap.isOpened():
            raise RuntimeError(f"動画ファイルを開けません: {source}")
        return cap
    order = [source] + [i for i in range(5) if i != source]
    for idx in order:
        for name, api in _backends():
            cap = _try(idx, api)
            if cap is not None:
                if idx != source:
                    print(f"[情報] カメラ {source} 番が使えないため {idx} 番を使います")
                print(f"[情報] カメラ {idx} 番を {name} 方式で開きました")
                return cap
    raise RuntimeError(
        "カメラを開けません。次を確認してください:\n"
        "・カメラが接続されているか\n"
        "・Zoom・Teams・Discord・OBS など、他のアプリがカメラを使っていないか\n"
        "・Windowsの設定 → プライバシーとセキュリティ → カメラ で\n"
        "  「カメラへのアクセス」と「デスクトップ アプリがカメラにアクセスできるようにする」がオンか")


def diagnose():
    """どのカメラ番号・方式で映像が取れるかを調べて表示する。"""
    print(f"OpenCV {cv2.__version__} / Python {sys.version.split()[0]} / {sys.platform}")
    found = []
    for idx in range(5):
        for name, api in _backends():
            cap = cv2.VideoCapture(idx, api)
            opened = cap.isOpened()
            ok = False
            if opened:
                for _ in range(5):
                    r, f = cap.read()
                    if r and f is not None and f.size:
                        ok = True
                        break
            cap.release()
            state = "映像OK" if ok else ("開けたが映像なし" if opened else "なし")
            print(f"  カメラ {idx} 番 / {name}: {state}")
            if ok:
                found.append((idx, name))
    if found:
        print(f"結果: 使えるカメラがあります → {found[0][0]} 番")
    else:
        print("結果: 使えるカメラが見つかりませんでした")
    return found
