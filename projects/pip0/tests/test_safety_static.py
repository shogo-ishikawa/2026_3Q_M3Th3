"""安全の約束を、コードの中身から確かめるテスト（静的な確認）

指示書6節：pip0 には、ごみ箱を空にする機能やユーザーのファイルを完全に削除する機能を作りません。
指示書3-1節：pip0 本体は外部と通信しません。

このテストは pip0/ の Python のコードを読み、ファイルを消す・中身を捨てる呼び出しと、
通信やコマンドの実行に使うモジュールが、下の「許可の一覧」の場所にしかないことを確かめます。
新しく加えたいときは、なぜユーザーのファイルを失わないのか（または通信しないのか）を一覧に書いて、
グループで確かめてから加えてください。
"""

import ast
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[1] / "pip0"

# ファイルを消す、名前を外す、中身を捨てる、移す呼び出し
DELETING_CALLS = {
    "os.remove", "os.unlink", "os.rmdir", "os.removedirs", "shutil.rmtree", "shutil.move",
    "unlink", "rmdir", "truncate",
}

# （モジュール, 関数）→ ユーザーのファイルを失わない理由
ALLOWED_DELETING_CALLS = {
    ("fsutil", "no_overwrite_rename"):
        "Windows 以外のテスト用：新しい名前を付けた後に、同じファイルの古い名前だけを外す（中身はそのまま）",
    ("killswitch", "resume"): "制御用の小さなファイル（自動処理の停止の印）を外す",
    ("killswitch", "take_restore_request"): "制御用の小さなファイル（全復元の依頼）を外す",
    ("vault", "discard_partial"): "保管庫へのコピーが途中で止まったときの、未完成のコピー（content.partial）を消す。原本はそのまま",
    ("vault", "remove_own_temp"): "衝突時に元の場所の横へ戻すための、pip0 自身の一時ファイルを、作成に失敗したときに消す。保管庫の内容はそのまま",
    ("platform_fake", "make_ghost"): "テスト用の代役：Windows の「中身をディスクから外す」動きをまねる",
    ("platform_fake", "simulate_user_delete"): "テスト用の代役：ユーザーの操作をまねる",
    ("platform_fake", "confirm_and_recycle"): "テスト用の代役：ごみ箱への移動をまねる",
}

# 通信やコマンドの実行に使うモジュールと、使ってよい場所（モジュール名）
NETWORK_MODULES = {"socket", "ssl", "http", "urllib", "requests", "ftplib", "smtplib", "poplib", "imaplib",
                   "telnetlib", "xmlrpc", "asyncio", "webbrowser", "subprocess", "multiprocessing"}
ALLOWED_NETWORK_IMPORTS = {
    ("netguard", "socket"): "外部通信が止まることを確かめる自己点検（接続は監査フックで止まる）",
    ("netguard", "urllib"): "外部通信が止まることを確かめる自己点検（接続は監査フックで止まる）",
    ("netguard", "subprocess"): "許可していないプログラムの起動が止まることを確かめる自己点検（起動は監査フックで止まる）",
    ("provenance", "urllib"): "urllib.parse で URL の文字列を分解するだけ（通信しない）",
    ("shell_link", "subprocess"): "pip0 シェル（同じ PC の子プロセス）を起動する。netguard が許可した実行ファイルだけ",
}


def module_files():
    return sorted(PACKAGE.glob("*.py"))


def call_name(node):
    """呼び出しの名前（os.remove、shutil.move、x.unlink → unlink）"""
    func = node.func
    if isinstance(func, ast.Attribute):
        if isinstance(func.value, ast.Name) and func.value.id in ("os", "shutil"):
            return f"{func.value.id}.{func.attr}"
        return func.attr
    if isinstance(func, ast.Name):
        return func.id
    return None


def deleting_calls(path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    found = []

    def visit(node, function_name):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                visit(child, child.name)
                continue
            if isinstance(child, ast.Call) and call_name(child) in DELETING_CALLS:
                found.append((path.stem, function_name, call_name(child), child.lineno))
            visit(child, function_name)

    visit(tree, "<module>")
    return found


def imported_modules(path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.extend((alias.name.split(".")[0], node.lineno) for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            names.append((node.module.split(".")[0], node.lineno))
    return names


def test_files_are_only_deleted_in_the_allowed_places():
    problems = []
    for path in module_files():
        for module, function, name, line in deleting_calls(path):
            if (module, function) not in ALLOWED_DELETING_CALLS:
                problems.append(f"pip0/{module}.py:{line} の {function}() が {name} を呼んでいます")
    assert problems == [], (
        "ファイルを消す・中身を捨てる呼び出しが、許可の一覧にない場所にあります。"
        "pip0 はユーザーのファイルを完全に削除しません（削除は trash.py の確認画面とごみ箱だけ）：\n"
        + "\n".join(problems)
    )


def test_allowed_deleting_calls_still_exist():
    # 許可の一覧が古くなっていないか（消えた関数が一覧に残っていないか）を確かめる
    present = set()
    for path in module_files():
        for module, function, _name, _line in deleting_calls(path):
            present.add((module, function))
    assert set(ALLOWED_DELETING_CALLS) - present == set()


def test_trash_module_never_deletes_by_itself():
    # 削除は platform.confirm_and_recycle（確認画面とごみ箱）だけに任せる
    calls = deleting_calls(PACKAGE / "trash.py")
    assert calls == []


def test_network_and_process_modules_are_only_used_where_allowed():
    problems = []
    for path in module_files():
        for module, line in imported_modules(path):
            if module in NETWORK_MODULES and (path.stem, module) not in ALLOWED_NETWORK_IMPORTS:
                problems.append(f"pip0/{path.stem}.py:{line} が {module} を使っています")
    assert problems == [], "通信やコマンドの実行に使うモジュールが、許可の一覧にない場所にあります：\n" + "\n".join(problems)


def test_no_function_empties_the_recycle_bin():
    # ごみ箱を空にする Windows の API（SHEmptyRecycleBin）を、どこからも呼ばない
    for path in list(module_files()) + sorted((PACKAGE.parent / "shell").rglob("*.cs")):
        text = path.read_text(encoding="utf-8")
        assert "SHEmptyRecycleBin" not in text, path
        assert "EmptyRecycleBin" not in text, path
