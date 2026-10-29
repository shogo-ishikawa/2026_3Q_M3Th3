"""安全なファイル名と、上書きしない改名・壊れない書き込みのテスト"""

import os

import pytest

from pip0 import fsutil, safe_names


@pytest.mark.parametrize("name", ["a<b.txt", 'a"b.txt', "a:b.txt", "a/b", "a\\b", "a|b", "a?b", "a*b", "a\tb"])
def test_forbidden_characters_are_rejected_and_replaced(name):
    ok, reason = safe_names.check_name(name)
    assert not ok and reason
    safe = safe_names.make_safe(name)
    assert safe_names.check_name(safe) == (True, "")


@pytest.mark.parametrize("name", ["CON", "con.txt", "Com1.pdf", "LPT9", "nul.tar.gz", "COM¹"])
def test_reserved_device_names_get_a_prefix(name):
    assert not safe_names.check_name(name)[0]
    safe = safe_names.make_safe(name)
    assert safe.startswith("_")
    assert safe_names.check_name(safe)[0]


def test_extension_is_kept_and_trailing_dots_removed():
    assert safe_names.make_safe("予算案 .pdf") == "予算案.pdf"
    assert safe_names.make_safe("報告書...") == "報告書"
    assert safe_names.make_safe("2026-10-29_予算/案_Slack.xlsx") == "2026-10-29_予算／案_Slack.xlsx"
    assert safe_names.make_safe("").startswith("無題")


def test_long_names_are_shortened_before_the_extension():
    name = "あ" * 300 + ".docx"
    safe = safe_names.make_safe(name, max_len=200)
    assert safe.endswith(".docx")
    assert len(safe) == 200


def test_unique_name_adds_numbers(tmp_path):
    (tmp_path / "報告.pdf").write_text("1")
    (tmp_path / "報告 (2).pdf").write_text("2")
    assert safe_names.unique_name(str(tmp_path), "報告.pdf") == "報告 (3).pdf"
    assert safe_names.unique_name(str(tmp_path), "新規.pdf") == "新規.pdf"


def test_no_overwrite_rename_never_replaces_existing_file(tmp_path):
    src = tmp_path / "a.txt"
    dst = tmp_path / "b.txt"
    src.write_text("新しい")
    dst.write_text("既存")
    with pytest.raises(FileExistsError):
        fsutil.no_overwrite_rename(src, dst)
    assert src.read_text() == "新しい"
    assert dst.read_text() == "既存"
    fsutil.no_overwrite_rename(src, tmp_path / "c.txt")
    assert not src.exists()
    assert (tmp_path / "c.txt").read_text() == "新しい"


def test_atomic_write_json_replaces_whole_file(tmp_path):
    path = tmp_path / "manifest.json"
    fsutil.atomic_write_json(path, {"state": "copying"})
    fsutil.atomic_write_json(path, {"state": "copied", "名前": "予算"})
    assert fsutil.read_json(path) == {"state": "copied", "名前": "予算"}
    assert not os.path.exists(str(path) + ".tmp")


def test_sha256_stream_stops_at_a_safe_point(tmp_path):
    path = tmp_path / "big.bin"
    path.write_bytes(b"x" * (3 * 1024))
    calls = []

    def should_continue():
        calls.append(1)
        return len(calls) < 2

    with pytest.raises(fsutil.Paused):
        fsutil.sha256_file(path, chunk_size=1024, should_continue=should_continue)
    assert len(fsutil.sha256_file(path)) == 64
