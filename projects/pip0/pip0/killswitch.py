"""キルスイッチ（1クリック全復元）

ユーザーが 1 回操作すると、次の順に動きます（docs/design.md 4-9）。
1. engage：停止の印（CONTROL_DIR/automation.stopped）と DB の設定を書き、
   新しい自動仕分け・自動改名・自動退避を止める。DB が開けないときも、印のファイルだけは書ける（conn=None）
2. 実行中の自動処理を、次の区切りで止める（常駐処理 service.py の役目。restore_all の説明を参照）
3. restore_all：退避したファイルを 1 件ずつ元の場所へ戻し、進み具合（件数だけ）を
   CONTROL_DIR/restore_all.progress.json に書く。最初に「途中」（finished: False）を書き、終わったら「終わり」を書く。
   途中で止まっても（強制終了を含む）、resume は断られ、もう一度実行すると残りから続ける
4. 自動処理は、ユーザーが確認のうえで resume を選ぶまで止まったまま

戻すのは pip0 が退避したファイルだけです。自動仕分け・自動改名は戻しません（操作履歴に残っています）。
pip0 以外が行った変更や、バックアップ全体の復旧はしません。
画面（UI）が動かないときは、scripts/restore-all.cmd（python -m pip0 restore-all）から使います。
"""

import contextlib
import json
import logging
import os
import time
from pathlib import Path

from pip0 import database, fsutil, vault

logger = logging.getLogger(__name__)

# 停止の印の名前（fileops.py も同じ名前の印を見て、自動の移動・改名をしません）
STOP_MARKER_NAME = "automation.stopped"
PROGRESS_FILE_NAME = "restore_all.progress.json"
REQUEST_FILE_NAME = "restore_all.request.json"
# settings_kv の名前。'0' なら自動処理は停止中、'1' なら動いてよい
AUTOMATION_SETTING = "automation_enabled"

# restore_all が返す件数の名前（進み具合のファイルにも、この件数だけを書く）
COUNT_KEYS = ["total", "restored", "conflict", "local_newer", "missing", "failed", "already", "remaining"]


# ----------------------------------------------------------------------
# 停止と再開
# ----------------------------------------------------------------------


def engage(conn, config, reason, actor="user", now=None):
    """自動処理を止める（新しい自動仕分け・自動改名・自動退避を始めない）。復元はしない

    1. 停止の印 CONTROL_DIR/automation.stopped を書く（{"at", "reason", "actor"}）。conn が None でも書ける
    2. conn があれば、DB の設定 automation_enabled を '0' にし、操作履歴（種類 "kill_switch"）に残す
    戻り値：{"ok", "marker", "database", "reason"}（marker、database は、それぞれ書けたかどうか）
    """
    now = time.time() if now is None else now
    problems = []

    marker_written = False
    marker = control_file(config, STOP_MARKER_NAME)
    if marker is None:
        problems.append("停止の印を書く場所（データフォルダー）が設定されていません")
    else:
        try:
            marker.parent.mkdir(parents=True, exist_ok=True)
            fsutil.atomic_write_json(marker, {"at": now, "reason": reason, "actor": actor})
            marker_written = True
        except OSError as error:
            problems.append(f"停止の印を書けませんでした（{type(error).__name__}）")

    database_written = False
    if conn is not None:
        try:
            with write_together(conn):
                database.set_setting(conn, AUTOMATION_SETTING, "0")
                database.log_operation(
                    conn, "kill_switch", actor=actor, status="done",
                    reasons=[reason] if reason else None, detail="自動処理を停止しました", at=now,
                )
            database_written = True
        except Exception as error:  # DB が壊れていても、停止の印だけで止められるようにする
            problems.append(f"DB に停止を記録できませんでした（{type(error).__name__}）")

    logger.info("キルスイッチ：自動処理を停止（印 %s、DB %s）", marker_written, database_written)
    return {
        "ok": marker_written or database_written,
        "marker": marker_written,
        "database": database_written,
        "reason": "。".join(problems),
    }


def is_engaged(conn, config):
    """自動処理が止まっていれば True（停止の印があるか、DB の設定が '0'）

    印があるかを確かめられないとき（読み取りのエラー）も、止まっているものとして True を返す（安全側）。
    """
    marker = control_file(config, STOP_MARKER_NAME)
    if marker is not None:
        try:
            os.lstat(marker)
            return True
        except FileNotFoundError:
            pass
        except OSError:
            return True
    if conn is not None and database.get_setting(conn, AUTOMATION_SETTING) == "0":
        return True
    return False


def resume(conn, config, confirmed, actor="user", now=None):
    """止めた自動処理を再開する。戻り値：{"ok", "reason"}

    confirmed：ユーザーが確認画面で「再開する」を選んだときだけ True を渡す。True でなければ再開しない。
    全復元が途中のとき（依頼が残っている、進み具合が終わっていない）も再開しない
    （もう一度全復元を実行すると、残りから続けます）。
    """
    now = time.time() if now is None else now
    if confirmed is not True:
        return {"ok": False, "reason": "確認されていないため、自動処理を再開しません（止まったままです）"}
    if conn is None:
        return {"ok": False, "reason": "DB を開けないため、再開を記録できません（止まったままです）"}
    if restore_unfinished(config):
        return {"ok": False,
                "reason": "全復元が途中です。全復元を最後まで実行してから再開してください"
                          "（もう一度実行すると、残りから続けます）"}

    marker = control_file(config, STOP_MARKER_NAME)
    if marker is not None:
        try:
            os.remove(marker)  # 停止の印（制御用の小さなファイル）を外す。保管庫のファイルではない
        except FileNotFoundError:
            pass
        except OSError as error:
            return {"ok": False, "reason": f"停止の印を外せませんでした（{type(error).__name__}）。止まったままです"}
    with write_together(conn):
        database.set_setting(conn, AUTOMATION_SETTING, "1")
        database.log_operation(conn, "resume_automation", actor=actor, status="done",
                               detail="自動処理を再開しました", at=now)
    logger.info("キルスイッチ：自動処理を再開")
    return {"ok": True, "reason": ""}


def restore_unfinished(config):
    """全復元の依頼が残っているか、前回の全復元が途中で止まっていれば True"""
    request = control_file(config, REQUEST_FILE_NAME)
    if request is not None and request.exists():
        return True
    progress = read_progress(config)
    return progress is not None and progress.get("finished") is False


# ----------------------------------------------------------------------
# 全復元
# ----------------------------------------------------------------------


def restore_all(conn, platform, config, progress=None, should_stop=None, now=None):
    """退避したファイルをすべて元の場所へ戻す（キルスイッチの本体）。件数の辞書を返す

    1. 自動処理を止める（engage）。停止の印と DB の設定の両方がそろうように、足りないほうを書く。
       自動処理は resume まで止まったまま
    2. 起動時の点検（vault.recover_incomplete）で、途中の項目をそろえる（ここで戻った項目は、件数に入らない）
    3. ゴーストにする前の項目（copying、copied、failed）を cancelled にする（原本は元の場所のまま）
    4. 退避中の項目（evacuated、ghosting、restoring、ghost_missing）を 1 件ずつ vault.restore で戻す。
       1 件ごとに progress(件数の辞書) を呼び、CONTROL_DIR/restore_all.progress.json に件数だけを書く
       （パスや名前は書かない）
    5. 1 件ごとに should_stop() を確かめ、真なら止める。もう一度呼ぶと、残りの項目から続ける

    戻り値：{"total", "restored", "conflict", "local_newer", "missing", "failed", "already", "remaining", "finished"}
    - total：今回の対象の件数。残りの件数（remaining）は、まだ試していない件数
    - restored：戻した、conflict：元の場所に別のファイルがあったので横に戻した、
      local_newer：開いた後の編集を残した、missing：ゴーストが見つからない（保管庫に残した）、
      failed：戻せなかった（保管庫に残した。もう一度実行すると試し直す）、already：すでに戻っていた
    - finished：対象のすべてを試し終えたら True

    呼び出す側（service.py、cli.py）の約束：実行中の自動処理を、安全な区切りで止めてから呼ぶこと
    1. 先に engage() を呼ぶ。新しい自動仕分け・自動改名・自動退避は始まらなくなる
    2. 保管庫へコピー中のワーカーがあれば、その should_continue() が偽を返すようにする
       （例：is_engaged を見る、threading.Event を立てる）。コピーは HASH_CHUNK_BYTES（1MB）ごとに区切るので、
       次の区切りで vault.evacuate が戻り、その項目は failed（一時停止。原本はそのまま）になる。
       なお vault.evacuate は、原本をゴーストにする直前にもキルスイッチを確かめ直し、自動の退避なら中止する
    3. ワーカーが vault.evacuate から戻るのを待ってから（スレッドの join など）、restore_all を呼ぶ。
       同じプロセスの中で処理中の項目は、取り違えないように飛ばし、残り（remaining）に数える
    4. 件数が多いと時間がかかる。常駐処理では、ワーカーのスレッド（そのスレッド用の DB の接続）で呼ぶか、
       should_stop で区切って少しずつ進める
    """
    now_value = time.time() if now is None else now

    # 0. 最初に「全復元が途中」の印（finished: False）を書く。この後のどこで止まっても（強制終了を含む）、
    #    前回の「終わり」の記録が残ったままにならず、resume は断られ、次の起動で続きから行う
    started = {key: 0 for key in COUNT_KEYS}
    started["total"] = started["remaining"] = len(vault.list_items(conn, vault.RESTORE_TARGET_STATES))
    started["finished"] = False
    write_progress(config, started, now_value)

    # 1. 自動処理を止める。停止の印と DB の設定の両方をそろえる
    #    （片方だけだと、印のファイルが消されたときに、確認なしで自動処理が動き出すため）
    if database.get_setting(conn, AUTOMATION_SETTING) != "0":
        engage(conn, config, "全復元", actor="kill_switch", now=now_value)
    elif not marker_present(config):
        engage(None, config, "全復元", actor="kill_switch", now=now_value)

    # 2. 途中の項目をそろえる（manifest.json を読み直すので、DB を作り直した後でも全部の項目が対象になる）
    try:
        vault.recover_incomplete(conn, platform, config, now=now)
    except Exception as error:  # 点検で予想外のエラーが起きても、全復元は続ける（途中の項目は 4. でも試す）
        logger.warning("全復元：点検の途中でエラーが起きました（%s）", type(error).__name__)

    # 3. ゴーストにする前の項目は中止にする（原本は元の場所のまま。保管庫のコピーも残す）
    for item in vault.list_items(conn, ["copying", "copied", "failed"]):
        vault.cancel(conn, config, item["item_id"],
                     "キルスイッチ（全復元）で中止しました（原本はそのままです）", actor="kill_switch", now=now)

    # 4. 退避中の項目を 1 件ずつ戻す
    targets = vault.list_items(conn, vault.RESTORE_TARGET_STATES)
    counts = {key: 0 for key in COUNT_KEYS}
    counts["total"] = len(targets)
    counts["remaining"] = len(targets)
    counts["finished"] = False
    write_progress(config, counts, now_value)
    for item in targets:
        if should_stop is not None and should_stop():
            break
        if vault.is_busy(item["current_path"]):
            continue  # 同じプロセスの中で処理中。取り違えないように飛ばし、残り（remaining）に数えたままにする
        result = restore_one(conn, platform, config, item, now)
        count_result(counts, result)
        counts["remaining"] -= 1
        if progress is not None:
            progress(dict(counts))
        write_progress(config, counts, time.time() if now is None else now)

    counts["finished"] = counts["remaining"] == 0
    write_progress(config, counts, time.time() if now is None else now)
    # 全復元の依頼に応えたので、依頼のファイルを外す（途中で止まったときは、進み具合の「途中」が残り、続きから行う）
    take_restore_request(config)
    database.log_operation(
        conn, "restore_all", actor="kill_switch", status="done" if counts["finished"] else "cancelled",
        detail=json.dumps(counts, ensure_ascii=False), at=time.time() if now is None else now,
    )
    logger.info(
        "全復元：対象 %d、戻した %d、衝突 %d、編集を残した %d、ゴーストなし %d、失敗 %d、戻っていた %d、残り %d",
        counts["total"], counts["restored"], counts["conflict"], counts["local_newer"], counts["missing"],
        counts["failed"], counts["already"], counts["remaining"],
    )
    return counts


def restore_one(conn, platform, config, item, now):
    """1 件を戻す。予想外のエラーでも全復元を止めない（その項目は保管庫に残り、次の実行で試し直す）"""
    try:
        return vault.restore(conn, platform, item["item_id"], config, actor="kill_switch", now=now)
    except Exception as error:  # 1 件の失敗で、ほかの項目の復元を止めないため
        logger.warning("全復元：項目 %s を戻せませんでした（%s）", item["item_id"], type(error).__name__)
        return {"ok": False, "state": None, "path": None, "reason": "予想外のエラー", "already": False}


def count_result(counts, result):
    """1 件の復元の結果を、件数の辞書に足す"""
    state = result.get("state")
    if state == "restored" and result.get("already"):
        counts["already"] += 1
    elif state == "restored":
        counts["restored"] += 1
    elif state == "restored_conflict":
        counts["conflict"] += 1
    elif state == "restored_local_newer":
        counts["local_newer"] += 1
    elif state == "ghost_missing":
        counts["missing"] += 1
    else:
        counts["failed"] += 1


# ----------------------------------------------------------------------
# 全復元の依頼と進み具合（制御用のファイル。件数と時刻だけで、パスや名前は書かない）
# ----------------------------------------------------------------------


def request_restore_all(config, now=None):
    """常駐処理へ全復元を依頼する（cli の restore-all が、常駐処理が動いているときに使う）。{"ok", "reason"}

    依頼と同時に、停止の印も書く（新しい自動処理を、常駐処理が依頼を受け取る前から止めるため）。
    """
    now = time.time() if now is None else now
    request = control_file(config, REQUEST_FILE_NAME)
    if request is None:
        return {"ok": False, "reason": "データフォルダー（DATA_DIR）が設定されていないため、依頼できません"}
    stopped = engage(None, config, "全復元の依頼", actor="user", now=now)
    try:
        request.parent.mkdir(parents=True, exist_ok=True)
        fsutil.atomic_write_json(request, {"at": now})
    except OSError as error:
        return {"ok": False, "reason": f"全復元の依頼を書けませんでした（{type(error).__name__}）"}
    return {"ok": True, "reason": stopped["reason"]}


def read_restore_request(config):
    """全復元の依頼があれば、その辞書を返す（依頼のファイルは外さない）。なければ None

    常駐処理はこれで依頼に気付き、依頼のファイルは、全復元が終わった後に restore_all が外します
    （依頼を受け付けた直後に止まっても、依頼が残り、resume は断られ、次の起動で全復元するため）。
    """
    request = control_file(config, REQUEST_FILE_NAME)
    if request is None:
        return None
    try:
        value = fsutil.read_json(request)
    except FileNotFoundError:
        return None
    except (OSError, ValueError):
        return {}  # 読めなくても、依頼があったことは確か
    return value if isinstance(value, dict) else {}


def take_restore_request(config):
    """全復元の依頼があれば取り出して（依頼のファイルを外して）、その辞書を返す。なければ None"""
    request = control_file(config, REQUEST_FILE_NAME)
    if request is None:
        return None
    try:
        value = fsutil.read_json(request)
    except FileNotFoundError:
        return None
    except (OSError, ValueError):
        value = {}  # 読めなくても、依頼があったことは確か
    if not isinstance(value, dict):
        value = {}
    try:
        os.remove(request)  # 依頼のファイル（制御用）を外す。同じ依頼を二度受け取らないため
    except FileNotFoundError:
        pass
    except OSError as error:
        logger.warning("全復元の依頼のファイルを外せませんでした（%s）", type(error).__name__)
    return value


def read_progress(config):
    """全復元の進み具合（件数の辞書）。まだ一度も実行していなければ None"""
    path = control_file(config, PROGRESS_FILE_NAME)
    if path is None:
        return None
    try:
        value = fsutil.read_json(path)
    except (OSError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def write_progress(config, counts, now):
    """進み具合のファイルに、件数と時刻だけを書く（書けなくても全復元は続ける）"""
    path = control_file(config, PROGRESS_FILE_NAME)
    if path is None:
        return
    value = {key: counts[key] for key in COUNT_KEYS}
    value["finished"] = counts["finished"]
    value["updated_at"] = now
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fsutil.atomic_write_json(path, value)
    except OSError as error:
        logger.warning("全復元の進み具合を書けませんでした（%s）", type(error).__name__)


# ----------------------------------------------------------------------
# 小さな部品
# ----------------------------------------------------------------------


def marker_present(config):
    """停止の印のファイルがあれば True"""
    marker = control_file(config, STOP_MARKER_NAME)
    return marker is not None and os.path.lexists(marker)


def control_file(config, name):
    """CONTROL_DIR の中のファイルのパス。CONTROL_DIR が設定されていなければ None"""
    control_dir = config.get("CONTROL_DIR")
    if control_dir is None:
        return None
    return Path(control_dir) / name


def write_together(conn):
    """まとめて書く（途中で失敗したら、すべて取り消す）。すでにまとめて書いている途中なら、その中で書く"""
    if conn.in_transaction:
        return contextlib.nullcontext()
    return database.transaction(conn)
