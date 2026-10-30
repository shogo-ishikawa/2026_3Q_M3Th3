"""コマンド（python -m pip0 <コマンド>）

pip0 を、コマンド プロンプトや PowerShell から操作する入口です（docs/design.md 6-8）。
画面（通知領域のアイコン）が動かないときの全復元（scripts\\restore-all.cmd）や、導入・削除のスクリプトも、
ここのコマンドを使います。

| コマンド | すること |
| --- | --- |
| serve [--no-shell] | 常駐処理を始める（Windows だけ。pip0 シェルを子プロセスで起動する） |
| status | 自動処理の状態、高負荷の処理の条件、保管庫の件数、各機能の状態（権限の不足を含む）を表示する |
| stop | 自動処理を止めるだけ（キルスイッチの「停止」。復元はしない） |
| restore-all | 全復元。常駐処理が動いていれば依頼して進み具合を表示し、動いていなければ自分で行う |
| resume [--yes] | 止めた自動処理を再開する（「はい」と入力して確かめる） |
| search "<言葉>" | エピソード記憶検索 |
| delete <パス>... | ごみ箱へ移す（pip0 シェルの確認画面で承認したときだけ。Windows だけ） |
| vault list ／ vault restore <項目ID> | 保管庫の一覧／1件の復元 |
| demo [--dir <空のフォルダー>] | ダミーデータで、検索の3例、M1 の改名の提案、M5 の機密の判定を試す（どの OS でも） |
| register-root ／ unregister-root | pip0 専用フォルダーを同期ルートとして登録／解除（解除はゴーストがないときだけ） |
| check-encryption | DB の暗号化の状態を確かめる |
| check-network | このプロセスの中で、外部通信の禁止（監査フック）が働くかを確かめる |
| shutdown | 常駐処理に終了を依頼する |

どのコマンドの前にも、--data-dir、--pip0-root、--downloads-dir で場所を変えられます（試すときに使う）。

終了コード：0 成功、1 失敗・断った・期待と違う結果、2 使い方の誤り・この PC では使えない操作

テストでは main(argv, keystore=MemoryKeystore(), platform=FakePlatform(...), out=io.StringIO()) のように、
鍵の保管場所、OS 連携、表示の行き先を差し替えられます。
"""

import argparse
import logging
import logging.handlers
import os
import sys
import time
from pathlib import Path

from pip0 import (analyse_text, analysis_queue, database, demo_data, fsutil, killswitch, naming, netguard,
                  platform_fake, platform_windows, provenance, safe_names, search, service, shell_link, throttle,
                  timeutil, trash, vault)
from pip0 import config as config_module
from pip0 import keystore as keystore_module
from pip0 import rules as default_rules
from pip0.ui import ShellUi

logger = logging.getLogger(__name__)

EXIT_OK = 0
EXIT_FAILED = 1
EXIT_UNAVAILABLE = 2

# ★待ち時間（秒）
PROGRESS_POLL_SECONDS = 1.0   # 常駐処理に全復元を依頼したとき、進み具合を確かめる間隔
SHUTDOWN_WAIT_SECONDS = 60.0  # 常駐処理に終了を依頼したとき、終わるのを待つ秒数

RESUME_ANSWER = "はい"        # resume の確認で入力してもらう言葉
LOG_FILE_NAME = "pip0.log"    # serve の動作の記録（LOG_DIR の中。ファイル名・本文・URL は書かない）
LOG_MAX_BYTES = 1024 * 1024
LOG_BACKUPS = 3

WINDOWS_ONLY = "この操作には、Windows 11 の pip0 シェル（画面と OS 連携）が必要なため、この PC では使えません。"
BUSY_REASON = ("pip0 の常駐処理（または、ほかの pip0 のコマンド）が動いているため、このコマンドは実行しません"
               "（pip0 シェルは1つしか動かせず、保管庫を2つのプロセスで同時に扱わないため）。")


# ----------------------------------------------------------------------
# 入口
# ----------------------------------------------------------------------


def main(argv=None, keystore=None, platform=None, out=None):
    """コマンドを実行し、終了コードを返す

    argv：引数のリスト（None なら、コマンドラインの引数）
    keystore：DB の鍵の保管場所（None なら OS の鍵保管機構。テストでは MemoryKeystore）
    platform：OS 連携（None なら、Windows では pip0 シェルを起動して WindowsPlatform を使う。テストでは FakePlatform）
    out：表示の行き先（None なら標準出力）
    """
    out = sys.stdout if out is None else out
    parser = build_parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as request:  # 使い方の誤り（argparse が説明を出した）、または --help
        return request.code if isinstance(request.code, int) else EXIT_UNAVAILABLE
    if args.command is None:
        parser.print_help(out)
        return EXIT_UNAVAILABLE
    cli = {
        "args": args,
        "config": load_config(args),
        "rules": default_rules,
        "keystore": keystore,
        "platform": platform,
        "out": out,
    }
    try:
        return COMMANDS[args.command](cli)
    except KeyboardInterrupt:
        say(cli, "中断しました。")
        return EXIT_FAILED


def build_parser():
    """コマンドと引数の決まり（argparse）"""
    parser = JapaneseArgumentParser(prog="python -m pip0", description="pip0：デバイス内のファイル整理アシスタント",
                                    add_help=False, formatter_class=JapaneseHelpFormatter)
    add_options(parser, for_command=False)
    commands = parser.add_subparsers(dest="command", title="コマンド", metavar="<コマンド>")

    serve, options = add_command(commands, "serve", "常駐処理を始める（Windows）")
    options.add_argument("--no-shell", action="store_true", help="pip0 シェルを起動しない（開発用）")
    add_command(commands, "status", "状態を表示する")
    add_command(commands, "stop", "自動処理を止める（復元はしない）")
    add_command(commands, "restore-all", "全復元（自動処理を止めて、退避したファイルを戻す）")
    resume, options = add_command(commands, "resume", "止めた自動処理を再開する（確認あり）")
    options.add_argument("--yes", action="store_true", help="確認の入力を省く（再開することを、すでに確かめたとき）")
    search_command, options = add_command(commands, "search", "エピソード記憶検索")
    search_command.add_argument_group("引数").add_argument("words", nargs="+", help="検索の言葉（例：青いグラフ）")
    delete, options = add_command(commands, "delete", "ごみ箱へ移す（確認画面で承認したときだけ）")
    delete.add_argument_group("引数").add_argument("paths", nargs="+", help="ごみ箱へ移すファイル")
    vault_command, options = add_command(commands, "vault", "保管庫（一覧と、1件の復元）")
    vault_commands = vault_command.add_subparsers(dest="vault_command", title="保管庫のコマンド",
                                                  metavar="<list|restore>")
    add_command(vault_commands, "list", "保管庫の項目の一覧")
    vault_restore, options = add_command(vault_commands, "restore", "1件を元の場所へ戻す")
    vault_restore.add_argument_group("引数").add_argument("item_id",
                                                         help="項目ID（32桁の16進数。vault list で確かめる）")
    demo, options = add_command(commands, "demo", "ダミーデータで試す（Windows 以外でも動く）")
    options.add_argument("--dir", default=None, help="ダミーのファイルを作る空のフォルダー（なければ一時フォルダー）")
    add_command(commands, "register-root", "pip0 専用フォルダーを同期ルートとして登録する")
    add_command(commands, "unregister-root", "同期ルートの登録を解除する（ゴーストがないときだけ）")
    add_command(commands, "check-encryption", "DB の暗号化の状態を確かめる")
    add_command(commands, "check-network", "外部通信の禁止（監査フック）が働くかを確かめる")
    add_command(commands, "shutdown", "常駐処理に終了を依頼する")
    return parser


def add_command(commands, name, description):
    """コマンドを1つ加える。(コマンドの parser, そのオプションのグループ) を返す"""
    command = commands.add_parser(name, help=description, description=description, add_help=False,
                                  formatter_class=JapaneseHelpFormatter)
    options = add_options(command, for_command=True)
    return command, options


def add_options(parser, for_command):
    """-h と、場所の指定（--data-dir など）を「オプション」のグループに加える

    場所の指定は、コマンドの前にも後にも書けるようにする。
    コマンドの後の指定がないときは、前の指定（なければ None）を使う
    （そのため、コマンドの側の既定値は argparse.SUPPRESS にする）。
    """
    options = parser.add_argument_group("オプション")
    options.add_argument("-h", "--help", action="help", help="使い方を表示する")
    default = argparse.SUPPRESS if for_command else None
    options.add_argument("--data-dir", default=default, help="データフォルダー（DB、保管庫、制御用のファイル）")
    options.add_argument("--pip0-root", default=default, help="pip0 専用フォルダー")
    options.add_argument("--downloads-dir", default=default, help="ダウンロードフォルダー")
    return options


class JapaneseHelpFormatter(argparse.HelpFormatter):
    """使い方の表示の見出しを日本語にする（argparse の決まりで、クラスにします）"""

    def add_usage(self, usage, actions, groups, prefix=None):
        if prefix is None:
            prefix = "使い方："
        return super().add_usage(usage, actions, groups, prefix)


class JapaneseArgumentParser(argparse.ArgumentParser):
    """引数の誤りを、日本語の説明で知らせる（誤りの中身の文は、argparse の英語のまま入ります）"""

    def error(self, message):
        self.print_usage(sys.stderr)
        self.exit(EXIT_UNAVAILABLE, f"{self.prog}：引数に誤りがあります（{message}）。-h で使い方を表示できます。\n")


def load_config(args):
    """--data-dir などの指定を重ねて、設定を読む（読むだけで、フォルダーを作るなどの変更はしない）"""
    overrides = {}
    if args.data_dir:
        overrides["DATA_DIR"] = args.data_dir
    if args.pip0_root:
        overrides["PIP0_ROOT"] = args.pip0_root
    if args.downloads_dir:
        overrides["DOWNLOADS_DIR"] = args.downloads_dir
    return config_module.load_config(overrides=overrides or None)


def say(cli, text=""):
    print(text, file=cli["out"])


# ----------------------------------------------------------------------
# 共通の部品：DB、OS 連携、ロック
# ----------------------------------------------------------------------


def open_db(cli, create=False):
    """暗号化DB を開く。(接続, 開けなかった理由) を返す（開けなければ接続は None）

    create：DB がまだないときに作ってよいか（表示だけのコマンドでは作らない）
    """
    config = cli["config"]
    if config.get("DB_PATH") is None:
        return None, "データフォルダー（DATA_DIR）が設定されていません（--data-dir で指定できます）"
    if not create and not Path(config["DB_PATH"]).exists():
        return None, "暗号化DB はまだありません（pip0 を起動すると作られます）"
    try:
        return database.open_database(config, keystore=cli["keystore"]), ""
    except (keystore_module.KeyMissing, keystore_module.KeystoreUnavailable,
            database.DatabaseKeyError, database.EncryptionUnavailable) as error:
        return None, str(error)


def open_db_or_manifests(cli):
    """DB を開く。開けない（鍵をなくした等）・まだないときは、保管庫の manifest.json から読み直した、
    メモリーの中だけの DB を使う（保管庫は暗号化していないので、鍵がなくても戻せる）。(接続, 説明) を返す
    """
    conn, problem = open_db(cli, create=False)
    if conn is not None:
        return conn, ""
    try:
        conn = database.open_encrypted(":memory:", keystore_module.new_key_hex())
    except (database.EncryptionUnavailable, database.DatabaseKeyError) as error:
        return None, str(error)
    vault.sync_from_manifests(conn, cli["config"])
    return conn, f"暗号化DB を使えないため（{problem}）、保管庫の manifest.json から読み直して使います。"


def prepare_platform(cli, headless):
    """OS 連携を用意する。Windows では pip0 シェルを起動し、init と同期ルートの接続まで行う

    戻り値：{"ok", "reason", "platform", "link", "windows_only"}（終わったら release_platform を呼ぶ）
    """
    if cli["platform"] is not None:
        return {"ok": True, "reason": "", "platform": cli["platform"], "link": None, "windows_only": False}
    if sys.platform != "win32":
        return {"ok": False, "reason": WINDOWS_ONLY, "platform": None, "link": None, "windows_only": True}
    config = cli["config"]
    netguard.install([str(config["SHELL_EXE"])])  # 外部通信を止める。起動してよいのは pip0 シェルだけ
    command = [str(config["SHELL_EXE"])]
    if headless:
        command.append("--headless")
    link = shell_link.ShellLink(command, on_event=None)
    platform = platform_windows.WindowsPlatform(link, pip0_root=config["PIP0_ROOT"])
    started = service.connect_shell(link, platform, config, headless=headless)
    if not started["ok"]:
        link.stop()
        return {"ok": False, "reason": started["reason"], "platform": None, "link": None, "windows_only": False}
    if not started["sync_root"]["ok"]:
        say(cli, "注意：pip0 専用フォルダーの同期ルートにつなげませんでした（" + started["sync_root"]["reason"] + "）")
    return {"ok": True, "reason": "", "platform": platform, "link": link, "windows_only": False}


def release_platform(prepared):
    if prepared.get("link") is not None:
        prepared["link"].stop()


def hold_lock(cli):
    """保管庫やシェルを使うコマンドの間、常駐処理が起動しないようにロックを取る。取れなければ None"""
    lock = service.InstanceLock(cli["config"])
    try:
        if lock.acquire():
            return lock
    except OSError:
        pass
    return None


def read_vault_manifests(config):
    """保管庫の manifest.json を1件ずつ読む（DB の鍵がなくても読める）。(manifest のリスト, 読めなかった件数)"""
    vault_dir = config.get("VAULT_DIR")
    if vault_dir is None:
        return [], 0
    items = Path(vault_dir) / "items"
    try:
        entries = sorted(items.iterdir()) if items.is_dir() else []
    except OSError:
        return [], 1  # 保管庫の中を読めない：読めない項目があるものとして扱う（安全側）
    manifests = []
    unreadable = 0
    for entry in entries:
        if entry.is_symlink() or not entry.is_dir() or not vault.is_valid_item_id(entry.name):
            continue  # 項目ではないもの（触れない）
        manifest = vault.read_manifest(config, entry.name)
        if manifest is None:
            unreadable += 1
        else:
            manifests.append(manifest)
    return manifests, unreadable


def count_states(manifests):
    counts = {}
    for manifest in manifests:
        counts[manifest["state"]] = counts.get(manifest["state"], 0) + 1
    return counts


def format_size(size):
    if not isinstance(size, int):
        return "不明"
    if size < 1024:
        return f"{size} バイト"
    if size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    if size < 1024 * 1024 * 1024:
        return f"{size / 1024 / 1024:.1f} MB"
    return f"{size / 1024 / 1024 / 1024:.1f} GB"


def local_time_text(ts):
    if not isinstance(ts, (int, float)) or isinstance(ts, bool):
        return "不明"
    return timeutil.local_datetime_str(ts)


# ----------------------------------------------------------------------
# serve：常駐処理
# ----------------------------------------------------------------------


def command_serve(cli):
    args = cli["args"]
    config = cli["config"]
    if cli["platform"] is None and sys.platform != "win32":
        say(cli, "常駐処理（serve）は Windows 11 でだけ動きます（pip0 シェルと Windows の機能を使うため）。")
        say(cli, "この PC では、ダミーデータのデモを試せます：python -m pip0 demo")
        return EXIT_UNAVAILABLE
    if config["CONFIG_ERRORS"]:
        for problem in config["CONFIG_ERRORS"]:
            say(cli, "設定の問題：" + problem)
        say(cli, "設定を直してから、もう一度起動してください。")
        return EXIT_FAILED
    if service.is_running(config):
        say(cli, service.ALREADY_RUNNING_REASON)
        return EXIT_FAILED
    setup_logging(config)
    conn, problem = open_db(cli, create=True)
    if conn is None:
        say(cli, "暗号化DB を開けないため、起動しません：" + problem)
        logger.error("暗号化DB を開けないため、起動しませんでした")
        record_start_failure(config, "暗号化DB を開けないため、起動しませんでした：" + problem)
        return EXIT_FAILED
    try:
        if args.no_shell:
            link = service.NoShellLink()
        else:
            link = shell_link.ShellLink([str(config["SHELL_EXE"])], on_event=None)
        platform = cli["platform"]
        if platform is None:
            platform = platform_windows.WindowsPlatform(link, pip0_root=config["PIP0_ROOT"])
        result = service.run(config, cli["rules"], platform, ShellUi(link), conn, link=link, keystore=cli["keystore"])
    finally:
        conn.close()
    if not result["ok"]:
        say(cli, "起動しませんでした：" + result["reason"])
        return EXIT_FAILED
    say(cli, "常駐処理を終了しました。")
    return EXIT_OK


def setup_logging(config):
    """serve の動作の記録を LOG_DIR/pip0.log に書く

    ファイル名・パス・本文・URL・ウィンドウタイトルは、どのモジュールもログに書きません。
    """
    log_dir = config.get("LOG_DIR")
    if log_dir is None:
        return
    pip0_logger = logging.getLogger("pip0")
    for handler in pip0_logger.handlers:
        if isinstance(handler, logging.handlers.RotatingFileHandler):
            return  # すでに設定した
    try:
        Path(log_dir).mkdir(parents=True, exist_ok=True)
        handler = logging.handlers.RotatingFileHandler(Path(log_dir) / LOG_FILE_NAME, maxBytes=LOG_MAX_BYTES,
                                                       backupCount=LOG_BACKUPS, encoding="utf-8")
    except OSError:
        return  # 記録を書けなくても、常駐処理は動かす
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    pip0_logger.addHandler(handler)
    pip0_logger.setLevel(logging.INFO)


def record_start_failure(config, reason):
    """起動できなかった理由を、状態のファイルに書く（画面のない起動でも、python -m pip0 status で分かるように）"""
    path = service.control_file(config, service.STATUS_FILE_NAME)
    if path is None:
        return
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fsutil.atomic_write_json(path, {"running": False, "error": reason, "updated_at": time.time()})
    except OSError:
        pass


# ----------------------------------------------------------------------
# status、stop、resume、shutdown
# ----------------------------------------------------------------------


def command_status(cli):
    config = cli["config"]
    say(cli, "pip0 の状態")
    for problem in config["CONFIG_ERRORS"]:
        say(cli, "設定の問題：" + problem)
    for warning in config["CONFIG_WARNINGS"]:
        say(cli, "設定の注意：" + warning)

    running = service.is_running(config)
    recorded = service.read_status_file(config)
    if running is None:
        say(cli, "常駐処理：確かめられません（データフォルダーが設定されていません。--data-dir で指定できます）")
    else:
        say(cli, "常駐処理：" + ("動いています" if running else "動いていません"))
    if not running and recorded and recorded.get("error"):
        say(cli, "  前回、起動できなかった理由：" + str(recorded["error"]))

    conn, problem = open_db(cli, create=False)
    try:
        engaged = killswitch.is_engaged(conn, config)
        if engaged:
            say(cli, "自動処理：止まっています（キルスイッチ。再開は python -m pip0 resume）")
        else:
            say(cli, "自動処理：動いてよい状態です（自動仕分け・自動改名・自動退避）")
        show_throttle(cli)
        if conn is not None:
            say(cli, f"解析の順番待ち：{analysis_queue.pending_count(conn, 'analyse')} 件")
        else:
            say(cli, "暗号化DB：" + problem)
    finally:
        if conn is not None:
            conn.close()

    manifests, unreadable = read_vault_manifests(config)
    counts = count_states(manifests)
    if manifests or unreadable:
        parts = [f"{vault.STATE_LABELS.get(state, state)} {count} 件" for state, count in sorted(counts.items())]
        if unreadable:
            parts.append(f"読めない manifest.json {unreadable} 件")
        say(cli, "保管庫：" + "、".join(parts))
    else:
        say(cli, "保管庫：項目はありません")
    progress = killswitch.read_progress(config)
    if progress is not None:
        state = "終わっています。" if progress.get("finished") else "途中です。"
        say(cli, "全復元：" + state + progress_line(progress))

    show_recorded_features(cli, recorded, running)
    return EXIT_OK


def show_throttle(cli):
    """高負荷の処理の条件（電源接続中かつ3分間無操作）を、今の値で表示する"""
    platform = cli["platform"]
    if platform is None and sys.platform == "win32":
        # 電源と無操作の時間は、pip0 シェルなしで直接読める（ゴーストとごみ箱は使わない）
        platform = platform_windows.WindowsPlatform(service.NoShellLink(), pip0_root=cli["config"]["PIP0_ROOT"])
    if platform is None:
        say(cli, "高負荷の処理の条件：この PC では、電源と無操作の時間を読み取れません（Windows だけ）。"
                 "条件を満たしたことにはしません")
        return
    state = throttle.check(platform, cli["config"])
    say(cli, "高負荷の処理（解析・退避）：" + ("今は実行できます" if state["allowed"] else "今は待機します"))
    say(cli, "  " + state["reason"])
    say(cli, "  （このコマンドを打つキー入力も「操作」なので、実行した直後は条件を満たしません）")


def show_recorded_features(cli, recorded, running):
    """常駐処理が記録した、機能ごとの状態（権限の不足などで使えない機能と、その理由）"""
    features = (recorded or {}).get("features")
    if not features:
        say(cli, "機能の状態：常駐処理の記録がありません")
        return
    when = local_time_text((recorded or {}).get("updated_at"))
    if running:
        say(cli, f"機能の状態（常駐処理の記録、{when}）：")
    else:
        say(cli, f"機能の状態（常駐処理が最後に記録したもの、{when}。今は動いていません）：")
    for feature in features:
        mark = "○" if feature.get("ok") else "×"
        label = feature.get("label") or feature.get("feature")
        reason = feature.get("reason") or ""
        say(cli, f"  {mark} {label}" + (f"：{reason}" if reason else ""))


def command_stop(cli):
    config = cli["config"]
    conn, problem = open_db(cli, create=False)
    try:
        result = killswitch.engage(conn, config, "コマンド（python -m pip0 stop）", actor="user")
    finally:
        if conn is not None:
            conn.close()
    if not result["ok"]:
        say(cli, "自動処理を止められませんでした：" + result["reason"])
        return EXIT_FAILED
    say(cli, "自動処理を止めました（新しい自動仕分け・自動改名・自動退避を始めません。"
             "退避したファイルの復元はしません）。")
    if not result["database"]:
        say(cli, "  注意：DB には記録できませんでした（" + (result["reason"] or problem) + "）。"
                 "停止の印のファイルで止めています。")
    say(cli, "再開するときは python -m pip0 resume を実行します。"
             "退避したファイルも戻すときは python -m pip0 restore-all です。")
    return EXIT_OK


def command_resume(cli):
    args = cli["args"]
    config = cli["config"]
    if not args.yes:
        say(cli, "止めた自動処理（自動仕分け・自動改名・自動退避）を再開しますか？")
        say(cli, f"再開するときは「{RESUME_ANSWER}」と入力して Enter を押してください。")
        flush(cli)
        answer = read_answer()
        if answer.strip() != RESUME_ANSWER:
            say(cli, "再開しませんでした（自動処理は止まったままです）。")
            return EXIT_FAILED
    conn, problem = open_db(cli, create=True)
    if conn is None:
        say(cli, "DB を開けないため、再開を記録できません（自動処理は止まったままです）：" + problem)
        return EXIT_FAILED
    try:
        result = killswitch.resume(conn, config, confirmed=True)
    finally:
        conn.close()
    if not result["ok"]:
        say(cli, "再開しませんでした：" + result["reason"])
        return EXIT_FAILED
    say(cli, "自動処理を再開しました。")
    return EXIT_OK


def read_answer():
    """確認の答えを1行読む（入力がない・読めないときは空。空は「再開しない」になる）"""
    if sys.stdin is None:
        return ""
    try:
        return sys.stdin.readline()
    except (OSError, ValueError):
        return ""


def flush(cli):
    try:
        cli["out"].flush()
    except (AttributeError, OSError, ValueError):
        pass


def command_shutdown(cli):
    config = cli["config"]
    running = service.is_running(config)
    if not running:
        say(cli, "pip0 の常駐処理は動いていません。")
        return EXIT_OK
    result = service.request_shutdown(config)
    if not result["ok"]:
        say(cli, "終了を依頼できませんでした：" + result["reason"])
        return EXIT_FAILED
    say(cli, "pip0 の常駐処理に終了を依頼しました。終わるのを待っています…")
    flush(cli)
    deadline = time.time() + SHUTDOWN_WAIT_SECONDS
    while time.time() < deadline:
        if service.is_running(config) is False:
            say(cli, "pip0 の常駐処理が終了しました。")
            return EXIT_OK
        time.sleep(min(PROGRESS_POLL_SECONDS, 0.5))
    say(cli, f"{SHUTDOWN_WAIT_SECONDS:.0f} 秒待っても終わりませんでした。"
             "通知領域の pip0 のアイコンの「終了」を試してください。")
    return EXIT_FAILED


# ----------------------------------------------------------------------
# restore-all、vault
# ----------------------------------------------------------------------


def command_restore_all(cli):
    config = cli["config"]
    if config.get("CONTROL_DIR") is None:
        say(cli, "データフォルダー（DATA_DIR）が設定されていないため、全復元できません（--data-dir で指定できます）。")
        return EXIT_UNAVAILABLE
    say(cli, "pip0 の全復元：自動処理を止めて、保管庫に退避したファイルを元の場所に戻します。")
    say(cli, "戻すのは pip0 が退避したファイルだけです（自動仕分け・自動改名は戻しません）。")
    if service.is_running(config):
        return restore_all_by_request(cli)
    if cli["platform"] is None and sys.platform != "win32":
        return explain_restore_without_windows(cli)
    return restore_all_directly(cli)


def restore_all_by_request(cli):
    """常駐処理が動いているとき：全復元を依頼し、進み具合（件数）を表示する"""
    config = cli["config"]
    requested_at = time.time()
    result = killswitch.request_restore_all(config, now=requested_at)
    if not result["ok"]:
        say(cli, "全復元を依頼できませんでした：" + result["reason"])
        return EXIT_FAILED
    say(cli, "動いている pip0 に全復元を依頼しました（自動処理は止めました）。進み具合を表示します。")
    flush(cli)
    last_line = None
    while True:
        progress = killswitch.read_progress(config)
        if progress is not None and is_after(progress.get("updated_at"), requested_at):
            line = progress_line(progress)
            if line != last_line:
                say(cli, line)
                flush(cli)
                last_line = line
            if progress.get("finished"):
                return finish_restore_report(cli, progress)
        if not service.is_running(config):
            say(cli, "全復元が終わる前に、pip0 の常駐処理が終わりました。"
                     "もう一度 python -m pip0 restore-all を実行すると、残りから続けます。")
            return EXIT_FAILED
        time.sleep(PROGRESS_POLL_SECONDS)


def is_after(value, moment):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value >= moment


def restore_all_directly(cli):
    """常駐処理が動いていないとき：pip0 シェルを画面なし（--headless）で起動して、自分で全復元する"""
    config = cli["config"]
    lock = hold_lock(cli)
    if lock is None:
        say(cli, BUSY_REASON + "もう一度 python -m pip0 restore-all を実行してください。")
        return EXIT_FAILED
    try:
        prepared = prepare_platform(cli, headless=True)
        if not prepared["ok"]:
            say(cli, "pip0 シェルを起動できないため、全復元できません：" + prepared["reason"])
            say(cli, "退避したファイルは保管庫に残っています。手で取り出す方法は、保管庫の README.txt にあります。")
            return EXIT_FAILED
        try:
            conn, note = open_db_or_manifests(cli)
            if conn is None:
                say(cli, "全復元に必要な DB を用意できません：" + note)
                return EXIT_FAILED
            if note:
                say(cli, note)
            try:
                counts = killswitch.restore_all(conn, prepared["platform"], config,
                                                progress=lambda counts: say(cli, progress_line(counts)))
            finally:
                conn.close()
        finally:
            release_platform(prepared)
    finally:
        lock.release()
    return finish_restore_report(cli, counts)


def explain_restore_without_windows(cli):
    """Windows 以外：ゴーストは Windows の pip0 専用フォルダーにしかないので、保管庫の一覧を見せて説明する"""
    manifests, unreadable = read_vault_manifests(cli["config"])
    say(cli, WINDOWS_ONLY)
    say(cli, "ゴースト（退避したファイル）は、Windows の pip0 専用フォルダーにしか作られません。")
    if not manifests and not unreadable:
        say(cli, "この保管庫に項目はありません。")
    for manifest in manifests:
        say(cli, f"  {manifest['item_id']}  {vault.STATE_LABELS.get(manifest['state'], manifest['state'])}"
                 f"  {manifest.get('current_path')}")
    if unreadable:
        say(cli, f"  読めない manifest.json が {unreadable} 件あります")
    return EXIT_UNAVAILABLE


def progress_line(counts):
    """全復元の件数を1行の文にする"""
    total = counts.get("total", 0)
    remaining = counts.get("remaining", 0)
    return (f"全 {total} 件中 {total - remaining} 件：復元 {counts.get('restored', 0)}、"
            f"衝突 {counts.get('conflict', 0)}、開いた後に変更 {counts.get('local_newer', 0)}、"
            f"見つからない {counts.get('missing', 0)}、失敗 {counts.get('failed', 0)}、"
            f"すでに戻っていた {counts.get('already', 0)}、残り {remaining}")


def finish_restore_report(cli, counts):
    """全復元の結果をまとめて表示し、終了コードを決める（すべて戻せたときだけ 0）"""
    say(cli, "結果：" + progress_line(counts))
    if counts.get("conflict"):
        say(cli, "・衝突：元の場所に別のファイルがあったため、上書きせず、横に「(pip0復元)」を付けた名前で戻しました。")
    if counts.get("missing"):
        say(cli, "・見つからない：ゴーストが移動・削除されていました。中身は保管庫に残っています"
                 "（python -m pip0 vault list、保管庫の README.txt）。")
    if counts.get("failed") or counts.get("remaining"):
        say(cli, "・失敗・残り：保管庫の中身はそのままです。"
                 "もう一度 python -m pip0 restore-all を実行すると、続きから試します。")
    say(cli, "自動処理は止まったままです（再開するときは python -m pip0 resume）。")
    complete = (counts.get("finished") is True and not counts.get("failed") and not counts.get("missing")
                and not counts.get("remaining"))
    return EXIT_OK if complete else EXIT_FAILED


def command_vault(cli):
    args = cli["args"]
    if args.vault_command == "list":
        return vault_list(cli)
    if args.vault_command == "restore":
        return vault_restore(cli)
    say(cli, "使い方：python -m pip0 vault list ／ python -m pip0 vault restore <項目ID>")
    return EXIT_UNAVAILABLE


def vault_list(cli):
    conn, note = open_db_or_manifests(cli)
    if conn is None:
        say(cli, "保管庫の一覧を読めません：" + note)
        return EXIT_FAILED
    try:
        items = vault.list_items(conn)
    finally:
        conn.close()
    if note:
        say(cli, note)
    if not items:
        say(cli, "保管庫に項目はありません。")
        return EXIT_OK
    say(cli, f"保管庫の項目：{len(items)} 件")
    for item in items:
        say(cli, f"  {item['item_id']}  {vault.STATE_LABELS.get(item['state'], item['state'])}")
        say(cli, f"      場所：{item['current_path']}")
        if item.get("restored_path") and item["restored_path"] != item["current_path"]:
            say(cli, f"      戻した場所：{item['restored_path']}")
        say(cli, f"      大きさ：{format_size(item['size'])}、最後の変化：{local_time_text(item['updated_at'])}")
    return EXIT_OK


def vault_restore(cli):
    config = cli["config"]
    item_id = vault.normalise_item_id(cli["args"].item_id)
    if not vault.is_valid_item_id(item_id):
        say(cli, "項目ID の形が正しくありません（32桁の16進数です。python -m pip0 vault list で確かめられます）。")
        return EXIT_UNAVAILABLE
    if cli["platform"] is None and sys.platform != "win32":
        say(cli, WINDOWS_ONLY + "ゴーストは Windows の pip0 専用フォルダーにしかありません。")
        return EXIT_UNAVAILABLE
    lock = hold_lock(cli)
    if lock is None:
        say(cli, BUSY_REASON + "全復元（python -m pip0 restore-all）を使うか、pip0 を終了してから実行してください。")
        return EXIT_FAILED
    try:
        prepared = prepare_platform(cli, headless=True)
        if not prepared["ok"]:
            say(cli, "pip0 シェルを起動できないため、戻せません：" + prepared["reason"])
            return EXIT_FAILED
        try:
            conn, note = open_db_or_manifests(cli)
            if conn is None:
                say(cli, "DB を用意できないため、戻せません：" + note)
                return EXIT_FAILED
            if note:
                say(cli, note)
            try:
                result = vault.restore(conn, prepared["platform"], item_id, config, actor="user")
            finally:
                conn.close()
        finally:
            release_platform(prepared)
    finally:
        lock.release()
    label = vault.STATE_LABELS.get(result["state"], result["state"] or "不明")
    say(cli, f"項目 {item_id}：{label}")
    if result["reason"]:
        say(cli, "  " + result["reason"])
    if result["ok"] and result["path"]:
        say(cli, f"  場所：{result['path']}")
    return EXIT_OK if result["ok"] else EXIT_FAILED


# ----------------------------------------------------------------------
# search、delete
# ----------------------------------------------------------------------


def command_search(cli):
    text = " ".join(cli["args"].words)
    conn, problem = open_db(cli, create=False)
    if conn is None:
        say(cli, "検索できません：" + problem)
        return EXIT_FAILED
    try:
        result = search.search(conn, text, time.time(), cli["config"], cli["rules"])
    finally:
        conn.close()
    show_search_result(cli, text, result)
    return EXIT_OK if result["status"] == "found" else EXIT_FAILED


def show_search_result(cli, text, result):
    status = demo_data.STATUS_LABELS.get(result["status"], result["status"])
    say(cli, f"検索「{text}」：{status}（一致 {len(result['results'])} 件）")
    for item in result["results"]:
        say(cli, f"  ・{item['name']}　{item['path']}")
        for reason in item["reasons"]:
            say(cli, f"      {reason}")
    for item in result["partial_results"]:
        say(cli, f"  ・（一部一致）{item['name']}　{item['path']}")
        for reason in item["reasons"]:
            say(cli, f"      一致した：{reason}")
        for unmatched in item["unmatched"]:
            mark = "（情報不足）" if unmatched.get("missing_info") else ""
            say(cli, f"      一致しない{mark}：{unmatched['reason']}")
    for note in result["notes"]:
        say(cli, f"  ※ {note}")


def command_delete(cli):
    config = cli["config"]
    paths = [os.path.abspath(path) for path in cli["args"].paths]
    if cli["platform"] is None and sys.platform != "win32":
        say(cli, WINDOWS_ONLY)
        say(cli, "削除は、pip0 シェルの確認画面で承認したときだけ、ごみ箱へ移します。"
                 "ほかの方法で削除することはしません。")
        return EXIT_UNAVAILABLE
    lock = hold_lock(cli)
    if lock is None:
        say(cli, BUSY_REASON + "pip0 を終了してから実行してください。")
        return EXIT_FAILED
    try:
        conn, problem = open_db(cli, create=True)
        if conn is None:
            say(cli, "DB を開けないため、削除の記録を残せません。何も削除していません：" + problem)
            return EXIT_FAILED
        try:
            prepared = prepare_platform(cli, headless=False)  # 確認画面を出すので、画面ありで起動する
            if not prepared["ok"]:
                say(cli, "削除の確認画面を出せないため、何も削除していません（ほかの方法で削除することはしません）："
                         + prepared["reason"])
                return EXIT_FAILED
            try:
                request = trash.prepare_deletion(conn, paths, config, prepared["platform"])
                return delete_files(cli, conn, prepared["platform"], request)
            finally:
                release_platform(prepared)
        finally:
            conn.close()
    finally:
        lock.release()


def delete_files(cli, conn, platform, request):
    """削除の依頼を表示し、確認画面で承認されたものだけをごみ箱へ移す。終了コードを返す"""
    for item in request["problems"]:
        say(cli, f"  削除しないもの：{item['name']}（{item['problem']}）")
    if request["count"] == 0:
        say(cli, "ごみ箱へ移せるファイルがありません。何も削除していません。")
        return EXIT_FAILED
    say(cli, f"{request['count']} 件（{format_size(request['total_bytes'])}）について、確認画面を出します。"
             "承認したときだけ、ごみ箱へ移します。")
    flush(cli)
    result = trash.delete_with_confirmation(conn, platform, request)
    labels = {"recycled": "ごみ箱へ移しました", "refused": "ごみ箱を使えないため、削除しませんでした",
              "failed": "失敗しました", "not_attempted": "何もしていません"}
    for item, outcome in zip(request["items"], result["results"], strict=True):
        reason = f"（{outcome['reason']}）" if outcome.get("reason") else ""
        say(cli, f"  {item['name']}：{labels.get(outcome['status'], outcome['status'])}{reason}")
    if result["answer"] in ("cancel", "closed"):
        say(cli, "確認画面で承認されなかったため、何も削除していません。")
    elif result["answer"] == "unavailable":
        say(cli, "確認画面を出せなかったため、何も削除していません。")
    all_recycled = result["summary"]["recycled"] == len(request["items"])
    return EXIT_OK if all_recycled else EXIT_FAILED


# ----------------------------------------------------------------------
# demo
# ----------------------------------------------------------------------


def command_demo(cli):
    config = cli["config"]
    protected = [config.get("DOWNLOADS_DIR"), config.get("PIP0_ROOT"), config.get("DATA_DIR")]
    protected += list(config.get("EXTRA_INDEX_DIRS") or [])
    report = demo_data.run_demo(target_dir=cli["args"].dir, rules=cli["rules"],
                                protected=[folder for folder in protected if folder])
    lines = demo_data.report_lines(report)
    if report["load"] is not None and report["load"].get("ok"):
        # M1 の改名の提案を、最後の「結果：…」の行（と、その前の空行）の前に入れる
        lines = lines[:-2] + naming_example_lines(report, cli["rules"]) + lines[-2:]
    for line in lines:
        say(cli, line)
    return EXIT_OK if report["ok"] else EXIT_FAILED


def naming_example_lines(report, rules):
    """M1 の改名の提案（「日付_内容_送信元」）を、デモのダミーのファイルで試した結果の行

    ダウンロードフォルダーの代わりのフォルダーにある、意味の分からない名前のファイルについて、
    文書のタイトルを軽く読み（analyse_text.light_metadata）、まねた入手経路の記録（demo_data の記録）から送信元を決め、
    タイトルがなければ、まねた条件（電源接続中・180秒無操作）で解析してから、naming.propose_name で名前を考えます。
    仕分け先は inflow の点数の決まりで決まりますが、ここでは名前だけを見せます。ファイルは動かしません。
    """
    target = Path(report["target_dir"])
    lines = ["", "M1 の改名の提案（意味の分からない名前のダミーのファイル。ファイルは動かしません）"]
    try:
        manifest = fsutil.read_json(target / demo_data.MANIFEST_NAME)
    except (OSError, ValueError):
        lines.append("  ダミーのファイルの一覧を読めませんでした")
        return lines
    config = config_module.load_config(overrides=demo_data.demo_config_overrides(target), read_user_file=False)
    platform = platform_fake.FakePlatform(idle_seconds=config["HEAVY_IDLE_SECONDS"], power="ac")
    gate = throttle.HeavyGate(platform, config)
    for entry in manifest.get("files", []):
        if entry.get("folder") != "Downloads":
            continue
        stem = safe_names.split_ext(entry["name"])[0]
        if not naming.is_meaningless(stem, rules)[0]:
            continue
        light = analyse_text.light_metadata(entry["path"], platform, config, rules)
        source, completed_at = demo_source(entry, rules)
        analysis = None
        if light.get("status") != "done" or not light.get("title"):
            result = analysis_queue.analyse_file(entry["path"], platform, config, rules, gate.should_continue)
            if result.get("status") in naming.ANALYSIS_FINISHED_STATES:
                analysis = result
        name = naming.propose_name(entry["name"], light, source, completed_at, analysis, config, rules)
        if name["status"] == "ready":
            lines.append(f"  ・{entry['name']} → {name['new_name']}")
        else:
            lines.append(f"  ・{entry['name']}：名前はそのまま（{name['reason']}）")
        evidence = name["evidence"]
        if evidence["content"]:
            lines.append(f"      内容：{evidence['content']}")
        if evidence["source"]:
            lines.append(f"      送信元：{evidence['source']}")
    lines.append("  ※ 日付はダウンロード完了日（記録がなければ最終更新日時で代わりにしています）。"
                 "送信元の記録がなければ「送信元不明」です")
    return lines


def demo_source(entry, rules):
    """デモのファイルの、まねた入手経路の記録から送信元を決める。(送信元の辞書, 完了の時刻)"""
    record = entry.get("provenance")
    if record is not None and record.get("kind") == "browser_extension":
        event = {"url": record["url"], "final_url": record["url"], "referrer_url": record["referrer_url"],
                 "ended_at": record["ended_at"]}
        return provenance.determine_source(event, None, rules), record["ended_at"]
    zone = None
    if record is not None and record.get("kind") == "zone_identifier":
        zone = provenance.parse_zone_identifier(record["zone_identifier"])
    return provenance.determine_source(None, zone, rules), entry["modified_at"]


# ----------------------------------------------------------------------
# register-root、unregister-root
# ----------------------------------------------------------------------


def command_register_root(cli):
    config = cli["config"]
    if config.get("PIP0_ROOT") is None:
        say(cli, "pip0 専用フォルダー（PIP0_ROOT）が設定されていません（--pip0-root で指定できます）。")
        return EXIT_UNAVAILABLE
    if service.is_running(config):
        # 常駐処理は、起動のたび（とシェルを起動し直すたび）に登録とつなぐことを行っている
        recorded = service.read_status_file(config) or {}
        entry = next((feature for feature in recorded.get("features") or [] if feature.get("feature") == "sync_root"),
                     None)
        say(cli, "pip0 の常駐処理が動いているため、登録は常駐処理が行っています（起動のたびに確かめます）。")
        if entry is None:
            say(cli, "まだ結果の記録がありません。少し待ってから python -m pip0 status で確かめてください。")
            return EXIT_FAILED
        if entry.get("ok"):
            say(cli, "pip0 専用フォルダーは同期ルートとして登録され、つながっています。")
            return EXIT_OK
        say(cli, "登録できていません：" + (entry.get("reason") or "理由は分かりません"))
        return EXIT_FAILED
    if cli["platform"] is None and sys.platform != "win32":
        say(cli, WINDOWS_ONLY)
        return EXIT_UNAVAILABLE
    lock = hold_lock(cli)
    if lock is None:
        say(cli, BUSY_REASON)
        return EXIT_FAILED
    try:
        prepared = prepare_platform(cli, headless=True)
        if not prepared["ok"]:
            say(cli, "pip0 シェルを起動できないため、登録できません：" + prepared["reason"])
            return EXIT_FAILED
        try:
            result = service.register_pip0_root(prepared["platform"], config)
        finally:
            release_platform(prepared)
    finally:
        lock.release()
    if not result["ok"]:
        say(cli, "登録できませんでした：" + result["reason"])
        return EXIT_FAILED
    say(cli, "pip0 専用フォルダーを同期ルートとして登録しました"
             "（エクスプローラーで、状態のアイコンが付くことがあります）。")
    return EXIT_OK


def command_unregister_root(cli):
    config = cli["config"]
    if config.get("PIP0_ROOT") is None:
        say(cli, "pip0 専用フォルダー（PIP0_ROOT）が設定されていないため、解除するものはありません。")
        return EXIT_OK
    # ゴーストが残っている（かもしれない）項目があれば解除しない
    # （manifest.json を読むので、DB の鍵がなくても確かめられる）
    manifests, unreadable = read_vault_manifests(config)
    blocking = [manifest for manifest in manifests if manifest["state"] in vault.GHOST_STATES]
    if blocking or unreadable:
        say(cli, f"退避中（ゴーストがある、またはその途中）の項目が {len(blocking)} 件"
                 + (f"、読めない manifest.json が {unreadable} 件" if unreadable else "")
                 + "あるため、解除しません。先に python -m pip0 restore-all で戻してください。")
        return EXIT_FAILED
    missing = [manifest for manifest in manifests if manifest["state"] == "ghost_missing"]
    if missing:
        say(cli, f"注意：ゴーストが見つからない項目が {len(missing)} 件あります（中身は保管庫に残っています）。")
    if cli["platform"] is None and sys.platform != "win32":
        say(cli, WINDOWS_ONLY)
        return EXIT_UNAVAILABLE
    lock = hold_lock(cli)
    if lock is None:
        say(cli, BUSY_REASON + "pip0 を終了してから実行してください（python -m pip0 shutdown）。")
        return EXIT_FAILED
    try:
        prepared = prepare_platform(cli, headless=True)
        if not prepared["ok"]:
            say(cli, "pip0 シェルを起動できないため、解除できません：" + prepared["reason"])
            return EXIT_FAILED
        try:
            platform = prepared["platform"]
            if not hasattr(platform, "unregister_sync_root"):
                say(cli, "この OS 連携では、同期ルートの登録を解除できません。")
                return EXIT_UNAVAILABLE
            result = platform.unregister_sync_root(config["PIP0_ROOT"])
        finally:
            release_platform(prepared)
    finally:
        lock.release()
    if not result["ok"]:
        say(cli, "解除できませんでした：" + (result["reason"] or "理由は分かりません"))
        return EXIT_FAILED
    say(cli, "pip0 専用フォルダーの同期ルートの登録を解除しました。" + (result["reason"] or ""))
    return EXIT_OK


# ----------------------------------------------------------------------
# check-encryption、check-network
# ----------------------------------------------------------------------


def command_check_encryption(cli):
    config = cli["config"]
    conn, problem = open_db(cli, create=False)
    if conn is None:
        say(cli, "DB を開けません：" + problem)
        return EXIT_FAILED
    try:
        state = database.check_encryption(conn)
    finally:
        conn.close()
    header_plain = file_starts_with(config["DB_PATH"], b"SQLite format 3\x00")
    say(cli, f"SQLCipher の版：{state['cipher_version'] or 'なし'}")
    say(cli, f"一時領域：{'メモリー（temp_store=2）' if state['temp_store'] == 2 else state['temp_store']}")
    say(cli, f"ジャーナル：{state['journal_mode']}（WAL も同じ鍵で暗号化されます）")
    say(cli, "DB ファイルの先頭：" + ("平文の SQLite の印があります（暗号化されていません）" if header_plain
                                      else "平文の SQLite の印はありません（暗号化されています）"))
    ok = bool(state["cipher_version"]) and state["temp_store"] == 2 and not header_plain
    say(cli, "結果：" + ("暗号化されています" if ok else "問題があります"))
    return EXIT_OK if ok else EXIT_FAILED


def file_starts_with(path, prefix):
    try:
        with open(path, "rb") as f:
            return f.read(len(prefix)) == prefix
    except OSError:
        return False


def command_check_network(cli):
    """外部通信の禁止（監査フック）を、このプロセスに入れて確かめる

    python -m pip0 check-network は、それ自体が別のプロセスなので、
    入れた監査フックは、このコマンドの終わりとともに消えます。
    """
    netguard.install([str(cli["config"]["SHELL_EXE"])])
    result = netguard.self_check()
    say(cli, "外部通信の禁止（pip0 のプロセスの中の層・監査フック）の確認")
    for check in result["checks"]:
        say(cli, f"  {'○' if check['blocked'] else '×'} {check['name']}：{check['detail']}")
    say(cli, "結果：" + ("すべて止まりました" if result["ok"] else result["reason"]))
    say(cli, "※ OS のファイアウォールによる遮断は、別に確かめます"
             "（scripts\\network-policy.ps1 -Check と -Test、docs/network.md）。")
    return EXIT_OK if result["ok"] else EXIT_FAILED


COMMANDS = {
    "serve": command_serve,
    "status": command_status,
    "stop": command_stop,
    "restore-all": command_restore_all,
    "resume": command_resume,
    "search": command_search,
    "delete": command_delete,
    "vault": command_vault,
    "demo": command_demo,
    "register-root": command_register_root,
    "unregister-root": command_unregister_root,
    "check-encryption": command_check_encryption,
    "check-network": command_check_network,
    "shutdown": command_shutdown,
}
