"""ファイルの移動・改名（fileops.py）のテスト

一時フォルダー（tmp_path）の中のダミーファイルだけを使います。OS 連携は代役（FakePlatform）です。
"""

import ast
import json
import logging
import os
from pathlib import Path

import pytest

from pip0 import database, fileops, fsutil

NOW = 1_793_000_000.0      # テストで使う決まった時刻
OLD_MTIME = 1_700_000_000  # ダミーファイルの最終更新日時
REASONS = ["規則「予算・会計」：ファイル名に「予算」（+2）"]


class RecordingRegistry:
    """watcher.SelfChangeRegistry の代わり。expect で知らされたパスを記録するだけ"""

    def __init__(self):
        self.expected = []

    def expect(self, path, now, seconds=10):
        self.expected.append(path)

    def is_expected(self, path, now):
        return path in self.expected


def make_file(path, data=b"pip0 test data"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    os.utime(path, (OLD_MTIME, OLD_MTIME))
    return path


def add_file_row(db, path, location_kind="downloads", status="present"):
    return database.execute(
        db,
        "INSERT INTO files (path, name, ext, size, mtime, location_kind, status, first_seen_at, last_seen_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (str(path), path.name, path.suffix.lower(), 10, OLD_MTIME, location_kind, status, 1.0, 1.0, 1.0),
    )


def operations(db):
    return database.query_all(db, "SELECT * FROM operations ORDER BY id")


def move(db, platform, env, src, dest_dir, new_name, **options):
    """テスト用の呼び出し（kind、actor、reasons、now の既定値を付ける）"""
    options.setdefault("kind", "sort")
    options.setdefault("actor", "auto")
    options.setdefault("reasons", REASONS)
    options.setdefault("now", NOW)
    return fileops.move_and_rename(db, platform, src, dest_dir, new_name, config=env, **options)


def make_ghost(platform, path):
    """代役の OS 連携で、path をゴースト（中身を保管庫に預けた状態）にする"""
    st = os.stat(path)
    expected = {"size": st.st_size, "mtime_ns": st.st_mtime_ns, "file_key": platform.get_file_key(path)}
    result = platform.make_ghost(path, "0" * 32, expected)
    assert result["result"] == "ghosted"


def assert_skipped(result, src, words):
    assert result["ok"] is False
    assert result["status"] == "skipped"
    assert result["path"] == str(src)
    assert words in result["reason"]


# ---------------------------------------------------------------------- 移動できる場合


def test_move_into_pip0_root_updates_index_history_and_keeps_mtime(env, platform, db):
    src = make_file(env["DOWNLOADS_DIR"] / "download (3).PDF", b"budget")
    file_id = add_file_row(db, src)
    registry = RecordingRegistry()
    dest_dir = env["PIP0_ROOT"] / "予算・会計"

    result = move(db, platform, env, src, dest_dir, "2026-10-29_予算案_Slack.PDF", registry=registry, file_id=file_id)

    dst = dest_dir / "2026-10-29_予算案_Slack.PDF"
    assert result == {"ok": True, "status": "done", "path": str(dst), "reason": ""}
    assert not src.exists()
    assert dst.read_bytes() == b"budget"
    assert dst.stat().st_mtime_ns == OLD_MTIME * 1_000_000_000  # 最終更新日時は変わらない

    row = database.query_one(db, "SELECT * FROM files WHERE id = ?", (file_id,))
    assert row["path"] == str(dst)
    assert row["name"] == "2026-10-29_予算案_Slack.PDF"
    assert row["ext"] == ".pdf"
    assert row["location_kind"] == "pip0_root"
    assert row["updated_at"] == NOW

    [op] = operations(db)
    assert (op["kind"], op["actor"], op["status"]) == ("sort", "auto", "done")
    assert op["file_id"] == file_id
    assert op["before_path"] == str(src)
    assert op["after_path"] == str(dst)
    assert json.loads(op["reasons_json"]) == REASONS
    assert op["at"] == NOW

    # 自分の移動の知らせを監視が無視できるように、移動元・移動先・作ったフォルダーを知らせている
    assert str(src) in registry.expected
    assert str(dst) in registry.expected
    assert str(dest_dir) in registry.expected


def test_nested_folders_are_created_inside_pip0_root(env, platform, db):
    src = make_file(env["DOWNLOADS_DIR"] / "IMG_0001.png")
    registry = RecordingRegistry()
    dest_dir = env["PIP0_ROOT"] / "画像・図" / "2026" / "10月"

    result = move(db, platform, env, src, dest_dir, "2026-10-29_青いグラフ_Slack.png", registry=registry)

    assert result["ok"] and result["status"] == "done"
    assert Path(result["path"]).parent == dest_dir
    for folder in (env["PIP0_ROOT"] / "画像・図", env["PIP0_ROOT"] / "画像・図" / "2026", dest_dir):
        assert folder.is_dir()
        assert str(folder) in registry.expected


def test_move_without_a_new_name_keeps_the_name(env, platform, db):
    src = make_file(env["DOWNLOADS_DIR"] / "IMG_0042.jpg", b"photo")
    dest_dir = env["PIP0_ROOT"] / "画像・図"

    result = move(db, platform, env, src, dest_dir, None)

    assert result == {"ok": True, "status": "done", "path": str(dest_dir / "IMG_0042.jpg"), "reason": ""}
    assert (dest_dir / "IMG_0042.jpg").read_bytes() == b"photo"


def test_rename_in_place_keeps_the_folder_and_finds_the_row_by_path(env, platform, db):
    src = make_file(env["DOWNLOADS_DIR"] / "document.xlsx", b"sheet")
    file_id = add_file_row(db, src)

    result = fileops.rename_in_place(
        db, platform, src, "2026-10-29_予算案_送信元不明.xlsx",
        kind="rename", actor="auto", reasons=["名前が意味不明（document）"], config=env, now=NOW,
    )

    dst = env["DOWNLOADS_DIR"] / "2026-10-29_予算案_送信元不明.xlsx"
    assert result == {"ok": True, "status": "done", "path": str(dst), "reason": ""}
    assert dst.read_bytes() == b"sheet"
    assert dst.stat().st_mtime_ns == OLD_MTIME * 1_000_000_000
    row = database.query_one(db, "SELECT * FROM files WHERE id = ?", (file_id,))
    assert row["path"] == str(dst)
    assert row["location_kind"] == "downloads"
    [op] = operations(db)
    assert op["kind"] == "rename" and op["file_id"] == file_id


def test_same_name_in_the_same_folder_changes_nothing(env, platform, db):
    src = make_file(env["DOWNLOADS_DIR"] / "予算.pdf", b"same")

    result = fileops.rename_in_place(
        db, platform, src, "予算.pdf", kind="rename", actor="user", reasons=[], config=env, now=NOW,
    )

    assert result["ok"] and result["status"] == "done"
    assert result["path"] == str(src)
    assert "変更しませんでした" in result["reason"]
    assert src.read_bytes() == b"same"
    assert sorted(p.name for p in env["DOWNLOADS_DIR"].iterdir()) == ["予算.pdf"]
    [op] = operations(db)
    assert op["before_path"] == op["after_path"] == str(src)


# ---------------------------------------------------------------------- 名前


def test_never_overwrites_an_existing_file(env, platform, db):
    dest_dir = env["PIP0_ROOT"] / "予算・会計"
    existing = make_file(dest_dir / "予算.pdf", b"old")
    src = make_file(env["DOWNLOADS_DIR"] / "download.pdf", b"new")

    result = move(db, platform, env, src, dest_dir, "予算.pdf")

    assert result["ok"]
    assert result["path"] == str(dest_dir / "予算 (2).pdf")
    assert existing.read_bytes() == b"old"
    assert Path(result["path"]).read_bytes() == b"new"
    assert "名前を調整しました" in result["reason"]
    [op] = operations(db)
    assert "名前を調整しました" in op["detail"]


def test_simulated_race_takes_the_next_name(env, platform, db, monkeypatch):
    dest_dir = env["PIP0_ROOT"] / "授業・レポート"
    src = make_file(env["DOWNLOADS_DIR"] / "file.txt", b"mine")
    registry = RecordingRegistry()
    real_rename = fsutil.no_overwrite_rename
    attempts = []

    def racing_rename(source, target):
        attempts.append(str(target))
        if len(attempts) == 1:
            # 名前を選んだ直後に、ほかのアプリが同じ名前のファイルを作った
            Path(target).write_bytes(b"another app")
        return real_rename(source, target)

    monkeypatch.setattr(fsutil, "no_overwrite_rename", racing_rename)
    result = move(db, platform, env, src, dest_dir, "報告.txt", registry=registry)

    first = dest_dir / "報告.txt"
    second = dest_dir / "報告 (2).txt"
    assert attempts == [str(first), str(second)]
    assert result["ok"] and result["path"] == str(second)
    assert first.read_bytes() == b"another app"   # 先にできたファイルは上書きしない
    assert second.read_bytes() == b"mine"
    assert "移動の直前に同じ名前のファイルができた" in result["reason"]
    assert str(first) in registry.expected and str(second) in registry.expected


def test_gives_up_after_twenty_races_without_overwriting(env, platform, db, monkeypatch):
    dest_dir = env["PIP0_ROOT"] / "授業・レポート"
    src = make_file(env["DOWNLOADS_DIR"] / "file.txt", b"mine")
    real_rename = fsutil.no_overwrite_rename
    attempts = []

    def always_racing(source, target):
        attempts.append(str(target))
        Path(target).write_bytes(b"another app")
        return real_rename(source, target)

    monkeypatch.setattr(fsutil, "no_overwrite_rename", always_racing)
    result = move(db, platform, env, src, dest_dir, "報告.txt")

    assert result["ok"] is False and result["status"] == "failed"
    assert result["path"] == str(src)
    assert len(attempts) == fileops.MAX_RENAME_ATTEMPTS == 20
    assert src.read_bytes() == b"mine"
    assert all(Path(path).read_bytes() == b"another app" for path in attempts)
    [op] = operations(db)
    assert op["status"] == "failed" and op["detail"] == result["reason"]


@pytest.mark.parametrize("new_name, expected", [
    ("a<b>:c?.txt", "a＜b＞：c？.txt"),
    ('予算|"案"*.xlsx', "予算｜＂案＂＊.xlsx"),
    ("CON.txt", "_CON.txt"),
    ("lpt1", "_lpt1"),
    ("報告書. ", "報告書"),
    ("../../秘密.txt", "..／..／秘密.txt"),   # 区切り文字は置き換わり、移動先のフォルダーから出ない
])
def test_forbidden_characters_and_reserved_names_are_made_safe(env, platform, db, new_name, expected):
    src = make_file(env["DOWNLOADS_DIR"] / "download.bin")
    dest_dir = env["PIP0_ROOT"] / "整理"

    result = move(db, platform, env, src, dest_dir, new_name)

    assert result["ok"]
    assert Path(result["path"]) == dest_dir / expected
    assert Path(result["path"]).is_file()
    assert "Windows で使える名前に整えました" in result["reason"]


def test_long_paths_are_shortened_before_the_extension(env, platform, db):
    # 移動先のフォルダーのパスを 200 文字にする（名前に使えるのは 259 - 201 = 58 文字）
    filler = "d" * (200 - len(str(env["PIP0_ROOT"])) - 1)
    dest_dir = env["PIP0_ROOT"] / filler
    assert len(str(dest_dir)) == 200
    long_name = "x" * 150 + ".docx"

    first = move(db, platform, env, make_file(env["DOWNLOADS_DIR"] / "a.docx", b"1"), dest_dir, long_name)
    second = move(db, platform, env, make_file(env["DOWNLOADS_DIR"] / "b.docx", b"2"), dest_dir, long_name)

    for result in (first, second):
        assert result["ok"]
        assert len(result["path"]) <= fileops.MAX_PATH_CHARS
        assert result["path"].endswith(".docx")
        assert Path(result["path"]).parent == dest_dir
    assert len(first["path"]) == fileops.MAX_PATH_CHARS
    assert Path(first["path"]).name == "x" * 53 + ".docx"
    # 「 (2)」を付けると長すぎるので、はみ出した4文字だけ短くして選び直す（その名前は空いている）
    assert Path(second["path"]).name == "x" * 49 + ".docx"
    assert Path(first["path"]).read_bytes() == b"1"
    assert Path(second["path"]).read_bytes() == b"2"


def test_refuses_when_no_name_fits_and_creates_no_folder(env, platform, db):
    # 移動先のパスが 257 文字：「1文字 + .txt」も収まらない
    parent = env["PIP0_ROOT"] / ("p" * 100)
    filler = "q" * (257 - len(str(parent)) - 1)
    dest_dir = parent / filler
    assert len(str(dest_dir)) == 257
    src = make_file(env["DOWNLOADS_DIR"] / "a.txt")

    result = move(db, platform, env, src, dest_dir, "報告.txt")

    assert_skipped(result, src, "パスが長すぎ")
    assert src.exists()
    assert not parent.exists()


# ---------------------------------------------------------------------- 移動しない場合


def test_refuses_destination_outside_pip0_root(env, platform, db, tmp_path):
    src = make_file(env["DOWNLOADS_DIR"] / "予算.pdf")
    file_id = add_file_row(db, src)
    elsewhere = tmp_path / "Desktop" / "整理"

    result = move(db, platform, env, src, elsewhere, "予算.pdf")

    assert_skipped(result, src, "pip0 専用フォルダーの中か、今と同じフォルダー")
    assert src.exists()
    assert not (tmp_path / "Desktop").exists()
    [op] = operations(db)
    assert op["status"] == "skipped"
    assert op["file_id"] == file_id
    assert op["before_path"] == str(src)
    assert op["after_path"] is None
    assert op["detail"] == result["reason"]
    assert json.loads(op["reasons_json"]) == REASONS


def test_refuses_to_move_into_pip0_data_or_vault(tmp_path, platform, db):
    from pip0 import config as config_module

    # 設定の誤りで、保管庫が pip0 専用フォルダーの中にある場合でも、保管庫へは移動しない
    root = tmp_path / "pip0"
    config = config_module.load_config(
        overrides={"PIP0_ROOT": root, "DATA_DIR": tmp_path / "AppData" / "pip0",
                   "DOWNLOADS_DIR": tmp_path / "Downloads", "VAULT_DIR": root / "vault"},
        read_user_file=False,
    )
    assert config["CONFIG_ERRORS"]
    src = make_file(tmp_path / "Downloads" / "a.txt")

    result = fileops.move_and_rename(db, platform, src, root / "vault" / "items", "a.txt", kind="sort",
                                     actor="auto", reasons=[], config=config, now=NOW)

    assert_skipped(result, src, "保管庫の中へは移動しません")
    assert not (root / "vault").exists()


def test_refuses_ghosts(env, platform, db):
    src = make_file(env["PIP0_ROOT"] / "古い資料.pdf", b"x" * 100)
    make_ghost(platform, src)

    result = move(db, platform, env, src, env["PIP0_ROOT"] / "整理", "古い資料.pdf")

    assert_skipped(result, src, "退避中のファイル")
    assert platform.ghost_status(src)["is_ghost"] is True
    assert not (env["PIP0_ROOT"] / "整理").exists()


def test_refuses_when_ghost_status_is_unknown_inside_pip0_root(env, platform, db, monkeypatch):
    unknown = {"exists": True, "is_ghost": None, "item_id": None, "dehydrated": None,
               "in_sync": None, "pinned": None, "reason": "OS 連携が動いていません"}
    monkeypatch.setattr(platform, "ghost_status", lambda path: unknown)
    inside = make_file(env["PIP0_ROOT"] / "a.pdf")
    outside = make_file(env["DOWNLOADS_DIR"] / "b.pdf")

    assert_skipped(move(db, platform, env, inside, env["PIP0_ROOT"] / "整理", "a.pdf"), inside, "確かめられない")
    # pip0 専用フォルダーの外にはゴーストを置かないので、確かめられなくても移動できる
    assert move(db, platform, env, outside, env["PIP0_ROOT"] / "整理", "b.pdf")["ok"]


def test_refuses_files_in_use_or_still_downloading(env, platform, db):
    src = make_file(env["DOWNLOADS_DIR"] / "report.pdf")
    platform.locked.add(str(src))

    result = move(db, platform, env, src, env["PIP0_ROOT"] / "整理", "report.pdf")

    assert_skipped(result, src, "使用中")
    assert src.exists()


def test_refuses_placeholders_of_another_cloud(env, platform, db):
    src = make_file(env["DOWNLOADS_DIR"] / "cloud.docx")
    platform.not_local.add(str(src))

    result = move(db, platform, env, src, env["PIP0_ROOT"] / "整理", "cloud.docx")

    assert_skipped(result, src, "中身がこの PC にない")


def test_refuses_links_folders_missing_files_and_pip0_data(env, platform, db):
    target = make_file(env["DOWNLOADS_DIR"] / "target.txt")
    link = env["DOWNLOADS_DIR"] / "link.txt"
    link.symlink_to(target)
    folder = env["DOWNLOADS_DIR"] / "folder"
    folder.mkdir()
    missing = env["DOWNLOADS_DIR"] / "missing.txt"
    data_file = make_file(env["DATA_DIR"] / "logs" / "pip0.log")
    vault_file = make_file(env["VAULT_DIR"] / "items" / ("a" * 32) / "content")
    dest_dir = env["PIP0_ROOT"] / "整理"

    assert_skipped(move(db, platform, env, link, dest_dir, "x.txt"), link, "シンボリックリンク")
    assert_skipped(move(db, platform, env, folder, dest_dir, "x"), folder, "フォルダー")
    assert_skipped(move(db, platform, env, missing, dest_dir, "x.txt"), missing, "見つかりません")
    assert_skipped(move(db, platform, env, data_file, dest_dir, "x.log"), data_file, "データフォルダー")
    assert_skipped(move(db, platform, env, vault_file, dest_dir, "x"), vault_file, "保管庫")
    assert link.is_symlink() and target.exists() and folder.is_dir()
    assert data_file.exists() and vault_file.exists()
    assert [op["status"] for op in operations(db)] == ["skipped"] * 5


def test_refuses_another_volume(env, platform, db, monkeypatch):
    usb = env["PIP0_ROOT"] / "USB"
    usb.mkdir()
    src = make_file(env["DOWNLOADS_DIR"] / "予算.xlsx")
    real_stat = os.stat

    class OtherVolumeStat:
        """st_dev（ボリュームの番号）だけを変えた os.stat の結果"""

        def __init__(self, st):
            self._st = st
            self.st_dev = st.st_dev + 1

        def __getattr__(self, name):
            return getattr(self._st, name)

    def fake_stat(path, *args, **kwargs):
        st = real_stat(path, *args, **kwargs)
        if str(path).startswith(str(usb)):
            return OtherVolumeStat(st)
        return st

    monkeypatch.setattr(os, "stat", fake_stat)
    result = move(db, platform, env, src, usb / "予算・会計", "予算.xlsx")

    assert_skipped(result, src, "別のドライブへの移動は初期コードでは行いません")
    assert src.exists()
    assert not (usb / "予算・会計").exists()


def test_refuses_a_destination_that_is_a_file(env, platform, db):
    not_a_folder = make_file(env["PIP0_ROOT"] / "整理")
    src = make_file(env["DOWNLOADS_DIR"] / "a.txt")

    assert_skipped(move(db, platform, env, src, not_a_folder, "a.txt"), src, "フォルダーではありません")


def test_kill_switch_stops_automatic_moves_but_not_user_moves(env, platform, db):
    env["CONTROL_DIR"].mkdir(parents=True)
    (env["CONTROL_DIR"] / fileops.STOP_MARKER_NAME).write_text("stopped", encoding="utf-8")
    src = make_file(env["DOWNLOADS_DIR"] / "a.txt")
    dest_dir = env["PIP0_ROOT"] / "整理"

    assert_skipped(move(db, platform, env, src, dest_dir, "a.txt", actor="auto"), src, "キルスイッチ")
    result = move(db, platform, env, src, dest_dir, "a.txt", actor="user")
    assert result["ok"] and Path(result["path"]).exists()


def test_os_errors_are_reported_without_paths(env, platform, db, monkeypatch):
    src = make_file(env["DOWNLOADS_DIR"] / "secret-name.txt")

    def denied(source, target):
        raise PermissionError(13, "Permission denied", str(target))

    monkeypatch.setattr(fsutil, "no_overwrite_rename", denied)
    result = move(db, platform, env, src, env["PIP0_ROOT"] / "整理", "secret-name.txt")

    assert result["ok"] is False and result["status"] == "failed"
    assert "アクセスが拒否された" in result["reason"]
    assert "secret-name" not in result["reason"]
    assert src.exists()
    [op] = operations(db)
    assert op["status"] == "failed" and op["detail"] == result["reason"]


# ---------------------------------------------------------------------- 索引（files）


def test_stale_row_with_the_new_path_is_replaced(env, platform, db):
    dest_dir = env["PIP0_ROOT"] / "予算・会計"
    dst = dest_dir / "予算.pdf"
    stale_id = add_file_row(db, dst, location_kind="pip0_root", status="missing")  # もうないファイルの行
    database.execute(db, "INSERT INTO provenance (file_id, source_label, recorded_at) VALUES (?, 'Slack', 1.0)",
                     (stale_id,))
    src = make_file(env["DOWNLOADS_DIR"] / "download.pdf")
    file_id = add_file_row(db, src)

    result = move(db, platform, env, src, dest_dir, "予算.pdf", file_id=file_id)

    assert result["ok"] and result["path"] == str(dst)
    rows = database.query_all(db, "SELECT id, path FROM files")
    assert rows == [{"id": file_id, "path": str(dst)}]
    # 古い行の入手経路（Slack）を、移動してきた別のファイルが引き継がない
    assert database.query_one(db, "SELECT * FROM provenance WHERE file_id = ?", (stale_id,)) is None


def test_stale_row_is_removed_even_when_the_moved_file_is_not_indexed(env, platform, db):
    dest_dir = env["PIP0_ROOT"] / "予算・会計"
    add_file_row(db, dest_dir / "予算.pdf", location_kind="pip0_root", status="missing")
    src = make_file(env["DOWNLOADS_DIR"] / "download.pdf")

    result = move(db, platform, env, src, dest_dir, "予算.pdf")

    assert result["ok"]
    assert database.query_all(db, "SELECT * FROM files") == []
    [op] = operations(db)
    assert op["file_id"] is None and op["status"] == "done"


def test_works_inside_a_transaction_of_the_caller(env, platform, db):
    src = make_file(env["DOWNLOADS_DIR"] / "a.txt")
    file_id = add_file_row(db, src)

    with database.transaction(db):
        result = move(db, platform, env, src, env["PIP0_ROOT"] / "整理", "a.txt", file_id=file_id)

    assert result["ok"]
    assert database.query_one(db, "SELECT path FROM files WHERE id = ?", (file_id,))["path"] == result["path"]


# ---------------------------------------------------------------------- 記録と安全


def test_logs_contain_no_file_names_or_paths(env, platform, db, caplog):
    caplog.set_level(logging.DEBUG, logger="pip0")
    src = make_file(env["DOWNLOADS_DIR"] / "社外秘_給与.xlsx")
    platform.locked.add(str(src))
    move(db, platform, env, src, env["PIP0_ROOT"] / "整理", "社外秘_給与.xlsx")
    platform.locked.clear()
    move(db, platform, env, src, env["PIP0_ROOT"] / "整理", "社外秘_給与.xlsx")

    assert caplog.records  # 記録はしている（種類と結果だけ）
    for record in caplog.records:
        text = record.getMessage()
        assert "社外秘" not in text
        assert str(env["DOWNLOADS_DIR"]) not in text and str(env["PIP0_ROOT"]) not in text


def test_fileops_contains_no_direct_delete_calls():
    source = Path(fileops.__file__).read_text(encoding="utf-8")
    for word in ("os.remove", "os.unlink", "shutil", "rmtree", ".unlink(", "os.rmdir"):
        assert word not in source
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Attribute):
            assert node.attr not in ("remove", "unlink", "rmtree", "rmdir", "removedirs")
