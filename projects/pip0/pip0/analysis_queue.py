"""高負荷処理の順番待ち（解析・退避）

新しいファイルや変更されたファイルを「解析待ち」として tasks テーブルに入れ、
電源接続中かつ3分間無操作のときに、1件ずつ取り出して処理します（throttle.py を参照）。

ここにあるのは順番待ちの出し入れです。解析そのものは analyse_file()（同じファイルの後半）です。
"""

import time

from pip0 import database


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
