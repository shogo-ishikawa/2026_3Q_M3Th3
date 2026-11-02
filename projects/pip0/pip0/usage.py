"""利用の記録と「長期間未読」の判定（M4 シュレディンガー退避ストレージ）

M4 の自動退避は、「長い間使われていないファイル」だけを対象にします。
このモジュールは、ファイルが使われた記録（usage_events テーブル）を書き、
その記録から「長期間未読」かどうかを判定します（docs/design.md 4-6）。

利用の記録として数えるもの（usage_events の kind）
- "modified"：ファイルの更新（files テーブルの最終更新日時 mtime と、監視で気付いた更新）
- "recent_item"：Windows の「最近使ったファイル」（Recent フォルダー。pip0 シェルが読み取る）
- "ghost_open"：退避中のゴーストが開かれた記録（pip0 シェルの cf.fetch の知らせ）
- "access_time"：最終アクセス日時（その NTFS で更新が有効な場合だけ使う、弱い手掛かり）
- "user_action"：pip0 の画面からファイルを開いた、などの操作

守ること
- pip0 自身の読み取り（解析、ハッシュ、保管庫へのコピー）は、利用として数えない。
- 観測を始める前の利用は分からない。観測期間が短いファイルは「判定不能」（unread=None）にする。
- 閲覧を確かめる手段（「最近使ったファイル」か、更新が有効な最終アクセス日時）がないときも「判定不能」にする。
  最終更新日時だけでは、読んだかどうかは分からないため。
- 「判定不能」のファイルは退避しない（evacuation.py）。
"""

import contextlib
import json
import logging

from pip0 import database, timeutil

logger = logging.getLogger(__name__)

SECONDS_PER_DAY = 24 * 60 * 60

# 利用の種類 → 理由の文に出す名前
USAGE_KIND_LABELS = {
    "modified": "ファイルの更新",
    "recent_item": "「最近使ったファイル」の記録",
    "ghost_open": "ゴーストを開いた記録",
    "access_time": "最終アクセス日時",
    "user_action": "pip0 の画面からの操作",
}

# どのファイルでも使える利用の記録（pip0 が自分で記録できるもの）
ALWAYS_AVAILABLE_KINDS = ["modified", "ghost_open", "user_action"]

# ★pip0 自身のプロセス名（小文字）。このプロセスがファイルを開いても、利用として数えない
PIP0_PROCESS_NAMES = ["pip0shell.exe"]


# ----------------------------------------------------------------------
# 利用の記録を書く
# ----------------------------------------------------------------------


def record_usage(conn, file_id, kind, at, process_name=None, detail=None):
    """利用の記録を1件書き、その行の id を返す。pip0 自身の読み取りなら、何も書かずに None を返す

    kind：USAGE_KIND_LABELS のどれか
    at：使われた時刻（秒）
    process_name：ファイルを開いたプロセスの名前（pip0 シェルの cf.fetch の process_name）
    detail：補足（文字列か辞書）。cf.fetch の知らせなら、その payload（"by_pip0" を含む辞書）を渡す。
            "by_pip0" が True のものは pip0 自身の読み取りなので、記録しない
    """
    if kind not in USAGE_KIND_LABELS:
        raise ValueError(f"知らない利用の種類です: {kind}")
    if is_pip0_itself(process_name, detail):
        logger.debug("pip0 自身の読み取りなので、利用として数えません（%s）", kind)
        return None
    if isinstance(detail, dict):
        detail = json.dumps(detail, ensure_ascii=False)
    return database.execute(
        conn,
        "INSERT INTO usage_events (file_id, kind, at, process_name, detail) VALUES (?, ?, ?, ?, ?)",
        (file_id, kind, float(at), process_name, detail),
    )


def is_pip0_itself(process_name, detail):
    """pip0 自身（本体・シェル）がファイルを読んだ記録なら True"""
    if isinstance(detail, dict) and detail.get("by_pip0") is True:
        return True
    if detail == "by_pip0":
        return True
    if isinstance(process_name, str) and process_name.strip().lower() in PIP0_PROCESS_NAMES:
        return True
    return False


def record_recent_items(conn, items, now):
    """「最近使ったファイル」の一覧（pip0 シェルの usage.recent_items）を、利用の記録に加える。加えた件数を返す

    items：[{"target_path", "opened_at"}, ...]
    - pip0 の索引（files）にないファイルと、形の正しくない項目は飛ばす
    - 同じファイル・同じ時刻の記録がすでにあれば、二重に数えない
    - 未来の時刻（時計のずれ等）は、now として数える（使われたことは確かなので、捨てずに安全側に倒す）
    """
    count = 0
    with write_together(conn):
        for item in items or []:
            if not isinstance(item, dict):
                continue
            path = item.get("target_path")
            opened_at = item.get("opened_at")
            if not isinstance(path, str) or path == "":
                continue
            if isinstance(opened_at, bool) or not isinstance(opened_at, (int, float)):
                continue
            at = min(float(opened_at), float(now))
            file_id = find_file_id(conn, path)
            if file_id is None:
                continue
            same = database.query_one(
                conn,
                "SELECT id FROM usage_events WHERE file_id = ? AND kind = 'recent_item' AND at = ?",
                (file_id, at),
            )
            if same is not None:
                continue
            record_usage(conn, file_id, "recent_item", at)
            count += 1
    logger.info("「最近使ったファイル」から、利用の記録を %d 件加えました", count)
    return count


# ----------------------------------------------------------------------
# 最後の利用
# ----------------------------------------------------------------------


def last_use(conn, file_row, kinds=None):
    """最後に使われた時刻と種類 {"at", "kind"}。記録がなければ {"at": None, "kind": None}

    file_row：files テーブルの行（辞書）。最終更新日時（mtime）も「ファイルの更新」として数える
    kinds：数える種類のリスト（None ならすべて）。tracking_sources の "sources" を渡す
    """
    best = {"at": None, "kind": None}
    if (kinds is None or "modified" in kinds) and file_row.get("mtime") is not None:
        best = {"at": float(file_row["mtime"]), "kind": "modified"}

    sql = "SELECT kind, at FROM usage_events WHERE file_id = ?"
    params = [file_row["id"]]
    if kinds is not None:
        if not kinds:
            return best
        sql += " AND kind IN (" + ", ".join("?" for _ in kinds) + ")"
        params.extend(kinds)
    sql += " ORDER BY at DESC LIMIT 1"
    row = database.query_one(conn, sql, tuple(params))
    if row is not None and (best["at"] is None or row["at"] > best["at"]):
        best = {"at": row["at"], "kind": row["kind"]}
    return best


# ----------------------------------------------------------------------
# 判定
# ----------------------------------------------------------------------


def tracking_sources(platform, path, recent_items_enabled):
    """このファイルについて、どの利用の記録を使えるかを調べる

    recent_items_enabled：Windows の「最近使ったファイル」の記録が有効か
                          （pip0 シェルの usage.recent_items の tracking_enabled。分からなければ None）
    戻り値：{"reliable", "sources", "reason"}
    - sources：数えてよい利用の種類のリスト
    - reliable：閲覧を確かめる手段（「最近使ったファイル」か、更新が有効な最終アクセス日時）が
      1つ以上あれば True。なければ False（そのファイルは「判定不能」になる）
    """
    sources = list(ALWAYS_AVAILABLE_KINDS)
    if recent_items_enabled is True:
        sources.append("recent_item")
    access_time = platform.access_time_reliable(path)
    if access_time is True:
        sources.append("access_time")

    reliable = recent_items_enabled is True or access_time is True
    if reliable:
        labels = [USAGE_KIND_LABELS[kind] for kind in sources]
        reason = "使える利用の記録：" + "、".join(labels)
    else:
        reason = (
            f"「最近使ったファイル」の記録が{availability_word(recent_items_enabled)}で、"
            f"最終アクセス日時の更新も{availability_word(access_time)}なため、"
            "閲覧したかどうかを確かめられません（判定不能）"
        )
    return {"reliable": reliable, "sources": sources, "reason": reason}


def availability_word(value):
    if value is False:
        return "無効"
    return "有効か分からない状態"


def observation_start(file_row):
    """観測を始めた時刻：pip0 が見つけた時刻（first_seen_at）と、ファイルの作成日時（ctime）の遅いほう

    コピーしたファイルや圧縮ファイルから取り出したファイルは、作成日時がその時刻になります。
    作成される前の利用は観測できないので、作成日時より前から観測していたことにはしません。
    """
    start = file_row["first_seen_at"]
    created = file_row.get("ctime")
    if isinstance(created, (int, float)) and created > start:
        return created
    return start


def judge_long_unread(conn, file_row, now, config, sources):
    """長期間未読かどうかを判定する（docs/design.md 4-6）

    file_row：files テーブルの行（辞書）。first_seen_at が pip0 の観測を始めた時刻
    sources：tracking_sources の戻り値
    戻り値：{"unread": True/False/None, "reason", "observed_days", "idle_days"}
    - True：長期間未読（退避してよい）
    - False：最近使われている
    - None：判定不能（観測期間が足りない、閲覧を確かめる手段がない）。退避しない
    """
    unread_days = config["UNREAD_DAYS"]
    min_observed_days = config["MIN_OBSERVED_DAYS"]
    observed_days = max(0.0, (now - observation_start(file_row)) / SECONDS_PER_DAY)
    result = {"unread": None, "reason": "", "observed_days": round(observed_days, 1), "idle_days": None}

    # 1. 観測期間が短いファイルは、観測を始める前の利用が分からないので判定しない
    if observed_days < min_observed_days:
        result["reason"] = (
            f"pip0 が観測を始めてから {observed_days:.0f} 日で、"
            f"{min_observed_days} 日に満たないため判定できません（判定不能）"
        )
        return result

    # 2. 閲覧を確かめる手段がなければ判定しない
    if not sources.get("reliable"):
        result["reason"] = sources.get("reason") or "閲覧を確かめる手段がないため判定できません（判定不能）"
        return result

    # 3. 最後の利用からの日数
    last = last_use(conn, file_row, kinds=sources.get("sources"))
    if last["at"] is None:
        idle_days = observed_days
        last_text = "観測を始めてから利用の記録がありません"
    else:
        idle_days = max(0.0, (now - last["at"]) / SECONDS_PER_DAY)
        label = USAGE_KIND_LABELS.get(last["kind"], last["kind"])
        last_text = f"最後の利用は {timeutil.local_date_str(last['at'])}（{label}）"
    result["idle_days"] = round(idle_days, 1)

    if idle_days < unread_days:
        result["unread"] = False
        result["reason"] = f"{last_text}で、{idle_days:.0f} 日前です（{unread_days} 日未満）"
        return result

    # ★安全策：未読とみなす期間（UNREAD_DAYS）の全体を観測していなければ、判定しない
    #   （MIN_OBSERVED_DAYS を UNREAD_DAYS より短くした場合に、観測前の利用を見落とさないため）
    if observed_days < unread_days:
        result["reason"] = (
            f"{last_text}。ただし pip0 が観測したのは {observed_days:.0f} 日だけで、"
            f"{unread_days} 日の全体を見ていないため判定できません（判定不能）"
        )
        return result

    result["unread"] = True
    result["reason"] = (
        f"{last_text}で、{idle_days:.0f} 日間使われていません"
        f"（{unread_days} 日以上。観測 {observed_days:.0f} 日）"
    )
    return result


# ----------------------------------------------------------------------
# 小さな部品
# ----------------------------------------------------------------------


def find_file_id(conn, path):
    """files テーブルで path の行の id を探す。Windows の大文字・小文字の違いは、1件に決まるときだけ同じとみなす"""
    row = database.query_one(conn, "SELECT id FROM files WHERE path = ?", (path,))
    if row is not None:
        return row["id"]
    rows = database.query_all(conn, "SELECT id FROM files WHERE path = ? COLLATE NOCASE", (path,))
    if len(rows) == 1:
        return rows[0]["id"]
    return None


def write_together(conn):
    """まとめて書く（途中で失敗したら、すべて取り消す）。すでにまとめて書いている途中なら、その中で書く"""
    if conn.in_transaction:
        return contextlib.nullcontext()
    return database.transaction(conn)
