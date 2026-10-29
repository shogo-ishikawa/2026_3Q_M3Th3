"""Windows で使えるファイル名を作る

Windows では、次のような名前は使えません。

- 禁止文字：< > : " / \\ | ? * と、制御文字（文字コード 0〜31）
- 予約名：CON、PRN、AUX、NUL、COM0〜COM9、LPT0〜LPT9（拡張子が付いていても不可。大文字小文字は区別しない）
- 末尾の「.」や空白

pip0 が名前を付けるときは、禁止文字を見た目の近い全角の文字に置き換え、予約名の前に「_」を付け、
末尾の点と空白を取り除きます。拡張子は元のまま残します。
"""

import os
import re

# 禁止文字 → 置き換える全角の文字
REPLACEMENTS = {
    "<": "＜", ">": "＞", ":": "：", '"': "＂", "/": "／",
    "\\": "＼", "|": "｜", "?": "？", "*": "＊",
}

RESERVED_NAMES = {"CON", "PRN", "AUX", "NUL"}
for _number in "0123456789¹²³":
    RESERVED_NAMES.add("COM" + _number)
    RESERVED_NAMES.add("LPT" + _number)

MAX_NAME_LENGTH = 255  # Windows（NTFS）の1つの名前の長さの上限（文字数）


def split_ext(name):
    """「報告.pdf」→ ("報告", ".pdf")。拡張子がなければ ("名前", "")。「.gitignore」のような名前は拡張子なし"""
    stem, ext = os.path.splitext(name)
    if not stem:
        return name, ""
    return stem, ext


def check_name(name):
    """Windows で使える名前なら (True, "")、使えなければ (False, 理由)"""
    if name == "" or name.strip() == "":
        return False, "名前が空です"
    for ch in name:
        if ch in REPLACEMENTS:
            return False, f"使えない文字「{ch}」が含まれています"
        if ord(ch) < 32:
            return False, "制御文字が含まれています"
    if name.endswith(".") or name.endswith(" "):
        return False, "名前の最後に「.」や空白は使えません"
    base = name.split(".")[0].strip().upper()
    if base in RESERVED_NAMES:
        return False, f"「{base}」は Windows の予約名です"
    if len(name) > MAX_NAME_LENGTH:
        return False, f"名前が長すぎます（{len(name)}文字、上限{MAX_NAME_LENGTH}文字）"
    return True, ""


def clean_part(text):
    """名前の一部にする文字列を整える（禁止文字の置き換え、制御文字の削除、空白をまとめる）"""
    result = []
    for ch in text:
        if ch in REPLACEMENTS:
            result.append(REPLACEMENTS[ch])
        elif ord(ch) < 32 or ord(ch) == 127:
            result.append(" ")
        else:
            result.append(ch)
    return re.sub(r"\s+", " ", "".join(result)).strip()


def make_safe(name, max_len=200):
    """Windows で使える名前にして返す。拡張子は残し、長すぎるときは拡張子の前を短くする"""
    stem, ext = split_ext(name)
    stem = clean_part(stem).rstrip(". ")
    ext = clean_part(ext).rstrip(". ")
    if ext == ".":
        ext = ""
    if stem == "":
        stem = "無題"
    if stem.split(".")[0].strip().upper() in RESERVED_NAMES:
        stem = "_" + stem
    limit = max(1, min(max_len, MAX_NAME_LENGTH) - len(ext))
    if len(stem) > limit:
        stem = stem[:limit].rstrip(". ")
        if stem == "":
            stem = "無題"
    return stem + ext


def unique_name(folder, name, exists=os.path.exists):
    """folder の中で、まだ使われていない名前を返す（「報告.pdf」→「報告 (2).pdf」→「報告 (3).pdf」…）"""
    if not exists(os.path.join(folder, name)):
        return name
    stem, ext = split_ext(name)
    number = 2
    while True:
        candidate = f"{stem} ({number}){ext}"
        if not exists(os.path.join(folder, candidate)):
            return candidate
        number += 1
