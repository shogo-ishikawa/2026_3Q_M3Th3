"""対象フォルダーの見直し（索引の作成）

ダウンロードフォルダー、pip0 専用フォルダー、追加の対象フォルダーの中のファイルを、
files テーブル（索引）に記録します。読むのは、ファイルの一覧と、大きさ・更新日時などの情報だけです。
中身は読みません（中身の解析は、電源接続中かつ3分間無操作のときに、解析の順番待ちから行います）。

次のものは、たどらず、記録もしません（should_skip と should_skip_folder）。
- 一時ファイル、ダウンロード途中のファイル、隠しファイル（rules.EXCLUDED_NAME_PATTERNS など）
- リンク、ジャンクション、再解析ポイント（たどると、対象フォルダーの外や、同じファイルを何度も読むことがある）
- 中身がこの PC にないファイル（pip0 のゴースト、ほかのクラウドの未取得のプレースホルダー）。
  読むと中身の取得が始まるため
- pip0 のデータフォルダーと保管庫の中

新しいファイルと、大きさか更新日時が変わったファイルは、解析の順番待ちに入れます。
"""

import contextlib
import logging
import os
import re
import stat
import sys

from pip0 import analysis_queue, database, provenance, safe_names
from pip0 import config as config_module

logger = logging.getLogger(__name__)

# 何件ごとにまとめて DB に書くか。大きくすると速くなるが、受け口（native_host）の書き込みを長く待たせる
SCAN_BATCH_FILES = 100

# 場所の種類（location_kind）の表示名
LOCATION_LABELS = {
    "downloads": "ダウンロード",
    "pip0_root": "pip0 専用フォルダー",
    "extra": "追加の対象フォルダー",
}

# 件数の辞書の項目
COUNT_KEYS = ["seen", "new", "changed", "skipped", "missing", "errors"]

# Windows の「隠しファイル」と「システムファイル」の属性（desktop.ini、$RECYCLE.BIN など）
HIDDEN_OR_SYSTEM = stat.FILE_ATTRIBUTE_HIDDEN | stat.FILE_ATTRIBUTE_SYSTEM


# ----------------------------------------------------------------------
# 対象にするかどうか（★対象外にする条件を増やすときは、ここに足します）
# ----------------------------------------------------------------------


def should_skip(path, platform, config, rules):
    """索引に入れないファイルなら (True, 理由)、入れてよければ (False, "") を返す"""
    path = os.fspath(path)
    if is_excluded_name(os.path.basename(path), rules):
        return True, "対象外の名前です（一時ファイル、ダウンロード途中、隠しファイル等）"
    try:
        st = os.lstat(path)  # リンクはたどらずに、リンクそのものを調べる
    except OSError:
        return True, "ファイルが見つかりません"
    if stat.S_ISLNK(st.st_mode):
        return True, "リンクはたどりません"
    if is_junction(path, st):
        return True, "ジャンクションはたどりません"
    if not stat.S_ISREG(st.st_mode):
        return True, "通常のファイルではありません"
    if has_attribute(st, HIDDEN_OR_SYSTEM):
        return True, "隠しファイル・システムファイルは対象外です"
    if inside_pip0_data(path, config):
        return True, "pip0 のデータフォルダー・保管庫の中は読みません"
    state = platform.get_local_state(path)
    if state.get("local") is not True:
        return True, "中身がこの PC にないファイル（ゴースト、クラウドの未取得のプレースホルダー）は読みません"
    if state.get("reparse") or has_attribute(st, stat.FILE_ATTRIBUTE_REPARSE_POINT):
        return True, "再解析ポイント（リンク、クラウドのファイル等）はたどりません"
    return False, ""


def should_skip_folder(path, config):
    """たどらないフォルダーなら True（隠しフォルダー、リンク、ジャンクション、pip0 のデータフォルダー・保管庫）"""
    if os.path.basename(path).startswith("."):
        return True
    try:
        st = os.lstat(path)
    except OSError:
        return True
    if stat.S_ISLNK(st.st_mode) or is_junction(path, st):
        return True
    if has_attribute(st, HIDDEN_OR_SYSTEM):
        return True
    return inside_pip0_data(path, config)


def is_excluded_name(name, rules):
    """名前が rules.EXCLUDED_NAME_PATTERNS のどれかに一致すれば True（大文字・小文字は区別しない）"""
    for pattern in rules.EXCLUDED_NAME_PATTERNS:
        if re.search(pattern, name, re.IGNORECASE):
            return True
    return False


def is_junction(path, st):
    """ジャンクション（Windows のフォルダーの別名）なら True

    os.path.isjunction は Python 3.12 からの関数です。
    3.11 では、フォルダーの再解析ポイントをジャンクションとみなします。
    """
    if hasattr(os.path, "isjunction"):
        return os.path.isjunction(path)
    return stat.S_ISDIR(st.st_mode) and has_attribute(st, stat.FILE_ATTRIBUTE_REPARSE_POINT)


def has_attribute(st, flags):
    """Windows のファイルの属性（隠し、システム、再解析ポイント等）を持っていれば True

    st_file_attributes は Windows だけにある値です。Windows 以外では、属性がないものとして扱います。
    """
    attributes = getattr(st, "st_file_attributes", 0)
    return (attributes & flags) != 0


def inside_pip0_data(path, config):
    """pip0 のデータフォルダー（暗号化DB、制御ファイル、ログ）か保管庫の中なら True"""
    for folder in (config.get("DATA_DIR"), config.get("VAULT_DIR")):
        if folder is not None and config_module.is_inside(path, folder):
            return True
    return False


# ----------------------------------------------------------------------
# 1つのファイルを索引に記録する
# ----------------------------------------------------------------------


def upsert_file(conn, platform, path, location_kind, now):
    """1つのファイルを索引（files テーブル）に記録する。記録しないときは None

    呼ぶ前に should_skip で、対象にしてよいファイルかを確かめてください。
    戻り値：{"file_id", "is_new", "changed"}
    - is_new：初めて見つけたファイル（行を追加した）
    - changed：前に記録した大きさか更新日時と違う（新しいファイルは False）

    1. 同じパスの行があれば、それを更新する
    2. なければ、名前の変更・移動の前の行（同じ実体で、元の場所にもうファイルがないもの）を探し、
       あればその行のパスを書き換える（解析結果、入手経路、観測の開始日時を引き継ぐ）
    3. どちらもなければ、新しい行を追加する（観測の開始 first_seen_at は now）
    - 新しいファイルと変わったファイル（中身がこの PC にあるもの）は、解析の順番待ちに入れる
    - pip0 のゴースト（中身は保管庫）は、状態を ghost にし、解析の順番待ちには入れない
    - 更新日時が進んでいたら、利用の記録（usage_events の modified）を、その更新日時で1件残す
    """
    path = os.path.abspath(os.fspath(path))
    try:
        st = os.lstat(path)  # リンクはたどらない
    except OSError:
        return None  # 見つける前に消えた・名前が変わった
    if not stat.S_ISREG(st.st_mode):
        return None
    info = file_info(path, st)
    file_key = platform.get_file_key(path)

    # 中身がこの PC にあるかを確かめる（中身は読まない）
    state = platform.get_local_state(path)
    if state.get("local") is True:
        status = "present"
    elif platform.ghost_status(path).get("is_ghost") is True:
        status = "ghost"  # pip0 のゴースト：行は残すが、読まない
    else:
        return None  # ほかのクラウドの未取得のプレースホルダー等：索引に入れない（読まない）
    still_placeholder = state.get("placeholder") is True

    with write_together(conn):
        row = database.query_one(conn, "SELECT * FROM files WHERE path = ?", (path,))
        # 同じパスでも、前とは別のファイルなら、観測（first_seen_at）を始め直す
        new_observation = row is not None and is_different_file(row, file_key, info)
        if row is None:
            row = find_renamed_row(conn, path, file_key, info)

        if row is None:
            file_id = insert_row(conn, path, file_key, info, location_kind, status, now)
            if status == "present":
                mark_for_analysis(conn, file_id, now)
            return {"file_id": file_id, "is_new": True, "changed": False}

        if status == "present" and still_placeholder and row["status"] == "ghost":
            # 開かれて中身が戻ったゴースト。通常のファイルに戻す（vault）までは、ゴーストのまま扱う
            status = "ghost"
        changed = row["size"] != info["size"] or row["mtime"] != info["mtime"]
        if row["mtime"] is not None and info["mtime"] > row["mtime"]:
            # 更新日時が進んだ＝ファイルが変更された。利用の記録として残す（長期間未読の判定に使う）
            conn.execute("INSERT INTO usage_events (file_id, kind, at) VALUES (?, 'modified', ?)",
                         (row["id"], info["mtime"]))
        update_row(conn, row, path, file_key, info, location_kind, status, now, new_observation)
        if status == "present" and (changed or not has_analysis_row(conn, row["id"])):
            mark_for_analysis(conn, row["id"], now)
        return {"file_id": row["id"], "is_new": False, "changed": changed}


def file_info(path, st):
    """名前、拡張子（小文字、. 付き）、大きさ、更新日時、作成日時の辞書"""
    name = os.path.basename(path)
    return {
        "name": name,
        "ext": safe_names.split_ext(name)[1].lower(),
        "size": st.st_size,
        "mtime": st.st_mtime,
        "ctime": creation_time(st),
    }


def creation_time(st):
    """作成日時（秒）。分からなければ None

    Linux の st_ctime は「属性を変えた日時」で、作成日時ではないため使いません。
    """
    if hasattr(st, "st_birthtime"):
        return st.st_birthtime
    if sys.platform == "win32":
        return st.st_ctime  # Python 3.11 の Windows では、st_ctime が作成日時
    return None


def is_different_file(row, file_key, info):
    """同じパスの行が、前とは別のファイルを指しているなら True（長期間未読の判定のため、観測を始め直す）

    - 前のファイルが消えていた（missing）ところに、ファイルができた
    - ファイル番号が変わった（別のファイルで置き換えられた）
    - 更新日時が前より古くなった（古いファイルのコピーや、圧縮ファイルから取り出したもので置き換えられた）
    観測を始め直さないと、新しいファイルが、前のファイルの観測期間を受け継いでしまいます
    （コピーしたファイルは更新日時が古いままなので、置いた直後に「長期間未読」と判定されてしまう）。
    """
    if row["status"] == "missing":
        return True
    if row["file_key"] is not None and file_key is not None and row["file_key"] != file_key:
        return True
    return row["mtime"] is not None and info["mtime"] < row["mtime"]


def find_renamed_row(conn, path, file_key, info):
    """名前の変更・移動の前の行を探す。見つからなければ None

    同じ実体（file_key が同じ）で、元の場所にもうファイルがない行を探します。
    file_key が同じでも、大きさか更新日時が違えば別のファイルとみなします
    （FAT／exFAT や Linux では、消えたファイルの番号が、新しいファイルに使い回されることがあるため）。
    元の場所にもファイルがある行（ハードリンク等）は、名前の変更ではありません。
    """
    if file_key is None:
        return None
    rows = database.query_all(
        conn, "SELECT * FROM files WHERE file_key = ? ORDER BY last_seen_at DESC, id DESC", (file_key,)
    )
    for row in rows:
        if row["size"] != info["size"] or row["mtime"] != info["mtime"]:
            continue
        if os.path.lexists(row["path"]) and not provenance.same_path(row["path"], path):
            continue
        return row
    return None


def insert_row(conn, path, file_key, info, location_kind, status, now):
    """files に新しい行を追加し、その id を返す"""
    return database.execute(
        conn,
        "INSERT INTO files (path, file_key, name, ext, size, mtime, ctime, location_kind, status, "
        "first_seen_at, last_seen_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (path, file_key, info["name"], info["ext"], info["size"], info["mtime"], info["ctime"],
         location_kind, status, now, now, now),
    )


def update_row(conn, row, path, file_key, info, location_kind, status, now, new_observation=False):
    """files の行を、今のファイルの情報に書き換える

    観測の開始 first_seen_at は、new_observation が True（別のファイルに置き換わった）のときだけ now にする。
    """
    ctime = info["ctime"] if info["ctime"] is not None else row["ctime"]
    new_values = (path, file_key, info["name"], info["ext"], info["size"], info["mtime"], ctime, location_kind, status)
    old_values = (row["path"], row["file_key"], row["name"], row["ext"], row["size"], row["mtime"], row["ctime"],
                  row["location_kind"], row["status"])
    # updated_at は、行の内容が変わったときだけ進める（last_seen_at は、見つけるたびに進める）
    updated_at = now if new_values != old_values else row["updated_at"]
    first_seen_at = now if new_observation else row["first_seen_at"]
    conn.execute(
        "UPDATE files SET path = ?, file_key = ?, name = ?, ext = ?, size = ?, mtime = ?, ctime = ?, "
        "location_kind = ?, status = ?, first_seen_at = ?, last_seen_at = ?, updated_at = ? WHERE id = ?",
        new_values + (first_seen_at, now, updated_at, row["id"]),
    )


def has_analysis_row(conn, file_id):
    row = conn.execute("SELECT 1 FROM analysis WHERE file_id = ?", (file_id,)).fetchone()
    return row is not None


def mark_for_analysis(conn, file_id, now):
    """analysis の行を「解析待ち」（pending）にし（なければ作る）、解析の順番待ちに入れる

    中身が変わったファイルの「非機密」（not_sensitive）の判定は古くなるため、「未判定」（unknown）に戻します。
    「機密」（sensitive）の判定は、解析し直すまで残します（警告を弱めないため）。
    """
    row = database.query_one(conn, "SELECT sensitivity FROM analysis WHERE file_id = ?", (file_id,))
    if row is None:
        conn.execute("INSERT INTO analysis (file_id, status) VALUES (?, 'pending')", (file_id,))
    else:
        sensitivity = row["sensitivity"]
        if sensitivity == "not_sensitive":
            sensitivity = "unknown"
        conn.execute("UPDATE analysis SET status = 'pending', sensitivity = ? WHERE file_id = ?",
                     (sensitivity, file_id))
    analysis_queue.enqueue(conn, "analyse", file_id, now=now)


def write_together(conn):
    """まとめて書く（途中で失敗したら、すべて取り消す）。すでにまとめて書いている途中なら、その中で書く"""
    if conn.in_transaction:
        return contextlib.nullcontext()
    return database.transaction(conn)


# ----------------------------------------------------------------------
# フォルダーを見直す
# ----------------------------------------------------------------------


def scan_folder(conn, platform, folder, location_kind, config, rules, now):
    """1つの対象フォルダーの中を見直し、索引を新しくする。件数の辞書を返す

    - 中のフォルダーも順にたどる（隠しフォルダー、リンク、ジャンクション、pip0 のデータフォルダー・保管庫はたどらない）
    - 今回見つからなかったファイルの行は「なし」（missing）にする。
      ただし、ゴースト（退避中）の行と、読めなかったフォルダーの中の行は変えない
    - フォルダーそのものが見つからないときは、索引を変えずに ok を False にして返す
    戻り値：{"ok", "reason", "seen", "new", "changed", "skipped", "missing", "errors"}
    """
    counts = empty_counts()
    folder = os.path.abspath(os.fspath(folder))
    if not os.path.isdir(folder):
        counts["ok"] = False
        counts["reason"] = "フォルダーが見つからないため、見直しませんでした（索引はそのまま残します）"
        return counts

    paths, failed_folders = list_files(folder, platform, config, rules, counts)

    seen_ids = set()
    for start in range(0, len(paths), SCAN_BATCH_FILES):
        with write_together(conn):
            for path in paths[start:start + SCAN_BATCH_FILES]:
                result = upsert_file(conn, platform, path, location_kind, now)
                if result is None:
                    counts["skipped"] += 1
                    continue
                seen_ids.add(result["file_id"])
                counts["seen"] += 1
                if result["is_new"]:
                    counts["new"] += 1
                elif result["changed"]:
                    counts["changed"] += 1

    counts["missing"] = mark_missing(conn, platform, folder, seen_ids, failed_folders, now)
    logger.info("見直し（%s）：%d 件（新規 %d、変更 %d、なし %d、対象外 %d、エラー %d）",
                location_kind, counts["seen"], counts["new"], counts["changed"],
                counts["missing"], counts["skipped"], counts["errors"])
    return counts


def list_files(folder, platform, config, rules, counts):
    """folder の中の、索引に入れるファイルのパスのリストと、読めなかったフォルダーのリストを返す"""
    paths = []
    errors = []  # 読めなかったフォルダー（権限がない等）の OSError
    for current, folder_names, file_names in os.walk(folder, onerror=errors.append, followlinks=False):
        # たどらないフォルダーを、リストから取り除く（os.walk は、このリストに残ったフォルダーだけをたどる）
        folder_names[:] = [name for name in folder_names
                           if not should_skip_folder(os.path.join(current, name), config)]
        for name in file_names:
            path = os.path.join(current, name)
            skip, _reason = should_skip(path, platform, config, rules)
            if skip:
                counts["skipped"] += 1
            else:
                paths.append(path)
    counts["errors"] += len(errors)
    failed_folders = [os.fspath(error.filename) for error in errors if error.filename]
    return paths, failed_folders


def mark_missing(conn, platform, folder, seen_ids, failed_folders, now):
    """folder の中で今回見つからなかった行を「なし」（missing）にし、その件数を返す

    状態が present の行だけを変える（ゴーストの行は、保管庫の処理が扱うため変えない）。
    読めなかったフォルダーの中の行も、ファイルが消えたとは限らないため変えない。
    見つからなかった理由が「pip0 のゴーストになった」ことなら、行を ghost にする（中身は読まない）。
    """
    rows = database.query_all(conn, "SELECT id, path FROM files WHERE status = 'present'")
    count = 0
    with write_together(conn):
        for row in rows:
            if row["id"] in seen_ids or not is_under(row["path"], folder):
                continue
            if any(is_under(row["path"], failed) for failed in failed_folders):
                continue
            if os.path.lexists(row["path"]) and platform.ghost_status(row["path"]).get("is_ghost") is True:
                conn.execute("UPDATE files SET status = 'ghost', updated_at = ? WHERE id = ?", (now, row["id"]))
                continue
            conn.execute("UPDATE files SET status = 'missing', updated_at = ? WHERE id = ?", (now, row["id"]))
            count += 1
    return count


def is_under(path, folder):
    """path が folder と同じか、その中にあれば True（パスの文字列で比べる。大文字・小文字は区別しない）"""
    path_key = provenance.normalise_path(path)
    folder_key = provenance.normalise_path(folder)
    if path_key == folder_key:
        return True
    if not folder_key.endswith(os.sep):
        folder_key = folder_key + os.sep
    return path_key.startswith(folder_key)


def empty_counts():
    return {"ok": True, "reason": "", "seen": 0, "new": 0, "changed": 0, "skipped": 0, "missing": 0, "errors": 0}


def scan_all(conn, platform, config, rules, now):
    """すべての対象フォルダー（config.index_folders）を見直す。件数の合計の辞書を返す

    戻り値：{"ok", "reason", "folders", "seen", "new", "changed", "skipped", "missing", "errors"}
    見つからないフォルダーがあれば ok を False にし、reason にどの種類のフォルダーかを書く（パスは書かない）。
    """
    totals = empty_counts()
    totals["folders"] = 0
    problems = []
    for folder, location_kind in config_module.index_folders(config):
        if folder is None:
            continue
        counts = scan_folder(conn, platform, folder, location_kind, config, rules, now)
        totals["folders"] += 1
        for key in COUNT_KEYS:
            totals[key] += counts[key]
        if not counts["ok"]:
            label = LOCATION_LABELS.get(location_kind, location_kind)
            problems.append(f"{label}：{counts['reason']}")
    if problems:
        totals["ok"] = False
        totals["reason"] = "／".join(problems)
    return totals
