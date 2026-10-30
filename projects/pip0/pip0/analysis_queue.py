"""高負荷処理の順番待ち（解析・退避）

新しいファイルや変更されたファイルを「解析待ち」として tasks テーブルに入れ、
電源接続中かつ3分間無操作のときに、1件ずつ取り出して処理します（throttle.py を参照）。

ここにあるのは順番待ちの出し入れです。解析そのものは analyse_file()（同じファイルの後半）です。
"""

import contextlib
import json
import os
import time

from pip0 import analyse_image, analyse_text, database, fsutil, sensitivity


def enqueue(conn, kind, file_id, priority=0, now=None):
    """順番待ちに入れる。すでにあれば、終わったもの・失敗したものを「待ち」に戻す"""
    now = time.time() if now is None else now
    row = database.query_one(conn, "SELECT id, state FROM tasks WHERE kind = ? AND file_id = ?", (kind, file_id))
    if row is None:
        return database.execute(
            conn,
            "INSERT INTO tasks (kind, file_id, state, priority, created_at, updated_at) VALUES (?, ?, 'queued', ?, ?, ?)",
            (kind, file_id, priority, now, now),
        )
    if row["state"] in ("done", "failed"):
        conn.execute(
            "UPDATE tasks SET state = 'queued', priority = ?, updated_at = ?, attempts = 0, last_error = NULL WHERE id = ?",
            (priority, now, row["id"]),
        )
    return row["id"]


def next_task(conn, kind=None):
    """次に処理する1件（優先度の高い順、古い順）。なければ None"""
    if kind is None:
        return database.query_one(
            conn,
            "SELECT * FROM tasks WHERE state = 'queued' ORDER BY priority DESC, created_at, id LIMIT 1",
        )
    return database.query_one(
        conn,
        "SELECT * FROM tasks WHERE state = 'queued' AND kind = ? ORDER BY priority DESC, created_at, id LIMIT 1",
        (kind,),
    )


def mark(conn, task_id, state, error=None, now=None):
    """状態を変える（'queued'、'running'、'done'、'failed'）"""
    now = time.time() if now is None else now
    if state == "running":
        conn.execute(
            "UPDATE tasks SET state = ?, updated_at = ?, attempts = attempts + 1 WHERE id = ?",
            (state, now, task_id),
        )
    else:
        conn.execute(
            "UPDATE tasks SET state = ?, updated_at = ?, last_error = ? WHERE id = ?",
            (state, now, error, task_id),
        )


def pending_count(conn, kind=None):
    if kind is None:
        row = conn.execute("SELECT count(*) FROM tasks WHERE state IN ('queued', 'running')").fetchone()
    else:
        row = conn.execute(
            "SELECT count(*) FROM tasks WHERE state IN ('queued', 'running') AND kind = ?", (kind,)
        ).fetchone()
    return row[0]


def reset_running(conn, now=None):
    """前回の終了時に「実行中」のまま残ったものを、待ちに戻す（起動時に呼ぶ）"""
    now = time.time() if now is None else now
    conn.execute("UPDATE tasks SET state = 'queued', updated_at = ? WHERE state = 'running'", (now,))


# ----------------------------------------------------------------------
# 解析（高負荷の処理。電源接続中かつ3分間無操作のときだけ、ワーカーのスレッドで動かす）
# ----------------------------------------------------------------------

ANALYSER_VERSION = 1  # 解析の方法を大きく変えたら増やす（古い方法の結果を見分けるため）

# 本文を取り出す種類（rules.FILE_KINDS の値）。"image" は画像の解析、それ以外は「対象外の形式」
TEXT_KINDS = ["pdf", "document", "spreadsheet", "slides", "text"]

# analyse_file() が返す辞書の項目
RESULT_KEYS = ["status", "kind", "sha256", "size", "mtime", "title", "text", "has_chart", "labels",
               "colours", "colourful_ratio", "background_ratio", "palette_size", "chart_score",
               "chart_evidence", "visual_kind", "error"]


def analyse_file(path, platform, config, rules, should_continue):
    """1つのファイルを解析して、結果の辞書を返す（DB は使わないので、ワーカーのスレッドで動かせる）

    should_continue：区切り（ハッシュの HASH_CHUNK_BYTES ごと、解析の後）で呼ぶ関数。偽なら一時停止する
    返す辞書：
    - 解析した：RESULT_KEYS の辞書（status は "done"、"unsupported"、"failed"）
    - 一時停止した：{"status": "paused"}（結果は保存せず順番待ちに戻す。次はこのファイルの最初から）
    - 読まなかった：{"status": "skipped", "reason"}（ゴースト等で中身がこの PC にない、ファイルがない等）
    """
    path = os.fspath(path)
    local_state = platform.get_local_state(path)
    if local_state.get("local") is not True:
        return {"status": "skipped",
                "reason": local_state.get("reason") or "中身がこの PC にないファイルは読みません"}
    try:
        before = os.stat(path)
    except OSError as error:
        return {"status": "skipped", "reason": f"ファイルを確かめられません（{type(error).__name__}）"}

    result = {key: None for key in RESULT_KEYS}
    ext = os.path.splitext(path)[1].lower()
    result["kind"] = rules.FILE_KINDS.get(ext, "other")
    result["size"] = before.st_size
    result["mtime"] = before.st_mtime
    if before.st_size > config["ANALYSE_MAX_FILE_BYTES"]:
        result["status"] = "unsupported"
        result["error"] = (f"ファイルが大きいため（{before.st_size / (1024 * 1024):.0f}MB）、中身を解析しません"
                           f"（上限 {config['ANALYSE_MAX_FILE_BYTES'] / (1024 * 1024):.0f}MB）")
        return result

    # 内容のハッシュ（区切りごとに should_continue() を確かめる。最終アクセス日時を更新しない開き方で読む）
    try:
        result["sha256"] = fsutil.sha256_file(path, config["HASH_CHUNK_BYTES"], should_continue,
                                              opener=platform.open_for_analysis)
    except fsutil.Paused:
        return {"status": "paused"}
    except OSError as error:
        return {"status": "skipped", "reason": f"ファイルを読めません（{type(error).__name__}）"}

    # 種類ごとの解析
    if result["kind"] == "image":
        outcome = analyse_image.analyse_image(path, platform, config)
    elif result["kind"] in TEXT_KINDS:
        outcome = analyse_text.extract_text(path, platform, config, rules)
    else:
        outcome = {"status": "unsupported", "error": "この形式の中身は解析しません"}
    for key in RESULT_KEYS:
        if key in outcome and key not in ("kind", "size", "mtime", "sha256"):
            result[key] = outcome[key]

    if not should_continue():
        return {"status": "paused"}
    # 解析の途中でファイルが変わっていたら、ハッシュと中身が別の版になるおそれがあるため保存しない
    try:
        after = os.stat(path)
    except OSError:
        return {"status": "skipped", "reason": "解析の途中でファイルが見つからなくなりました"}
    if (after.st_size, after.st_mtime_ns) != (before.st_size, before.st_mtime_ns):
        return {"status": "skipped",
                "reason": "解析の途中でファイルが変わったため、結果を保存しません（次の見直しで、もう一度解析します）"}
    return result


# analysis テーブルに書く列（file_id 以外）。機密の判定（sensitivity）は、書いた後に別に書く
ANALYSIS_COLUMNS = ["status", "analyser_version", "analysed_at", "size_at_analysis", "mtime_at_analysis",
                    "sha256", "kind", "title", "text_excerpt", "has_chart", "colours_json", "colourful_ratio",
                    "chart_score", "chart_evidence_json", "visual_kind", "labels_json", "error"]

# 「なければ追加し、あれば書き換える」SQL（列の名前のリストから組み立てる）
UPSERT_ANALYSIS_SQL = (
    "INSERT INTO analysis (file_id, " + ", ".join(ANALYSIS_COLUMNS) + ") "
    "VALUES (?" + ", ?" * len(ANALYSIS_COLUMNS) + ") "
    "ON CONFLICT(file_id) DO UPDATE SET " + ", ".join(f"{name} = excluded.{name}" for name in ANALYSIS_COLUMNS)
)


def store_result(conn, file_id, path, result, config, rules, now):
    """analyse_file() の結果を analysis テーブルに書き、sensitivity.overall() で機密の判定も書く

    "paused"（一時停止）と "skipped"（読まなかった）は何も書かずに None を返します。
    書いたときは、機密の判定 {"level", "reasons"} を返します。
    """
    if result["status"] in ("paused", "skipped"):
        return None
    text = result.get("text")
    if text is not None:
        text = text[:config["TEXT_MAX_CHARS"]]
    values = {
        "status": result["status"],
        "analyser_version": ANALYSER_VERSION,
        "analysed_at": now,
        "size_at_analysis": result.get("size"),
        "mtime_at_analysis": result.get("mtime"),
        "sha256": result.get("sha256"),
        "kind": result.get("kind"),
        "title": result.get("title"),
        "text_excerpt": text,
        "has_chart": flag_or_none(result.get("has_chart")),
        "colours_json": json_or_none(result.get("colours") or None),
        "colourful_ratio": result.get("colourful_ratio"),
        "chart_score": result.get("chart_score"),
        "chart_evidence_json": json_or_none(result.get("chart_evidence")),
        "visual_kind": result.get("visual_kind"),
        "labels_json": json_or_none(result.get("labels")),
        "error": result.get("error"),
    }
    with write_together(conn):
        conn.execute(UPSERT_ANALYSIS_SQL, [file_id] + [values[name] for name in ANALYSIS_COLUMNS])
        row = database.query_one(conn, "SELECT * FROM analysis WHERE file_id = ?", (file_id,))
        verdict = sensitivity.overall(path, row, config, rules)
        conn.execute(
            "UPDATE analysis SET sensitivity = ?, sensitivity_reasons_json = ? WHERE file_id = ?",
            (verdict["level"], json.dumps(verdict["reasons"], ensure_ascii=False), file_id),
        )
    return verdict


def flag_or_none(value):
    """True/False → 1/0（DB の INTEGER）。分からない（None）は None のまま"""
    if value is None:
        return None
    return 1 if value else 0


def json_or_none(value):
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False)


def write_together(conn):
    """まとめて書く（途中で失敗したら、すべて取り消す）。すでにまとめて書いている途中なら、その中で書く"""
    if conn.in_transaction:
        return contextlib.nullcontext()
    return database.transaction(conn)
