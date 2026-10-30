"""ファイルの由来（provenance.py）のテスト

URL の整え方、ホスト名の主要部分、送信元の名前、Zone.Identifier の読み方、送信元の判定の順序、
ブラウザー拡張の記録（download_events）と由来（provenance）の読み書きを確かめます。
"""

import types

import pytest

from pip0 import database, provenance, rules

NOW = 1_793_250_000.0  # テストで使う決まった時刻


def add_file_row(db, path="/tmp/pip0-test/report.pdf"):
    """files に行を1つ作り、その id を返す（provenance は files の行を参照するため）"""
    return database.execute(
        db,
        "INSERT INTO files (path, name, ext, size, mtime, location_kind, status, "
        "first_seen_at, last_seen_at, updated_at) "
        "VALUES (?, 'report.pdf', '.pdf', 10, 1.0, 'downloads', 'present', 1.0, 1.0, 1.0)",
        (path,),
    )


def clean_message(filename="/tmp/pip0-test/Downloads/report.pdf", **download_values):
    """受け口が整えた辞書（docs/design.md 6-7 の形）"""
    download = {
        "id": 42, "filename": filename,
        "url": "https://files.slack.com/files-pri/T0-F0/report.pdf",
        "final_url": "https://files.slack.com/files-pri/T0-F0/report.pdf",
        "referrer_url": "https://app.slack.com/",
        "mime": "application/pdf", "started_at": NOW - 10.0, "ended_at": NOW - 5.5,
        "file_size": 1234, "danger": "safe",
    }
    download.update(download_values)
    return {
        "type": "download_completed",
        "browser": "chrome",
        "download": download,
        "page": {"tab_url": "https://app.slack.com/client/T0/C0", "tab_title": "予算 (Channel) - ws - Slack",
                 "captured_at": NOW - 10.0},
    }


def store(db, received_at=NOW, **download_values):
    message = clean_message(**download_values)
    return provenance.store_download_event(db, message, "chrome-extension://abc/", received_at)


def event_row(db, event_id):
    return database.query_one(db, "SELECT * FROM download_events WHERE id = ?", (event_id,))


# ---------------------------------------------------------------------- URL を整える


@pytest.mark.parametrize("url, expected", [
    # ? 以降（一時的な鍵が入ることがある）と # 以降を除く
    ("https://files.slack.com/files-pri/T0-F0/report.pdf?t=xoxe-123&pub_secret=abc#top",
     "https://files.slack.com/files-pri/T0-F0/report.pdf"),
    # ユーザー名・パスワードを除き、ホスト名を小文字にする（パスの大文字は残す）
    ("https://user:p%40ss@Files.Slack.COM:8443/Files/Report.PDF", "https://files.slack.com:8443/Files/Report.PDF"),
    # 既定のポートは書かない
    ("https://example.com:443/a", "https://example.com/a"),
    ("http://example.com:80/a", "http://example.com/a"),
    ("http://example.com:8080/a", "http://example.com:8080/a"),
    # パスがなければ「/」
    ("HTTPS://Example.com?x=1", "https://example.com/"),
    # IPv6 のアドレス
    ("http://[::1]:8080/x?token=1", "http://[::1]:8080/x"),
    # 前後の空白と、途中の改行・タブを除く
    ("  https://example.com/a\n/b\t  ", "https://example.com/a/b"),
    # ブラウザーと同じく、\ は / とみなす
    ("https://example.com\\dir\\file.pdf", "https://example.com/dir/file.pdf"),
    # ほかのスキームは、スキームだけ（中のデータや元の URL を残さない）
    ("data:text/plain;base64,c2VjcmV0", "data:"),
    ("javascript:alert(document.cookie)", "javascript:"),
    ("file:///C:/Users/u/secret.txt", "file:"),
    ("blob:https://app.slack.com/0f0e-11", "blob:"),
    ("filesystem:https://example.com/temporary/x", "filesystem:"),
    ("Chrome-Extension://abcdef/page.html", "chrome-extension:"),
    ("about:internet", "about:"),
])
def test_sanitise_url(url, expected):
    assert provenance.sanitise_url(url) == expected


@pytest.mark.parametrize("url", [
    None, 42, "", "   ", "files.slack.com/report.pdf", "//files.slack.com/report.pdf",
    "http://", "https://:443/", "http://exa mple.com/", "http://host:99999/", "http://host:abc/",
    "http://[::1/x", "https://例え.テスト/", "https://example.com/\ud800",
])
def test_sanitise_url_returns_none_for_unreadable_urls(url):
    assert provenance.sanitise_url(url) is None


def test_sanitise_url_cuts_long_urls_and_is_idempotent():
    long_url = "https://example.com/" + "a" * 5000 + "?token=secret"
    cleaned = provenance.sanitise_url(long_url)
    assert len(cleaned) == provenance.URL_MAX_CHARS
    assert cleaned.startswith("https://example.com/aaa")
    assert "token" not in cleaned
    assert provenance.sanitise_url(cleaned) == cleaned


def test_host_of():
    assert provenance.host_of("https://Files.Slack.com:8443/x?y") == "files.slack.com"
    assert provenance.host_of("https://files.slack.com./x") == "files.slack.com"
    assert provenance.host_of("http://[::1]/x") == "::1"
    assert provenance.host_of("data:") is None
    assert provenance.host_of("blob:https://app.slack.com/x") is None
    assert provenance.host_of(None) is None
    assert provenance.host_of("not a url") is None


# ---------------------------------------------------------------------- ホスト名の主要部分と送信元の名前


@pytest.mark.parametrize("host, expected", [
    ("files.slack.com", "slack.com"),
    ("a.b.c.example.com", "example.com"),
    ("example.com", "example.com"),
    ("www.example.co.jp", "example.co.jp"),
    ("example.co.jp", "example.co.jp"),
    ("www.u-tokyo.ac.jp", "u-tokyo.ac.jp"),
    ("news.bbc.co.uk", "bbc.co.uk"),
    ("co.jp", "co.jp"),
    ("Files.Example.COM.", "example.com"),
    ("localhost", "localhost"),
    ("192.168.10.20", "192.168.10.20"),
    ("::1", "::1"),
    ("[2001:db8::1]", "2001:db8::1"),
])
def test_registrable_domain(host, expected):
    assert provenance.registrable_domain(host, rules) == expected


def test_registrable_domain_of_nothing():
    assert provenance.registrable_domain(None, rules) is None
    assert provenance.registrable_domain("", rules) is None


@pytest.mark.parametrize("host, expected", [
    ("files.slack.com", "Slack"),
    ("slack.com", "Slack"),
    ("FILES.SLACK.COM", "Slack"),
    ("files.slack.com.", "Slack"),
    ("a.slack-edge.com", "Slack"),
    ("mail.google.com", "Gmail"),
    ("drive.usercontent.google.com", "Googleドライブ"),
    ("attachments.office.net", "Outlook"),
    # 区切り（.）の途中で一致しても、当てはめない（なりすましのホスト名）
    ("evil-slack.com", None),
    ("notslack.com", None),
    ("slack.com.evil.example", None),
    ("xslack-edge.com", None),
    ("google.com", None),
    ("example.co.jp", None),
    (None, None),
])
def test_label_for_host(host, expected):
    assert provenance.label_for_host(host, rules) == expected


def test_label_uses_the_rules_given():
    my_rules = types.SimpleNamespace(
        SOURCE_RULES=[{"label": "学内", "host_suffixes": ["Example.AC.JP"]}],
        SECOND_LEVEL_SUFFIXES=["ac.jp"],
    )
    assert provenance.label_for_host("portal.example.ac.jp", my_rules) == "学内"
    assert provenance.label_for_host("files.slack.com", my_rules) is None
    assert provenance.registrable_domain("portal.example.ac.jp", my_rules) == "example.ac.jp"


# ---------------------------------------------------------------------- Zone.Identifier


def test_parse_zone_identifier_crlf():
    text = ("[ZoneTransfer]\r\nZoneId=3\r\nReferrerUrl=https://app.slack.com/client?x=1\r\n"
            "HostUrl=https://files.slack.com/files-pri/T0-F0/report.pdf?t=xoxe-secret\r\n")
    zone = provenance.parse_zone_identifier(text)
    assert zone == {
        "zone_id": 3,
        "host_url": "https://files.slack.com/files-pri/T0-F0/report.pdf",
        "referrer_url": "https://app.slack.com/client",
    }


def test_parse_zone_identifier_tolerates_bom_case_and_spaces():
    text = "\ufeff[zonetransfer]\nzoneid = 3\nHOSTURL = https://Example.COM/a.zip#frag\n"
    zone = provenance.parse_zone_identifier(text)
    assert zone["zone_id"] == 3
    assert zone["host_url"] == "https://example.com/a.zip"
    assert zone["referrer_url"] is None


def test_parse_zone_identifier_ignores_other_sections_and_bad_values():
    text = ("HostUrl=https://outside-section.example/\n[Other]\nHostUrl=https://other.example/\n"
            "[ZoneTransfer]\n; 注釈\nZoneId=abc\nLastWriterPackageFamilyName=Microsoft.Edge\n")
    zone = provenance.parse_zone_identifier(text)
    assert zone == {"zone_id": None, "host_url": None, "referrer_url": None}


def test_parse_zone_identifier_without_text():
    assert provenance.parse_zone_identifier(None) == {"zone_id": None, "host_url": None, "referrer_url": None}
    assert provenance.parse_zone_identifier("") == {"zone_id": None, "host_url": None, "referrer_url": None}


def test_parse_zone_identifier_about_internet_has_no_host():
    zone = provenance.parse_zone_identifier("[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=about:internet\r\n")
    assert zone["host_url"] == "about:"
    assert provenance.host_of(zone["host_url"]) is None
    source = provenance.determine_source(None, zone, rules)
    assert source["label"] is None
    assert source["kind"] is None


def test_parse_zone_identifier_with_nul_padding():
    # UTF-16 の内容を1バイトずつの文字として読んでしまった場合の NUL を除く
    text = "[ZoneTransfer]\r\nHostUrl=https://files.slack.com/x\r\n".replace("", "\x00")
    assert provenance.parse_zone_identifier(text)["host_url"] == "https://files.slack.com/x"


# ---------------------------------------------------------------------- 送信元の判定


def browser_event(**values):
    row = {"id": 7, "url": None, "final_url": None, "referrer_url": None, "tab_url": None,
           "tab_title": None, "received_at": NOW, "ended_at": None}
    row.update(values)
    return row


def test_browser_record_final_url_wins():
    event = browser_event(
        url="https://slack.com/redirect/report.pdf",
        final_url="https://files.slack.com/files-pri/T0-F0/report.pdf?t=secret",
        referrer_url="https://app.slack.com/",
    )
    zone = {"zone_id": 3, "host_url": "https://example.org/x", "referrer_url": None}
    source = provenance.determine_source(event, zone, rules)
    assert source["label"] == "Slack"
    assert source["kind"] == "browser_extension"
    assert source["host"] == "files.slack.com"
    assert source["evidence"] == "ブラウザー拡張の記録：files.slack.com からのダウンロード"
    assert source["download_url"] == "https://files.slack.com/files-pri/T0-F0/report.pdf"
    assert source["referrer_url"] == "https://app.slack.com/"


def test_browser_record_falls_back_to_url_then_referrer():
    source = provenance.determine_source(browser_event(final_url="data:", url="https://cdn.example.co.jp/a.pdf"),
                                         None, rules)
    assert source["host"] == "cdn.example.co.jp"
    assert source["label"] == "example.co.jp"  # SOURCE_RULES にないので、ホスト名の主要部分

    source = provenance.determine_source(browser_event(url="blob:", referrer_url="https://app.slack.com/client"),
                                         None, rules)
    assert source["label"] == "Slack"
    assert source["host"] == "app.slack.com"
    assert "参照元 app.slack.com" in source["evidence"]
    assert source["download_url"] == "blob:"


def test_tab_url_is_never_the_source():
    # ダウンロード開始時のタブが Slack でも、送信元にはしない
    event = browser_event(tab_url="https://app.slack.com/client/T0/C0", tab_title="予算 - Slack")
    source = provenance.determine_source(event, None, rules)
    assert source["label"] is None
    assert source["kind"] is None
    assert "Slack" not in source["evidence"]

    # ダウンロード URL が別のホストなら、そのホスト（タブの Slack ではない）
    event = browser_event(url="https://downloads.example.com/a.pdf", tab_url="https://app.slack.com/client")
    assert provenance.determine_source(event, None, rules)["label"] == "example.com"


def test_zone_identifier_is_used_without_browser_record():
    zone = provenance.parse_zone_identifier("[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://files.slack.com/x.pdf\r\n")
    source = provenance.determine_source(None, zone, rules)
    assert source["label"] == "Slack"
    assert source["kind"] == "zone_identifier"
    assert source["evidence"] == "Windows のダウンロード元情報（Zone.Identifier）：files.slack.com"
    assert source["download_url"] == "https://files.slack.com/x.pdf"

    zone = {"zone_id": 3, "host_url": "about:", "referrer_url": "https://mail.google.com/mail/u/0/"}
    source = provenance.determine_source(None, zone, rules)
    assert source["label"] == "Gmail"
    assert "参照元 mail.google.com" in source["evidence"]


def test_browser_record_without_host_falls_back_to_zone():
    event = browser_event(url="data:", final_url="data:")
    zone = {"zone_id": 3, "host_url": "https://drive.usercontent.google.com/d", "referrer_url": None}
    source = provenance.determine_source(event, zone, rules)
    assert source["kind"] == "zone_identifier"
    assert source["label"] == "Googleドライブ"


def test_no_record_means_unknown_source():
    source = provenance.determine_source(None, None, rules)
    assert source == {"label": None, "kind": None, "evidence": "ダウンロードの記録なし", "host": None,
                      "download_url": None, "referrer_url": None}
    empty_zone = provenance.parse_zone_identifier(None)
    assert provenance.determine_source(None, empty_zone, rules)["evidence"] == "ダウンロードの記録なし"
    source = provenance.determine_source(browser_event(url="data:"), None, rules)
    assert source["label"] is None
    assert "ホスト名がありません" in source["evidence"]


def test_determine_source_refuses_the_native_host_dict():
    with pytest.raises(ValueError):
        provenance.determine_source(clean_message(), None, rules)


# ---------------------------------------------------------------------- ブラウザー拡張の記録


def test_store_download_event_writes_all_fields(db):
    message = clean_message(url="https://files.slack.com/a.pdf?t=xoxe-secret#x")
    event_id = provenance.store_download_event(db, message, "chrome-extension://abc/", NOW)
    row = event_row(db, event_id)
    assert row["received_at"] == NOW
    assert row["browser"] == "chrome"
    assert row["extension_origin"] == "chrome-extension://abc/"
    assert row["browser_download_id"] == 42
    assert row["filename"] == "/tmp/pip0-test/Downloads/report.pdf"
    assert row["url"] == "https://files.slack.com/a.pdf"  # 念のため、もう一度整えている
    assert row["final_url"] == "https://files.slack.com/files-pri/T0-F0/report.pdf"
    assert row["referrer_url"] == "https://app.slack.com/"
    assert row["tab_url"] == "https://app.slack.com/client/T0/C0"
    assert row["tab_title"] == "予算 (Channel) - ws - Slack"
    assert row["mime"] == "application/pdf"
    assert row["started_at"] == NOW - 10.0
    assert row["ended_at"] == NOW - 5.5
    assert row["file_size"] == 1234
    assert row["state"] == "pending"
    assert row["matched_file_id"] is None


def test_store_download_event_refuses_ping(db):
    with pytest.raises(ValueError):
        provenance.store_download_event(db, {"type": "ping"}, "chrome-extension://abc/", NOW)


def test_find_download_event_matches_path_ignoring_case_and_separators(db):
    event_id = store(db, filename="/tmp/pip0-test/Downloads/Report.PDF")
    found = provenance.find_download_event(db, "/tmp/pip0-test//Downloads/./report.pdf", 1234, NOW + 5)
    assert found["id"] == event_id
    assert provenance.find_download_event(db, "/tmp/pip0-test/Downloads/other.pdf", 1234, NOW + 5) is None


def test_find_download_event_checks_size(db):
    event_id = store(db)
    path = "/tmp/pip0-test/Downloads/report.pdf"
    assert provenance.find_download_event(db, path, 999, NOW) is None
    assert provenance.find_download_event(db, path, None, NOW)["id"] == event_id  # ファイルの大きさが不明

    unknown_size_id = store(db, filename="/tmp/pip0-test/Downloads/b.pdf", file_size=None)
    found = provenance.find_download_event(db, "/tmp/pip0-test/Downloads/b.pdf", 555, NOW)
    assert found["id"] == unknown_size_id  # 記録の大きさが不明


def test_find_download_event_only_recent_pending_and_newest_first(db):
    path = "/tmp/pip0-test/Downloads/report.pdf"
    old_id = store(db, received_at=NOW - 700)
    assert provenance.find_download_event(db, path, 1234, NOW) is None  # 600 秒より前
    assert provenance.find_download_event(db, path, 1234, NOW, window_seconds=800)["id"] == old_id

    first_id = store(db, received_at=NOW - 100)
    second_id = store(db, received_at=NOW - 50)
    assert provenance.find_download_event(db, path, 1234, NOW)["id"] == second_id

    file_id = add_file_row(db)
    provenance.mark_event_matched(db, second_id, file_id)
    row = event_row(db, second_id)
    assert row["state"] == "matched"
    assert row["matched_file_id"] == file_id
    assert provenance.find_download_event(db, path, 1234, NOW)["id"] == first_id


def test_expire_old_events(db):
    old_id = store(db, received_at=NOW - 90000)
    recent_id = store(db, received_at=NOW - 100)
    matched_id = store(db, received_at=NOW - 90000)
    provenance.mark_event_matched(db, matched_id, add_file_row(db))
    assert provenance.expire_old_events(db, NOW) == 1
    assert event_row(db, old_id)["state"] == "expired"
    assert event_row(db, recent_id)["state"] == "pending"
    assert event_row(db, matched_id)["state"] == "matched"
    assert provenance.expire_old_events(db, NOW) == 0


# ---------------------------------------------------------------------- 由来の記録


def test_record_provenance_from_browser_event(db):
    file_id = add_file_row(db)
    event = event_row(db, store(db))
    source = provenance.determine_source(event, None, rules)
    provenance.record_provenance(db, file_id, source, event=event, now=NOW + 1)
    row = provenance.get_provenance(db, file_id)
    assert row["source_label"] == "Slack"
    assert row["source_kind"] == "browser_extension"
    assert row["evidence"] == "ブラウザー拡張の記録：files.slack.com からのダウンロード"
    assert row["host"] == "files.slack.com"
    assert row["download_url"] == "https://files.slack.com/files-pri/T0-F0/report.pdf"
    assert row["referrer_url"] == "https://app.slack.com/"
    assert row["tab_url"] == "https://app.slack.com/client/T0/C0"  # 記録はするが、送信元には使わない
    assert row["tab_title"] == "予算 (Channel) - ws - Slack"
    assert row["downloaded_at"] == NOW - 5.5  # 拡張機能の終了時刻
    assert row["download_event_id"] == event["id"]
    assert row["recorded_at"] == NOW + 1


def test_record_provenance_uses_received_time_without_end_time(db):
    file_id = add_file_row(db)
    event = event_row(db, store(db, ended_at=None, received_at=NOW - 3))
    provenance.record_provenance(db, file_id, provenance.determine_source(event, None, rules), event=event, now=NOW)
    assert provenance.get_provenance(db, file_id)["downloaded_at"] == NOW - 3


def test_record_provenance_from_zone_only_has_no_download_time(db):
    file_id = add_file_row(db)
    zone = provenance.parse_zone_identifier("[ZoneTransfer]\nZoneId=3\nHostUrl=https://files.slack.com/x.pdf\n")
    source = provenance.determine_source(None, zone, rules)
    provenance.record_provenance(db, file_id, source, zone=zone, now=NOW)
    row = provenance.get_provenance(db, file_id)
    assert row["source_label"] == "Slack"
    assert row["source_kind"] == "zone_identifier"
    assert row["downloaded_at"] is None
    assert row["download_event_id"] is None
    assert row["tab_url"] is None


def test_record_provenance_overwrites_and_keeps_unknown_as_null(db):
    file_id = add_file_row(db)
    zone = {"zone_id": 3, "host_url": "about:", "referrer_url": None}
    unknown = provenance.determine_source(None, zone, rules)
    provenance.record_provenance(db, file_id, unknown, zone=zone, now=NOW)
    row = provenance.get_provenance(db, file_id)
    assert row["source_label"] is None
    assert row["download_url"] == "about:"

    event = event_row(db, store(db))
    provenance.record_provenance(db, file_id, provenance.determine_source(event, None, rules), event=event, now=NOW)
    assert provenance.get_provenance(db, file_id)["source_label"] == "Slack"
    assert database.query_one(db, "SELECT count(*) AS n FROM provenance")["n"] == 1


def test_get_provenance_without_record(db):
    assert provenance.get_provenance(db, add_file_row(db)) is None
