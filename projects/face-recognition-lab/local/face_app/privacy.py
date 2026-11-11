"""アプリが作成した登録情報と記録を削除する。

元の登録・評価用写真や、アプリ外へコピーしたファイルは対象にしない。
レポートと画面保存は人物との対応を確実に判別できないため、生成分をまとめて消す。
"""
from __future__ import annotations

import csv
from pathlib import Path

from . import config
from .registry import FaceDB

IDENTITY_FIELDS = ("name", "raw_name", "best_candidate")


def _check_storage_roots():
    for path in (config.DATA_DIR, config.LOG_DIR, config.REPORT_DIR, config.SHOT_DIR,
                 config.DB_PATH, config.DB_META_PATH):
        if path.is_symlink():
            raise ValueError("保存先がリンクのため削除を中止しました。")


def _rewrite_log(path: Path, name: str) -> int:
    if not path.exists():
        return 0
    if path.is_symlink():
        raise ValueError("記録ファイルがリンクのため削除を中止しました。")
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        fields = reader.fieldnames
        rows = list(reader)
    if not fields or not any(field in fields for field in IDENTITY_FIELDS):
        # アプリで管理するCSVの形式が壊れていると、個人別の削除を保証できない。
        path.unlink()
        return len(rows)
    kept = []
    for row in rows:
        identified = any(row.get(field) == name for field in IDENTITY_FIELDS)
        # 旧版の動作イベントは名前を自由文で持つ。対応が曖昧なイベント行は残さない。
        event_only = bool(row.get("event")) and not any(row.get(field) for field in IDENTITY_FIELDS)
        if not identified and not event_only:
            kept.append(row)
    if len(kept) == len(rows):
        return 0
    temporary = path.with_name(path.name + ".delete.tmp")
    try:
        with temporary.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            writer.writerows(kept)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    return len(rows) - len(kept)


def _clear_generated(directory: Path) -> int:
    if not directory.exists():
        return 0
    if directory.is_symlink():
        raise ValueError("保存先がリンクのため削除を中止しました。")
    count = 0
    for path in sorted(directory.rglob("*"), key=lambda p: len(p.parts), reverse=True):
        if path.is_symlink() or path.is_file():
            path.unlink()
            count += 1
        elif path.is_dir():
            path.rmdir()
    return count


def delete_person(name: str, db: FaceDB | None = None, access_log: Path | None = None) -> dict:
    """カメラ処理とログ書き込みを停止してから呼び出す。"""
    if not isinstance(name, str) or not name.strip():
        raise ValueError("削除する登録者を指定してください。")
    _check_storage_roots()
    db = db if db is not None else FaceDB()
    if name not in db.names:
        return {"ok": False, "rows_removed": 0, "reports_removed": 0, "screenshots_removed": 0}
    removed = db.delete(name)
    rows = _rewrite_log(access_log or config.DATA_DIR / "access_log.csv", name)
    for path in sorted(config.LOG_DIR.glob("session_*.csv")):
        rows += _rewrite_log(path, name)
    reports = _clear_generated(config.REPORT_DIR)
    screenshots = _clear_generated(config.SHOT_DIR)
    if removed:
        db.save()
    return {"ok": removed or bool(rows), "rows_removed": rows,
            "reports_removed": reports, "screenshots_removed": screenshots}


def clear_local_data(access_log: Path | None = None, settings_path: Path | None = None) -> dict:
    """モデルと手元の入力写真を残し、アプリが管理する保存データを削除する。"""
    _check_storage_roots()
    files = [config.DB_PATH, config.DB_META_PATH,
             access_log or config.DATA_DIR / "access_log.csv",
             settings_path or config.DATA_DIR / "settings.json",
             config.ROOT / "error_log.txt"]
    removed = 0
    for path in files:
        if path.exists() or path.is_symlink():
            if path.is_symlink():
                raise ValueError("保存ファイルがリンクのため削除を中止しました。")
            path.unlink()
            removed += 1
    for path in config.LOG_DIR.glob("session_*.csv"):
        path.unlink()
        removed += 1
    removed += _clear_generated(config.REPORT_DIR)
    removed += _clear_generated(config.SHOT_DIR)
    return {"ok": True, "files_removed": removed}
