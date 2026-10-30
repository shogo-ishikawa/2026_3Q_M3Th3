"""新しい名前「日付_内容_送信元」を考える（M1 の自動改名。学生の呼称でいう「リバース翻訳」）

ダウンロードしたファイルの名前が「download (3).pdf」「IMG_0001.png」のように意味の分からないものなら、
「2026-10-29_予算案_Slack.pdf」のように、いつ・何を・どこから入手したかが分かる名前を考えます。
このモジュールは名前を考えるだけで、ファイルには触りません（実際の改名は inflow.py が fileops.py で行います）。

名前の3つの部分と、その根拠（docs/design.md 4-3）
- 日付：ダウンロード完了日を、端末の現地時刻の YYYY-MM-DD にしたもの
- 内容：次の順で、最初に見つかったもの
    1. 文書のタイトル（Office 文書の docProps/core.xml、PDF の文書情報）。ダウンロード直後に軽く読んだもの
    2. 解析（高負荷の処理）で得た文書のタイトル
    3. 画像の解析結果から作った説明（例：「青いグラフ」）
  どれもなければ「解析待ち」（status="needs_analysis"）。解析しても分からなければ、
  送信元が分かるときは「内容不明」、送信元も分からないときは改名しない（status="keep"）
- 送信元：ブラウザー拡張の記録か、Windows のダウンロード元情報（Zone.Identifier）から分かった名前（例：Slack）。
  分からなければ「送信元不明」（推測で決めない。provenance.determine_source を参照）

拡張子は元のまま残し、Windows で使えない文字や予約名は safe_names で直します。
同じ名前のファイルがあるときの「 (2)」は、移動・改名するとき（fileops.py）に付けます。
"""

import json
import re

from pip0 import safe_names, timeutil

# 名前の部分をつなぐ文字
SEPARATOR = "_"

UNKNOWN_SOURCE = "送信元不明"
UNKNOWN_CONTENT = "内容不明"

# ★ 送信元の部分の最大文字数（ホスト名の主要部分は長いことがあるため）
SOURCE_MAX_CHARS = 40

# 解析が終わった（これ以上、内容の手掛かりが増えない）とみなす analysis テーブルの状態
ANALYSIS_FINISHED_STATES = ["done", "failed", "unsupported"]

# ★ 根拠の文（ミニドックと操作履歴に出ます）
DATE_EVIDENCE = "ダウンロード完了日（端末の現地時刻）"
TITLE_EVIDENCE = {
    "office_core": "Office の文書のタイトル",
    "pdf_info": "PDF の文書情報のタイトル",
}
ANALYSIS_TITLE_EVIDENCE = "解析で得た文書のタイトル"
NO_SOURCE_RECORD = "ダウンロードの記録なし"

# ★ 画像の説明に使う言葉。色の名前は analyse_image.COLOUR_NAMES と同じ
COLOUR_ADJECTIVES = {
    "red": "赤い", "orange": "オレンジ色の", "yellow": "黄色い", "green": "緑の",
    "cyan": "水色の", "blue": "青い", "purple": "紫の", "pink": "ピンクの",
}
COLOUR_LABELS = {
    "red": "赤系", "orange": "橙系", "yellow": "黄系", "green": "緑系",
    "cyan": "水色系", "blue": "青系", "purple": "紫系", "pink": "ピンク系",
}
VISUAL_KIND_NOUNS = {"chart": "グラフ", "photo": "写真"}
IMAGE_NOUN = "画像"


# ----------------------------------------------------------------------
# 意味の分からない名前か
# ----------------------------------------------------------------------


def is_meaningless(stem, rules):
    """拡張子を除いた名前が、意味の分からない名前かを調べる

    rules.MEANINGLESS_NAME_PATTERNS のどれかに一致すれば (True, 一致した規則)、
    一致しなければ (False, None) を返す。Windows のファイル名と同じく、大文字・小文字は区別しない。
    """
    text = stem.strip()
    if text == "":
        return False, None
    for pattern in rules.MEANINGLESS_NAME_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            return True, pattern
    return False, None


# ----------------------------------------------------------------------
# 名前を組み立てる
# ----------------------------------------------------------------------


def build_name(date_str, content, source_label, ext):
    """「日付_内容_送信元」に拡張子 ext を付けた名前を、Windows で使える形にして返す

    例：build_name("2026-10-29", "予算案", "Slack", ".pdf") → "2026-10-29_予算案_Slack.pdf"
    - 禁止文字（< > : " / \\ | ? *）は全角の文字に、制御文字は空白にする（safe_names.clean_part）
    - 空の部分は飛ばす。予約名（CON など）と末尾の点・空白は safe_names.make_safe で避ける
    - 拡張子は渡されたまま使う（大文字・小文字も変えない）
    """
    parts = []
    for part in (date_str, content, source_label):
        cleaned = clean_name_part(part)
        if cleaned:
            parts.append(cleaned)
    return safe_names.make_safe(SEPARATOR.join(parts) + (ext or ""))


def clean_name_part(text):
    """名前の一部にする文字列を整える（禁止文字の置き換え、空白をまとめる、前後の点と空白を除く）"""
    if text is None:
        return ""
    return safe_names.clean_part(str(text)).strip(" .")


def cut(text, max_chars):
    """max_chars 文字までに切り、切った所の点と空白を除く"""
    return text[:max_chars].strip(" .")


# ----------------------------------------------------------------------
# 新しい名前の提案
# ----------------------------------------------------------------------


def propose_name(original_name, light_meta, source, completed_at, analysis, config, rules):
    """ダウンロードしたファイルの新しい名前を考える（ファイルには触らない）

    original_name：今の名前（例："download (3).pdf"）
    light_meta：analyse_text.light_metadata の結果（ダウンロード直後に軽く読んだタイトル）。なければ None
    source：provenance.determine_source の結果（少なくとも "label" と "evidence"）。なければ None
    completed_at：ダウンロード完了の時刻（秒）。拡張機能の終了時刻、なければ pip0 が完了を確かめた時刻
    analysis：analysis テーブルの行（辞書）。まだなければ None

    戻り値：{"rename", "new_name", "status", "parts", "evidence", "reason"}
    - status："ready"（すぐに改名できる）、"needs_analysis"（内容は解析の後に決める）、"keep"（改名しない）
    - rename：今すぐ改名するなら True（status が "ready" のときだけ）
    - parts：{"date", "content", "source"}（分かった部分。分からない部分は None）
    - evidence：{"date", "content", "source"}（それぞれの根拠の文）
    """
    stem, ext = safe_names.split_ext(original_name)
    result = {
        "rename": False,
        "new_name": None,
        "status": "keep",
        "parts": {"date": None, "content": None, "source": None},
        "evidence": {"date": None, "content": None, "source": None},
        "reason": "",
    }
    meaningless, _pattern = is_meaningless(stem, rules)
    if not meaningless:
        result["reason"] = "意味のある名前のため、改名しません"
        return result

    # 日付：ダウンロード完了日（端末の現地時刻）
    result["parts"]["date"] = timeutil.local_date_str(completed_at)
    result["evidence"]["date"] = DATE_EVIDENCE

    # 送信元：記録から分かった名前。分からなければ「送信元不明」（推測しない）
    source = source or {}
    source_label = clean_name_part(source.get("label"))
    if source_label:
        result["parts"]["source"] = cut(source_label, SOURCE_MAX_CHARS)
    else:
        result["parts"]["source"] = UNKNOWN_SOURCE
    result["evidence"]["source"] = source.get("evidence") or NO_SOURCE_RECORD

    # 内容：文書のタイトル → 解析で得たタイトル → 画像の説明
    content, content_evidence = find_content(light_meta, analysis, config, rules)
    if content is None:
        if not analysis_finished(analysis):
            result["status"] = "needs_analysis"
            result["evidence"]["content"] = "解析待ち（文書のタイトルが分からないため、中身の解析の後に決めます）"
            result["reason"] = "内容が分かってから（解析の後に）改名します"
            return result
        if not source_label:
            result["evidence"]["content"] = "解析しても内容が分かりませんでした"
            result["reason"] = "内容も送信元も分からないため、元の名前のままにします"
            return result
        content = UNKNOWN_CONTENT
        content_evidence = "解析しても内容が分からなかったため"

    result["parts"]["content"] = content
    result["evidence"]["content"] = content_evidence
    result["new_name"] = build_name(result["parts"]["date"], content, result["parts"]["source"], ext)
    result["rename"] = True
    result["status"] = "ready"
    result["reason"] = "意味の分からない名前のため、「日付_内容_送信元」の形に改名します"
    return result


def analysis_finished(analysis):
    """解析が終わっていれば True（解析できた・失敗した・対象外の形式だった）"""
    return analysis is not None and analysis.get("status") in ANALYSIS_FINISHED_STATES


# ----------------------------------------------------------------------
# 「内容」の部分を探す（★内容の手掛かりを増やすときは、ここに足します）
# ----------------------------------------------------------------------


def find_content(light_meta, analysis, config, rules):
    """「内容」の部分を探し、(内容, 根拠) を返す。見つからなければ (None, None)"""
    max_chars = config["CONTENT_MAX_CHARS"]

    # 1. ダウンロード直後に軽く読んだ、文書のタイトル
    if light_meta is not None and light_meta.get("status") == "done":
        title = usable_title(light_meta.get("title"), max_chars, rules)
        if title is not None:
            return title, TITLE_EVIDENCE.get(light_meta.get("source"), "文書のタイトル")

    if analysis is None or analysis.get("status") != "done":
        return None, None

    # 2. 解析で得た文書のタイトル
    title = usable_title(analysis.get("title"), max_chars, rules)
    if title is not None:
        return title, ANALYSIS_TITLE_EVIDENCE

    # 3. 画像の解析結果から作った説明（例：「青いグラフ」）
    return describe_image(analysis, config)


def usable_title(title, max_chars, rules):
    """タイトルを名前に使える形に整える。使えないタイトル（空、記号だけ、意味の分からないもの）は None"""
    if not title:
        return None
    text = cut(clean_name_part(title), max_chars)
    if not any(ch.isalnum() for ch in text):
        return None  # 空、または記号だけ
    meaningless, _pattern = is_meaningless(text, rules)
    if meaningless:
        return None  # 「untitled」「無題」のような、ファイル名なら意味不明とみなすタイトルは、内容を表さない
    return text


def describe_image(analysis, config):
    """画像の解析結果から「青いグラフ」「赤い写真」「画像」のような説明を作る。(説明, 根拠)

    色は、色付きの部分のうち最も多い色。色付きの部分が少ない（COLOUR_MIN_COLOURFUL 未満）か、
    最も多い色でも COLOUR_MIN_SHARE 未満のときは、色を付けない。画像の解析結果でなければ (None, None)。
    """
    if analysis.get("kind") != "image":
        return None, None
    visual_kind = analysis.get("visual_kind")
    noun = VISUAL_KIND_NOUNS.get(visual_kind, IMAGE_NOUN)
    found = dominant_colour(analysis, config)

    details = []
    if found is None:
        description = noun
    else:
        colour, share = found
        description = COLOUR_ADJECTIVES[colour] + noun
        details.append(f"色：{COLOUR_LABELS[colour]} {round(share * 100)}%")
    if visual_kind == "chart" and analysis.get("chart_score") is not None:
        details.append(f"グラフらしさ {analysis['chart_score']:.2f}")
    elif visual_kind == "photo":
        details.append("写真らしい（色数が多い）")
    if details:
        return description, "画像の解析（" + "、".join(details) + "）"
    return description, "画像の解析"


def dominant_colour(analysis, config):
    """色付きの部分のうち最も多い色と、その割合 (色の名前, 割合)。色を名乗れなければ None"""
    colourful_ratio = analysis.get("colourful_ratio")
    if colourful_ratio is None or colourful_ratio < config["COLOUR_MIN_COLOURFUL"]:
        return None
    best_colour = None
    best_share = 0.0
    for colour, share in read_colours(analysis).items():
        if colour in COLOUR_ADJECTIVES and isinstance(share, (int, float)) and share > best_share:
            best_colour = colour
            best_share = share
    if best_colour is None or best_share < config["COLOUR_MIN_SHARE"]:
        return None
    return best_colour, best_share


def read_colours(analysis):
    """色の割合の辞書 {"blue": 0.62, ...} を取り出す（analysis テーブルの colours_json は JSON の文字列）"""
    colours = analysis.get("colours")
    if isinstance(colours, dict):
        return colours
    text = analysis.get("colours_json")
    if not text:
        return {}
    try:
        value = json.loads(text)
    except ValueError:
        return {}
    if isinstance(value, dict):
        return value
    return {}
