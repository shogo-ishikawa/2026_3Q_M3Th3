"""テストで共通に使う準備（フィクスチャ）

テストは、本物のデスクトップやダウンロードを使わず、pytest が作る一時フォルダーの中だけで動きます。
OS 連携は platform_fake.FakePlatform（代役）、鍵は MemoryKeystore（メモリーだけ）を使います。
"""

import sys
from pathlib import Path

import pytest

PROJECT_DIR = Path(__file__).resolve().parents[1]
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

from pip0 import config as config_module  # noqa: E402
from pip0 import database, keystore  # noqa: E402
from pip0.platform_fake import FakePlatform  # noqa: E402
from pip0.ui import RecordingUi  # noqa: E402


@pytest.fixture
def env(tmp_path):
    """一時フォルダーに、ダウンロード・pip0専用フォルダー・データフォルダーを作り、設定を返す"""
    downloads = tmp_path / "Downloads"
    root = tmp_path / "pip0"
    data_dir = tmp_path / "AppData" / "pip0"
    for folder in (downloads, root, data_dir):
        folder.mkdir(parents=True)
    config = config_module.load_config(
        overrides={
            "DOWNLOADS_DIR": downloads,
            "PIP0_ROOT": root,
            "DATA_DIR": data_dir,
        },
        read_user_file=False,
    )
    assert config["CONFIG_ERRORS"] == []
    return config


@pytest.fixture
def platform(env, tmp_path):
    """代役の OS 連携。pip0 専用フォルダーは同期ルートとして登録済み、電源接続中・アイドル0秒"""
    fake = FakePlatform(idle_seconds=0.0, power="ac", vault_dir=env["VAULT_DIR"])
    fake.trash_dir = tmp_path / "RecycleBin"
    result = fake.register_sync_root(env["PIP0_ROOT"], "pip0")
    assert result["ok"]
    return fake


@pytest.fixture
def key_store():
    return keystore.MemoryKeystore()


@pytest.fixture
def db(env, key_store):
    conn = database.open_database(env, keystore=key_store)
    yield conn
    conn.close()


@pytest.fixture
def ui():
    return RecordingUi()
