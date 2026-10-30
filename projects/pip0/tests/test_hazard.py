"""機密ファイルのドラッグの警告（hazard.py）のテスト

- evaluate_items：ドラッグ中のファイルの判定（機密・未判定・どちらでもない）。DB には索引の行を直接入れる
- HazardSession：警告の表示、続行の判定（0.5秒以上の表示、別のアプリへのドロップ）、消音（同じファイル × 同じアプリ）、
  セッションの終わりで消音が消えること
ドラッグの知らせ（drag.started など）は、pip0 シェルの代わりにテストの中で作ります。
"""

import json
import logging

import pytest

from pip0 import database, hazard, rules

NOW = 1_793_235_600.0  # 2026-10-29 10:00（日本時間）


def add_file(db, env, name, *, analysis=None, folder=None):
    """索引（files）に1行を加え、analysis（analysis テーブルの列の辞書）があれば加える。(パス, file_id) を返す"""
    path = str((folder or env["DOWNLOADS_DIR"]) / name)
    ext = "." + name.rsplit(".", 1)[1].lower() if "." in name else ""
    file_id = database.execute(
        db,
        "INSERT INTO files (path, file_key, name, ext, size, mtime, location_kind, status, first_seen_at, "
        "last_seen_at, updated_at) VALUES (?, NULL, ?, ?, 100, ?, 'downloads', 'present', ?, ?, ?)",
        (path, name, ext, NOW, NOW, NOW, NOW),
    )
    if analysis is not None:
        values = dict({"file_id": file_id}, **analysis)
        columns = ", ".join(values)
        marks = ", ".join("?" for _ in values)
        db.execute(f"INSERT INTO analysis ({columns}) VALUES ({marks})", tuple(values.values()))
    return path, file_id


CLEAN_TEXT = {"status": "done", "kind": "text", "text_excerpt": "会議室の予約について", "sensitivity": "not_sensitive"}


# ---------------------------------------------------------------------- 判定（evaluate_items）


def test_sensitive_by_name_without_any_analysis(db, env, tmp_path):
    path = str(tmp_path / "社外秘_計画.docx")
    # 索引にない（解析もしていない）ファイルでも、DB が使えないときでも、名前の規則で機密と分かる
    for conn in (db, None):
        result = hazard.evaluate_items(conn, [path], env, rules)
        assert result["level"] == "sensitive"
        assert result["items"] == [{"path": path, "name": "社外秘_計画.docx", "level": "sensitive",
                                    "reasons": ["名前に「社外秘」"], "file_id": None}]
        assert result["message"] == "機密のファイルを含むドラッグです（1件）。送り先を確かめてください（pip0 は送信を止めません）"


def test_sensitive_by_name_even_while_analysis_is_pending(db, env):
    path, file_id = add_file(db, env, "Confidential_report.pdf", analysis={"status": "pending"})
    item = hazard.evaluate_items(db, [path], env, rules)["items"][0]
    assert item["level"] == "sensitive" and item["file_id"] == file_id
    assert item["reasons"] == ["名前に「confidential」"]


def test_sensitive_by_folder(db, env, tmp_path):
    secret_dir = tmp_path / "人事"
    secret_dir.mkdir()
    config = dict(env, SENSITIVE_DIRS=[secret_dir])
    path, _ = add_file(db, env, "a.txt", analysis=CLEAN_TEXT, folder=secret_dir)
    item = hazard.evaluate_items(db, [path], config, rules)["items"][0]
    assert item["level"] == "sensitive"
    assert item["reasons"] == ["機密として登録したフォルダー（SENSITIVE_DIRS）の中"]


def test_sensitive_by_analysed_content(db, env):
    path, _ = add_file(db, env, "memo.txt", analysis={"status": "done", "kind": "text",
                                                      "text_excerpt": "取扱注意：来期の計画"})
    item = hazard.evaluate_items(db, [path], env, rules)["items"][0]
    assert item["level"] == "sensitive" and item["reasons"] == ["本文に「取扱注意」"]


def test_unanalysed_file_is_unknown_and_warned_in_orange(db, env):
    path, _ = add_file(db, env, "IMG_0001.png", analysis={"status": "pending"})
    result = hazard.evaluate_items(db, [path], env, rules)
    assert result["level"] == "unknown"
    assert result["items"][0]["level"] == "unknown"
    assert result["items"][0]["reasons"] == [
        "未解析のため、中身で判定できません（電源接続中かつ3分間無操作のときに解析します）"]
    assert result["message"].startswith("機密か未判定のファイルを含むドラッグです（未判定 1件）")


def test_unknown_is_not_warned_when_warn_unanalysed_is_off(db, env):
    path, _ = add_file(db, env, "IMG_0001.png", analysis={"status": "pending"})
    result = hazard.evaluate_items(db, [path], dict(env, WARN_UNANALYSED=False), rules)
    assert result["items"][0]["level"] == "unknown"  # 判定は未判定のまま（非機密とはしない）
    assert result["level"] == "none"


def test_analysed_clean_file_gives_no_warning(db, env):
    path, _ = add_file(db, env, "会議室.txt", analysis=CLEAN_TEXT)
    result = hazard.evaluate_items(db, [path], env, rules)
    assert result["level"] == "none"
    assert result["items"][0]["level"] == "not_sensitive"
    assert result["message"] == "機密・未判定のファイルはありません"


def test_analysed_image_is_still_unknown(db, env):
    # 画像の中の文字は読まないので、解析済みでも「非機密」にはしない（sensitivity.py の決まり）
    path, _ = add_file(db, env, "IMG_0002.png", analysis={"status": "done", "kind": "image"})
    item = hazard.evaluate_items(db, [path], env, rules)["items"][0]
    assert item["level"] == "unknown"
    assert item["reasons"] == ["対象外の形式（画像の中の文字は読み取らない）のため、中身で判定できません"]


def test_files_outside_the_index_and_folders_are_unknown(db, env, tmp_path):
    folder = tmp_path / "共有"
    folder.mkdir()
    outside = str(tmp_path / "notes.txt")
    result = hazard.evaluate_items(db, [outside, str(folder)], env, rules)
    assert [item["level"] for item in result["items"]] == ["unknown", "unknown"]
    assert result["items"][0]["reasons"] == [hazard.NOT_INDEXED_REASON]
    assert result["items"][1]["reasons"] == [hazard.FOLDER_REASON]
    assert result["items"][1]["name"] == "共有"


def test_sensitive_wins_over_unknown_and_counts_only_sensitive_items(db, env, tmp_path):
    clean, _ = add_file(db, env, "a.txt", analysis=CLEAN_TEXT)
    pending, _ = add_file(db, env, "b.txt", analysis={"status": "pending"})
    secret = str(tmp_path / "極秘メモ.txt")
    result = hazard.evaluate_items(db, [clean, pending, secret], env, rules)
    assert result["level"] == "sensitive"
    assert [item["level"] for item in result["items"]] == ["not_sensitive", "unknown", "sensitive"]
    assert "（1件）" in result["message"]
    assert hazard.evaluate_items(db, [], env, rules) == {
        "level": "none", "items": [], "message": "機密・未判定のファイルはありません"}


def test_previous_sensitive_content_is_kept_until_reanalysed(db, env):
    # 機密の本文だったファイルが変更され、解析し直し待ち（pending）。前回の本文が残っているので、機密のまま警告する
    path, _ = add_file(db, env, "plan.txt", analysis={
        "status": "pending", "kind": "text", "text_excerpt": "社外秘：来期の計画", "sensitivity": "sensitive",
        "sensitivity_reasons_json": json.dumps(["本文に「社外秘」"], ensure_ascii=False)})
    item = hazard.evaluate_items(db, [path], env, rules)["items"][0]
    assert item["level"] == "sensitive"
    assert item["reasons"] == ["本文に「社外秘」", hazard.STALE_SENSITIVE_NOTE]


def test_old_name_reasons_are_not_reused_after_a_rename(db, env):
    # 「社外秘_a.txt」から「a.txt」に名前を変えた。中身は解析済みで、機密の語はない → 古い名前の理由は使わない
    path, _ = add_file(db, env, "a.txt", analysis=dict(CLEAN_TEXT, sensitivity="sensitive",
                                                      sensitivity_reasons_json='["名前に「社外秘」"]'))
    item = hazard.evaluate_items(db, [path], env, rules)["items"][0]
    assert item["level"] == "not_sensitive"


def test_evaluation_only_reads_the_database(db, env, tmp_path):
    path, _ = add_file(db, env, "a.txt", analysis=CLEAN_TEXT)
    before = db.total_changes
    hazard.evaluate_items(db, [path, str(tmp_path / "社外秘.txt")], env, rules)
    assert db.total_changes == before


# ---------------------------------------------------------------------- 警告の表示と消音（HazardSession）


SECRET_A = "/demo/社外秘_A.docx"
SECRET_B = "/demo/社外秘_B.docx"
PENDING_C = "/demo/IMG_0003.png"


def evaluation(env, paths):
    """DB を使わない判定（名前の規則だけ）。索引にないファイルは未判定"""
    return hazard.evaluate_items(None, paths, env, rules)


def keys(paths):
    return [f"7:{index}" for index, _ in enumerate(paths, start=100)]  # platform.get_file_key の形


def start(session, env, paths, drag_id="d1", source="explorer.exe", now=NOW, file_keys=None):
    return session.start_drag(drag_id, evaluation(env, paths), file_keys or keys(paths), source, now)


def continue_to(session, env, paths, target, drag_id, now, file_keys=None):
    """ドラッグを始めて、target の上で0.8秒後に離す（続行）。end_drag の結果を返す"""
    start(session, env, paths, drag_id=drag_id, now=now, file_keys=file_keys)
    session.target_changed(drag_id, target, now + 0.3)
    return session.end_drag(drag_id, target, True, now + 0.8)


def test_warning_is_shown_when_the_drag_starts(env):
    session = hazard.HazardSession(env)
    actions = start(session, env, [SECRET_A, PENDING_C])
    assert actions == [{"do": "show", "hazard": {
        "level": "sensitive",
        "message": "機密のファイルを含むドラッグです（1件）。送り先を確かめてください（pip0 は送信を止めません）",
        "items": [{"name": "社外秘_A.docx", "level": "sensitive", "reasons": ["名前に「社外秘」"]},
                  {"name": "IMG_0003.png", "level": "unknown", "reasons": [hazard.NOT_INDEXED_REASON]}]}}]
    # 送り先が変わっても、同じ内容なら送り直さない
    assert session.target_changed("d1", "slack.exe", NOW + 0.2) == []


def test_unknown_only_drag_shows_the_orange_warning(env):
    session = hazard.HazardSession(env)
    actions = start(session, env, [PENDING_C])
    assert actions[0]["hazard"]["level"] == "unknown"
    assert actions[0]["hazard"]["message"].startswith("機密か未判定のファイルを含むドラッグです")


def test_clean_drag_shows_nothing(env, db):
    path, _ = add_file(db, env, "a.txt", analysis=CLEAN_TEXT)
    session = hazard.HazardSession(env)
    assert session.start_drag("d1", hazard.evaluate_items(db, [path], env, rules), ["7:1"], "explorer.exe", NOW) == []
    assert session.target_changed("d1", "slack.exe", NOW + 0.5) == []
    assert session.end_drag("d1", "slack.exe", True, NOW + 1) == {"actions": [], "muted": [], "continued": False}


def test_continuing_after_the_warning_mutes_only_that_file_and_that_app(env):
    session = hazard.HazardSession(env)
    result = continue_to(session, env, [SECRET_A], "Slack.exe", "d1", NOW)
    assert result == {"actions": [{"do": "hide"}], "muted": [("7:100", "slack.exe")], "continued": True}
    assert session.muted_pairs() == [("7:100", "slack.exe")]

    # 同じファイルを、同じアプリへ：開始時は出さず、Slack の上でも出さない
    assert start(session, env, [SECRET_A], drag_id="d2", now=NOW + 10) == []
    assert session.target_changed("d2", "slack.exe", NOW + 10.3) == []
    assert session.end_drag("d2", "slack.exe", True, NOW + 11) == {"actions": [], "muted": [], "continued": False}

    # 同じファイルを、別のアプリへ：そのアプリの上に来たら警告する
    assert start(session, env, [SECRET_A], drag_id="d3", now=NOW + 20) == []
    actions = session.target_changed("d3", "outlook.exe", NOW + 20.3)
    assert [action["do"] for action in actions] == ["show"]
    # 消音中のアプリの上に戻ると隠す
    assert session.target_changed("d3", "slack.exe", NOW + 20.6) == [{"do": "hide"}]
    session.end_drag("d3", "slack.exe", True, NOW + 21)

    # 別のファイルを、同じアプリへ：開始時から警告する
    actions = start(session, env, [SECRET_B], drag_id="d4", now=NOW + 30, file_keys=["7:200"])
    assert [action["do"] for action in actions] == ["show"]
    session.end_drag("d4", "explorer.exe", False, NOW + 30.2)
    assert session.muted_pairs() == [("7:100", "slack.exe")]


def test_partly_muted_drag_warns_only_about_the_files_not_muted_for_the_target(env):
    session = hazard.HazardSession(env)
    continue_to(session, env, [SECRET_A], "slack.exe", "d1", NOW, file_keys=["7:1"])
    actions = start(session, env, [SECRET_A, SECRET_B], drag_id="d2", now=NOW + 5, file_keys=["7:1", "7:2"])
    assert [item["name"] for item in actions[0]["hazard"]["items"]] == ["社外秘_A.docx", "社外秘_B.docx"]
    actions = session.target_changed("d2", "slack.exe", NOW + 5.3)
    assert [item["name"] for item in actions[0]["hazard"]["items"]] == ["社外秘_B.docx"]
    assert actions[0]["hazard"]["message"].startswith("機密のファイルを含むドラッグです（1件）")
    result = session.end_drag("d2", "slack.exe", True, NOW + 6)
    assert result["continued"] is True and result["muted"] == [("7:2", "slack.exe")]
    assert session.muted_pairs() == [("7:1", "slack.exe"), ("7:2", "slack.exe")]


def test_warning_must_be_visible_for_half_a_second_to_count_as_continued(env):
    session = hazard.HazardSession(env)
    start(session, env, [SECRET_A], drag_id="quick", now=NOW)
    quick = session.end_drag("quick", "slack.exe", True, NOW + 0.49)
    assert quick == {"actions": [{"do": "hide"}], "muted": [], "continued": False}
    start(session, env, [SECRET_A], drag_id="slow", now=NOW + 5)
    slow = session.end_drag("slow", "slack.exe", True, NOW + 5.5)
    assert slow["continued"] is True


def test_visible_time_counts_from_when_the_warning_was_shown_again(env):
    session = hazard.HazardSession(env)
    continue_to(session, env, [SECRET_A], "slack.exe", "d1", NOW, file_keys=["7:1"])
    start(session, env, [SECRET_A], drag_id="d2", now=NOW + 10, file_keys=["7:1"])  # 消音中なので出さない
    session.target_changed("d2", "outlook.exe", NOW + 12.0)                        # ここで出す
    result = session.end_drag("d2", "outlook.exe", True, NOW + 12.3)                # 出してから0.3秒
    assert result["continued"] is False and result["actions"] == [{"do": "hide"}]


def test_drops_that_do_not_count_as_continuing(env):
    session = hazard.HazardSession(env)
    cases = [
        ("explorer.exe", True),    # ドラッグ元と同じアプリ（フォルダーの間の移動など）
        ("Pip0Shell.exe", True),   # pip0 自身（デスクなど）
        ("slack.exe", False),      # 別のアプリの上で離されたと確かめられない（シェルの知らせに reason があるとき）
        (None, False),             # 離した場所が分からない
    ]
    for number, (target, dropped_on_other) in enumerate(cases):
        drag_id = f"d{number}"
        start(session, env, [SECRET_A], drag_id=drag_id, now=NOW + number * 10)
        result = session.end_drag(drag_id, target, dropped_on_other, NOW + number * 10 + 2)
        assert result["continued"] is False, target
        assert result["muted"] == []
    assert session.muted_pairs() == []


def test_end_session_clears_the_mutes_and_hides_the_warning(env):
    session = hazard.HazardSession(env)
    continue_to(session, env, [SECRET_A], "slack.exe", "d1", NOW)
    assert session.muted_pairs() != []
    start(session, env, [SECRET_B], drag_id="d2", now=NOW + 5, file_keys=["7:9"])
    assert session.end_session("lock") == [{"do": "hide"}]
    assert session.muted_pairs() == []
    assert session.end_drag("d2", "slack.exe", True, NOW + 6)["continued"] is False  # ドラッグも忘れた
    # 新しいセッションでは、前に消音した組でも警告する
    assert [action["do"] for action in start(session, env, [SECRET_A], drag_id="d3", now=NOW + 60)] == ["show"]


@pytest.mark.parametrize("reason", hazard.SESSION_END_REASONS + hazard.SESSION_START_REASONS)
def test_every_session_boundary_clears_the_mutes(env, reason):
    session = hazard.HazardSession(env)
    continue_to(session, env, [SECRET_A], "slack.exe", "d1", NOW)
    assert session.end_session(reason) == []
    assert session.muted_pairs() == []


def test_unknown_session_event_is_a_programming_error(env):
    with pytest.raises(ValueError):
        hazard.HazardSession(env).end_session("coffee_break")


def test_file_without_a_key_is_muted_by_its_path(env):
    session = hazard.HazardSession(env)
    result = continue_to(session, env, [SECRET_A], "slack.exe", "d1", NOW, file_keys=[None])
    key = hazard.mute_key(None, SECRET_A)
    assert key.startswith("path:") and key == hazard.mute_key(None, SECRET_A.upper())  # 大文字・小文字は区別しない
    assert result["muted"] == [(key, "slack.exe")]
    assert start(session, env, [SECRET_A], drag_id="d2", now=NOW + 5, file_keys=[None]) == []


def test_new_drag_hides_a_warning_left_by_a_lost_drag_end(env):
    session = hazard.HazardSession(env)
    start(session, env, [SECRET_A], drag_id="lost", now=NOW)
    actions = start(session, env, [SECRET_B], drag_id="next", now=NOW + 3)
    assert [action["do"] for action in actions] == ["hide", "show"]
    assert session.end_drag("lost", "slack.exe", True, NOW + 4)["continued"] is False  # 古いドラッグの知らせは無視


def test_file_keys_must_match_the_items(env):
    with pytest.raises(ValueError):
        hazard.HazardSession(env).start_drag("d1", evaluation(env, [SECRET_A]), [], "explorer.exe", NOW)


def test_mutes_live_only_in_memory(env, db):
    first = hazard.HazardSession(env)
    continue_to(first, env, [SECRET_A], "slack.exe", "d1", NOW)
    assert hazard.HazardSession(env).muted_pairs() == []  # 消音はメモリーの中だけ（DB にもファイルにも書かない）
    assert database.query_one(db, "SELECT count(*) AS n FROM operations")["n"] == 0


def test_file_names_are_not_logged(env, caplog):
    session = hazard.HazardSession(env)
    with caplog.at_level(logging.DEBUG):
        continue_to(session, env, [SECRET_A], "slack.exe", "d1", NOW)
        session.end_session("pip0_exit")
    messages = " ".join(record.getMessage() for record in caplog.records)
    assert "社外秘" not in messages and "slack" not in messages.lower()
    assert "1 組" in messages  # 件数だけを書く
