"""ファイルの移動と名前の変更（M1 の自動仕分け・自動改名で使う）

pip0 がユーザーのファイルを移動したり、名前を変えたりするときは、必ずこのモジュールを通します。
守ることは次のとおりです。

- 既存のファイルを上書きしない。同じ名前があれば「 (2)」などを付ける（最後は fsutil.no_overwrite_rename）
- 移動先は、pip0 専用フォルダー（PIP0_ROOT）の中か、今と同じフォルダー（名前だけを変える）に限る
- 同じドライブの中だけで動かす（別のドライブへの移動は「コピーして元を消す」処理になるため、初期コードでは行わない）
- 次のファイルは動かさない：使用中・ダウンロード途中のもの、退避中のもの（ゴースト）、リンク、
  中身がこの PC にないもの（クラウドの未取得のプレースホルダー）、pip0 のデータフォルダー・保管庫の中のもの
- 最終更新日時を変えない
- 移動の前後のパスと判断の根拠（reasons）を、操作履歴（operations テーブル）に残す。
  移動しなかったとき（skipped）と失敗したとき（failed）も、その理由を残す

戻り値は、どの関数も次の形の辞書です。
    {"ok": True/False, "status": "done"/"failed"/"skipped", "path": ファイルの今の場所, "reason": 理由}
"""

import contextlib
import errno
import logging
import os
import time
from pathlib import Path

from pip0 import config as config_module
from pip0 import database, fsutil, safe_names

logger = logging.getLogger(__name__)

# Windows の多くのアプリが扱えるパスの長さ（MAX_PATH の 260 文字から、文字列の終わりの印の 1 を引いた数）
MAX_PATH_CHARS = 259

# 名前を選んだ直後に、ほかのアプリが同じ名前のファイルを作ったとき、別の名前でやり直す回数の上限
MAX_RENAME_ATTEMPTS = 20

# キルスイッチの停止の印（docs/design.md 4-9 の control\automation.stopped）。
# この印がある間は、自動（actor="auto"）の移動・改名をしない
STOP_MARKER_NAME = "automation.stopped"

PATH_TOO_LONG = "移動先のフォルダーのパスが長すぎて名前を付けられないため、移動しません"


def move_and_rename(conn, platform, src, dest_dir, new_name, *, kind, actor, reasons, config,
                    registry=None, file_id=None, now=None):
    """src を、dest_dir の中へ new_name という名前で移動する（上書きしない、同じドライブの中だけ）

    new_name：新しい名前。None なら今の名前のまま移動する（改名は解析の後にする場合など）
    kind：操作履歴に書く操作の種類（例："sort"、"rename"）
    actor：だれの操作か（"auto"、"user" など）
    reasons：判断の根拠（文字列のリスト）。操作履歴にそのまま残す
    registry：watcher.SelfChangeRegistry。渡すと、pip0 自身の移動による監視の知らせを無視できる
    file_id：files テーブルの行の id。None ならパスで探す

    戻り値の status
    - "done"：移動・改名した（名前を直したときは、reason に何をしたかを書く）
    - "skipped"：条件を満たさないので、何もしなかった（ファイルは元の場所のまま）
    - "failed"：移動しようとしたが、OS の操作が失敗した（ファイルは元の場所のまま）
    """
    now = time.time() if now is None else now
    src = Path(os.path.abspath(src))
    dest_dir = Path(os.path.abspath(dest_dir))
    if new_name is None:
        new_name = src.name
    if is_same_folder(dest_dir, src.parent):
        # 同じフォルダーを別の書き方で指定されても、移動元と同じ書き方にそろえる
        dest_dir = src.parent

    row = find_file_row(conn, file_id, src)
    history = {
        "kind": kind,
        "actor": actor,
        "reasons": reasons,
        "file_id": row["id"] if row is not None else None,
        "now": now,
    }

    # 1. 動かしてよいかを確かめる（だめなら、何もせずに理由を残す）
    problem = None
    if actor == "auto" and automation_stopped(config):
        problem = "自動処理は停止中です（キルスイッチ）。移動・改名をしません"
    if problem is None:
        problem = check_source(platform, src, config)
    if problem is None:
        try:
            problem = check_destination(src, dest_dir, config)
        except OSError as error:
            problem = "移動先を確かめられませんでした（" + describe_error(error) + "）"
    wanted = safe_names.make_safe(new_name)
    if problem is None and choose_name(dest_dir, wanted, src) is None:
        problem = PATH_TOO_LONG
    if problem is not None:
        return record_not_moved(conn, src, "skipped", problem, history)

    # 2. 移動先のフォルダーがなければ作る（pip0 専用フォルダーの中だけ。check_destination で確かめ済み）
    try:
        make_folders(dest_dir, registry, now)
    except OSError as error:
        reason = "移動先のフォルダーを作れませんでした（" + describe_error(error) + "）"
        return record_not_moved(conn, src, "failed", reason, history)

    # 3. 名前を決めて、上書きせずに移動する。
    #    同じドライブの中で名前を付け替えるだけ（中身をコピーしない）なので、最終更新日時は変わらない
    moved = rename_without_overwrite(src, dest_dir, wanted, registry, now)
    if not moved["ok"]:
        return record_not_moved(conn, src, moved["status"], moved["reason"], history)
    dst = moved["path"]
    changed = str(dst) != str(src)

    # 4. 名前を直したことの説明（操作履歴と戻り値の reason に使う）
    notes = []
    if not changed:
        notes.append("名前と場所が今と同じため、変更しませんでした")
    if wanted != new_name:
        notes.append("Windows で使える名前に整えました")
    if changed and dst.name != wanted:
        notes.append("同じ名前のファイルがあるか、パスが長すぎるため、名前を調整しました")
    if moved["raced"]:
        notes.append("移動の直前に同じ名前のファイルができたため、別の名前にしました")
    detail = "。".join(notes)

    # 5. 索引（files）と操作履歴を、まとめて書く
    with write_together(conn):
        if changed:
            remove_stale_row(conn, dst, history["file_id"])
            if row is not None:
                update_file_row(conn, row, dst, config, now)
        database.log_operation(
            conn, kind, actor=actor, status="done", file_id=history["file_id"],
            before_path=str(src), after_path=str(dst), reasons=reasons,
            detail=detail or None, at=now,
        )
    logger.info("ファイル操作（%s）：done", kind)
    return {"ok": True, "status": "done", "path": str(dst), "reason": detail}


def rename_in_place(conn, platform, src, new_name, *, kind, actor, reasons, config,
                    registry=None, file_id=None, now=None):
    """同じフォルダーのまま、名前だけを変える（move_and_rename の移動先を、今のフォルダーにしたもの）"""
    folder = Path(os.path.abspath(src)).parent
    return move_and_rename(
        conn, platform, src, folder, new_name,
        kind=kind, actor=actor, reasons=reasons, config=config,
        registry=registry, file_id=file_id, now=now,
    )


# ----------------------------------------------------------------------
# 動かしてよいかの確認（★動かさない条件を増やすときは、ここに足します）
# ----------------------------------------------------------------------


def check_source(platform, src, config):
    """移動元のファイルを確かめる。動かしてよければ None、だめなら理由（日本語）を返す"""
    if not os.path.lexists(src):
        return "ファイルが見つかりません"
    if os.path.islink(src):
        return "シンボリックリンクは移動しません（リンク先もたどりません）"
    if os.path.isdir(src):
        return "フォルダー（ジャンクションを含む）は移動しません"
    if not os.path.isfile(src):
        return "通常のファイルではないため、移動しません"
    if inside_pip0_data(src, config):
        return "pip0 のデータフォルダー・保管庫の中のファイルは移動しません"

    # 退避中のファイル（ゴースト）は、中身が保管庫にあるため決して動かさない
    ghost = platform.ghost_status(src)
    if ghost.get("is_ghost") is True:
        return "退避中のファイル（ゴースト）は移動しません。先に復元してください"
    root = config.get("PIP0_ROOT")
    if ghost.get("is_ghost") is None and root is not None and config_module.is_inside(src, root):
        # ゴーストを置けるのは pip0 専用フォルダーの中だけ。そこで確かめられないときは動かさない
        return "退避中のファイル（ゴースト）かどうかを確かめられないため、移動しません"

    state = platform.get_local_state(src)
    if state.get("local") is not True:
        return "中身がこの PC にないファイル（クラウドの未取得のプレースホルダー等）は移動しません"
    if state.get("reparse"):
        return "リンクや再解析ポイント（ジャンクション等）は移動しません"

    # 中身が手元にあると分かってから、排他的に開けるかを確かめる（使用中・ダウンロード途中なら開けない）
    if not platform.can_open_exclusively(src):
        return "ほかのアプリが使用中か、ダウンロードが終わっていないため、移動しません"
    return None


def check_destination(src, dest_dir, config):
    """移動先のフォルダーを確かめる。移動してよければ None、だめなら理由（日本語）を返す"""
    root = config.get("PIP0_ROOT")
    same_folder = str(dest_dir) == str(src.parent)
    inside_root = root is not None and config_module.is_inside(dest_dir, root)
    if not same_folder and not inside_root:
        return "移動先は、pip0 専用フォルダーの中か、今と同じフォルダー（名前の変更）だけです"
    if inside_pip0_data(dest_dir, config):
        return "pip0 のデータフォルダー・保管庫の中へは移動しません"
    if inside_root and not Path(root).is_dir():
        return "pip0 専用フォルダーが見つかりません"
    if os.path.lexists(dest_dir) and not os.path.isdir(dest_dir):
        return "移動先がフォルダーではありません"
    # ドライブ（ボリューム）の番号を比べる。移動先のフォルダーがまだなければ、あるところまで親をさかのぼる
    if os.stat(src).st_dev != os.stat(nearest_existing_folder(dest_dir)).st_dev:
        return "別のドライブへの移動は初期コードでは行いません"
    return None


def automation_stopped(config):
    """キルスイッチの停止の印（CONTROL_DIR の automation.stopped）があれば True"""
    control_dir = config.get("CONTROL_DIR")
    if control_dir is None:
        return False
    return (Path(control_dir) / STOP_MARKER_NAME).exists()


def inside_pip0_data(path, config):
    """pip0 のデータフォルダー（暗号化DB、制御ファイル、ログ）か保管庫の中なら True"""
    for folder in (config.get("DATA_DIR"), config.get("VAULT_DIR")):
        if folder is not None and config_module.is_inside(path, folder):
            return True
    return False


def is_same_folder(folder_a, folder_b):
    """2つのフォルダーが同じ場所なら True（リンクなどによる別の書き方も同じとみなす）"""
    return Path(folder_a).resolve() == Path(folder_b).resolve()


def nearest_existing_folder(folder):
    """folder か、その親のうち、実際にある最も近いフォルダーを返す"""
    folder = Path(folder)
    while not folder.exists() and folder.parent != folder:
        folder = folder.parent
    return folder


# ----------------------------------------------------------------------
# 名前を決めて、上書きせずに移動する
# ----------------------------------------------------------------------


def choose_name(dest_dir, wanted_name, src):
    """dest_dir の中で使う名前を決める。収まる名前がなければ None を返す

    1. パス全体が MAX_PATH_CHARS 文字以下になるように、拡張子の前を短くする
    2. 同じ名前のファイルがあれば、safe_names.unique_name で「 (2)」などを付ける
    3. 番号を付けて長くなりすぎたら、はみ出した文字数だけ短くして 1. からやり直す
       （短くした名前が空いていれば、番号は付きません）
    """
    room = MAX_PATH_CHARS - len(os.path.join(str(dest_dir), ""))  # 名前に使える文字数
    while room > 0:
        name = safe_names.make_safe(wanted_name, max_len=room)
        if len(name) > room:
            return None  # 拡張子と1文字だけでも収まらない
        numbered = safe_names.unique_name(str(dest_dir), name, exists=lambda path: name_is_taken(path, src))
        if len(numbered) <= room:
            return numbered
        room = len(name) - (len(numbered) - room)
    return None


def name_is_taken(path, src):
    """path の名前がすでに使われていれば True

    移動元のファイル自身は数えない（名前を変えずに移動するときや、大文字・小文字だけを変えるときのため）。
    壊れたリンクも「使われている」とみなす（os.path.lexists）。
    """
    if os.path.normcase(os.path.abspath(path)) == os.path.normcase(str(src)):
        return False
    return os.path.lexists(path)


def rename_without_overwrite(src, dest_dir, wanted_name, registry, now):
    """src を dest_dir の中へ移す。同じ名前があれば番号を付け、決して上書きしない

    戻り値：{"ok", "status", "path", "reason", "raced"}
    raced は、名前を選んでから移動するまでの間に、ほかのアプリが同じ名前のファイルを作ったかどうか
    """
    raced = False
    for attempt in range(MAX_RENAME_ATTEMPTS):
        name = choose_name(dest_dir, wanted_name, src)
        if name is None:
            return {"ok": False, "status": "skipped", "path": None, "reason": PATH_TOO_LONG, "raced": raced}
        dst = dest_dir / name
        if str(dst) == str(src):
            return {"ok": True, "status": "done", "path": src, "reason": "", "raced": raced}
        if registry is not None:
            # 監視（watcher）が、pip0 自身の移動を「新しいファイル」として扱わないようにする
            registry.expect(str(src), now)
            registry.expect(str(dst), now)
        try:
            fsutil.no_overwrite_rename(src, dst)
        except FileExistsError:
            # 名前を選んだ直後に、ほかのアプリが同じ名前のファイルを作った。上書きせず、次の名前でやり直す
            raced = True
            continue
        except OSError as error:
            reason = "移動できませんでした（" + describe_error(error) + "）"
            return {"ok": False, "status": "failed", "path": None, "reason": reason, "raced": raced}
        return {"ok": True, "status": "done", "path": dst, "reason": "", "raced": raced}
    reason = f"同じ名前のファイルが続けて作られたため、移動しませんでした（{MAX_RENAME_ATTEMPTS} 回試しました）"
    return {"ok": False, "status": "failed", "path": None, "reason": reason, "raced": raced}


def make_folders(dest_dir, registry, now):
    """dest_dir がなければ、上の階層から順に作る"""
    missing = []
    folder = Path(dest_dir)
    while not folder.exists() and folder.parent != folder:
        missing.append(folder)
        folder = folder.parent
    for folder in reversed(missing):
        if registry is not None:
            registry.expect(str(folder), now)
        folder.mkdir(exist_ok=True)


def describe_error(error):
    """OS のエラーを、パスやファイル名を含まない短い日本語にする"""
    if isinstance(error, PermissionError):
        return "アクセスが拒否されたか、ほかのアプリが使用中です"
    if isinstance(error, FileNotFoundError):
        return "ファイルかフォルダーが見つかりません"
    if error.errno == errno.ENOSPC:
        return "ドライブの空き容量が足りません"
    if error.errno == errno.ENAMETOOLONG:
        return "名前かパスが長すぎます"
    return f"{type(error).__name__}、エラー番号 {error.errno}"


# ----------------------------------------------------------------------
# 索引（files）と操作履歴（operations）
# ----------------------------------------------------------------------


def find_file_row(conn, file_id, path):
    """files テーブルの行を探す（file_id があればその行、なければパスで）。見つからなければ None"""
    if file_id is not None:
        row = database.query_one(conn, "SELECT id, location_kind FROM files WHERE id = ?", (file_id,))
        if row is not None:
            return row
    return database.query_one(conn, "SELECT id, location_kind FROM files WHERE path = ?", (str(path),))


def remove_stale_row(conn, dst, own_id):
    """移動先のパスに、もうないファイルの古い行が残っていれば消す

    files の path は重複できません（UNIQUE）。また、古い行の解析結果や入手経路を、
    移動してきた別のファイルが引き継がないようにします。
    移動先にファイルがなかったことは、上書きしない移動が成功したことで確かめ済みです。
    """
    if own_id is None:
        conn.execute("DELETE FROM files WHERE path = ?", (str(dst),))
    else:
        conn.execute("DELETE FROM files WHERE path = ? AND id != ?", (str(dst), own_id))


def update_file_row(conn, row, dst, config, now):
    """files の行を、移動後のパス・名前・拡張子（小文字、. 付き）・場所の種類に書き換える"""
    name = dst.name
    ext = safe_names.split_ext(name)[1].lower()
    location_kind = location_kind_for(dst, config) or row["location_kind"]
    conn.execute(
        "UPDATE files SET path = ?, name = ?, ext = ?, location_kind = ?, last_seen_at = ?, updated_at = ? "
        "WHERE id = ?",
        (str(dst), name, ext, location_kind, now, now, row["id"]),
    )


def location_kind_for(path, config):
    """path を含む監視フォルダーの種類（"downloads"、"pip0_root"、"extra"）。どれにも入らなければ None"""
    best_folder = None
    best_kind = None
    for folder, kind in config_module.index_folders(config):
        if config_module.is_inside(path, folder):
            # 入れ子になっているときは、より深い（パスの長い）フォルダーを選ぶ
            if best_folder is None or len(str(folder)) > len(str(best_folder)):
                best_folder = folder
                best_kind = kind
    return best_kind


def record_not_moved(conn, src, status, reason, history):
    """移動しなかったこと（skipped / failed）を操作履歴に残し、結果の辞書を返す"""
    database.log_operation(
        conn, history["kind"], actor=history["actor"], status=status, file_id=history["file_id"],
        before_path=str(src), reasons=history["reasons"], detail=reason, at=history["now"],
    )
    logger.info("ファイル操作（%s）：%s", history["kind"], status)
    return {"ok": False, "status": status, "path": str(src), "reason": reason}


def write_together(conn):
    """まとめて書く（途中で失敗したら、すべて取り消す）

    呼び出し元がすでにまとめて書いている途中なら、新しく始めずに、その中で書く。
    """
    if conn.in_transaction:
        return contextlib.nullcontext()
    return database.transaction(conn)
