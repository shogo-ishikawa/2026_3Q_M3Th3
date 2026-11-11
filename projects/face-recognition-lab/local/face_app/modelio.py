"""モデルの読み込み(保存場所に日本語などが含まれていても読めるようにする)。

OpenCV は Windows で、日本語などを含むパス(例: C:\\Users\\山田\\...)のファイルを開けないことがある。
そこで、まずファイルの中身を Python で読み込んでメモリから渡す。それができない古い OpenCV の
場合は、英数字だけの場所(C:\\Users\\Public など)へコピーしてから読み込む。
"""
from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

import cv2
import numpy as np

EMPTY = np.zeros(0, np.uint8)


def read_bytes(path) -> np.ndarray:
    return np.fromfile(str(path), dtype=np.uint8)          # 日本語のパスでも読める


def ascii_copy(path) -> Path:
    """パスに英数字以外が含まれていれば、英数字だけの場所へコピーしてそのパスを返す。"""
    path = Path(path)
    if str(path).isascii():
        return path
    cands = [os.environ.get("PUBLIC"), os.environ.get("ProgramData"), tempfile.gettempdir(),
             os.environ.get("SystemDrive", "C:") + "\\"]
    for d in cands:
        if not d or not str(d).isascii():
            continue
        try:
            target_dir = Path(d) / "FACEGATE_models"
            target_dir.mkdir(parents=True, exist_ok=True)
            target = target_dir / path.name
            if not target.exists() or target.stat().st_size != path.stat().st_size:
                shutil.copyfile(path, target)
            return target
        except OSError:
            continue
    return path


def create_detector(path, input_size=(320, 320), score=0.8, nms=0.3, top_k=5000):
    try:
        return cv2.FaceDetectorYN.create("onnx", read_bytes(path), EMPTY, input_size, score, nms, top_k)
    except Exception:
        return cv2.FaceDetectorYN.create(str(ascii_copy(path)), "", input_size, score, nms, top_k)


def create_recognizer(path):
    try:
        return cv2.FaceRecognizerSF.create("onnx", read_bytes(path), EMPTY)
    except Exception:
        return cv2.FaceRecognizerSF.create(str(ascii_copy(path)), "")


def create_onnx_net(path):
    try:
        return cv2.dnn.readNetFromONNX(read_bytes(path))
    except Exception:
        return cv2.dnn.readNetFromONNX(str(ascii_copy(path)))
