"""設定を読み込み、使う場所（パス）を決める

settings.py の値に、データフォルダーの config.json と、テスト・デモが渡す値を重ねて、
1つの辞書 config にまとめます。ほかのモジュールは settings を直接 import せず、
この config を引数で受け取ります（テストで場所を差し替えやすくするためです）。
"""

import json
import os
import sys
from pathlib import Path

from pip0 import settings

# config.json で変えてよい項目は、settings.py にある名前だけです
PATH_KEYS = ["DOWNLOADS_DIR", "PIP0_ROOT", "DATA_DIR", "VAULT_DIR", "SHELL_EXE"]

# 導入後の配置（docs/design.md 6-9）：INSTALL_DIR\app\pip0\config.py → INSTALL_DIR
INSTALL_DIR = Path(__file__).resolve().parents[2]
PATH_LIST_KEYS = ["EXTRA_INDEX_DIRS", "SENSITIVE_DIRS"]


def default_values():
    """settings.py の大文字の名前を、辞書にして返す"""
    values = {}
    for name in dir(settings):
        if name.isupper():
            values[name] = getattr(settings, name)
    return values


def windows_default_paths():
    """Windows の既定の場所。Windows 以外では、本物のフォルダーを動かさないように None にする"""
    if sys.platform != "win32":
        return {"DOWNLOADS_DIR": None, "PIP0_ROOT": None, "DATA_DIR": None}
    home = Path(os.environ.get("USERPROFILE", str(Path.home())))
    local_app_data = Path(os.environ.get("LOCALAPPDATA", str(home / "AppData" / "Local")))
    downloads = None
    try:
        from pip0 import platform_windows
        downloads = platform_windows.known_downloads_dir()
    except Exception:  # Windows の機能が読めないときは、通常の場所を使う
        downloads = None
    if downloads is None:
        downloads = home / "Downloads"
    return {
        "DOWNLOADS_DIR": Path(downloads),
        "PIP0_ROOT": home / "pip0",
        "DATA_DIR": local_app_data / "pip0",
    }


def read_user_config(data_dir):
    """データフォルダーの config.json を読む。ない場合は空の辞書"""
    if data_dir is None:
        return {}, []
    path = Path(data_dir) / "config.json"
    if not path.exists():
        return {}, []
    try:
        with open(path, encoding="utf-8") as f:
            values = json.load(f)
    except (OSError, ValueError) as error:
        return {}, [f"config.json を読めませんでした（{error}）。settings.py の値を使います。"]
    if not isinstance(values, dict):
        return {}, ["config.json の形が辞書ではないため、使いません。"]
    known = default_values()
    accepted = {}
    warnings = []
    for key, value in values.items():
        if key in known:
            accepted[key] = value
        else:
            warnings.append(f"config.json の「{key}」は設定にない名前なので使いません。")
    return accepted, warnings


def to_path(value):
    if value is None or value == "":
        return None
    return Path(value).expanduser().resolve()


def is_inside(child, parent):
    """child が parent と同じか、その中にあるとき True"""
    if child is None or parent is None:
        return False
    try:
        Path(child).resolve().relative_to(Path(parent).resolve())
        return True
    except ValueError:
        return False


def load_config(overrides=None, read_user_file=True):
    """設定の辞書を作る。パスは pathlib.Path（未設定は None）にそろえる"""
    config = default_values()
    for key, value in windows_default_paths().items():
        if config.get(key) is None:
            config[key] = value

    if overrides and overrides.get("DATA_DIR") is not None:
        config["DATA_DIR"] = overrides["DATA_DIR"]

    warnings = []
    if read_user_file:
        user_values, warnings = read_user_config(config.get("DATA_DIR"))
        config.update(user_values)
    if overrides:
        config.update(overrides)

    for key in PATH_KEYS:
        config[key] = to_path(config.get(key))
    for key in PATH_LIST_KEYS:
        config[key] = [to_path(p) for p in (config.get(key) or []) if p]

    if config["SHELL_EXE"] is None:
        config["SHELL_EXE"] = INSTALL_DIR / "shell" / "Pip0Shell.exe"

    data_dir = config["DATA_DIR"]
    if data_dir is not None:
        if config["VAULT_DIR"] is None:
            config["VAULT_DIR"] = data_dir / "vault"
        config["DB_PATH"] = data_dir / "pip0.db"
        config["CONTROL_DIR"] = data_dir / "control"
        config["LOCK_DIR"] = data_dir / "locks"
        config["LOG_DIR"] = data_dir / "logs"
    else:
        config["DB_PATH"] = None
        config["CONTROL_DIR"] = None
        config["LOCK_DIR"] = None
        config["LOG_DIR"] = None

    config["CONFIG_WARNINGS"] = warnings
    config["CONFIG_ERRORS"] = check_locations(config)
    return config


def check_locations(config):
    """場所の組み合わせが危険でないかを確かめ、問題の説明のリストを返す"""
    errors = []
    root = config.get("PIP0_ROOT")
    vault = config.get("VAULT_DIR")
    data_dir = config.get("DATA_DIR")
    downloads = config.get("DOWNLOADS_DIR")
    if vault is not None and root is not None and is_inside(vault, root):
        errors.append("保管庫（VAULT_DIR）を pip0 専用フォルダー（PIP0_ROOT）の中に置くことはできません。")
    if vault is not None and downloads is not None and is_inside(vault, downloads):
        errors.append("保管庫（VAULT_DIR）をダウンロードフォルダーの中に置くことはできません。")
    if data_dir is not None and root is not None and is_inside(data_dir, root):
        errors.append("データフォルダー（DATA_DIR）を pip0 専用フォルダーの中に置くことはできません。")
    if root is not None and downloads is not None and (is_inside(root, downloads) or is_inside(downloads, root)):
        errors.append("pip0 専用フォルダーとダウンロードフォルダーは、互いの中に置けません。")
    return errors


def index_folders(config):
    """解析・検索の対象にするフォルダーと、その種類（location_kind）の一覧"""
    folders = []
    if config.get("DOWNLOADS_DIR") is not None:
        folders.append((config["DOWNLOADS_DIR"], "downloads"))
    if config.get("PIP0_ROOT") is not None:
        folders.append((config["PIP0_ROOT"], "pip0_root"))
    for folder in config.get("EXTRA_INDEX_DIRS") or []:
        folders.append((folder, "extra"))
    return folders
