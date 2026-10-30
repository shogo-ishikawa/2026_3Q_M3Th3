"""作業文脈の読み取り（context.py）のテスト

pip0 シェルの context.foreground の知らせ（payload）を、テストの中で手で作って確かめます。
Slack・Edge・Office のタイトルの形は、実機で確かめたものではありません（rules.py の規則に合わせた例です）。
"""

import logging

from pip0 import context, rules

NOW = 1_793_235_600.0  # 2026-10-29 10:00（日本時間）


def event(process="slack.exe", title="", **values):
    """context.foreground の payload（docs/ipc-protocol.md 4節の形）"""
    payload = {"hwnd": 4242, "process_name": process, "window_title": title, "window_class": "Chrome_WidgetWin_1",
               "is_file_dialog": False, "dialog_rect": None, "inaccessible": False, "at": NOW}
    payload.update(values)
    return payload


def parse(process="slack.exe", title="", **values):
    return context.parse_foreground(event(process, title, **values), rules)


# ---------------------------------------------------------------------- Slack


def test_slack_channel_title_gives_the_conversation():
    result = parse(title="予算2026 (Channel) - 研究室 - Slack")
    assert set(result) == set(context.CONTEXT_KEYS)
    assert result["app"] == "Slack" and result["category"] == "chat" and result["process"] == "slack.exe"
    assert result["conversation"] == "予算2026"
    assert result["conversation_kind"] == "channel"
    assert result["workspace"] == "研究室"
    assert result["partner_status"] == "ok" and result["partner_reason"] == ""
    assert result["keywords"] == ["予算", "2026"]
    assert result["window_title"] == "予算2026 (Channel) - 研究室 - Slack"
    assert result["at"] == NOW
    assert context.summary_label(result) == "Slack（予算2026）"
    assert context.partner_label(result) == "チャット相手：予算2026（チャンネル）"


def test_slack_dm_title_in_japanese():
    result = parse(title="山田 (DM) - 研究室 - Slack")
    assert result["conversation"] == "山田"
    assert result["conversation_kind"] == "dm"
    assert result["partner_status"] == "ok"
    assert context.partner_label(result) == "チャット相手：山田（DM）"
    result = parse(title="2026年度予算WG (チャンネル) - 研究室 - Slack")
    assert result["conversation_kind"] == "channel"
    assert result["keywords"] == ["2026", "年度予算", "WG"]


def test_slack_older_title_form_has_no_kind():
    result = parse(title="Slack | general | 研究室")
    assert result["conversation"] == "general"
    assert result["conversation_kind"] is None
    assert result["workspace"] == "研究室"
    assert context.partner_label(result) == "チャット相手：general"


def test_unmatched_slack_title_is_unavailable_and_not_guessed():
    for title in ["Slack", "Slack - 研究室", "ホーム - 研究室 - Slack", ""]:
        result = parse(title=title)
        assert result["partner_status"] == "unavailable", title
        assert result["partner_reason"] == context.PARTNER_UNAVAILABLE_REASON
        assert result["conversation"] is None and result["workspace"] is None
        assert result["keywords"] == []  # 読めなかったタイトルから語を推測しない
        assert context.summary_label(result) == "Slack（チャット相手：取得不可）"
        assert context.partner_label(result) == "チャット相手：取得不可"


def test_other_chat_apps_are_unavailable_without_title_rules():
    # Teams のタイトルの形は確かめていないので、相手の名前らしい文字があっても読まない
    result = parse("ms-teams.exe", "チャット | 山田 | Microsoft Teams")
    assert result["app"] == "Teams" and result["category"] == "chat"
    assert result["partner_status"] == "unavailable"
    assert result["conversation"] is None and result["keywords"] == []


def test_process_name_is_matched_without_case():
    result = parse("Slack.EXE", "予算2026 (Channel) - 研究室 - Slack")
    assert result["app"] == "Slack" and result["process"] == "slack.exe"


# ---------------------------------------------------------------------- ブラウザー


def test_chrome_title_suffix_is_removed():
    result = parse("chrome.exe", "2026年度 予算案 - Google ドキュメント - Google Chrome")
    assert result["app"] == "Chrome" and result["category"] == "browser"
    assert result["page_title"] == "2026年度 予算案 - Google ドキュメント"
    assert result["keywords"] == ["2026", "年度", "予算案", "ドキュメント"]  # 「Google」は除く語
    assert result["partner_status"] == "not_applicable" and result["partner_reason"] == context.NOT_CHAT_REASON
    assert context.partner_label(result) is None


def test_edge_title_with_an_invisible_character():
    title = "予算の資料 - Microsoft​ Edge"  # Edge のタイトルには U+200B（見えない文字）が入ることがある
    result = parse("msedge.exe", title)
    assert result["app"] == "Edge"
    assert result["page_title"] == "予算の資料"
    assert "​" not in result["page_title"]
    assert parse("msedge.exe", "予算の資料 - Microsoft Edge")["page_title"] == "予算の資料"
    # ページの題名に見えない文字が混ざっていても、取り除く
    assert parse("msedge.exe", "予算​の資料 - Microsoft Edge")["page_title"] == "予算の資料"


def test_new_tab_has_no_keywords():
    assert parse("msedge.exe", "New Tab - Microsoft Edge")["keywords"] == []
    assert parse("chrome.exe", "新しいタブ - Google Chrome")["keywords"] == []


# ---------------------------------------------------------------------- 文書のアプリ、そのほか


def test_office_document_name_is_read_before_the_app_name():
    result = parse("WINWORD.EXE", "予算案.docx [互換モード] - Word")
    assert result["app"] == "Word" and result["category"] == "document"
    assert result["document_name"] == "予算案"
    assert result["keywords"] == ["予算案"]
    assert context.summary_label(result) == "Word（予算案）"
    excel = parse("excel.exe", "予算2026.xlsx - Excel")
    assert excel["document_name"] == "予算2026"
    assert excel["keywords"] == ["予算", "2026"]  # 拡張子（xlsx）は語にしない
    assert parse("excel.exe", "Q3 - 予算.xlsx - Excel")["document_name"] == "Q3 - 予算"
    assert parse("notepad.exe", "*メモ.txt - メモ帳")["document_name"] == "メモ"
    start_screen = parse("winword.exe", "Word")
    assert start_screen["document_name"] is None and start_screen["keywords"] == []
    assert context.summary_label(start_screen) == "Word"


def test_explorer_and_unknown_apps_use_the_title_words():
    explorer = parse("explorer.exe", "予算 - エクスプローラー")
    assert explorer["app"] == "エクスプローラー" and explorer["category"] == "files"
    assert explorer["keywords"] == ["予算"]
    unknown = parse("calc-tool.exe", "Budget_2026 | Tool")
    assert unknown["app"] is None and unknown["category"] == "other"
    assert unknown["keywords"] == ["Budget", "2026", "Tool"]
    assert context.summary_label(unknown) == "calc-tool"
    assert context.summary_label(None) == "作業中のアプリ：不明"


def test_inaccessible_window_keeps_the_app_but_reads_nothing():
    result = parse("slack.exe", "予算2026 (Channel) - 研究室 - Slack", inaccessible=True)
    assert result["app"] == "Slack"
    assert result["inaccessible"] is True
    assert result["partner_status"] == "unavailable"
    assert result["partner_reason"] == context.INACCESSIBLE_REASON
    assert result["conversation"] is None and result["keywords"] == []
    assert context.summary_label(result) == "Slack（内容を読み取れません）"
    elevated = parse("excel.exe", "給与.xlsx - Excel", inaccessible=True)
    assert elevated["app"] == "Excel" and elevated["partner_status"] == "unavailable"
    assert elevated["document_name"] is None and elevated["keywords"] == []


def test_missing_values_in_the_event_are_unknown():
    result = context.parse_foreground({}, rules)
    assert result["app"] is None and result["process"] is None and result["category"] == "other"
    assert result["keywords"] == [] and result["is_file_dialog"] is False and result["at"] is None


# ---------------------------------------------------------------------- ファイルダイアログ


def test_file_dialog_gives_its_window_and_position():
    rect = {"left": 100, "top": 80, "right": 900, "bottom": 600}
    dialog = parse("slack.exe", "開く", hwnd=777, is_file_dialog=True, dialog_rect=rect)
    assert dialog["is_file_dialog"] is True
    assert dialog["dialog_hwnd"] == 777 and dialog["dialog_rect"] == rect
    assert dialog["partner_status"] == "unavailable" and dialog["keywords"] == []
    assert parse("chrome.exe", "開く", is_file_dialog=True)["page_title"] is None
    plain = parse("chrome.exe", "予算 - Google Chrome", dialog_rect=rect)
    assert plain["dialog_hwnd"] is None and plain["dialog_rect"] is None


def test_file_dialog_carries_over_the_previous_context_of_the_same_app():
    before = parse("slack.exe", "予算2026 (Channel) - 研究室 - Slack")
    dialog = parse("slack.exe", "開く", hwnd=777, is_file_dialog=True, dialog_rect={"left": 1})
    merged = context.carry_over(before, dialog)
    assert merged["conversation"] == "予算2026" and merged["keywords"] == ["予算", "2026"]
    assert merged["partner_status"] == "ok"
    assert merged["is_file_dialog"] is True and merged["dialog_hwnd"] == 777
    assert merged["window_title"] == "開く"
    assert context.summary_label(merged) == "Slack（予算2026）・ファイルダイアログ"
    assert dialog["conversation"] is None  # 元の辞書は変えない
    # 別のアプリの文脈は引き継がない
    chrome = parse("chrome.exe", "予算 - Google Chrome")
    assert context.carry_over(chrome, dialog) is dialog
    # ダイアログでなければ、そのまま
    assert context.carry_over(before, chrome) is chrome


# ---------------------------------------------------------------------- 文脈の語


def test_extract_keywords_splits_on_punctuation_brackets_and_separators():
    text = "【会議】打ち合わせ_議事録・2026年度（予算）/ budget | Budget"
    assert context.extract_keywords(text, rules) == ["会議", "打ち合わせ", "議事録", "2026", "年度", "予算", "budget"]


def test_extract_keywords_splits_mixed_tokens():
    assert context.extract_keywords("予算2026", rules) == ["予算", "2026"]
    assert context.extract_keywords("budget2026", rules) == ["budget", "2026"]
    assert context.extract_keywords("データ分析", rules) == ["データ", "分析"]
    assert context.extract_keywords("打ち合わせ", rules) == ["打ち合わせ"]  # 漢字とひらがなの間では分けない


def test_extract_keywords_drops_short_words_and_stop_words_and_keeps_order():
    assert context.extract_keywords("v2 予算 a Slack Google 予算 チャンネル 案", rules) == ["予算"]
    assert context.extract_keywords("ＢＵＤＧＥＴ　２０２６", rules) == ["BUDGET", "2026"]  # 全角は半角にそろえる
    assert context.extract_keywords("", rules) == []
    assert context.extract_keywords(None, rules) == []


def test_contains_word_ignores_case_and_full_width_digits():
    assert context.contains_word("２０２６年度 予算案", "2026")
    assert context.contains_word("BUDGET plan", "budget")
    assert context.contains_word("ＢＵＤＧＥＴ", "Budget")
    assert not context.contains_word("予算案", "決算")
    assert not context.contains_word(None, "予算")


def test_prepared_search_gives_the_same_answers_as_contains_word():
    texts = ["２０２６年度 予算案", "BUDGET plan", "ＢＵＤＧＥＴ", "予算案", "Straße", "", None]
    words = ["2026", "budget", "Budget", "予算", "決算", "STRASSE", "案"]
    for text in texts:
        for word in words:
            prepared = context.prepare_text(text, context.has_case(context.fold(word)))
            found = context.contains_prepared(prepared, context.search_forms(word))
            assert found == context.contains_word(text, word), (text, word)
    assert context.contains_word("ＡＢＣ２０２６", "2026")  # 大文字・小文字のない語は、そろえずに探しても見つかる
    assert context.contains_word("Straße", "STRASSE")
    assert context.search_forms("予算") == ["予算"]  # 全角にしても同じ語は、1回だけ探す
    assert context.search_forms("Budget") == ["budget", "ｂｕｄｇｅｔ"]
    assert context.search_forms("") == []
    assert context.has_case("Budget") and not context.has_case("予算2026")
    assert context.prepare_text("ABC予算", fold_case=False) == "ABC予算"
    assert context.prepare_text("ABC予算") == "abc予算"


def test_find_word_does_not_match_inside_longer_words():
    assert context.find_word("グラフィック", "グラフ") == -1
    assert context.find_word("Online", "line") == -1
    assert context.find_word("青森", "青") == -1
    assert context.find_word("真っ青な空", "青") == 2
    assert context.find_word("LINEで", "line") == 0
    words, rest = context.take_words("青いグラフと青", ["青", "青い", "グラフ"])
    assert words == ["青い", "グラフ", "青"]
    assert rest.strip() == "と"


def test_window_titles_are_not_logged(caplog):
    title = "社外秘プロジェクト (Channel) - 研究室 - Slack"
    with caplog.at_level(logging.DEBUG):
        result = parse(title=title)
        context.summary_label(result)
    assert all("社外秘" not in record.getMessage() for record in caplog.records)
