"""顔の登録(フォルダの画像から / カメラから)。

・撮影条件ナビで点数の低い画像(暗い・ぼやけ・横向き等)は自動で除外する。
・左右反転した画像の特徴量も登録し、鏡像表示のカメラでも照合しやすくする。
・登録に使った画像の指紋(ハッシュ)を記録し、評価時に確認用画像との重複を警告する。
"""
from __future__ import annotations

import hashlib
import time
from pathlib import Path

import cv2

from . import config, render
from .engine import largest_face
from .quality import assess
from .registry import FaceDB

IMG_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def file_hash(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


def imread(p: Path):
    """日本語を含むパスでも読めるようにする。"""
    import numpy as np
    data = np.fromfile(str(p), dtype=np.uint8)
    return cv2.imdecode(data, cv2.IMREAD_COLOR)


def list_images(folder: Path):
    return sorted(p for p in folder.rglob("*") if p.suffix.lower() in IMG_EXT)


def features_from_image(engine, img, min_quality, with_mirror=True):
    """画像1枚から特徴量を取り出す。(特徴量のリスト, 品質, 理由) を返す。"""
    face = largest_face(engine.detect(img))
    if face is None:
        return [], None, "顔が見つかりません"
    q = assess(img, face.box, face.landmarks)
    if q.score < min_quality:
        return [], q, f"撮影条件{q.score}点: " + "、".join(q.advice)
    feats = [engine.embed(img, face)]
    if with_mirror:
        flipped = cv2.flip(img, 1)
        f2 = largest_face(engine.detect(flipped))
        if f2 is not None:
            feats.append(engine.embed(flipped, f2))
    return feats, q, "OK"


def register_folder(engine, name, folder, min_quality=config.REGISTER_MIN_QUALITY):
    folder = Path(folder)
    imgs = list_images(folder)
    if not imgs:
        print(f"画像がありません: {folder}")
        return 0
    db = FaceDB()
    all_feats, hashes, n_ok = [], [], 0
    for p in imgs:
        img = imread(p)
        if img is None:
            print(f"  × {p.name}: 読み込めません"); continue
        feats, q, why = features_from_image(engine, img, min_quality)
        if feats:
            all_feats += feats; n_ok += 1
            hashes.append(file_hash(p))
            print(f"  ○ {p.name}  撮影条件{q.score}点")
        else:
            print(f"  × {p.name}: {why}")
    if n_ok:
        db.add(name, all_feats, source=f"folder:{folder}")
        db.meta[name].setdefault("image_hashes", [])
        db.meta[name]["image_hashes"] += hashes
        db.save()
    print(f"{name}: {len(imgs)}枚中 {n_ok}枚を登録しました(登録データ {db.labels.count(name)}件)")
    return n_ok


def register_camera(engine, name, source=0, shots=10, mirror=True,
                    min_quality=80, interval=0.6, headless=False, max_frames=None):
    """カメラの前に座ると、条件の良いときに自動で撮影して登録する。"""
    from .camera import open_source
    cap = open_source(source)
    text = render.Text()
    feats, last, frame_no = [], 0.0, 0
    tips = ["正面を向いてください", "少し右に顔を向けてください", "少し左に顔を向けてください",
            "自然な表情で", "少し笑ってください"]
    try:
        while len(feats) // 2 < shots:
            ok, frame = cap.read()
            if not ok:
                break
            frame_no += 1
            if mirror:
                frame = cv2.flip(frame, 1)
            face = largest_face(engine.detect(frame))
            view = frame.copy()
            msg, col = "顔を映してください", render.YELLOW
            if face is not None:
                q = assess(frame, face.box, face.landmarks)
                x, y, w, h = face.box
                ok_q = q.score >= min_quality
                col = render.GREEN if ok_q else render.RED
                cv2.rectangle(view, (x, y), (x + w, y + h), col, 2)
                msg = f"撮影条件 {q.score}点  " + (" / ".join(q.advice) if q.advice else "良好")
                if ok_q and time.time() - last > interval:
                    feats.append(engine.embed(frame, face))
                    flipped = cv2.flip(frame, 1)
                    f2 = largest_face(engine.detect(flipped))
                    feats.append(engine.embed(flipped, f2) if f2 is not None else feats[-1])
                    last = time.time()
            n = len(feats) // 2
            text.add((10, 10), f"{name} さんを登録中  {n}/{shots}枚", render.WHITE, 22, bg=(40, 40, 40))
            text.add((10, 44), msg, col, 18, bg=(40, 40, 40))
            text.add((10, 72), "ヒント: " + tips[n % len(tips)] + "   (Qで中止)", render.WHITE, 16, bg=(40, 40, 40))
            view = text.flush(view)
            if not headless:
                cv2.imshow("Register", view)
                if cv2.waitKey(1) & 0xFF in (ord("q"), 27):
                    break
                if frame_no > 2 and cv2.getWindowProperty("Register", cv2.WND_PROP_VISIBLE) < 1:
                    break
            if max_frames and frame_no >= max_frames:
                break
    finally:
        cap.release()
        if not headless:
            cv2.destroyAllWindows()
    if feats:
        db = FaceDB()
        db.add(name, feats, source="camera")
        db.save()
    print(f"{name}: カメラから {len(feats) // 2}枚分を登録しました")
    return len(feats) // 2
