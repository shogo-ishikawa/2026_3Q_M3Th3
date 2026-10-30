"""ごみ箱への移動（trash.py）のテスト

一時フォルダー（tmp_path）の中のダミーファイルだけを使います。確認画面とごみ箱は代役（FakePlatform）です。
代役のごみ箱は platform.trash_dir（一時フォルダーの中）、確認画面の答えは platform.dialog_answer で決めます。
"""

import ast
import json
import logging
import os
from pathlib import Path

import pytest

from pip0 import database, trash

NOW = 1_793_000_000.0  # テストで使う決まった時刻


def make_file(path, data=b"pip0 test data"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path


def add_file_row(db, path, location_kind="downloads"):
    return database.execute(
        db,
        "INSERT INTO files (path, name, ext, size, location_kind, first_seen_at, last_seen_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (str(path), path.name, path.suffix.lower(), 1, location_kind, 1.0, 1.0, 1.0),
    )


def operations(db):
    return database.query_all(db, "SELECT * FROM operations ORDER BY id")


def file_status(db, file_id):
    return database.query_one(db, "SELECT status FROM files WHERE id = ?", (file_id,))["status"]


def make_ghost(platform, path):
    """代役の OS 連携で、path をゴースト（中身を保管庫に預けた状態）にする"""
    st = os.stat(path)
    expected = {"size": st.st_size, "mtime_ns": st.st_mtime_ns, "file_key": platform.get_file_key(path)}
    assert platform.make_ghost(path, "0" * 32, expected)["result"] == "ghosted"


def recycle_bin_names(platform):
    if not platform.trash_dir.exists():
        return []
    return sorted(p.name for p in platform.trash_dir.iterdir())


@pytest.fixture
def two_files(env, db):
    first = make_file(env["DOWNLOADS_DIR"] / "予算案.xlsx", b"budget")
    second = make_file(env["PIP0_ROOT"] / "青いグラフ.png", b"chart!")
    return [(first, add_file_row(db, first)), (second, add_file_row(db, second, "pip0_root"))]


# ---------------------------------------------------------------------- 確認画面の答え


@pytest.mark.parametrize("answer", ["cancel", "closed", "unavailable"])
def test_unapproved_dialog_deletes_nothing(env, platform, db, two_files, answer):
    # cancel：キャンセル、closed：画面を閉じた、unavailable：確認画面を出せなかった（表示なしで起動など）
    platform.dialog_answer = answer
    request = trash.prepare_deletion(db, [path for path, _ in two_files], env, platform)

    result = trash.delete_with_confirmation(db, platform, request, now=NOW)

    assert result["approved"] is False
    assert result["answer"] == answer
    assert result["summary"] == {"recycled": 0, "refused": 0, "failed": 0, "not_attempted": 2}
    assert [r["status"] for r in result["results"]] == ["not_attempted", "not_attempted"]
    for path, file_id in two_files:
        assert path.exists()
        assert file_status(db, file_id) == "present"
    assert recycle_bin_names(platform) == []
    ops = operations(db)
    assert [(op["kind"], op["actor"], op["status"]) for op in ops] == [("trash", "user", "cancelled")] * 2
    assert [op["file_id"] for op in ops] == [file_id for _, file_id in two_files]
    assert all(op["at"] == NOW for op in ops)


def test_approve_moves_files_into_the_recycle_bin(env, platform, db, two_files):
    platform.dialog_answer = "approve"
    request = trash.prepare_deletion(db, [path for path, _ in two_files], env, platform)

    result = trash.delete_with_confirmation(db, platform, request, now=NOW)

    assert result["approved"] is True and result["answer"] == "approve"
    assert result["summary"] == {"recycled": 2, "refused": 0, "failed": 0, "not_attempted": 0}
    for path, file_id in two_files:
        assert not path.exists()
        assert file_status(db, file_id) == "missing"
    # 完全に削除したのではなく、ごみ箱（代役）に中身がそのまま残っている
    assert recycle_bin_names(platform) == ["予算案.xlsx", "青いグラフ.png"]
    assert (platform.trash_dir / "予算案.xlsx").read_bytes() == b"budget"
    ops = operations(db)
    assert [op["status"] for op in ops] == ["done", "done"]
    assert [op["before_path"] for op in ops] == [str(path) for path, _ in two_files]
    reasons = json.loads(ops[0]["reasons_json"])
    assert reasons == ["削除の依頼 " + request["request_id"], "確認画面：承認"]


def test_no_recycle_bin_means_refused_and_the_file_stays(env, platform, db, two_files):
    platform.dialog_answer = "approve"
    platform.recycle_bin_available = False
    request = trash.prepare_deletion(db, [path for path, _ in two_files], env, platform)

    result = trash.delete_with_confirmation(db, platform, request, now=NOW)

    assert result["approved"] is True
    assert result["summary"] == {"recycled": 0, "refused": 2, "failed": 0, "not_attempted": 0}
    assert all("ごみ箱を使えない" in r["reason"] for r in result["results"])
    for path, file_id in two_files:
        assert path.exists()  # 通常の削除・完全削除へ切り替えない
        assert file_status(db, file_id) == "present"
    assert recycle_bin_names(platform) == []
    assert [op["status"] for op in operations(db)] == ["refused", "refused"]


def test_every_call_shows_one_new_dialog_with_names_and_count(env, platform, db):
    paths = [make_file(env["DOWNLOADS_DIR"] / name, b"12345") for name in ("a.txt", "予算.pdf", "グラフ.png")]
    request = trash.prepare_deletion(db, paths, env, platform)

    platform.dialog_answer = "cancel"
    trash.delete_with_confirmation(db, platform, request, now=NOW)
    assert len(platform.dialog_requests) == 1
    trash.delete_with_confirmation(db, platform, request, now=NOW)  # 同じ依頼でも、もう一度確認する
    assert len(platform.dialog_requests) == 2
    platform.dialog_answer = "approve"
    result = trash.delete_with_confirmation(db, platform, request, now=NOW)
    assert len(platform.dialog_requests) == 3
    assert result["summary"]["recycled"] == 3

    for dialog in platform.dialog_requests:
        assert set(dialog) == {"request_id", "title", "message", "items"}
        assert dialog["request_id"] == request["request_id"]
        assert "3 件" in dialog["title"]
        assert "3 件のファイルをごみ箱へ移動しますか？" in dialog["message"]
        for path in paths:
            assert path.name in dialog["message"]
        assert dialog["items"] == [{"path": str(p), "name": p.name, "size": 5} for p in paths]


def test_an_earlier_approval_is_not_reused(env, platform, db):
    first = make_file(env["DOWNLOADS_DIR"] / "first.txt")
    second = make_file(env["DOWNLOADS_DIR"] / "second.txt")
    platform.dialog_answer = "approve"
    trash.delete_with_confirmation(db, platform, trash.prepare_deletion(db, [first], env, platform), now=NOW)
    assert not first.exists()

    platform.dialog_answer = "cancel"
    result = trash.delete_with_confirmation(db, platform, trash.prepare_deletion(db, [second], env, platform),
                                            now=NOW)

    assert result["approved"] is False
    assert second.exists()
    assert len(platform.dialog_requests) == 2


def test_nothing_deletable_shows_no_dialog(env, platform, db):
    folder = env["DOWNLOADS_DIR"] / "folder"
    folder.mkdir()
    request = trash.prepare_deletion(db, [folder, env["DOWNLOADS_DIR"] / "missing.txt"], env, platform)
    platform.dialog_answer = "approve"

    result = trash.delete_with_confirmation(db, platform, request, now=NOW)

    assert platform.dialog_requests == []
    assert result["approved"] is False and result["answer"] is None
    assert result["summary"] == {"recycled": 0, "refused": 0, "failed": 0, "not_attempted": 2}
    assert folder.is_dir()
    ops = operations(db)
    assert [op["status"] for op in ops] == ["skipped", "skipped"]
    assert [op["detail"] for op in ops] == [item["problem"] for item in request["items"]]


def test_only_deletable_items_are_shown_and_others_are_reported(env, platform, db):
    good = make_file(env["DOWNLOADS_DIR"] / "good.txt", b"abc")
    folder = env["DOWNLOADS_DIR"] / "folder"
    folder.mkdir()
    platform.dialog_answer = "approve"
    request = trash.prepare_deletion(db, [folder, good], env, platform)

    result = trash.delete_with_confirmation(db, platform, request, now=NOW)

    [dialog] = platform.dialog_requests
    assert [item["name"] for item in dialog["items"]] == ["good.txt"]
    assert "1 件のファイルをごみ箱へ移動しますか？" in dialog["message"]
    assert "folder" not in dialog["message"]
    assert [r["status"] for r in result["results"]] == ["not_attempted", "recycled"]
    assert "フォルダー" in result["results"][0]["reason"]
    assert result["summary"] == {"recycled": 1, "refused": 0, "failed": 0, "not_attempted": 1}
    assert [op["status"] for op in operations(db)] == ["skipped", "done"]


# ---------------------------------------------------------------------- 削除の依頼を作る


def test_prepare_deletion_refuses_unsafe_items(env, platform, db):
    downloads = env["DOWNLOADS_DIR"]
    ok_download = make_file(downloads / "ok.txt", b"12345")
    ok_in_root = make_file(env["PIP0_ROOT"] / "ok.pdf", b"1234567")
    vault_file = make_file(env["VAULT_DIR"] / "items" / ("0" * 32) / "content")
    data_file = make_file(env["DATA_DIR"] / "logs" / "pip0.log")
    ghost = make_file(env["PIP0_ROOT"] / "退避済み.pdf", b"x" * 64)
    make_ghost(platform, ghost)
    folder = downloads / "folder"
    folder.mkdir()
    missing = downloads / "missing.txt"
    cloud = make_file(downloads / "cloud.docx")
    platform.not_local.add(str(cloud))
    link = downloads / "link.txt"
    link.symlink_to(ok_download)
    paths = [ok_download, ok_in_root, vault_file, data_file, ghost, folder, missing, cloud, link, ok_download]

    request = trash.prepare_deletion(db, paths, env, platform)

    assert len(request["request_id"]) == 32
    assert [item["path"] for item in request["items"]] == [str(p) for p in paths]
    problems = [item["problem"] for item in request["items"]]
    assert problems[0] is None and problems[1] is None
    assert "保管庫" in problems[2]
    assert "データフォルダー" in problems[3]
    assert problems[4] == "退避中のファイルは、先に復元してから削除してください"
    assert "フォルダー" in problems[5]
    assert "見つかりません" in problems[6]
    assert "中身がこの PC にない" in problems[7]
    assert "シンボリックリンク" in problems[8]
    assert "重複" in problems[9]
    # 件数と大きさは、削除してよいものだけ
    assert request["count"] == 2
    assert request["total_bytes"] == 12
    assert request["problems"] == request["items"][2:]
    assert request["items"][0] == {"path": str(ok_download), "name": "ok.txt", "size": 5, "problem": None}
    assert request["items"][6]["size"] is None and request["items"][5]["size"] is None
    # 依頼を作っただけでは何も変わらない
    assert platform.dialog_requests == []
    assert all(p.exists() or p == missing for p in paths)


def test_vault_record_marks_a_ghost_even_if_the_platform_does_not(env, platform, db):
    path = make_file(env["PIP0_ROOT"] / "退避中.pdf")
    database.execute(
        db,
        "INSERT INTO vault_items (item_id, original_path, current_path, size, mtime_ns, state, created_at, updated_at) "
        "VALUES (?, ?, ?, 1, 1, 'evacuated', 1.0, 1.0)",
        ("a" * 32, str(path), str(path)),
    )

    request = trash.prepare_deletion(db, [path], env, platform)

    assert request["items"][0]["problem"] == trash.GHOST_PROBLEM
    assert request["count"] == 0


def test_unknown_ghost_status_is_not_treated_as_safe(env, platform, db, monkeypatch):
    path = make_file(env["DOWNLOADS_DIR"] / "a.txt")
    unknown = {"exists": True, "is_ghost": None, "item_id": None, "dehydrated": None,
               "in_sync": None, "pinned": None, "reason": "OS 連携が動いていません"}
    monkeypatch.setattr(platform, "ghost_status", lambda p: unknown)

    request = trash.prepare_deletion(db, [path], env, platform)

    assert "確かめられない" in request["items"][0]["problem"]


def test_prepare_deletion_accepts_a_single_path(env, platform, db):
    path = make_file(env["DOWNLOADS_DIR"] / "one.txt", b"1")

    request = trash.prepare_deletion(db, str(path), env, platform)

    assert [item["name"] for item in request["items"]] == ["one.txt"]
    assert request["count"] == 1


def test_files_are_checked_again_just_before_the_dialog(env, platform, db):
    changed = make_file(env["DOWNLOADS_DIR"] / "changed.docx")
    removed = make_file(env["DOWNLOADS_DIR"] / "removed.txt")
    stays = make_file(env["DOWNLOADS_DIR"] / "stays.txt")
    request = trash.prepare_deletion(db, [changed, removed, stays], env, platform)
    assert request["count"] == 3
    # 依頼を作った後に、中身がクラウドへ移され、別のファイルはほかのアプリに消された
    platform.not_local.add(str(changed))
    removed.unlink()
    platform.dialog_answer = "approve"

    result = trash.delete_with_confirmation(db, platform, request, now=NOW)

    [dialog] = platform.dialog_requests
    assert [item["name"] for item in dialog["items"]] == ["stays.txt"]
    assert [r["status"] for r in result["results"]] == ["not_attempted", "not_attempted", "recycled"]
    assert "中身がこの PC にない" in result["results"][0]["reason"]
    assert "見つかりません" in result["results"][1]["reason"]
    assert changed.exists()
    assert [op["status"] for op in operations(db)] == ["skipped", "skipped", "done"]


# ---------------------------------------------------------------------- OS 連携の答え


def test_failed_item_is_reported_and_kept_in_the_index(env, platform, db, monkeypatch):
    first = make_file(env["DOWNLOADS_DIR"] / "first.txt")
    second = make_file(env["DOWNLOADS_DIR"] / "second.txt")
    first_id = add_file_row(db, first)
    request = trash.prepare_deletion(db, [first, second], env, platform)
    platform.dialog_answer = "approve"
    real_confirm = platform.confirm_and_recycle

    def confirm_after_another_app_moved_the_file(dialog):
        first.rename(env["DOWNLOADS_DIR"] / "moved-away.txt")  # 確認画面の表示中に、ほかのアプリが動かした
        return real_confirm(dialog)

    monkeypatch.setattr(platform, "confirm_and_recycle", confirm_after_another_app_moved_the_file)
    result = trash.delete_with_confirmation(db, platform, request, now=NOW)

    assert [r["status"] for r in result["results"]] == ["failed", "recycled"]
    assert result["summary"] == {"recycled": 1, "refused": 0, "failed": 1, "not_attempted": 0}
    assert file_status(db, first_id) == "present"
    assert [op["status"] for op in operations(db)] == ["failed", "done"]


def test_unknown_or_missing_answers_are_not_treated_as_recycled(env, platform, db, monkeypatch):
    first = make_file(env["DOWNLOADS_DIR"] / "first.txt")
    second = make_file(env["DOWNLOADS_DIR"] / "second.txt")
    request = trash.prepare_deletion(db, [first, second], env, platform)

    def strange_reply(dialog):
        platform.dialog_requests.append(dialog)
        return {"approved": True, "answer": "approve",
                "results": [{"path": str(first), "status": "vanished", "reason": ""}]}  # second の結果がない

    monkeypatch.setattr(platform, "confirm_and_recycle", strange_reply)
    result = trash.delete_with_confirmation(db, platform, request, now=NOW)

    assert [r["status"] for r in result["results"]] == ["failed", "failed"]
    assert result["summary"]["recycled"] == 0


def test_long_lists_are_summarised_in_the_message(env, platform, db):
    paths = [make_file(env["DOWNLOADS_DIR"] / f"file{number:02d}.txt") for number in range(25)]
    request = trash.prepare_deletion(db, paths, env, platform)

    trash.delete_with_confirmation(db, platform, request, now=NOW)

    [dialog] = platform.dialog_requests
    assert "25 件のファイルをごみ箱へ移動しますか？" in dialog["message"]
    assert "file19.txt" in dialog["message"]
    assert "file20.txt" not in dialog["message"]
    assert "ほか 5 件" in dialog["message"]
    assert len(dialog["items"]) == 25  # 画面の一覧には全件を渡す


def test_empty_request_does_nothing(env, platform, db):
    request = trash.prepare_deletion(db, [], env, platform)

    result = trash.delete_with_confirmation(db, platform, request, now=NOW)

    assert request["count"] == 0 and request["items"] == [] and request["problems"] == []
    assert result == {"approved": False, "answer": None, "results": [],
                      "summary": {"recycled": 0, "refused": 0, "failed": 0, "not_attempted": 0}}
    assert platform.dialog_requests == [] and operations(db) == []


# ---------------------------------------------------------------------- 記録と安全


def test_logs_contain_no_file_names_or_paths(env, platform, db, caplog):
    caplog.set_level(logging.DEBUG, logger="pip0")
    path = make_file(env["DOWNLOADS_DIR"] / "社外秘_名簿.xlsx")
    platform.dialog_answer = "approve"

    trash.delete_with_confirmation(db, platform, trash.prepare_deletion(db, [path], env, platform), now=NOW)

    assert caplog.records
    for record in caplog.records:
        text = record.getMessage()
        assert "社外秘" not in text and str(env["DOWNLOADS_DIR"]) not in text


def test_trash_module_contains_no_direct_delete_calls():
    """完全削除の道がないこと：ごみ箱へ移すのは platform.confirm_and_recycle だけ"""
    source = Path(trash.__file__).read_text(encoding="utf-8")
    for word in ("os.remove", "os.unlink", "shutil", "rmtree", ".unlink(", "os.rmdir", "send2trash"):
        assert word not in source
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute):
            assert node.attr not in ("remove", "unlink", "rmtree", "rmdir", "removedirs", "truncate")
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            names = [alias.name for alias in node.names] + [getattr(node, "module", None) or ""]
            assert not any(name.split(".")[0] in ("shutil", "send2trash", "subprocess") for name in names)
    called = {node.func.attr for node in ast.walk(tree)
              if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
              and isinstance(node.func.value, ast.Name) and node.func.value.id == "platform"}
    assert "confirm_and_recycle" in called
