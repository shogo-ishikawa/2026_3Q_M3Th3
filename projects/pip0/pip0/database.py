"""暗号化DB（SQLCipher）とテーブル

解析結果、検索に使う索引、ファイルの由来、操作履歴は、すべてこの DB に入れます。
DB は SQLCipher（sqlcipher3 パッケージ）で、ページ単位に AES-256 で暗号化されます。
SQLCipher が読み込めないときは、通常の sqlite3 に切り替えず、エラーにします（平文で保存しないため）。

ジャーナル（WAL）も同じ鍵で暗号化されます。一時ファイルは暗号化されないため、
一時領域をメモリーに置く設定（temp_store=MEMORY）にして、その設定が効いているかを確かめます。
"""

import json
import time
from contextlib import contextmanager
from pathlib import Path

from pip0 import keystore as keystore_module

SCHEMA_VERSION = 1


class EncryptionUnavailable(RuntimeError):
    """SQLCipher（暗号化できる SQLite）が使えない"""


class DatabaseKeyError(RuntimeError):
    """鍵が違う、または DB が壊れていて読めない"""


SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- 自動処理の状態など、小さな設定値
CREATE TABLE IF NOT EXISTS settings_kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- pip0 が見つけたファイル（1行が1つのパス）
CREATE TABLE IF NOT EXISTS files (
    id            INTEGER PRIMARY KEY,
    path          TEXT NOT NULL UNIQUE,
    file_key      TEXT,                  -- 同じ実体を追うための識別子「ボリューム番号:ファイル番号」
    name          TEXT NOT NULL,
    ext           TEXT NOT NULL,         -- 小文字、. 付き。拡張子なしは ''
    size          INTEGER,
    mtime         REAL,                  -- 最終更新日時（秒）
    ctime         REAL,                  -- 作成日時（秒、分かる場合）
    location_kind TEXT NOT NULL,         -- 'downloads' | 'pip0_root' | 'extra'
    status        TEXT NOT NULL DEFAULT 'present',  -- 'present' | 'missing' | 'ghost'
    first_seen_at REAL NOT NULL,         -- pip0 が観測を始めた日時（長期間未読の判定に使う）
    last_seen_at  REAL NOT NULL,
    updated_at    REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS files_by_key ON files(file_key);

-- ブラウザー拡張から届いたダウンロードの記録（Native Messaging の受け口が書き込む）
CREATE TABLE IF NOT EXISTS download_events (
    id                  INTEGER PRIMARY KEY,
    received_at         REAL NOT NULL,
    browser             TEXT,
    extension_origin    TEXT NOT NULL,
    browser_download_id INTEGER,
    filename            TEXT NOT NULL,   -- 保存先の絶対パス（拡張機能の報告）
    url                 TEXT,            -- ダウンロードURL（リダイレクト前）。? 以降と # 以降は除く
    final_url           TEXT,            -- ダウンロードURL（リダイレクト後）
    referrer_url        TEXT,            -- 参照元URL
    tab_url             TEXT,            -- ダウンロード開始時に前面だったタブ（発生元とは限らない）
    tab_title           TEXT,
    mime                TEXT,
    started_at          REAL,
    ended_at            REAL,
    file_size           INTEGER,
    state               TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'matched' | 'expired'
    matched_file_id     INTEGER REFERENCES files(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS download_events_by_state ON download_events(state, received_at);

-- ファイルの由来（入手経路）。根拠のない推測は入れない
CREATE TABLE IF NOT EXISTS provenance (
    file_id           INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
    source_label      TEXT,              -- 'Slack' など。不明なら NULL
    source_kind       TEXT,              -- 'browser_extension' | 'zone_identifier'
    evidence          TEXT,              -- 判断の根拠（例：files.slack.com からのダウンロード）
    download_url      TEXT,
    referrer_url      TEXT,
    host              TEXT,
    tab_url           TEXT,
    tab_title         TEXT,
    downloaded_at     REAL,
    download_event_id INTEGER REFERENCES download_events(id) ON DELETE SET NULL,
    recorded_at       REAL NOT NULL
);

-- 解析結果（高負荷処理の結果。電源接続中かつ3分間無操作のときだけ作られる）
CREATE TABLE IF NOT EXISTS analysis (
    file_id                  INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
    status                   TEXT NOT NULL,      -- 'pending' | 'done' | 'failed' | 'unsupported'
    analyser_version         INTEGER NOT NULL DEFAULT 1,
    analysed_at              REAL,
    size_at_analysis         INTEGER,
    mtime_at_analysis        REAL,
    sha256                   TEXT,
    kind                     TEXT,               -- 'pdf' | 'document' | 'spreadsheet' | 'slides' | 'image' | 'text' | 'other'
    title                    TEXT,
    text_excerpt             TEXT,               -- 本文（先頭から settings.TEXT_MAX_CHARS 文字まで）
    has_chart                INTEGER,            -- Office 文書がグラフを含むか（1/0、不明は NULL）
    colours_json             TEXT,               -- 画像の色の割合 {"blue": 0.41, ...}
    colourful_ratio          REAL,               -- 画像のうち色付きの部分の割合
    chart_score              REAL,               -- 画像のグラフらしさ（0〜1）
    chart_evidence_json      TEXT,
    visual_kind              TEXT,               -- 'chart' | 'photo' | 'other'
    labels_json              TEXT,               -- 秘密度ラベル（Microsoft Purview）の名前
    sensitivity              TEXT NOT NULL DEFAULT 'unknown',  -- 'sensitive' | 'not_sensitive' | 'unknown'
    sensitivity_reasons_json TEXT,
    error                    TEXT
);

-- 利用の記録（長期間未読の判定に使う。pip0 自身の読み取りは記録しない）
CREATE TABLE IF NOT EXISTS usage_events (
    id           INTEGER PRIMARY KEY,
    file_id      INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL,    -- 'modified' | 'recent_item' | 'ghost_open' | 'access_time' | 'user_action'
    at           REAL NOT NULL,
    process_name TEXT,
    detail       TEXT
);
CREATE INDEX IF NOT EXISTS usage_events_by_file ON usage_events(file_id, at);

-- 操作履歴（仕分け、改名、退避、復元、ごみ箱、全復元 など）
CREATE TABLE IF NOT EXISTS operations (
    id           INTEGER PRIMARY KEY,
    at           REAL NOT NULL,
    kind         TEXT NOT NULL,
    actor        TEXT NOT NULL,    -- 'auto' | 'user' | 'kill_switch' | 'system'
    status       TEXT NOT NULL,    -- 'done' | 'failed' | 'skipped' | 'cancelled' | 'conflict' | 'refused'
    file_id      INTEGER REFERENCES files(id) ON DELETE SET NULL,
    item_id      TEXT,
    before_path  TEXT,
    after_path   TEXT,
    reasons_json TEXT,             -- 判断の根拠（リスト）
    detail       TEXT
);
CREATE INDEX IF NOT EXISTS operations_by_time ON operations(at);

-- 保管庫の項目（vault の manifest.json と同じ内容を持つ。DB が読めなくても manifest から復元できる）
CREATE TABLE IF NOT EXISTS vault_items (
    item_id       TEXT PRIMARY KEY,
    file_id       INTEGER REFERENCES files(id) ON DELETE SET NULL,
    original_path TEXT NOT NULL,
    current_path  TEXT NOT NULL,   -- ゴーストの今の場所（改名・移動を反映）
    file_key      TEXT,
    size          INTEGER NOT NULL,
    mtime_ns      INTEGER NOT NULL,
    sha256        TEXT,
    state         TEXT NOT NULL,
    created_at    REAL NOT NULL,
    updated_at    REAL NOT NULL,
    attempts      INTEGER NOT NULL DEFAULT 0,
    last_error    TEXT,
    restored_path TEXT,
    restored_at   REAL
);
CREATE INDEX IF NOT EXISTS vault_items_by_state ON vault_items(state);

-- 高負荷処理の順番待ち（解析、退避）
CREATE TABLE IF NOT EXISTS tasks (
    id         INTEGER PRIMARY KEY,
    kind       TEXT NOT NULL,      -- 'analyse' | 'evacuate'
    file_id    INTEGER REFERENCES files(id) ON DELETE CASCADE,
    state      TEXT NOT NULL DEFAULT 'queued',  -- 'queued' | 'running' | 'done' | 'failed'
    priority   INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    UNIQUE(kind, file_id)
);

-- M1 流入処理の記録（提案と、その結果）
CREATE TABLE IF NOT EXISTS inflow (
    id                INTEGER PRIMARY KEY,
    file_id           INTEGER REFERENCES files(id) ON DELETE SET NULL,
    path              TEXT NOT NULL,
    download_event_id INTEGER REFERENCES download_events(id) ON DELETE SET NULL,
    detected_at       REAL NOT NULL,
    state             TEXT NOT NULL,   -- 'proposed' | 'executed' | 'kept' | 'deferred' | 'failed' | 'no_candidate'
    proposal_json     TEXT,
    decision          TEXT,            -- 'auto' | 'user_accept' | 'user_alternative' | 'user_keep'
    decided_at        REAL,
    detail            TEXT
);
"""


def load_sqlcipher():
    """sqlcipher3 を読み込む。なければ EncryptionUnavailable（平文の sqlite3 には切り替えない）"""
    try:
        from sqlcipher3 import dbapi2 as sqlcipher
    except ImportError as error:
        raise EncryptionUnavailable(
            "SQLCipher（sqlcipher3 パッケージ）が見つかりません。"
            "pip0 は暗号化できない DB を作りません。requirements.txt の手順で導入してください。"
        ) from error
    return sqlcipher


def open_encrypted(db_path, key_hex):
    """鍵 key_hex（64文字の16進数）で、暗号化DBを開く（なければ作る）"""
    if not keystore_module.is_valid_key(key_hex):
        raise DatabaseKeyError("鍵の形が正しくありません（64文字の16進数が必要です）。")
    sqlcipher = load_sqlcipher()
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlcipher.connect(str(db_path), isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlcipher.Row
    # 鍵は、ほかのどの命令よりも先に渡す。x'...' は「生の鍵」の指定（パスワードからの鍵の計算をしない）
    conn.execute(f"PRAGMA key = \"x'{key_hex}'\"")
    cipher_version = conn.execute("PRAGMA cipher_version").fetchone()
    if not cipher_version or not cipher_version[0]:
        conn.close()
        raise EncryptionUnavailable("SQLCipher の暗号化が有効になっていません。")
    try:
        conn.execute("SELECT count(*) FROM sqlite_master").fetchone()
    except sqlcipher.DatabaseError as error:
        conn.close()
        raise DatabaseKeyError("DB を読めません。鍵が違うか、DB が壊れています。") from error
    conn.execute("PRAGMA temp_store = MEMORY")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.execute("PRAGMA secure_delete = ON")
    temp_store = conn.execute("PRAGMA temp_store").fetchone()[0]
    if temp_store != 2:
        conn.close()
        raise EncryptionUnavailable("一時領域をメモリーに置く設定（temp_store=MEMORY）が効いていません。")
    ensure_schema(conn)
    return conn


def open_database(config, keystore=None):
    """設定の DB_PATH の DB を、OS の鍵保管機構の鍵で開く"""
    if config.get("DB_PATH") is None:
        raise EncryptionUnavailable("データフォルダー（DATA_DIR）が設定されていません。")
    if keystore is None:
        keystore = keystore_module.default_keystore()
    db_exists = Path(config["DB_PATH"]).exists()
    key_hex = keystore_module.get_or_create_key(keystore, db_exists)
    return open_encrypted(config["DB_PATH"], key_hex)


def ensure_schema(conn):
    conn.executescript(SCHEMA)
    row = conn.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()
    if row is None:
        conn.execute("INSERT INTO meta (key, value) VALUES ('schema_version', ?)", (str(SCHEMA_VERSION),))
        conn.execute("INSERT INTO meta (key, value) VALUES ('created_at', ?)", (str(time.time()),))


def check_encryption(conn):
    """暗号化の状態を返す（確認・表示用）"""
    return {
        "cipher_version": conn.execute("PRAGMA cipher_version").fetchone()[0],
        "temp_store": conn.execute("PRAGMA temp_store").fetchone()[0],
        "journal_mode": conn.execute("PRAGMA journal_mode").fetchone()[0],
    }


@contextmanager
def transaction(conn):
    """まとめて書き込む。途中で失敗したら、まとめて取り消す"""
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    conn.execute("COMMIT")


def row_to_dict(row):
    if row is None:
        return None
    return {key: row[key] for key in row.keys()}


def query_one(conn, sql, params=()):
    return row_to_dict(conn.execute(sql, params).fetchone())


def query_all(conn, sql, params=()):
    return [row_to_dict(row) for row in conn.execute(sql, params).fetchall()]


def execute(conn, sql, params=()):
    """1つの命令を実行し、追加した行の id を返す"""
    cursor = conn.execute(sql, params)
    return cursor.lastrowid


def get_setting(conn, key, default=None):
    row = conn.execute("SELECT value FROM settings_kv WHERE key = ?", (key,)).fetchone()
    if row is None:
        return default
    return row[0]


def set_setting(conn, key, value):
    conn.execute(
        "INSERT INTO settings_kv (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, str(value)),
    )


def log_operation(conn, kind, *, actor, status, file_id=None, item_id=None,
                  before_path=None, after_path=None, reasons=None, detail=None, at=None):
    """操作履歴に1行を追加し、その id を返す。reasons は判断の根拠（文字列のリスト）"""
    return execute(
        conn,
        "INSERT INTO operations (at, kind, actor, status, file_id, item_id, before_path, after_path, reasons_json, detail) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            at if at is not None else time.time(),
            kind, actor, status, file_id, item_id,
            str(before_path) if before_path is not None else None,
            str(after_path) if after_path is not None else None,
            json.dumps(reasons, ensure_ascii=False) if reasons is not None else None,
            detail,
        ),
    )
