"""platform_windows（Windows 11 の OS 連携）のテスト

Windows 以外（授業の Linux 環境）でも確かめられる部分を試します。
- import できること。Windows 以外では「取得できない」を返し、成功したふりをしないこと
- Windows の API を使わない部分（属性の読み方、32 ビットの時刻の差、レジストリーの値、同期フォルダーの名前の判定 等）
- シェルに頼むメソッド（ゴースト、ごみ箱）を、代役のつながり（FakeLink）で：成功、ShellError、ShellUnavailable、時間切れ

ctypes で Windows の API を呼ぶ部分そのものは、Windows 11 の実機でしか確かめられません。
"""

import ctypes
import errno
import inspect
import os
import sys

import pytest

from pip0 import platform_windows
from pip0.platform_fake import FakePlatform
from pip0.platform_windows import WindowsPlatform
from pip0.shell_link import ShellError, ShellTimeout, ShellUnavailable

ITEM_ID = "0123456789abcdef0123456789abcdef"
not_windows = pytest.mark.skipif(sys.platform == "win32", reason="Windows 以外での振る舞いを確かめるテスト")


class FakeLink:
    """WindowsPlatform のテスト用の、シェルとのつながりの代役

    replies：要求の名前 → 答えの辞書、出す例外、または payload を受け取って答えを返す関数
    """

    def __init__(self, replies=None, alive=True):
        self.replies = dict(replies or {})
        self.calls = []
        self.alive = alive

    def request(self, type, payload=None, timeout=10.0):
        self.calls.append({"type": type, "payload": payload, "timeout": timeout})
        reply = self.replies.get(type)
        if reply is None:
            raise ShellError("unknown_type", "テストで答えを決めていない要求です")
        if isinstance(reply, BaseException):
            raise reply
        if callable(reply):
            return reply(payload)
        return reply

    def is_alive(self):
        return self.alive

    def types(self):
        return [call["type"] for call in self.calls]


def answer_sync_root(monkeypatch, status, provider=None):
    """CfGetSyncRootInfoByPath の答えを、決めた値にする（Windows の API の代わり）"""
    seen = []

    def fake_query(path):
        seen.append(path)
        return {"status": status, "provider": provider, "reason": "テスト用の答え" if status == "unknown" else ""}

    monkeypatch.setattr(platform_windows, "query_sync_root", fake_query)
    return seen


# ----------------------------------------------------------------------
# import とメソッドの名前
# ----------------------------------------------------------------------

CONTRACT_METHODS = [
    "get_idle_seconds", "get_power_source", "get_file_key", "get_local_state", "get_volume_info",
    "check_sync_folder", "access_time_reliable", "read_zone_identifier", "open_for_copy", "open_for_analysis",
    "can_open_exclusively", "known_downloads_dir", "register_sync_root", "is_sync_root_registered",
    "ghost_status", "make_ghost", "restore_ghost", "confirm_and_recycle",
]


def test_windows_platform_has_every_method_of_the_contract():
    for name in CONTRACT_METHODS:
        assert callable(getattr(WindowsPlatform, name)), name
    # 代役（FakePlatform）にある、テスト用（simulate_*）以外のメソッドは、すべて本番にもある
    for name, member in inspect.getmembers(FakePlatform, inspect.isfunction):
        if not name.startswith(("_", "simulate_")):
            assert hasattr(WindowsPlatform, name), name
    assert WindowsPlatform.name == "windows"


def test_structures_have_the_windows_sizes():
    assert ctypes.sizeof(platform_windows.LASTINPUTINFO) == 8
    assert ctypes.sizeof(platform_windows.SYSTEM_POWER_STATUS) == 12
    assert ctypes.sizeof(platform_windows.FILETIME) == 8
    assert ctypes.sizeof(platform_windows.GUID) == 16
    downloads = platform_windows.FOLDERID_DOWNLOADS
    assert (downloads.Data1, downloads.Data2, downloads.Data3) == (0x374DE290, 0x123F, 0x4565)
    assert bytes(downloads.Data4) == bytes.fromhex("916439C4925E467B")


@not_windows
def test_without_windows_nothing_pretends_to_succeed(tmp_path):
    target = tmp_path / "資料.pdf"
    target.write_bytes(b"%PDF")
    platform = WindowsPlatform(FakeLink())
    assert platform.get_idle_seconds() is None
    assert platform.get_power_source() == "unknown"
    assert platform.get_volume_info(target) == {
        "filesystem": None, "drive_type": "unknown",
        "reason": "ドライブの情報を読めません（Windows の機能を使えません）"}
    assert platform.access_time_reliable(target) is None
    assert platform.can_open_exclusively(target) is False
    assert platform.read_zone_identifier(target) is None
    assert platform.known_downloads_dir() is None
    assert platform_windows.known_downloads_dir() is None
    state = platform.get_local_state(target)
    assert state["local"] is False and state["attributes"] is None
    assert platform.is_sync_root_registered(tmp_path) is None
    assert platform.check_sync_folder(target)["inside"] is None
    with pytest.raises(OSError):
        platform.open_for_copy(target)
    with pytest.raises(OSError):
        platform.open_for_analysis(target)


def test_get_file_key_uses_os_stat(tmp_path):
    target = tmp_path / "a.txt"
    target.write_text("x", encoding="utf-8")
    info = os.stat(target)
    platform = WindowsPlatform(FakeLink())
    assert platform.get_file_key(target) == f"{info.st_dev}:{info.st_ino}"
    assert platform.get_file_key(tmp_path / "missing.txt") is None


def test_missing_file_is_not_local(tmp_path):
    state = WindowsPlatform(FakeLink()).get_local_state(tmp_path / "missing.txt")
    assert state["local"] is False
    assert state["reason"] == "ファイルが見つかりません"


# ----------------------------------------------------------------------
# Windows の API を使わない部品
# ----------------------------------------------------------------------


def test_idle_time_survives_the_32_bit_tick_wrap():
    assert platform_windows.idle_milliseconds(5000, 2000) == 3000
    assert platform_windows.idle_milliseconds(7, 7) == 0
    # GetTickCount が約 49.7 日で 0 に戻った直後でも、正しい差になる
    assert platform_windows.idle_milliseconds(100, 0xFFFFFF00) == 356
    assert platform_windows.idle_milliseconds(0, 0xFFFFFFFF) == 1


@pytest.mark.parametrize("value, expected", [(0, "battery"), (1, "ac"), (255, "unknown"), (7, "unknown"), (None, "unknown")])
def test_power_source_names(value, expected):
    assert platform_windows.power_source_from_ac_line(value) == expected


@pytest.mark.parametrize("attributes, tag, expected", [
    # 通常のファイル（ARCHIVE）
    (0x20, 0, {"local": True, "placeholder": False, "pinned": False, "reparse": False}),
    # 中身が未取得のクラウドのプレースホルダー（pip0 のゴーストも同じ）
    (0x20 | 0x400 | 0x00400000, 0x9000001A, {"local": False, "placeholder": True, "pinned": False, "reparse": True}),
    # 開くと取得が始まるもの
    (0x00040000, 0, {"local": False, "placeholder": True, "pinned": False, "reparse": False}),
    # オフライン（別の記憶装置へ移されたもの）
    (0x1000, 0, {"local": False, "placeholder": False, "pinned": False, "reparse": False}),
    # 「常にこのデバイス上に保持する」の、中身があるプレースホルダー
    (0x20 | 0x400 | 0x00080000, 0x9000301A, {"local": True, "placeholder": True, "pinned": True, "reparse": True}),
    # シンボリックリンクとジャンクションは、たどらない
    (0x20 | 0x400, 0xA000000C, {"local": False, "placeholder": False, "pinned": False, "reparse": True}),
    (0x10 | 0x400, 0xA0000003, {"local": False, "placeholder": False, "pinned": False, "reparse": True}),
    # 重複除去などの再解析ポイント：中身はこの PC にあるが、再解析ポイントとして知らせる
    (0x20 | 0x400, 0x80000013, {"local": True, "placeholder": False, "pinned": False, "reparse": True}),
])
def test_local_state_from_attributes(attributes, tag, expected):
    state = platform_windows.describe_local_state(attributes, tag)
    assert {key: state[key] for key in expected} == expected
    assert state["attributes"] == attributes
    if not expected["local"]:
        assert state["reason"]


def test_cloud_reparse_tags():
    assert platform_windows.is_cloud_reparse_tag(0x9000001A)
    assert platform_windows.is_cloud_reparse_tag(0x9000F01A)
    assert not platform_windows.is_cloud_reparse_tag(0xA000000C)
    assert not platform_windows.is_cloud_reparse_tag(0)
    assert not platform_windows.is_cloud_reparse_tag(None)


@pytest.mark.parametrize("value, expected", [
    (0, True), (1, False),                          # ユーザーが決めた設定
    (0x80000000, True), (0x80000001, False),        # システムが管理する設定
    (0x80000002, True), (0x80000003, False),
    (None, None), ("1", None), (True, None),        # 読めない値は「分からない」
])
def test_last_access_registry_value(value, expected):
    assert platform_windows.last_access_enabled_from_registry(value) is expected


@pytest.mark.parametrize("code, expected", [
    (3, "fixed"), (2, "removable"), (4, "network"), (5, "removable"), (0, "unknown"), (1, "unknown"), (6, "unknown"),
])
def test_drive_type_names(code, expected):
    assert platform_windows.drive_type_name(code) == expected


@pytest.mark.parametrize("path, expected", [
    ("C:\\Users\\u\\OneDrive\\資料\\a.pdf", "OneDrive"),
    ("C:\\Users\\u\\OneDrive - 日本大学\\a.pdf", "OneDrive"),
    ("c:\\users\\u\\ONEDRIVE\\a.pdf", "OneDrive"),
    ("D:\\Dropbox (Personal)\\a.pdf", "Dropbox"),
    ("C:\\Users\\u\\Dropbox\\a.pdf", "Dropbox"),
    ("G:\\My Drive\\a.pdf", "Google ドライブ"),
    ("G:\\マイドライブ\\a.pdf", "Google ドライブ"),
    ("C:\\Users\\u\\Google Drive\\a.pdf", "Google ドライブ"),
    ("C:\\Users\\u\\Box\\a.pdf", "Box"),
    ("C:\\Users\\u\\iCloudDrive\\a.pdf", "iCloud Drive"),
    ("/home/u/Dropbox/a.pdf", "Dropbox"),
    ("C:\\Users\\u\\pip0\\a.pdf", None),
    ("C:\\Users\\u\\Documents\\onedrive-notes\\a.pdf", None),
    ("C:\\Users\\u\\Downloads\\boxes\\a.pdf", None),
])
def test_sync_folder_name_heuristic(path, expected):
    assert platform_windows.sync_provider_from_name(path) == expected


def test_pip0_provider_names():
    assert platform_windows.is_pip0_provider("pip0")
    assert platform_windows.is_pip0_provider("PIP0")
    assert platform_windows.is_pip0_provider("pip0!S-1-5-21-1!default")
    assert not platform_windows.is_pip0_provider("OneDrive")
    assert not platform_windows.is_pip0_provider("pip0x")
    assert not platform_windows.is_pip0_provider(None)


def test_sync_root_hresults():
    assert platform_windows.classify_sync_root_hresult(0) == "inside"
    assert platform_windows.classify_sync_root_hresult(0x80070186) == "outside"
    assert platform_windows.classify_sync_root_hresult(0x80070186 - 2 ** 32) == "outside"   # 符号付きの値
    assert platform_windows.classify_sync_root_hresult(0x80070002) == "unknown"            # ファイルがない
    assert platform_windows.classify_sync_root_hresult(0x8007016A) == "unknown"
    assert platform_windows.hresult_text(0x80070186 - 2 ** 32) == "0x80070186"


def test_provider_info_is_read_from_the_raw_buffer():
    raw = ((1).to_bytes(4, "little")
           + "pip0".encode("utf-16-le").ljust(512, b"\0")
           + "0.1.0".encode("utf-16-le").ljust(512, b"\0")
           + b"\0" * 100)
    assert platform_windows.parse_provider_info(raw) == {
        "provider_status": 1, "provider_name": "pip0", "provider_version": "0.1.0"}
    assert platform_windows.parse_provider_info(b"\0" * 8)["provider_name"] == ""


def test_long_paths_get_the_prefix():
    short = "C:\\Users\\u\\pip0\\a.pdf"
    assert platform_windows.long_path(short) == short
    deep = "C:\\" + "a" * 300
    assert platform_windows.long_path(deep) == "\\\\?\\" + deep
    unc = "\\\\server\\share\\" + "b" * 300
    assert platform_windows.long_path(unc) == "\\\\?\\UNC\\server\\share\\" + "b" * 300
    assert platform_windows.long_path("\\\\?\\" + deep) == "\\\\?\\" + deep
    assert platform_windows.strip_long_path_prefix("\\\\?\\C:\\") == "C:\\"
    assert platform_windows.strip_long_path_prefix("\\\\?\\UNC\\server\\share\\") == "\\\\server\\share\\"
    assert platform_windows.strip_long_path_prefix("\\\\?\\Volume{1234}\\") == "\\\\?\\Volume{1234}\\"


def test_open_errors_become_python_exceptions_without_paths():
    in_use = platform_windows.open_error(32)
    assert isinstance(in_use, PermissionError) and in_use.errno == errno.EACCES
    assert "使用中" in str(in_use)
    assert isinstance(platform_windows.open_error(33), PermissionError)
    assert isinstance(platform_windows.open_error(5), PermissionError)
    assert isinstance(platform_windows.open_error(2), FileNotFoundError)
    assert isinstance(platform_windows.open_error(3), FileNotFoundError)
    other = platform_windows.open_error(1920)
    assert type(other) is OSError and "1920" in str(other)


def test_zone_identifier_text_is_decoded():
    text = "[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://files.slack.com/x\r\n"
    assert platform_windows.decode_zone_text(text.encode("utf-8")) == text
    assert platform_windows.decode_zone_text(b"\xef\xbb\xbf" + text.encode("utf-8")) == text
    assert platform_windows.decode_zone_text(b"\xff\xfe" + text.encode("utf-16-le")) == text
    assert "\ufffd" in platform_windows.decode_zone_text(b"ZoneId=3\xff")


def test_ghost_timeout_grows_with_the_size():
    base = platform_windows.GHOST_BASE_TIMEOUT_SECONDS
    assert platform_windows.ghost_timeout_seconds(0) == base
    assert platform_windows.ghost_timeout_seconds(1024 ** 3) == base + platform_windows.GHOST_SECONDS_PER_GIB
    assert platform_windows.ghost_timeout_seconds(None) == platform_windows.GHOST_UNKNOWN_SIZE_TIMEOUT_SECONDS
    assert platform_windows.ghost_timeout_seconds(-1) == platform_windows.GHOST_UNKNOWN_SIZE_TIMEOUT_SECONDS


# ----------------------------------------------------------------------
# 同期フォルダーの判定（Cloud Files API の答えを代役にする）
# ----------------------------------------------------------------------


def test_check_sync_folder_combines_the_api_and_folder_names(monkeypatch, tmp_path):
    root = tmp_path / "pip0"
    root.mkdir()
    inside_root = root / "予算・会計" / "a.xlsx"
    platform = WindowsPlatform(FakeLink(), pip0_root=root)

    answer_sync_root(monkeypatch, "inside", "pip0")
    assert platform.check_sync_folder(inside_root) == {
        "inside": True, "provider": "pip0", "reason": "pip0 の同期ルート（pip0 専用フォルダー）の中です"}

    # pip0 専用フォルダーがほかのクラウドの中にある場合は、そのクラウドとして扱う（退避しない）
    answer_sync_root(monkeypatch, "inside", "OneDrive")
    result = platform.check_sync_folder(inside_root)
    assert (result["inside"], result["provider"]) == (True, "OneDrive")

    # 提供元の名前を読めなくても、pip0 専用フォルダーの中なら pip0 の同期ルート
    answer_sync_root(monkeypatch, "inside", None)
    assert platform.check_sync_folder(inside_root)["provider"] == "pip0"
    other = platform.check_sync_folder(tmp_path / "other" / "a.txt")
    assert (other["inside"], other["provider"]) == (True, "名前の分からない提供元")

    # Cloud Files API の外でも、フォルダーの名前が同期アプリのものなら「中」
    answer_sync_root(monkeypatch, "outside")
    assert platform.check_sync_folder(tmp_path / "x.pdf") == {"inside": False, "provider": None, "reason": ""}
    result = platform.check_sync_folder(tmp_path / "Dropbox" / "x.pdf")
    assert (result["inside"], result["provider"]) == (True, "Dropbox")

    # 判定できないときは None（ただし、名前で同期フォルダーと分かれば「中」）
    answer_sync_root(monkeypatch, "unknown")
    assert platform.check_sync_folder(tmp_path / "x.pdf") == {"inside": None, "provider": None, "reason": "テスト用の答え"}
    assert platform.check_sync_folder(tmp_path / "OneDrive" / "x.pdf")["inside"] is True


def test_is_sync_root_registered(monkeypatch, tmp_path):
    root = tmp_path / "pip0"
    platform = WindowsPlatform(FakeLink(), pip0_root=root)
    answer_sync_root(monkeypatch, "inside", "pip0")
    assert platform.is_sync_root_registered(root) is True
    answer_sync_root(monkeypatch, "inside", "OneDrive")
    assert platform.is_sync_root_registered(root) is False
    answer_sync_root(monkeypatch, "outside")
    assert platform.is_sync_root_registered(root) is False
    answer_sync_root(monkeypatch, "unknown")
    assert platform.is_sync_root_registered(root) is None


def test_existing_folder_is_used_for_the_sync_root_query(tmp_path):
    folder = tmp_path / "pip0"
    folder.mkdir()
    target = folder / "a.pdf"
    target.write_bytes(b"x")
    assert platform_windows.existing_folder_for(str(target)) == str(folder)
    assert platform_windows.existing_folder_for(str(folder)) == str(folder)
    assert platform_windows.existing_folder_for(str(folder / "new" / "deeper" / "b.pdf")) == str(folder)


# ----------------------------------------------------------------------
# 同期ルートの登録（シェルに頼む）
# ----------------------------------------------------------------------


def test_register_sync_root_registers_then_connects(monkeypatch, tmp_path):
    answer_sync_root(monkeypatch, "outside")
    link = FakeLink({
        "cf.register_root": {"registered": True, "already": False, "reason": ""},
        "cf.connect": {"connected": True, "reason": ""},
    })
    platform = WindowsPlatform(link)
    root = tmp_path / "pip0"
    assert platform.register_sync_root(root, "pip0") == {"ok": True, "reason": ""}
    assert link.types() == ["cf.register_root", "cf.connect"]
    assert link.calls[0]["payload"] == {"path": str(root), "display_name": "pip0"}
    assert link.calls[1]["payload"] == {"path": str(root)}
    assert platform.pip0_root == str(root)


def test_register_sync_root_reports_each_failure(monkeypatch, tmp_path):
    root = tmp_path / "pip0"
    answer_sync_root(monkeypatch, "outside")

    refused = FakeLink({"cf.register_root": {"registered": False, "already": False, "reason": "FAT32 のドライブです"}})
    assert WindowsPlatform(refused).register_sync_root(root, "pip0") == {"ok": False, "reason": "FAT32 のドライブです"}
    assert refused.types() == ["cf.register_root"]          # 登録できなければ、つながない

    not_connected = FakeLink({
        "cf.register_root": {"registered": True, "already": True, "reason": ""},
        "cf.connect": {"connected": False, "reason": "接続できません"},
    })
    result = WindowsPlatform(not_connected).register_sync_root(root, "pip0")
    assert result["ok"] is False and "接続できません" in result["reason"]

    connect_error = FakeLink({
        "cf.register_root": {"registered": True, "already": True, "reason": ""},
        "cf.connect": ShellTimeout("時間切れ"),
    })
    result = WindowsPlatform(connect_error).register_sync_root(root, "pip0")
    assert result["ok"] is False and "時間内に答えがありませんでした" in result["reason"]

    no_shell = FakeLink({"cf.register_root": ShellUnavailable("動いていません")})
    result = WindowsPlatform(no_shell).register_sync_root(root, "pip0")
    assert result["ok"] is False and "pip0 シェル" in result["reason"]

    # ほかのクラウドの同期フォルダーの中や、判定できない場所は、シェルに頼まずに断る
    inside_onedrive = FakeLink()
    result = WindowsPlatform(inside_onedrive).register_sync_root(tmp_path / "OneDrive" / "pip0", "pip0")
    assert result["ok"] is False and "OneDrive" in result["reason"]
    answer_sync_root(monkeypatch, "unknown")
    result = WindowsPlatform(inside_onedrive).register_sync_root(root, "pip0")
    assert result["ok"] is False and "判定できない" in result["reason"]
    assert inside_onedrive.calls == []


def test_unregister_sync_root(tmp_path):
    done = FakeLink({"cf.unregister_root": {"unregistered": True, "reason": ""}})
    assert WindowsPlatform(done).unregister_sync_root(tmp_path) == {"ok": True, "reason": ""}
    refused = FakeLink({"cf.unregister_root": {"unregistered": False, "reason": "ゴーストが 2 件残っています"}})
    assert WindowsPlatform(refused).unregister_sync_root(tmp_path) == {"ok": False, "reason": "ゴーストが 2 件残っています"}
    missing = FakeLink({"cf.unregister_root": ShellUnavailable("動いていません")})
    assert WindowsPlatform(missing).unregister_sync_root(tmp_path)["ok"] is False


# ----------------------------------------------------------------------
# ゴースト（シェルに頼む）
# ----------------------------------------------------------------------


def test_ghost_status_passes_the_answer_through(tmp_path):
    target = tmp_path / "a.pdf"
    link = FakeLink({"cf.status": {"exists": True, "is_ghost": True, "item_id": ITEM_ID.upper(),
                                   "dehydrated": True, "in_sync": True, "pinned": False, "reason": ""}})
    status = WindowsPlatform(link).ghost_status(target)
    assert status == {"exists": True, "is_ghost": True, "item_id": ITEM_ID, "dehydrated": True,
                      "in_sync": True, "pinned": False, "reason": ""}
    assert link.calls[0]["payload"] == {"path": str(target)}
    assert link.calls[0]["timeout"] == platform_windows.STATUS_TIMEOUT_SECONDS


def test_ghost_status_with_odd_values_becomes_unknown(tmp_path):
    link = FakeLink({"cf.status": {"exists": "yes", "is_ghost": 1, "item_id": 5, "reason": None}})
    status = WindowsPlatform(link).ghost_status(tmp_path / "a.pdf")
    assert status == {"exists": None, "is_ghost": None, "item_id": None, "dehydrated": None,
                      "in_sync": None, "pinned": None, "reason": ""}


@pytest.mark.parametrize("error", [
    ShellUnavailable("動いていません"),
    ShellTimeout("時間切れ"),
    ShellError("internal_error", "シェルの内部のエラー"),
    ShellError("not_initialised", "init の前です"),
])
def test_ghost_status_when_the_shell_cannot_answer(tmp_path, error):
    present = tmp_path / "present.pdf"
    present.write_bytes(b"x")
    platform = WindowsPlatform(FakeLink({"cf.status": error}))
    status = platform.ghost_status(present)
    assert status["is_ghost"] is None and status["item_id"] is None
    assert status["exists"] is True          # あることだけは、この場で確かめられる
    assert status["reason"]
    assert platform.ghost_status(tmp_path / "missing.pdf")["exists"] is False


EXPECTED = {"size": 2048, "mtime_ns": 1_700_000_000_000_000_000, "file_key": "12:34", "sha256": "ab" * 32}


@pytest.mark.parametrize("reply, expected_result", [
    ({"result": "ghosted", "reason": ""}, "ghosted"),
    ({"result": "changed", "reason": "大きさが違います"}, "changed"),
    ({"result": "locked", "reason": "使用中です"}, "locked"),
    ({"result": "not_in_root", "reason": "同期ルートの外です"}, "not_in_root"),
    ({"result": "error", "reason": "失敗しました"}, "error"),
    ({"result": "maybe"}, "error"),                                   # 約束にない答えは成功にしない
    ({}, "error"),
    (ShellUnavailable("動いていません"), "unavailable"),
    (ShellTimeout("時間切れ"), "unavailable"),
    (ShellError("not_initialised", "init の前です"), "unavailable"),
    (ShellError("shutting_down", "終了中です"), "unavailable"),
    (ShellError("bad_request", "形が違います"), "error"),
])
def test_make_ghost_results(tmp_path, reply, expected_result):
    link = FakeLink({"cf.make_ghost": reply})
    target = tmp_path / "a.pdf"
    result = WindowsPlatform(link).make_ghost(target, ITEM_ID, dict(EXPECTED, extra="ignored"))
    assert result["result"] == expected_result
    assert set(result) == {"result", "reason"}
    if expected_result != "ghosted":
        assert result["reason"]
    call = link.calls[0]
    assert call["payload"] == {"path": str(target), "item_id": ITEM_ID, "expected": EXPECTED}
    assert call["timeout"] == platform_windows.ghost_timeout_seconds(EXPECTED["size"])


def test_a_late_make_ghost_answer_makes_the_status_unknown_until_the_shell_restarts(tmp_path):
    target = tmp_path / "a.pdf"
    target.write_bytes(b"x")
    status_reply = {"exists": True, "is_ghost": False, "item_id": None, "dehydrated": False,
                    "in_sync": None, "pinned": False, "reason": ""}
    link = FakeLink({"cf.make_ghost": ShellTimeout("時間切れ"), "cf.status": status_reply})
    platform = WindowsPlatform(link)
    assert platform.make_ghost(target, ITEM_ID, EXPECTED)["result"] == "unavailable"
    # シェルがまだ作業しているかもしれないので、「通常のファイル」とは答えない
    status = platform.ghost_status(target)
    assert status["is_ghost"] is None and status["exists"] is True
    assert link.types() == ["cf.make_ghost"]
    # ほかの場所は、いつもどおりシェルに聞く
    assert platform.ghost_status(tmp_path / "b.pdf")["is_ghost"] is False
    # シェルが終わった後は、遅れていた処理も終わっているので、また聞ける
    link.alive = False
    assert platform.ghost_status(target)["is_ghost"] is False


@pytest.mark.parametrize("reply, expected_result", [
    ({"result": "restored", "reason": ""}, "restored"),
    ({"result": "already_regular", "reason": "通常のファイルです"}, "already_regular"),
    ({"result": "not_our_placeholder", "reason": "別の項目です"}, "not_our_placeholder"),
    ({"result": "missing", "reason": "ありません"}, "missing"),
    ({"result": "error", "reason": "戻せません"}, "error"),
    ({"result": "ghosted"}, "error"),
    (ShellUnavailable("動いていません"), "unavailable"),
    (ShellTimeout("時間切れ"), "unavailable"),
    (ShellError("internal_error", "内部のエラー"), "error"),
])
def test_restore_ghost_results(tmp_path, reply, expected_result):
    target = tmp_path / "a.pdf"
    target.write_bytes(b"x" * 10)
    link = FakeLink({"cf.restore": reply})
    result = WindowsPlatform(link).restore_ghost(target, ITEM_ID)
    assert result["result"] == expected_result
    assert link.calls[0]["payload"] == {"path": str(target), "item_id": ITEM_ID}
    assert link.calls[0]["timeout"] == platform_windows.ghost_timeout_seconds(10)


# ----------------------------------------------------------------------
# 削除の確認とごみ箱（シェルに頼む）
# ----------------------------------------------------------------------

TRASH_REQUEST = {
    "request_id": "r1",
    "title": "ごみ箱へ移動の確認",
    "message": "2 件をごみ箱へ移します",
    "items": [{"path": "C:\\Users\\u\\Downloads\\a.pdf", "name": "a.pdf", "size": 10},
              {"path": "C:\\Users\\u\\Downloads\\b.pdf", "name": "b.pdf", "size": 20}],
}


def test_confirm_and_recycle_passes_the_answer_through():
    reply = {"approved": True, "answer": "approve", "results": [
        {"path": "C:\\Users\\u\\Downloads\\a.pdf", "status": "recycled", "reason": ""},
        {"path": "C:\\Users\\u\\Downloads\\b.pdf", "status": "refused", "reason": "ごみ箱を使えない場所です"},
    ]}
    link = FakeLink({"trash.confirm_and_recycle": reply})
    assert WindowsPlatform(link).confirm_and_recycle(TRASH_REQUEST) == reply
    call = link.calls[0]
    assert call["payload"] == TRASH_REQUEST
    assert call["timeout"] == platform_windows.TRASH_DIALOG_TIMEOUT_SECONDS


def test_confirm_and_recycle_cancel():
    reply = {"approved": False, "answer": "cancel", "results": [
        {"path": item["path"], "status": "not_attempted", "reason": "キャンセルされました"}
        for item in TRASH_REQUEST["items"]]}
    result = WindowsPlatform(FakeLink({"trash.confirm_and_recycle": reply})).confirm_and_recycle(TRASH_REQUEST)
    assert result == reply


@pytest.mark.parametrize("error, phrase", [
    (ShellUnavailable("動いていません"), "何も削除していません"),
    (ShellError("not_initialised", "init の前です"), "何も削除していません"),
    (ShellTimeout("時間切れ"), "キャンセルしてください"),
])
def test_confirm_and_recycle_without_the_shell_deletes_nothing(error, phrase):
    result = WindowsPlatform(FakeLink({"trash.confirm_and_recycle": error})).confirm_and_recycle(TRASH_REQUEST)
    assert result["approved"] is False
    assert result["answer"] == "unavailable"
    assert [item["status"] for item in result["results"]] == ["not_attempted", "not_attempted"]
    assert [item["path"] for item in result["results"]] == [item["path"] for item in TRASH_REQUEST["items"]]
    assert phrase in result["results"][0]["reason"]


def test_confirm_and_recycle_never_treats_an_odd_answer_as_approval():
    odd = {"approved": True, "answer": "maybe", "results": [
        {"path": "C:\\Users\\u\\Downloads\\a.pdf", "status": "vanished"},
        "not a dict",
    ]}
    result = WindowsPlatform(FakeLink({"trash.confirm_and_recycle": odd})).confirm_and_recycle(TRASH_REQUEST)
    assert result["approved"] is False
    assert result["answer"] == "unavailable"
    assert result["results"] == [{"path": "C:\\Users\\u\\Downloads\\a.pdf", "status": "failed",
                                  "reason": "pip0 シェルの答えを読めませんでした"}]
    no_results = {"approved": True, "answer": "approve", "results": "none"}
    result = WindowsPlatform(FakeLink({"trash.confirm_and_recycle": no_results})).confirm_and_recycle(TRASH_REQUEST)
    assert result == {"approved": True, "answer": "approve", "results": []}
