"""ファイルの由来（入手経路）の記録と判定

M1 の新しい名前の「送信元」と、M3 の「Slackで貰った」のような検索に使う、ファイルの入手経路を扱います。
手掛かりにするのは、次の2つの記録だけです。記録がなければ「送信元不明」とし、推測で決めません。

1. ブラウザー拡張の記録：ダウンロードが完了したときに、拡張機能が受け口（native_host.py）へ知らせ、
   download_events テーブルに入ったもの（ダウンロード URL、参照元 URL など）
2. Windows のダウンロード元情報（Zone.Identifier）：ブラウザー等が、ダウンロードしたファイルに付ける小さな記録

ダウンロード開始時に前面だったタブ（tab_url）は、ダウンロードを始めたタブとは限らないため、
記録はしますが、送信元には使いません。

URL の ? 以降と # 以降には、Slack 等の一時的な鍵が入っていることがあります。
そのため、URL は保存する前に必ず sanitise_url で整えます（拡張機能も同じ処理をしています）。
"""

import ipaddress
import logging
import os
import re
import time
from urllib.parse import urlsplit

from pip0 import database

logger = logging.getLogger(__name__)

# URL の最大文字数（これを超える部分は切り捨てる）。拡張機能の URL_MAX_CHARS と同じ値
URL_MAX_CHARS = 2048

# スキーム・ホスト・パスを残す URL の種類（これ以外は「data:」のようにスキームだけにする）
WEB_SCHEMES = ["http", "https"]

# 書かなくてよいポート（URL に書かれていても、取り除く）
DEFAULT_PORTS = {"http": 80, "https": 443}

# 記録が何もないときの根拠の文
NO_RECORD = "ダウンロードの記録なし"

# URL の先頭の「スキーム:」（例：https:、data:）
SCHEME_PATTERN = re.compile(r"^([A-Za-z][A-Za-z0-9+.\-]*):")

# 制御文字（改行・タブ・NUL・DEL など）。URL からは取り除く
CONTROL_CHARACTERS = re.compile(r"[\x00-\x1f\x7f]")

# 対になっていないサロゲート（文字として読めない、壊れた部分）
BROKEN_CHARACTERS = re.compile(r"[\ud800-\udfff]")

# ホスト名に使える文字（ブラウザーが送る URL のホスト名は、小文字の英数字と . - _ だけ）
HOST_PATTERN = re.compile(r"^[a-z0-9._-]+$")


# ----------------------------------------------------------------------
# URL とホスト名
# ----------------------------------------------------------------------


def sanitise_url(url):
    """URL から、鍵が含まれることがある部分を取り除いて返す。読めなければ None

    - http／https：「スキーム://ホスト[:ポート]/パス」だけを残す
      （ユーザー名・パスワード、? 以降、# 以降を除く）。ホスト名は小文字にし、
      既定のポート（http は 80、https は 443）は書かない。最大 URL_MAX_CHARS 文字
    - ほかのスキーム（data:、blob:、filesystem:、javascript:、file: など）：「data:」のようにスキームだけ
    - URL として読めないもの（スキームがない、ホスト名がない、ポートが数でない等）、文字列でないもの：None

    例：https://files.slack.com/files-pri/T0-F0/report.pdf?t=xoxe-123#top
      → https://files.slack.com/files-pri/T0-F0/report.pdf
    拡張機能（browser-extension/lib/sanitise.js の sanitiseUrl）と同じ決まりです。
    """
    if not isinstance(url, str):
        return None
    if BROKEN_CHARACTERS.search(url):
        return None
    text = CONTROL_CHARACTERS.sub("", url).strip()

    match = SCHEME_PATTERN.match(text)
    if match is None:
        return None  # スキームがない（相対的な URL など）
    scheme = match.group(1).lower()
    if scheme not in WEB_SCHEMES:
        # data: や blob: は、URL の中にデータや元のページの URL を含むため、スキームだけを残す
        return (scheme + ":")[:URL_MAX_CHARS]

    # ブラウザーと同じく、http／https の URL の「\」は「/」とみなす
    text = text.replace("\\", "/")
    try:
        parts = urlsplit(text)
        port = parts.port
    except ValueError:
        return None  # ポートが数でない、[ ] の対応が取れていない など

    host = parts.hostname  # 小文字にしたホスト名（ユーザー名・パスワードとポートは含まない）
    if not host:
        return None
    if ":" in host:
        # IPv6 のアドレスは [ ] で囲んで書く
        if not is_ip_address(host):
            return None
        host_text = "[" + host + "]"
    elif HOST_PATTERN.match(host):
        host_text = host
    else:
        return None  # 空白など、ホスト名に使えない文字がある

    if port is not None and port != DEFAULT_PORTS[scheme]:
        host_text = host_text + ":" + str(port)
    path = parts.path or "/"
    cleaned = scheme + "://" + host_text + path
    return cleaned[:URL_MAX_CHARS]


def is_ip_address(host):
    """IPv4 か IPv6 のアドレスなら True"""
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return False
    return True


def host_of(url):
    """URL のホスト名（小文字、ポートなし、末尾の「.」なし）。http／https 以外や読めない URL は None"""
    cleaned = sanitise_url(url)
    if cleaned is None or not cleaned.startswith(("http://", "https://")):
        return None
    host = urlsplit(cleaned).hostname
    if host is None:
        return None
    host = host.rstrip(".")
    if host == "":
        return None
    return host


def registrable_domain(host, rules):
    """ホスト名の主要部分を返す（例：files.slack.com → slack.com、www.example.co.jp → example.co.jp）

    最後の2つの区切り（ラベル）を返す。最後の2つが rules.SECOND_LEVEL_SUFFIXES（co.jp など）のときは3つ。
    IP アドレスと、区切りが1つだけの名前（localhost など）は、そのまま返す。
    """
    if not host:
        return None
    host = host.lower().strip("[]").rstrip(".")
    if host == "":
        return None
    if is_ip_address(host):
        return host
    labels = host.split(".")
    if len(labels) <= 2:
        return host
    last_two = ".".join(labels[-2:])
    if last_two in rules.SECOND_LEVEL_SUFFIXES:
        return ".".join(labels[-3:])
    return last_two


def label_for_host(host, rules):
    """ホスト名が rules.SOURCE_RULES のどれかに当てはまれば、その名前（"Slack" など）。なければ None

    当てはまるのは、ホスト名が host_suffixes と同じか、「.」の区切りの後ろが一致するときだけです。
    files.slack.com は slack.com に当てはまりますが、evil-slack.com や slack.com.example.net は当てはまりません。
    """
    if not host:
        return None
    host = host.lower().rstrip(".")
    for rule in rules.SOURCE_RULES:
        for suffix in rule["host_suffixes"]:
            suffix = suffix.lower()
            if host == suffix or host.endswith("." + suffix):
                return rule["label"]
    return None


# ----------------------------------------------------------------------
# Windows のダウンロード元情報（Zone.Identifier）
# ----------------------------------------------------------------------


def parse_zone_identifier(text):
    """Zone.Identifier の中身（文字列）を読み、{"zone_id", "host_url", "referrer_url"} を返す

    中身の例（INI ファイルと同じ形）：
        [ZoneTransfer]
        ZoneId=3
        ReferrerUrl=https://app.slack.com/
        HostUrl=https://files.slack.com/files-pri/T0-F0/report.pdf

    - 名前（ZoneId 等）の大文字・小文字は区別しない。改行は CRLF でも LF でもよい。先頭の BOM は無視する
    - URL は sanitise_url で整える。「about:internet」のようにホスト名のないものは「about:」になる
    - Zone.Identifier がない（text が None）ときや、読めない項目は None
    """
    result = {"zone_id": None, "host_url": None, "referrer_url": None}
    if not isinstance(text, str):
        return result
    # BOM と、文字コードの読み違いで混ざった NUL を除く
    text = text.replace("﻿", "").replace("\x00", "")

    section = None
    for line in text.splitlines():
        line = line.strip()
        if line == "" or line.startswith(";") or line.startswith("#"):
            continue  # 空行と注釈
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1].strip().lower()
            continue
        if section != "zonetransfer" or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip().lower()
        value = value.strip()
        if key == "zoneid":
            result["zone_id"] = parse_zone_id(value)
        elif key == "hosturl":
            result["host_url"] = sanitise_url(value)
        elif key == "referrerurl":
            result["referrer_url"] = sanitise_url(value)
    return result


def parse_zone_id(value):
    """ZoneId の値（0：この PC、1：イントラネット、2：信頼済み、3：インターネット、4：制限付き）。読めなければ None"""
    try:
        return int(value)
    except ValueError:
        return None


# ----------------------------------------------------------------------
# 送信元の判定（★根拠の文を変えたいときは、ここを直します）
# ----------------------------------------------------------------------


def determine_source(download_event, zone, rules):
    """ファイルの送信元を、記録だけから決める

    download_event：download_events テーブルの行（辞書）。なければ None
    zone：parse_zone_identifier の結果。なければ None

    調べる順序
    1. ブラウザー拡張の記録：final_url（リダイレクト後のダウンロード URL）→ url → referrer_url（参照元）
    2. Zone.Identifier：host_url → referrer_url
    最初に見つかったホスト名を使う。tab_url（ダウンロード開始時に前面だったタブ）は使わない。

    戻り値：{"label", "kind", "evidence", "host", "download_url", "referrer_url"}
    - label：rules.SOURCE_RULES の名前（"Slack" など）。当てはまらなければホスト名の主要部分（"example.co.jp" など）。
      記録からホスト名が分からなければ None（「送信元不明」。推測しない）
    - kind："browser_extension"、"zone_identifier"、None（分からない）
    - evidence：判断の根拠（日本語の文）
    """
    if download_event is not None:
        check_event_row(download_event)
        download_url = sanitise_url(download_event.get("final_url")) or sanitise_url(download_event.get("url"))
        referrer_url = sanitise_url(download_event.get("referrer_url"))
        for key in ["final_url", "url", "referrer_url"]:
            host = host_of(download_event.get(key))
            if host is None:
                continue
            if key == "referrer_url":
                evidence = f"ブラウザー拡張の記録：参照元 {host} のページからのダウンロード"
            else:
                evidence = f"ブラウザー拡張の記録：{host} からのダウンロード"
            return make_source(host, "browser_extension", evidence, download_url, referrer_url, rules)

    if zone is not None:
        for key in ["host_url", "referrer_url"]:
            host = host_of(zone.get(key))
            if host is None:
                continue
            if key == "referrer_url":
                evidence = f"Windows のダウンロード元情報（Zone.Identifier）：参照元 {host}"
            else:
                evidence = f"Windows のダウンロード元情報（Zone.Identifier）：{host}"
            return make_source(host, "zone_identifier", evidence,
                               sanitise_url(zone.get("host_url")), sanitise_url(zone.get("referrer_url")), rules)

    # ホスト名の分かる記録がない。送信元は不明のまま（tab_url から推測しない）
    if download_event is not None:
        evidence = "ブラウザー拡張の記録に、送信元のホスト名がありません"
        urls = (download_url, referrer_url)
    elif zone is not None and (zone.get("host_url") or zone.get("referrer_url")):
        evidence = "Windows のダウンロード元情報（Zone.Identifier）に、送信元のホスト名がありません"
        urls = (sanitise_url(zone.get("host_url")), sanitise_url(zone.get("referrer_url")))
    else:
        evidence = NO_RECORD
        urls = (None, None)
    return {"label": None, "kind": None, "evidence": evidence, "host": None,
            "download_url": urls[0], "referrer_url": urls[1]}


def make_source(host, kind, evidence, download_url, referrer_url, rules):
    """ホスト名から送信元の辞書を作る（SOURCE_RULES の名前、なければホスト名の主要部分）"""
    label = label_for_host(host, rules)
    if label is None:
        label = registrable_domain(host, rules)
    return {"label": label, "kind": kind, "evidence": evidence, "host": host,
            "download_url": download_url, "referrer_url": referrer_url}


def check_event_row(event):
    """download_events テーブルの行（平らな辞書）かを確かめる。受け口の辞書（6-7 の形）を渡すのはプログラムの誤り"""
    if "download" in event:
        raise ValueError("download_events テーブルの行を渡してください（受け口の辞書は store_download_event 用です）")


# ----------------------------------------------------------------------
# ブラウザー拡張の記録（download_events テーブル）
# ----------------------------------------------------------------------


def store_download_event(conn, message, origin, received_at):
    """受け口が検査して整えた辞書（native_host.validate_message の結果）を記録し、行の id を返す

    origin：呼び出し元の拡張機能（chrome-extension://<ID>/）
    URL は、念のためもう一度 sanitise_url で整えてから書く（? 以降と # 以降を残さない）。
    """
    if message.get("type") != "download_completed":
        raise ValueError("記録できるのは、ダウンロードの完了の知らせ（download_completed）だけです")
    download = message["download"]
    page = message.get("page") or {}
    return database.execute(
        conn,
        "INSERT INTO download_events (received_at, browser, extension_origin, browser_download_id, filename, "
        "url, final_url, referrer_url, tab_url, tab_title, mime, started_at, ended_at, file_size, state) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')",
        (
            received_at,
            message.get("browser"),
            origin,
            download["id"],
            download["filename"],
            sanitise_url(download.get("url")),
            sanitise_url(download.get("final_url")),
            sanitise_url(download.get("referrer_url")),
            sanitise_url(page.get("tab_url")),
            page.get("tab_title"),
            download.get("mime"),
            download.get("started_at"),
            download.get("ended_at"),
            download.get("file_size"),
        ),
    )


def normalise_path(path):
    """パスを比べるための形にそろえる（区切りの重複や「.」を除き、小文字にする）

    Windows のパスは大文字・小文字を区別しないため、比べるときは小文字にそろえます。
    """
    return os.path.normcase(os.path.normpath(os.fspath(path))).lower()


def same_path(path_a, path_b):
    """2つのパスが同じ場所を指していれば True（大文字・小文字と区切りの書き方の違いは無視する）"""
    return normalise_path(path_a) == normalise_path(path_b)


def find_download_event(conn, path, size, now, window_seconds=600):
    """path のファイルに当てはまる、ブラウザー拡張の記録（行の辞書）を探す。なければ None

    当てはまる条件
    - 保存先のパスが同じ（大文字・小文字と区切りの書き方の違いは無視する）
    - 状態が pending（まだどのファイルにも結び付けていない）
    - 受け取ってから window_seconds 秒以内
    - 大きさが同じか、どちらかが不明（None）
    新しく受け取った記録から順に調べ、最初に当てはまったものを返す。
    """
    rows = database.query_all(
        conn,
        "SELECT * FROM download_events WHERE state = 'pending' AND received_at >= ? "
        "ORDER BY received_at DESC, id DESC",
        (now - window_seconds,),
    )
    for row in rows:
        if not same_path(row["filename"], path):
            continue
        if size is not None and row["file_size"] is not None and row["file_size"] != size:
            continue
        return row
    return None


def mark_event_matched(conn, event_id, file_id):
    """記録を、ファイル（files テーブルの行）に結び付けた（matched）ことにする

    ダウンロード開始時に前面だったタブの URL と題名（画面の文脈）は、提案を作るときに使い終わっているので、
    ここで消します（画面の文脈は、その時点でだけ使い、残さない）。
    """
    conn.execute(
        "UPDATE download_events SET state = 'matched', matched_file_id = ?, tab_url = NULL, tab_title = NULL "
        "WHERE id = ?",
        (file_id, event_id),
    )


def expire_old_events(conn, now, max_age_seconds=86400):
    """受け取ってから max_age_seconds 秒たっても結び付かなかった記録を消す。件数を返す

    pip0 が扱わなかったダウンロード（ダウンロードフォルダーから動かされた等）の URL やタブの題名を、
    いつまでも残さないためです。
    """
    cursor = conn.execute(
        "DELETE FROM download_events WHERE state = 'pending' AND received_at < ?",
        (now - max_age_seconds,),
    )
    count = cursor.rowcount
    if count:
        logger.info("結び付かなかったダウンロードの記録を %d 件、消しました", count)
    return count


# ----------------------------------------------------------------------
# ファイルの由来（provenance テーブル）
# ----------------------------------------------------------------------


def record_provenance(conn, file_id, source, event=None, zone=None, now=None):
    """ファイルの由来を記録する（すでにあれば書き換える）

    source：determine_source の結果
    event：結び付けた download_events の行（辞書）。なければ None
    zone：parse_zone_identifier の結果。なければ None

    ダウンロード日時（downloaded_at）は、拡張機能の記録の終了時刻、なければ受け口が受け取った時刻。
    拡張機能の記録がない（Zone.Identifier だけの）ときは None（日時を推測しない）。
    ダウンロード開始時に前面だったタブの URL と題名は、画面の文脈なので残さない（列は NULL のまま）。
    """
    now = time.time() if now is None else now
    downloaded_at = None
    event_id = None
    if event is not None:
        check_event_row(event)
        downloaded_at = event.get("ended_at")
        if downloaded_at is None:
            downloaded_at = event.get("received_at")
        event_id = event.get("id")

    download_url = source.get("download_url")
    referrer_url = source.get("referrer_url")
    if event is None and zone is not None and download_url is None and referrer_url is None:
        # 送信元は分からなくても、Zone.Identifier に書かれていた URL（整えたもの）は残す
        download_url = sanitise_url(zone.get("host_url"))
        referrer_url = sanitise_url(zone.get("referrer_url"))

    conn.execute(
        "INSERT INTO provenance (file_id, source_label, source_kind, evidence, download_url, referrer_url, host, "
        "tab_url, tab_title, downloaded_at, download_event_id, recorded_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(file_id) DO UPDATE SET source_label = excluded.source_label, "
        "source_kind = excluded.source_kind, evidence = excluded.evidence, "
        "download_url = excluded.download_url, referrer_url = excluded.referrer_url, host = excluded.host, "
        "tab_url = excluded.tab_url, tab_title = excluded.tab_title, downloaded_at = excluded.downloaded_at, "
        "download_event_id = excluded.download_event_id, recorded_at = excluded.recorded_at",
        (
            file_id,
            source.get("label"),
            source.get("kind"),
            source.get("evidence"),
            sanitise_url(download_url),
            sanitise_url(referrer_url),
            source.get("host"),
            None,  # tab_url（残さない）
            None,  # tab_title（残さない）
            downloaded_at,
            event_id,
            now,
        ),
    )


def get_provenance(conn, file_id):
    """ファイルの由来（provenance の行の辞書）。記録がなければ None"""
    return database.query_one(conn, "SELECT * FROM provenance WHERE file_id = ?", (file_id,))
