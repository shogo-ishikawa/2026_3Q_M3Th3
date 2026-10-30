"""作業文脈の読み取り（M2 作業連動・浮上式デスク）

pip0 シェル（C#）は、前面のウィンドウが変わったときと、そのタイトルが変わったときに、
context.foreground の知らせ（プロセス名、ウィンドウタイトル、ファイルダイアログかどうか等）を本体へ送ります。
このモジュールは、その知らせを「作業文脈」の辞書に直します（parse_foreground）。

- アプリの名前と種類：rules.APP_RULES（プロセス名の小文字 → 表示名と種類）
- Slack デスクトップアプリ：ウィンドウタイトルが rules.SLACK_TITLE_PATTERNS のどれかに一致したときだけ、
  会話名（チャンネル名・相手）を読み取ります。一致しなければ「チャット相手：取得不可」とし、推測しません。
  ほかのチャットのアプリ（Teams など）は、タイトルの形を確かめていないため「取得不可」です
- Chrome／Edge：タイトルの末尾（rules.BROWSER_TITLE_SUFFIXES）を除いた、ページの題名
- Word／Excel／PowerPoint など：タイトルの「 - Word」などの前にある、文書の名前
- 文脈の語（keywords）：会話名・ページ題名・文書名から extract_keywords で取り出した語。
  浮上式デスクの順位（desk.py）と、M1 の仕分け先（inflow.py）に使います

ウィンドウタイトルは、その場で使うだけです。DB にもログにも書きません（このモジュールは DB を使いません）。
画面の画像は取得しません。

語の分け方（split_words）と、語を探す関数（find_word、take_words）は、検索（search.py）でも使います。
"""

import os
import re
import unicodedata

# 文脈の辞書の項目（docs/design.md 6-5 の約束に、document_name、dialog_rect、inaccessible を足したもの）
CONTEXT_KEYS = ["app", "category", "process", "window_title", "page_title", "document_name", "conversation",
                "conversation_kind", "workspace", "partner_status", "partner_reason", "keywords",
                "is_file_dialog", "dialog_hwnd", "dialog_rect", "inaccessible", "at"]

# チャット相手（partner_status）の理由
PARTNER_UNAVAILABLE_REASON = "このウィンドウタイトルからは、チャット相手を読み取れません（取得不可）"
INACCESSIBLE_REASON = "管理者として動くアプリなどのため、ウィンドウの内容を読み取れません（取得不可）"
NOT_CHAT_REASON = "チャットのアプリではありません"

# 会話の種類（rules.SLACK_KIND_MAP の値）の表示名
CONVERSATION_KIND_LABELS = {"channel": "チャンネル", "dm": "DM"}

# ★文脈の語として残す、最も短い文字数
MIN_KEYWORD_CHARS = 2

# ★文書のアプリのタイトルで、文書名に付くことがある状態の表示（取り除く）。実機の Office では確かめていません
DOCUMENT_TITLE_MARKERS = ["[互換モード]", "[Compatibility Mode]", "[読み取り専用]", "[Read-Only]",
                          "[保護ビュー]", "[Protected View]"]

# 画面に出す説明（summary_label）の、会話名などの部分の最大の文字数
LABEL_DETAIL_MAX_CHARS = 30

# 空白・記号・括弧・区切りの文字（「・」「_」「-」「|」など）。\W は「文字・数字以外」、_ も区切りにする
WORD_SEPARATORS = re.compile(r"[\W_]+")


# ----------------------------------------------------------------------
# 入口：シェルの知らせ → 作業文脈の辞書
# ----------------------------------------------------------------------


def parse_foreground(event, rules):
    """context.foreground の知らせ（payload の辞書）を、作業文脈の辞書にする

    返す辞書（CONTEXT_KEYS）
    - app、category：rules.APP_RULES の表示名と種類（"chat"、"browser"、"document" など）。知らないアプリは None と "other"
    - process：プロセス名（小文字）
    - window_title：ウィンドウタイトル（メモリーの中だけで使う。保存しない）
    - page_title：ブラウザーのページの題名、document_name：文書のアプリの文書名
    - conversation、conversation_kind（"channel"/"dm"）、workspace：Slack の会話（読めたときだけ）
    - partner_status："ok"（会話名を読めた）、"unavailable"（チャットのアプリだが読めない）、"not_applicable"（チャット以外）
    - keywords：文脈の語のリスト
    - is_file_dialog、dialog_hwnd、dialog_rect：開く・保存のダイアログのとき、その位置
    - inaccessible：管理者として動くアプリなど、内容を読めないウィンドウなら True
    """
    process = str(event.get("process_name") or "").strip().lower()
    app_rule = rules.APP_RULES.get(process)
    context = {
        "app": app_rule["label"] if app_rule else None,
        "category": app_rule["category"] if app_rule else "other",
        "process": process or None,
        "window_title": event.get("window_title") or None,
        "page_title": None,
        "document_name": None,
        "conversation": None,
        "conversation_kind": None,
        "workspace": None,
        "partner_status": "not_applicable",
        "partner_reason": NOT_CHAT_REASON,
        "keywords": [],
        "is_file_dialog": event.get("is_file_dialog") is True,
        "dialog_hwnd": None,
        "dialog_rect": None,
        "inaccessible": event.get("inaccessible") is True,
        "at": event.get("at"),
    }
    if context["is_file_dialog"]:
        context["dialog_hwnd"] = event.get("hwnd")
        context["dialog_rect"] = event.get("dialog_rect")

    if context["inaccessible"]:
        # 管理者として動くアプリなど：アプリの名前だけ分かる。タイトルは読まない
        context["partner_status"] = "unavailable"
        context["partner_reason"] = INACCESSIBLE_REASON
        return context

    title = str(context["window_title"] or "").strip()
    category = context["category"]
    if category == "chat":
        read_chat_title(context, title, rules)
    elif context["is_file_dialog"]:
        # ダイアログのタイトル（「開く」など）は、作業の内容を表さないので読まない（carry_over を参照）
        pass
    elif category == "browser":
        context["page_title"] = page_title_of(title, rules)
        context["keywords"] = extract_keywords(context["page_title"], rules)
    elif category == "document":
        context["document_name"] = document_name_of(title, rules)
        context["keywords"] = extract_keywords(context["document_name"], rules)
    else:
        # エクスプローラー（フォルダー名）、メール、知らないアプリ：タイトルの語をそのまま使う
        context["keywords"] = extract_keywords(remove_app_suffix(title, context["app"]), rules)
    return context


def read_chat_title(context, title, rules):
    """チャットのアプリのタイトルから、会話名を読む。読めなければ「取得不可」にする（推測しない）

    ★今はタイトルの形を確かめた Slack だけを読みます。ほかのアプリを読むには、rules.py に規則を足して、ここを直します。
    """
    patterns = rules.SLACK_TITLE_PATTERNS if context["app"] == "Slack" else []
    if not context["is_file_dialog"]:
        for pattern in patterns:
            match = re.match(pattern, title)
            if match is None:
                continue
            groups = match.groupdict()
            conversation = tidy(groups.get("conversation"))
            if not conversation:
                continue
            kind = groups.get("kind")
            context["conversation"] = conversation
            context["conversation_kind"] = rules.SLACK_KIND_MAP.get(kind) if kind else None
            context["workspace"] = tidy(groups.get("workspace")) or None
            context["partner_status"] = "ok"
            context["partner_reason"] = ""
            context["keywords"] = extract_keywords(conversation, rules)
            return
    context["partner_status"] = "unavailable"
    context["partner_reason"] = PARTNER_UNAVAILABLE_REASON


def page_title_of(title, rules):
    """ブラウザーのタイトルから、末尾のブラウザー名を除いたページの題名。空なら None

    Edge のタイトルには見えない文字（U+200B）が入ることがあるため、rules.BROWSER_TITLE_SUFFIXES には
    その文字を含むものと含まないものの両方があります。
    """
    for suffix in rules.BROWSER_TITLE_SUFFIXES:
        if title.endswith(suffix):
            title = title[:-len(suffix)]
            break
    return tidy(title) or None


def document_name_of(title, rules):
    """文書のアプリのタイトル（「予算案.docx - Word」）から、文書名（「予算案」）を取り出す。読めなければ None

    最後の「 - 」から後ろをアプリの名前として除き、状態の表示（[互換モード] など）、
    保存していない印（先頭の *）、拡張子（rules.FILE_KINDS にあるもの）を除きます。
    """
    if " - " not in title:
        return None  # 「Word」だけのタイトル（起動画面など）には、文書名がない
    name = title.rsplit(" - ", 1)[0]
    for marker in DOCUMENT_TITLE_MARKERS:
        name = name.replace(marker, "")
    name = tidy(name).lstrip("*").strip()
    stem, ext = os.path.splitext(name)
    if stem and ext.lower() in rules.FILE_KINDS:
        name = stem
    return name or None


def remove_app_suffix(title, app_label):
    """「予算 - エクスプローラー」のように、末尾にアプリの表示名があれば除く"""
    if app_label and title.endswith(" - " + app_label):
        return title[:-len(" - " + app_label)]
    return title


def tidy(text):
    """見えない書式用の文字（U+200B など）を除き、空白をまとめる"""
    if text is None:
        return ""
    kept = []
    for ch in str(text):
        if unicodedata.category(ch) != "Cf":
            kept.append(ch)
    return " ".join("".join(kept).split())


# ----------------------------------------------------------------------
# 文脈の語
# ----------------------------------------------------------------------


def extract_keywords(text, rules):
    """会話名・ページ題名・文書名から、文脈の語のリストを取り出す（形態素解析は使わない簡単な方法）

    1. split_words で語に分ける（空白・記号・括弧・区切りで分け、「予算2026」は「予算」と「2026」に分ける）
    2. MIN_KEYWORD_CHARS（2）文字未満の語と、rules.CONTEXT_STOP_WORDS の語（「Slack」など）を除く
    3. 同じ語（大文字・小文字の違いだけのものを含む）は、最初の1つだけを残す。順番は元の文のまま
    """
    if not text:
        return []
    stop = stop_word_set(rules)
    keywords = []
    seen = set()
    for word in split_words(text):
        key = fold(word)
        if len(word) < MIN_KEYWORD_CHARS or key in stop or key in seen:
            continue
        seen.add(key)
        keywords.append(word)
    return keywords


def stop_word_set(rules):
    """rules.CONTEXT_STOP_WORDS を、split_words と同じ方法で分けた語の集合にする（「New Tab」→ new、tab）"""
    stop = set()
    for phrase in rules.CONTEXT_STOP_WORDS:
        for word in split_words(phrase):
            stop.add(fold(word))
    return stop


def split_words(text):
    """文字列を語に分ける（★語の分け方を変えたいときは、ここを直します）

    1. 全角の英数字を半角に、半角カナを全角にそろえる（NFKC）
    2. 空白・記号・括弧・区切りの文字で分ける
    3. 文字の種類（数字、英字、カタカナ、それ以外）が変わる所で分ける
       例：「予算2026」→「予算」「2026」、「2026年度予算WG」→「2026」「年度予算」「WG」
    漢字とひらがなの間では分けません（「打ち合わせ」を1語のまま残すため）。
    """
    words = []
    for piece in WORD_SEPARATORS.split(normalise(text)):
        if piece:
            words.extend(split_by_character_type(piece))
    return words


def split_by_character_type(piece):
    """文字の種類が変わる所で分ける（数字・英字・カタカナ・それ以外の4つのまとまり）"""
    parts = []
    current = ""
    current_group = None
    for ch in piece:
        group = split_group(ch)
        if current and group != current_group:
            parts.append(current)
            current = ""
        current += ch
        current_group = group
    if current:
        parts.append(current)
    return parts


def split_group(ch):
    """split_by_character_type で使う、文字のまとまり。漢字とひらがなは同じまとまり"""
    kind = character_type(ch)
    if kind in ("digit", "latin", "katakana"):
        return kind
    return "text"


def character_type(ch):
    """1文字の種類："digit"（数字）、"latin"（英字）、"hiragana"、"katakana"、"kanji"、"other"（それ以外）"""
    if ch.isascii() and ch.isdigit():
        return "digit"
    if ch.isascii() and ch.isalpha():
        return "latin"
    if "ぁ" <= ch <= "ゟ":
        return "hiragana"
    if "゠" <= ch <= "ヿ":
        return "katakana"  # 長音の「ー」も含む
    if "一" <= ch <= "鿿" or ch in "々〆":
        return "kanji"
    return "other"


# ----------------------------------------------------------------------
# 比べる・探す（search.py でも使う）
# ----------------------------------------------------------------------


def normalise(text):
    """比べる前に文字の形をそろえる（全角の英数字を半角に、半角カナを全角に。NFKC）"""
    return unicodedata.normalize("NFKC", str(text or ""))


def fold(text):
    """比べるための形：normalise したうえで、英字の大文字・小文字の違いも無くす"""
    return normalise(text).casefold()


def to_fullwidth(text):
    """半角の英数字・記号を、全角にする（「2026」→「２０２６」）"""
    converted = []
    for ch in text:
        if "!" <= ch <= "~":
            converted.append(chr(ord(ch) + 0xFEE0))
        else:
            converted.append(ch)
    return "".join(converted)


def contains_word(text, word):
    """text の中に word があれば True（英字の大文字・小文字と、英数字の全角・半角の違いは無視する）

    長い本文（解析した本文は最大2万文字）でも速く調べられるように、本文の側は NFKC で直さず、
    探す語を半角と全角の2つの形にして探します。
    """
    if not text or not word:
        return False
    haystack = str(text).casefold()
    needle = fold(word)
    return needle in haystack or to_fullwidth(needle) in haystack


def ascii_lower(text):
    """英字（A〜Z）だけを小文字にする。文字数が変わらないので、見つけた位置をそのまま使える"""
    return text.translate(ASCII_LOWER_TABLE)


ASCII_LOWER_TABLE = {code: code + 32 for code in range(ord("A"), ord("Z") + 1)}


def find_word(text, word):
    """text の中で word が「1つの語として」現れる最初の位置。なければ -1（英字の大文字・小文字は区別しない）

    前後の文字とつながって、より長い語の一部になっているものは数えません（stands_alone）。
    例：「グラフィック」の中の「グラフ」、「Online」の中の「line」、「青森」の中の「青」は数えない。
    """
    if not word:
        return -1
    haystack = ascii_lower(text)
    needle = ascii_lower(word)
    start = haystack.find(needle)
    while start >= 0:
        if stands_alone(text, start, start + len(needle)):
            return start
        start = haystack.find(needle, start + 1)
    return -1


def stands_alone(text, start, end):
    """text[start:end] の語が、前後の文字とつながった、より長い語の一部でなければ True

    ★つながっているとみなす組（ここを変えると、検索の言葉の見つけ方が変わります）
    - 英数字どうし（「LINE」と「Online」）
    - カタカナどうし（「グラフ」と「グラフィック」）、ひらがなどうし（「の」と「きのこ」）
    - 1文字の漢字の語と、漢字（「青」と「青森」、「表」と「発表」）
    """
    word = text[start:end]
    before = text[start - 1] if start > 0 else " "
    after = text[end] if end < len(text) else " "
    return not joined(before, word[0], len(word)) and not joined(after, word[-1], len(word))


def joined(neighbour, edge, word_length):
    """隣の文字 neighbour と、語の端の文字 edge が、1つの語としてつながっているなら True"""
    neighbour_type = character_type(neighbour)
    edge_type = character_type(edge)
    if edge_type in ("digit", "latin"):
        return neighbour_type in ("digit", "latin")
    if edge_type in ("katakana", "hiragana"):
        return neighbour_type == edge_type
    if edge_type == "kanji" and word_length == 1:
        return neighbour_type == "kanji"
    return False


def blank_out(text, start, end):
    """text の start〜end の部分を、同じ文字数の空白に置き換える（見つけた語を、残りの文から消す）"""
    return text[:start] + " " * (end - start) + text[end:]


def take_words(text, words, whole_word=True):
    """text の中から words の語を探して取り除く。(見つけた語のリスト, 残りの文) を返す

    - 長い語から順に探す（「青い」を「青」より先に見つけるため）
    - whole_word が True なら find_word（語の一部は数えない）、False なら単純な部分一致で探す
    - 見つけた語のリストは、文の中に出てきた順。残りの文では、見つけた所を空白にする
    """
    found = []
    # 長い語から順に（同じ長さなら文字の順に。結果が毎回同じになるように）
    for word in sorted(set(normalise(word) for word in words), key=lambda item: (-len(item), item)):
        if not word:
            continue
        while True:
            if whole_word:
                index = find_word(text, word)
            else:
                index = ascii_lower(text).find(ascii_lower(word))
            if index < 0:
                break
            found.append((index, word))
            text = blank_out(text, index, index + len(word))
    found.sort()
    return [word for _, word in found], text


# ----------------------------------------------------------------------
# ファイルダイアログと、画面に出す説明
# ----------------------------------------------------------------------


def carry_over(previous, current):
    """ファイルダイアログ（開く・保存）が前面になったとき、同じアプリの直前の文脈を引き継ぐ

    ダイアログのタイトルは「開く」などで、会話名やページ題名を読めないためです。
    previous が、同じプロセスの、ダイアログでない文脈のときだけ引き継ぎます。それ以外は current をそのまま返します。
    ダイアログの位置（dialog_hwnd、dialog_rect）とタイトルは current のものを使います。
    """
    if not current or not current.get("is_file_dialog") or not previous:
        return current
    if previous.get("is_file_dialog") or previous.get("process") != current.get("process"):
        return current
    if previous.get("inaccessible"):
        return current
    merged = dict(current)
    for key in ["page_title", "document_name", "conversation", "conversation_kind", "workspace",
                "partner_status", "partner_reason"]:
        merged[key] = previous.get(key)
    merged["keywords"] = list(previous.get("keywords") or [])
    return merged


def summary_label(context):
    """画面に出す、作業文脈の短い説明（例：「Slack（予算2026）」）。DB とログには書かない"""
    if not context:
        return "作業中のアプリ：不明"
    app = context.get("app") or app_name_from_process(context.get("process")) or "名前の分からないアプリ"
    if context.get("inaccessible"):
        detail = "内容を読み取れません"
    elif context.get("conversation"):
        detail = context["conversation"]
    elif context.get("category") == "chat":
        detail = "チャット相手：取得不可"
    else:
        detail = context.get("page_title") or context.get("document_name")
    label = f"{app}（{shorten(detail, LABEL_DETAIL_MAX_CHARS)}）" if detail else app
    if context.get("is_file_dialog"):
        label += "・ファイルダイアログ"
    return label


def partner_label(context):
    """チャット相手の表示（例：「チャット相手：予算2026（チャンネル）」）。チャット以外は None"""
    if not context or context.get("category") != "chat":
        return None
    if context.get("partner_status") != "ok":
        return "チャット相手：取得不可"
    kind = CONVERSATION_KIND_LABELS.get(context.get("conversation_kind"))
    name = shorten(context.get("conversation"), LABEL_DETAIL_MAX_CHARS)
    return f"チャット相手：{name}（{kind}）" if kind else f"チャット相手：{name}"


def app_name_from_process(process):
    """「notepad++.exe」→「notepad++」。分からなければ None"""
    if not process:
        return None
    name = process[:-4] if process.endswith(".exe") else process
    return name or None


def shorten(text, max_chars):
    """長い文字列を max_chars 文字までにする（切ったときは最後を「…」にする）"""
    text = " ".join(str(text or "").split())
    if len(text) <= max_chars:
        return text
    return text[:max_chars - 1] + "…"
