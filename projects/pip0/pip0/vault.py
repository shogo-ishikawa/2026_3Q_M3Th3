"""保管庫（M4 シュレディンガー退避ストレージの「退避」と「復元」）

M4 の「退避」は、長い間使われていないファイルの中身を保管庫へコピーし、元の場所には同じ名前の
「ゴースト」（Windows の Cloud Files API のプレースホルダー。中身をディスクに置かない）を残すことです。
アプリがゴーストを開くと、Windows が pip0 シェルを呼び、保管庫から中身が戻ります。
このモジュールは、退避と復元の手順と、途中で止まったときの点検を受け持ちます（docs/design.md 7節）。
退避するファイルを選ぶ規則は evacuation.py、キルスイッチ（全復元）は killswitch.py にあります。

いちばん大事な約束は「原本と保管庫のコピーの両方を、決して失わない」ことです。
- 保管庫の形：VAULT_DIR/items/<項目ID>/ の content（中身）、content.partial（コピーの途中）、manifest.json（復元情報）
- 状態が変わるたびに、先に manifest.json を書き、その後で DB（vault_items）を書く（set_state）。
  manifest.json が正本で、DB の鍵をなくしても、manifest.json から項目を読み直して復元できる（sync_from_manifests）
- content と manifest.json は、どの処理でも消さない（復元した後も残す）
- 原本をゴーストに置き換えるのは、保管庫のコピーを読み直してハッシュを確かめ、manifest.json に書いた後だけ
- 途中で失敗・中断したら、原本はそのまま残し、後でやり直せる状態にする
- 復元で既存のファイルを上書きしない（別のファイルがあれば、横に「 (pip0復元)」を付けた名前で戻す）

状態の移り変わり
  退避：copying → copied → ghosting → evacuated
        失敗・一時停止は failed、キルスイッチによる中止は cancelled（どちらも原本はそのまま。後でやり直せる）
  復元：evacuated → restoring → restored（元どおり）／restored_conflict（横に戻した）／
        restored_local_newer（開いた後の編集を残した）
        ゴーストが見つからないときは ghost_missing（中身は保管庫だけにある。勝手に作り直さない）

時間のかかる処理（保管庫へのコピー）は、HASH_CHUNK_BYTES ごとに should_continue() を確かめます。
常駐処理で使うときは、ワーカーのスレッドから、そのスレッド用に開いた DB の接続で呼んでください。
"""

import contextlib
import errno
import hashlib
import logging
import os
import re
import threading
import time
import uuid
from pathlib import Path

from pip0 import database, evacuation, fsutil, killswitch, safe_names

logger = logging.getLogger(__name__)

MANIFEST_FORMAT = 1

STATES = [
    "copying", "copied", "ghosting", "evacuated", "restoring",
    "restored", "restored_conflict", "restored_local_newer",
    "ghost_missing", "cancelled", "failed",
]
# 原本をゴーストにしていない状態（原本は元の場所のまま）
NOT_GHOSTED_STATES = ["copying", "copied", "failed", "cancelled"]
# 元の場所に、この項目のゴーストがある（かもしれない）状態
GHOST_STATES = ["ghosting", "evacuated", "restoring"]
# 元の場所（か、その横）に戻し終えた状態
RESTORED_STATES = ["restored", "restored_conflict", "restored_local_newer"]
# 全復元（killswitch.restore_all）で戻す状態
RESTORE_TARGET_STATES = ["evacuated", "ghosting", "restoring", "ghost_missing"]
# manifest.json に sha256（確かめた保管庫の内容のハッシュ）が必ずある状態
STATES_WITH_CONTENT = ["copied", "ghosting", "evacuated", "restoring", "ghost_missing"] + RESTORED_STATES

STATE_LABELS = {
    "copying": "保管庫へコピー中",
    "copied": "コピー済み（ゴーストにする前）",
    "ghosting": "ゴーストにする途中",
    "evacuated": "退避中（元の場所にゴースト）",
    "restoring": "復元の途中",
    "restored": "復元済み",
    "restored_conflict": "復元済み（別のファイルがあったため、横に戻した）",
    "restored_local_newer": "復元済み（開いた後の編集を残した）",
    "ghost_missing": "ゴーストが見つからない（中身は保管庫だけ）",
    "cancelled": "中止（原本はそのまま）",
    "failed": "失敗（原本はそのまま）",
}

# ★元の場所に別のファイルがあるとき、横に戻すファイルの名前に付ける印（「報告 (pip0復元).docx」）
CONFLICT_MARK = " (pip0復元)"
# Windows の多くのアプリが扱えるパスの長さ（MAX_PATH の 260 文字から、終わりの印の 1 を引いた数）
MAX_PATH_CHARS = 259
# 横に戻す名前を選んだ直後に、同じ名前のファイルができたとき、別の名前でやり直す回数の上限
MAX_RENAME_ATTEMPTS = 20
ITEM_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")

PAUSED_REASON = (
    "高負荷処理の条件を満たさなくなったため、一時停止しました"
    "（原本はそのままです。次に条件を満たしたとき、最初からやり直します）"
)
CHANGED_REASON = "コピー中に変更されました（異なる版を混ぜないため、保存しません。原本はそのままです）"
STOPPED_REASON = "自動処理は停止中です（キルスイッチ）。退避しません"
BUSY_REASON = "同じファイルを、ほかの処理が扱っています。後でもう一度試してください"

# ★保管庫に置く説明（README.txt）。最初に退避したときに書き、その後は書き換えない
README_TEXT = """\
pip0 の保管庫
==============

このフォルダーには、pip0 が「退避」したファイルの中身が入っています。
退避したファイルの元の場所には、同じ名前の「ゴースト」（雲のアイコンのファイル）が残っています。
pip0 が動いていれば、ゴーストを開くと、ここから中身が戻ります。

このフォルダーの中身は消さないでください。pip0 も自動では消しません。
ここのファイルは暗号化していません（元の場所でも暗号化されていなかった、あなたのファイルです）。

まず試すこと
------------
pip0 の「全復元」で、退避したファイルをすべて元の場所へ戻せます。
  - 通知領域の pip0 のアイコンの「全復元（自動処理を止める）」
  - 画面が動かないときは、pip0 の導入先の scripts フォルダーの restore-all.cmd をダブルクリック

items フォルダーの中
--------------------
items の中の、32 桁の英数字の名前のフォルダー（項目ID）が、退避したファイル 1 つ分です。

  content          退避したファイルの中身（元のファイルとまったく同じ内容。名前と拡張子はありません）
  manifest.json    元に戻すための情報（メモ帳で読めます）
  content.partial  コピーの途中のもの（使いません）

manifest.json の主な項目
  "current_path"   ゴーストの今の場所と名前（"original_path" は退避したときの場所と名前）
  "size"           大きさ（バイト）
  "sha256"         中身のハッシュ（SHA-256）
  "state"          状態
      evacuated                 退避中（元の場所にゴーストがあります）
      restored、restored_conflict、restored_local_newer
                                元の場所（か、その横）に戻し済み
      ghost_missing             ゴーストが見つかりません（中身はここだけにあります）
      copying、copied、failed、cancelled
                                退避していません（元のファイルは元の場所のままです）

手作業で取り出す方法（pip0 が動かないとき）
--------------------------------------------
1. items の中のフォルダーを 1 つずつ開き、manifest.json をメモ帳で開きます。
2. "current_path"（なければ "original_path"）の最後の部分が、元のファイルの名前です。
3. content を、デスクトップなど別の場所へ「コピー」し、名前を元の名前（拡張子を含む）に変えます。
   移動や削除ではなく、コピーしてください。
4. 内容が正しいかを確かめるには、PowerShell で次を実行し、表示された値が manifest.json の "sha256" と
   同じかを比べます（大文字と小文字の違いは気にしなくて構いません）。
       Get-FileHash -Algorithm SHA256 -LiteralPath "コピーしたファイルのパス"
5. 元の場所のゴーストは、pip0 が動いていないと開けません。コピーを取り出して確かめた後で、
   ゴーストをどうするかを決めてください。取り出した後も、この保管庫の content は残しておくと安全です。
"""


# ----------------------------------------------------------------------
# 保管庫の場所
# ----------------------------------------------------------------------


def item_dir(config, item_id):
    return Path(config["VAULT_DIR"]) / "items" / item_id


def manifest_path(config, item_id):
    return item_dir(config, item_id) / "manifest.json"


def content_path(config, item_id):
    return item_dir(config, item_id) / "content"


def partial_path(config, item_id):
    return item_dir(config, item_id) / "content.partial"


def is_valid_item_id(item_id):
    """項目ID（32桁の16進数の小文字）の形なら True。パスの一部に使うので、ほかの形は受け付けない"""
    return isinstance(item_id, str) and ITEM_ID_PATTERN.match(item_id) is not None


def normalise_item_id(item_id):
    return str(item_id).strip().lower()


def ensure_vault(config):
    """保管庫のフォルダーと README.txt（手作業で取り出す方法）を用意する。README.txt があれば書き換えない"""
    vault_dir = Path(config["VAULT_DIR"])
    (vault_dir / "items").mkdir(parents=True, exist_ok=True)
    readme = vault_dir / "README.txt"
    if not readme.exists():
        # メモ帳で読みやすいように、改行は CRLF、文字コードは BOM 付きの UTF-8 にする
        text = README_TEXT.replace("\n", "\r\n")
        fsutil.atomic_write_bytes(readme, text.encode("utf-8-sig"))


# ----------------------------------------------------------------------
# 同じファイルを同時に扱わないための印（このプロセスの中だけ）
# ----------------------------------------------------------------------

_busy_paths = set()
_busy_lock = threading.Lock()


def claim_path(path):
    """path を「処理中」にする。すでにほかの処理が使っていれば False を返す（そのときは何もしないこと）"""
    key = os.path.normcase(str(path))
    with _busy_lock:
        if key in _busy_paths:
            return False
        _busy_paths.add(key)
        return True


def release_path(path):
    with _busy_lock:
        _busy_paths.discard(os.path.normcase(str(path)))


def is_busy(path):
    with _busy_lock:
        return os.path.normcase(str(path)) in _busy_paths


# ----------------------------------------------------------------------
# manifest.json（復元情報の正本）
# ----------------------------------------------------------------------


def read_manifest(config, item_id):
    """項目の manifest.json を辞書で返す。ない・読めない・形が正しくないときは None"""
    manifest, _problem = load_manifest(config, item_id)
    return manifest


def load_manifest(config, item_id):
    """(manifest, problem) を返す。problem は読めなかった理由（読めたら None）"""
    if config.get("VAULT_DIR") is None:
        return None, "保管庫の場所（VAULT_DIR）が設定されていません"
    item_id = normalise_item_id(item_id)
    if not is_valid_item_id(item_id):
        return None, "項目ID の形が正しくありません（32桁の16進数です）"
    try:
        manifest = fsutil.read_json(manifest_path(config, item_id))
    except FileNotFoundError:
        return None, "保管庫に、この項目の manifest.json がありません"
    except (OSError, ValueError):
        return None, "この項目の manifest.json を読めません"
    problem = check_manifest(manifest, item_id)
    if problem is not None:
        return None, problem
    manifest.setdefault("history", [])
    manifest.setdefault("restored_path", None)
    return manifest, None


def check_manifest(manifest, item_id):
    """manifest.json の形を確かめる。正しければ None、だめなら理由"""
    if not isinstance(manifest, dict):
        return "manifest.json の形が正しくありません"
    if manifest.get("item_id") != item_id:
        return "manifest.json の項目ID が、フォルダーの名前と一致しません"
    if manifest.get("state") not in STATES:
        return "manifest.json の状態（state）を読めません"
    for key in ("original_path", "current_path"):
        if not isinstance(manifest.get(key), str) or manifest[key] == "":
            return f"manifest.json に {key} がありません"
    for key in ("size", "mtime_ns"):
        value = manifest.get(key)
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            return f"manifest.json の {key} が正しくありません"
    for key in ("created_at", "updated_at"):
        value = manifest.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return f"manifest.json の {key} が正しくありません"
    sha256 = manifest.get("sha256")
    if sha256 is not None and (not isinstance(sha256, str) or len(sha256) != 64):
        return "manifest.json の sha256 が正しくありません"
    if sha256 is None and manifest["state"] in STATES_WITH_CONTENT:
        return "manifest.json に、保管庫の内容のハッシュ（sha256）がありません"
    return None


def write_manifest(config, manifest):
    """manifest.json を書く（一時ファイルに書いて fsync してから置き換える。途中で止まっても壊れない）"""
    fsutil.atomic_write_json(manifest_path(config, manifest["item_id"]), manifest)


def new_manifest(item_id, path, snapshot, at):
    return {
        "format": MANIFEST_FORMAT,
        "item_id": item_id,
        "state": "copying",
        "original_path": path,
        "current_path": path,
        "file_key": snapshot["file_key"],
        "size": snapshot["size"],
        "mtime_ns": snapshot["mtime_ns"],
        "sha256": None,
        "created_at": at,
        "updated_at": at,
        "restored_path": None,
        "history": [],
    }


# ----------------------------------------------------------------------
# 状態を変える（manifest.json → DB の順）
# ----------------------------------------------------------------------


def set_state(conn, config, manifest, state, note, now=None, *, changes=None, last_error=None,
              add_attempt=False, file_status=None, operation=None):
    """項目の状態を変え、新しい manifest を返す。先に manifest.json（正本）を書き、次に DB をまとめて書く

    note：manifest.json の history に残す説明
    changes：状態のほかに変える manifest の項目（例 {"sha256": "..."}）
    last_error：DB に残す失敗の理由（うまくいったときは None）
    add_attempt：退避を試した回数（attempts）を 1 増やす
    file_status：files テーブルの状態（'present'、'ghost'、'missing'）も変えるとき
    operation：操作履歴（operations）に残すとき {"kind", "actor", "status", "reasons", "detail", "after_path"}
    """
    if state not in STATES:
        raise ValueError(f"知らない状態です: {state}")
    at = current_time(now)
    new = dict(manifest)
    new.update(changes or {})
    new["state"] = state
    new["updated_at"] = at
    new["history"] = list(manifest.get("history") or []) + [{"state": state, "at": at, "note": note}]

    # 1. 正本（manifest.json）を先に書く。途中で止まっても、古い内容か新しい内容のどちらかが残る
    write_manifest(config, new)

    # 2. DB をまとめて書く。ここで止まっても、manifest.json が正しいので、後で sync_from_manifests がそろえる
    with write_together(conn):
        file_id = save_row(conn, new, last_error=last_error, add_attempt=add_attempt)
        if file_status is not None:
            conn.execute(
                "UPDATE files SET status = ?, updated_at = ? WHERE path = ?",
                (file_status, at, new["current_path"]),
            )
        if operation is not None:
            log_item_operation(conn, new, operation, at, file_id)
    logger.info("保管庫の項目 %s：%s", new["item_id"], state)
    return new


def save_row(conn, manifest, *, last_error=None, add_attempt=False):
    """vault_items の行を manifest の内容で書く（なければ作る）。files の行の id（なければ None）を返す"""
    file_id = find_file_id(conn, manifest["current_path"])
    restored_at = manifest["updated_at"] if manifest["state"] in RESTORED_STATES else None
    attempt = 1 if add_attempt else 0
    conn.execute(
        "INSERT INTO vault_items (item_id, file_id, original_path, current_path, file_key, size, mtime_ns, sha256, "
        "state, created_at, updated_at, attempts, last_error, restored_path, restored_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(item_id) DO UPDATE SET "
        "file_id = COALESCE(excluded.file_id, vault_items.file_id), "
        "original_path = excluded.original_path, current_path = excluded.current_path, "
        "file_key = excluded.file_key, size = excluded.size, mtime_ns = excluded.mtime_ns, "
        "sha256 = excluded.sha256, state = excluded.state, "
        "created_at = excluded.created_at, updated_at = excluded.updated_at, "
        "attempts = vault_items.attempts + ?, last_error = excluded.last_error, "
        "restored_path = excluded.restored_path, restored_at = excluded.restored_at",
        (
            manifest["item_id"], file_id, manifest["original_path"], manifest["current_path"],
            manifest["file_key"], manifest["size"], manifest["mtime_ns"], manifest["sha256"],
            manifest["state"], manifest["created_at"], manifest["updated_at"], attempt, last_error,
            manifest.get("restored_path"), restored_at, attempt,
        ),
    )
    return file_id


# DB の行と manifest.json で、食い違っていたら manifest.json に合わせる項目
SYNCED_KEYS = ["state", "original_path", "current_path", "file_key", "size", "mtime_ns", "sha256",
               "restored_path", "created_at", "updated_at"]


def sync_row(conn, manifest):
    """DB の行を manifest.json に合わせる（manifest.json が正本）。"loaded"、"updated"、"unchanged" のどれかを返す"""
    row = database.query_one(conn, "SELECT * FROM vault_items WHERE item_id = ?", (manifest["item_id"],))
    if row is None:
        with write_together(conn):
            save_row(conn, manifest)
        return "loaded"
    for key in SYNCED_KEYS:
        if row[key] != manifest.get(key):
            with write_together(conn):
                save_row(conn, manifest, last_error=row["last_error"])
            return "updated"
    return "unchanged"


def record_problem(conn, manifest, reason, operation, now):
    """状態は変えずに、失敗の理由を DB に残す（manifest.json はそのまま）"""
    at = current_time(now)
    with write_together(conn):
        conn.execute("UPDATE vault_items SET last_error = ? WHERE item_id = ?", (reason, manifest["item_id"]))
        if operation is not None:
            log_item_operation(conn, manifest, operation, at, find_file_id(conn, manifest["current_path"]))


def log_item_operation(conn, manifest, operation, at, file_id):
    database.log_operation(
        conn, operation["kind"], actor=operation["actor"], status=operation["status"], file_id=file_id,
        item_id=manifest["item_id"], before_path=manifest["current_path"], after_path=operation.get("after_path"),
        reasons=operation.get("reasons"), detail=operation.get("detail"), at=at,
    )


def find_file_id(conn, path):
    row = database.query_one(conn, "SELECT id FROM files WHERE path = ?", (str(path),))
    return row["id"] if row is not None else None


# ----------------------------------------------------------------------
# 退避（docs/design.md 7-2）
# ----------------------------------------------------------------------


def evacuate(conn, platform, path, config, *, reasons, should_continue, actor="auto", now=None, rules=None):
    """path のファイルを保管庫へ退避し、元の場所をゴーストにする

    reasons：退避する理由（文字列のリスト）。操作履歴（operations、種類 "evacuate"）にそのまま残す
    should_continue：コピーの区切り（HASH_CHUNK_BYTES）ごとに呼ぶ関数。偽を返したら一時停止する
                     （状態は failed、理由に「一時停止」。原本はそのまま）。None なら止めない
    actor："auto"（自動）か "user"。"auto" のときは、キルスイッチが押されていれば何もしない
    now：時刻（テスト用）。None なら、その時々の時刻
    rules：規則のモジュール（evacuation.check_location に渡す）。None なら pip0.rules

    戻り値：{"ok", "item_id", "state", "reason"}
    - ok=True、state="evacuated"：ゴーストになり、中身は保管庫にある
    - ok=False：退避していない。state は項目の状態（failed、cancelled 等。項目を作らなかったときは None）。
      原本はそのまま。ただし state="ghosting" は、ゴーストになったかを確かめられなかったもので、
      起動時の点検（recover_incomplete）で確かめ直す
    予想外の例外は、そのまま上へ伝える。そのときも項目は、起動時の点検でそろえられる状態で残る。
    """
    path = str(Path(os.path.abspath(path)))
    reasons = list(reasons or [])
    if actor == "auto" and killswitch.is_engaged(conn, config):
        return refuse_evacuation(conn, path, None, STOPPED_REASON, actor, reasons, now)
    if actor == "auto" and not config.get("AUTO_EVACUATE_ENABLED"):
        reason = "自動退避が無効になっています（AUTO_EVACUATE_ENABLED）。退避しません"
        return refuse_evacuation(conn, path, None, reason, actor, reasons, now)
    if not claim_path(path):
        return refuse_evacuation(conn, path, None, BUSY_REASON, actor, reasons, now)
    try:
        return run_evacuation(conn, platform, path, config, reasons, should_continue, actor, now, rules)
    except OSError as error:
        # 記録（manifest.json）を書けない（容量不足、ドライブの切断等）、OS 連携との通信が切れた、など
        return stop_after_os_error(conn, config, path, error, actor, reasons, now)
    finally:
        release_path(path)


def run_evacuation(conn, platform, path, config, reasons, should_continue, actor, now, rules):
    """evacuate の本体（同じファイルを扱う印を付けた後に呼ぶ）"""
    # 1. このパスの前の項目を調べる（manifest.json の状態を正とする）
    existing = find_item_for_path(conn, config, path)
    if existing is not None and existing["state"] in GHOST_STATES:
        place = where_is(platform.ghost_status(path), existing["item_id"])
        if existing["state"] == "evacuated" and place == "ours":
            return {"ok": True, "item_id": existing["item_id"], "state": "evacuated",
                    "reason": "すでに退避しています（新しい処理はしていません）"}
        reason = (
            f"この場所には、まだ戻していない退避の項目があります（{STATE_LABELS[existing['state']]}）。"
            "先に復元するか、起動時の点検を待ってください"
        )
        return refuse_evacuation(conn, path, existing, reason, actor, reasons, now)

    # 2. 退避してよい場所・状態か（evacuation.py の規則。原本に触れる前に、もう一度確かめる）
    place = evacuation.check_location(platform, path, config, rules)
    if not place["ok"]:
        return refuse_evacuation(conn, path, existing, place["reason"], actor, reasons, now)
    snapshot = path_snapshot(platform, path)
    if snapshot is None:
        return refuse_evacuation(conn, path, existing, "ファイルが見つかりません", actor, reasons, now)

    # 3. 項目を copying で記録する（前回の失敗・中止の項目があれば、同じ項目ID でコピーし直す）
    ensure_vault(config)
    manifest = start_item(conn, config, path, snapshot, existing, now)

    # 4. 保管庫へコピーし、読み直してハッシュを確かめる → copied
    copy = copy_into_vault(platform, path, config, manifest["item_id"], snapshot, should_continue)
    if not copy["ok"]:
        return fail_evacuation(conn, config, manifest, copy["reason"], actor, reasons, now)
    manifest = set_state(
        conn, config, manifest, "copied", "保管庫へコピーし、読み直してハッシュを確かめました", now,
        changes={"sha256": copy["sha256"]},
    )

    # 5. 原本をゴーストにする前に、キルスイッチをもう一度確かめる（自動の退避だけ）
    if actor == "auto" and killswitch.is_engaged(conn, config):
        reason = "キルスイッチが押されたため、ゴーストにする前に中止しました（原本はそのままです）"
        manifest = set_state(conn, config, manifest, "cancelled", reason, now,
                             operation=evacuate_operation(actor, "cancelled", reasons, reason))
        return {"ok": False, "item_id": manifest["item_id"], "state": "cancelled", "reason": reason}

    # 6. ゴーストにして、ゴーストになったことを確かめる → evacuated
    return ghost_step(conn, platform, config, manifest, actor, reasons, now)


def start_item(conn, config, path, snapshot, existing, now):
    """copying の状態で項目を記録する（manifest.json → DB の順）"""
    if existing is not None and existing["state"] in NOT_GHOSTED_STATES:
        manifest = existing
        item_dir(config, manifest["item_id"]).mkdir(parents=True, exist_ok=True)
        note = f"もう一度退避します（前回：{STATE_LABELS[existing['state']]}）。新しくコピーし直します"
    else:
        item_id = uuid.uuid4().hex
        item_dir(config, item_id).mkdir(parents=True)  # 同じ名前があれば失敗する（既存の項目を上書きしない）
        manifest = new_manifest(item_id, path, snapshot, current_time(now))
        note = "退避を始めます（保管庫へコピーします）"
    changes = {
        "original_path": path, "current_path": path, "file_key": snapshot["file_key"],
        "size": snapshot["size"], "mtime_ns": snapshot["mtime_ns"], "sha256": None, "restored_path": None,
    }
    return set_state(conn, config, manifest, "copying", note, now, changes=changes, add_attempt=True)


def copy_into_vault(platform, path, config, item_id, expected, should_continue):
    """原本を content.partial へコピーし、読み直して確かめてから content に名前を変える（DB は使わない）

    expected：コピーを始める前の原本の {"size", "mtime_ns", "file_key"}
    戻り値：{"ok": True, "sha256", "reason": ""} または {"ok": False, "sha256": None, "reason"}
    原本には書き込まない。失敗したら content.partial（途中までのコピー）だけを消して、容量を返す
    """
    chunk_size = config["HASH_CHUNK_BYTES"]
    partial = partial_path(config, item_id)
    try:
        outcome = copy_original(platform, path, partial, expected, chunk_size, should_continue)
        if outcome["ok"]:
            outcome = verify_copy(partial, outcome["sha256"], chunk_size, should_continue)
        if outcome["ok"]:
            # 確かめたコピーだけを content にする（同じフォルダーの中の置き換えなので、半端な content はできない）
            os.replace(partial, content_path(config, item_id))
            fsutil.fsync_dir(item_dir(config, item_id))
    except OSError as error:
        outcome = {"ok": False, "sha256": None, "reason": copy_error_reason(error)}
    if not outcome["ok"]:
        discard_partial(partial)
    return outcome


def copy_original(platform, path, partial, expected, chunk_size, should_continue):
    """原本を content.partial へ区切りごとにコピーしながら SHA-256 を計算し、途中で変わらなかったかを確かめる"""
    digest = hashlib.sha256()
    copied = 0
    # open_for_copy：ほかのプロセスの書き込み・削除を拒否し、最終アクセス日時を変えない開き方
    with platform.open_for_copy(path) as source:
        if not same_size_and_time(handle_snapshot(source), expected):
            return {"ok": False, "sha256": None, "reason": CHANGED_REASON}
        with open(partial, "wb") as target:
            while True:
                if should_continue is not None and not should_continue():
                    return {"ok": False, "sha256": None, "reason": PAUSED_REASON}
                chunk = source.read(chunk_size)
                if not chunk:
                    break
                write_chunk(target, chunk)
                digest.update(chunk)
                copied += len(chunk)
            fsutil.fsync_file(target)
        after_handle = handle_snapshot(source)
    # 開いたファイル（os.fstat）と、パスの先（os.stat とファイル番号）の両方が、コピーの前と同じか
    after_path = path_snapshot(platform, path)
    unchanged = (
        copied == expected["size"]
        and same_size_and_time(after_handle, expected)
        and after_path is not None
        and same_size_and_time(after_path, expected)
        and after_path["file_key"] == expected["file_key"]
    )
    if not unchanged:
        return {"ok": False, "sha256": None, "reason": CHANGED_REASON}
    return {"ok": True, "sha256": digest.hexdigest(), "reason": ""}


def verify_copy(partial, sha256, chunk_size, should_continue):
    """書いた content.partial を読み直し、ハッシュが同じかを確かめる"""
    try:
        again = fsutil.sha256_file(partial, chunk_size, should_continue)
    except fsutil.Paused:
        return {"ok": False, "sha256": None, "reason": PAUSED_REASON}
    if again != sha256:
        return {"ok": False, "sha256": None,
                "reason": "保管庫に書いた内容を読み直したところ、ハッシュが一致しませんでした（原本はそのままです）"}
    return {"ok": True, "sha256": sha256, "reason": ""}


def write_chunk(target, chunk):
    """コピーの1区切りを書く（テストでは、ここを差し替えて「容量不足」をまねる）"""
    target.write(chunk)


def discard_partial(partial):
    """途中までのコピー（content.partial）を消して、ドライブの容量を返す。content と manifest.json には触れない"""
    try:
        os.remove(partial)
    except FileNotFoundError:
        pass
    except OSError as error:
        logger.warning("途中までのコピーを消せませんでした（%s）", type(error).__name__)


def copy_error_reason(error):
    """コピー中の OS のエラーを、パスを含まない日本語の理由にする"""
    if is_disk_full(error):
        return "保管庫のドライブの空き容量が足りないため、退避を中止しました（容量不足。原本はそのままです）"
    if isinstance(error, PermissionError):
        return "ほかのアプリが使用中か、アクセスが拒否されたため、退避を中止しました（原本はそのままです）"
    if isinstance(error, FileNotFoundError):
        return "ファイルか保管庫のフォルダーが見つからないため、退避を中止しました（原本はそのままです）"
    return f"コピーできませんでした（{type(error).__name__}、エラー番号 {error.errno}）。原本はそのままです"


def ghost_step(conn, platform, config, manifest, actor, reasons, now):
    """手順 7-2 の 4・5：ghosting を記録してからゴーストにし、自分の項目のゴーストになったことを確かめる"""
    manifest = set_state(conn, config, manifest, "ghosting", "元の場所をゴーストにします", now)
    path = manifest["current_path"]
    item_id = manifest["item_id"]
    expected = {
        "size": manifest["size"], "mtime_ns": manifest["mtime_ns"],
        "file_key": manifest["file_key"], "sha256": manifest["sha256"],
    }
    # ここで例外が起きても、状態は ghosting のまま残り、起動時の点検（settle_ghosting）で確かめられる
    answer = platform.make_ghost(path, item_id, expected)
    result = answer.get("result")
    place = where_is(platform.ghost_status(path), item_id)

    if place == "ours":
        note = "ゴーストにしました（中身は保管庫にあります）"
        if result != "ghosted":
            note += f"。OS 連携の答えは「{result}」でしたが、ゴーストになっていることを確かめました"
        set_state(conn, config, manifest, "evacuated", note, now, file_status="ghost",
                  operation=evacuate_operation(actor, "done", reasons, note))
        return {"ok": True, "item_id": item_id, "state": "evacuated", "reason": ""}

    if place == "unknown":
        reason = ("ゴーストになったかどうかを確かめられませんでした。起動時の点検で確かめ直します"
                  "（保管庫のコピーは確かめ済みです）")
        record_problem(conn, manifest, reason, evacuate_operation(actor, "failed", reasons, reason), now)
        return {"ok": False, "item_id": item_id, "state": "ghosting", "reason": reason}

    if place == "missing" and result == "ghosted":
        reason = "ゴーストにした直後に、元の場所からなくなりました。中身は保管庫に残しています"
        set_state(conn, config, manifest, "ghost_missing", reason, now, last_error=reason, file_status="missing",
                  operation=evacuate_operation(actor, "failed", reasons, reason))
        return {"ok": False, "item_id": item_id, "state": "ghost_missing", "reason": reason}

    # 通常のファイルのまま・ファイルがない・別の項目のゴースト：この項目はゴーストにしていない（原本はそのまま）
    return fail_evacuation(conn, config, manifest, ghost_failure_reason(answer, place), actor, reasons, now)


def ghost_failure_reason(answer, place):
    if answer.get("result") == "ghosted":
        detail = "OS 連携はゴーストにしたと答えましたが、確かめられませんでした"
    else:
        detail = answer.get("reason") or answer.get("result") or "OS 連携から答えがありません"
    if place == "missing":
        return f"元の場所にファイルが見つからないため、退避しませんでした（{detail}）"
    if place == "other_ghost":
        return f"元の場所が別の項目のゴーストだったため、退避しませんでした（{detail}）"
    return f"ゴーストにできませんでした（{detail}）。原本はそのままです（後でやり直せます）"


def refuse_evacuation(conn, path, existing, reason, actor, reasons, now):
    """退避しなかったこと（条件を満たさない）を操作履歴に残す。ファイルにも保管庫にも触れない"""
    item_id = existing["item_id"] if existing is not None else None
    state = existing["state"] if existing is not None else None
    with write_together(conn):
        database.log_operation(
            conn, "evacuate", actor=actor, status="skipped", file_id=find_file_id(conn, path),
            item_id=item_id, before_path=path, reasons=reasons, detail=reason, at=current_time(now),
        )
    logger.info("退避しませんでした（条件を満たさない）")
    return {"ok": False, "item_id": item_id, "state": state, "reason": reason}


def fail_evacuation(conn, config, manifest, reason, actor, reasons, now):
    """退避を failed にする（原本はそのまま。後でやり直せる）"""
    set_state(conn, config, manifest, "failed", reason, now, last_error=reason,
              operation=evacuate_operation(actor, "failed", reasons, reason))
    return {"ok": False, "item_id": manifest["item_id"], "state": "failed", "reason": reason}


def stop_after_os_error(conn, config, path, error, actor, reasons, now):
    """退避の途中で OS のエラーが起きたとき：ゴーストにする前の項目だけを failed にする

    ghosting の項目は、ゴーストになったかもしれないので変えずに、起動時の点検（settle_ghosting）で確かめる。
    failed も書けないときは、copying／copied のまま残す（起動時の点検でそろえる。原本はそのまま）。
    """
    reason = f"退避の途中で、OS のエラーが起きました（{describe_error(error)}）"
    manifest = find_item_for_path(conn, config, path)
    if manifest is not None and manifest["state"] in ("copying", "copied"):
        try:
            return fail_evacuation(conn, config, manifest, reason + "。原本はそのままです", actor, reasons, now)
        except OSError:
            manifest = read_manifest(config, manifest["item_id"]) or manifest
    state = manifest["state"] if manifest is not None else None
    if state == "ghosting":
        reason += "。ゴーストになったかどうかは、起動時の点検で確かめます"
    else:
        reason += "。原本はそのままです"
    logger.warning("退避の途中で OS のエラーが起きました（%s）", type(error).__name__)
    return {"ok": False, "item_id": manifest["item_id"] if manifest is not None else None,
            "state": state, "reason": reason}


def evacuate_operation(actor, status, reasons, detail):
    return {"kind": "evacuate", "actor": actor, "status": status, "reasons": reasons, "detail": detail}


def find_item_for_path(conn, config, path):
    """このパスの、いちばん新しい項目の manifest（なければ None）"""
    row = database.query_one(
        conn,
        "SELECT item_id FROM vault_items WHERE current_path = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
        (path,),
    )
    if row is None:
        return None
    return read_manifest(config, row["item_id"])


# ----------------------------------------------------------------------
# 復元（docs/design.md 7-3）
# ----------------------------------------------------------------------


def restore(conn, platform, item_id, config, *, actor, now=None):
    """退避した項目を元の場所へ戻す。何度実行しても、結果は同じ

    actor："user"、"auto"（ゴーストが開かれた後）、"kill_switch"（全復元）、"system"（起動時の点検）
    戻り値：{"ok", "state", "path", "reason", "already"}
    - ok：元の場所（か、その横）に、通常のファイルとして戻っていれば True
    - state：restored、restored_conflict、restored_local_newer、ghost_missing、evacuated 等
    - path：内容のある場所（restored_conflict なら、横に戻したファイル）
    - already：何もしなくても、すでに戻っていたとき True
    元の場所の状態ごとの動き（7-3 の表）
    - この項目のゴースト → restore_ghost の後にハッシュを確かめる → restored／restored_local_newer
    - 通常のファイルで、ハッシュが同じ → 何もしない → restored
    - 別のファイル → 横に「元の名前 (pip0復元).拡張子」で戻す → restored_conflict（元のファイルには触れない）
    - ファイルがない → 作り直さない → ghost_missing
    - OS 連携が動いていない等 → 何もしない → evacuated のまま（失敗として記録）
    どの場合も、保管庫の content と manifest.json は消さない。
    """
    item_id = normalise_item_id(item_id)
    manifest, problem = load_manifest(config, item_id)
    if manifest is None:
        return {"ok": False, "state": None, "path": None, "already": False,
                "reason": problem + "。保管庫の中身には触れていません"}
    sync_row(conn, manifest)
    path = manifest["current_path"]
    if not claim_path(path):
        return restore_result(manifest, False, BUSY_REASON)
    try:
        return run_restore(conn, platform, config, manifest, actor, now)
    except OSError as error:
        # 記録（manifest.json）を書けない、OS 連携との通信が切れた、など。状態は最後に書けたまま残り、
        # もう一度実行すると（または起動時の点検で）続きから試す
        reason = (f"復元の途中で、OS のエラーが起きました（{describe_error(error)}）。"
                  "保管庫の内容はそのまま残しています。もう一度実行すると、続きから試します")
        current = read_manifest(config, item_id) or manifest
        record_problem(conn, current, reason, restore_operation(actor, "failed", reason), now)
        logger.warning("保管庫の項目 %s：復元の途中で OS のエラー（%s）", item_id, type(error).__name__)
        return restore_result(current, False, reason)
    finally:
        release_path(path)


def run_restore(conn, platform, config, manifest, actor, now):
    """restore の本体（同じファイルを扱う印を付けた後に呼ぶ）"""
    state = manifest["state"]
    if state in RESTORED_STATES:
        return restore_result(manifest, True, "すでに復元しています（何もしていません）", already=True)
    if state in NOT_GHOSTED_STATES:
        reason = "この項目は退避していません（元のファイルはそのままです）。復元は不要です"
        return restore_result(manifest, False, reason)
    if state == "ghosting":
        manifest = settle_ghosting(conn, platform, config, manifest, now)
        if manifest["state"] in NOT_GHOSTED_STATES:
            reason = "ゴーストにする前に止まっていました（元のファイルはそのままです）。復元は不要です"
            return restore_result(manifest, False, reason)
        if manifest["state"] == "ghosting":
            reason = "ゴーストになったかどうかを確かめられません（OS 連携が動いていない等）。後でもう一度試してください"
            return restore_result(manifest, False, reason)

    # 前回の復元で、横に戻し終えたファイルがあれば、それで終わり（名前を変えた直後に止まった場合。
    # 何度実行しても、横のコピーは1つ）
    planned = manifest.get("restored_path")
    if (state == "restoring" and planned and planned != manifest["current_path"]
            and holds_vault_content(platform, planned, manifest, config)):
        return finish_restore(conn, config, manifest, "restored_conflict", planned, conflict_note(planned), actor, now)

    # うまくいかなかったときに戻す状態
    back_to = "ghost_missing" if manifest["state"] == "ghost_missing" else "evacuated"
    place = where_is(platform.ghost_status(manifest["current_path"]), manifest["item_id"])
    if place == "ours":
        return restore_from_ghost(conn, platform, config, manifest, actor, now)
    if place == "regular":
        return restore_onto_regular_file(conn, platform, config, manifest, actor, now, back_to)
    if place == "other_ghost":
        return restore_beside(conn, platform, config, manifest, actor, now, back_to)
    if place == "missing":
        return mark_missing(conn, config, manifest, actor, now)
    reason = "元の場所の状態を確かめられませんでした（OS 連携が動いていない等）。後でもう一度試してください"
    return restore_failed(conn, config, manifest, reason, actor, now, back_to)


def restore_from_ghost(conn, platform, config, manifest, actor, now):
    """元の場所が、この項目のゴーストのとき：通常のファイルに戻し、ハッシュを確かめる"""
    manifest = set_state(conn, config, manifest, "restoring", "元の場所のゴーストを、通常のファイルに戻します", now)
    # ここで例外が起きても、状態は restoring のまま残り、起動時の点検でやり直せる
    answer = platform.restore_ghost(manifest["current_path"], manifest["item_id"])
    result = answer.get("result")
    if result == "restored":
        return check_restored_file(conn, platform, config, manifest, actor, now)
    if result == "already_regular":
        return restore_onto_regular_file(conn, platform, config, manifest, actor, now, "evacuated")
    if result == "missing":
        return mark_missing(conn, config, manifest, actor, now)
    reason = f"ゴーストを通常のファイルに戻せませんでした（{answer.get('reason') or result}）"
    return restore_failed(conn, config, manifest, reason, actor, now, "evacuated")


def check_restored_file(conn, platform, config, manifest, actor, now):
    """ゴーストから戻したファイルのハッシュを確かめる。違えば、開いた後に編集された内容として残す"""
    path = manifest["current_path"]
    try:
        actual = hash_user_file(platform, path, config)
    except OSError as error:
        reason = f"戻した内容を確かめられませんでした（{describe_error(error)}）。もう一度実行すると確かめ直します"
        record_problem(conn, manifest, reason, restore_operation(actor, "failed", reason), now)
        return restore_result(manifest, False, reason)
    if actual != manifest["sha256"]:
        note = "開いた後に編集された内容があるため、その内容を残しました（保管庫の内容はそのままです）"
        return finish_restore(conn, config, manifest, "restored_local_newer", path, note, actor, now)
    note = "元の場所に戻し、内容のハッシュを確かめました"
    if put_back_mtime(path, manifest["mtime_ns"]):
        note += "（更新日時を元に戻しました）"
    return finish_restore(conn, config, manifest, "restored", path, note, actor, now)


def restore_onto_regular_file(conn, platform, config, manifest, actor, now, back_to):
    """元の場所に通常のファイルがあるとき：同じ内容なら何もしない。違えば横に戻す（上書きしない）"""
    path = manifest["current_path"]
    if os.path.islink(path) or not os.path.isfile(path):
        return restore_beside(conn, platform, config, manifest, actor, now, back_to)
    local = platform.get_local_state(path)
    if local.get("local") is not True or local.get("reparse"):
        # 中身がこの PC にないもの（ほかのクラウドのプレースホルダー等）は、読まずに横に戻す
        return restore_beside(conn, platform, config, manifest, actor, now, back_to)
    try:
        actual = hash_user_file(platform, path, config)
    except OSError as error:
        reason = f"元の場所のファイルを読めませんでした（{describe_error(error)}）"
        return restore_failed(conn, config, manifest, reason, actor, now, back_to)
    if actual == manifest["sha256"]:
        note = "元の場所に同じ内容のファイルがありました（すでに戻っています）"
        return finish_restore(conn, config, manifest, "restored", path, note, actor, now, already=True)
    return restore_beside(conn, platform, config, manifest, actor, now, back_to)


def restore_beside(conn, platform, config, manifest, actor, now, back_to):
    """元の場所に別のファイルがあるとき：上書きせず、横に「元の名前 (pip0復元).拡張子」で戻す"""
    path = manifest["current_path"]
    folder = os.path.dirname(path)

    # 1. 保管庫の内容を、同じフォルダーの新しい一時ファイルへコピーし、ハッシュを確かめ、更新日時を戻す
    copy = copy_out_of_vault(config, manifest, folder)
    if not copy["ok"]:
        return restore_failed(conn, config, manifest, copy["reason"], actor, now, back_to)
    temp = copy["temp"]

    # 2. 空いている名前へ、上書きせずに名前を変える。行き先の名前は、先に manifest.json に書いておく
    #    （名前を変えた直後に止まっても、次の実行で run_restore がそのファイルを見つけるので、コピーが増えない）
    for _ in range(MAX_RENAME_ATTEMPTS):
        dest = os.path.join(folder, conflict_name(path))
        manifest = set_state(conn, config, manifest, "restoring",
                             "元の場所に別のファイルがあるため、上書きせずに横へ戻します", now,
                             changes={"restored_path": dest})
        try:
            fsutil.no_overwrite_rename(temp, dest)
        except FileExistsError:
            continue  # 名前を選んだ直後に、同じ名前のファイルができた。上書きせず、次の名前でやり直す
        except OSError as error:
            remove_own_temp(temp)
            reason = f"横に戻せませんでした（{describe_error(error)}）"
            return restore_failed(conn, config, manifest, reason, actor, now, back_to)
        put_back_mtime(dest, manifest["mtime_ns"])
        return finish_restore(conn, config, manifest, "restored_conflict", dest, conflict_note(dest), actor, now)
    remove_own_temp(temp)
    reason = f"横に戻す名前を決められませんでした（{MAX_RENAME_ATTEMPTS} 回試しました）"
    return restore_failed(conn, config, manifest, reason, actor, now, back_to)


def copy_out_of_vault(config, manifest, folder):
    """保管庫の内容を、folder の中の新しい一時ファイルへコピーし、ハッシュを確かめて更新日時を戻す

    戻り値：{"ok", "temp", "reason"}。失敗したときは、ここで作った一時ファイルだけを消す
    """
    item_id = manifest["item_id"]
    chunk_size = config["HASH_CHUNK_BYTES"]
    # 一時ファイルの名前は「.<項目ID>.pip0-restore.partial」（scanner が読み飛ばす名前。rules.EXCLUDED_NAME_PATTERNS）
    temp_name = safe_names.unique_name(folder, f".{item_id}.pip0-restore.partial", exists=os.path.lexists)
    temp = os.path.join(folder, temp_name)
    created = False
    outcome = {"ok": False, "temp": None, "reason": "保管庫から取り出せませんでした"}
    try:
        digest = hashlib.sha256()
        with open(content_path(config, item_id), "rb") as source:
            # "x"：同じ名前のファイルがあれば失敗する（既存のファイルを上書きしない）
            with open(temp, "xb") as target:
                created = True
                while True:
                    chunk = source.read(chunk_size)
                    if not chunk:
                        break
                    write_chunk(target, chunk)
                    digest.update(chunk)
                fsutil.fsync_file(target)
        if digest.hexdigest() == manifest["sha256"] and fsutil.sha256_file(temp, chunk_size) == manifest["sha256"]:
            set_mtime(temp, manifest["mtime_ns"])
            outcome = {"ok": True, "temp": temp, "reason": ""}
        else:
            outcome["reason"] = ("保管庫の内容のハッシュが manifest.json の記録と一致しないため、戻しませんでした"
                                 "（保管庫の内容はそのまま残しています）")
    except OSError as error:
        outcome["reason"] = f"保管庫から取り出せませんでした（{describe_error(error)}）"
    finally:
        # うまくいかなかったとき（予想外の例外を含む）は、ここで作った一時ファイルだけを消す
        if created and not outcome["ok"]:
            remove_own_temp(temp)
    return outcome


def holds_vault_content(platform, path, manifest, config):
    """path が、この項目の保管庫の内容と同じ内容の通常のファイルなら True"""
    try:
        if os.path.islink(path) or not os.path.isfile(path) or os.stat(path).st_size != manifest["size"]:
            return False
        return hash_user_file(platform, path, config) == manifest["sha256"]
    except OSError:
        return False


def conflict_name(path):
    """「元の名前 (pip0復元).拡張子」のうち、まだ使われていない名前（「 (2)」等が付くことがある）"""
    folder, name = os.path.split(path)
    stem, ext = safe_names.split_ext(name)
    room = MAX_PATH_CHARS - len(os.path.join(folder, "")) - len(CONFLICT_MARK) - len(ext) - len(" (99)")
    if 0 < room < len(stem):
        stem = stem[:room].rstrip(". ") or "pip0"
    return safe_names.unique_name(folder, stem + CONFLICT_MARK + ext, exists=os.path.lexists)


def conflict_note(dest):
    return (f"元の場所に別のファイルがあるため、そのファイルは上書きせず、"
            f"「{os.path.basename(dest)}」として横に戻しました（ハッシュと更新日時を確かめました）")


def finish_restore(conn, config, manifest, state, restored_path, note, actor, now, already=False):
    """復元を終えた状態（restored、restored_conflict、restored_local_newer）を記録する"""
    status = "conflict" if state == "restored_conflict" else "done"
    manifest = set_state(conn, config, manifest, state, note, now, changes={"restored_path": restored_path},
                         file_status="present", operation=restore_operation(actor, status, note, restored_path))
    return restore_result(manifest, True, note, already=already)


def mark_missing(conn, config, manifest, actor, now):
    """元の場所にゴーストがないとき：作り直さず ghost_missing にする（中身は保管庫に残る）"""
    reason = ("元の場所にゴーストがありません（移動・削除された可能性があります）。"
              "中身は保管庫に残しています（勝手に作り直しません）")
    operation = restore_operation(actor, "failed", reason)
    if manifest["state"] == "ghost_missing":
        record_problem(conn, manifest, reason, operation, now)
    else:
        manifest = set_state(conn, config, manifest, "ghost_missing", reason, now, last_error=reason,
                             changes={"restored_path": None}, file_status="missing", operation=operation)
    return restore_result(manifest, False, reason)


def restore_failed(conn, config, manifest, reason, actor, now, back_to):
    """復元できなかったとき：何も変えず、状態を back_to（ふつうは evacuated）に戻して、失敗として記録する"""
    operation = restore_operation(actor, "failed", reason)
    if manifest["state"] == back_to:
        record_problem(conn, manifest, reason, operation, now)
    else:
        manifest = set_state(conn, config, manifest, back_to, "復元できませんでした：" + reason, now,
                             last_error=reason, changes={"restored_path": None}, operation=operation)
    logger.warning("保管庫の項目 %s：復元できませんでした", manifest["item_id"])
    return restore_result(manifest, False, reason)


def restore_operation(actor, status, detail, after_path=None):
    return {"kind": "restore", "actor": actor, "status": status, "reasons": None,
            "detail": detail, "after_path": after_path}


def restore_result(manifest, ok, reason, already=False):
    if manifest["state"] in RESTORED_STATES and manifest.get("restored_path"):
        path = manifest["restored_path"]
    else:
        path = manifest["current_path"]
    return {"ok": ok, "state": manifest["state"], "path": path, "reason": reason, "already": already}


# ----------------------------------------------------------------------
# 起動時の点検と、DB の作り直し（docs/design.md 7-4）
# ----------------------------------------------------------------------


def recover_incomplete(conn, platform, config, now=None):
    """起動時の点検：前回の終了時に途中だった項目を、確かな状態にそろえる

    1. manifest.json を読み直し、DB を合わせる（sync_from_manifests。DB にない項目も読み込む）
    2. copying → failed（コピーの途中で止まった。原本はそのまま）
       ghosting → 元の場所を見て evacuated（ゴースト）／copied（通常のファイル）／ghost_missing（ない）
       restoring → 復元をやり直す
    戻り値：{"loaded", "updated", "resolved", "unresolved", "problems"}
    （unresolved は、OS 連携が動いていない等で確かめられず、そのままにした件数）
    """
    synced = sync_from_manifests(conn, config)
    summary = {"loaded": synced["loaded"], "updated": synced["updated"], "resolved": 0, "unresolved": 0,
               "problems": synced["problems"]}
    for row in list_items(conn, ["copying", "ghosting", "restoring"]):
        manifest = read_manifest(config, row["item_id"])
        if manifest is None or manifest["state"] != row["state"] or is_busy(manifest["current_path"]):
            # manifest.json を読めない、または、このプロセスの中で今まさに処理中
            summary["unresolved"] += 1
            continue
        try:
            new_state = settle_one(conn, platform, config, manifest, now)
        except Exception as error:  # 1 件の予想外のエラーで、ほかの項目の点検を止めない（その項目は途中の状態のまま）
            logger.warning("保管庫の点検：項目 %s を確かめられませんでした（%s）", row["item_id"], type(error).__name__)
            summary["problems"].append({"item_id": row["item_id"],
                                        "reason": f"点検の途中でエラーが起きました（{type(error).__name__}）"})
            new_state = manifest["state"]
        if new_state == manifest["state"]:
            summary["unresolved"] += 1
        else:
            summary["resolved"] += 1
    logger.info("保管庫の点検：そろえた %d 件、確かめられなかった %d 件", summary["resolved"], summary["unresolved"])
    return summary


def settle_one(conn, platform, config, manifest, now):
    """途中の状態（copying、ghosting、restoring）の項目を 1 件そろえ、新しい状態を返す"""
    if manifest["state"] == "copying":
        reason = "前回のコピーが途中で止まっていました（原本はそのままです。後でやり直せます）"
        set_state(conn, config, manifest, "failed", reason, now, last_error=reason,
                  operation=evacuate_operation("system", "failed", None, reason))
        return "failed"
    if manifest["state"] == "ghosting":
        return settle_ghosting(conn, platform, config, manifest, now)["state"]
    return restore(conn, platform, manifest["item_id"], config, actor="system", now=now)["state"]


def settle_ghosting(conn, platform, config, manifest, now):
    """ghosting のまま止まった項目を、元の場所の様子で確かな状態にする。新しい manifest を返す"""
    place = where_is(platform.ghost_status(manifest["current_path"]), manifest["item_id"])
    if place == "ours":
        note = "点検：ゴーストになっていることを確かめました（中身は保管庫にあります）"
        return set_state(conn, config, manifest, "evacuated", note, now, file_status="ghost",
                         operation=evacuate_operation("system", "done", None, note))
    if place == "regular":
        note = "点検：元の場所は通常のファイルのままでした（原本はそのままです）"
        return set_state(conn, config, manifest, "copied", note, now)
    if place == "missing":
        reason = "点検：元の場所にファイルがありません。中身は保管庫に残しています（勝手に作り直しません）"
        return set_state(conn, config, manifest, "ghost_missing", reason, now, last_error=reason,
                         file_status="missing")
    if place == "other_ghost":
        reason = "点検：元の場所は別の項目のゴーストでした（この項目はゴーストにしていません）"
        return set_state(conn, config, manifest, "failed", reason, now, last_error=reason)
    return manifest  # 確かめられない：そのままにして、次の点検で確かめる


def sync_from_manifests(conn, config):
    """保管庫の manifest.json を 1 件ずつ読み、DB（vault_items）をそれに合わせる（manifest.json が正本）

    DB を作り直したとき（鍵をなくしたとき等）に、項目を読み直すために使う。何も消さない。
    戻り値：{"loaded", "updated", "unchanged", "problems": [{"item_id", "reason"}]}
    （loaded は DB になかった項目、updated は DB を manifest.json に合わせて直した項目の件数）
    """
    summary = {"loaded": 0, "updated": 0, "unchanged": 0, "problems": []}
    if config.get("VAULT_DIR") is None:
        summary["problems"].append({"item_id": None, "reason": "保管庫の場所（VAULT_DIR）が設定されていません"})
        return summary
    items = Path(config["VAULT_DIR"]) / "items"
    if not items.is_dir():
        return summary
    for entry in sorted(items.iterdir()):
        if entry.is_symlink() or not entry.is_dir() or not is_valid_item_id(entry.name):
            reason = "保管庫の items に、項目ではないものがあります（触れていません）"
            summary["problems"].append({"item_id": None, "reason": reason})
            continue
        manifest, problem = load_manifest(config, entry.name)
        if manifest is None:
            summary["problems"].append({"item_id": entry.name, "reason": problem})
            continue
        summary[sync_row(conn, manifest)] += 1
    logger.info("保管庫の読み直し：新しく %d 件、直した %d 件、問題 %d 件",
                summary["loaded"], summary["updated"], len(summary["problems"]))
    return summary


def list_items(conn, states=None):
    """保管庫の項目（vault_items の行の辞書）のリスト。states を渡すと、その状態のものだけ（古い順）"""
    if states is None:
        return database.query_all(conn, "SELECT * FROM vault_items ORDER BY created_at, item_id")
    if isinstance(states, str):
        states = [states]
    if not states:
        return []
    marks = ", ".join("?" for _ in states)
    return database.query_all(
        conn, f"SELECT * FROM vault_items WHERE state IN ({marks}) ORDER BY created_at, item_id", tuple(states)
    )


# ----------------------------------------------------------------------
# キルスイッチと常駐処理から使う小さな操作
# ----------------------------------------------------------------------


def cancel(conn, config, item_id, reason, *, actor="kill_switch", now=None):
    """ゴーストにする前の項目（copying、copied、failed）を cancelled にする。原本にも保管庫にも触れない

    ほかの処理が今まさに扱っている項目は変えない。中止にしたら True、しなかったら False を返す。
    """
    manifest = read_manifest(config, item_id)
    if manifest is None or manifest["state"] not in ("copying", "copied", "failed"):
        return False
    if is_busy(manifest["current_path"]):
        return False
    set_state(conn, config, manifest, "cancelled", reason, now,
              operation=evacuate_operation(actor, "cancelled", None, reason))
    return True


def record_moved(conn, config, item_id, new_path, now=None):
    """ゴーストが改名・移動されたことを記録する（pip0 シェルの cf.notify_rename を受けたとき）。{"ok", "reason"}"""
    manifest = read_manifest(config, item_id)
    if manifest is None:
        return {"ok": False, "reason": "保管庫に、この項目がありません"}
    if manifest["state"] not in ("evacuated", "ghost_missing"):
        label = STATE_LABELS[manifest["state"]]
        return {"ok": False, "reason": f"この項目は、場所を記録し直す状態ではありません（{label}）"}
    new_path = str(Path(os.path.abspath(new_path)))
    if new_path != manifest["current_path"]:
        set_state(conn, config, manifest, manifest["state"], "ゴーストの場所（名前）が変わりました", now,
                  changes={"current_path": new_path})
    return {"ok": True, "reason": ""}


# ----------------------------------------------------------------------
# 小さな部品
# ----------------------------------------------------------------------


def current_time(now):
    """now が渡されていればその値（テスト用）、なければ今の時刻"""
    return time.time() if now is None else now


def where_is(status, item_id):
    """platform.ghost_status の結果を、次の 5 つの言葉にまとめる

    "ours"：この項目のゴースト、"other_ghost"：別の項目のゴースト、"regular"：通常のファイル、
    "missing"：ファイルがない、"unknown"：確かめられない（OS 連携が動いていない等）
    """
    if status.get("exists") is False:
        return "missing"
    if status.get("exists") is not True:
        return "unknown"
    if status.get("is_ghost") is True:
        ghost_id = status.get("item_id")
        if isinstance(ghost_id, str) and ghost_id.lower() == item_id:
            return "ours"
        return "other_ghost"
    if status.get("is_ghost") is False:
        return "regular"
    return "unknown"


def path_snapshot(platform, path):
    """パスの今の大きさ・更新日時・ファイル番号 {"size", "mtime_ns", "file_key"}。読めなければ None"""
    try:
        info = os.stat(path)
    except OSError:
        return None
    return {"size": info.st_size, "mtime_ns": info.st_mtime_ns, "file_key": platform.get_file_key(path)}


def handle_snapshot(f):
    """開いたファイルの今の大きさと更新日時（os.fstat）"""
    info = os.fstat(f.fileno())
    return {"size": info.st_size, "mtime_ns": info.st_mtime_ns}


def same_size_and_time(a, b):
    return a["size"] == b["size"] and a["mtime_ns"] == b["mtime_ns"]


def hash_user_file(platform, path, config):
    """ユーザーのファイルの SHA-256（最終アクセス日時を変えない開き方で読む。pip0 自身の読み取り）"""
    return fsutil.sha256_file(path, config["HASH_CHUNK_BYTES"], None, opener=platform.open_for_analysis)


def set_mtime(path, mtime_ns):
    info = os.stat(path)
    os.utime(path, ns=(info.st_atime_ns, mtime_ns))


def put_back_mtime(path, mtime_ns):
    """更新日時が manifest.json の値と違えば戻す。戻したら True"""
    try:
        if os.stat(path).st_mtime_ns == mtime_ns:
            return False
        set_mtime(path, mtime_ns)
        return True
    except OSError:
        return False


def remove_own_temp(temp):
    """pip0 がこの復元で作った一時ファイル（.<項目ID>.pip0-restore.partial）だけを消す。ユーザーのファイルではない"""
    try:
        os.remove(temp)
    except OSError as error:
        logger.warning("復元用の一時ファイルを消せませんでした（%s）", type(error).__name__)


def is_disk_full(error):
    # Windows の ERROR_HANDLE_DISK_FULL（39）と ERROR_DISK_FULL（112）も、空き容量の不足
    return error.errno == errno.ENOSPC or getattr(error, "winerror", None) in (39, 112)


def describe_error(error):
    """OS のエラーを、パスやファイル名を含まない短い日本語にする"""
    if is_disk_full(error):
        return "ドライブの空き容量が足りません"
    if isinstance(error, PermissionError):
        return "アクセスが拒否されたか、ほかのアプリが使用中です"
    if isinstance(error, FileNotFoundError):
        return "ファイルかフォルダーが見つかりません"
    if error.errno == errno.ENAMETOOLONG:
        return "名前かパスが長すぎます"
    return f"{type(error).__name__}、エラー番号 {error.errno}"


def write_together(conn):
    """まとめて書く（途中で失敗したら、すべて取り消す）。すでにまとめて書いている途中なら、その中で書く"""
    if conn.in_transaction:
        return contextlib.nullcontext()
    return database.transaction(conn)
