"""機密の判定（sensitivity.py）のテスト

個人番号とカード番号は、実在しない例（計算で作った番号、カード会社が公開しているテスト用の番号）だけを使います。
"""

import json
import random
import types

import pytest

from pip0 import rules, sensitivity


def rules_with(**changes):
    """rules の値を一部だけ変えた、テスト用の規則"""
    values = {name: getattr(rules, name) for name in dir(rules) if name.isupper()}
    values.update(changes)
    return types.SimpleNamespace(**values)


def analysis_row(status="done", text="", title=None, labels=None, error=None, unread=(), content_reasons=None,
                 used_rules=rules):
    """analysis テーブルの行（辞書）の形

    unread：読まなかった部分の説明（空なら全体を読んだ。None は記録のない古い行）
    content_reasons：解析のときに読んだ文字の全体で見つけたもの [場所, 規則, 値] のリスト
                     （None は記録のない行。本文の先頭 text だけを調べる）
    used_rules：解析のときの規則（content_rules_json に書く。None は記録のない古い行）
    """
    def as_json(value):
        return json.dumps(list(value), ensure_ascii=False) if value is not None else None

    rules_json = None
    if used_rules is not None:
        rules_json = json.dumps(sensitivity.content_rules(used_rules), ensure_ascii=False)
    return {"status": status, "text_excerpt": text, "title": title, "labels_json": as_json(labels), "error": error,
            "unread_json": as_json(unread), "content_reasons_json": as_json(content_reasons),
            "content_rules_json": rules_json}


def independent_check_digit(first_eleven):
    """検査用数字を、左から順に重みを掛ける形で計算する（sensitivity の実装とは別の書き方で確かめる）

    右から n 番目の重み Q_n（1〜6 は n+1、7〜11 は n−5）を、左から並べると 6,5,4,3,2,7,6,5,4,3,2 になる。
    """
    weights_from_left = [6, 5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
    total = sum(int(digit) * weight for digit, weight in zip(first_eleven, weights_from_left))
    remainder = total % 11
    return 0 if remainder <= 1 else 11 - remainder


# ---------------------------------------------------------------------- 個人番号の検査用数字


def test_my_number_check_digit_examples_computed_by_hand():
    # 12345678901：1×6+2×5+3×4+4×3+5×2+6×7+7×6+8×5+9×4+0×3+1×2 = 212、212 mod 11 = 3 → 11−3 = 8
    assert sensitivity.is_valid_my_number("123456789018")
    assert not sensitivity.is_valid_my_number("123456789012")
    # 11111111111：重みの合計 47、47 mod 11 = 3 → 8
    assert sensitivity.is_valid_my_number("111111111118")
    # 00000000001：1×2 = 2 → 11−2 = 9
    assert sensitivity.is_valid_my_number("000000000019")
    # 00000000006：6×2 = 12、12 mod 11 = 1 → 余りが1以下なので 0
    assert sensitivity.is_valid_my_number("000000000060")
    assert not sensitivity.is_valid_my_number("000000000061")
    # 区切りの空白・ハイフンは無視する
    assert sensitivity.is_valid_my_number("1234 5678-9018")


@pytest.mark.parametrize("value", ["", "12345678901", "1234567890189", "12345678901a", "１２３４５６７８９０１８"])
def test_my_number_needs_exactly_twelve_ascii_digits(value):
    assert not sensitivity.is_valid_my_number(value)


def test_my_number_matches_an_independent_calculation():
    rnd = random.Random(2026)
    for _ in range(500):
        first_eleven = "".join(rnd.choice("0123456789") for _ in range(11))
        valid_digits = [d for d in range(10) if sensitivity.is_valid_my_number(first_eleven + str(d))]
        assert valid_digits == [independent_check_digit(first_eleven)]


def test_my_number_weights_follow_the_definition():
    assert sensitivity.MY_NUMBER_WEIGHTS == [2, 3, 4, 5, 6, 7, 2, 3, 4, 5, 6]


# ---------------------------------------------------------------------- Luhn


@pytest.mark.parametrize("number", ["79927398713", "4111111111111111", "4012888888881881", "5555 5555 5555 4444",
                                    "3782-822463-10005"])
def test_luhn_accepts_valid_numbers(number):
    assert sensitivity.luhn_ok(number)


@pytest.mark.parametrize("number", ["79927398710", "4111111111111112", "5555555555554445", "", "4111x111"])
def test_luhn_rejects_invalid_numbers(number):
    assert not sensitivity.luhn_ok(number)


# ---------------------------------------------------------------------- 本文から番号を探す


@pytest.mark.parametrize("text", [
    "マイナンバー：123456789018",
    "番号 1234 5678 9018 を記入",
    "1234-5678-9018",
    "個人番号は１２３４５６７８９０１８です",   # 全角の数字
    "１２３４－５６７８－９０１８",             # 全角の数字とハイフン
    "１２３４ー５６７８ー９０１８",             # 長音の記号（日本語の入力でよく使われる）
    "1234−5678−9018",                          # マイナスの記号
])
def test_my_numbers_are_found(text):
    assert sensitivity.find_my_numbers(text) == ["123456789018"]


@pytest.mark.parametrize("text", [
    "123456789012",                    # 検査用数字が違う
    "9123456789018",                   # もっと長い数字の一部
    "1234567890189",
    "1234 5678 9018 5555",             # 4桁の組が続く（カード番号などの一部）
    "03 1234 5678 9018",
    "000000000000",                    # すべて同じ数字（見本）
    "12345678 9018",                   # 区切りの位置が違う
])
def test_numbers_that_are_not_my_numbers(text):
    assert sensitivity.find_my_numbers(text) == []


def test_card_numbers_are_found():
    assert sensitivity.find_card_numbers("カード番号 4111-1111-1111-1111 有効期限") == ["4111111111111111"]
    assert sensitivity.find_card_numbers("5555 5555 5555 4444") == ["5555555555554444"]
    assert sensitivity.find_card_numbers("Amex 378282246310005.") == ["378282246310005"]
    assert sensitivity.find_card_numbers("４１１１ー１１１１ー１１１１ー１１１１") == ["4111111111111111"]


@pytest.mark.parametrize("text", [
    "4111111111111112",                 # Luhn 検査に不合格
    "0000 0000 0000 0000",              # すべて同じ数字
    "41111111111111110000",             # 20桁（長すぎる。もっと長い数字の一部）
    "注文番号 123456789012",             # 12桁（短い）
])
def test_numbers_that_are_not_card_numbers(text):
    assert sensitivity.find_card_numbers(text) == []


# ---------------------------------------------------------------------- 名前と場所


def test_name_keywords_ignore_case_and_width(env, tmp_path):
    assert sensitivity.judge_name(tmp_path / "社外秘_予算.xlsx", env, rules) == ["名前に「社外秘」"]
    assert sensitivity.judge_name(tmp_path / "Report-CONFIDENTIAL.pdf", env, rules) == ["名前に「confidential」"]
    assert sensitivity.judge_name(tmp_path / "ＳＥＣＲＥＴ.docx", env, rules) == ["名前に「secret」"]
    assert sensitivity.judge_name(tmp_path / "予算案.xlsx", env, rules) == []


def test_only_the_file_name_is_checked_not_the_folders(env, tmp_path):
    folder = tmp_path / "secret-agent"  # 例：ユーザー名のフォルダーに語が含まれても、中のファイルすべてを機密にしない
    assert sensitivity.judge_name(folder / "予算.xlsx", env, rules) == []


def test_sensitive_dirs(env, tmp_path):
    secret_dir = tmp_path / "人事"
    secret_dir.mkdir()
    config = dict(env, SENSITIVE_DIRS=[secret_dir])
    reasons = sensitivity.judge_name(secret_dir / "sub" / "a.txt", config, rules)
    assert reasons == ["機密として登録したフォルダー（SENSITIVE_DIRS）の中"]
    assert sensitivity.judge_name(tmp_path / "人事以外" / "a.txt", config, rules) == []


# ---------------------------------------------------------------------- 中身


def test_content_keywords_title_and_labels():
    row = analysis_row(text="この資料は社外秘です", title="【極秘】計画", labels=["Highly Confidential"])
    reasons = sensitivity.judge_content(row, rules)
    assert "タイトルに「極秘」" in reasons
    assert "本文に「社外秘」" in reasons
    assert "秘密度ラベル「Highly Confidential」" in reasons


def test_public_label_and_plain_text_are_not_sensitive():
    row = analysis_row(text="2026年度 予算案", title="予算", labels=["Public", "General"])
    assert sensitivity.judge_content(row, rules) == []


def test_number_reasons_never_quote_the_number():
    row = analysis_row(text="氏名欄 123456789018 / カード 4111 1111 1111 1111")
    reasons = sensitivity.judge_content(row, rules)
    assert "本文に、検査用数字が正しい12桁の個人番号らしい数字（1件）" in reasons
    assert "本文に、Luhn 検査に合格するカード番号らしい数字（1件）" in reasons
    joined = "".join(reasons)
    assert "123456789018" not in joined and "4111" not in joined and "9018" not in joined


def test_number_detection_can_be_switched_off():
    row = analysis_row(text="123456789018 4111111111111111")
    quiet = rules_with(DETECT_MY_NUMBER=False, DETECT_CARD_NUMBER=False)
    assert sensitivity.judge_content(row, quiet) == []


def test_broken_labels_json_is_ignored():
    row = analysis_row(text="本文")
    row["labels_json"] = "{not json"
    assert sensitivity.judge_content(row, rules) == []


# ---------------------------------------------------------------------- まとめの判定


def test_unanalysed_file_is_unknown_not_safe(env, tmp_path):
    for analysis in [None, analysis_row(status="pending")]:
        verdict = sensitivity.overall(tmp_path / "予算.xlsx", analysis, env, rules)
        assert verdict["level"] == "unknown"
        assert verdict["reasons"][0].startswith("未解析")


def test_sensitive_name_wins_even_without_analysis(env, tmp_path):
    verdict = sensitivity.overall(tmp_path / "機密_名簿.xlsx", None, env, rules)
    assert verdict == {"level": "sensitive", "reasons": ["名前に「機密」"]}


def test_failed_and_unsupported_analysis_are_unknown(env, tmp_path):
    failed = sensitivity.overall(tmp_path / "a.docx", analysis_row(status="failed", error="壊れています"), env, rules)
    assert failed["level"] == "unknown"
    assert failed["reasons"][0].startswith("解析に失敗") and "壊れています" in failed["reasons"][0]
    unsupported = sensitivity.overall(tmp_path / "a.doc", analysis_row(status="unsupported"), env, rules)
    assert unsupported["level"] == "unknown"
    assert unsupported["reasons"][0].startswith("対象外の形式")


def test_images_and_files_without_text_are_unknown(env, tmp_path):
    image = dict(analysis_row(text=None, unread=None), kind="image")
    verdict = sensitivity.overall(tmp_path / "Screenshot 1.png", image, env, rules)
    assert verdict["level"] == "unknown"
    assert verdict["reasons"][0].startswith("対象外の形式")
    scanned = dict(analysis_row(text=""), kind="pdf")
    verdict = sensitivity.overall(tmp_path / "scan_0001.pdf", scanned, env, rules)
    assert verdict["level"] == "unknown"
    assert "取り出せなかった" in verdict["reasons"][0]
    named = sensitivity.overall(tmp_path / "社外秘_スクショ.png", image, env, rules)
    assert named["level"] == "sensitive"


def test_a_title_or_label_without_body_text_is_not_enough_to_be_safe(env, tmp_path):
    # スキャンした PDF（ページは画像だけ）に、文書のタイトルだけが付いている：本文は調べていない
    scanned = dict(analysis_row(text="", title="給与明細 2026年10月"), kind="pdf")
    verdict = sensitivity.overall(tmp_path / "scan_0001.pdf", scanned, env, rules)
    assert verdict["level"] == "unknown" and "取り出せなかった" in verdict["reasons"][0]
    labelled = dict(analysis_row(text="", labels=["General"]), kind="document")
    assert sensitivity.overall(tmp_path / "a.docx", labelled, env, rules)["level"] == "unknown"
    # タイトルやラベルが機密の規則に当てはまれば、本文がなくても機密
    titled = dict(analysis_row(text="", title="【社外秘】給与明細"), kind="pdf")
    assert sensitivity.overall(tmp_path / "scan_0002.pdf", titled, env, rules)["reasons"] == ["タイトルに「社外秘」"]


def test_analysed_files_are_sensitive_or_not(env, tmp_path):
    clean = sensitivity.overall(tmp_path / "予算.xlsx", analysis_row(text="2026年度 予算案"), env, rules)
    assert clean["level"] == "not_sensitive"
    assert clean["reasons"]
    hit = sensitivity.overall(tmp_path / "予算.xlsx", analysis_row(text="マイナンバー 1234 5678 9018"), env, rules)
    assert hit["level"] == "sensitive"
    both = sensitivity.overall(tmp_path / "社外秘.docx", analysis_row(text="CONFIDENTIAL"), env, rules)
    assert both["reasons"] == ["名前に「社外秘」", "本文に「Confidential」"]


# ---------------------------------------------------------------------- 読んだ範囲（一部しか読まなかった文書）


def test_find_in_text_names_the_place_and_never_keeps_the_number():
    text = "社外秘 / 番号 1234-5678-9018 / カード 4111 1111 1111 1111"
    found = sensitivity.find_in_text(text, rules, "ヘッダー")
    assert found == [["ヘッダー", "keyword", "社外秘"], ["ヘッダー", "my_number", 1], ["ヘッダー", "card_number", 1]]
    assert [sensitivity.reason_text(finding) for finding in found] == [
        "ヘッダーに「社外秘」",
        "ヘッダーに、検査用数字が正しい12桁の個人番号らしい数字（1件）",
        "ヘッダーに、Luhn 検査に合格するカード番号らしい数字（1件）"]
    assert "9018" not in json.dumps(found) and "4111" not in json.dumps(found)
    assert sensitivity.find_in_text("2026年度 予算案", rules) == []
    assert sensitivity.find_in_text(None, rules) == []


def test_reasons_found_in_the_whole_text_at_analysis_time_are_used(env, tmp_path):
    # 保存した本文の先頭には何もないが、解析のときに全体（ヘッダーなど）を調べて見つけたものが残っている
    row = analysis_row(text="売上の推移", content_reasons=[["ヘッダー", "keyword", "社外秘"]])
    verdict = sensitivity.overall(tmp_path / "四半期報告.docx", row, env, rules)
    assert verdict == {"level": "sensitive", "reasons": ["ヘッダーに「社外秘」"]}
    # 全体で数えた件数を使い、本文の先頭で数え直した件数の理由を重ねない（件数の違う理由が2つ並ばないように）
    counted = analysis_row(text="番号 123456789018", content_reasons=[["本文", "my_number", 3]])
    assert sensitivity.judge_content(counted, rules) == ["本文に、検査用数字が正しい12桁の個人番号らしい数字（3件）"]
    # タイトルとラベルは、今の規則で調べ直す
    titled = analysis_row(text="本文", title="【極秘】計画", labels=["Confidential"], content_reasons=[])
    assert sensitivity.judge_content(titled, rules) == ["タイトルに「極秘」", "秘密度ラベル「Confidential」"]


def test_rules_edited_after_analysis_take_effect_without_reanalysis(env, tmp_path):
    # 解析したときの規則（used_rules）と、今の規則（rules.py を書き換えた後）が違う
    keywords = list(rules.SENSITIVE_CONTENT_KEYWORDS)
    path = tmp_path / "打ち合わせメモ.txt"
    # 語を加えた：保存した本文の先頭は、今の規則で調べ直すので、すぐに見つかる
    row = analysis_row(text="この資料はマル秘です", content_reasons=[])
    verdict = sensitivity.overall(path, row, env, rules_with(SENSITIVE_CONTENT_KEYWORDS=keywords + ["マル秘"]))
    assert verdict == {"level": "sensitive", "reasons": ["本文に「マル秘」"]}
    # 番号の検査を後から True にした（解析のときは False）
    quiet = rules_with(DETECT_CARD_NUMBER=False)
    row = analysis_row(text="カード 4111 1111 1111 1111", content_reasons=[], used_rules=quiet)
    assert sensitivity.overall(path, row, env, rules)["reasons"] == [
        "本文に、Luhn 検査に合格するカード番号らしい数字（1件）"]
    # 語を外した・検査を止めた：解析のときに見つけたもの（ヘッダーの語、本文の全体の番号）も、すぐに理由から消える
    row = analysis_row(text="取扱注意", content_reasons=[["本文", "keyword", "取扱注意"], ["フッター", "my_number", 2]])
    removed = rules_with(SENSITIVE_CONTENT_KEYWORDS=[k for k in keywords if k != "取扱注意"], DETECT_MY_NUMBER=False)
    assert sensitivity.overall(path, row, env, removed)["level"] == "not_sensitive"
    # 外していない規則で見つけたものは残る（ほかの語を外しても、ヘッダーの「社外秘」で機密のまま）
    row = analysis_row(text="売上の推移", content_reasons=[["ヘッダー", "keyword", "社外秘"]])
    assert sensitivity.overall(path, row, env, removed)["reasons"] == ["ヘッダーに「社外秘」"]


def test_rules_added_after_analysis_make_a_clean_document_unknown(env, tmp_path):
    # 加えた語が本文の先頭になくても、保存していない部分（後ろの本文、ヘッダーなど）にあるかもしれない
    row = analysis_row(text="2026年度 予算案", content_reasons=[])
    added = rules_with(SENSITIVE_CONTENT_KEYWORDS=list(rules.SENSITIVE_CONTENT_KEYWORDS) + ["人事評価", "人事評価"])
    verdict = sensitivity.overall(tmp_path / "予算.docx", row, env, added)
    assert verdict["level"] == "unknown"
    assert verdict["reasons"] == [
        "解析の後に機密の規則へ加えたもの（「人事評価」）は、まだ文書の全体では調べていないため、"
        "非機密とは言えません（解析し直すと、全体を調べます）"]
    off = analysis_row(text="2026年度 予算案", content_reasons=[], used_rules=rules_with(DETECT_MY_NUMBER=False))
    assert "個人番号の検査" in sensitivity.overall(tmp_path / "予算.docx", off, env, rules)["reasons"][0]
    # 規則の記録がない解析（前の版）も、非機密とは言わない
    unrecorded = analysis_row(text="2026年度 予算案", content_reasons=[], used_rules=None)
    assert sensitivity.overall(tmp_path / "予算.docx", unrecorded, env, rules)["level"] == "unknown"
    # 大文字・小文字を変えただけ、語を外しただけなら、解析し直さなくても非機密のまま
    renamed = [keyword.upper() for keyword in rules.SENSITIVE_CONTENT_KEYWORDS if keyword != "極秘"]
    assert sensitivity.overall(tmp_path / "予算.docx", row, env,
                               rules_with(SENSITIVE_CONTENT_KEYWORDS=renamed))["level"] == "not_sensitive"


def test_stored_findings_in_an_unexpected_shape_are_ignored(env, tmp_path):
    row = analysis_row(text="売上の推移", content_reasons=[["ヘッダー", "keyword", "社外秘"]])
    row["content_reasons_json"] = json.dumps(["ヘッダーに「社外秘」", ["本文", "keyword", 3], ["本文", "x", "y"],
                                              ["フッター", "card_number", 1]], ensure_ascii=False)
    assert sensitivity.judge_content(row, rules) == ["フッターに、Luhn 検査に合格するカード番号らしい数字（1件）"]
    row["content_reasons_json"] = "{not json"
    assert sensitivity.judge_content(row, rules) == []


def test_partly_read_documents_are_unknown_not_safe(env, tmp_path):
    row = analysis_row(text="2026年度 予算案", unread=["21〜25ページ"])
    verdict = sensitivity.overall(tmp_path / "handbook.pdf", row, env, rules)
    reason = "文書の一部しか調べていないため、非機密とは言えません（調べていない部分：21〜25ページ）"
    assert verdict == {"level": "unknown", "reasons": [reason]}
    # 一部しか読んでいなくても、読んだ部分で当てはまれば機密
    hit = analysis_row(text="社外秘", unread=["21〜25ページ"], content_reasons=[["本文", "keyword", "社外秘"]])
    assert sensitivity.overall(tmp_path / "handbook.pdf", hit, env, rules)["level"] == "sensitive"


def test_analysis_without_a_record_of_what_was_read_is_unknown(env, tmp_path):
    # 前の版の pip0 の解析（読んだ範囲の記録がない）は、全体を読んだか分からないので非機密としない
    old = analysis_row(text="2026年度 予算案", unread=None)
    verdict = sensitivity.overall(tmp_path / "予算.xlsx", old, env, rules)
    assert verdict["level"] == "unknown"
    assert verdict["reasons"][0].startswith("どこまで読んだかの記録がない")
    broken = dict(analysis_row(text="2026年度 予算案"), unread_json="{not json")
    assert sensitivity.overall(tmp_path / "予算.xlsx", broken, env, rules)["level"] == "unknown"
    # 本文の先頭に機密の語があれば、記録がなくても機密
    old_hit = analysis_row(text="社外秘の資料", unread=None)
    assert sensitivity.overall(tmp_path / "a.docx", old_hit, env, rules)["reasons"] == ["本文に「社外秘」"]
