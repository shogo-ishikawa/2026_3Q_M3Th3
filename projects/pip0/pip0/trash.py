"""ごみ箱への移動（ユーザーが選んだファイルの「削除」）

pip0 の「削除」は、ユーザーが選んだファイルを、確認のうえで Windows のごみ箱へ移すことです。
保管庫への「退避」（vault.py、M4）や、元の場所への「復元」とは別の操作です。次の2段階で行います。

1. prepare_deletion：選ばれたファイルを1件ずつ確かめて、削除の依頼（request）を作る。
   削除しないもの（フォルダー、リンク、退避中のファイル、pip0 のデータ・保管庫の中のもの等）には、
   理由（problem）を付けて対象から外す。この段階では、まだ何も削除しない。
2. delete_with_confirmation：対象のファイル名と件数を示す確認画面を出し、
   ユーザーが承認したときだけ、OS 連携（pip0 シェル）がごみ箱へ移す。
   キャンセルしたとき・画面を閉じたときは、何もしない。

守ること
- 削除のたびに、新しい確認画面を出す。「次から確認しない」はない。
  自動分類の結果や、前に承認したことを、今回の削除の許可として扱わない。
- pip0 はファイルを完全に削除しない。ごみ箱へ移す道は platform.confirm_and_recycle だけで、
  このモジュールには、ファイルを直接消す命令を書かない。
- ごみ箱を使えない場所では、OS 連携が「拒否」（refused）と答え、ファイルはそのまま残る。
  そのときに、通常の削除へ切り替えることはしない。
- 結果は1件ずつ操作履歴（operations、種類 "trash"）に残し、ごみ箱へ移したファイルの索引は「なし」（missing）にする。
"""

import contextlib
import logging
import os
import time
import uuid

from pip0 import config as config_module
from pip0 import database

logger = logging.getLogger(__name__)

GHOST_PROBLEM = "退避中のファイルは、先に復元してから削除してください"

# OS 連携の答え（results の status）→ 操作履歴（operations）の状態
OPERATION_STATUS = {
    "recycled": "done",
    "refused": "refused",
    "failed": "failed",
    "not_attempted": "cancelled",
}

# 確認画面の答え → 操作履歴に残す言葉
ANSWER_LABELS = {
    "approve": "承認",
    "cancel": "キャンセル",
    "closed": "画面を閉じた",
    "unavailable": "確認画面を出せなかった",
}


def prepare_deletion(conn, paths, config, platform):
    """削除の依頼を作る（まだ何も削除しない）

    paths：削除したいファイルのパスのリスト（1つだけなら、パスをそのまま渡してもよい）

    戻り値：{"request_id", "items", "count", "total_bytes", "problems"}
    - items：渡された順に {"path", "name", "size", "problem"}。problem は削除しない理由（削除してよければ None）
    - count、total_bytes：削除してよいファイルだけの件数と、大きさの合計（バイト）
    - problems：削除しないファイルの一覧（items のうち、problem があるもの）
    """
    if isinstance(paths, (str, os.PathLike)):
        paths = [paths]
    protected_folders = pip0_data_folders(config)
    items = []
    seen = set()
    for raw_path in paths:
        path = os.path.abspath(raw_path)
        key = os.path.normcase(path)
        if key in seen:
            problem = "同じファイルが重複して指定されています"
        else:
            seen.add(key)
            problem = find_problem(conn, platform, path, protected_folders)
        items.append({
            "path": path,
            "name": os.path.basename(path),
            "size": file_size(path),
            "problem": problem,
        })

    deletable = [item for item in items if item["problem"] is None]
    total_bytes = 0
    for item in deletable:
        total_bytes += item["size"] or 0
    return {
        "request_id": uuid.uuid4().hex,
        "items": items,
        "count": len(deletable),
        "total_bytes": total_bytes,
        "problems": [item for item in items if item["problem"] is not None],
    }


def delete_with_confirmation(conn, platform, request, *, actor="user", now=None):
    """確認画面を1回出し、承認されたときだけ、削除してよいファイルをごみ箱へ移す

    request：prepare_deletion が返した依頼

    戻り値：{"approved", "answer", "results", "summary"}
    - answer：確認画面の答え（"approve"、"cancel"、"closed"、"unavailable"）。画面を出さなかったときは None
    - results：依頼の items と同じ順に {"path", "status", "reason"}。
      status は "recycled"（ごみ箱へ移した）、"refused"（ごみ箱を使えないので削除しなかった）、
      "failed"（失敗）、"not_attempted"（承認されなかった、または対象外なので何もしていない）
    - summary：status ごとの件数 {"recycled", "refused", "failed", "not_attempted"}
    """
    now = time.time() if now is None else now

    # 1. 確認画面を出す直前に、もう一度確かめる（依頼を作った後に、ファイルが変わったかもしれないため）
    #    pip0 のデータ・保管庫の中かどうかはパスだけで決まるので、依頼を作ったときに確かめ済み
    problems = []
    deletable = []
    for item in request["items"]:
        problem = item.get("problem")
        if problem is None:
            problem = find_problem(conn, platform, item["path"], protected_folders=[])
        problems.append(problem)
        if problem is None:
            deletable.append(item)

    # 2. 削除してよいものがあれば、確認画面を1回だけ出す。承認されたものだけを OS 連携がごみ箱へ移す
    answer = None
    approved = False
    replies = {}
    if deletable:
        title, message = build_dialog_text(deletable)
        reply = platform.confirm_and_recycle({
            "request_id": request["request_id"],
            "title": title,
            "message": message,
            "items": [{"path": item["path"], "name": item["name"], "size": item["size"]} for item in deletable],
        })
        answer = reply.get("answer")
        approved = reply.get("approved") is True and answer == "approve"
        for result in reply.get("results") or []:
            replies[result.get("path")] = result

    # 3. 1件ずつ結果をまとめる（対象外のものは "not_attempted" で、理由を付ける）
    results = []
    for item, problem in zip(request["items"], problems):
        if problem is not None:
            results.append({"path": item["path"], "status": "not_attempted", "reason": problem})
        else:
            results.append(read_reply(replies.get(item["path"]), item["path"], approved))

    # 4. 操作履歴に残し、ごみ箱へ移したファイルの索引を「なし」にする
    record_results(conn, request["request_id"], problems, results, answer, actor, now)

    summary = {"recycled": 0, "refused": 0, "failed": 0, "not_attempted": 0}
    for result in results:
        summary[result["status"]] += 1
    logger.info(
        "ごみ箱への移動（答え %s）：移動 %d 件、拒否 %d 件、失敗 %d 件、未実施 %d 件",
        answer, summary["recycled"], summary["refused"], summary["failed"], summary["not_attempted"],
    )
    return {"approved": approved, "answer": answer, "results": results, "summary": summary}


# ----------------------------------------------------------------------
# 削除してよいかの確認（★削除しない条件を増やすときは、ここに足します）
# ----------------------------------------------------------------------


def find_problem(conn, platform, path, protected_folders):
    """削除しない理由（日本語）を返す。削除してよければ None

    protected_folders：中のファイルを削除の対象にしないフォルダー（pip0 のデータフォルダーと保管庫）
    """
    if not os.path.lexists(path):
        return "ファイルが見つかりません"
    for folder in protected_folders:
        if config_module.is_inside(path, folder):
            return "pip0 のデータフォルダー・保管庫の中のファイルは、削除の対象にしません"
    if os.path.islink(path):
        return "シンボリックリンクは削除しません（リンク先もたどりません）"
    if os.path.isdir(path):
        return "フォルダー（ジャンクションを含む）は削除しません。ファイルを選んでください"
    if not os.path.isfile(path):
        return "通常のファイルではないため、削除しません"

    # 退避中のファイル（ゴースト）は、中身が保管庫にある。先に復元してもらう
    if is_evacuated_in_db(conn, path):
        return GHOST_PROBLEM
    ghost = platform.ghost_status(path)
    if ghost.get("is_ghost") is True:
        return GHOST_PROBLEM
    if ghost.get("is_ghost") is None:
        return "退避中のファイルかどうかを確かめられないため、削除しません"

    state = platform.get_local_state(path)
    if state.get("local") is not True:
        return "中身がこの PC にないファイル（ほかのクラウドの未取得のプレースホルダー）は削除しません"
    if state.get("reparse"):
        return "リンクや再解析ポイント（ジャンクション等）は削除しません"
    return None


def is_evacuated_in_db(conn, path):
    """保管庫の記録で、このパスにゴーストがある（退避中・退避の途中・復元の途中）なら True"""
    row = database.query_one(
        conn,
        "SELECT item_id FROM vault_items WHERE current_path = ? AND state IN ('ghosting', 'evacuated', 'restoring')",
        (str(path),),
    )
    return row is not None


def pip0_data_folders(config):
    """削除の対象にしないフォルダー（pip0 のデータフォルダーと保管庫）のリスト"""
    folders = []
    for folder in (config.get("DATA_DIR"), config.get("VAULT_DIR")):
        if folder is not None:
            folders.append(folder)
    return folders


def file_size(path):
    """通常のファイルの大きさ（バイト）。リンク・フォルダー・見つからないものは None"""
    if os.path.islink(path) or not os.path.isfile(path):
        return None
    try:
        return os.stat(path).st_size
    except OSError:
        return None


# ----------------------------------------------------------------------
# 確認画面と結果
# ----------------------------------------------------------------------


def build_dialog_text(items):
    """確認画面の題名と文を作る（★言い回しは、ここで変えられます）

    対象のファイル名と件数は、確認画面（pip0 シェル）が items から一覧にして表示します。
    名前を文にも書くと二重に表示され、文と一覧が食い違うおそれもあるため、文には書きません。
    """
    count = len(items)
    title = f"ごみ箱へ移動の確認（{count} 件）"
    message = "キャンセルしたとき・この画面を閉じたときは、何も削除しません。"
    return title, message


def read_reply(result, path, approved):
    """OS 連携が返した1件の結果を、{"path", "status", "reason"} の形にそろえる"""
    if result is None:
        if approved:
            return {"path": path, "status": "failed", "reason": "OS 連携から、このファイルの結果が返りませんでした"}
        return {"path": path, "status": "not_attempted", "reason": "確認画面で承認されませんでした。何も削除していません"}
    status = result.get("status")
    if status not in OPERATION_STATUS:
        # 知らない答えを「ごみ箱へ移した」とは扱わない
        return {"path": path, "status": "failed", "reason": "OS 連携の答えを読めませんでした"}
    return {"path": path, "status": status, "reason": result.get("reason") or ""}


def answer_label(answer):
    """確認画面の答えを、操作履歴に残す言葉にする"""
    if answer is None:
        return "出していない（削除してよいファイルがない）"
    return ANSWER_LABELS.get(answer, "不明な答え")


def record_results(conn, request_id, problems, results, answer, actor, now):
    """1件ずつ操作履歴（種類 "trash"）に残す。ごみ箱へ移したファイルは、索引の状態を missing にする"""
    reasons = ["削除の依頼 " + request_id, "確認画面：" + answer_label(answer)]
    with write_together(conn):
        for problem, result in zip(problems, results):
            row = database.query_one(conn, "SELECT id FROM files WHERE path = ?", (result["path"],))
            file_id = row["id"] if row is not None else None
            if problem is not None:
                status = "skipped"  # pip0 が対象から外した（確認画面には出していない）
            else:
                status = OPERATION_STATUS[result["status"]]
            database.log_operation(
                conn, "trash", actor=actor, status=status, file_id=file_id,
                before_path=result["path"], reasons=reasons, detail=result["reason"] or None, at=now,
            )
            if result["status"] == "recycled" and file_id is not None:
                conn.execute("UPDATE files SET status = 'missing', updated_at = ? WHERE id = ?", (now, file_id))


def write_together(conn):
    """まとめて書く（途中で失敗したら、すべて取り消す）

    呼び出し元がすでにまとめて書いている途中なら、新しく始めずに、その中で書く。
    """
    if conn.in_transaction:
        return contextlib.nullcontext()
    return database.transaction(conn)
