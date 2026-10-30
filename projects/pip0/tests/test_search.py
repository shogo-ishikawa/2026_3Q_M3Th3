"""エピソード記憶検索（search.py）のテスト

- parse_query：言葉を手掛かりに分ける（時期・入手経路・色・見た目・文書の種類・内容の語）
- search：DB に直接入れた索引・解析結果・入手経路の行で、一致・一部一致・情報不足・該当なしを確かめる
ダミーファイルを実際に作って解析する通しの確かめは、tests/test_demo_data.py にあります。
"""

import json
import logging
import time
from datetime import datetime

import pytest

from pip0 import database, rules, search

DAY = 24 * 60 * 60


@pytest.fixture(autouse=True)
def tokyo(monkeypatch):
    """「先週」と日付の表示が、どの環境でも同じになるように、日本時間で動かす"""
    monkeypatch.setenv("TZ", "Asia/Tokyo")
    time.tzset()
    yield
    monkeypatch.undo()
    time.tzset()


def local(*args):
    return datetime(*args).timestamp()


def now():
    return local(2026, 10, 29, 10, 0)  # 木曜日


def insert(db, table, values):
    columns = ", ".join(values)
    marks = ", ".join("?" for _ in values)
    return database.execute(db, f"INSERT INTO {table} ({columns}) VALUES ({marks})", tuple(values.values()))


def add(db, env, name, *, mtime=None, status="present", analysis=None, provenance=None, detected_at=None):
    """索引に1行を加える。analysis と provenance は、それぞれの表の列の辞書"""
    ext = "." + name.rsplit(".", 1)[1].lower() if "." in name else ""
    file_id = insert(db, "files", {
        "path": str(env["DOWNLOADS_DIR"] / name), "name": name, "ext": ext, "size": 100,
        "mtime": local(2026, 6, 1, 9, 0) if mtime is None else mtime, "location_kind": "downloads",
        "status": status, "first_seen_at": now() - 100 * DAY, "last_seen_at": now(), "updated_at": now()})
    if analysis is not None:
        insert(db, "analysis", dict({"file_id": file_id}, **analysis))
    if provenance is not None:
        insert(db, "provenance", dict({"file_id": file_id, "recorded_at": now()}, **provenance))
    if detected_at is not None:
        insert(db, "inflow", {"file_id": file_id, "path": str(env["DOWNLOADS_DIR"] / name),
                              "detected_at": detected_at, "state": "executed"})
    return file_id


def image_analysis(colours, chart_score, visual_kind, colourful=0.3, evidence=None, status="done"):
    shares = {name: 0.0 for name in ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"]}
    shares.update(colours)
    return {"status": status, "kind": "image", "colours_json": json.dumps(shares), "colourful_ratio": colourful,
            "chart_score": chart_score, "chart_evidence_json": json.dumps(evidence or []),
            "visual_kind": visual_kind}


SLACK = {"source_label": "Slack", "source_kind": "browser_extension",
         "evidence": "ブラウザー拡張の記録：files.slack.com からのダウンロード", "host": "files.slack.com"}
SLACK_ZONE = {"source_label": "Slack", "source_kind": "zone_identifier",
              "evidence": "Windows のダウンロード元情報（Zone.Identifier）：files.slack.com", "host": "files.slack.com"}
GMAIL = {"source_label": "Gmail", "source_kind": "browser_extension",
         "evidence": "ブラウザー拡張の記録：mail-attachment.googleusercontent.com からのダウンロード"}


@pytest.fixture
def library(db, env):
    """検索の対象になる索引（解析済みの画像・文書、入手経路の記録があるもの・ないもの）"""
    ids = {}
    ids["blue_chart"] = add(db, env, "IMG_2041.png", mtime=local(2026, 10, 21, 14, 30),
                            analysis=image_analysis({"blue": 0.62, "cyan": 0.1}, 0.82, "chart",
                                                    evidence=["背景が単色（88%）", "単色の長方形（棒）を5個検出"]),
                            provenance=dict(SLACK, downloaded_at=local(2026, 10, 21, 14, 30)))
    ids["red_chart"] = add(db, env, "IMG_2042.png", analysis=image_analysis({"red": 0.9}, 0.9, "chart"),
                           provenance=dict(GMAIL, downloaded_at=local(2026, 10, 14, 11, 0)))
    ids["blue_photo"] = add(db, env, "IMG_2043.jpg", analysis=image_analysis({"blue": 0.7}, 0.2, "photo"))
    ids["budget"] = add(db, env, "document (1).docx", mtime=local(2026, 10, 22, 10, 15),
                        analysis={"status": "done", "kind": "document", "title": "2026年度 予算案",
                                  "text_excerpt": "2026年度 予算案（ダミー）\n部門別の内訳", "has_chart": 0},
                        provenance=dict(GMAIL, downloaded_at=local(2026, 10, 22, 10, 15)))
    ids["old_budget"] = add(db, env, "document.docx", mtime=local(2026, 8, 29, 10, 0),
                            analysis={"status": "done", "kind": "document", "title": "予算（第1次案）",
                                      "text_excerpt": "予算の最初の案", "has_chart": 0})
    ids["minutes"] = add(db, env, "untitled.txt", mtime=local(2026, 10, 20, 15, 0),
                         analysis={"status": "done", "kind": "text", "text_excerpt": "定例ミーティングの議事録"})
    ids["pdf"] = add(db, env, "F0A1B2C3.pdf", mtime=local(2026, 10, 14, 11, 0),
                     analysis={"status": "done", "kind": "pdf", "title": "配布資料", "text_excerpt": "handout"},
                     provenance=dict(SLACK_ZONE, downloaded_at=None))
    ids["gone"] = add(db, env, "予算_消えた.docx", status="missing", mtime=local(2026, 10, 22, 9, 0),
                      analysis={"status": "done", "kind": "document", "title": "予算", "text_excerpt": "予算"})
    return ids


def run(db, env, text, **options):
    return search.search(db, text, now(), env, rules, **options)


def names(result, key="results"):
    return [item["name"] for item in result[key]]


# ---------------------------------------------------------------------- 言葉を手掛かりに分ける


def parse(env, text):
    return search.parse_query(text, now(), env, rules)


def cue_summary(query):
    summary = []
    for cue in query["cues"]:
        value = cue.get("labels") or cue.get("colour") or cue.get("kind")
        summary.append((cue["type"], cue["word"], value))
    return summary


def test_parse_blue_chart_uses_the_longest_colour_word(env):
    query = parse(env, "青いグラフ")
    assert cue_summary(query) == [("colour", "青い", "blue"), ("visual", "グラフ", "chart")]
    assert query["cues"][0]["colours"] == ["blue", "cyan"]  # rules.COLOUR_GROUPS（水色も青に含める）
    assert [cue["label"] for cue in query["cues"]] == ["色：青系", "見た目：グラフ"]
    assert query["ignored"] == []


def test_parse_source_and_acquire_words(env):
    query = parse(env, "Slackで貰った")
    assert cue_summary(query) == [("source", "Slack", ["Slack"])]
    assert query["cues"][0]["label"] == "入手経路：Slack"
    assert query["ignored"] == ["で", "貰った"]
    query = parse(env, "メールで届いた表")
    assert cue_summary(query) == [("source", "メール", ["Gmail", "Outlook"]), ("doc_kind", "表", "spreadsheet")]
    assert query["cues"][0]["label"] == "入手経路：メール（Gmail・Outlook）"


def test_parse_last_week_budget_material(env):
    query = parse(env, "先週の予算資料")
    assert cue_summary(query) == [("time", "先週", None), ("doc_kind", "資料", "document"),
                                  ("keyword", "予算", None)]
    period = query["cues"][0]
    assert datetime.fromtimestamp(period["start"]) == datetime(2026, 10, 19, 0, 0)
    assert datetime.fromtimestamp(period["end"]) == datetime(2026, 10, 26, 0, 0)
    assert period["label"] == "時期：先週（2026-10-19（月）〜2026-10-25（日））"
    assert query["ignored"] == ["の"]


def test_parse_week_can_start_on_sunday(env):
    query = search.parse_query("先週", now(), dict(env, WEEK_STARTS_ON=6), rules)
    assert datetime.fromtimestamp(query["cues"][0]["start"]) == datetime(2026, 10, 18, 0, 0)


@pytest.mark.parametrize("text, expected", [
    ("青森の発表資料", [("doc_kind", "資料", "document"), ("keyword", "青森", None), ("keyword", "発表", None)]),
    ("赤字の表計算", [("keyword", "赤字", None), ("keyword", "表計算", None)]),
    ("青色のグラフ", [("colour", "青色", "blue"), ("visual", "グラフ", "chart")]),
    ("真っ青な写真", [("colour", "青", "blue"), ("visual", "写真", "photo")]),
    ("ＰＤＦ", [("doc_kind", "PDF", "pdf")]),
    ("online LINEで", [("source", "LINE", ["LINE"]), ("keyword", "online", None)]),
    ("グラフィックのデザイン", [("keyword", "グラフィック", None), ("keyword", "デザイン", None)]),
    ("予算の内訳", [("keyword", "予算", None), ("keyword", "内訳", None)]),
    ("送ってもらった資料", [("doc_kind", "資料", "document")]),
    ("Slackからのファイル", [("source", "Slack", ["Slack"])]),
    ("予算 予算 YOSAN yosan", [("keyword", "予算", None), ("keyword", "YOSAN", None)]),
])
def test_parse_handles_word_boundaries(env, text, expected):
    assert cue_summary(parse(env, text)) == expected


def test_parse_with_nothing_to_search(env):
    assert parse(env, "")["cues"] == []
    query = parse(env, "のが")
    assert query["cues"] == [] and query["ignored"] == ["のが"]


# ---------------------------------------------------------------------- 3つの例


def test_blue_chart_query_finds_only_the_blue_chart(library, db, env):
    result = run(db, env, "青いグラフ")
    assert result["status"] == "found"
    assert names(result) == ["IMG_2041.png"]
    entry = result["results"][0]
    assert entry["reasons"] == [
        "色：青系 72%（画像の色解析）",
        "見た目：グラフらしさ 0.82（背景が単色（88%）、単色の長方形（棒）を5個検出）",
    ]
    assert entry["unmatched"] == [] and entry["matched_count"] == entry["cue_count"] == 2
    assert set(entry) == {"file_id", "path", "name", "status", "reasons", "unmatched", "matched_count", "cue_count"}
    assert result["partial_results"] == []  # 一致があるときは、一部一致を出さない


def test_slack_query_uses_only_recorded_provenance(library, db, env):
    result = run(db, env, "Slackで貰った")
    assert result["status"] == "found"
    assert names(result) == ["IMG_2041.png", "F0A1B2C3.pdf"]  # 新しい順
    reasons = {item["name"]: item["reasons"] for item in result["results"]}
    assert reasons["IMG_2041.png"] == ["入手経路：Slack（ブラウザー拡張の記録：files.slack.com からのダウンロード）"]
    assert reasons["F0A1B2C3.pdf"] == ["入手経路：Slack（Windows のダウンロード元情報（Zone.Identifier）：files.slack.com）"]
    # 記録がないのは IMG_2043.jpg、document.docx、untitled.txt の3件（見つからない「予算_消えた.docx」は検索しない）
    assert "入手経路の記録がないファイルが 3 件あります（記録がないファイルを、Slack 等から入手したとは扱いません）" \
        in result["notes"]
    assert "読み飛ばした言葉：で、貰った" in result["notes"]


def test_last_week_budget_query_uses_the_download_date(library, db, env):
    result = run(db, env, "先週の予算資料")
    assert result["status"] == "found"
    assert names(result) == ["document (1).docx"]
    assert result["results"][0]["reasons"] == [
        "時期：ダウンロード日 2026-10-22（ブラウザー拡張の記録）",
        "種類：文書（.docx）",
        "内容：タイトル・本文に「予算」",
    ]
    assert "時期：先週（2026-10-19（月）〜2026-10-25（日））は、端末の現地時刻で調べました" in result["notes"]


# ---------------------------------------------------------------------- 入手経路の記録がないファイル


def test_file_without_provenance_is_never_labelled_slack(library, db, env):
    result = run(db, env, "Slackで貰った写真")
    assert result["status"] == "insufficient_info"  # 写真には入手経路の記録がない
    assert result["results"] == []
    photo = next(item for item in result["partial_results"] if item["name"] == "IMG_2043.jpg")
    assert photo["reasons"] == ["見た目：写真（色数が多く、単色の背景が少ない画像）"]
    assert photo["unmatched"] == [{"cue": "入手経路：Slack", "reason": "入手経路の記録なし", "missing_info": True}]
    for item in result["partial_results"]:
        if item["name"] in ("IMG_2043.jpg", "document.docx", "untitled.txt"):
            assert not any("Slack" in reason for reason in item["reasons"])


def test_provenance_without_a_host_is_also_missing_information(db, env):
    add(db, env, "a.pdf", provenance={"source_label": None, "source_kind": None,
                                      "evidence": "ブラウザー拡張の記録に、送信元のホスト名がありません"})
    result = run(db, env, "Slack")
    assert result["status"] == "insufficient_info"
    assert result["results"] == [] and result["partial_results"] == []


# ---------------------------------------------------------------------- 情報不足と該当なし


def test_insufficient_info_when_the_only_difference_is_missing_provenance(db, env):
    add(db, env, "report.pdf", analysis={"status": "done", "kind": "pdf", "text_excerpt": "本文"})
    result = run(db, env, "Slackで貰った")
    assert result["status"] == "insufficient_info"
    assert result["results"] == [] and result["partial_results"] == []
    assert "入手経路の記録がないファイルが 1 件あります（記録がないファイルを、Slack 等から入手したとは扱いません）" \
        in result["notes"]
    assert any("情報不足" in note for note in result["notes"])


def test_no_match_when_every_file_is_known_to_differ(db, env):
    add(db, env, "report.pdf", provenance=GMAIL)
    result = run(db, env, "Slackで貰った")
    assert result["status"] == "no_match"
    assert any("該当なし" in note for note in result["notes"])


def test_unanalysed_image_gives_insufficient_info(db, env):
    add(db, env, "IMG_0001.png", analysis={"status": "pending"})
    result = run(db, env, "青いグラフ")
    assert result["status"] == "insufficient_info"
    assert "色・形をまだ調べていない画像が 1 件あります（電源接続中かつ3分間無操作のときに解析します）" in result["notes"]


def test_analysed_images_of_another_colour_give_no_match_with_partial_results(db, env):
    add(db, env, "IMG_2042.png", analysis=image_analysis({"red": 0.9}, 0.9, "chart"))
    result = run(db, env, "青いグラフ")
    assert result["status"] == "no_match"
    assert names(result, "partial_results") == ["IMG_2042.png"]
    partial = result["partial_results"][0]
    assert partial["reasons"] == ["見た目：グラフらしさ 0.90（画像の形の解析）"]
    assert partial["unmatched"] == [{"cue": "色：青系", "reason": "色：青系 0%（35% 未満）", "missing_info": False}]


def test_failed_text_analysis_is_missing_information(db, env):
    add(db, env, "broken.pdf", mtime=local(2026, 10, 21, 9, 0), analysis={"status": "failed", "error": "壊れた PDF"})
    result = run(db, env, "先週の予算資料")
    assert result["status"] == "insufficient_info"
    assert result["partial_results"][0]["unmatched"] == [
        {"cue": "内容：予算", "reason": "内容：名前に「予算」がなく、本文は解析に失敗したため分かりません",
         "missing_info": True}]


# ---------------------------------------------------------------------- 手掛かりごとの決まり


def test_time_basis_order_download_then_inflow_then_modification(db, env):
    add(db, env, "downloaded.txt", mtime=local(2026, 10, 21, 9, 0),  # 変更は先週でも
        provenance=dict(GMAIL, downloaded_at=local(2026, 10, 5, 9, 0)))  # ダウンロードは先週ではない
    add(db, env, "inflow.txt", mtime=local(2026, 6, 1, 9, 0), detected_at=local(2026, 10, 20, 8, 0))
    add(db, env, "modified.txt", mtime=local(2026, 10, 25, 23, 59))
    result = run(db, env, "先週")
    assert names(result) == ["modified.txt", "inflow.txt"]
    reasons = {item["name"]: item["reasons"] for item in result["results"]}
    assert reasons["inflow.txt"] == ["時期：流入を確認した日 2026-10-20（pip0 の流入の記録）"]
    assert reasons["modified.txt"] == ["時期：最終更新日 2026-10-25（ファイルの更新日時）"]
    # 一部一致は、すべてに一致するファイルがないときだけ出る。Gmail の手掛かりを足して、一致をなくして理由を見る
    result = run(db, env, "先週Gmailで貰った")
    assert result["results"] == []
    assert result["status"] == "insufficient_info"  # inflow.txt と modified.txt には入手経路の記録がない
    downloaded = next(item for item in result["partial_results"] if item["name"] == "downloaded.txt")
    assert downloaded["reasons"] == ["入手経路：Gmail（ブラウザー拡張の記録：mail-attachment.googleusercontent.com からのダウンロード）"]
    # 最終更新日（10-21）は先週でも、ダウンロード日の記録があれば、そちらで比べる
    assert downloaded["unmatched"] == [{
        "cue": "時期：先週（2026-10-19（月）〜2026-10-25（日））", "missing_info": False,
        "reason": "時期：ダウンロード日 2026-10-05（ブラウザー拡張の記録）は、先週（2026-10-19（月）〜2026-10-25（日））ではありません"}]


def test_colour_share_and_colourful_thresholds(db, env):
    add(db, env, "a.png", analysis=image_analysis({"blue": 0.35}, 0.1, "other"))
    add(db, env, "b.png", analysis=image_analysis({"blue": 0.34}, 0.1, "other"))
    add(db, env, "c.png", analysis=image_analysis({"blue": 0.9}, 0.1, "other", colourful=0.02))
    add(db, env, "d.png", analysis=image_analysis({"cyan": 0.4}, 0.1, "other"))
    result = run(db, env, "青い")
    assert sorted(names(result)) == ["a.png", "d.png"]  # 水色（cyan）も青に含める
    result = run(db, env, "青い画像の内訳")  # 一致がないので、一部一致で理由を見る
    reasons = {item["name"]: item["unmatched"] for item in result["partial_results"]}
    assert {"cue": "色：青系", "reason": "色：青系 34%（35% 未満）", "missing_info": False} in reasons["b.png"]
    assert {"cue": "色：青系", "reason": "色：色付きの部分が少ない画像です（2%、3% 未満）", "missing_info": False} \
        in reasons["c.png"]


def test_office_document_with_a_chart_matches_the_chart_cue(db, env):
    add(db, env, "sales.xlsx", analysis={"status": "done", "kind": "spreadsheet", "has_chart": 1, "text_excerpt": "売上"})
    add(db, env, "plain.xlsx", analysis={"status": "done", "kind": "spreadsheet", "has_chart": 0, "text_excerpt": "売上"})
    result = run(db, env, "グラフ")
    assert names(result) == ["sales.xlsx"]
    assert result["results"][0]["reasons"] == ["見た目：グラフを含む文書（.xlsx）"]


def test_keyword_evidence_names_where_the_word_was_found(db, env):
    add(db, env, "予算メモ.txt", analysis={"status": "pending"})
    add(db, env, "memo.txt", analysis={"status": "pending"})
    add(db, env, "plan.docx", analysis={"status": "done", "kind": "document", "text_excerpt": "来年度の予算"})
    add(db, env, "IMG_0002.png", analysis=image_analysis({"blue": 0.5}, 0.1, "other"))
    result = run(db, env, "予算")
    reasons = {item["name"]: item["reasons"] for item in result["results"]}
    assert reasons == {"予算メモ.txt": ["内容：ファイル名に「予算」"], "plan.docx": ["内容：本文に「予算」"]}
    assert "本文をまだ解析していない文書が 2 件あります（電源接続中かつ3分間無操作のときに解析します）" in result["notes"]


def test_unmatched_keyword_reasons_distinguish_unanalysed_text(db, env):
    add(db, env, "memo.txt", analysis={"status": "pending"})
    add(db, env, "IMG_0002.png", analysis=image_analysis({"blue": 0.5}, 0.1, "other"))
    add(db, env, "plan.docx", analysis={"status": "done", "kind": "document", "text_excerpt": "本文"})
    result = run(db, env, "画像の決算")
    reasons = {item["name"]: item["unmatched"] for item in result["partial_results"]}
    # 画像の中の文字は pip0 がもともと読まないので、解析済みでも「名前だけ調べた」と書き、情報不足にもしない
    assert reasons["IMG_0002.png"] == [{"cue": "内容：決算", "missing_info": False,
                                        "reason": "内容：名前に「決算」がありません（この形式の本文は調べません）"}]
    assert result["status"] == "no_match"
    assert "「決算」は、ファイル名と、解析済みのタイトル・本文のどれにもありません" in result["notes"]
    result = run(db, env, "決算")
    assert result["status"] == "insufficient_info"  # memo.txt の本文は未解析
    by_name = {item["name"]: item for item in result["partial_results"]}
    assert by_name == {}  # どのファイルも、手掛かりに1つも一致していない
    result = run(db, env, "資料の決算")  # 資料（文書の種類）には一致させて、内容の理由を一部一致で見る
    reasons = {item["name"]: item["unmatched"] for item in result["partial_results"]}
    assert reasons["memo.txt"] == [{"cue": "内容：決算", "missing_info": True,
                                    "reason": "内容：名前に「決算」がなく、本文は未解析"}]
    assert reasons["plan.docx"] == [{"cue": "内容：決算", "missing_info": False,
                                     "reason": "内容：名前・タイトル・本文に「決算」がありません"}]


def test_documents_whose_text_cannot_be_read(db, env):
    # 古い Word 形式（.doc）は本文を読めない（unsupported）。文書なので、本文が分からない＝情報不足
    add(db, env, "old.doc", analysis={"status": "unsupported", "kind": "document",
                                      "error": "この形式（.doc）の本文は読み取れません"})
    # スキャンした PDF：解析は済んだが、本文の文字がない。解析し直しても変わらないので、情報不足ではない
    add(db, env, "scan.pdf", analysis={"status": "done", "kind": "pdf", "title": None, "text_excerpt": ""})
    add(db, env, "broken.docx", analysis={"status": "failed", "kind": "document", "error": "壊れた文書"})
    result = run(db, env, "資料の決算")
    assert result["status"] == "insufficient_info"
    reasons = {item["name"]: item["unmatched"] for item in result["partial_results"]}
    assert reasons["old.doc"] == [{"cue": "内容：決算", "missing_info": True,
                                   "reason": "内容：名前に「決算」がなく、本文は解析できない形式・大きさのため分かりません"}]
    assert reasons["scan.pdf"] == [{"cue": "内容：決算", "missing_info": False,
                                    "reason": "内容：名前・タイトルに「決算」がなく、本文の文字は取り出せませんでした（スキャンした PDF など）"}]
    assert reasons["broken.docx"][0]["missing_info"] is True
    assert "本文を読めなかった文書が 2 件あります（解析の失敗、対象外の形式・大きさなど）" in result["notes"]
    assert not any("まだ解析していない文書" in note for note in result["notes"])


def test_images_that_could_not_be_analysed_are_counted_separately(db, env):
    add(db, env, "IMG_0003.png", analysis={"status": "pending"})
    add(db, env, "IMG_0004.png", analysis={"status": "failed", "kind": "image", "error": "壊れた画像"})
    result = run(db, env, "青いグラフ")
    assert result["status"] == "insufficient_info"
    assert "色・形をまだ調べていない画像が 1 件あります（電源接続中かつ3分間無操作のときに解析します）" in result["notes"]
    assert "色・形を調べられなかった画像が 1 件あります（解析の失敗、大きすぎる画像など）" in result["notes"]


def test_partial_results_are_ordered_by_matched_cues(library, db, env):
    result = run(db, env, "先週の予算スライド")
    assert result["status"] == "no_match"
    partial = result["partial_results"]
    counts = [item["matched_count"] for item in partial]
    assert counts == sorted(counts, reverse=True)
    assert partial[0]["name"] == "document (1).docx" and partial[0]["matched_count"] == 2
    assert partial[0]["unmatched"] == [{"cue": "種類：スライド", "reason": "種類：スライドではありません（.docx）",
                                        "missing_info": False}]


def test_missing_files_are_not_searched_but_ghosts_are(db, env):
    add(db, env, "予算_ゴースト.docx", status="ghost",
        analysis={"status": "done", "kind": "document", "text_excerpt": "予算"})
    add(db, env, "予算_消えた.docx", status="missing")
    result = run(db, env, "予算")
    assert names(result) == ["予算_ゴースト.docx"]
    assert result["results"][0]["status"] == "ghost"


def test_limit_caps_results(library, db, env):
    assert len(run(db, env, "画像")["results"]) == 3
    assert len(run(db, env, "画像", limit=2)["results"]) == 2
    assert len(run(db, env, "画像", limit=None)["results"]) == 3  # SEARCH_MAX_RESULTS（10）まで


def test_empty_query_and_empty_index(db, env):
    result = run(db, env, "のを")
    assert result["status"] == "empty_query"
    assert result["results"] == [] and result["partial_results"] == []
    assert result["notes"][0].startswith("手掛かりになる言葉が見つかりませんでした")
    result = run(db, env, "予算")
    assert result["status"] == "no_match"
    assert any("索引にファイルがありません" in note for note in result["notes"])


def test_search_does_not_log_the_query_or_file_names(library, db, env, caplog):
    with caplog.at_level(logging.DEBUG):
        run(db, env, "先週の予算資料")
    messages = " ".join(record.getMessage() for record in caplog.records)
    assert "予算" not in messages and "document" not in messages
