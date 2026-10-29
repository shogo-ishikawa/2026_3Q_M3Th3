"""暗号化DBの鍵の保管

鍵（32バイトの乱数を16進数にした64文字）は、OS の鍵保管機構に保存します。
Windows では keyring ライブラリを通して「資格情報マネージャー」に保存され、
Windows がユーザーのアカウントに結び付けて暗号化（DPAPI）します。
ソースコード、DB と同じフォルダーの平文ファイル、ログには、鍵を書きません。

テストとデモでは MemoryKeystore を使います。鍵はメモリーだけにあり、プロセスの終了で消えます。
"""

import secrets

SERVICE_NAME = "pip0"
KEY_NAME = "database-key-v1"

# 鍵を預けてよい keyring の保存先（平文のファイルに保存する種類は使わない）
ALLOWED_BACKENDS = [
    "keyring.backends.Windows.WinVaultKeyring",      # Windows の資格情報マネージャー（本番）
    "keyring.backends.SecretService.Keyring",        # Linux の開発用（GNOME キーリング等）
    "keyring.backends.macOS.Keyring",                # macOS の開発用（キーチェーン）
]


class KeystoreUnavailable(RuntimeError):
    """鍵を安全に保管できる場所がない"""


class KeyMissing(RuntimeError):
    """DB はあるのに鍵が見つからない（鍵を作り直すと、DB を読めなくなる）"""


def new_key_hex():
    return secrets.token_hex(32)


def is_valid_key(key_hex):
    if not isinstance(key_hex, str) or len(key_hex) != 64:
        return False
    try:
        bytes.fromhex(key_hex)
    except ValueError:
        return False
    return True


class MemoryKeystore:
    """テスト・デモ用。鍵はこのオブジェクトの中だけにあり、ファイルには書かない"""

    name = "memory"

    def __init__(self, key_hex=None):
        self._key = key_hex

    def get_key(self):
        return self._key

    def set_key(self, key_hex):
        self._key = key_hex

    def delete_key(self):
        self._key = None


class OsKeystore:
    """keyring を通して OS の鍵保管機構を使う"""

    def __init__(self, service=SERVICE_NAME, username=KEY_NAME):
        try:
            import keyring
        except ImportError as error:
            raise KeystoreUnavailable(
                "keyring ライブラリがありません。requirements.txt の手順で導入してください。"
            ) from error
        backend = keyring.get_keyring()
        backend_name = f"{type(backend).__module__}.{type(backend).__name__}"
        if backend_name not in ALLOWED_BACKENDS:
            raise KeystoreUnavailable(
                f"鍵の保存先（{backend_name}）は pip0 では使いません。"
                "Windows の資格情報マネージャーなど、OS の鍵保管機構が必要です。"
            )
        self._keyring = keyring
        self.service = service
        self.username = username
        self.name = backend_name

    def get_key(self):
        return self._keyring.get_password(self.service, self.username)

    def set_key(self, key_hex):
        self._keyring.set_password(self.service, self.username, key_hex)

    def delete_key(self):
        try:
            self._keyring.delete_password(self.service, self.username)
        except self._keyring.errors.PasswordDeleteError:
            pass


def get_or_create_key(keystore, db_exists):
    """DB の鍵を返す。DB がまだなく鍵もなければ、新しい鍵を作って保管する

    DB があるのに鍵がないときは、勝手に新しい鍵を作らずに KeyMissing を出す
    （新しい鍵では、その DB を読めないため）。
    """
    key_hex = keystore.get_key()
    if key_hex is not None:
        if not is_valid_key(key_hex):
            raise KeyMissing("保管されている鍵の形が正しくありません。")
        return key_hex
    if db_exists:
        raise KeyMissing(
            "暗号化DBの鍵が OS の鍵保管機構に見つかりません。"
            "鍵を消した場合、DB（索引・解析結果・操作履歴）は読めません。"
            "保管庫の復元情報（vault の manifest.json）は別に残っています。"
            "DB を作り直す手順は docs/setup-windows.md の「鍵をなくしたとき」を見てください。"
        )
    key_hex = new_key_hex()
    keystore.set_key(key_hex)
    if keystore.get_key() != key_hex:
        raise KeystoreUnavailable("鍵を OS の鍵保管機構に保存できませんでした。")
    return key_hex


def default_keystore():
    return OsKeystore()
