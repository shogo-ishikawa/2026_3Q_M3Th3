"""機密かどうかの判定（M5 スマート・ハザードガード）

ドラッグしたファイルに警告を出すかを決めるために、ファイルを次の3つに分けます。

- sensitive（機密）：次のどれかに当てはまる
    1. ファイル名に rules.SENSITIVE_NAME_KEYWORDS の語がある（大文字・小文字は区別しない）
    2. 設定の SENSITIVE_DIRS（機密として登録したフォルダー）の中にある
    3. 本文・タイトルに rules.SENSITIVE_CONTENT_KEYWORDS の語がある
    4. Office の秘密度ラベルの名前に rules.SENSITIVE_LABEL_KEYWORDS の語がある
    5. 本文に、検査用数字が正しい12桁の個人番号（マイナンバー）らしい数字がある
    6. 本文に、Luhn 検査に合格するカード番号らしい数字（13〜19桁）がある
  3・5・6 の「本文」は、解析のときに読んだ文字の全体です。Office 文書のヘッダー・フッター、脚注、コメント、
  スライドマスター、ノート、Word の透かし、PDF の注釈とフォームの入力欄なども調べます（analyse_text.py）。
  DB に保存する本文は先頭の TEXT_MAX_CHARS 文字だけなので、全体で見つけたもの（[場所, 規則, 値]。番号そのものは
  含まない）と、そのときの中身の規則を、解析のときに保存しておきます。
  判定のときは、見つけたもののうち今の規則にもあるものと、保存した本文の先頭を今の規則で調べ直した結果を使います
  （rules.py の語を外せばすぐに理由から消え、語を加えれば本文の先頭ではすぐに見つかります）。
- not_sensitive（非機密）：解析済みで、本文を読めて、文書の全体を今の規則で調べ、どの規則にも当てはまらない
- unknown（未判定）：まだ解析していない、解析に失敗した、解析できない形式。
  画像と、本文の文字を取り出せなかった文書（スキャンした PDF など。タイトルがあっても）も、中の文字を調べて
  いないので未判定です。上限（PDF のページ数など）で一部しか読まなかった文書と、解析の後に中身の規則へ語などを
  加え、まだ解析し直していない文書も未判定です（加えた規則は、本文の先頭でしか調べていないため）
  （1・2 の名前と場所の規則に当てはまれば、解析していなくても機密です）

未判定を非機密とは扱いません。判定の理由には、見つかった番号そのものは書きません。

ここでの判定は、警告を出すための目安です。送信を止める機能（DLP）ではありません。
"""

import json
import os
import re
import unicodedata

from pip0 import config as config_module

# 12桁の数字、または4桁ずつ空白かハイフンで区切った12桁の数字。前後にさらに数字が続くものは除く
MY_NUMBER_PATTERN = re.compile(
    r"(?<![0-9])(?<![0-9][ -])(?:[0-9]{12}|[0-9]{4}[ -][0-9]{4}[ -][0-9]{4})(?![ -]?[0-9])")
# 13〜19桁の数字（数字の間に空白かハイフンが1つ入ってもよい）。前後にさらに数字が続くものは除く
CARD_NUMBER_PATTERN = re.compile(r"(?<![0-9])(?<![0-9][ -])[0-9](?:[ -]?[0-9]){12,18}(?![ -]?[0-9])")

# 個人番号の検査用数字の計算に使う重み（Q_n）。n は「最初の11桁の、右から n 番目」
MY_NUMBER_WEIGHTS = [n + 1 if n <= 6 else n - 5 for n in range(1, 12)]  # [2, 3, 4, 5, 6, 7, 2, 3, 4, 5, 6]

# 番号を探すとき、ハイフン（-）と同じに扱う記号（日本語の入力では「1234ー5678」のように長音の記号も使われる）
HYPHEN_LIKE = str.maketrans({ch: "-" for ch in "‐‑‒–—−ー"})


def normalise(text):
    """全角の英数字・記号を半角に、半角カナを全角にそろえる（NFKC）。比べる前に使う"""
    return unicodedata.normalize("NFKC", text)


def normalise_numbers(text):
    """番号を探すための形にする：全角を半角にし（NFKC）、ハイフンに似た記号を「-」にそろえる"""
    return normalise(text or "").translate(HYPHEN_LIKE)


def fold(text):
    """語を比べるための形（全角・半角をそろえ、小文字にする）"""
    return normalise(text).lower()


def find_keywords(text, keywords):
    """text に含まれる語のリスト（大文字・小文字と全角・半角を区別しない）

    「Confidential」と「CONFIDENTIAL」のように、区別しないと同じになる語は、先に書かれたものだけを返します。
    """
    if not text:
        return []
    folded = fold(text)
    found = []
    seen = []
    for keyword in keywords:
        folded_keyword = fold(keyword)
        if folded_keyword in folded and folded_keyword not in seen:
            seen.append(folded_keyword)
            found.append(keyword)
    return found


# ----------------------------------------------------------------------
# 名前と場所
# ----------------------------------------------------------------------


def judge_name(path, config, rules):
    """ファイル名と置き場所で判定し、当てはまった理由のリストを返す（なければ空のリスト）"""
    reasons = []
    name = os.path.basename(os.fspath(path))
    for keyword in find_keywords(name, rules.SENSITIVE_NAME_KEYWORDS):
        reasons.append(f"名前に「{keyword}」")
    for folder in config.get("SENSITIVE_DIRS") or []:
        if config_module.is_inside(path, folder):
            reasons.append("機密として登録したフォルダー（SENSITIVE_DIRS）の中")
            break
    return reasons


# ----------------------------------------------------------------------
# 中身（解析の結果）
# ----------------------------------------------------------------------


def find_in_text(text, rules, place="本文"):
    """文字（本文、ヘッダーなど）を、中身の規則（機密の語、個人番号、カード番号）で調べ、見つけたもののリストを返す

    place：理由に書く場所の名前（「本文」「ヘッダー」「ノート」など）
    見つけたもの1つは [場所, 規則, 値] のリストです（番号そのものは入れません）：
      [場所, "keyword", 語]        機密の語（rules.SENSITIVE_CONTENT_KEYWORDS に書かれたとおりの語）
      [場所, "my_number", 件数]    検査用数字が正しい12桁の個人番号らしい数字
      [場所, "card_number", 件数]  Luhn 検査に合格するカード番号らしい数字
    解析のとき（analysis_queue.analyse_file）に、読んだ文字の全体を場所ごとに調べ、DB に保存するのに使います。
    """
    found = []
    for keyword in find_keywords(text, rules.SENSITIVE_CONTENT_KEYWORDS):
        found.append([place, "keyword", keyword])
    if rules.DETECT_MY_NUMBER:
        count = len(find_my_numbers(text))
        if count:
            found.append([place, "my_number", count])
    if rules.DETECT_CARD_NUMBER:
        count = len(find_card_numbers(text))
        if count:
            found.append([place, "card_number", count])
    return found


def reason_text(finding):
    """見つけたもの [場所, 規則, 値] を、判定の理由の文にする（番号そのものは書かない）"""
    place, rule, value = finding
    if rule == "keyword":
        return f"{place}に「{value}」"
    if rule == "my_number":
        return f"{place}に、検査用数字が正しい12桁の個人番号らしい数字（{value}件）"
    return f"{place}に、Luhn 検査に合格するカード番号らしい数字（{value}件）"


def still_a_rule(finding, rules):
    """解析のときに見つけたもの [場所, 規則, 値] が、今の規則でも機密の理由になるなら True

    解析の後に SENSITIVE_CONTENT_KEYWORDS から外した語や、False にした番号の検査（DETECT_…）は、理由にしません。
    """
    place, rule, value = finding
    if rule == "keyword":
        return fold(value) in [fold(keyword) for keyword in rules.SENSITIVE_CONTENT_KEYWORDS]
    if rule == "my_number":
        return bool(rules.DETECT_MY_NUMBER)
    return bool(rules.DETECT_CARD_NUMBER)


def same_check(first, second):
    """2つの見つけたものが、同じ場所の同じ検査なら True（語は同じ語のとき。番号は件数が違っても同じ検査）"""
    if first[0] != second[0] or first[1] != second[1]:
        return False
    if first[1] == "keyword":
        return fold(first[2]) == fold(second[2])
    return True


def judge_content(analysis, rules):
    """解析の結果（analysis テーブルの行の辞書）で判定し、当てはまった理由のリストを返す

    - title（タイトル）と labels_json（秘密度ラベルの名前）：今の規則で調べる
    - content_reasons_json（解析のときに、本文の全体とヘッダー・フッター・ノートなどで見つけたもの）：
      今の規則にもあるものだけを使う（解析の後に規則から外した語は、理由にしない）
    - text_excerpt（保存した本文の先頭）：今の規則で調べ直す（解析の後に規則へ加えた語も見つける。
      content_reasons_json がない、前の版の pip0 の解析も、ここで調べる）
    本文の全体で数えた件数があれば、それを使います（本文の先頭で数え直した件数と、2つ並べない）。
    """
    reasons = []
    for keyword in find_keywords(analysis.get("title"), rules.SENSITIVE_CONTENT_KEYWORDS):
        reasons.append(f"タイトルに「{keyword}」")
    found = []
    for finding in stored_content_reasons(analysis) or []:
        if still_a_rule(finding, rules):
            found.append(finding)
    for finding in find_in_text(analysis.get("text_excerpt"), rules):
        if not any(same_check(finding, earlier) for earlier in found):
            found.append(finding)  # 解析のときには調べていなかった規則（後から加えた語など）で見つけた
    for finding in found:
        reasons.append(reason_text(finding))
    for label in labels_of(analysis):
        if find_keywords(label, rules.SENSITIVE_LABEL_KEYWORDS):
            reasons.append(f"秘密度ラベル「{label}」")
    return reasons


def json_value(value):
    """JSON の文字列を読む。値がない、または読めなければ None"""
    if value is None:
        return None
    try:
        return json.loads(value)
    except ValueError:
        return None


def json_list(value):
    """JSON の文字列を、文字列のリストにする。値がない、または読めなければ None"""
    items = json_value(value)
    if not isinstance(items, list):
        return None
    return [item for item in items if isinstance(item, str)]


def labels_of(analysis):
    """labels_json（JSON の文字列）を、ラベルの名前のリストにする。読めなければ空のリスト"""
    return json_list(analysis.get("labels_json")) or []


def is_finding(item):
    """[場所, 規則, 値] の形なら True（DB から読んだ値を確かめる）"""
    if not isinstance(item, list) or len(item) != 3 or not isinstance(item[0], str):
        return False
    if item[1] == "keyword":
        return isinstance(item[2], str)
    return item[1] in ("my_number", "card_number") and isinstance(item[2], int)


def stored_content_reasons(analysis):
    """解析のときに、読んだ文字の全体で見つけたもの（content_reasons_json。[場所, 規則, 値] のリスト）

    記録がなければ None。形の合わないものは除きます。
    """
    items = json_value(analysis.get("content_reasons_json"))
    if not isinstance(items, list):
        return None
    return [item for item in items if is_finding(item)]


def content_rules(rules):
    """中身の規則（機密の語と、個人番号・カード番号の検査）。解析の結果と一緒に保存し、後で規則を変えたかを確かめる"""
    return {"keywords": list(rules.SENSITIVE_CONTENT_KEYWORDS), "my_number": bool(rules.DETECT_MY_NUMBER),
            "card_number": bool(rules.DETECT_CARD_NUMBER)}


def rules_added_after_analysis(analysis, rules):
    """解析の後に、中身の規則へ加えたもの（語と番号の検査）の名前のリスト

    加えたものがなければ空のリスト。解析のときの規則の記録（content_rules_json）がなければ None。
    """
    used = json_value(analysis.get("content_rules_json"))
    if not isinstance(used, dict):
        return None
    known = [fold(keyword) for keyword in used.get("keywords") or [] if isinstance(keyword, str)]
    added = []
    for keyword in rules.SENSITIVE_CONTENT_KEYWORDS:
        if fold(keyword) not in known:
            added.append(f"「{keyword}」")
            known.append(fold(keyword))  # 大文字・小文字だけが違う語は、1回だけ書く
    if rules.DETECT_MY_NUMBER and not used.get("my_number"):
        added.append("個人番号の検査")
    if rules.DETECT_CARD_NUMBER and not used.get("card_number"):
        added.append("カード番号の検査")
    return added


def unread_parts(analysis):
    """解析で読まなかった部分の説明のリスト（unread_json）。全体を読んだら空のリスト、記録がなければ None"""
    return json_list(analysis.get("unread_json"))


# ----------------------------------------------------------------------
# 個人番号（マイナンバー）とカード番号
# ----------------------------------------------------------------------


def digits_only(text):
    """空白とハイフンを除く（「1234 5678-9018」→「123456789018」）"""
    return text.replace(" ", "").replace("-", "")


def is_valid_my_number(digits):
    """12桁の個人番号の、最後の1桁（検査用数字）が正しければ True

    計算方法（個人番号の検査用数字の計算方法）：
      P_n：最初の11桁の、右から n 番目の数字（n = 1〜11）
      Q_n：n が 1〜6 のとき n + 1、7〜11 のとき n − 5
      r = (P_1×Q_1 + … + P_11×Q_11) を 11 で割った余り
      検査用数字 = r が 0 か 1 なら 0、それ以外なら 11 − r
    """
    digits = digits_only(str(digits))
    if len(digits) != 12 or not digits.isascii() or not digits.isdigit():
        return False
    first_eleven = digits[:11]
    total = 0
    for n in range(1, 12):
        p = int(first_eleven[-n])  # 右から n 番目
        total += p * MY_NUMBER_WEIGHTS[n - 1]
    remainder = total % 11
    check = 0 if remainder <= 1 else 11 - remainder
    return check == int(digits[11])


def luhn_ok(digits):
    """Luhn 検査（カード番号などの検査用数字）に合格すれば True

    右から数えて2番目、4番目、…の数字を2倍し（10以上なら9を引く）、すべての数字を足して、10で割り切れれば合格。
    """
    digits = digits_only(str(digits))
    if not digits or not digits.isascii() or not digits.isdigit():
        return False
    total = 0
    for position, ch in enumerate(reversed(digits)):
        value = int(ch)
        if position % 2 == 1:
            value *= 2
            if value > 9:
                value -= 9
        total += value
    return total % 10 == 0


def all_same_digit(digits):
    """「000000000000」のように、すべて同じ数字なら True（見本やダミーの数字が多いため除く）"""
    return len(set(digits)) == 1


def find_my_numbers(text):
    """本文の中の、検査用数字が正しい12桁の個人番号らしい数字のリスト（空白・ハイフンを除いた形）"""
    found = []
    for match in MY_NUMBER_PATTERN.finditer(normalise_numbers(text)):
        digits = digits_only(match.group(0))
        if not all_same_digit(digits) and is_valid_my_number(digits):
            found.append(digits)
    return found


def find_card_numbers(text):
    """本文の中の、Luhn 検査に合格する13〜19桁のカード番号らしい数字のリスト"""
    found = []
    for match in CARD_NUMBER_PATTERN.finditer(normalise_numbers(text)):
        digits = digits_only(match.group(0))
        if 13 <= len(digits) <= 19 and not all_same_digit(digits) and luhn_ok(digits):
            found.append(digits)
    return found


# ----------------------------------------------------------------------
# まとめの判定
# ----------------------------------------------------------------------


def has_body_text(analysis):
    """本文の文字を取り出せていれば True

    タイトルと秘密度ラベルは、機密の理由を加えるだけです。それだけでは本文を調べたことにならないため
    （例：タイトルの付いた、スキャンした PDF）、本文がなければ「非機密」とは言いません。
    """
    return bool((analysis.get("text_excerpt") or "").strip())


def no_content_reason(analysis):
    if analysis.get("kind") == "image":
        return "対象外の形式（画像の中の文字は読み取らない）のため、中身で判定できません"
    return "本文の文字を取り出せなかったため（スキャンした PDF など）、中身で判定できません"


def partly_read_reason(analysis):
    """文書の一部しか読んでいないときの、未判定の理由。全体を読んでいれば None"""
    unread = unread_parts(analysis)
    if unread is None:
        return "どこまで読んだかの記録がない解析（pip0 の前の版）のため、非機密とは言えません"
    if unread:
        return "文書の一部しか調べていないため、非機密とは言えません（調べていない部分：" + "、".join(unread) + "）"
    return None


def new_rules_reason(analysis, rules):
    """解析の後に中身の規則へ語などを加えたときの、未判定の理由。加えていなければ None

    解析のときに読んだ文字の全体は保存していないため、加えた規則は、解析し直すまで、保存した本文の先頭・タイトル・
    ラベルでしか調べられません（analysis_queue.requeue_for_rule_changes で、解析し直す順番待ちに入れます）。
    """
    added = rules_added_after_analysis(analysis, rules)
    if added is None:
        return "どの規則で調べたかの記録がない解析（pip0 の前の版）のため、非機密とは言えません"
    if added:
        return ("解析の後に機密の規則へ加えたもの（" + "、".join(added) + "）は、まだ文書の全体では調べていないため、"
                "非機密とは言えません（解析し直すと、全体を調べます）")
    return None


# 解析の状態 → 未判定の理由
UNKNOWN_REASONS = {
    "failed": "解析に失敗したため、中身で判定できません",
    "unsupported": "対象外の形式のため、中身で判定できません",
}


def overall(path, analysis, config, rules):
    """機密の判定をまとめる

    analysis：analysis テーブルの行（辞書）か None（索引にない、まだ行がない）
    返す辞書：{"level": "sensitive"/"not_sensitive"/"unknown", "reasons": [理由の文字列]}
    """
    reasons = judge_name(path, config, rules)
    status = analysis.get("status") if analysis else None
    if status == "done":
        reasons += judge_content(analysis, rules)
        if reasons:
            return {"level": "sensitive", "reasons": reasons}
        if not has_body_text(analysis):
            # 画像や、文字のない PDF（スキャンしたもの）は、中の文字を調べていないので「非機密」とは言えない
            # （タイトルやラベルがあっても、本文は調べていない）
            return {"level": "unknown", "reasons": [no_content_reason(analysis)]}
        partly_read = partly_read_reason(analysis)
        if partly_read is not None:
            # 上限で読むのをやめた部分（PDF の後ろのページなど）は調べていないので「非機密」とは言えない
            return {"level": "unknown", "reasons": [partly_read]}
        new_rules = new_rules_reason(analysis, rules)
        if new_rules is not None:
            # 解析の後に規則へ加えた語などは、本文の先頭でしか調べていないので「非機密」とは言えない
            return {"level": "unknown", "reasons": [new_rules]}
        return {"level": "not_sensitive", "reasons": ["解析済みで、機密の規則に当てはまるものはありません"]}
    if reasons:
        return {"level": "sensitive", "reasons": reasons}

    reason = UNKNOWN_REASONS.get(status, "未解析のため、中身で判定できません（電源接続中かつ3分間無操作のときに解析します）")
    if status in UNKNOWN_REASONS and analysis.get("error"):
        reason += f"（{analysis['error']}）"
    return {"level": "unknown", "reasons": [reason]}
