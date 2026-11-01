"""時刻の扱い（端末の現地時刻とタイムゾーンに従う）

DB には「1970年1月1日からの秒数」（UTC の基準、time.time() の値）を保存します。
表示や「先週」などの範囲は、端末の現地時刻に直してから計算します。
datetime.fromtimestamp() と、タイムゾーンなしの datetime の .timestamp() は、
OS の現地時刻の設定（夏時間を含む）で変換されます。
"""

import re
import time
from datetime import datetime, timedelta

WEEKDAY_NAMES = ["月", "火", "水", "木", "金", "土", "日"]

# 漢数字を含む「3日前」「三週間前」などの数を読むための表
KANJI_DIGITS = {"〇": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}


def now():
    return time.time()


EPOCH = datetime(1970, 1, 1)  # 秒数の起点（UTC）


def to_local(ts):
    """秒数 → 現地時刻の datetime（タイムゾーンなし）

    Windows は 1970年より前の時刻を OS の機能で変換できない（OSError になる）ため、
    そのときは今の時差で計算します（夏時間の違いは考えません）。
    暦で表せないほど大きな値は、表せる最小・最大の日時にそろえます。
    """
    try:
        return datetime.fromtimestamp(ts)
    except (OSError, OverflowError, ValueError):
        pass
    try:
        return EPOCH + timedelta(seconds=ts) + utc_offset_now()
    except OverflowError:
        return datetime.min if ts < 0 else datetime.max


def from_local(dt):
    """現地時刻の datetime（タイムゾーンなし）→ 秒数（1970年より前は、to_local と同じく今の時差で計算する）"""
    try:
        return dt.timestamp()
    except (OSError, OverflowError, ValueError):
        return (dt - EPOCH - utc_offset_now()).total_seconds()


def utc_offset_now():
    """今の現地時刻と UTC の差（日本なら +9 時間）"""
    return datetime.now().astimezone().utcoffset()


def local_date_str(ts):
    return to_local(ts).strftime("%Y-%m-%d")


def local_datetime_str(ts):
    return to_local(ts).strftime("%Y-%m-%d %H:%M")


def date_label(dt):
    """2026-10-19（月）の形にする"""
    return f"{dt.strftime('%Y-%m-%d')}（{WEEKDAY_NAMES[dt.weekday()]}）"


def start_of_day(dt):
    return dt.replace(hour=0, minute=0, second=0, microsecond=0)


def start_of_week(dt, week_starts_on=0):
    """dt を含む週の始まり（0時）。week_starts_on は 0=月曜 … 6=日曜"""
    days_back = (dt.weekday() - week_starts_on) % 7
    return start_of_day(dt) - timedelta(days=days_back)


def start_of_month(dt):
    return start_of_day(dt).replace(day=1)


def add_months(dt, months):
    """月を足す（日は1日にそろえる）"""
    month_index = dt.year * 12 + (dt.month - 1) + months
    return dt.replace(year=month_index // 12, month=month_index % 12 + 1, day=1)


def start_of_fiscal_year(dt, start_month):
    """dt を含む年度の始まり（start_month 月1日の0時）

    例：start_month が 4（4月始まり）なら、2026-10-29 → 2026-04-01、2027-02-10 → 2026-04-01
    """
    year = dt.year if dt.month >= start_month else dt.year - 1
    return start_of_day(dt).replace(year=year, month=start_month, day=1)


def parse_number(text):
    """「3」「３」「三」「十二」を整数にする。読めなければ None"""
    text = text.translate(str.maketrans("０１２３４５６７８９", "0123456789"))
    if text.isdigit():
        return int(text)
    if all(ch in KANJI_DIGITS for ch in text) and text:
        if "十" in text:
            before, _, after = text.partition("十")
            tens = KANJI_DIGITS.get(before, 1) if before else 1
            ones = KANJI_DIGITS.get(after, 0) if after else 0
            return tens * 10 + ones
        if len(text) == 1:
            return KANJI_DIGITS[text]
    return None


def make_period(word, start_dt, end_dt, span):
    """範囲 [start, end) を辞書にする。end は含まない"""
    last_day = end_dt - timedelta(days=1)
    if start_dt.date() == last_day.date():
        label = f"{word}（{date_label(start_dt)}）"
    else:
        label = f"{word}（{date_label(start_dt)}〜{date_label(last_day)}）"
    return {
        "word": word,
        "start": from_local(start_dt),
        "end": from_local(end_dt),
        "label": label,
        "span": span,
    }


NUMBER = r"([0-9０-９]+|[一二三四五六七八九十]+)"
RELATIVE_PATTERNS = [
    (NUMBER + r"日前", "days"),
    (NUMBER + r"週間前", "weeks"),
    (NUMBER + r"[かヵヶカケ]月前", "months"),
]
# ★時期の言葉。長い言葉は、その一部の短い言葉より先に並べる（「一昨年」を「昨年」より、「今年度」を「今年」より先に）
#   「今月度」「先月度」は、会社などで月ごとの区切りを表す言葉。暦の「今月」「先月」と同じ範囲にする（締め日は考えない）
FIXED_WORDS = ["先々週", "一昨日", "おととい", "今日", "本日", "昨日", "今週", "先週",
               "先々月度", "今月度", "先月度", "先々月", "今月", "先月",
               "今年度", "昨年度", "前年度", "一昨年", "おととし", "今年", "去年", "昨年", "最近"]
# ★時期の言葉のすぐ後ろにこの文字があれば、別の言葉の一部とみなす（「今年度」の中の「今年」は、暦の年ではない）。
#   「度」の付いた言葉で時期として使うもの（「今年度」「今月度」）は、FIXED_WORDS に別の言葉として書きます
WORD_EXTENDING_SUFFIXES = ["度"]


def is_kanji(ch):
    """1文字が漢字（「々」を含む）なら True。空の文字列は False"""
    return ch != "" and ("一" <= ch <= "鿿" or ch == "々")


def find_fixed_word(text, word):
    """text の中で、時期の言葉 word が別の言葉の一部になっていない、最初の位置。なければ -1

    別の言葉の一部とみなすもの
    - 漢字で始まる言葉の、すぐ前が漢字：「一昨年」の中の「昨年」、「日本日報」の中の「本日」
    - すぐ後ろが WORD_EXTENDING_SUFFIXES の文字：「今年度」の中の「今年」
    """
    index = text.find(word)
    while index >= 0:
        before = text[index - 1] if index > 0 else ""
        after = text[index + len(word):index + len(word) + 1]
        joined_before = is_kanji(before) and is_kanji(word[0])
        joined_after = after in WORD_EXTENDING_SUFFIXES
        if not joined_before and not joined_after:
            return index
        index = text.find(word, index + 1)
    return -1


def relative_period(word, unit, amount, today, week_starts_on, span):
    """「3日前」「2週間前」「1か月前」の範囲（unit は days、weeks、months のどれか）"""
    if unit == "days":
        start = today - timedelta(days=amount)
        return make_period(word, start, start + timedelta(days=1), span)
    if unit == "weeks":
        start = start_of_week(today, week_starts_on) - timedelta(weeks=amount)
        return make_period(word, start, start + timedelta(weeks=1), span)
    start = add_months(start_of_month(today), -amount)
    return make_period(word, start, add_months(start, 1), span)


def find_period(text, now_ts, week_starts_on=0, recent_days=14, fiscal_year_start_month=4):
    """文の中の「先週」などを探して、現地時刻の範囲を返す。見つからなければ None

    返す辞書：{"word", "start", "end", "label", "span"}（start は含み、end は含まない秒数）
    fiscal_year_start_month：年度の始まりの月（1〜12。4 なら4月1日〜翌年3月31日）。「今年度」「昨年度」に使う
    """
    today = start_of_day(to_local(now_ts))

    for pattern, unit in RELATIVE_PATTERNS:
        match = re.search(pattern, text)
        if match:
            amount = parse_number(match.group(1))
            if amount is None:
                continue
            try:
                return relative_period(match.group(0), unit, amount, today, week_starts_on, match.span())
            except (OverflowError, ValueError):
                continue  # 「999999日前」など、暦で表せないほど前の日付は、時期として扱わない

    for word in FIXED_WORDS:
        index = find_fixed_word(text, word)
        if index < 0:
            continue
        span = (index, index + len(word))
        if word in ("今日", "本日"):
            return make_period(word, today, today + timedelta(days=1), span)
        if word == "昨日":
            return make_period(word, today - timedelta(days=1), today, span)
        if word in ("一昨日", "おととい"):
            return make_period(word, today - timedelta(days=2), today - timedelta(days=1), span)
        if word == "今週":
            start = start_of_week(today, week_starts_on)
            return make_period(word, start, start + timedelta(weeks=1), span)
        if word == "先週":
            start = start_of_week(today, week_starts_on) - timedelta(weeks=1)
            return make_period(word, start, start + timedelta(weeks=1), span)
        if word == "先々週":
            start = start_of_week(today, week_starts_on) - timedelta(weeks=2)
            return make_period(word, start, start + timedelta(weeks=1), span)
        if word in ("今月", "今月度"):
            start = start_of_month(today)
            return make_period(word, start, add_months(start, 1), span)
        if word in ("先月", "先月度"):
            start = add_months(start_of_month(today), -1)
            return make_period(word, start, add_months(start, 1), span)
        if word in ("先々月", "先々月度"):
            start = add_months(start_of_month(today), -2)
            return make_period(word, start, add_months(start, 1), span)
        if word == "今年度":
            start = start_of_fiscal_year(today, fiscal_year_start_month)
            return make_period(word, start, add_months(start, 12), span)
        if word in ("昨年度", "前年度"):
            start = add_months(start_of_fiscal_year(today, fiscal_year_start_month), -12)
            return make_period(word, start, add_months(start, 12), span)
        if word == "今年":
            start = today.replace(month=1, day=1)
            return make_period(word, start, start.replace(year=start.year + 1), span)
        if word in ("去年", "昨年"):
            start = today.replace(year=today.year - 1, month=1, day=1)
            return make_period(word, start, start.replace(year=start.year + 1), span)
        if word in ("一昨年", "おととし"):
            start = today.replace(year=today.year - 2, month=1, day=1)
            return make_period(word, start, start.replace(year=start.year + 1), span)
        if word == "最近":
            start = today - timedelta(days=recent_days - 1)
            return make_period(word, start, today + timedelta(days=1), span)
    return None
