"""対象フォルダーの見直し（scanner.py）のテスト

一時フォルダー（tmp_path）の中のダミーファイルだけを使います。OS 連携は代役（FakePlatform）です。
"""

import hashlib
import json
import os
import stat
import types

import pytest

from pip0 import config as config_module
from pip0 import database, provenance, rules, scanner

NOW = 1_793_250_000.0      # テストで使う決まった時刻
OLD_MTIME = 1_790_000_000  # ダミーファイルの最終更新日時
ITEM_ID = "0123456789abcdef0123456789abcdef"


def make_file(path, data=b"pip0 test data", mtime=OLD_MTIME):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    os.utime(path, (mtime, mtime))
    return path


def symlink_or_skip(target, link):
    """シンボリックリンクを作る。作れない環境（開発者モードでない Windows 等）では、そのテストを飛ばす"""
    try:
        os.symlink(target, link)
    except OSError:
        pytest.skip("この環境ではシンボリックリンクを作れません")


def file_row(db, path):
    return database.query_one(db, "SELECT * FROM files WHERE path = ?", (str(path),))


def all_rows(db):
    return database.query_all(db, "SELECT * FROM files ORDER BY id")


def tasks(db):
    return database.query_all(db, "SELECT * FROM tasks ORDER BY id")


def analysis_row(db, file_id):
    return database.query_one(db, "SELECT * FROM analysis WHERE file_id = ?", (file_id,))


def usage_events(db, file_id):
    return database.query_all(db, "SELECT kind, at FROM usage_events WHERE file_id = ? ORDER BY id", (file_id,))


def upsert(db, platform, path, location_kind="downloads", now=NOW):
    return scanner.upsert_file(db, platform, path, location_kind, now)


def make_ghost(platform, path):
    """代役の OS 連携で、path を pip0 のゴースト（中身は保管庫）にする"""
    st = os.stat(path)
    expected = {"size": st.st_size, "mtime_ns": st.st_mtime_ns, "file_key": platform.get_file_key(path)}
    assert platform.make_ghost(path, ITEM_ID, expected)["result"] == "ghosted"


def put_in_vault(env, data):
    """代役の OS 連携が中身を戻せるよう、保管庫に content と manifest.json を置く"""
    item_dir = env["VAULT_DIR"] / "items" / ITEM_ID
    item_dir.mkdir(parents=True)
    (item_dir / "content").write_bytes(data)
    manifest = {"format": 1, "item_id": ITEM_ID, "sha256": hashlib.sha256(data).hexdigest()}
    (item_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


# ---------------------------------------------------------------------- 対象にするかどうか


def test_should_skip_temporary_and_hidden_names(env, platform):
    downloads = env["DOWNLOADS_DIR"]
    for name in ["report.pdf.crdownload", "Unconfirmed 123456.crdownload", "REPORT.PDF.CRDOWNLOAD", "~$予算.docx",
                 "work.TMP", "desktop.ini", "Thumbs.db", ".hidden.txt", "ショートカット.lnk", "movie.mp4.part"]:
        path = make_file(downloads / name)
        skip, reason = scanner.should_skip(path, platform, env, rules)
        assert skip is True, name
        assert "対象外の名前" in reason
    path = make_file(downloads / "予算.pdf")
    assert scanner.should_skip(path, platform, env, rules) == (False, "")


def test_should_skip_folders_special_and_missing_files(env, platform):
    downloads = env["DOWNLOADS_DIR"]
    folder = downloads / "folder"
    folder.mkdir()
    assert scanner.should_skip(folder, platform, env, rules) == (True, "通常のファイルではありません")
    assert scanner.should_skip(downloads / "none.pdf", platform, env, rules) == (True, "ファイルが見つかりません")
    if hasattr(os, "mkfifo"):  # 名前付きパイプ（Windows 以外）
        fifo = downloads / "pipe"
        os.mkfifo(fifo)
        assert scanner.should_skip(fifo, platform, env, rules) == (True, "通常のファイルではありません")


def test_should_skip_links(env, platform, tmp_path):
    target = make_file(tmp_path / "outside" / "secret.txt")
    link = env["DOWNLOADS_DIR"] / "link.txt"
    symlink_or_skip(target, link)
    assert scanner.should_skip(link, platform, env, rules) == (True, "リンクはたどりません")


def test_should_skip_pip0_data_and_vault(env, platform, tmp_path):
    in_data = make_file(env["DATA_DIR"] / "logs" / "pip0.log")
    skip, reason = scanner.should_skip(in_data, platform, env, rules)
    assert skip is True
    assert "pip0 のデータフォルダー・保管庫" in reason

    config = dict(env)
    config["VAULT_DIR"] = tmp_path / "Downloads" / "vault"  # 保管庫だけを別の場所にした場合
    in_vault = make_file(config["VAULT_DIR"] / "items" / ITEM_ID / "content")
    assert scanner.should_skip(in_vault, platform, config, rules)[0] is True


def test_should_skip_files_that_are_not_local(env, platform):
    cloud = make_file(env["DOWNLOADS_DIR"] / "cloud.pdf")
    platform.not_local.add(str(cloud))
    skip, reason = scanner.should_skip(cloud, platform, env, rules)
    assert skip is True
    assert "中身がこの PC にない" in reason

    ghost = make_file(env["PIP0_ROOT"] / "ghost.pdf")
    make_ghost(platform, ghost)
    assert scanner.should_skip(ghost, platform, env, rules)[0] is True


def test_should_skip_reparse_points_reported_by_platform(env, platform, monkeypatch):
    path = make_file(env["DOWNLOADS_DIR"] / "onedrive.pdf")
    monkeypatch.setattr(platform, "get_local_state", lambda p: {"local": True, "placeholder": True, "pinned": False,
                                                                "reparse": True, "attributes": None, "reason": ""})
    skip, reason = scanner.should_skip(path, platform, env, rules)
    assert skip is True
    assert "再解析ポイント" in reason


def test_windows_attributes_are_read_only_when_present():
    hidden = types.SimpleNamespace(st_file_attributes=stat.FILE_ATTRIBUTE_HIDDEN)
    reparse = types.SimpleNamespace(st_file_attributes=stat.FILE_ATTRIBUTE_REPARSE_POINT)
    linux_stat = types.SimpleNamespace(st_mode=stat.S_IFREG)
    assert scanner.has_attribute(hidden, scanner.HIDDEN_OR_SYSTEM) is True
    assert scanner.has_attribute(reparse, scanner.HIDDEN_OR_SYSTEM) is False
    assert scanner.has_attribute(linux_stat, stat.FILE_ATTRIBUTE_REPARSE_POINT) is False


# ---------------------------------------------------------------------- 1つのファイルを記録する


def test_upsert_new_file_is_indexed_and_queued(db, platform, env):
    path = make_file(env["DOWNLOADS_DIR"] / "予算.PDF", b"0123456789")
    result = upsert(db, platform, path)
    assert result["is_new"] is True
    assert result["changed"] is False
    row = file_row(db, path)
    assert row["id"] == result["file_id"]
    assert row["name"] == "予算.PDF"
    assert row["ext"] == ".pdf"
    assert row["size"] == 10
    assert row["mtime"] == OLD_MTIME
    assert row["file_key"] == platform.get_file_key(path)
    assert row["location_kind"] == "downloads"
    assert row["status"] == "present"
    assert row["first_seen_at"] == NOW
    assert row["last_seen_at"] == NOW
    assert analysis_row(db, row["id"])["status"] == "pending"
    assert [(t["kind"], t["file_id"], t["state"]) for t in tasks(db)] == [("analyse", row["id"], "queued")]
    assert usage_events(db, row["id"]) == []


def test_upsert_unchanged_file_keeps_first_seen(db, platform, env):
    path = make_file(env["DOWNLOADS_DIR"] / "a.pdf")
    file_id = upsert(db, platform, path)["file_id"]
    result = upsert(db, platform, path, now=NOW + 60)
    assert result == {"file_id": file_id, "is_new": False, "changed": False}
    row = file_row(db, path)
    assert row["first_seen_at"] == NOW
    assert row["last_seen_at"] == NOW + 60
    assert row["updated_at"] == NOW  # 内容が変わらなければ進めない
    assert len(tasks(db)) == 1
    assert usage_events(db, file_id) == []


def test_upsert_changed_file_is_queued_again_and_records_modification(db, platform, env):
    path = make_file(env["DOWNLOADS_DIR"] / "a.pdf", b"first")
    file_id = upsert(db, platform, path)["file_id"]
    db.execute("UPDATE tasks SET state = 'done'")
    db.execute("UPDATE analysis SET status = 'done', sensitivity = 'not_sensitive' WHERE file_id = ?", (file_id,))

    make_file(path, b"second version", mtime=OLD_MTIME + 100)
    result = upsert(db, platform, path, now=NOW + 60)
    assert result == {"file_id": file_id, "is_new": False, "changed": True}
    assert file_row(db, path)["size"] == len(b"second version")
    assert file_row(db, path)["updated_at"] == NOW + 60
    analysis = analysis_row(db, file_id)
    assert analysis["status"] == "pending"
    assert analysis["sensitivity"] == "unknown"  # 古い「非機密」は使わない
    assert [t["state"] for t in tasks(db)] == ["queued"]
    assert usage_events(db, file_id) == [{"kind": "modified", "at": OLD_MTIME + 100}]


def test_changed_file_keeps_a_sensitive_verdict_until_analysed(db, platform, env):
    path = make_file(env["DOWNLOADS_DIR"] / "社外秘.docx", b"first")
    file_id = upsert(db, platform, path)["file_id"]
    db.execute("UPDATE analysis SET status = 'done', sensitivity = 'sensitive' WHERE file_id = ?", (file_id,))
    make_file(path, b"edited", mtime=OLD_MTIME + 5)
    upsert(db, platform, path, now=NOW + 1)
    assert analysis_row(db, file_id)["sensitivity"] == "sensitive"
    assert analysis_row(db, file_id)["status"] == "pending"


def test_older_mtime_is_a_change_but_not_a_use(db, platform, env):
    path = make_file(env["DOWNLOADS_DIR"] / "a.pdf")
    file_id = upsert(db, platform, path)["file_id"]
    os.utime(path, (OLD_MTIME - 1000, OLD_MTIME - 1000))  # バックアップから戻した等
    assert upsert(db, platform, path, now=NOW + 1)["changed"] is True
    assert usage_events(db, file_id) == []


def test_upsert_returns_none_for_missing_files_and_links(db, platform, env, tmp_path):
    assert upsert(db, platform, env["DOWNLOADS_DIR"] / "none.pdf") is None
    target = make_file(tmp_path / "outside.txt")
    link = env["DOWNLOADS_DIR"] / "link.txt"
    symlink_or_skip(target, link)
    assert upsert(db, platform, link) is None
    assert all_rows(db) == []


def test_rename_is_tracked_by_file_key(db, platform, env):
    old = make_file(env["DOWNLOADS_DIR"] / "download.pdf")
    file_id = upsert(db, platform, old)["file_id"]
    source = {"label": "Slack", "kind": "browser_extension", "evidence": "記録", "host": "files.slack.com",
              "download_url": None, "referrer_url": None}
    provenance.record_provenance(db, file_id, source, now=NOW)

    new = env["PIP0_ROOT"] / "予算・会計" / "2026-10-30_予算_Slack.pdf"
    new.parent.mkdir()
    os.rename(old, new)
    result = upsert(db, platform, new, location_kind="pip0_root", now=NOW + 10)
    assert result == {"file_id": file_id, "is_new": False, "changed": False}
    rows = all_rows(db)
    assert len(rows) == 1
    assert rows[0]["path"] == str(new)
    assert rows[0]["name"] == "2026-10-30_予算_Slack.pdf"
    assert rows[0]["location_kind"] == "pip0_root"
    assert rows[0]["first_seen_at"] == NOW
    assert provenance.get_provenance(db, file_id)["source_label"] == "Slack"  # 入手経路を引き継ぐ


def test_hard_link_is_not_a_rename(db, platform, env):
    first = make_file(env["DOWNLOADS_DIR"] / "a.pdf")
    first_id = upsert(db, platform, first)["file_id"]
    second = env["DOWNLOADS_DIR"] / "b.pdf"
    os.link(first, second)  # 同じ実体の、もう1つの名前（元の名前も残っている）
    result = upsert(db, platform, second)
    assert result["is_new"] is True
    assert result["file_id"] != first_id


def test_reused_file_key_with_other_size_is_a_new_file(db, platform, env, monkeypatch):
    # FAT／exFAT や Linux では、消えたファイルの番号が使い回されることがある
    monkeypatch.setattr(platform, "get_file_key", lambda path: "1:99")
    old = make_file(env["DOWNLOADS_DIR"] / "old.pdf", b"old")
    old_id = upsert(db, platform, old)["file_id"]
    os.remove(old)
    new = make_file(env["DOWNLOADS_DIR"] / "new.pdf", b"a different file")
    result = upsert(db, platform, new)
    assert result["is_new"] is True
    assert result["file_id"] != old_id


def test_ghost_keeps_status_and_is_not_queued(db, platform, env):
    path = make_file(env["PIP0_ROOT"] / "old-report.pdf")
    file_id = upsert(db, platform, path, location_kind="pip0_root")["file_id"]
    db.execute("UPDATE tasks SET state = 'done'")
    db.execute("UPDATE analysis SET status = 'done' WHERE file_id = ?", (file_id,))
    make_ghost(platform, path)

    result = upsert(db, platform, path, location_kind="pip0_root", now=NOW + 5)
    assert result == {"file_id": file_id, "is_new": False, "changed": False}
    assert file_row(db, path)["status"] == "ghost"
    assert [t["state"] for t in tasks(db)] == ["done"]  # 解析の順番待ちに戻さない（中身を読まない）
    assert analysis_row(db, file_id)["status"] == "done"


def test_unknown_ghost_gets_a_ghost_row_without_analysis(db, platform, env):
    path = make_file(env["PIP0_ROOT"] / "ghost.pdf")
    make_ghost(platform, path)
    result = upsert(db, platform, path, location_kind="pip0_root")
    assert result["is_new"] is True
    assert file_row(db, path)["status"] == "ghost"
    assert analysis_row(db, result["file_id"]) is None
    assert tasks(db) == []


def test_opened_ghost_stays_ghost_until_vault_restores_it(db, platform, env):
    data = b"original content of the evacuated file"
    path = make_file(env["PIP0_ROOT"] / "opened.pdf", data)
    file_id = upsert(db, platform, path, location_kind="pip0_root")["file_id"]
    db.execute("UPDATE tasks SET state = 'done'")
    put_in_vault(env, data)
    make_ghost(platform, path)
    upsert(db, platform, path, location_kind="pip0_root", now=NOW + 1)
    assert platform.simulate_app_open(path) == data  # アプリが開いて、中身が戻った（まだプレースホルダー）

    upsert(db, platform, path, location_kind="pip0_root", now=NOW + 2)
    assert file_row(db, path)["status"] == "ghost"
    assert [t["state"] for t in tasks(db)] == ["done"]

    assert platform.restore_ghost(path, ITEM_ID)["result"] == "restored"  # 通常のファイルに戻った
    result = upsert(db, platform, path, location_kind="pip0_root", now=NOW + 3)
    assert result["file_id"] == file_id
    assert file_row(db, path)["status"] == "present"


def test_other_cloud_placeholders_are_not_indexed(db, platform, env):
    path = make_file(env["DOWNLOADS_DIR"] / "onedrive-only.pdf")
    platform.not_local.add(str(path))
    assert upsert(db, platform, path) is None
    assert all_rows(db) == []


# ---------------------------------------------------------------------- フォルダーを見直す


def test_scan_folder_counts_and_prunes(db, platform, env):
    downloads = env["DOWNLOADS_DIR"]
    make_file(downloads / "a.pdf")
    make_file(downloads / "sub" / "b.txt")
    make_file(downloads / ".hidden" / "c.txt")
    make_file(downloads / "x.pdf.crdownload")

    counts = scanner.scan_folder(db, platform, downloads, "downloads", env, rules, NOW)
    assert counts == {"ok": True, "reason": "", "seen": 2, "new": 2, "changed": 0, "skipped": 1,
                      "missing": 0, "errors": 0}
    assert sorted(row["path"] for row in all_rows(db)) == [str(downloads / "a.pdf"), str(downloads / "sub" / "b.txt")]
    assert len(tasks(db)) == 2

    again = scanner.scan_folder(db, platform, downloads, "downloads", env, rules, NOW + 60)
    assert (again["seen"], again["new"], again["changed"], again["missing"]) == (2, 0, 0, 0)


def test_scan_folder_does_not_follow_links(db, platform, env, tmp_path):
    downloads = env["DOWNLOADS_DIR"]
    real = make_file(downloads / "real.pdf")
    outside = make_file(tmp_path / "outside" / "d.txt")
    symlink_or_skip(outside.parent, downloads / "link_dir")
    symlink_or_skip(outside, downloads / "link_file.txt")
    counts = scanner.scan_folder(db, platform, downloads, "downloads", env, rules, NOW)
    assert (counts["seen"], counts["skipped"]) == (1, 1)  # リンクのファイルは対象外、リンクのフォルダーには入らない
    assert [row["path"] for row in all_rows(db)] == [str(real)]


def test_scan_folder_marks_missing_but_not_ghosts(db, platform, env):
    downloads = env["DOWNLOADS_DIR"]
    gone = make_file(downloads / "gone.pdf")
    stays = make_file(downloads / "stays.pdf")
    ghost = make_file(env["PIP0_ROOT"] / "ghost.pdf")
    scanner.scan_folder(db, platform, downloads, "downloads", env, rules, NOW)
    scanner.scan_folder(db, platform, env["PIP0_ROOT"], "pip0_root", env, rules, NOW)
    db.execute("UPDATE files SET status = 'ghost' WHERE path = ?", (str(ghost),))
    make_ghost(platform, ghost)
    os.remove(gone)

    counts = scanner.scan_folder(db, platform, downloads, "downloads", env, rules, NOW + 60)
    assert counts["missing"] == 1
    assert file_row(db, gone)["status"] == "missing"
    assert file_row(db, gone)["updated_at"] == NOW + 60
    assert file_row(db, stays)["status"] == "present"

    counts = scanner.scan_folder(db, platform, env["PIP0_ROOT"], "pip0_root", env, rules, NOW + 60)
    assert counts["missing"] == 0
    assert counts["skipped"] == 1  # ゴーストは読まない
    assert file_row(db, ghost)["status"] == "ghost"

    make_file(gone, b"back again")  # 戻ってきたファイルは、また「あり」にする
    scanner.scan_folder(db, platform, downloads, "downloads", env, rules, NOW + 120)
    assert file_row(db, gone)["status"] == "present"


def test_scan_folder_notices_a_new_ghost_instead_of_missing(db, platform, env):
    path = make_file(env["PIP0_ROOT"] / "evacuated.pdf")
    scanner.scan_folder(db, platform, env["PIP0_ROOT"], "pip0_root", env, rules, NOW)
    make_ghost(platform, path)  # 索引の行は present のまま、ゴーストになった
    counts = scanner.scan_folder(db, platform, env["PIP0_ROOT"], "pip0_root", env, rules, NOW + 60)
    assert counts["missing"] == 0
    assert file_row(db, path)["status"] == "ghost"


def test_scan_folder_records_modified_use_and_changes(db, platform, env):
    path = make_file(env["DOWNLOADS_DIR"] / "a.xlsx", b"v1")
    scanner.scan_folder(db, platform, env["DOWNLOADS_DIR"], "downloads", env, rules, NOW)
    make_file(path, b"v2 longer", mtime=OLD_MTIME + 30)
    counts = scanner.scan_folder(db, platform, env["DOWNLOADS_DIR"], "downloads", env, rules, NOW + 60)
    assert counts["changed"] == 1
    assert usage_events(db, file_row(db, path)["id"]) == [{"kind": "modified", "at": OLD_MTIME + 30}]


def test_scan_folder_that_does_not_exist_changes_nothing(db, platform, env, tmp_path):
    folder = tmp_path / "USB"
    path = make_file(folder / "a.pdf")
    scanner.scan_folder(db, platform, folder, "extra", env, rules, NOW)
    os.remove(path)
    folder.rmdir()
    counts = scanner.scan_folder(db, platform, folder, "extra", env, rules, NOW + 60)
    assert counts["ok"] is False
    assert "見つからない" in counts["reason"]
    assert file_row(db, path)["status"] == "present"


def test_scan_folder_keeps_rows_in_unreadable_folders(db, platform, env, monkeypatch):
    downloads = env["DOWNLOADS_DIR"]
    locked_folder = downloads / "locked"
    inside = make_file(locked_folder / "inside.pdf")
    outside = make_file(downloads / "outside.pdf")
    scanner.scan_folder(db, platform, downloads, "downloads", env, rules, NOW)
    os.remove(outside)

    real_walk = os.walk

    def walk_with_error(top, onerror=None, followlinks=False):
        # 権限のないフォルダーは、os.walk が onerror を呼んで飛ばす。その動きをまねる
        for current, folders, files in real_walk(top, onerror=onerror, followlinks=followlinks):
            if current == str(locked_folder):
                onerror(PermissionError(13, "アクセスが拒否されました", current))
                folders[:] = []
                continue
            yield current, folders, files

    monkeypatch.setattr(scanner.os, "walk", walk_with_error)
    counts = scanner.scan_folder(db, platform, downloads, "downloads", env, rules, NOW + 60)
    assert counts["errors"] == 1
    assert counts["missing"] == 1
    assert file_row(db, inside)["status"] == "present"  # 読めなかっただけで、消えたとは限らない
    assert file_row(db, outside)["status"] == "missing"


def test_scan_folder_does_not_enter_data_dir_or_vault(db, platform, env, tmp_path):
    # db フィクスチャーが DATA_DIR に暗号化DB を作っている。DATA_DIR を含むフォルダーを見直しても、中には入らない
    make_file(env["VAULT_DIR"] / "items" / ITEM_ID / "content")
    other = make_file(tmp_path / "AppData" / "notes.txt")
    counts = scanner.scan_folder(db, platform, tmp_path / "AppData", "extra", env, rules, NOW)
    assert [row["path"] for row in all_rows(db)] == [str(other)]
    assert counts["new"] == 1


def test_scan_all_uses_index_folders(db, platform, env, tmp_path):
    make_file(env["DOWNLOADS_DIR"] / "a.pdf")
    make_file(env["PIP0_ROOT"] / "予算・会計" / "b.xlsx")
    totals = scanner.scan_all(db, platform, env, rules, NOW)
    assert totals["ok"] is True
    assert totals["folders"] == 2
    assert totals["new"] == 2
    kinds = sorted(row["location_kind"] for row in all_rows(db))
    assert kinds == ["downloads", "pip0_root"]

    config = config_module.load_config(
        overrides={"DOWNLOADS_DIR": env["DOWNLOADS_DIR"], "PIP0_ROOT": None, "DATA_DIR": env["DATA_DIR"],
                   "EXTRA_INDEX_DIRS": [tmp_path / "missing-extra"]},
        read_user_file=False,
    )
    totals = scanner.scan_all(db, platform, config, rules, NOW + 60)
    assert totals["folders"] == 2  # ダウンロードと、見つからない追加フォルダー（pip0 専用フォルダーは未設定）
    assert totals["ok"] is False
    assert "追加の対象フォルダー" in totals["reason"]
    assert str(tmp_path) not in totals["reason"]  # 理由にパスを書かない


def test_is_under_compares_paths_without_case(tmp_path):
    folder = tmp_path / "Downloads"
    assert scanner.is_under(folder / "a.pdf", folder) is True
    assert scanner.is_under(str(folder / "SUB" / "a.pdf").replace("Downloads", "downloads"), folder) is True
    assert scanner.is_under(tmp_path / "Downloads2" / "a.pdf", folder) is False
    assert scanner.is_under(folder, folder) is True
