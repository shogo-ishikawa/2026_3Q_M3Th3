"""M1 流入処理（inflow.py）のテスト

- score_rules：仕分けの点数と、その根拠の文
- MiniDock：3秒のミニドックの決まり（時刻は引数で決めるので、待たずに確かめられる）
- build_proposal → execute_proposal → apply_deferred_renames：一時フォルダー（tmp_path）の中のダミーファイルと、
  代役の OS 連携（FakePlatform）、メモリーの鍵の暗号化DB で、通して確かめる
作業文脈（context.parse_foreground の辞書）は、テストの中で手で作ります。
"""

import json
import logging
import os
import time
import zipfile

import pytest
from pypdf import PdfWriter

from pip0 import analysis_queue, database, inflow, killswitch, provenance, rules, timeutil, watcher

NOW = 1_793_235_600.0     # 2026-10-29 10:00（日本時間）
ENDED_AT = NOW - 4.0      # ブラウザー拡張が記録した、ダウンロードの終了時刻
OLD_MTIME = 1_793_230_000

# 作業中のアプリ：Slack のチャンネル「2026年度予算WG」（ワークスペース「研究室」）
SLACK_TITLE = "2026年度予算WG (チャンネル) - 研究室 - Slack"
SLACK_CONTEXT = {
    "app": "Slack", "category": "chat", "process": "slack.exe", "window_title": SLACK_TITLE,
    "page_title": None, "conversation": "2026年度予算WG", "conversation_kind": "channel",
    "workspace": "研究室", "partner_status": "ok", "partner_reason": "", "keywords": ["2026年度予算WG"],
    "is_file_dialog": False, "dialog_hwnd": None, "at": NOW,
}
# ダウンロードを始めたときに前面だったタブ（送信元には使わない）
TAB_TITLE = "2026年度予算WG (チャンネル) - 研究室 - Slack"
PLAIN_TAB_TITLE = "ホーム - 研究室 - Slack"  # 規則の語を含まないページ題名
SLACK_URL = "https://files.slack.com/files-pri/T0-F0/download.pdf"


# ---------------------------------------------------------------------- 準備


@pytest.fixture
def config(env):
    # テストでは、遅い PC でも文書のタイトルを読み切れるよう、待つ時間を長くする（本番は 0.3 秒）
    env["LIGHT_METADATA_BUDGET_SECONDS"] = 10.0
    return env


@pytest.fixture
def registry():
    return watcher.SelfChangeRegistry()


def make_pdf(path, title=None):
    """タイトル（文書情報）付きの小さな PDF を作る"""
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    if title is not None:
        writer.add_metadata({"/Title": title})
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        writer.write(f)
    os.utime(path, (OLD_MTIME, OLD_MTIME))
    return path


def make_docx(path, title, paragraphs=("2026年度 予算案", "部門別の内訳")):
    """タイトル（docProps/core.xml）付きの小さな Word 文書を作る"""
    body = "".join(f"<w:p><w:r><w:t>{text}</w:t></w:r></w:p>" for text in paragraphs)
    document = ('<?xml version="1.0" encoding="UTF-8"?><w:document '
                'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                f"<w:body>{body}</w:body></w:document>")
    core = ('<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties '
            'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
            f'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>{title}</dc:title></cp:coreProperties>')
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types/>')
        archive.writestr("word/document.xml", document.encode("utf-8"))
        archive.writestr("docProps/core.xml", core.encode("utf-8"))
    os.utime(path, (OLD_MTIME, OLD_MTIME))
    return path


def make_file(path, data=b"pip0 inflow test"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    os.utime(path, (OLD_MTIME, OLD_MTIME))
    return path


def store_event(db, path, url=SLACK_URL, referrer="https://app.slack.com/", tab_url="https://app.slack.com/client/T0/C0",
                tab_title=TAB_TITLE, size=None, ended_at=ENDED_AT):
    """ブラウザー拡張の記録（受け口が検査した形）を保存し、download_events の行を返す"""
    message = {
        "type": "download_completed", "browser": "chrome",
        "download": {"id": 42, "filename": str(path), "url": url, "final_url": url, "referrer_url": referrer,
                     "mime": "application/pdf", "started_at": ENDED_AT - 3.0, "ended_at": ended_at,
                     "file_size": size, "danger": "safe"},
        "page": {"tab_url": tab_url, "tab_title": tab_title, "captured_at": ENDED_AT - 3.0},
    }
    event_id = provenance.store_download_event(db, message, "chrome-extension://pip0-test/", NOW - 1.0)
    return database.query_one(db, "SELECT * FROM download_events WHERE id = ?", (event_id,))


def inflow_row(db, proposal_id):
    return database.query_one(db, "SELECT * FROM inflow WHERE id = ?", (proposal_id,))


def operations(db):
    return database.query_all(db, "SELECT * FROM operations ORDER BY id")


def execute(db, platform, config, proposal, decision, registry=None, now=NOW + 3.0, alternative_index=None):
    return inflow.execute_proposal(db, platform, proposal, decision, config, rules, registry, now,
                                   alternative_index=alternative_index)


def build(db, platform, config, path, event=None, context=SLACK_CONTEXT, now=NOW):
    return inflow.build_proposal(db, platform, path, event, context, config, rules, now)


def slack_pdf(db, config, name="download (3).pdf", title="2026年度 予算案"):
    """Slack からダウンロードした、タイトル付きの PDF と、その拡張機能の記録"""
    path = make_pdf(config["DOWNLOADS_DIR"] / name, title)
    event = store_event(db, path, size=path.stat().st_size)
    return path, event


def add_analysis(db, file_id, **values):
    """解析が終わったことにする（analysis テーブルの行を手で書く）"""
    columns = {"status": "done", "kind": None, "title": None, "colours_json": None, "colourful_ratio": None,
               "chart_score": None, "visual_kind": None, "analysed_at": NOW + 3600}
    columns.update(values)
    names = ", ".join(columns)
    marks = ", ".join("?" for _ in columns)
    updates = ", ".join(f"{name} = excluded.{name}" for name in columns)
    db.execute(f"INSERT INTO analysis (file_id, {names}) VALUES (?, {marks}) "
               f"ON CONFLICT(file_id) DO UPDATE SET {updates}", [file_id] + list(columns.values()))


# ---------------------------------------------------------------------- 仕分けの点数


def test_keywords_count_once_even_in_several_places():
    texts = {"name": "予算_download.pdf", "title": "2026年度 予算案", "page_title": "予算 - ポータル"}
    [best] = [item for item in inflow.score_rules(texts, None, ".pdf", rules) if item["rule"] == "予算・会計"]
    assert best["score"] == 2 + 1
    assert best["reasons"] == [
        "ファイル名・文書のタイトル・ダウンロード開始時のページ題名に「予算」（+2）",
        "拡張子が .pdf（+1）",
    ]


def test_context_points_name_only_the_app_and_the_keyword():
    texts = {"name": "download.pdf", "title": None, "page_title": None}
    ranked = inflow.score_rules(texts, SLACK_CONTEXT, ".pdf", rules)
    assert ranked[0]["rule"] == "予算・会計"
    assert ranked[0]["score"] == 3
    assert ranked[0]["reasons"] == ["作業中のアプリ（Slack）の会話名に「予算」（+2）", "拡張子が .pdf（+1）"]
    for item in ranked:
        for reason in item["reasons"]:
            assert "2026年度予算WG" not in reason
            assert "研究室" not in reason


def test_context_page_titles_and_window_title_words():
    texts = {"name": "file.docx", "title": None, "page_title": None}
    browser = {"app": "Chrome", "category": "browser", "page_title": "第3回 授業 資料", "conversation": None,
               "keywords": []}
    ranked = inflow.score_rules(texts, browser, ".docx", rules)
    assert ranked[0]["rule"] == "授業・レポート"
    assert "作業中のアプリ（Chrome）のページ題名に「授業」（+2）" in ranked[0]["reasons"]
    word = {"app": "Word", "category": "document", "page_title": None, "conversation": None,
            "keywords": ["定例会議メモ"]}
    ranked = inflow.score_rules(texts, word, ".docx", rules)
    assert ranked[0]["rule"] == "会議・議事録"
    assert "作業中のアプリ（Word）のウィンドウタイトルの語に「会議」（+2）" in ranked[0]["reasons"]


def test_extension_case_width_and_ties():
    texts = {"name": "ＢＵＤＧＥＴ_2026.XLSX", "title": None, "page_title": None}
    ranked = inflow.score_rules(texts, None, ".XLSX", rules)
    assert (ranked[0]["rule"], ranked[0]["score"]) == ("予算・会計", 3)
    assert "拡張子が .xlsx（+1）" in ranked[0]["reasons"]
    # 同じ点数なら rules.SORT_RULES の順（.pdf は3つの規則に +1）
    ranked = inflow.score_rules({"name": "x.pdf"}, None, ".pdf", rules)
    assert [item["rule"] for item in ranked[:3]] == ["予算・会計", "授業・レポート", "会議・議事録"]
    assert all(item["score"] == 1 for item in ranked[:3])
    assert ranked[3] == {"rule": "画像・図", "folder": "画像・図", "score": 0, "reasons": []}


def test_context_labels_for_the_dock():
    assert inflow.make_context_label(None) is None
    assert inflow.make_context_label(SLACK_CONTEXT) == "作業中：Slack（2026年度予算WG）"
    # Slack のタイトルから会話名を読めなかったときは、推測せずに「取得不可」
    unknown_partner = dict(SLACK_CONTEXT, conversation=None, keywords=[])
    assert inflow.make_context_label(unknown_partner) == "作業中：Slack（チャット相手：取得不可）"
    browser = {"app": "Edge", "category": "browser", "page_title": "とても長いページの題名" * 5, "conversation": None}
    label = inflow.make_context_label(browser)
    assert label.startswith("作業中：Edge（とても長い") and label.endswith("…）")
    assert inflow.make_context_label({"app": None, "process": "foo.exe", "category": "other"}) == "作業中：foo.exe"


# ---------------------------------------------------------------------- ミニドック（時刻は手で進める）


def dock_proposal(proposal_id, status="proposed", alternatives=0):
    """ミニドックに渡す提案（ミニドックが使う項目だけ）"""
    return {
        "proposal_id": proposal_id, "status": status, "file_name": f"download ({proposal_id}).pdf",
        "path": f"/tmp/pip0-test/Downloads/download ({proposal_id}).pdf",
        "destination": {"rule": "予算・会計"} if status != "no_candidate" else None,
        "name": {"new_name": f"2026-10-29_予算案{proposal_id}_Slack.pdf" if status == "proposed" else None},
        "alternatives": [{"index": i, "rule": f"候補{i}"} for i in range(alternatives)],
        "reasons": ["仕分け先「予算・会計」：5点（2点以上で提案）"],
        "context_label": "作業中：Slack（予算）",
    }


def kinds(actions):
    return [action["do"] for action in actions]


def executed(actions):
    return [(a["proposal_id"], a["decision"], a["alternative_index"]) for a in actions if a["do"] == "execute"]


def shown_ids(actions):
    """最後の show の、表示中の提案（行の名前から番号を取り出す）"""
    shows = [a for a in actions if a["do"] == "show"]
    return [row["file_name"] for row in shows[-1]["dock"]["rows"]]


def test_single_download_executes_after_exactly_three_seconds(config):
    dock = inflow.MiniDock(config)
    actions = dock.add(dock_proposal(1), NOW)
    assert kinds(actions) == ["show"]
    shown = actions[0]["dock"]
    assert shown["dock_id"] == dock.dock_id
    [row] = shown["rows"]
    assert set(row) == {"entry_id", "file_name", "status", "dest_label", "new_name", "reasons", "alternatives",
                        "context_label", "remaining_seconds"}
    assert row["remaining_seconds"] == 3.0
    assert row["status"] == "proposed"
    assert row["dest_label"] == "予算・会計"
    assert row["context_label"] == "作業中：Slack（予算）"
    assert dock.tick(NOW + 1.0) == []
    assert dock.tick(NOW + 2.9) == []
    actions = dock.tick(NOW + 3.0)
    assert actions == [
        {"do": "execute", "proposal_id": 1, "decision": "auto", "alternative_index": None},
        {"do": "close", "dock_id": shown["dock_id"], "reason": "empty"},
    ]
    assert dock.tick(NOW + 10.0) == []


def test_five_downloads_show_three_rows_and_queue_the_rest(config):
    dock = inflow.MiniDock(config)
    for proposal_id in range(1, 6):
        actions = dock.add(dock_proposal(proposal_id), NOW + proposal_id * 0.1)
        if proposal_id <= 3:
            assert kinds(actions) == ["show"]
            assert len(actions[0]["dock"]["rows"]) == proposal_id
        else:
            assert actions == []  # 行に空きがないので順番待ち。表示は変わらない
    assert len(dock.rows) == 3 and len(dock.waiting) == 2

    # 行ごとに3秒を数える：1行目は 3.1 秒、2行目は 3.2 秒に時間が尽きる
    actions = dock.tick(NOW + 3.1)
    assert executed(actions) == [(1, "auto", None)]
    assert shown_ids(actions) == ["download (2).pdf", "download (3).pdf", "download (4).pdf"]
    rows = actions[-1]["dock"]["rows"]
    assert rows[2]["remaining_seconds"] == 3.0  # 順番待ちだった行は、表示されてから3秒
    actions = dock.tick(NOW + 3.3)
    assert executed(actions) == [(2, "auto", None), (3, "auto", None)]
    assert shown_ids(actions) == ["download (4).pdf", "download (5).pdf"]
    assert dock.tick(NOW + 6.0) == []
    assert executed(dock.tick(NOW + 6.1)) == [(4, "auto", None)]
    actions = dock.tick(NOW + 6.3)
    assert executed(actions) == [(5, "auto", None)]
    assert kinds(actions) == ["execute", "close"]


def test_pointer_over_the_dock_pauses_all_rows_beyond_ten_seconds(config):
    dock = inflow.MiniDock(config)
    dock.add(dock_proposal(1), NOW)
    dock.add(dock_proposal(2), NOW + 0.5)
    assert dock.interaction(dock.dock_id, "enter", NOW + 1.0) == []
    assert dock.tick(NOW + 5.0) == []
    assert dock.tick(NOW + 15.0) == []  # 10秒以上たっても、マウスが上にある間は実行しない
    actions = dock.interaction(dock.dock_id, "leave", NOW + 15.0)
    assert kinds(actions) == ["show"]
    assert [row["remaining_seconds"] for row in actions[0]["dock"]["rows"]] == [2.0, 2.5]
    assert dock.tick(NOW + 16.9) == []
    assert executed(dock.tick(NOW + 17.0)) == [(1, "auto", None)]
    assert executed(dock.tick(NOW + 17.5)) == [(2, "auto", None)]


def test_leaving_gives_short_rows_a_grace_second(config):
    dock = inflow.MiniDock(config)
    dock.add(dock_proposal(1), NOW)
    dock.interaction(dock.dock_id, "enter", NOW + 2.5)  # 残り 0.5 秒で止まる
    actions = dock.interaction(dock.dock_id, "leave", NOW + 20.0)
    assert actions[0]["dock"]["rows"][0]["remaining_seconds"] == 1.0  # 1秒未満は1秒にしてから数え直す
    assert dock.tick(NOW + 20.9) == []
    assert executed(dock.tick(NOW + 21.0)) == [(1, "auto", None)]


def test_rows_added_or_promoted_while_the_pointer_is_over_the_dock_wait_too(config):
    config["MINI_DOCK_MAX_ROWS"] = 1
    dock = inflow.MiniDock(config)
    dock.add(dock_proposal(1, alternatives=1), NOW)
    dock.add(dock_proposal(2), NOW + 0.1)  # 順番待ち
    dock.interaction(dock.dock_id, "enter", NOW + 1.0)
    actions = dock.user_action(dock.dock_id, dock.rows[0]["entry_id"], "accept", NOW + 2.0)
    assert executed(actions) == [(1, "user_accept", None)]
    assert shown_ids(actions) == ["download (2).pdf"]
    assert actions[-1]["dock"]["rows"][0]["remaining_seconds"] == 3.0
    assert dock.tick(NOW + 30.0) == []  # まだマウスが上にある
    dock.interaction(dock.dock_id, "leave", NOW + 30.0)
    assert dock.tick(NOW + 32.9) == []
    assert executed(dock.tick(NOW + 33.0)) == [(2, "auto", None)]


def test_buttons_execute_at_once_and_open_keeps_the_row(config):
    dock = inflow.MiniDock(config)
    for proposal_id in (1, 2, 3):
        dock.add(dock_proposal(proposal_id, alternatives=2), NOW)
    dock.add(dock_proposal(4), NOW)
    dock_id = dock.dock_id
    entries = [row["entry_id"] for row in dock.rows]

    actions = dock.user_action(dock_id, entries[0], "open", NOW + 0.5)
    assert actions == [{"do": "open", "proposal_id": 1, "path": "/tmp/pip0-test/Downloads/download (1).pdf"}]
    assert len(dock.rows) == 3

    actions = dock.user_action(dock_id, entries[0], "accept", NOW + 1.0)
    assert executed(actions) == [(1, "user_accept", None)]
    assert shown_ids(actions) == ["download (2).pdf", "download (3).pdf", "download (4).pdf"]

    # 正しくない番号の「ほかの仕分け先」は無視する（行は残る）
    assert dock.user_action(dock_id, entries[1], "alternative", NOW + 1.1, alternative_index=5) == []
    assert dock.user_action(dock_id, entries[1], "alternative", NOW + 1.1, alternative_index=None) == []
    actions = dock.user_action(dock_id, entries[1], "alternative", NOW + 1.2, alternative_index=1)
    assert executed(actions) == [(2, "user_alternative", 1)]

    actions = dock.user_action(dock_id, entries[2], "keep", NOW + 1.3)
    assert executed(actions) == [(3, "user_keep", None)]
    assert shown_ids(actions) == ["download (4).pdf"]

    # 知らない操作と、もうない行への操作は無視する
    assert dock.user_action(dock_id, entries[2], "keep", NOW + 1.4) == []
    assert dock.user_action(dock_id, dock.rows[0]["entry_id"], "delete", NOW + 1.4) == []
    assert executed(dock.tick(NOW + 4.0)) == [(4, "auto", None)]


def test_no_candidate_rows_close_without_executing_and_needs_analysis_rows_execute(config):
    dock = inflow.MiniDock(config)
    dock.add(dock_proposal(1, status="no_candidate"), NOW)
    dock.add(dock_proposal(2, status="needs_analysis"), NOW)
    row = dock.payload(NOW)["rows"][0]
    assert (row["status"], row["dest_label"], row["new_name"]) == ("no_candidate", None, None)
    actions = dock.tick(NOW + 3.0)
    assert executed(actions) == [(2, "auto", None)]
    assert kinds(actions) == ["execute", "close"]


def test_old_dock_messages_are_ignored_and_a_new_dock_gets_a_new_id(config):
    dock = inflow.MiniDock(config)
    dock.add(dock_proposal(1), NOW)
    first_id = dock.dock_id
    entry_id = dock.rows[0]["entry_id"]
    dock.tick(NOW + 3.0)
    assert dock.dock_id is None and dock.payload(NOW + 3.0) is None
    assert dock.interaction(first_id, "enter", NOW + 3.1) == []
    assert dock.user_action(first_id, entry_id, "accept", NOW + 3.1) == []

    actions = dock.add(dock_proposal(2), NOW + 4.0)
    assert actions[0]["dock"]["dock_id"] != first_id
    assert dock.interaction(first_id, "enter", NOW + 4.1) == []  # 古い番号の知らせでは止まらない
    assert dock.interaction(dock.dock_id, "hover", NOW + 4.1) == []  # 知らない状態も無視する
    assert executed(dock.tick(NOW + 7.0)) == [(2, "auto", None)]


def test_at_least_one_row_is_shown_even_if_max_rows_is_zero(config):
    config["MINI_DOCK_MAX_ROWS"] = 0
    dock = inflow.MiniDock(config)
    assert kinds(dock.add(dock_proposal(1), NOW)) == ["show"]
    assert dock.add(dock_proposal(2), NOW) == []
    assert executed(dock.tick(NOW + 3.0)) == [(1, "auto", None)]
    assert executed(dock.tick(NOW + 6.0)) == [(2, "auto", None)]


def test_the_same_proposal_is_not_shown_twice(config):
    dock = inflow.MiniDock(config)
    dock.add(dock_proposal(1), NOW)
    assert dock.add(dock_proposal(1), NOW + 0.5) == []
    assert len(dock.rows) == 1 and dock.waiting == []


def test_a_row_whose_time_ran_out_before_the_pointer_came_is_executed(config):
    dock = inflow.MiniDock(config)
    dock.add(dock_proposal(1), NOW)
    dock.add(dock_proposal(2), NOW + 1.0)
    actions = dock.interaction(dock.dock_id, "enter", NOW + 3.2)
    assert executed(actions) == [(1, "auto", None)]
    assert shown_ids(actions) == ["download (2).pdf"]
    assert actions[-1]["dock"]["rows"][0]["remaining_seconds"] == 0.8


# ---------------------------------------------------------------------- 提案から実行まで（通しの確かめ）


def test_slack_pdf_is_sorted_and_renamed_when_the_dock_times_out(config, platform, db, registry):
    src, event = slack_pdf(db, config)
    data = src.read_bytes()
    mtime_ns = src.stat().st_mtime_ns
    day = timeutil.local_date_str(ENDED_AT)

    proposal = build(db, platform, config, src, event)
    assert proposal["status"] == "proposed"
    assert proposal["destination"]["rule"] == "予算・会計"
    assert proposal["destination"]["dest_dir"] == str(config["PIP0_ROOT"] / "予算・会計")
    assert proposal["destination"]["score"] == 5
    assert proposal["destination"]["reasons"] == [
        "文書のタイトル・ダウンロード開始時のページ題名に「予算」（+2）",
        "作業中のアプリ（Slack）の会話名に「予算」（+2）",
        "拡張子が .pdf（+1）",
    ]
    assert [(a["index"], a["rule"]) for a in proposal["alternatives"]] == [(0, "授業・レポート"), (1, "会議・議事録")]
    assert proposal["name"]["new_name"] == f"{day}_2026年度 予算案_Slack.pdf"
    assert proposal["source"] == {"label": "Slack", "kind": "browser_extension",
                                  "evidence": "ブラウザー拡張の記録：files.slack.com からのダウンロード"}
    assert proposal["context_label"] == "作業中：Slack（2026年度予算WG）"

    # 索引・由来・拡張機能の記録・提案の記録
    file_row = database.query_one(db, "SELECT * FROM files WHERE id = ?", (proposal["file_id"],))
    assert file_row["path"] == str(src) and file_row["location_kind"] == "downloads"
    assert provenance.get_provenance(db, proposal["file_id"])["source_label"] == "Slack"
    assert database.query_one(db, "SELECT state, matched_file_id FROM download_events WHERE id = ?",
                              (event["id"],)) == {"state": "matched", "matched_file_id": proposal["file_id"]}
    row = inflow_row(db, proposal["proposal_id"])
    assert (row["state"], row["path"], row["download_event_id"], row["detected_at"]) == (
        "proposed", str(src), event["id"], NOW)

    # ミニドック：3秒たったら自動で実行する
    dock = inflow.MiniDock(config)
    shown = dock.add(proposal, NOW)[0]["dock"]["rows"][0]
    assert shown["new_name"] == proposal["name"]["new_name"]
    assert shown["alternatives"] == [{"index": 0, "label": "授業・レポート"}, {"index": 1, "label": "会議・議事録"}]
    assert dock.tick(NOW + 2.9) == []
    [action, _close] = dock.tick(NOW + 3.0)
    loaded = inflow.load_proposal(db, action["proposal_id"])
    result = inflow.execute_proposal(db, platform, loaded, action["decision"], config, rules, registry, NOW + 3.0,
                                     alternative_index=action["alternative_index"])

    dst = config["PIP0_ROOT"] / "予算・会計" / f"{day}_2026年度 予算案_Slack.pdf"
    assert result == {"ok": True, "status": "done", "path": str(dst), "state": "executed", "reason": ""}
    assert not src.exists()
    assert dst.read_bytes() == data
    assert dst.stat().st_mtime_ns == mtime_ns  # 最終更新日時は変わらない

    [op] = operations(db)
    assert (op["kind"], op["actor"], op["status"]) == ("sort_rename", "auto", "done")
    assert (op["before_path"], op["after_path"], op["file_id"]) == (str(src), str(dst), proposal["file_id"])
    assert json.loads(op["reasons_json"]) == [
        "ミニドックの表示時間が過ぎたため、自動で実行しました",
        "仕分け先「予算・会計」：5点（2点以上で提案）",
        "文書のタイトル・ダウンロード開始時のページ題名に「予算」（+2）",
        "作業中のアプリ（Slack）の会話名に「予算」（+2）",
        "拡張子が .pdf（+1）",
        f"日付「{day}」：ダウンロード完了日（端末の現地時刻）",
        "日付の基準：ブラウザー拡張が記録したダウンロードの終了時刻",
        "内容「2026年度 予算案」：PDF の文書情報のタイトル",
        "送信元「Slack」：ブラウザー拡張の記録：files.slack.com からのダウンロード",
    ]
    row = inflow_row(db, proposal["proposal_id"])
    assert (row["state"], row["decision"], row["decided_at"], row["path"]) == ("executed", "auto", NOW + 3.0, str(dst))
    file_row = database.query_one(db, "SELECT * FROM files WHERE id = ?", (proposal["file_id"],))
    assert (file_row["path"], file_row["location_kind"]) == (str(dst), "pip0_root")
    # 監視（watcher）が、自分の移動の知らせを無視できる
    assert registry.is_expected(str(src), NOW + 3.5) and registry.is_expected(str(dst), NOW + 3.5)


def test_download_tracker_results_feed_build_proposal(config, platform, db):
    # 常駐処理と同じ順：監視の知らせ → 拡張機能の記録 → 完了の確認 → 提案
    tracker = watcher.DownloadTracker(config, rules, platform)
    src, event = slack_pdf(db, config)
    tracker.observe({"kind": "created", "path": str(src), "dest_path": None, "is_dir": False,
                     "location_kind": "downloads", "at": NOW}, NOW)
    assert tracker.add_browser_event(event, NOW)
    [ready] = tracker.ready(NOW + 0.1)
    assert ready["via"] == "browser_extension"
    proposal = build(db, platform, config, ready["path"], ready["download_event"], now=NOW + 0.1)
    assert proposal["download_event_id"] == event["id"]
    assert proposal["status"] == "proposed"
    assert proposal["completed_at"] == ENDED_AT  # 日付は拡張機能の終了時刻から
    assert proposal["name"]["new_name"] == f"{timeutil.local_date_str(ENDED_AT)}_2026年度 予算案_Slack.pdf"


def test_an_existing_name_gets_a_number_and_is_not_overwritten(config, platform, db, registry):
    src, event = slack_pdf(db, config)
    day = timeutil.local_date_str(ENDED_AT)
    existing = make_file(config["PIP0_ROOT"] / "予算・会計" / f"{day}_2026年度 予算案_Slack.pdf", b"older")
    proposal = build(db, platform, config, src, event)
    result = execute(db, platform, config, proposal, "auto", registry)
    dst = config["PIP0_ROOT"] / "予算・会計" / f"{day}_2026年度 予算案_Slack (2).pdf"
    assert result["ok"] and result["path"] == str(dst)
    assert existing.read_bytes() == b"older"
    assert dst.exists() and not src.exists()


def test_a_file_in_use_is_not_moved(config, platform, db, registry):
    src, event = slack_pdf(db, config)
    proposal = build(db, platform, config, src, event)
    platform.locked.add(str(src))  # 提案の後に、ほかのアプリが開いた
    result = execute(db, platform, config, proposal, "auto", registry)
    assert (result["ok"], result["status"], result["state"]) == (False, "skipped", "failed")
    assert "使用中" in result["reason"]
    assert src.exists()
    assert list((config["PIP0_ROOT"]).iterdir()) == []
    [op] = operations(db)
    assert (op["kind"], op["status"], op["after_path"]) == ("sort_rename", "skipped", None)
    assert "使用中" in op["detail"]
    assert inflow_row(db, proposal["proposal_id"])["state"] == "failed"


def test_kill_switch_stops_the_automatic_run_but_the_user_can_still_accept(config, platform, db, registry):
    src, event = slack_pdf(db, config)
    proposal = build(db, platform, config, src, event)
    killswitch.engage(db, config, "テスト")

    result = execute(db, platform, config, proposal, "auto", registry)
    assert (result["ok"], result["status"]) == (False, "skipped")
    assert "キルスイッチ" in result["reason"]
    assert src.exists()
    row = inflow_row(db, proposal["proposal_id"])
    assert (row["state"], row["decision"]) == ("proposed", "auto")  # 提案のまま残る
    skipped = [op for op in operations(db) if op["kind"] == "sort_rename"]
    assert [(op["actor"], op["status"]) for op in skipped] == [("auto", "skipped")]

    result = execute(db, platform, config, proposal, "user_accept", registry, now=NOW + 5.0)
    assert result["ok"] and result["status"] == "done"
    assert not src.exists() and os.path.exists(result["path"])
    done = [op for op in operations(db) if op["kind"] == "sort_rename" and op["status"] == "done"]
    assert [op["actor"] for op in done] == ["user"]
    assert json.loads(done[0]["reasons_json"])[0] == "ユーザーがミニドックで提案を承認しました"
    assert inflow_row(db, proposal["proposal_id"])["decision"] == "user_accept"


def test_the_dock_says_when_automatic_runs_are_stopped(config, platform, db):
    killswitch.engage(db, config, "テスト")
    src, event = slack_pdf(db, config)
    proposal = build(db, platform, config, src, event)
    assert proposal["reasons"][0] == "自動処理は停止中です（キルスイッチ）。時間が過ぎても実行しません（ボタンでは実行できます）"
    assert proposal["reasons"][1] == "仕分け先「予算・会計」：5点（2点以上で提案）"
    # 何もしない提案（候補なし）には書かない
    other = build(db, platform, config, make_file(config["DOWNLOADS_DIR"] / "旅行の計画.zip"), None, context=None)
    assert other["status"] == "no_candidate"
    assert not any("停止中" in reason for reason in other["reasons"])


def test_load_proposal_and_unknown_decisions(config, platform, db, registry):
    src, event = slack_pdf(db, config)
    proposal = build(db, platform, config, src, event)
    loaded = inflow.load_proposal(db, proposal["proposal_id"])
    expected = dict(proposal, context_label=None)
    assert loaded == expected
    assert inflow.load_proposal(db, 9999) is None
    with pytest.raises(ValueError):
        execute(db, platform, config, proposal, "delete", registry)
    with pytest.raises(ValueError):
        execute(db, platform, config, dict(proposal, proposal_id=9999), "auto", registry)


def test_a_proposal_is_executed_only_once(config, platform, db, registry):
    src, event = slack_pdf(db, config)
    proposal = build(db, platform, config, src, event)
    first = execute(db, platform, config, proposal, "user_accept", registry)
    second = execute(db, platform, config, proposal, "auto", registry, now=NOW + 9.0)
    assert first["ok"] and not second["ok"]
    assert "すでに処理" in second["reason"]
    assert len([op for op in operations(db) if op["status"] == "done"]) == 1


def test_the_tab_title_never_becomes_the_source(config, platform, db, registry):
    # 拡張機能の記録に URL がなく、前面だったタブ（Slack）だけが分かる
    path = make_pdf(config["DOWNLOADS_DIR"] / "download.pdf", "2026年度 予算案")
    event = store_event(db, path, url=None, referrer=None)
    proposal = build(db, platform, config, path, event, context=None)
    assert proposal["source"]["label"] is None
    assert proposal["name"]["parts"]["source"] == "送信元不明"
    assert proposal["name"]["new_name"] == f"{timeutil.local_date_str(ENDED_AT)}_2026年度 予算案_送信元不明.pdf"
    assert provenance.get_provenance(db, proposal["file_id"])["source_label"] is None
    # ページ題名は仕分けの点数には使う（送信元にはしない）
    assert "文書のタイトル・ダウンロード開始時のページ題名に「予算」（+2）" in proposal["destination"]["reasons"]


def test_window_and_page_titles_are_not_stored_or_logged(config, platform, db, registry, caplog):
    caplog.set_level(logging.DEBUG, logger="pip0")
    src, event = slack_pdf(db, config)
    proposal = build(db, platform, config, src, event)
    execute(db, platform, config, proposal, "auto", registry)

    stored = inflow_row(db, proposal["proposal_id"])["proposal_json"]
    data = json.loads(stored)
    assert "context_label" not in data and "proposal_id" not in data
    assert proposal["context_label"] == "作業中：Slack（2026年度予算WG）"  # 画面に出すだけ
    history = json.dumps([op["reasons_json"] for op in operations(db)] + [op["detail"] for op in operations(db)],
                         ensure_ascii=False)
    for secret in [SLACK_TITLE, TAB_TITLE, "2026年度予算WG", "研究室"]:
        assert secret not in stored
        assert secret not in history
    assert "作業中のアプリ（Slack）の会話名に「予算」（+2）" in stored

    # ログには、ファイル名・パス・タイトル・URL を書かない
    for record in caplog.records:
        message = record.getMessage()
        for secret in ["download (3)", "予算案", str(config["DOWNLOADS_DIR"]), "slack.com", "2026年度予算WG", "研究室"]:
            assert secret not in message


def test_rename_waits_for_analysis_and_happens_after_it(config, platform, db, registry):
    # 大きいファイルは、ダウンロード直後にはタイトルを読まない（ここでは上限を小さくしてまねる）
    config["LIGHT_METADATA_MAX_BYTES"] = 10
    src = make_docx(config["DOWNLOADS_DIR"] / "file (1).docx", "2026年度 予算案（確定版）")
    event = store_event(db, src, size=src.stat().st_size)
    proposal = build(db, platform, config, src, event)
    assert proposal["status"] == "needs_analysis"
    assert proposal["destination"]["rule"] == "予算・会計"
    assert proposal["name"]["new_name"] is None
    assert any(reason.startswith("文書のタイトル：大きいファイル") for reason in proposal["reasons"])

    result = execute(db, platform, config, proposal, "auto", registry)
    moved = config["PIP0_ROOT"] / "予算・会計" / "file (1).docx"
    assert (result["ok"], result["status"], result["state"], result["path"]) == (True, "done", "deferred", str(moved))
    assert moved.exists()
    [op] = operations(db)
    assert (op["kind"], op["after_path"]) == ("sort_rename", str(moved))  # 名前は、まだ変えていない
    assert inflow_row(db, proposal["proposal_id"])["path"] == str(moved)

    # 解析の前：待つ
    assert inflow.apply_deferred_renames(db, platform, config, rules, registry, NOW + 10) == {
        "checked": 1, "renamed": 0, "name_kept": 0, "waiting": 1, "failed": 0}

    # 解析（高負荷の処理）を、本物の analysis_queue で行う
    analysed = analysis_queue.analyse_file(moved, platform, config, rules, lambda: True)
    analysis_queue.store_result(db, proposal["file_id"], moved, analysed, config, rules, NOW + 3600)
    counts = inflow.apply_deferred_renames(db, platform, config, rules, registry, NOW + 3601)
    assert counts == {"checked": 1, "renamed": 1, "name_kept": 0, "waiting": 0, "failed": 0}

    day = timeutil.local_date_str(ENDED_AT)
    renamed = config["PIP0_ROOT"] / "予算・会計" / f"{day}_2026年度 予算案（確定版）_Slack.docx"
    assert renamed.exists() and not moved.exists()
    rename_op = operations(db)[-1]
    assert (rename_op["kind"], rename_op["actor"], rename_op["status"]) == ("rename", "auto", "done")
    assert (rename_op["before_path"], rename_op["after_path"]) == (str(moved), str(renamed))
    reasons = json.loads(rename_op["reasons_json"])
    assert "内容「2026年度 予算案（確定版）」：解析で得た文書のタイトル" in reasons
    row = inflow_row(db, proposal["proposal_id"])
    assert (row["state"], row["path"]) == ("executed", str(renamed))
    # もう一度呼んでも、何もしない
    assert inflow.apply_deferred_renames(db, platform, config, rules, registry, NOW + 3602)["checked"] == 0


def test_image_without_a_destination_is_renamed_in_place_after_analysis(config, platform, db, registry):
    src = make_file(config["DOWNLOADS_DIR"] / "IMG_0001.png", b"\x89PNG not really")
    event = store_event(db, src, url="https://files.slack.com/files-pri/T0-F1/IMG_0001.png", tab_title=PLAIN_TAB_TITLE)
    proposal = build(db, platform, config, src, event, context=None)
    assert proposal["status"] == "needs_analysis"
    assert proposal["destination"] is None  # 拡張子だけの1点では、自動の仕分け先にしない
    assert [a["rule"] for a in proposal["alternatives"]] == ["画像・図"]

    result = execute(db, platform, config, proposal, "auto", registry)
    assert (result["ok"], result["status"], result["state"], result["path"]) == (True, "deferred", "deferred", str(src))
    assert operations(db) == []  # 何も動かしていない

    add_analysis(db, proposal["file_id"], kind="image", visual_kind="chart", chart_score=0.82,
                 colourful_ratio=0.2, colours_json=json.dumps({"blue": 0.62, "red": 0.38}))
    counts = inflow.apply_deferred_renames(db, platform, config, rules, registry, NOW + 3600)
    assert counts["renamed"] == 1
    renamed = config["DOWNLOADS_DIR"] / f"{timeutil.local_date_str(ENDED_AT)}_青いグラフ_Slack.png"
    assert renamed.read_bytes() == b"\x89PNG not really"
    op = operations(db)[-1]
    assert (op["kind"], op["before_path"], op["after_path"]) == ("rename", str(src), str(renamed))
    assert "内容「青いグラフ」：画像の解析（色：青系 62%、グラフらしさ 0.82）" in json.loads(op["reasons_json"])


def test_deferred_rename_is_dropped_when_the_file_was_moved_by_the_user(config, platform, db, registry):
    src = make_file(config["DOWNLOADS_DIR"] / "IMG_0002.png")
    proposal = build(db, platform, config, src, store_event(db, src, tab_title=PLAIN_TAB_TITLE), context=None)
    assert proposal["destination"] is None
    execute(db, platform, config, proposal, "auto", registry)
    os.rename(src, config["DOWNLOADS_DIR"] / "旅行の写真.png")  # ユーザーが自分で名前を付けた
    add_analysis(db, proposal["file_id"], kind="image", visual_kind="photo", colourful_ratio=0.5,
                 colours_json=json.dumps({"green": 0.9}))
    counts = inflow.apply_deferred_renames(db, platform, config, rules, registry, NOW + 3600)
    assert counts["failed"] == 1
    assert (config["DOWNLOADS_DIR"] / "旅行の写真.png").exists()
    row = inflow_row(db, proposal["proposal_id"])
    assert row["state"] == "failed" and "見つかりません" in row["detail"]
    assert operations(db)[-1]["status"] == "skipped"


def test_deferred_rename_keeps_the_name_when_neither_content_nor_source_is_known(config, platform, db, registry):
    src = make_file(config["DOWNLOADS_DIR"] / "scan_0001.txt", b"12345")
    proposal = build(db, platform, config, src, None, context=None)
    assert proposal["source"]["label"] is None
    execute(db, platform, config, proposal, "auto", registry)
    add_analysis(db, proposal["file_id"], kind="text", title=None)
    counts = inflow.apply_deferred_renames(db, platform, config, rules, registry, NOW + 3600)
    assert counts["name_kept"] == 1
    assert src.exists()
    row = inflow_row(db, proposal["proposal_id"])
    assert row["state"] == "executed" and "内容も送信元も分からない" in row["detail"]


def test_deferred_rename_waits_while_in_use_or_stopped(config, platform, db, registry):
    src = make_file(config["DOWNLOADS_DIR"] / "IMG_0003.png")
    proposal = build(db, platform, config, src, store_event(db, src, tab_title=PLAIN_TAB_TITLE), context=None)
    assert proposal["destination"] is None
    execute(db, platform, config, proposal, "auto", registry)
    add_analysis(db, proposal["file_id"], kind="image", visual_kind="other", colourful_ratio=0.0,
                 colours_json=json.dumps({}))
    platform.locked.add(str(src))
    assert inflow.apply_deferred_renames(db, platform, config, rules, registry, NOW + 3600)["waiting"] == 1
    platform.locked.clear()
    killswitch.engage(db, config, "テスト")
    assert inflow.apply_deferred_renames(db, platform, config, rules, registry, NOW + 3601)["waiting"] == 1
    assert src.exists()
    assert killswitch.resume(db, config, confirmed=True)["ok"]
    assert inflow.apply_deferred_renames(db, platform, config, rules, registry, NOW + 3602)["renamed"] == 1
    assert (config["DOWNLOADS_DIR"] / f"{timeutil.local_date_str(ENDED_AT)}_画像_Slack.png").exists()


def test_disabled_automatic_sorting_or_renaming(config, platform, db, registry):
    config["AUTO_SORT_ENABLED"] = False
    src, event = slack_pdf(db, config, name="download (5).pdf")
    proposal = build(db, platform, config, src, event)
    assert proposal["reasons"][0] == "自動仕分けは無効です。時間が過ぎても移動しません（ボタンでは実行できます）"
    result = execute(db, platform, config, proposal, "auto", registry)
    renamed = config["DOWNLOADS_DIR"] / f"{timeutil.local_date_str(ENDED_AT)}_2026年度 予算案_Slack.pdf"
    assert result["path"] == str(renamed)  # 改名だけ（その場で）
    assert "自動仕分けが無効" in result["reason"]
    assert operations(db)[-1]["kind"] == "rename"

    config["AUTO_SORT_ENABLED"] = True
    config["AUTO_RENAME_ENABLED"] = False
    src, event = slack_pdf(db, config, name="download (6).pdf")
    proposal = build(db, platform, config, src, event)
    result = execute(db, platform, config, proposal, "auto", registry)
    assert result["path"] == str(config["PIP0_ROOT"] / "予算・会計" / "download (6).pdf")  # 移動だけ
    assert operations(db)[-1]["kind"] == "sort"

    config["AUTO_SORT_ENABLED"] = False
    src, event = slack_pdf(db, config, name="download (7).pdf")
    proposal = build(db, platform, config, src, event)
    result = execute(db, platform, config, proposal, "auto", registry)
    assert (result["ok"], result["status"], result["state"]) == (False, "skipped", "proposed")
    assert src.exists()
    # ユーザーの承認は、自動の設定に関係なく実行する
    assert execute(db, platform, config, proposal, "user_accept", registry)["status"] == "done"


def test_meaningful_names_are_only_sorted(config, platform, db, registry):
    src = make_pdf(config["DOWNLOADS_DIR"] / "経費精算の手引き.pdf")
    proposal = build(db, platform, config, src, None, context=None)
    assert proposal["status"] == "proposed"
    assert proposal["name"]["status"] == "keep"
    assert "名前：意味のある名前のため、改名しません" in proposal["reasons"]
    result = execute(db, platform, config, proposal, "auto", registry)
    assert result["path"] == str(config["PIP0_ROOT"] / "予算・会計" / "経費精算の手引き.pdf")
    assert operations(db)[-1]["kind"] == "sort"


def test_user_choices_keep_and_alternative(config, platform, db, registry):
    src, event = slack_pdf(db, config)
    proposal = build(db, platform, config, src, event)
    result = execute(db, platform, config, proposal, "user_keep", registry)
    assert (result["ok"], result["status"], result["state"]) == (True, "kept", "kept")
    assert src.exists() and operations(db) == []
    row = inflow_row(db, proposal["proposal_id"])
    assert (row["state"], row["decision"]) == ("kept", "user_keep")

    src2, event2 = slack_pdf(db, config, name="download (4).pdf")
    proposal = build(db, platform, config, src2, event2)
    with pytest.raises(ValueError):
        execute(db, platform, config, proposal, "user_alternative", registry, alternative_index=7)
    result = execute(db, platform, config, proposal, "user_alternative", registry, alternative_index=1)
    day = timeutil.local_date_str(ENDED_AT)
    assert result["path"] == str(config["PIP0_ROOT"] / "会議・議事録" / f"{day}_2026年度 予算案_Slack.pdf")
    reasons = json.loads(operations(db)[-1]["reasons_json"])
    assert reasons[:2] == ["ユーザーがミニドックで、ほかの仕分け先を選びました",
                           "仕分け先「会議・議事録」：1点（ユーザーが選んだ、ほかの候補）"]


def test_no_candidate_when_there_is_nothing_to_do(config, platform, db, registry):
    src = make_file(config["DOWNLOADS_DIR"] / "旅行の計画.zip")
    proposal = build(db, platform, config, src, None, context=None)
    assert proposal["status"] == "no_candidate"
    assert proposal["destination"] is None and proposal["alternatives"] == []
    assert "仕分け先：候補なし（2点以上の規則がありません）" in proposal["reasons"]
    assert inflow_row(db, proposal["proposal_id"])["state"] == "no_candidate"
    result = execute(db, platform, config, proposal, "user_accept", registry)
    assert (result["ok"], result["status"], result["state"]) == (False, "skipped", "no_candidate")
    assert src.exists()


def test_zone_identifier_is_used_when_there_is_no_browser_record(config, platform, db, registry):
    src = make_pdf(config["DOWNLOADS_DIR"] / "download.pdf", "請求書 10月分")
    platform.zone_identifiers[str(src)] = (
        "[ZoneTransfer]\r\nZoneId=3\r\nReferrerUrl=https://mail.google.com/\r\n"
        "HostUrl=https://mail-attachment.googleusercontent.com/attachment/u/0/?ui=2&ik=secret\r\n")
    proposal = build(db, platform, config, src, None, context=None)
    assert proposal["source"]["label"] == "Gmail"
    assert proposal["source"]["kind"] == "zone_identifier"
    assert proposal["date_basis"] == "pip0 がダウンロードの完了を確かめた時刻"
    assert proposal["name"]["new_name"] == f"{timeutil.local_date_str(NOW)}_請求書 10月分_Gmail.pdf"
    assert "ik=secret" not in inflow_row(db, proposal["proposal_id"])["proposal_json"]


def test_browser_record_is_found_when_the_tracker_did_not_attach_one(config, platform, db, registry):
    src, event = slack_pdf(db, config)
    proposal = build(db, platform, config, src, None)
    assert proposal["download_event_id"] == event["id"]
    assert proposal["source"]["label"] == "Slack"
    assert database.query_one(db, "SELECT state FROM download_events WHERE id = ?", (event["id"],))["state"] == "matched"


def test_slow_title_reading_is_abandoned_after_the_budget(config, platform, db, monkeypatch):
    def slow_light_metadata(path, platform, config, rules):
        time.sleep(0.5)
        return {"status": "done", "title": "遅れて読めたタイトル", "kind": "pdf", "source": "pdf_info", "reason": ""}

    monkeypatch.setattr(inflow.analyse_text, "light_metadata", slow_light_metadata)
    config["LIGHT_METADATA_BUDGET_SECONDS"] = 0.05
    src, event = slack_pdf(db, config)
    started = time.monotonic()
    proposal = build(db, platform, config, src, event)
    assert time.monotonic() - started < 0.45
    assert proposal["status"] == "needs_analysis"
    assert proposal["light_metadata"]["status"] == "skipped"
    assert "時間内に" in proposal["light_metadata"]["reason"]


def test_files_that_must_not_be_touched_get_no_candidate(config, platform, db, registry):
    src = make_pdf(config["DOWNLOADS_DIR"] / "download.pdf", "予算案")
    platform.not_local.add(str(src))  # クラウドの未取得のプレースホルダー
    proposal = build(db, platform, config, src, None)
    assert proposal["status"] == "no_candidate"
    assert proposal["file_id"] is None
    assert proposal["reasons"][0].startswith("このファイルは扱いません：中身がこの PC にない")
    assert database.query_all(db, "SELECT * FROM files") == []
    assert execute(db, platform, config, proposal, "auto", registry)["status"] == "skipped"
    assert src.exists()


def test_a_replaced_file_is_not_moved(config, platform, db, registry):
    src, event = slack_pdf(db, config)
    proposal = build(db, platform, config, src, event)
    # 同じ名前の別のファイルに置き換わる（別のファイルを作ってから置き換えるので、ファイル番号は必ず変わる）
    other = make_pdf(config["DOWNLOADS_DIR"] / "other.pdf", "別の文書")
    os.replace(other, src)
    assert platform.get_file_key(src) != proposal["file_key"]
    result = execute(db, platform, config, proposal, "auto", registry)
    assert (result["status"], result["state"]) == ("skipped", "failed")
    assert "別のファイルに置き換わった" in result["reason"]
    assert src.exists()
