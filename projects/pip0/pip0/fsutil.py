"""ファイル操作の小さな部品（上書きしない改名、途中で止まっても壊れない書き込み、ハッシュ）

pip0 は、既存のファイルを黙って上書きしません。また、記録用のファイル（保管庫の manifest.json など）は、
「一時ファイルに書く → ディスクへ確実に書き出す（fsync）→ 名前を置き換える」の順で書くので、
途中で電源が切れても、古い内容か新しい内容のどちらかが残り、壊れた内容にはなりません。
"""

import errno
import hashlib
import json
import os
import sys


class Paused(Exception):
    """should_continue() が偽を返したので、区切りで止めた"""


def no_overwrite_rename(src, dst):
    """src を dst へ改名・移動する。dst がすでにあれば FileExistsError を出し、何も変えない

    Windows：os.rename は、移動先があると失敗する（上書きしない）。
    Windows 以外（授業用の Linux 等でのテスト）：os.rename は上書きしてしまうため、
    「新しい名前を追加（os.link、移動先があると失敗）→ 元の名前を外す」の順にする。
    同じファイルに名前を付け直すだけで、中身のコピーや削除はしない。
    """
    src, dst = os.fspath(src), os.fspath(dst)
    if sys.platform == "win32":
        os.rename(src, dst)
        return
    try:
        os.link(src, dst)
    except FileExistsError:
        raise
    except OSError as error:
        if error.errno not in (errno.EPERM, errno.ENOTSUP, errno.EOPNOTSUPP, errno.EXDEV):
            raise
        # 名前の追加ができないファイルシステムでは、確かめてから改名する（確認と改名の間はわずかに無防備）
        if os.path.lexists(dst):
            raise FileExistsError(errno.EEXIST, "移動先がすでにあります", dst) from error
        os.rename(src, dst)
        return
    os.unlink(src)


def fsync_file(f):
    f.flush()
    os.fsync(f.fileno())


def fsync_dir(path):
    """フォルダーの変更（名前の追加・置き換え）をディスクへ書き出す。Windows では不要なので何もしない"""
    if sys.platform == "win32":
        return
    fd = os.open(os.fspath(path), os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic_write_bytes(path, data):
    """path を data で置き換える。途中で止まっても、古い内容か新しい内容のどちらかが残る"""
    path = os.fspath(path)
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
        fsync_file(f)
    os.replace(tmp, path)
    fsync_dir(os.path.dirname(path) or ".")


def atomic_write_json(path, value):
    atomic_write_bytes(path, json.dumps(value, ensure_ascii=False, indent=2).encode("utf-8"))


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def sha256_stream(f, chunk_size=1024 * 1024, should_continue=None):
    """開いたファイル f の残りの内容の SHA-256 を返す。区切りごとに should_continue() を確かめる"""
    digest = hashlib.sha256()
    while True:
        if should_continue is not None and not should_continue():
            raise Paused()
        chunk = f.read(chunk_size)
        if not chunk:
            break
        digest.update(chunk)
    return digest.hexdigest()


def sha256_file(path, chunk_size=1024 * 1024, should_continue=None, opener=None):
    """ファイルの SHA-256。opener を渡すと、その関数で開く（例：platform.open_for_analysis）"""
    if opener is None:
        f = open(path, "rb")
    else:
        f = opener(path)
    with f:
        return sha256_stream(f, chunk_size, should_continue)
