"""Windows 11 の OS 連携（WindowsPlatform）

pip0 の処理は、OS の機能を引数の platform を通して使います（docs/design.md 5-1、6-2）。
このファイルが本番用で、テストとデモでは、同じ名前のメソッドを持つ platform_fake.FakePlatform を使います。
pip0 本体（Python）で Windows の API を直接呼ぶのは、このファイルだけです。

OS の機能の使い方は2通りです。

1. Python から直接読む（ctypes、winreg、msvcrt、os だけを使う）
   - セッション全体の無操作の秒数（GetLastInputInfo）、電源（GetSystemPowerStatus）
   - ファイルの属性・ボリューム・ドライブの種類、同期フォルダーの判定（CfGetSyncRootInfoByPath）
   - 最終アクセス日時の更新の設定（レジストリー）、Zone.Identifier
   - 最終アクセス日時を変えない開き方（CreateFileW と SetFileTime）、「ダウンロード」の場所
2. pip0 シェル（C#）に頼む（shell_link の request。形は docs/ipc-protocol.md の2節）
   - ゴースト（Cloud Files API。開かれたときに中身を渡すコールバックが必要なため）
   - ごみ箱と確認画面（IFileOperation と画面）

Windows 以外でも import できます（Windows の DLL は、使うときに初めて読み込みます）。
Windows 以外で呼んだときや、シェルが動いていないときは、「取得できない」（None、"unknown"、
"unavailable" 等）を返します。成功したふりはしません。
"""

import codecs
import ctypes
import errno
import logging
import os
import re
import sys
import threading
from pathlib import Path

from pip0.shell_link import ShellError, ShellTimeout, ShellUnavailable

logger = logging.getLogger(__name__)

# ----------------------------------------------------------------------
# 待ち時間（pip0 シェルの答えを待つ秒数）★
# ----------------------------------------------------------------------

STATUS_TIMEOUT_SECONDS = 30                 # ゴーストの状態の読み取り（cf.status）
LOCATE_TIMEOUT_SECONDS = 60                 # pip0 専用フォルダーの中でゴーストを探す（cf.locate。シェルは 20 秒で打ち切る）
REGISTER_TIMEOUT_SECONDS = 60               # 同期ルートの登録・接続・解除
GHOST_BASE_TIMEOUT_SECONDS = 60             # ゴーストの作成・復元の基本の待ち時間
GHOST_SECONDS_PER_GIB = 600                 # 1 GiB ごとに加える待ち時間（遅いドライブでの2回のハッシュ計算を見込む）
GHOST_UNKNOWN_SIZE_TIMEOUT_SECONDS = 3600   # 大きさが分からないとき
TRASH_DIALOG_TIMEOUT_SECONDS = 24 * 60 * 60  # 削除の確認画面（ユーザーが答えるまで待つ）

ZONE_IDENTIFIER_MAX_BYTES = 64 * 1024       # Zone.Identifier を読む上限

# ----------------------------------------------------------------------
# クラウドの同期フォルダーを名前で見分ける（Cloud Files API を使わない同期アプリのため）★
# この名前のフォルダーの中は「同期フォルダーの中」として扱い、退避しません（安全側の判定）。
# 大文字・小文字は区別しません。
# ----------------------------------------------------------------------

SYNC_FOLDER_NAMES = {
    "onedrive": "OneDrive",
    "dropbox": "Dropbox",
    "google drive": "Google ドライブ",
    "my drive": "Google ドライブ",
    "マイドライブ": "Google ドライブ",
    "box": "Box",
    "iclouddrive": "iCloud Drive",
    "icloud drive": "iCloud Drive",
}
# 名前の始まりで見分けるもの（例：「OneDrive - 日本大学」「Dropbox (Personal)」）
SYNC_FOLDER_PREFIXES = {
    "onedrive - ": "OneDrive",
    "dropbox (": "Dropbox",
}

# ----------------------------------------------------------------------
# Windows の値（Microsoft の文書の名前のまま）
# ----------------------------------------------------------------------

# ファイルの属性（os.stat の st_file_attributes）
FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400
FILE_ATTRIBUTE_OFFLINE = 0x00001000
FILE_ATTRIBUTE_RECALL_ON_OPEN = 0x00040000
FILE_ATTRIBUTE_PINNED = 0x00080000
FILE_ATTRIBUTE_UNPINNED = 0x00100000
FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS = 0x00400000
# 中身がこの PC にない印（読むと、クラウド等からの取得が始まる）
NOT_LOCAL_ATTRIBUTES = FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS | FILE_ATTRIBUTE_RECALL_ON_OPEN | FILE_ATTRIBUTE_OFFLINE
# クラウドのプレースホルダーに付く印
CLOUD_ATTRIBUTES = (FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS | FILE_ATTRIBUTE_RECALL_ON_OPEN
                    | FILE_ATTRIBUTE_PINNED | FILE_ATTRIBUTE_UNPINNED)

# 再解析ポイントの種類（タグ）
IO_REPARSE_TAG_MOUNT_POINT = 0xA0000003   # ジャンクション
IO_REPARSE_TAG_SYMLINK = 0xA000000C       # シンボリックリンク
IO_REPARSE_TAG_CLOUD = 0x9000001A         # クラウドのプレースホルダー（CLOUD_1〜CLOUD_F も同じ仲間）
IO_REPARSE_TAG_CLOUD_MASK = 0x0000F000
REPARSE_TAG_NAME_SURROGATE = 0x20000000   # この印のあるタグは、別の場所を指す「名前の代わり」（リンクの仲間）

# FindFirstFileExW
FIND_EX_INFO_BASIC = 1                    # 短い名前（8.3 形式）を読まない
FIND_EX_SEARCH_NAME_MATCH = 0

# CreateFileW
GENERIC_READ = 0x80000000
FILE_WRITE_ATTRIBUTES = 0x00000100   # SetFileTime に必要（中身は書き換えない）
FILE_SHARE_READ = 0x00000001
FILE_SHARE_WRITE = 0x00000002
FILE_SHARE_DELETE = 0x00000004
OPEN_EXISTING = 3
FILE_FLAG_SEQUENTIAL_SCAN = 0x08000000
FILE_FLAG_OPEN_NO_RECALL = 0x00100000   # クラウドから中身を取ってこさせない
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value
MAX_PATH = 260

# Windows のエラー番号
ERROR_FILE_NOT_FOUND = 2
ERROR_PATH_NOT_FOUND = 3
ERROR_ACCESS_DENIED = 5
ERROR_SHARING_VIOLATION = 32
ERROR_LOCK_VIOLATION = 33

# Cloud Files API（cldapi.dll）
S_OK = 0
HRESULT_NOT_UNDER_SYNC_ROOT = 0x80070186   # ERROR_CLOUD_FILE_NOT_UNDER_SYNC_ROOT（390）の HRESULT
CF_SYNC_ROOT_INFO_PROVIDER = 2
PROVIDER_INFO_BUFFER_BYTES = 4096          # CF_SYNC_ROOT_PROVIDER_INFO（1028 バイト）より大きめに用意する
PROVIDER_NAME_OFFSET = 4                   # ProviderStatus（4 バイト）の後
PROVIDER_NAME_BYTES = 512                  # WCHAR 256 文字
PROVIDER_VERSION_OFFSET = PROVIDER_NAME_OFFSET + PROVIDER_NAME_BYTES

# ドライブの種類（GetDriveTypeW）→ pip0 の名前。0（不明）、1（ルートなし）、6（RAM ディスク）は "unknown"
DRIVE_TYPE_NAMES = {2: "removable", 3: "fixed", 4: "network", 5: "removable"}

# 電源（SYSTEM_POWER_STATUS の ACLineStatus）→ pip0 の名前。255（不明）などは "unknown"
AC_LINE_NAMES = {0: "battery", 1: "ac"}

# 最終アクセス日時の更新の設定（レジストリー）
FILESYSTEM_KEY = r"SYSTEM\CurrentControlSet\Control\FileSystem"
LAST_ACCESS_VALUE_NAME = "NtfsDisableLastAccessUpdate"

# シェルの答えの result として約束にある値（docs/ipc-protocol.md の2節）
GHOST_RESULTS = ("ghosted", "changed", "locked", "not_in_root", "error")
RESTORE_RESULTS = ("restored", "already_regular", "not_our_placeholder", "missing", "error")
TRASH_ANSWERS = ("approve", "cancel", "closed", "unavailable")
TRASH_STATUSES = ("recycled", "refused", "failed", "not_attempted")
# シェルの失敗の答えのうち、「準備ができていない・終了中」を表す code
NOT_READY_CODES = ("not_initialised", "shutting_down", "unavailable")


# ----------------------------------------------------------------------
# Windows の構造体（大きさが OS によらないように、ビット数の決まった型で書く）
# ----------------------------------------------------------------------


class LASTINPUTINFO(ctypes.Structure):
    _fields_ = [("cbSize", ctypes.c_uint32), ("dwTime", ctypes.c_uint32)]


class SYSTEM_POWER_STATUS(ctypes.Structure):
    _fields_ = [
        ("ACLineStatus", ctypes.c_ubyte),
        ("BatteryFlag", ctypes.c_ubyte),
        ("BatteryLifePercent", ctypes.c_ubyte),
        ("SystemStatusFlag", ctypes.c_ubyte),
        ("BatteryLifeTime", ctypes.c_uint32),
        ("BatteryFullLifeTime", ctypes.c_uint32),
    ]


class FILETIME(ctypes.Structure):
    _fields_ = [("dwLowDateTime", ctypes.c_uint32), ("dwHighDateTime", ctypes.c_uint32)]


class WIN32_FIND_DATAW(ctypes.Structure):
    """FindFirstFileExW が返すフォルダーの中の項目の情報（名前の欄は使わないので、2 バイトの数の並びで持つ）"""
    _fields_ = [
        ("dwFileAttributes", ctypes.c_uint32),
        ("ftCreationTime", FILETIME),
        ("ftLastAccessTime", FILETIME),
        ("ftLastWriteTime", FILETIME),
        ("nFileSizeHigh", ctypes.c_uint32),
        ("nFileSizeLow", ctypes.c_uint32),
        ("dwReserved0", ctypes.c_uint32),     # 再解析ポイントのとき、そのタグ
        ("dwReserved1", ctypes.c_uint32),
        ("cFileName", ctypes.c_uint16 * 260),
        ("cAlternateFileName", ctypes.c_uint16 * 14),
    ]


class GUID(ctypes.Structure):
    _fields_ = [
        ("Data1", ctypes.c_uint32),
        ("Data2", ctypes.c_uint16),
        ("Data3", ctypes.c_uint16),
        ("Data4", ctypes.c_ubyte * 8),
    ]


# 「ダウンロード」フォルダーの ID（FOLDERID_Downloads {374DE290-123F-4565-9164-39C4925E467B}）
FOLDERID_DOWNLOADS = GUID(0x374DE290, 0x123F, 0x4565, (ctypes.c_ubyte * 8)(0x91, 0x64, 0x39, 0xC4, 0x92, 0x5E, 0x46, 0x7B))

HANDLE = ctypes.c_void_p


# ----------------------------------------------------------------------
# DLL の関数を読み込む
# ----------------------------------------------------------------------

_functions = {}


def win_function(dll_name, function_name, restype, argtypes):
    """Windows の DLL の関数を、戻り値と引数の型を決めて返す（初めて使うときに読み込む）

    Windows 以外では OSError を出します（呼ぶ側が「取得できない」として扱う）。
    """
    key = (dll_name, function_name)
    if key not in _functions:
        if sys.platform != "win32":
            raise OSError(errno.ENOSYS, "この機能は Windows でだけ使えます")
        dll = ctypes.WinDLL(dll_name, use_last_error=True)
        function = getattr(dll, function_name)
        function.restype = restype
        function.argtypes = argtypes
        _functions[key] = function
    return _functions[key]


def last_error():
    """直前の Windows の関数のエラー番号（GetLastError）"""
    return ctypes.get_last_error()


def valid_handle(handle):
    return handle is not None and handle != INVALID_HANDLE_VALUE


def close_handle(handle):
    close = win_function("kernel32.dll", "CloseHandle", ctypes.c_int, [HANDLE])
    close(handle)


# ----------------------------------------------------------------------
# WindowsPlatform
# ----------------------------------------------------------------------


class WindowsPlatform:
    """Windows 11 の OS 連携。メソッドの名前と戻り値は FakePlatform と同じ（docs/design.md 6-2）

    link：pip0 シェルとのつながり（shell_link.ShellLink）。ゴーストとごみ箱はシェルに頼む
    pip0_root：pip0 専用フォルダー（同期ルート）。check_sync_folder の判定に使う（後から set_pip0_root でも渡せる）
    """

    name = "windows"

    def __init__(self, link, pip0_root=None):
        self.link = link
        self.pip0_root = None
        self._lock = threading.Lock()
        self._unsettled = {}      # 答えが遅れた（シェルがまだ処理しているかもしれない）ゴーストの場所 → そのときのシェル
        self.set_pip0_root(pip0_root)

    def set_pip0_root(self, path):
        """pip0 専用フォルダー（pip0 が同期ルートとして登録する場所）を覚える"""
        self.pip0_root = absolute_path(path) if path is not None else None

    # ------------------------------------------------------------------
    # 電源・アイドル（docs/design.md 4-2）
    # ------------------------------------------------------------------

    def get_idle_seconds(self):
        """セッション全体の無操作の秒数（キーボードとマウスの最後の入力から）。取得できなければ None

        GetLastInputInfo は、pip0 のウィンドウだけでなく、サインイン中のセッション全体の入力が対象です。
        """
        try:
            get_last_input_info = win_function("user32.dll", "GetLastInputInfo", ctypes.c_int,
                                               [ctypes.POINTER(LASTINPUTINFO)])
            get_tick_count = win_function("kernel32.dll", "GetTickCount", ctypes.c_uint32, [])
        except (OSError, AttributeError):
            return None
        info = LASTINPUTINFO()
        info.cbSize = ctypes.sizeof(LASTINPUTINFO)
        if not get_last_input_info(ctypes.byref(info)):
            return None
        return idle_milliseconds(get_tick_count(), info.dwTime) / 1000.0

    def get_power_source(self):
        """電源が "ac"（電源接続中）、"battery"（バッテリー）、"unknown"（取得できない）のどれか"""
        try:
            get_status = win_function("kernel32.dll", "GetSystemPowerStatus", ctypes.c_int,
                                      [ctypes.POINTER(SYSTEM_POWER_STATUS)])
        except (OSError, AttributeError):
            return "unknown"
        status = SYSTEM_POWER_STATUS()
        if not get_status(ctypes.byref(status)):
            return "unknown"
        return power_source_from_ac_line(status.ACLineStatus)

    # ------------------------------------------------------------------
    # ファイルとボリューム
    # ------------------------------------------------------------------

    def get_file_key(self, path):
        """「ボリューム番号:ファイル番号」（os.stat の st_dev:st_ino）。ファイルがなければ None"""
        try:
            info = os.stat(path)
        except (OSError, ValueError):
            return None
        return f"{info.st_dev}:{info.st_ino}"

    def get_local_state(self, path):
        """中身がこの PC にあるか、プレースホルダー・リンクか。{"local", "placeholder", "pinned", "reparse", "attributes", "reason"}

        local=False（クラウドの未取得のプレースホルダー、pip0 のゴースト、リンク、読めない）のファイルは読まないこと。
        リンクはたどらず、リンクそのものの属性を見ます。
        """
        try:
            info = stat_without_following(path)
        except FileNotFoundError:
            return unknown_local_state("ファイルが見つかりません")
        except (OSError, ValueError) as error:
            return unknown_local_state(f"ファイルの状態を読めません（{type(error).__name__}）")
        attributes = getattr(info, "st_file_attributes", None)
        if attributes is None:
            return unknown_local_state("Windows のファイルの属性を読めないため、中身がこの PC にあるか確かめられません")
        if not attributes & FILE_ATTRIBUTE_REPARSE_POINT:
            return describe_local_state(attributes, 0)
        # 再解析ポイント：os.lstat は、リンク以外（クラウドのプレースホルダー等）では、たどった先の情報を返し、
        # タグ（st_reparse_tag）が 0 になる（CPython の決まり）。そのため、たどらずにフォルダーの項目から読む
        entry = read_directory_entry(path)
        if entry is None:
            return unknown_local_state("再解析ポイントの種類を読めないため、中身がこの PC にあるか確かめられません")
        return describe_local_state(entry["attributes"], entry["reparse_tag"])

    def get_volume_info(self, path):
        """ファイルシステムの名前とドライブの種類。{"filesystem", "drive_type", "reason"}"""
        return read_volume_info(path)

    def check_sync_folder(self, path):
        """クラウドの同期フォルダーの中か。{"inside": True/False/None, "provider", "reason"}（None は判定できない）

        1. Cloud Files API（CfGetSyncRootInfoByPath）に聞く。pip0 自身の同期ルートの中は provider="pip0"
        2. Cloud Files API を使わない同期アプリのために、フォルダーの名前（SYNC_FOLDER_NAMES）でも見分ける
        """
        path = absolute_path(path)
        found = query_sync_root(path)
        if found["status"] == "inside":
            if self._is_pip0_sync_root(found["provider"], path):
                return {"inside": True, "provider": "pip0", "reason": "pip0 の同期ルート（pip0 専用フォルダー）の中です"}
            provider = found["provider"] or "名前の分からない提供元"
            return {"inside": True, "provider": provider,
                    "reason": f"{provider} の同期フォルダーの中です（Cloud Files API で確認）"}
        guessed = sync_provider_from_name(path)
        if guessed is not None:
            return {"inside": True, "provider": guessed,
                    "reason": f"フォルダーの名前から、{guessed} の同期フォルダーの中と判断しました"}
        if found["status"] == "outside":
            return {"inside": False, "provider": None, "reason": ""}
        return {"inside": None, "provider": None, "reason": found["reason"]}

    def access_time_reliable(self, path):
        """最終アクセス日時の更新が有効なら True、無効なら False、分からなければ None

        NTFS の設定（レジストリーの NtfsDisableLastAccessUpdate）を読みます。NTFS 以外のドライブは None。
        有効でも、NTFS は最終アクセス日時をおよそ1時間ごとにしか更新しないため、弱い手掛かりです。
        """
        if self.get_volume_info(path)["filesystem"] != "NTFS":
            return None
        return last_access_updates_enabled()

    def write_zone_identifier(self, path, text):
        """ファイルにダウンロード元の印（Zone.Identifier の代替データストリーム）を付ける。付けたら True

        すでに印があるときは書き換えません（False）。中身がこの PC にないファイルやリンクには書きません。
        """
        if not self.get_local_state(path)["local"]:
            return False
        stream_path = long_path(absolute_path(path) + ":Zone.Identifier")
        try:
            with open(stream_path, "xb") as stream:   # "x"：印がすでにあれば失敗する（書き換えない）
                stream.write(text.encode("utf-8"))
        except (OSError, ValueError):
            return False
        return True

    def read_zone_identifier(self, path):
        """ダウンロードしたファイルに Windows が付ける Zone.Identifier（代替データストリーム）の中身。なければ None

        中身がこの PC にないファイルやリンクは、開くと取得が始まるおそれがあるため、読まずに None を返します。
        """
        if not self.get_local_state(path)["local"]:
            return None
        stream_path = absolute_path(path) + ":Zone.Identifier"
        share = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE
        try:
            with open_without_access_update(stream_path, share, FILE_FLAG_OPEN_NO_RECALL) as stream:
                data = stream.read(ZONE_IDENTIFIER_MAX_BYTES)
        except (OSError, ValueError):
            return None
        return decode_zone_text(data)

    def open_for_copy(self, path):
        """保管庫へコピーするために開く。ほかのプロセスの書き込み・削除を拒否し、最終アクセス日時を変えない

        ほかのアプリが書き込み中なら PermissionError。クラウドから中身を取ってこさせません（FILE_FLAG_OPEN_NO_RECALL）。
        """
        return open_without_access_update(path, FILE_SHARE_READ, FILE_FLAG_SEQUENTIAL_SCAN | FILE_FLAG_OPEN_NO_RECALL)

    def open_for_analysis(self, path):
        """解析・ハッシュのために開く。ほかのアプリの読み書きは妨げず、最終アクセス日時を変えない"""
        share = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE
        return open_without_access_update(path, share, FILE_FLAG_SEQUENTIAL_SCAN | FILE_FLAG_OPEN_NO_RECALL)

    def can_open_exclusively(self, path):
        """ほかのプロセスが開いていなければ True（共有なしで開けるかを試し、すぐに閉じる）。確かめられなければ False"""
        try:
            create_file = create_file_function()
        except (OSError, AttributeError):
            return False
        handle = create_file(long_path(absolute_path(path)), GENERIC_READ, 0, None, OPEN_EXISTING,
                             FILE_FLAG_OPEN_NO_RECALL, None)
        if not valid_handle(handle):
            return False
        close_handle(handle)
        return True

    def known_downloads_dir(self):
        """Windows の「ダウンロード」の場所（Path）。分からなければ None"""
        return known_downloads_dir()

    # ------------------------------------------------------------------
    # ゴースト（pip0 シェルの Cloud Files API に頼む。docs/design.md 4-6、7節）
    # ------------------------------------------------------------------

    def register_sync_root(self, path, display_name):
        """pip0 専用フォルダーを同期ルートとして登録し、シェルをつなぐ。{"ok", "reason"}

        登録は Windows に残りますが、つなぐ（cf.connect）のはシェルが動いている間だけです。
        シェルを起動し直したときも、もう一度呼んでください（登録済みなら、つなぐだけです）。
        ほかのクラウドの同期フォルダーの中や、判定できない場所は登録しません。
        """
        path = absolute_path(path)
        sync = self.check_sync_folder(path)
        if sync["inside"] is None:
            return {"ok": False, "reason": "クラウドの同期フォルダーの中かどうかを判定できないため、同期ルートにしません（"
                    + sync["reason"] + "）"}
        if sync["inside"] is True and sync["provider"] != "pip0":
            return {"ok": False, "reason": f"{sync['provider']} の同期フォルダーの中なので、同期ルートにしません"}
        try:
            reply = self.link.request("cf.register_root", {"path": path, "display_name": display_name},
                                      timeout=REGISTER_TIMEOUT_SECONDS)
        except ShellError as error:
            return {"ok": False, "reason": link_failure(error, "同期ルートの登録")[1]}
        if reply.get("registered") is not True:
            return {"ok": False, "reason": text_or(reply.get("reason"), "同期ルートとして登録できませんでした")}
        try:
            reply = self.link.request("cf.connect", {"path": path}, timeout=REGISTER_TIMEOUT_SECONDS)
        except ShellError as error:
            return {"ok": False, "reason": "同期ルートの登録はできましたが、" + link_failure(error, "シェルとの接続")[1]}
        if reply.get("connected") is not True:
            return {"ok": False, "reason": "同期ルートの登録はできましたが、シェルとつなげませんでした（"
                    + text_or(reply.get("reason"), "理由は分かりません") + "）"}
        self.set_pip0_root(path)
        return {"ok": True, "reason": ""}

    def unregister_sync_root(self, path):
        """同期ルートの登録を解除する（アンインストールのとき。ゴーストが残っていれば、シェルが断る）。{"ok", "reason"}"""
        try:
            reply = self.link.request("cf.unregister_root", {"path": absolute_path(path)},
                                      timeout=REGISTER_TIMEOUT_SECONDS)
        except ShellError as error:
            return {"ok": False, "reason": link_failure(error, "同期ルートの登録の解除")[1]}
        if reply.get("unregistered") is not True:
            return {"ok": False, "reason": text_or(reply.get("reason"), "同期ルートの登録を解除できませんでした")}
        return {"ok": True, "reason": text_or(reply.get("reason"), "")}

    def is_sync_root_registered(self, path):
        """path が pip0 の同期ルートとして登録されていれば True、いなければ False、分からなければ None

        シェルを通さず、Cloud Files API（CfGetSyncRootInfoByPath）で直接確かめます。
        """
        path = absolute_path(path)
        found = query_sync_root(path)
        if found["status"] == "inside":
            return self._is_pip0_sync_root(found["provider"], path)
        if found["status"] == "outside":
            return False
        return None

    def _is_pip0_sync_root(self, provider, path):
        """Cloud Files API が答えた同期ルートが、pip0 自身のものか

        提供元の名前が pip0 なら pip0 のもの。名前を読めなかったときは、pip0 専用フォルダーの中なら pip0 のものとします
        （同期ルートは入れ子にできないため、ほかの提供元なら、その名前が読めるはずです）。
        """
        if is_pip0_provider(provider):
            return True
        return not provider and self.pip0_root is not None and is_inside_folder(path, self.pip0_root)

    def ghost_status(self, path):
        """{"exists", "is_ghost", "item_id", "dehydrated", "in_sync", "pinned", "reason"}

        シェルに聞けないときは、is_ghost などを None（分からない）にします。exists だけは、この場で確かめた値です。
        """
        path = absolute_path(path)
        if self._is_unsettled(path):
            return unknown_ghost_status(path, "ゴーストの作成・復元の答えが遅れているため、状態を確かめられません"
                                              "（pip0 シェルを起動し直すと確かめられます）")
        try:
            reply = self.link.request("cf.status", {"path": path}, timeout=STATUS_TIMEOUT_SECONDS)
        except ShellError as error:
            return unknown_ghost_status(path, link_failure(error, "ゴーストの状態の確認")[1])
        return read_ghost_status(reply)

    def make_ghost(self, path, item_id, expected):
        """元の場所のファイルを、同じパスのままゴーストにする（中身は保管庫にある）

        expected：{"size", "mtime_ns", "file_key", "sha256"}。1つでも違えば、シェルは何も変えずに "changed" を返す。
        返す辞書：{"result": "ghosted"/"changed"/"locked"/"not_in_root"/"unavailable"/"error", "reason"}
        """
        path = absolute_path(path)
        payload = {
            "path": path,
            "item_id": item_id,
            "expected": {
                "size": expected["size"],
                "mtime_ns": expected["mtime_ns"],
                "file_key": expected["file_key"],
                "sha256": expected["sha256"],
            },
        }
        try:
            reply = self.link.request("cf.make_ghost", payload, timeout=ghost_timeout_seconds(expected["size"]))
        except ShellError as error:
            if isinstance(error, ShellTimeout):
                self._mark_unsettled(path)
            kind, reason = link_failure(error, "ゴーストの作成")
            return {"result": kind, "reason": reason}
        return read_result(reply, GHOST_RESULTS)

    def restore_ghost(self, path, item_id):
        """ゴーストを通常のファイルに戻す（中身がなければ、シェルが保管庫の内容を確かめてから戻す）

        返す辞書：{"result": "restored"/"already_regular"/"not_our_placeholder"/"missing"/"unavailable"/"error", "reason"}
        """
        path = absolute_path(path)
        try:
            size = os.stat(path).st_size
        except (OSError, ValueError):
            size = None
        try:
            reply = self.link.request("cf.restore", {"path": path, "item_id": item_id},
                                      timeout=ghost_timeout_seconds(size))
        except ShellError as error:
            if isinstance(error, ShellTimeout):
                self._mark_unsettled(path)
            kind, reason = link_failure(error, "ゴーストの復元")
            return {"result": kind, "reason": reason}
        return read_result(reply, RESTORE_RESULTS)

    def locate_ghost(self, item_id):
        """pip0 専用フォルダー（同期ルート）の中で、この項目のゴーストの場所を探す（シェルの cf.locate）

        フォルダーごと名前を変えたときなど、場所の知らせ（cf.notify_rename）が届かなかったゴーストを見つけるためです。
        返す辞書：{"result": "found"/"not_found"/"unknown", "paths": [見つかった場所], "reason"}
        シェルに聞けない・探し切れなかったときは "unknown"（見つからなかったとは言わない）。
        """
        try:
            reply = self.link.request("cf.locate", {"item_id": item_id}, timeout=LOCATE_TIMEOUT_SECONDS)
        except ShellError as error:
            return {"result": "unknown", "paths": [], "reason": link_failure(error, "ゴーストの場所の確認")[1]}
        return read_locate_reply(reply)

    def _mark_unsettled(self, path):
        """答えが遅れた場所を覚える。シェルがまだ処理しているかもしれないので、状態を「分からない」として扱う

        そのときのシェル（プロセス番号）も覚え、シェルが起動し直されたら、印を外す（遅れていた処理も終わっている）。
        """
        with self._lock:
            self._unsettled[path_key(path)] = shell_process_id(self.link)

    def _is_unsettled(self, path):
        with self._lock:
            if not self._unsettled:
                return False
            if not self.link.is_alive():
                # シェルが終わったので、遅れていた処理も終わっている（次からはシェルに聞ける）
                self._unsettled.clear()
                return False
            current = shell_process_id(self.link)
            if current is not None:
                # 別のシェル（起動し直した後）で付けた印ではないものは外す
                self._unsettled = {key: shell for key, shell in self._unsettled.items() if shell == current}
            return path_key(path) in self._unsettled

    # ------------------------------------------------------------------
    # 削除の確認とごみ箱（pip0 シェルの確認画面と IFileOperation に頼む。docs/design.md 4-8）
    # ------------------------------------------------------------------

    def confirm_and_recycle(self, request):
        """確認画面を出し、承認されたときだけ、シェルがごみ箱へ移す

        request：{"request_id", "title", "message", "items": [{"path", "name", "size"}]}
        返す辞書：{"approved", "answer": "approve"/"cancel"/"closed"/"unavailable", "results": [{"path", "status", "reason"}]}
        シェルに頼めないときは "unavailable" で、何も削除しません（ほかの方法で削除することはしません）。
        """
        items = list(request.get("items") or [])
        payload = {
            "request_id": request.get("request_id"),
            "title": request.get("title"),
            "message": request.get("message"),
            "items": [{"path": os.fspath(item["path"]), "name": item.get("name"), "size": item.get("size")}
                      for item in items],
        }
        try:
            reply = self.link.request("trash.confirm_and_recycle", payload, timeout=TRASH_DIALOG_TIMEOUT_SECONDS)
        except ShellError as error:
            if isinstance(error, ShellTimeout):
                reason = ("確認画面の答えを待つのをやめました。画面がまだ開いていれば、キャンセルしてください"
                          "（後から承認しても、この削除の記録には反映されません）")
            else:
                reason = link_failure(error, "削除の確認画面の表示")[1] + "。何も削除していません"
            return {"approved": False, "answer": "unavailable",
                    "results": [{"path": os.fspath(item["path"]), "status": "not_attempted", "reason": reason}
                                for item in items]}
        return read_recycle_reply(reply)


# ----------------------------------------------------------------------
# 部品（Windows の API を使わない部分。Windows 以外でもテストできる）
# ----------------------------------------------------------------------


def absolute_path(path):
    return os.path.abspath(os.fspath(path))


def path_key(path):
    """場所を比べるための形（Windows では大文字・小文字を区別しない）"""
    return os.path.normcase(absolute_path(path))


def is_inside_folder(path, folder):
    """path が folder と同じか、その中にあれば True"""
    path, folder = path_key(path), path_key(folder)
    try:
        return os.path.commonpath([path, folder]) == folder
    except ValueError:   # ドライブが違う
        return False


def text_or(value, default):
    return value if isinstance(value, str) and value else default


def idle_milliseconds(now_tick, last_input_tick):
    """無操作のミリ秒。GetTickCount は 32 ビットで約 49.7 日ごとに 0 に戻るため、差を 32 ビットで計算する"""
    return (now_tick - last_input_tick) & 0xFFFFFFFF


def power_source_from_ac_line(value):
    """ACLineStatus（0 バッテリー、1 電源接続中、255 不明）を pip0 の名前にする"""
    return AC_LINE_NAMES.get(value, "unknown")


def is_cloud_reparse_tag(tag):
    """クラウドのプレースホルダーの再解析ポイント（IO_REPARSE_TAG_CLOUD〜CLOUD_F）なら True"""
    return isinstance(tag, int) and (tag & ~IO_REPARSE_TAG_CLOUD_MASK) == IO_REPARSE_TAG_CLOUD


def is_link_reparse_tag(tag):
    """別の場所を指す再解析ポイント（「名前の代わり」の印のあるタグ）なら True

    IO_REPARSE_TAG_SYMLINK（シンボリックリンク）、IO_REPARSE_TAG_MOUNT_POINT（ジャンクション）、WSL のリンク等。
    """
    return isinstance(tag, int) and bool(tag & REPARSE_TAG_NAME_SURROGATE)


def describe_local_state(attributes, reparse_tag=0):
    """ファイルの属性（数値）と再解析ポイントの種類（タグ。たどらずに読んだもの）から、get_local_state の辞書を作る"""
    reparse = bool(attributes & FILE_ATTRIBUTE_REPARSE_POINT)
    placeholder = is_cloud_reparse_tag(reparse_tag) or bool(attributes & CLOUD_ATTRIBUTES)
    state = {
        "local": True,
        "placeholder": placeholder,
        "pinned": bool(attributes & FILE_ATTRIBUTE_PINNED),
        "reparse": reparse,
        "attributes": attributes,
        "reason": "",
    }
    if reparse and is_link_reparse_tag(reparse_tag):
        state["local"] = False
        state["reason"] = "リンク（シンボリックリンク・ジャンクション等）です。たどりません"
    elif attributes & NOT_LOCAL_ATTRIBUTES:
        state["local"] = False
        state["reason"] = ("中身がこの PC にありません（クラウドの未取得のプレースホルダー、pip0 のゴースト等）。"
                           "読むと取得が始まるため、読みません")
    elif placeholder:
        state["reason"] = "クラウドのプレースホルダーです（中身はこの PC にあります）"
    elif reparse:
        state["reason"] = "再解析ポイント（リンク以外）です"
    return state


def unknown_local_state(reason):
    """中身がこの PC にあるか確かめられないとき（読まない側に倒す）"""
    return {"local": False, "placeholder": False, "pinned": False, "reparse": False, "attributes": None,
            "reason": reason}


def drive_type_name(code):
    """GetDriveTypeW の値を、"fixed"/"removable"/"network"/"unknown" にする"""
    return DRIVE_TYPE_NAMES.get(code, "unknown")


def last_access_enabled_from_registry(value):
    """NtfsDisableLastAccessUpdate の値から、更新が有効か（True/False）。読めない値は None

    Windows 10 1803 以降は、0x80000000 のビットが「システム管理」の印で、いちばん下のビットが 1 なら更新しない。
    """
    if not isinstance(value, int) or isinstance(value, bool):
        return None
    return (value & 1) == 0


def split_folders(path):
    """パスをフォルダー名の並びに分ける（\\ と / のどちらでも区切る）"""
    return [part for part in re.split(r"[\\/]+", path) if part]


def sync_provider_from_name(path):
    """パスのフォルダー名から、同期アプリの名前を推し量る（SYNC_FOLDER_NAMES）。当てはまらなければ None"""
    for part in split_folders(path):
        folded = part.casefold()
        if folded in SYNC_FOLDER_NAMES:
            return SYNC_FOLDER_NAMES[folded]
        for prefix, provider in SYNC_FOLDER_PREFIXES.items():
            if folded.startswith(prefix):
                return provider
    return None


def is_pip0_provider(name):
    """同期ルートの提供元の名前が pip0 か（pip0 シェルは ID「pip0!<SID>!default」で登録する）"""
    if not isinstance(name, str):
        return False
    folded = name.strip().casefold()
    return folded == "pip0" or folded.startswith("pip0!")


def classify_sync_root_hresult(hresult):
    """CfGetSyncRootInfoByPath の結果を、"inside"（同期ルートの中）/"outside"（外）/"unknown" にする"""
    value = hresult & 0xFFFFFFFF
    if value == S_OK:
        return "inside"
    if value == HRESULT_NOT_UNDER_SYNC_ROOT:
        return "outside"
    return "unknown"


def hresult_text(hresult):
    return f"0x{hresult & 0xFFFFFFFF:08X}"


def decode_utf16_field(data):
    """固定長の UTF-16 の文字の欄（WCHAR の配列）を、最初の NUL までの文字列にする"""
    return data.decode("utf-16-le", errors="replace").split("\x00", 1)[0]


def parse_provider_info(raw):
    """CF_SYNC_ROOT_PROVIDER_INFO（状態 4 バイト、名前 WCHAR 256 文字、版 WCHAR 256 文字）を読む"""
    return {
        "provider_status": int.from_bytes(raw[0:4], "little"),
        "provider_name": decode_utf16_field(raw[PROVIDER_NAME_OFFSET:PROVIDER_VERSION_OFFSET]),
        "provider_version": decode_utf16_field(raw[PROVIDER_VERSION_OFFSET:PROVIDER_VERSION_OFFSET + PROVIDER_NAME_BYTES]),
    }


def decode_zone_text(data):
    """Zone.Identifier の中身（バイト列）を文字列にする。UTF-16（BOM 付き）と UTF-8 に対応する"""
    if data.startswith(codecs.BOM_UTF16_LE):
        return data[len(codecs.BOM_UTF16_LE):].decode("utf-16-le", errors="replace")
    if data.startswith(codecs.BOM_UTF8):
        data = data[len(codecs.BOM_UTF8):]
    return data.decode("utf-8", errors="replace")


def long_path(path):
    """260 文字以上の絶対パスに、Windows の長いパスの印（\\\\?\\）を付ける。短いパスはそのまま"""
    if len(path) < MAX_PATH or path.startswith("\\\\?\\") or path.startswith("\\\\.\\"):
        return path
    if path.startswith("\\\\"):
        return "\\\\?\\UNC\\" + path[2:]
    return "\\\\?\\" + path


def strip_long_path_prefix(path):
    """長いパスの印（\\\\?\\）を外す（ドライブ文字か UNC の場合だけ）"""
    if path.startswith("\\\\?\\UNC\\"):
        return "\\\\" + path[len("\\\\?\\UNC\\"):]
    if path.startswith("\\\\?\\") and len(path) >= 6 and path[5] == ":":
        return path[4:]
    return path


def open_error(code):
    """CreateFileW の失敗（Windows のエラー番号）を、Python の例外にする（メッセージにパスは入れない）"""
    if code in (ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND):
        return FileNotFoundError(errno.ENOENT, "ファイルが見つかりません")
    if code in (ERROR_SHARING_VIOLATION, ERROR_LOCK_VIOLATION):
        return PermissionError(errno.EACCES, "ほかのアプリが使用中のため、ファイルを開けません")
    if code == ERROR_ACCESS_DENIED:
        return PermissionError(errno.EACCES, "アクセスが拒否されたため、ファイルを開けません")
    return OSError(errno.EIO, f"ファイルを開けません（Windows のエラー番号 {code}）")


def ghost_timeout_seconds(size):
    """ゴーストの作成・復元を待つ秒数。シェルは中身のハッシュを確かめるので、大きなファイルほど長く待つ"""
    if not isinstance(size, int) or isinstance(size, bool) or size < 0:
        return GHOST_UNKNOWN_SIZE_TIMEOUT_SECONDS
    return GHOST_BASE_TIMEOUT_SECONDS + size / (1024 ** 3) * GHOST_SECONDS_PER_GIB


def link_failure(error, what):
    """シェルとのやり取りの失敗（ShellError）を、("unavailable" か "error", 日本語の理由) にする"""
    if isinstance(error, ShellUnavailable):
        return "unavailable", f"{what}ができません。pip0 シェル（OS 連携）が動いていません"
    if isinstance(error, ShellTimeout):
        return "unavailable", f"{what}について、pip0 シェルから時間内に答えがありませんでした"
    if error.code in NOT_READY_CODES:
        return "unavailable", f"{what}ができません。pip0 シェルの準備ができていないか、終了の処理中です（{error.code}）"
    return "error", f"{what}に失敗しました（{error.message}）"


def read_result(reply, allowed):
    """cf.make_ghost・cf.restore の答えを {"result", "reason"} にそろえる。約束にない result は "error" にする"""
    result = reply.get("result")
    reason = text_or(reply.get("reason"), "")
    if result not in allowed:
        return {"result": "error", "reason": "pip0 シェルの答えが約束にない形でした（結果を確かめられません）"}
    return {"result": result, "reason": reason}


def read_ghost_status(reply):
    """cf.status の答えを、約束（docs/design.md 6-2）の形にそろえる。形の違う値は None（分からない）にする"""
    status = {}
    for key in ("exists", "is_ghost", "dehydrated", "in_sync", "pinned"):
        value = reply.get(key)
        status[key] = value if isinstance(value, bool) else None
    item_id = reply.get("item_id")
    status["item_id"] = item_id.lower() if isinstance(item_id, str) and item_id else None
    status["reason"] = text_or(reply.get("reason"), "")
    return status


def read_locate_reply(reply):
    """cf.locate の答えを {"result": "found"/"not_found"/"unknown", "paths", "reason"} にそろえる

    "error"（探し切れなかった等）や、約束にない答えは "unknown"（見つからなかったとは扱わない）。
    場所は、絶対パスの文字列だけを使う。
    """
    reason = text_or(reply.get("reason"), "")
    raw_paths = reply.get("paths")
    paths = [path for path in raw_paths if isinstance(path, str) and os.path.isabs(path)] \
        if isinstance(raw_paths, list) else []
    result = reply.get("result")
    if result == "found" and paths:
        return {"result": "found", "paths": paths, "reason": reason}
    if result == "not_found":
        return {"result": "not_found", "paths": [], "reason": reason}
    return {"result": "unknown", "paths": [], "reason": reason or "ゴーストの場所を確かめられませんでした"}


def shell_process_id(link):
    """今つながっている pip0 シェルのプロセス番号（ShellLink.process_id()）。分からなければ None"""
    process_id = getattr(link, "process_id", None)
    if callable(process_id):
        process_id = process_id()
    return process_id if isinstance(process_id, int) and not isinstance(process_id, bool) else None


def unknown_ghost_status(path, reason):
    """シェルに聞けないときの ghost_status（ゴーストかどうかは「分からない」）"""
    return {"exists": local_exists(path), "is_ghost": None, "item_id": None, "dehydrated": None,
            "in_sync": None, "pinned": None, "reason": reason}


def local_exists(path):
    """ファイルがあれば True、ないことが確かなら False、確かめられなければ None（リンクはたどらない）"""
    try:
        os.lstat(path)
        return True
    except FileNotFoundError:
        return False
    except (OSError, ValueError):
        return None


def read_recycle_reply(reply):
    """trash.confirm_and_recycle の答えを、約束の形にそろえる（知らない答えを「承認」とは扱わない）"""
    answer = reply.get("answer")
    if answer not in TRASH_ANSWERS:
        answer = "unavailable"
    approved = reply.get("approved") is True and answer == "approve"
    results = []
    raw_results = reply.get("results")
    if isinstance(raw_results, list):
        for result in raw_results:
            if not isinstance(result, dict) or not isinstance(result.get("path"), str):
                continue
            status = result.get("status")
            reason = text_or(result.get("reason"), "")
            if status not in TRASH_STATUSES:
                # 知らない答えを「ごみ箱へ移した」とは扱わない
                status, reason = "failed", "pip0 シェルの答えを読めませんでした"
            results.append({"path": result["path"], "status": status, "reason": reason})
    return {"approved": approved, "answer": answer, "results": results}


# ----------------------------------------------------------------------
# Windows の API を使う部分
# ----------------------------------------------------------------------


def create_file_function():
    return win_function("kernel32.dll", "CreateFileW", HANDLE,
                        [ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p,
                         ctypes.c_uint32, ctypes.c_uint32, HANDLE])


def open_without_access_update(path, share_mode, flags):
    """読み取り用に開く。最終アクセス日時を変えない（SetFileTime に 0xFFFFFFFF を渡す）

    返す値は open(path, "rb") と同じように使えるファイル。失敗は OSError（使用中なら PermissionError）。
    属性を変える権限がない（読み取りだけ許された）ファイルは、最終アクセス日時を保つ設定をせずに開きます。
    """
    create_file = create_file_function()   # Windows 以外では、ここで OSError
    import msvcrt

    target = long_path(absolute_path(path))
    keep_access_time = True
    handle = create_file(target, GENERIC_READ | FILE_WRITE_ATTRIBUTES, share_mode, None, OPEN_EXISTING, flags, None)
    if not valid_handle(handle):
        code = last_error()
        if code != ERROR_ACCESS_DENIED:
            raise open_error(code)
        keep_access_time = False
        handle = create_file(target, GENERIC_READ, share_mode, None, OPEN_EXISTING, flags, None)
        if not valid_handle(handle):
            raise open_error(last_error())

    try:
        if keep_access_time and not preserve_access_time(handle):
            logger.debug("最終アクセス日時を保つ設定ができませんでした（Windows のエラー番号 %d）", last_error())
        descriptor = msvcrt.open_osfhandle(handle, os.O_RDONLY)
    except BaseException:
        close_handle(handle)
        raise
    try:
        return os.fdopen(descriptor, "rb")
    except BaseException:
        os.close(descriptor)
        raise


def stat_without_following(path):
    """リンクをたどらずに、ファイルの情報（属性）を読む（os.lstat と同じ。テストで差し替えるため、関数にしています）"""
    return os.stat(path, follow_symlinks=False)


def read_directory_entry(path):
    """フォルダーの項目としての属性と、再解析ポイントのタグを、たどらずに読む（FindFirstFileExW）

    返す辞書：{"attributes", "reparse_tag"}（再解析ポイントでなければタグは 0）。読めなければ None。
    フォルダーの一覧を読むだけなので、クラウドのプレースホルダーの中身の取得は始まりません。
    """
    try:
        find_first = win_function("kernel32.dll", "FindFirstFileExW", HANDLE,
                                  [ctypes.c_wchar_p, ctypes.c_int, ctypes.POINTER(WIN32_FIND_DATAW), ctypes.c_int,
                                   ctypes.c_void_p, ctypes.c_uint32])
        find_close = win_function("kernel32.dll", "FindClose", ctypes.c_int, [HANDLE])
    except (OSError, AttributeError):
        return None
    data = WIN32_FIND_DATAW()
    handle = find_first(long_path(absolute_path(path)), FIND_EX_INFO_BASIC, ctypes.byref(data),
                        FIND_EX_SEARCH_NAME_MATCH, None, 0)
    if not valid_handle(handle):
        return None
    find_close(handle)   # FindFirstFileExW のハンドルは、CloseHandle ではなく FindClose で閉じる
    attributes = data.dwFileAttributes
    reparse_tag = data.dwReserved0 if attributes & FILE_ATTRIBUTE_REPARSE_POINT else 0
    return {"attributes": attributes, "reparse_tag": reparse_tag}


def preserve_access_time(handle):
    """このハンドルでの読み取りが、最終アクセス日時を変えないようにする。できれば True"""
    set_file_time = win_function("kernel32.dll", "SetFileTime", ctypes.c_int,
                                 [HANDLE, ctypes.POINTER(FILETIME), ctypes.POINTER(FILETIME), ctypes.POINTER(FILETIME)])
    keep = FILETIME(0xFFFFFFFF, 0xFFFFFFFF)
    return bool(set_file_time(handle, None, ctypes.byref(keep), None))


def read_volume_info(path):
    """ボリュームのファイルシステムとドライブの種類。{"filesystem", "drive_type", "reason"}"""
    try:
        get_volume_path_name = win_function("kernel32.dll", "GetVolumePathNameW", ctypes.c_int,
                                            [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint32])
        get_volume_information = win_function(
            "kernel32.dll", "GetVolumeInformationW", ctypes.c_int,
            [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_void_p,
             ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_uint32])
        get_drive_type = win_function("kernel32.dll", "GetDriveTypeW", ctypes.c_uint32, [ctypes.c_wchar_p])
    except (OSError, AttributeError):
        return {"filesystem": None, "drive_type": "unknown",
                "reason": "ドライブの情報を読めません（Windows の機能を使えません）"}

    target = long_path(absolute_path(path))
    size = max(len(target) + 2, MAX_PATH + 1)
    root_buffer = ctypes.create_unicode_buffer(size)
    if not get_volume_path_name(target, root_buffer, size):
        return {"filesystem": None, "drive_type": "unknown",
                "reason": f"ドライブを特定できません（Windows のエラー番号 {last_error()}）"}
    root = strip_long_path_prefix(root_buffer.value)

    drive_type = drive_type_name(get_drive_type(root))
    name_buffer = ctypes.create_unicode_buffer(MAX_PATH + 1)
    if not get_volume_information(root, None, 0, None, None, None, name_buffer, MAX_PATH + 1):
        return {"filesystem": None, "drive_type": drive_type,
                "reason": f"ファイルシステムの種類を読めません（Windows のエラー番号 {last_error()}）"}
    return {"filesystem": name_buffer.value or None, "drive_type": drive_type, "reason": ""}


def existing_folder_for(path):
    """path を含む、実際にあるいちばん近いフォルダー。見つからなければ None

    同期ルートかどうかはフォルダーで決まるため、ファイルそのものは開かずに、入っているフォルダーを調べます。
    """
    folder = path if os.path.isdir(path) else os.path.dirname(path)
    while folder and not os.path.isdir(folder):
        parent = os.path.dirname(folder)
        if parent == folder:
            return None
        folder = parent
    return folder or None


def query_sync_root(path):
    """Cloud Files API（CfGetSyncRootInfoByPath）で、path が同期ルートの中かを調べる

    返す辞書：{"status": "inside"/"outside"/"unknown", "provider": 提供元の名前 または None, "reason"}
    """
    folder = existing_folder_for(path)
    if folder is None:
        return {"status": "unknown", "provider": None, "reason": "場所が見つからないため、同期フォルダーかどうかを調べられません"}
    try:
        get_sync_root_info = win_function(
            "cldapi.dll", "CfGetSyncRootInfoByPath", ctypes.c_long,
            [ctypes.c_wchar_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32, ctypes.POINTER(ctypes.c_uint32)])
    except (OSError, AttributeError):
        return {"status": "unknown", "provider": None,
                "reason": "Cloud Files API（cldapi.dll）を使えないため、同期フォルダーかどうかを調べられません"}
    buffer = ctypes.create_string_buffer(PROVIDER_INFO_BUFFER_BYTES)
    returned = ctypes.c_uint32(0)
    hresult = get_sync_root_info(long_path(folder), CF_SYNC_ROOT_INFO_PROVIDER, buffer,
                                 PROVIDER_INFO_BUFFER_BYTES, ctypes.byref(returned))
    status = classify_sync_root_hresult(hresult)
    if status == "inside":
        info = parse_provider_info(buffer.raw)
        return {"status": "inside", "provider": info["provider_name"] or None, "reason": ""}
    if status == "outside":
        return {"status": "outside", "provider": None, "reason": ""}
    return {"status": "unknown", "provider": None,
            "reason": f"同期フォルダーかどうかを調べられません（{hresult_text(hresult)}）"}


def last_access_updates_enabled():
    """NTFS の最終アクセス日時の更新が有効か（レジストリー）。読めなければ None"""
    try:
        import winreg
    except ImportError:
        return None
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, FILESYSTEM_KEY) as key:
            value, value_type = winreg.QueryValueEx(key, LAST_ACCESS_VALUE_NAME)
    except OSError:
        return None
    if value_type != winreg.REG_DWORD:
        return None
    return last_access_enabled_from_registry(value)


def known_downloads_dir():
    """Windows の「ダウンロード」の場所（SHGetKnownFolderPath、FOLDERID_Downloads）。分からなければ None

    ユーザーが場所を変えていても（別のドライブなど）、その場所を返します。
    """
    if sys.platform != "win32":
        return None
    try:
        get_known_folder_path = win_function(
            "shell32.dll", "SHGetKnownFolderPath", ctypes.c_long,
            [ctypes.POINTER(GUID), ctypes.c_uint32, HANDLE, ctypes.POINTER(ctypes.c_void_p)])
        co_task_mem_free = win_function("ole32.dll", "CoTaskMemFree", None, [ctypes.c_void_p])
    except (OSError, AttributeError):
        return None
    pointer = ctypes.c_void_p()
    result = get_known_folder_path(ctypes.byref(FOLDERID_DOWNLOADS), 0, None, ctypes.byref(pointer))
    try:
        if result != S_OK or not pointer.value:
            return None
        return Path(ctypes.wstring_at(pointer.value))
    finally:
        # 成功しても失敗しても、Windows が用意した文字列の領域を返す（Microsoft の文書の決まり）
        if pointer.value:
            co_task_mem_free(pointer)
