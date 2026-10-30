"""退避してよいファイルの判断（evacuation.py）のテスト

OS 連携は代役（FakePlatform）です。ファイルシステムの種類、同期フォルダー、プレースホルダー、
「常にこのデバイス上に保持する」などは、代役の表（filesystems、other_sync_roots 等）でまねます。
"""

import os
import stat
from pathlib import Path

import pytest

from pip0 import config as config_module
from pip0 import database, evacuation, rules

DAY = 24 * 60 * 60
NOW = 1_793_000_000.0
OLD_NS = int((NOW - 150 * DAY) * 1_000_000_000)  # 150 日前の更新日時（ナノ秒）
BIG = 2 * 1024 * 1024  # EVACUATE_MIN_SIZE_BYTES（1MB）より大きい


def make_file(path, size=BIG, mtime_ns=OLD_NS):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        f.truncate(size)  # 中身が 0 の大きなファイル（場所と状態の判断には中身を使わない）
    os.utime(path, ns=(mtime_ns, mtime_ns))
    return path


def add_file_row(db, path, *, first_seen_days_ago=200, location_kind="pip0_root", status="present"):
    info = os.stat(path)
    return database.execute(
        db,
        "INSERT INTO files (path, name, ext, size, mtime, location_kind, status, first_seen_at, last_seen_at, "
        "updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (str(path), path.name, path.suffix.lower(), info.st_size, info.st_mtime, location_kind, status,
         NOW - first_seen_days_ago * DAY, NOW, NOW),
    )


def fingerprint(path):
    """ファイルが変わっていないことを確かめるための値（内容、大きさ、更新日時）"""
    info = os.stat(path)
    return (path.read_bytes(), info.st_size, info.st_mtime_ns)


@pytest.fixture
def good_file(env):
    return make_file(env["PIP0_ROOT"] / "資料" / "予算2025.xlsx")


# ---------------------------------------------------------------------- 場所と状態（仕様の確認 15）


def test_good_file_is_accepted(env, platform, good_file):
    assert evacuation.check_location(platform, good_file, env) == {"ok": True, "reason": ""}


def refusal_cases():
    """(名前, 準備する関数, 理由に含まれる言葉)"""

    def non_ntfs(env, platform, path):
        platform.filesystems[str(env["PIP0_ROOT"])] = "exFAT"
        return path

    def other_sync_root(env, platform, path):
        platform.other_sync_roots[str(path.parent)] = "OneDrive"
        return path

    def undeterminable_sync(env, platform, path):
        platform.sync_check_unknown.add(str(path.parent))
        return path

    def outside_root(env, platform, path):
        return make_file(env["DOWNLOADS_DIR"] / "外のファイル.xlsx")

    def the_root_itself(env, platform, path):
        return env["PIP0_ROOT"]

    def pinned(env, platform, path):
        platform.pinned.add(str(path))
        return path

    def not_local(env, platform, path):
        platform.not_local.add(str(path))
        return path

    def small_file(env, platform, path):
        return make_file(env["PIP0_ROOT"] / "小さい.txt", size=10_000)

    def empty_file(env, platform, path):
        return make_file(env["PIP0_ROOT"] / "空.txt", size=0)

    def removable_drive(env, platform, path):
        platform.drive_types[str(env["PIP0_ROOT"])] = "removable"
        return path

    def unregistered_root(env, platform, path):
        platform.registered_roots.clear()
        return path

    def office_temp_name(env, platform, path):
        return make_file(env["PIP0_ROOT"] / "~$予算2025.xlsx")

    def download_in_progress(env, platform, path):
        return make_file(env["PIP0_ROOT"] / "動画.mp4.crdownload")

    def in_use(env, platform, path):
        platform.locked.add(str(path))
        return path

    def symlink(env, platform, path):
        link = env["PIP0_ROOT"] / "リンク.xlsx"
        os.symlink(path, link)
        return link

    def missing(env, platform, path):
        return env["PIP0_ROOT"] / "ない.xlsx"

    def hard_link(env, platform, path):
        os.link(path, env["PIP0_ROOT"] / "別名.xlsx")
        return path

    def read_only(env, platform, path):
        platform.file_attributes[str(path)] = stat.FILE_ATTRIBUTE_READONLY | stat.FILE_ATTRIBUTE_ARCHIVE
        return path

    def encrypted(env, platform, path):
        platform.file_attributes[str(path)] = stat.FILE_ATTRIBUTE_ENCRYPTED | stat.FILE_ATTRIBUTE_ARCHIVE
        return path

    def vault_in_onedrive(env, platform, path):
        platform.other_sync_roots[str(env["DATA_DIR"])] = "OneDrive"  # 保管庫は DATA_DIR の下
        return path

    def vault_sync_unknown(env, platform, path):
        platform.sync_check_unknown.add(str(env["VAULT_DIR"]))
        return path

    def vault_on_usb(env, platform, path):
        # 保管庫のフォルダーは、まだない（最初の退避で作る）。あるいちばん近い上のフォルダーのドライブで判断する
        platform.drive_types[str(env["DATA_DIR"])] = "removable"
        return path

    def vault_on_exfat(env, platform, path):
        platform.filesystems[str(env["DATA_DIR"])] = "exFAT"
        return path

    return [
        ("non_ntfs", non_ntfs, "exFAT"),
        ("other_sync_root", other_sync_root, "OneDrive"),
        ("undeterminable_sync", undeterminable_sync, "判定できない"),
        ("outside_root", outside_root, "pip0 専用フォルダーの外"),
        ("the_root_itself", the_root_itself, "pip0 専用フォルダーそのもの"),
        ("pinned", pinned, "常にこのデバイス上に保持する"),
        ("not_local", not_local, "中身がこの PC にない"),
        ("small_file", small_file, "1.0 MB 未満"),
        ("empty_file", empty_file, "空のファイル"),
        ("removable_drive", removable_drive, "取り外しできるドライブ"),
        ("unregistered_root", unregistered_root, "同期ルートとして登録されていない"),
        ("office_temp_name", office_temp_name, "一時ファイル"),
        ("download_in_progress", download_in_progress, "一時ファイル"),
        ("in_use", in_use, "使用中"),
        ("symlink", symlink, "シンボリックリンク"),
        ("missing", missing, "見つかりません"),
        ("hard_link", hard_link, "ハードリンク"),
        ("read_only", read_only, "読み取り専用"),
        ("encrypted", encrypted, "暗号化（EFS）"),
        ("vault_in_onedrive", vault_in_onedrive, "OneDrive の同期フォルダーの中"),
        ("vault_sync_unknown", vault_sync_unknown, "保管庫（VAULT_DIR）がクラウドの同期フォルダーの中かどうか"),
        ("vault_on_usb", vault_on_usb, "保管庫（VAULT_DIR）が NTFS の内蔵ドライブにない"),
        ("vault_on_exfat", vault_on_exfat, "NTFS の内蔵ドライブにない"),
    ]


@pytest.mark.parametrize("name, prepare, word", refusal_cases(), ids=[case[0] for case in refusal_cases()])
def test_check_location_refuses_and_touches_nothing(env, platform, good_file, name, prepare, word):
    path = prepare(env, platform, good_file)
    files_before = {p: fingerprint(p) for p in env["PIP0_ROOT"].rglob("*") if p.is_file() and not p.is_symlink()}

    result = evacuation.check_location(platform, path, env)

    assert result["ok"] is False
    assert word in result["reason"]
    files_after = {p: fingerprint(p) for p in env["PIP0_ROOT"].rglob("*") if p.is_file() and not p.is_symlink()}
    assert files_after == files_before
    assert not Path(env["VAULT_DIR"]).exists()  # 保管庫も作っていない
    assert platform.ghosts == {}


def test_non_ntfs_reason_names_the_file_system(env, platform, good_file):
    platform.filesystems[str(env["PIP0_ROOT"])] = "FAT32"
    reason = evacuation.check_location(platform, good_file, env)["reason"]
    assert "ファイルシステムが FAT32" in reason
    assert "NTFS" in reason


def test_pip0_own_sync_root_reported_by_windows_is_allowed(env, platform, good_file, monkeypatch):
    # Windows の実装は、pip0 自身の同期ルートの中を provider="pip0" と答える。それは退避してよい
    # （保管庫とデータフォルダーは、同期ルートの外なので「外」と答える）
    def answer(path):
        if config_module.is_inside(path, env["PIP0_ROOT"]):
            return {"inside": True, "provider": "pip0", "reason": ""}
        return {"inside": False, "provider": None, "reason": ""}

    monkeypatch.setattr(platform, "check_sync_folder", answer)
    assert evacuation.check_location(platform, good_file, env)["ok"] is True


def test_vault_inside_any_sync_root_is_refused_even_pip0s_own(env, platform, good_file, monkeypatch):
    # 保管庫は、ゴーストの唯一の中身の置き場所。どの同期ルートの中（pip0 自身のものも）にも置かない
    monkeypatch.setattr(platform, "check_sync_folder",
                        lambda path: {"inside": True, "provider": "pip0", "reason": ""})
    reason = evacuation.check_location(platform, good_file, env)["reason"]
    assert "保管庫（VAULT_DIR）が pip0 の同期フォルダーの中" in reason


def test_rules_can_be_replaced(env, platform, good_file):
    class StrictRules:
        EXCLUDED_NAME_PATTERNS = rules.EXCLUDED_NAME_PATTERNS + [r"^予算"]

    assert evacuation.check_location(platform, good_file, env, StrictRules)["ok"] is False


def test_config_errors_stop_evacuation(env, platform, good_file):
    config = dict(env, CONFIG_ERRORS=["保管庫を pip0 専用フォルダーの中に置くことはできません。"])
    assert "設定" in evacuation.check_location(platform, good_file, config)["reason"]


# ---------------------------------------------------------------------- 候補


def test_find_candidates_returns_long_unread_files_oldest_first(env, db, platform):
    older = make_file(env["PIP0_ROOT"] / "一番古い.pdf", mtime_ns=int((NOW - 300 * DAY) * 1e9))
    old = make_file(env["PIP0_ROOT"] / "古い.pdf")
    recent = make_file(env["PIP0_ROOT"] / "最近.pdf", mtime_ns=int((NOW - 3 * DAY) * 1e9))
    small = make_file(env["PIP0_ROOT"] / "小さい.pdf", size=1000)
    young = make_file(env["PIP0_ROOT"] / "観測が短い.pdf")
    outside = make_file(env["DOWNLOADS_DIR"] / "ダウンロード.pdf")
    ghost = make_file(env["PIP0_ROOT"] / "ゴースト.pdf")
    for path in (older, old, recent, small, ghost):
        add_file_row(db, path)
    add_file_row(db, young, first_seen_days_ago=20)
    add_file_row(db, outside, location_kind="downloads")
    database.execute(db, "UPDATE files SET status = 'ghost' WHERE path = ?", (str(ghost),))

    candidates = evacuation.find_candidates(db, platform, NOW, env, rules, recent_items_enabled=True)

    assert [c["path"] for c in candidates] == [str(older), str(old)]
    first = candidates[0]
    assert isinstance(first["file_id"], int)
    assert any("長期間未読" in reason and "300 日間" in reason for reason in first["reasons"])
    assert any("大きさ" in reason for reason in first["reasons"])


def test_find_candidates_needs_a_way_to_see_reads(env, db, platform):
    add_file_row(db, make_file(env["PIP0_ROOT"] / "古い.pdf"))
    platform.access_time_reliable_value = False
    assert evacuation.find_candidates(db, platform, NOW, env, rules, recent_items_enabled=False) == []
    assert evacuation.find_candidates(db, platform, NOW, env, rules, recent_items_enabled=None) == []
    platform.access_time_reliable_value = True
    assert len(evacuation.find_candidates(db, platform, NOW, env, rules, recent_items_enabled=None)) == 1


def test_find_candidates_uses_the_real_modification_time(env, db, platform):
    # 索引の日時が古くても、実際のファイルが最近更新されていれば候補にしない
    path = make_file(env["PIP0_ROOT"] / "索引が古い.pdf")
    add_file_row(db, path)
    os.utime(path, ns=(int((NOW - DAY) * 1e9), int((NOW - DAY) * 1e9)))
    assert evacuation.find_candidates(db, platform, NOW, env, rules, recent_items_enabled=True) == []


def test_find_candidates_respects_switch_limit_and_vault_items(env, db, platform):
    paths = [make_file(env["PIP0_ROOT"] / f"資料{i}.pdf") for i in range(3)]
    for path in paths:
        add_file_row(db, path)
    assert evacuation.find_candidates(db, platform, NOW, dict(env, AUTO_EVACUATE_ENABLED=False), rules, True) == []
    assert len(evacuation.find_candidates(db, platform, NOW, dict(env, EVACUATE_MAX_PER_RUN=2), rules, True)) == 2
    database.execute(
        db,
        "INSERT INTO vault_items (item_id, original_path, current_path, size, mtime_ns, state, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, 'copying', ?, ?)",
        ("a" * 32, str(paths[0]), str(paths[0]), BIG, OLD_NS, NOW, NOW),
    )
    found = evacuation.find_candidates(db, platform, NOW, env, rules, True)
    assert str(paths[0]) not in [c["path"] for c in found]
    assert len(found) == 2


def test_find_candidates_skips_refused_files_and_still_fills_the_limit(env, db, platform, monkeypatch):
    oldest = make_file(env["PIP0_ROOT"] / "固定.pdf", mtime_ns=int((NOW - 400 * DAY) * 1e9))
    middle = make_file(env["PIP0_ROOT"] / "中.pdf", mtime_ns=int((NOW - 300 * DAY) * 1e9))
    newest = make_file(env["PIP0_ROOT"] / "新.pdf", mtime_ns=int((NOW - 200 * DAY) * 1e9))
    for path in (oldest, middle, newest):
        add_file_row(db, path)
    platform.pinned.add(str(oldest))  # 一番古いが「常にこのデバイス上に保持する」
    checked = []
    real_check = evacuation.check_location

    def counting_check(platform_, path, config, rules_=None):
        checked.append(path)
        return real_check(platform_, path, config, rules_)

    monkeypatch.setattr(evacuation, "check_location", counting_check)
    found = evacuation.find_candidates(db, platform, NOW, dict(env, EVACUATE_MAX_PER_RUN=1), rules, True)
    assert [c["path"] for c in found] == [str(middle)]
    assert checked == [str(oldest), str(middle)]  # 上限に達したら、それより新しいファイルは確かめない


def test_explain_gives_reasons_both_ways(env, db, platform, good_file):
    add_file_row(db, good_file)
    yes = evacuation.explain(db, platform, good_file, NOW, env, rules, recent_items_enabled=True)
    assert yes["eligible"] is True
    assert any("長期間未読" in reason for reason in yes["reasons"])

    platform.pinned.add(str(good_file))
    no = evacuation.explain(db, platform, good_file, NOW, env, rules, recent_items_enabled=True)
    assert no["eligible"] is False
    assert any("常にこのデバイス上に保持する" in reason for reason in no["reasons"])

    unknown = make_file(env["PIP0_ROOT"] / "索引にない.pdf")
    not_indexed = evacuation.explain(db, platform, unknown, NOW, env, rules, recent_items_enabled=True)
    assert not_indexed["eligible"] is False
    assert any("判定不能" in reason for reason in not_indexed["reasons"])


def test_format_size():
    assert evacuation.format_size(512) == "512 バイト"
    assert evacuation.format_size(1536) == "1.5 KB"
    assert evacuation.format_size(1024 * 1024) == "1.0 MB"
    assert evacuation.format_size(3 * 1024 ** 3) == "3.0 GB"
