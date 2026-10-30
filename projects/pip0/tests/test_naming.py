"""新しい名前「日付_内容_送信元」（naming.py）のテスト

ファイルには触らない関数なので、提案の材料（軽く読んだタイトル、送信元、解析結果）を手で作って確かめます。
"""

import json
import time
from datetime import datetime

import pytest

from pip0 import naming, rules, safe_names, timeutil

NOW = 1_793_235_600.0  # 2026-10-29 10:00（日本時間）
SLACK = {"label": "Slack", "kind": "browser_extension",
         "evidence": "ブラウザー拡張の記録：files.slack.com からのダウンロード"}
NO_RECORD = {"label": None, "kind": None, "evidence": "ダウンロードの記録なし"}


def office_title(title):
    return {"status": "done", "title": title, "kind": "document", "source": "office_core", "reason": ""}


def pdf_title(title):
    return {"status": "done", "title": title, "kind": "pdf", "source": "pdf_info", "reason": ""}


NOT_READ = {"status": "skipped", "title": None, "kind": "image", "source": None,
            "reason": "タイトルを持つ形式（Office 文書、PDF）ではありません"}


def image_analysis(colours, colourful_ratio=0.2, visual_kind="chart", chart_score=0.82, status="done"):
    """analysis テーブルの行（画像）の形"""
    return {"status": status, "kind": "image", "title": None, "colours_json": json.dumps(colours),
            "colourful_ratio": colourful_ratio, "chart_score": chart_score, "visual_kind": visual_kind}


def propose(env, original_name, light=None, source=SLACK, analysis=None, completed_at=NOW):
    return naming.propose_name(original_name, light, source, completed_at, analysis, env, rules)


@pytest.fixture
def local_time(monkeypatch):
    """端末の現地時刻（タイムゾーン）を切り替える。Windows には time.tzset がないので、そこでは飛ばす"""
    if not hasattr(time, "tzset"):
        pytest.skip("タイムゾーンの切り替え（time.tzset）がない環境です")

    def use(tz):
        monkeypatch.setenv("TZ", tz)
        time.tzset()

    yield use
    monkeypatch.undo()
    time.tzset()


# ---------------------------------------------------------------------- 意味の分からない名前


@pytest.mark.parametrize("stem", [
    "download", "download (3)", "Download (12)", "document", "file (2)", "untitled", "attachment",
    "IMG_0001", "img-20261029", "DSC01234", "PXL_20261029_101010123", "MVIMG_0042",
    "無題", "名称未設定 2", "新規 Microsoft Word 文書", "scan_001", "スキャン",
    "0f8fad5b-d9cb-469f-a165-70867728950e", "a3f5c2e1b4d69780", "20261029101010",
    "Screenshot 2026-10-29 101010", "スクリーンショット 2026-10-29 10.10.10",
])
def test_meaningless_names(stem):
    meaningless, pattern = naming.is_meaningless(stem, rules)
    assert meaningless is True
    assert pattern in rules.MEANINGLESS_NAME_PATTERNS


@pytest.mark.parametrize("stem", [
    "2026年度 予算案", "議事録_第3回", "report_final", "budget", "downloads_list", "IMG", "12345", "",
])
def test_meaningful_names(stem):
    assert naming.is_meaningless(stem, rules) == (False, None)


# ---------------------------------------------------------------------- 名前を組み立てる


def test_build_name_joins_the_parts_and_keeps_the_extension():
    assert naming.build_name("2026-10-29", "予算案", "Slack", ".pdf") == "2026-10-29_予算案_Slack.pdf"
    # 拡張子は、大文字・小文字も変えない
    assert naming.build_name("2026-10-29", "予算案", "Slack", ".PDF") == "2026-10-29_予算案_Slack.PDF"
    # 拡張子のないファイル
    assert naming.build_name("2026-10-29", "予算案", "example.co.jp", "") == "2026-10-29_予算案_example.co.jp"


def test_build_name_replaces_forbidden_and_control_characters():
    name = naming.build_name("2026-10-29", 'Q3: 売上/利益 <速報>?*|"\\\t改\n訂', "Slack", ".xlsx")
    assert name == "2026-10-29_Q3： 売上／利益 ＜速報＞？＊｜＂＼ 改 訂_Slack.xlsx"
    assert safe_names.check_name(name) == (True, "")


def test_build_name_avoids_reserved_names_and_trailing_dots():
    # 部分が空なら飛ばす。残った名前が予約名なら「_」を付ける
    assert naming.build_name("", "CON", None, ".txt") == "_CON.txt"
    assert naming.build_name(None, "aux", "", "") == "_aux"
    # 部分の前後の点と空白は除く
    assert naming.build_name("2026-10-29", " 予算案. ", "Slack", ".pdf") == "2026-10-29_予算案_Slack.pdf"
    for name in ["_CON.txt", naming.build_name("2026-10-29", "NUL", "COM1", ".pdf")]:
        assert safe_names.check_name(name) == (True, "")


# ---------------------------------------------------------------------- 新しい名前の提案


def test_meaningful_name_is_kept(env):
    result = propose(env, "2026年度 予算案.pdf", light=pdf_title("別のタイトル"))
    assert result["status"] == "keep"
    assert result["rename"] is False
    assert result["new_name"] is None
    assert result["parts"] == {"date": None, "content": None, "source": None}
    assert "意味のある名前" in result["reason"]


def test_office_title_becomes_the_content(env):
    result = propose(env, "download (3).docx", light=office_title("2026年度 予算案（確定版）"))
    day = timeutil.local_date_str(NOW)
    assert result["status"] == "ready"
    assert result["rename"] is True
    assert result["new_name"] == f"{day}_2026年度 予算案（確定版）_Slack.docx"
    assert result["parts"] == {"date": day, "content": "2026年度 予算案（確定版）", "source": "Slack"}
    assert result["evidence"] == {
        "date": "ダウンロード完了日（端末の現地時刻）",
        "content": "Office の文書のタイトル",
        "source": "ブラウザー拡張の記録：files.slack.com からのダウンロード",
    }


def test_pdf_title_becomes_the_content_and_the_extension_is_kept(env):
    result = propose(env, "a3f5c2e1b4d69780.PDF", light=pdf_title("前期 決算報告"))
    assert result["new_name"] == f"{timeutil.local_date_str(NOW)}_前期 決算報告_Slack.PDF"
    assert result["evidence"]["content"] == "PDF の文書情報のタイトル"


def test_forbidden_characters_in_titles_are_replaced(env):
    result = propose(env, "download.pdf", light=pdf_title('予算: 2026/27 <案> "最終"?'))
    assert result["parts"]["content"] == "予算： 2026／27 ＜案＞ ＂最終＂？"
    assert safe_names.check_name(result["new_name"]) == (True, "")
    assert result["new_name"].endswith("_Slack.pdf")


def test_long_titles_are_cut_to_content_max_chars(env):
    title = "とても長いタイトル" * 10  # 90 文字
    result = propose(env, "download.pdf", light=pdf_title(title))
    assert result["parts"]["content"] == title[:env["CONTENT_MAX_CHARS"]]
    assert len(result["parts"]["content"]) == 40


@pytest.mark.parametrize("title", ["", "   ", "---", "untitled", "Document", "IMG_0001", None])
def test_empty_symbol_or_meaningless_titles_are_not_used(env, title):
    result = propose(env, "download.pdf", light=pdf_title(title))
    assert result["status"] == "needs_analysis"
    assert result["parts"]["content"] is None


def test_analysis_title_is_used_when_the_light_title_is_missing(env):
    analysis = {"status": "done", "kind": "document", "title": "第3回 会議 議事録"}
    result = propose(env, "file.docx", light=office_title(None), analysis=analysis)
    assert result["status"] == "ready"
    assert result["parts"]["content"] == "第3回 会議 議事録"
    assert result["evidence"]["content"] == "解析で得た文書のタイトル"


def test_light_title_comes_before_the_analysis_title(env):
    analysis = {"status": "done", "kind": "document", "title": "解析のタイトル"}
    result = propose(env, "file.docx", light=office_title("軽く読んだタイトル"), analysis=analysis)
    assert result["parts"]["content"] == "軽く読んだタイトル"


@pytest.mark.parametrize("analysis, content, evidence_words", [
    # 色付きの部分の 62% が青のグラフ →「青いグラフ」
    (image_analysis({"blue": 0.62, "red": 0.2, "green": 0.18}), "青いグラフ", ["青系 62%", "グラフらしさ 0.82"]),
    (image_analysis({"red": 0.7, "orange": 0.3}, visual_kind="photo", chart_score=0.1), "赤い写真", ["赤系 70%"]),
    (image_analysis({"green": 0.5}, visual_kind="other", chart_score=0.3), "緑の画像", ["緑系 50%"]),
    # 色付きの部分が少ない（COLOUR_MIN_COLOURFUL 未満）ときは、色を付けない
    (image_analysis({"blue": 0.9}, colourful_ratio=0.01), "グラフ", ["グラフらしさ 0.82"]),
    # 最も多い色でも COLOUR_MIN_SHARE（35%）未満なら、色を付けない
    (image_analysis({"blue": 0.3, "red": 0.3, "green": 0.3}, visual_kind="other"), "画像", []),
])
def test_image_descriptions_from_the_analysis(env, analysis, content, evidence_words):
    result = propose(env, "IMG_0001.png", light=NOT_READ, analysis=analysis)
    assert result["status"] == "ready"
    assert result["parts"]["content"] == content
    assert result["new_name"] == f"{timeutil.local_date_str(NOW)}_{content}_Slack.png"
    assert result["evidence"]["content"].startswith("画像の解析")
    for words in evidence_words:
        assert words in result["evidence"]["content"]


def test_colours_can_also_be_given_as_a_dictionary(env):
    analysis = {"status": "done", "kind": "image", "colours": {"blue": 0.8}, "colourful_ratio": 0.5,
                "visual_kind": "chart", "chart_score": 0.9}
    assert propose(env, "IMG_0002.png", analysis=analysis)["parts"]["content"] == "青いグラフ"


def test_unknown_source_is_not_guessed(env):
    result = propose(env, "download.pdf", light=pdf_title("予算案"), source=NO_RECORD)
    assert result["parts"]["source"] == "送信元不明"
    assert result["evidence"]["source"] == "ダウンロードの記録なし"
    assert result["new_name"] == f"{timeutil.local_date_str(NOW)}_予算案_送信元不明.pdf"
    # 送信元の情報そのものがないときも同じ
    assert propose(env, "download.pdf", light=pdf_title("予算案"), source=None)["parts"]["source"] == "送信元不明"


def test_long_source_labels_are_cut(env):
    source = {"label": "a" * 60 + ".example.com", "evidence": "Windows のダウンロード元情報"}
    result = propose(env, "download.pdf", light=pdf_title("予算案"), source=source)
    assert result["parts"]["source"] == "a" * naming.SOURCE_MAX_CHARS


def test_needs_analysis_when_the_content_is_not_known_yet(env):
    # 画像は、ダウンロード直後には説明を作れない。解析がまだ（pending）なら「解析待ち」
    for analysis in [None, {"status": "pending", "kind": "image"}]:
        result = propose(env, "IMG_0001.png", light=NOT_READ, analysis=analysis)
        assert result["status"] == "needs_analysis"
        assert result["rename"] is False
        assert result["new_name"] is None
        assert result["parts"]["date"] == timeutil.local_date_str(NOW)
        assert result["parts"]["source"] == "Slack"
        assert result["parts"]["content"] is None
        assert "解析待ち" in result["evidence"]["content"]


def test_unknown_content_after_analysis_with_a_known_source(env):
    analysis = {"status": "done", "kind": "pdf", "title": None}  # タイトルのない PDF
    result = propose(env, "download.pdf", light=pdf_title(None), analysis=analysis)
    assert result["status"] == "ready"
    assert result["parts"]["content"] == "内容不明"
    assert result["new_name"] == f"{timeutil.local_date_str(NOW)}_内容不明_Slack.pdf"


def test_name_is_kept_when_neither_content_nor_source_is_known(env):
    analysis = {"status": "done", "kind": "pdf", "title": None}
    result = propose(env, "download.pdf", light=pdf_title(None), source=NO_RECORD, analysis=analysis)
    assert result["status"] == "keep"
    assert result["rename"] is False
    assert result["new_name"] is None
    assert "内容も送信元も分からない" in result["reason"]


@pytest.mark.parametrize("status", ["failed", "unsupported"])
def test_failed_or_unsupported_analysis_counts_as_finished(env, status):
    analysis = {"status": status, "kind": "other", "title": None}
    result = propose(env, "file.zip", light=None, analysis=analysis)
    assert result["status"] == "ready"
    assert result["parts"]["content"] == "内容不明"
    assert result["new_name"].endswith("_内容不明_Slack.zip")


def test_date_is_the_local_date_around_midnight_in_tokyo(env, local_time):
    local_time("Asia/Tokyo")
    just_before = datetime(2026, 10, 29, 23, 59, 59).timestamp()  # 世界標準時では 2026-10-29 14:59:59
    just_after = datetime(2026, 10, 30, 0, 0, 0).timestamp()     # 世界標準時では、まだ 2026-10-29
    before = propose(env, "download.pdf", light=pdf_title("予算案"), completed_at=just_before)
    after = propose(env, "download.pdf", light=pdf_title("予算案"), completed_at=just_after)
    assert before["new_name"] == "2026-10-29_予算案_Slack.pdf"
    assert after["new_name"] == "2026-10-30_予算案_Slack.pdf"
    assert time.strftime("%Y-%m-%d", time.gmtime(just_after)) == "2026-10-29"


def test_date_follows_the_device_time_zone(env, local_time):
    local_time("America/New_York")
    completed_at = 1_793_286_000.0  # 日本時間の 2026-10-30 0:00 は、ニューヨークでは 2026-10-29 11:00
    result = propose(env, "download.pdf", light=pdf_title("予算案"), completed_at=completed_at)
    assert result["parts"]["date"] == "2026-10-29"
