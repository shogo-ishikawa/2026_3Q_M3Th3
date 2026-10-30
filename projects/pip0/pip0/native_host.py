"""ブラウザー拡張の受け口（Native Messaging の pip0.bridge）

Chrome／Edge の拡張機能「pip0 連携」がダウンロードの完了を知らせるときに、ブラウザーがこのプログラムを起動します
（python -m pip0.native_host <呼び出し元> --parent-window=<番号>）。
やり取りは、ブラウザーとこのプロセスの間の標準入出力（パイプ）だけで、ネットワークは使いません。

1回の起動で、次のことだけをします（docs/ipc-protocol.md の5節）。
1. 外部通信の禁止（netguard）を入れる
2. 呼び出し元の拡張機能（第1引数）が、許可したもの（ALLOWED_EXTENSION_ORIGINS）かを確かめる
3. メッセージを1件読む（4バイトの長さ＋UTF-8 の JSON。1 MiB を超えるものは読まない）
4. 内容を検査して整える（URL の ? 以降と # 以降を除く、シークレット ウィンドウのダウンロードは断る 等）
5. 暗号化DB の download_events に記録する（接続の確認の ping は記録しない）
6. 返事を1件書いて終わる。受け取った内容を、返事にそのまま入れることはしない

受け取った内容（ページの題名など）は記録するだけで、ファイル操作やコマンドの指示として扱うことはありません。
"""

import json
import logging
import os
import re
import struct
import sys
import time
from datetime import datetime

from pip0 import config as config_module
from pip0 import database, provenance
from pip0 import keystore as keystore_module

logger = logging.getLogger(__name__)

PROTOCOL_VERSION = 1                         # メッセージの形の版
MESSAGE_TYPES = ["download_completed", "ping"]
KNOWN_BROWSERS = ["chrome", "edge", "chromium"]

# メッセージの長さの形：4バイトの符号なし整数、この PC のバイト順（Windows は little-endian）
LENGTH_FORMAT = "=I"
MAX_MESSAGE_BYTES = 1024 * 1024              # 受け取るメッセージの上限（1 MiB）。超えたら中身を読まない
MAX_REPLY_BYTES = 1024 * 1024                # 返事の上限（Chrome が受け取れる1件の上限は 1 MB）
FILENAME_MAX_CHARS = 1024                    # 保存先のパスの最大文字数
SHORT_TEXT_MAX_CHARS = 255                   # mime と danger の最大文字数
TITLE_MAX_CHARS = 512                        # ページの題名の最大文字数
MAX_SAFE_INTEGER = 2 ** 53 - 1               # JavaScript で正確に表せる最大の整数（番号と大きさの上限）

C0_CONTROLS = re.compile(r"[\x00-\x1f]")                   # パスに使えない制御文字
CONTROL_CHARACTERS = re.compile(r"[\x00-\x1f\x7f-\x9f]")   # 題名などから除く制御文字
BROKEN_CHARACTERS = re.compile(r"[\ud800-\udfff]")          # 対になっていないサロゲート（壊れた文字）
WINDOWS_DRIVE_PATH = re.compile(r"^[A-Za-z]:[\\/]")        # C:\Users\…
UNC_PATH = re.compile(r"^\\\\[^\\/]+\\[^\\/]+")            # \\サーバー\共有\…


class ProtocolError(Exception):
    """メッセージの形（長さ、UTF-8、JSON）が正しくない"""


# ----------------------------------------------------------------------
# メッセージの読み書き（4バイトの長さ＋UTF-8 の JSON）
# ----------------------------------------------------------------------


def read_message(stream):
    """stream から1件のメッセージを読み、辞書で返す。形が正しくなければ ProtocolError

    長さが MAX_MESSAGE_BYTES を超えるときは、中身を読まずに断ります。
    """
    header = read_exactly(stream, 4)
    if len(header) < 4:
        raise ProtocolError("メッセージの長さを読めませんでした")
    length = struct.unpack(LENGTH_FORMAT, header)[0]
    if length == 0:
        raise ProtocolError("メッセージが空です")
    if length > MAX_MESSAGE_BYTES:
        raise ProtocolError("メッセージが大きすぎるため、読みませんでした（上限 1 MiB）")
    body = read_exactly(stream, length)
    if len(body) < length:
        raise ProtocolError("メッセージが途中で終わっています")
    try:
        message = json.loads(body.decode("utf-8"), parse_constant=reject_constant)
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise ProtocolError("メッセージを UTF-8 の JSON として読めません") from None
    if not isinstance(message, dict):
        raise ProtocolError("メッセージが JSON のオブジェクトではありません")
    return message


def read_exactly(stream, size):
    """stream から size バイトを読む。途中で終わったときは、読めた分だけを返す"""
    data = b""
    while len(data) < size:
        chunk = stream.read(size - len(data))
        if not chunk:
            break
        data += chunk
    return data


def reject_constant(name):
    """JSON の NaN、Infinity は数として使わない"""
    raise ValueError("JSON の数として使えない値です")


def write_message(stream, obj):
    """obj を JSON にし、4バイトの長さを付けて stream に書く（最大 MAX_REPLY_BYTES）"""
    body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    if len(body) > MAX_REPLY_BYTES:
        raise ValueError("返事が大きすぎます")  # 返事は pip0 が作るので、超えたらプログラムの誤り
    stream.write(struct.pack(LENGTH_FORMAT, len(body)) + body)
    stream.flush()


# ----------------------------------------------------------------------
# 内容の検査（★受け付ける形を変えるときは、拡張機能の lib/message.js と ipc-protocol.md も直します）
# ----------------------------------------------------------------------


def validate_message(message):
    """ブラウザーから届いた辞書を検査し、(整えた辞書, []) か (None, エラーのリスト) を返す

    整えた辞書の形は docs/design.md の 6-7 のとおりです（URL は sanitise 済み、時刻は秒数）。
    知らない項目は無視し、使いません。エラーの文には、受け取った内容を入れません。
    """
    if not isinstance(message, dict):
        return None, ["メッセージが JSON のオブジェクトではありません"]
    errors = []
    message_type = message.get("type")
    if message_type not in MESSAGE_TYPES:
        errors.append("メッセージの種類（type）が正しくありません")
    protocol = message.get("protocol")
    if not is_integer(protocol) or protocol != PROTOCOL_VERSION:
        errors.append("メッセージの版（protocol）が 1 ではありません")
    if errors:
        return None, errors
    if message_type == "ping":
        return {"type": "ping"}, []

    download = message.get("download")
    if not isinstance(download, dict):
        return None, ["ダウンロードの情報（download）がありません"]
    incognito = download.get("incognito")
    if incognito is True:
        errors.append("シークレット ウィンドウのダウンロードは記録しません")
    elif incognito is not False:
        errors.append("シークレット ウィンドウかどうか（incognito）が分からないため、記録しません")
    download_id = download.get("id")
    if not is_integer(download_id) or download_id < 0 or download_id > MAX_SAFE_INTEGER:
        errors.append("ダウンロードの番号（id）が正しくありません")
    filename_problem = check_filename(download.get("filename"))
    if filename_problem is not None:
        errors.append(filename_problem)
    file_size = download.get("fileSize")
    if file_size is not None and (not is_integer(file_size) or file_size < -1 or file_size > MAX_SAFE_INTEGER):
        errors.append("ファイルの大きさ（fileSize）が正しくありません")
    page = message.get("page")
    if page is not None and not isinstance(page, dict):
        errors.append("ページの情報（page）の形が正しくありません")
    if errors:
        return None, errors

    if page is None:
        page = {}
    if file_size is not None and file_size < 0:
        file_size = None  # -1 は「大きさが分からない」
    browser = message.get("browser")
    if browser not in KNOWN_BROWSERS:
        browser = None
    clean = {
        "type": "download_completed",
        "browser": browser,
        "download": {
            "id": download_id,
            "filename": download["filename"],
            "url": provenance.sanitise_url(download.get("url")),
            "final_url": provenance.sanitise_url(download.get("finalUrl")),
            "referrer_url": provenance.sanitise_url(download.get("referrer")),
            "mime": clean_text(download.get("mime"), SHORT_TEXT_MAX_CHARS),
            "started_at": parse_time(download.get("startTime")),
            "ended_at": parse_time(download.get("endTime")),
            "file_size": file_size,
            "danger": clean_text(download.get("danger"), SHORT_TEXT_MAX_CHARS),
        },
        "page": {
            "tab_url": provenance.sanitise_url(page.get("tabUrl")),
            "tab_title": clean_text(page.get("tabTitle"), TITLE_MAX_CHARS),
            "captured_at": parse_time(page.get("capturedAt")),
        },
    }
    return clean, []


def is_integer(value):
    """整数なら True（JSON の true／false は Python では整数の仲間なので、除く）"""
    return isinstance(value, int) and not isinstance(value, bool)


def check_filename(filename):
    """保存先のパスを確かめる。問題がなければ None、あれば理由を返す"""
    if not isinstance(filename, str) or filename == "":
        return "保存先のパス（filename）がありません"
    if len(filename) > FILENAME_MAX_CHARS:
        return "保存先のパスが長すぎます"
    if "\x00" in filename:
        return "保存先のパスに NUL 文字が含まれています"
    if C0_CONTROLS.search(filename):
        return "保存先のパスに制御文字が含まれています"
    if BROKEN_CHARACTERS.search(filename):
        return "保存先のパスに、文字として読めない部分があります"
    if not is_absolute_path(filename):
        return "保存先のパスが絶対パスではありません"
    return None


def is_absolute_path(filename):
    """Windows のドライブ（C:\\…）か UNC（\\\\サーバー\\共有\\…）の絶対パスなら True

    デバイスの名前空間（\\\\?\\…、\\\\.\\…）は受け付けません。
    テストのため、Windows 以外では「/」で始まるパスも認めます。
    """
    if filename.startswith(("\\\\?\\", "\\\\.\\")):
        return False
    if WINDOWS_DRIVE_PATH.match(filename) or UNC_PATH.match(filename):
        return True
    return sys.platform != "win32" and filename.startswith("/")


def clean_text(value, max_chars):
    """短い文（題名、mime など）を整える。空や文字列でないときは None

    制御文字を空白にし、壊れた文字（対になっていないサロゲート）を「\ufffd」にし、
    前後の空白を除いて、最大 max_chars 文字にします。
    """
    if not isinstance(value, str):
        return None
    text = CONTROL_CHARACTERS.sub(" ", value)
    text = BROKEN_CHARACTERS.sub("\ufffd", text)
    text = text.strip()
    if text == "":
        return None
    return text[:max_chars]


def parse_time(value):
    """ISO 8601 の時刻（例："2026-10-29T03:12:00.000Z"）を秒数にする。読めなければ None

    時差（Z や +09:00）の書いていない時刻は、どの地域の時刻か分からないため使いません。
    """
    if not isinstance(value, str) or len(value) > 64:
        return None
    try:
        moment = datetime.fromisoformat(value.strip())
    except ValueError:
        return None
    if moment.tzinfo is None:
        return None
    return moment.timestamp()


# ----------------------------------------------------------------------
# 受け口の入口
# ----------------------------------------------------------------------


def main(argv=None, stdin=None, stdout=None, config=None, keystore=None, install_guard=True):
    """受け口の入口。1件を読み、検査し、記録し、返事を1件書いて終わる。終了コードを返す（返事を書けたら 0）

    argv：コマンドラインの引数。argv[1] が呼び出し元の拡張機能（chrome-extension://<ID>/）。
          Windows でブラウザーが付ける --parent-window=… は使わない。None なら sys.argv
    stdin、stdout：バイト列で読み書きするもの。None なら標準入出力（Windows では改行の変換を止める）
    config：設定の辞書。None なら config.load_config()
    keystore：DB の鍵の保管場所。None なら OS の鍵保管機構（Windows の資格情報マネージャー）
    install_guard：True なら、最初に外部通信の禁止（netguard）を入れる（テストでは False にする）
    """
    # 1. 外部通信の禁止を、何よりも先に入れる（入れられなければ、何も読まずに断る）
    guard_problem = None
    if install_guard:
        guard_problem = install_network_guard()

    if argv is None:
        argv = sys.argv
    saved_stdout = sys.stdout
    if stdin is None:
        stdin = binary_stream(sys.stdin)
    if stdout is None:
        stdout = binary_stream(sys.stdout)
        # まちがって print した文字が返事に混ざらないよう、print の行き先を標準エラー出力にする
        sys.stdout = sys.stderr
    try:
        if guard_problem is not None:
            reply = error_reply(guard_problem)
        else:
            try:
                reply = handle_one_message(argv, stdin, config, keystore)
            except Exception as error:
                # 予想していない失敗でも、ブラウザーに返事を1件返す（記録するのはエラーの種類だけ）
                logger.error("受け口で予想していないエラーが起きました（%s）", type(error).__name__)
                reply = error_reply(f"受け口でエラーが起きたため、記録しませんでした（{type(error).__name__}）")
        write_message(stdout, reply)
    finally:
        sys.stdout = saved_stdout
    return 0


def handle_one_message(argv, stdin, config, keystore):
    """1件のメッセージを扱い、返事の辞書を返す（外部通信の禁止は、main が先に入れている）"""
    if config is None:
        config = config_module.load_config()

    # 2. 呼び出し元を確かめる。許可していない呼び出し元なら、メッセージを読まずに断る
    origin = argv[1] if len(argv) > 1 else None
    if not is_allowed_origin(origin, config):
        logger.warning("許可していない呼び出し元からの接続を断りました")
        return error_reply("呼び出し元の拡張機能が許可されていないため、記録しませんでした")

    # 3. 1件読む
    try:
        message = read_message(stdin)
    except ProtocolError as error:
        return error_reply(str(error))

    # 4. 検査して整える
    clean, errors = validate_message(message)
    if clean is None:
        return error_reply("記録しませんでした：" + "。".join(errors))
    if clean["type"] == "ping":
        return {"ok": True, "pong": True}  # 接続の確認だけ。何も記録しない

    # 5. 暗号化DB に記録する
    return store_message(clean, origin, config, keystore)


def is_allowed_origin(origin, config):
    """origin が、許可した拡張機能（ALLOWED_EXTENSION_ORIGINS）のどれかと完全に同じなら True"""
    allowed = config["ALLOWED_EXTENSION_ORIGINS"]
    if isinstance(allowed, str):
        allowed = [allowed]  # config.json に1つだけ文字列で書いた場合も、部分一致にはしない
    return isinstance(origin, str) and any(origin == item for item in allowed)


def store_message(clean, origin, config, keystore):
    """整えた記録を暗号化DB に書き、返事の辞書を返す"""
    try:
        conn = database.open_database(config, keystore=keystore)
    except (database.EncryptionUnavailable, database.DatabaseKeyError,
            keystore_module.KeystoreUnavailable, keystore_module.KeyMissing) as error:
        logger.warning("暗号化DB を開けません（%s）", type(error).__name__)
        return error_reply(f"暗号化DB を開けないため、記録しませんでした（{error}）")
    try:
        provenance.store_download_event(conn, clean, origin, time.time())
    finally:
        conn.close()
    logger.info("ダウンロードの記録を1件保存しました")
    return {"ok": True, "stored": True}


def install_network_guard():
    """外部通信の禁止（netguard）を入れる。入れられたら None、入れられなければ理由を返す"""
    try:
        from pip0 import netguard
        netguard.install()
    except Exception as error:
        logger.error("外部通信の禁止を入れられません（%s）", type(error).__name__)
        return "外部通信の禁止（netguard）を有効にできないため、記録しませんでした"
    return None


def binary_stream(stream):
    """標準入出力を、バイト列で読み書きする形にして返す（Windows では、改行の変換を止める）

    ファイル番号のないもの（テストで使う io.BytesIO など）には、変換がないので、そのまま使います。
    """
    if sys.platform == "win32":
        import msvcrt
        try:
            file_number = stream.fileno()
        except (OSError, ValueError):
            file_number = None
        if file_number is not None:
            msvcrt.setmode(file_number, os.O_BINARY)
    return stream.buffer


def error_reply(reason):
    return {"ok": False, "error": reason}


if __name__ == "__main__":
    raise SystemExit(main())
