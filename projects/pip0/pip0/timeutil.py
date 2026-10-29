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


def to_local(ts):
    """秒数 → 現地時刻の datetime（タイムゾーンなし）"""
    return datetime.fromtimestamp(ts)


def from_local(dt):
    """現地時刻の datetime（タイムゾーンなし）→ 秒数"""
    return dt.timestamp()


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
    (NUMBER + r"[かヶカケ]月前", "months"),
]
FIXED_WORDS = ["先々週", "一昨日", "おととい", "今日", "本日", "昨日", "今週", "先週", "今月", "先月", "今年", "去年", "昨年", "最近"]


def find_period(text, now_ts, week_starts_on=0, recent_days=14):
    """文の中の「先週」などを探して、現地時刻の範囲を返す。見つからなければ None

    返す辞書：{"word", "start", "end", "label", "span"}（start は含み、end は含まない秒数）
    """
    today = start_of_day(to_local(now_ts))

    for pattern, unit in RELATIVE_PATTERNS:
        match = re.search(pattern, text)
        if match:
            amount = parse_number(match.group(1))
            if amount is None:
                continue
            word = match.group(0)
            if unit == "days":
                start = today - timedelta(days=amount)
                return make_period(word, start, start + timedelta(days=1), match.span())
            if unit == "weeks":
                this_week = start_of_week(today, week_starts_on)
                start = this_week - timedelta(weeks=amount)
                return make_period(word, start, start + timedelta(weeks=1), match.span())
            start = add_months(start_of_month(today), -amount)
            return make_period(word, start, add_months(start, 1), match.span())

    for word in FIXED_WORDS:
        index = text.find(word)
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
        if word == "今月":
            start = start_of_month(today)
            return make_period(word, start, add_months(start, 1), span)
        if word == "先月":
            start = add_months(start_of_month(today), -1)
            return make_period(word, start, add_months(start, 1), span)
        if word == "今年":
            start = today.replace(month=1, day=1)
            return make_period(word, start, start.replace(year=start.year + 1), span)
        if word in ("去年", "昨年"):
            start = today.replace(year=today.year - 1, month=1, day=1)
            return make_period(word, start, start.replace(year=start.year + 1), span)
        if word == "最近":
            start = today - timedelta(days=recent_days - 1)
            return make_period(word, start, today + timedelta(days=1), span)
    return None
