"""機密かどうかの判定（M5 スマート・ハザードガード）

ドラッグしたファイルに警告を出すかを決めるために、ファイルを次の3つに分けます。

- sensitive（機密）：次のどれかに当てはまる
    1. ファイル名に rules.SENSITIVE_NAME_KEYWORDS の語がある（大文字・小文字は区別しない）
    2. 設定の SENSITIVE_DIRS（機密として登録したフォルダー）の中にある
    3. 本文・タイトルに rules.SENSITIVE_CONTENT_KEYWORDS の語がある
    4. Office の秘密度ラベルの名前に rules.SENSITIVE_LABEL_KEYWORDS の語がある
    5. 本文に、検査用数字が正しい12桁の個人番号（マイナンバー）らしい数字がある
    6. 本文に、Luhn 検査に合格するカード番号らしい数字（13〜19桁）がある
- not_sensitive（非機密）：解析済みで、どの規則にも当てはまらない
- unknown（未判定）：まだ解析していない、解析に失敗した、解析できない形式。
  画像と、文字を取り出せなかった文書（スキャンした PDF など）も、中の文字を調べていないので未判定です
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


def find_keywords(text, keywords):
    """text に含まれる語のリスト（大文字・小文字と全角・半角を区別しない）

    「Confidential」と「CONFIDENTIAL」のように、区別しないと同じになる語は、先に書かれたものだけを返します。
    """
    if not text:
        return []
    folded = normalise(text).lower()
    found = []
    seen = []
    for keyword in keywords:
        folded_keyword = normalise(keyword).lower()
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


def judge_content(analysis, rules):
    """解析の結果（analysis テーブルの行の辞書）で判定し、当てはまった理由のリストを返す

    使う列：text_excerpt（本文）、title（タイトル）、labels_json（秘密度ラベルの名前）
    """
    reasons = []
    text = analysis.get("text_excerpt") or ""
    for keyword in find_keywords(analysis.get("title"), rules.SENSITIVE_CONTENT_KEYWORDS):
        reasons.append(f"タイトルに「{keyword}」")
    for keyword in find_keywords(text, rules.SENSITIVE_CONTENT_KEYWORDS):
        reasons.append(f"本文に「{keyword}」")
    for label in labels_of(analysis):
        if find_keywords(label, rules.SENSITIVE_LABEL_KEYWORDS):
            reasons.append(f"秘密度ラベル「{label}」")
    if rules.DETECT_MY_NUMBER:
        count = len(find_my_numbers(text))
        if count:
            reasons.append(f"本文に、検査用数字が正しい12桁の個人番号らしい数字（{count}件）")
    if rules.DETECT_CARD_NUMBER:
        count = len(find_card_numbers(text))
        if count:
            reasons.append(f"本文に、Luhn 検査に合格するカード番号らしい数字（{count}件）")
    return reasons


def labels_of(analysis):
    """labels_json（JSON の文字列）を、ラベルの名前のリストにする。読めなければ空のリスト"""
    value = analysis.get("labels_json")
    if not value:
        return []
    try:
        labels = json.loads(value)
    except ValueError:
        return []
    if not isinstance(labels, list):
        return []
    return [label for label in labels if isinstance(label, str)]


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


def has_readable_content(analysis):
    """判定に使える文字（本文、タイトル、秘密度ラベル）が1つでもあれば True"""
    text = (analysis.get("text_excerpt") or "").strip()
    title = (analysis.get("title") or "").strip()
    return bool(text or title or labels_of(analysis))


def no_content_reason(analysis):
    if analysis.get("kind") == "image":
        return "対象外の形式（画像の中の文字は読み取らない）のため、中身で判定できません"
    return "本文の文字を取り出せなかったため（スキャンした PDF など）、中身で判定できません"


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
        if not has_readable_content(analysis):
            # 画像や、文字のない PDF（スキャンしたもの）は、中の文字を調べていないので「非機密」とは言えない
            return {"level": "unknown", "reasons": [no_content_reason(analysis)]}
        return {"level": "not_sensitive", "reasons": ["解析済みで、機密の規則に当てはまるものはありません"]}
    if reasons:
        return {"level": "sensitive", "reasons": reasons}

    reason = UNKNOWN_REASONS.get(status, "未解析のため、中身で判定できません（電源接続中かつ3分間無操作のときに解析します）")
    if status in UNKNOWN_REASONS and analysis.get("error"):
        reason += f"（{analysis['error']}）"
    return {"level": "unknown", "reasons": [reason]}
