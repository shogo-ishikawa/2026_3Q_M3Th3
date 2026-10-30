"""退避（M4）してよいファイルの判断

M4 シュレディンガー退避ストレージで「どのファイルを退避するか」を決めるモジュールです（docs/design.md 4-6）。
退避の手順そのもの（保管庫へのコピー、ゴーストにする）は vault.py にあります。
vault.evacuate も、原本に触れる前に、ここの check_location で確かめ直します。

退避するのは、次のすべてを満たすファイルだけです（★条件を変えるときは、このファイルを直します）。
1. 場所（location_problem）：pip0 専用フォルダー（同期ルートとして登録済み）の中、NTFS の内蔵ドライブ、
   ほかのクラウドの同期フォルダーの外。同期フォルダーかどうか判定できないときも退避しない
2. ファイルの状態（file_problem）：中身がこの PC にある通常のファイル（リンク、ハードリンクで別の名前があるもの、
   プレースホルダー、「常にこのデバイス上に保持する」は除く）、一時ファイルではない、
   EVACUATE_MIN_SIZE_BYTES 以上、使用中ではない
3. 利用（find_candidates）：usage.judge_long_unread で「長期間未読」。「判定不能」のファイルは退避しない

ここにある関数は、ファイルの情報を読んで確かめるだけで、何も変更しません。
"""

import os
import re
import stat

from pip0 import config as config_module
from pip0 import database, usage
from pip0 import rules as default_rules

# ドライブの種類 → 理由の文に出す名前
DRIVE_TYPE_LABELS = {
    "removable": "取り外しできるドライブ",
    "network": "ネットワークドライブ",
    "unknown": "種類の分からないドライブ",
}

# 保管庫の項目がこの状態のファイルは、候補にしない（コピー中、退避中、ゴーストにする途中、復元の途中）。
# copied・failed・cancelled（原本はそのまま）のファイルは、もう一度候補にできる
ACTIVE_VAULT_STATES = ["copying", "ghosting", "evacuated", "restoring"]


# ----------------------------------------------------------------------
# 場所と状態の確認
# ----------------------------------------------------------------------


def check_location(platform, path, config, rules=None):
    """path を退避してよい場所・状態かを確かめる。{"ok", "reason"} を返す（何も変更しない）

    rules：規則のモジュール（EXCLUDED_NAME_PATTERNS を使う）。None なら pip0.rules
    """
    if rules is None:
        rules = default_rules
    path = os.path.abspath(path)
    problem = location_problem(platform, path, config)
    if problem is None:
        problem = file_problem(platform, path, config, rules)
    if problem is not None:
        return {"ok": False, "reason": problem}
    return {"ok": True, "reason": ""}


def location_problem(platform, path, config):
    """場所の確認。退避してよければ None、だめなら理由（日本語）"""
    root = config.get("PIP0_ROOT")
    if root is None:
        return "pip0 専用フォルダー（PIP0_ROOT）が設定されていないため、退避しません"
    if config.get("VAULT_DIR") is None:
        return "保管庫の場所（VAULT_DIR）が設定されていないため、退避しません"
    if config.get("CONFIG_ERRORS"):
        return "設定の場所の組み合わせに問題があるため、退避しません（pip0 status で確かめてください）"
    if not config_module.is_inside(path, root):
        return "pip0 専用フォルダーの外にあるため、退避しません（ゴーストを置けるのは pip0 専用フォルダーの中だけです）"
    if os.path.normcase(os.path.abspath(path)) == os.path.normcase(os.path.abspath(root)):
        return "pip0 専用フォルダーそのものは退避しません"
    for folder in (config.get("DATA_DIR"), config.get("VAULT_DIR")):
        if folder is not None and config_module.is_inside(path, folder):
            return "pip0 のデータフォルダー・保管庫の中のファイルは退避しません"

    if platform.is_sync_root_registered(root) is not True:
        return "pip0 専用フォルダーが同期ルートとして登録されていない（または確かめられない）ため、退避しません"

    volume = platform.get_volume_info(path)
    filesystem = volume.get("filesystem")
    if filesystem != "NTFS":
        return (
            f"ファイルシステムが {filesystem or '不明'} のドライブです。ゴーストを作れるのは NTFS だけなので、"
            "退避しません（原本はそのままにします）"
        )
    drive_type = volume.get("drive_type")
    if drive_type != "fixed":
        label = DRIVE_TYPE_LABELS.get(drive_type, "種類の分からないドライブ")
        return f"{label}にあるため、退避しません（内蔵ドライブだけで退避します）"

    sync = platform.check_sync_folder(path)
    if sync.get("inside") is None:
        return ("クラウドの同期フォルダーの中かどうかを判定できないため、退避しません"
                "（同期されたデータを損なわないため）")
    if sync.get("inside") is True and sync.get("provider") != "pip0":
        provider = sync.get("provider") or "ほかのクラウド"
        return f"{provider} の同期フォルダーの中にあるため、退避しません（同期されたデータを損なわないため）"
    return None


def file_problem(platform, path, config, rules):
    """ファイルの状態の確認。退避してよければ None、だめなら理由（日本語）"""
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return "ファイルが見つかりません"
    except OSError:
        return "ファイルの情報を読めないため、退避しません"
    if stat.S_ISLNK(info.st_mode):
        return "シンボリックリンクは退避しません（リンク先もたどりません）"
    if stat.S_ISDIR(info.st_mode):
        return "フォルダーは退避しません"
    if not stat.S_ISREG(info.st_mode):
        return "通常のファイルではないため、退避しません"
    if info.st_nlink > 1:
        # ハードリンクは同じ中身への別の名前。ゴーストにすると、ほかの名前の中身まで変わってしまう
        return "ほかの名前（ハードリンク）を持つファイルは退避しません"

    name = os.path.basename(path)
    for pattern in rules.EXCLUDED_NAME_PATTERNS:
        if re.search(pattern, name, re.IGNORECASE):
            return "一時ファイル・作業中のファイル・システムのファイル（名前の規則に一致）は退避しません"

    state = platform.get_local_state(path)
    if state.get("local") is not True:
        return "中身がこの PC にないファイル（クラウドの未取得のプレースホルダー、退避中のゴースト等）は退避しません"
    if state.get("placeholder"):
        return "プレースホルダー（ゴースト等）は退避しません"
    if state.get("reparse"):
        return "リンクや再解析ポイント（ジャンクション等）は退避しません"
    if state.get("pinned"):
        return "「常にこのデバイス上に保持する」が設定されているため、退避しません"

    ghost = platform.ghost_status(path)
    if ghost.get("is_ghost") is not False:
        return "すでにゴーストか、ゴーストかどうかを確かめられないため、退避しません"

    if info.st_size == 0:
        return "空のファイル（0 バイト）は退避しません"
    min_size = config["EVACUATE_MIN_SIZE_BYTES"]
    if info.st_size < min_size:
        return f"大きさが {format_size(info.st_size)} で、{format_size(min_size)} 未満のため、退避しません"

    if not platform.can_open_exclusively(path):
        return "ほかのアプリが使用中のため、退避しません"
    return None


# ----------------------------------------------------------------------
# 候補を探す
# ----------------------------------------------------------------------


def find_candidates(conn, platform, now, config, rules, recent_items_enabled):
    """自動退避の候補を、使われていない期間の長い順に返す：[{"file_id", "path", "reasons"}]

    pip0 専用フォルダーの中で索引にあるファイル（files の status が 'present'）のうち、
    長期間未読（usage.judge_long_unread が True）で、check_location に合うものだけです。
    件数は EVACUATE_MAX_PER_RUN まで。キルスイッチの確認は、vault.evacuate と常駐処理が行います。
    """
    if not config.get("AUTO_EVACUATE_ENABLED"):
        return []
    in_vault = active_vault_paths(conn)
    rows = database.query_all(
        conn,
        "SELECT * FROM files WHERE location_kind = 'pip0_root' AND status = 'present' ORDER BY id",
    )

    # 1. 長期間未読のファイルを集める（DB の記録だけで判定するので速い）
    unread = []
    for row in rows:
        if os.path.normcase(row["path"]) in in_vault:
            continue
        row = with_current_mtime(row)
        if row is None:
            continue
        sources = usage.tracking_sources(platform, row["path"], recent_items_enabled)
        judgement = usage.judge_long_unread(conn, row, now, config, sources)
        if judgement["unread"] is True:
            unread.append({"row": row, "judgement": judgement, "sources": sources})

    # 2. 使われていない期間の長い順に、場所と状態を確かめ、上限の件数まで選ぶ
    unread.sort(key=lambda entry: entry["judgement"]["idle_days"], reverse=True)
    limit = config.get("EVACUATE_MAX_PER_RUN") or 0
    candidates = []
    for entry in unread:
        if len(candidates) >= limit:
            break
        row = entry["row"]
        if not check_location(platform, row["path"], config, rules)["ok"]:
            continue
        candidates.append({
            "file_id": row["id"],
            "path": row["path"],
            "reasons": candidate_reasons(row, entry["judgement"], entry["sources"]),
        })
    return candidates


def explain(conn, platform, path, now, config, rules, recent_items_enabled):
    """1つのファイルについて、自動退避の対象になるか（eligible）と、その理由（reasons）を返す"""
    path = os.path.abspath(path)
    reasons = []
    eligible = True

    if not config.get("AUTO_EVACUATE_ENABLED"):
        eligible = False
        reasons.append("自動退避が無効になっています（AUTO_EVACUATE_ENABLED）")

    if os.path.normcase(path) in active_vault_paths(conn):
        eligible = False
        reasons.append("このファイルは、保管庫に退避中か、退避・復元の途中です")

    place = check_location(platform, path, config, rules)
    if place["ok"]:
        reasons.append("場所と状態：退避できる場所・状態です")
    else:
        eligible = False
        reasons.append("場所と状態：" + place["reason"])

    row = database.query_one(conn, "SELECT * FROM files WHERE path = ?", (path,))
    if row is not None:
        row = with_current_mtime(row)
    if row is None:
        eligible = False
        reasons.append("利用：pip0 の索引にないため、利用の記録がありません（判定不能）")
    else:
        sources = usage.tracking_sources(platform, path, recent_items_enabled)
        judgement = usage.judge_long_unread(conn, row, now, config, sources)
        if judgement["unread"] is True:
            reasons.append("利用：長期間未読です。" + judgement["reason"])
        elif judgement["unread"] is False:
            eligible = False
            reasons.append("利用：最近使われています。" + judgement["reason"])
        else:
            eligible = False
            reasons.append("利用：" + judgement["reason"])
    return {"eligible": eligible, "reasons": reasons}


# ----------------------------------------------------------------------
# 小さな部品
# ----------------------------------------------------------------------


def active_vault_paths(conn):
    """保管庫の項目が退避中・途中の状態のパスの集合（大文字・小文字をそろえたもの）"""
    marks = ", ".join("?" for _ in ACTIVE_VAULT_STATES)
    rows = database.query_all(
        conn, f"SELECT current_path FROM vault_items WHERE state IN ({marks})", tuple(ACTIVE_VAULT_STATES)
    )
    return {os.path.normcase(row["current_path"]) for row in rows}


def with_current_mtime(row):
    """索引の行の最終更新日時を、実際のファイルの値と比べて新しいほうにする（索引が古いときのため）

    ファイルが見つからなければ None を返す。
    """
    try:
        actual_mtime = os.stat(row["path"]).st_mtime
    except OSError:
        return None
    row = dict(row)
    if row.get("mtime") is None or actual_mtime > row["mtime"]:
        row["mtime"] = actual_mtime
    return row


def candidate_reasons(row, judgement, sources):
    """候補の理由（操作履歴にそのまま残す）"""
    reasons = ["長期間未読：" + judgement["reason"], sources["reason"]]
    if row.get("size") is not None:
        reasons.append(f"大きさ：{format_size(row['size'])}")
    reasons.append("場所：pip0 専用フォルダー（NTFS の内蔵ドライブ、同期ルート）")
    return reasons


def format_size(size):
    """バイト数を「1.5 MB」のような文字列にする"""
    if size < 1024:
        return f"{size} バイト"
    if size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    if size < 1024 * 1024 * 1024:
        return f"{size / 1024 / 1024:.1f} MB"
    return f"{size / 1024 / 1024 / 1024:.1f} GB"
