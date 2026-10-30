"""常駐処理（python -m pip0 serve の本体）

pip0 本体の「メインループ」です。pip0 シェル（C#）の知らせ、フォルダーの監視の知らせ、ブラウザー拡張の記録、
時間の経過を受け取り、それぞれの機能のモジュールに渡して、返ってきた「すること」を、
画面（ui）や OS 連携（platform）へ伝えます。
判断の中身は、それぞれのモジュール（inflow.py、desk.py、hazard.py、vault.py など）にあります。
このファイルは、それらをつなぐ役です。

    pip0 シェル ──知らせ──▶ receive_event（シェルの読み取りのスレッド。順番待ちに入れるだけ）
    フォルダーの監視 ──知らせ──▶ file_events（watchdog のスレッド。順番待ちに入れるだけ）
                                      ▼
    step(now)：メインのスレッドが LOOP_SECONDS（0.1秒）ごとに呼ぶ
      1. シェルの知らせ（handle_event）と、フォルダーの知らせ（handle_file_event）を、届いた順に処理する。
         pip0 シェルが落ちていれば、決めた間隔で起動し直す（本体は動き続ける）
      2. 制御用のファイル（全復元の依頼、終了の依頼、停止の印）を確かめる
      3. ダウンロードの完了を確かめ、M1 の提案を作り、ミニドックの時間を進める
         （シェルが落ちていてミニドックが見えない間は、提案を待たせ、見えないまま自動で動かさない）
      4. 浮上式デスク（M2）の再表示、ゴーストを開いた後の通常のファイルへの戻し（M4）など、時間で決まることを行う
      5. 条件（電源接続中かつ3分間無操作）を満たせば、高負荷の処理（解析・退避）を1つだけワーカーのスレッドに渡す
      6. 状態（ui.status）を、画面と CONTROL_DIR/service.status.json に知らせる

スレッドの約束（docs/design.md 5-1）
- DB への書き込みは、メインのスレッドだけが行う。ワーカーのスレッド（1つだけ）は、解析（DB を使わない）と、
  退避（vault.evacuate。状態が変わるたびに manifest.json と DB を書くため、そのスレッド専用の DB の接続を使う）を行う
- シェルの知らせは、シェルの読み取りのスレッドから届くので、順番待ち（queue）に入れるだけにする。
  ただし、キルスイッチと終了は、合図（threading.Event）だけ先に立てて、実行中の高負荷の処理を次の区切りで止める
- テストでは start_threads=False にすると、スレッドを使わず、step の中で高負荷の処理を1つずつ行う
  （結果が毎回同じになる）

キルスイッチ（docs/design.md 4-9）
- 押されたら、すぐに停止の印と DB の設定を書き（killswitch.engage）、ワーカーを次の区切りで止める
- ワーカーが止まってから、メインのスレッドで killswitch.restore_all を行い、1件ごとに進み具合を画面に出す。
  全復元の間は、ほかの知らせの処理を待たせる（件数が多いと時間がかかる。途中で終了しても、次の起動で残りから続ける）
- 自動処理は、ユーザーが確認して再開するまで止まったまま（勝手に再開しない）

ログには、処理の種類、件数、エラーの種類、項目ID だけを書きます
（ファイル名、パス、本文、URL、ウィンドウタイトルは書かない）。
"""

import logging
import os
import queue
import statistics
import sys
import threading
import time
import traceback
import uuid
from pathlib import Path

from pip0 import (analysis_queue, context, database, desk, evacuation, fsutil, hazard, inflow, killswitch,
                  netguard, provenance, scanner, shell_link, throttle, usage, vault, watcher)
from pip0 import config as config_module

logger = logging.getLogger(__name__)

# ----------------------------------------------------------------------
# 決まりの値（★間隔と待ち時間。settings.py の LOOP_SECONDS、DOWNLOAD_POLL_SECONDS、SCAN_MINUTES、
#   EVACUATE_CHECK_HOURS、RESTORE_AFTER_OPEN_SECONDS も使います）
# ----------------------------------------------------------------------

CONTROL_POLL_SECONDS = 1.0       # 制御用のファイル（全復元の依頼、終了の依頼、停止の印）を確かめる間隔
STATUS_SECONDS = 2.0             # 状態（ui.status）を作り直す、最も短い間隔
STATUS_FILE_SECONDS = 5.0        # 状態のファイル（CONTROL_DIR/service.status.json）を書く、最も短い間隔
EXPIRE_EVENTS_SECONDS = 3600.0   # 古いダウンロードの記録を期限切れにする間隔
SHELL_RESTART_DELAYS = [2, 5, 15, 30, 60]  # pip0 シェルが終わったとき、起動し直すまでの秒数（失敗が続くと長くする）
INIT_TIMEOUT_SECONDS = 30        # pip0 シェルの準備（init）の答えを待つ秒数
SHELL_REQUEST_TIMEOUT_SECONDS = 30  # ファイルを開く等の要求の答えを待つ秒数
NOTIFY_DELETE_CHECK_SECONDS = 2.0   # 「ゴーストが削除された」の知らせの後、確かめるまで待つ秒数
REOPEN_RETRY_SECONDS = 120.0     # 開いた後のゴーストを通常のファイルに戻せなかったとき（使用中など）の、やり直しの間隔
REOPEN_MAX_ATTEMPTS = 30         # その、やり直しの最大の回数
RESTORE_RETRY_SECONDS = 60.0     # 全復元が途中で止まったとき、続きを試すまでの秒数
# 起動から、最初に退避の候補を探すまでの秒数（シェルの「最近使ったファイル」の知らせを、先に受け取るため）
FIRST_EVACUATION_CHECK_SECONDS = 600.0
WORKER_STOP_SECONDS = 30.0       # 終了のとき、ワーカーのスレッドが区切りで止まるのを待つ秒数
FETCH_TIMES_KEPT = 50            # ゴーストを開いたときの応答時間（ミリ秒）を、何件まで覚えておくか
DESKS_KEPT = 10                  # デスクに出した候補を、何回分まで覚えておくか（ボタンの確かめに使う）
HELD_DOWNLOADS_KEPT = 50         # pip0 シェル（画面）が動いていない間に完了したダウンロードを、何件まで待たせるか
ERROR_LOG_SECONDS = 60.0         # 同じ種類の予想外のエラーを、ログに書く最も短い間隔
TEXT_MAX_CHARS = 300             # 画面と状態のファイルに出す理由の、最大の文字数

PROTOCOL_VERSION = 1             # docs/ipc-protocol.md の版
SYNC_ROOT_DISPLAY_NAME = "pip0"  # エクスプローラーに出る同期ルートの名前
MAX_WATCHED_ROOTS = 64           # init で知らせる「最近使ったファイル」の対象フォルダーの最大数

# 制御用のファイル（CONTROL_DIR と LOCK_DIR の中。パスやファイル名は書かない）
LOCK_FILE_NAME = "service.lock"
STATUS_FILE_NAME = "service.status.json"
SHUTDOWN_REQUEST_NAME = "shutdown.request.json"

ALREADY_RUNNING_REASON = "pip0 の常駐処理は、すでに動いています（2つ目は起動しません）"
NO_SHELL_REASON = ("pip0 シェルなしで動いています（開発用の --no-shell）。"
                   "画面の表示、ゴースト、ごみ箱、作業文脈とドラッグの検知は使えません")

# 機能の名前（feature）と、画面に出す日本語の名前（★表示を変えたいときは、ここを直します）
FEATURE_LABELS = {
    # pip0 本体（Python）が調べる機能
    "shell": "pip0 シェル（画面と OS 連携）",
    "sync_root": "pip0 専用フォルダーの同期ルート（ゴーストの置き場所）",
    "folder_watcher": "フォルダーの監視（ダウンロードの完了）",
    "scan": "対象フォルダーの見直し（索引）",
    "vault_check": "保管庫の起動時の点検",
    "service_loop": "常駐処理のメインループ",
    # pip0 シェル（C#）が feature.status で知らせる機能
    "cloud_files": "ゴースト（Cloud Files API）",
    "recycle_bin": "ごみ箱への移動",
    "foreground_hook": "前面ウィンドウの監視",
    "mouse_hook": "ドラッグの検知",
    "cursor_sampler": "マウスの位置（シェイクの判定）",
    "uia": "ファイルダイアログ（UI Automation）",
    "explorer_selection": "エクスプローラーの選択項目",
    "recent_items": "最近使ったファイル",
    "session_events": "ロック・スリープの検知",
}
CORE_FEATURES = ["shell", "sync_root", "folder_watcher", "scan", "vault_check", "service_loop"]


# ----------------------------------------------------------------------
# pip0 シェルの準備（CLI の restore-all なども使う）
# ----------------------------------------------------------------------


def init_payload(config, headless):
    """pip0 シェルへ最初に送る init の内容（docs/ipc-protocol.md 2節）"""
    root = config.get("PIP0_ROOT")
    vault_dir = config.get("VAULT_DIR")
    payload = {
        "protocol": PROTOCOL_VERSION,
        "vault_dir": str(vault_dir) if vault_dir is not None else None,
        "pip0_root": str(root) if root is not None else None,
        "sync_root_display_name": SYNC_ROOT_DISPLAY_NAME,
        "headless": bool(headless),
        "settings": {
            "desk_approach_px": config["DESK_APPROACH_PX"],
            "desk_transparent_opacity": config["DESK_TRANSPARENT_OPACITY"],
            "cursor_sample_ms": config["CURSOR_SAMPLE_MS"],
            "cursor_batch_ms": config["CURSOR_BATCH_MS"],
            "hazard_border_px": config["HAZARD_BORDER_PX"],
            "mini_dock_max_rows": config["MINI_DOCK_MAX_ROWS"],
        },
    }
    # 「最近使ったファイル」を知らせてもらう範囲：解析・検索の対象フォルダー
    # （なければ、シェルは pip0 専用フォルダーだけを見る）
    roots = [str(folder) for folder, _kind in config_module.index_folders(config) if folder is not None]
    if roots:
        payload["watched_roots"] = roots[:MAX_WATCHED_ROOTS]
    return payload


def register_pip0_root(platform, config):
    """pip0 専用フォルダーを作り（なければ）、同期ルートとして登録してつなぐ。{"ok", "reason"}

    platform.register_sync_root は、登録済みならつなぐ（cf.connect）だけなので、何度呼んでもよい
    （シェルを起動し直すたびに呼ぶ）。
    """
    root = config.get("PIP0_ROOT")
    if root is None:
        return {"ok": False, "reason": "pip0 専用フォルダー（PIP0_ROOT）が設定されていません"}
    try:
        Path(root).mkdir(parents=True, exist_ok=True)  # pip0 シェルはフォルダーを作らないため、先に作る
    except OSError as error:
        return {"ok": False, "reason": f"pip0 専用フォルダーを作れませんでした（{type(error).__name__}）"}
    result = platform.register_sync_root(root, SYNC_ROOT_DISPLAY_NAME)
    return {"ok": result.get("ok") is True, "reason": short_text(result.get("reason"))}


def connect_shell(link, platform, config, headless):
    """pip0 シェルを起動し、init を送り、pip0 専用フォルダーを同期ルートとしてつなぐ

    戻り値：{"ok", "reason", "shell_version", "capabilities", "sync_root": {"ok", "reason"}}
    ok はシェルを起動して init が通ったかどうか。同期ルートの結果は sync_root に別に入れる
    （同期ルートが使えなくても、ほかの機能は使えるため）。
    """
    result = {"ok": False, "reason": "", "shell_version": None, "capabilities": None,
              "sync_root": {"ok": False, "reason": "pip0 シェルが動いていないため、つなげません"}}
    started = link.start()
    if not started.get("ok"):
        result["reason"] = "pip0 シェルを起動できませんでした（" + short_text(started.get("reason")) + "）"
        return result
    try:
        reply = link.request("init", init_payload(config, headless), timeout=INIT_TIMEOUT_SECONDS)
    except shell_link.ShellError as error:
        # 準備のできていないシェルは止める（次に起動し直すときに、最初からやり直すため）
        link.stop()
        result["reason"] = f"pip0 シェルの準備（init）ができませんでした（{error.code}）"
        return result
    result["ok"] = True
    result["shell_version"] = short_text(reply.get("shell_version")) or None
    capabilities = reply.get("capabilities")
    result["capabilities"] = capabilities if isinstance(capabilities, dict) else None
    result["sync_root"] = register_pip0_root(platform, config)
    return result


class NoShellLink:
    """pip0 シェルを使わないとき（serve --no-shell）の代わり。どの要求も「シェルが動いていない」で失敗する

    WindowsPlatform と ShellUi は、シェルとのつながり（link）を必要とします。シェルなしで動かすときは、
    この代わりを渡すと、ゴーストやごみ箱は「使えない」になり、画面への指示は送られずに捨てられます。
    """

    def __init__(self):
        self.on_event = None

    def start(self):
        return {"ok": False, "reason": NO_SHELL_REASON}

    def stop(self, timeout=5):
        return {"stopped": False, "returncode": None, "method": "not_started"}

    def is_alive(self):
        return False

    def request(self, type, payload=None, timeout=10.0):
        raise shell_link.ShellUnavailable(NO_SHELL_REASON)

    def send_event(self, type, payload=None):
        return False


# ----------------------------------------------------------------------
# 1つだけ動かすためのロックと、制御用のファイル（CLI も使う）
# ----------------------------------------------------------------------


class InstanceLock:
    """常駐処理（と、保管庫を扱うコマンド）が同時に2つ動かないようにするロック（LOCK_DIR/service.lock）

    ロックは OS が持つので、プロセスが強制終了しても残りません（次に起動したときに取れます）。
    ロックのファイルそのものは消しません（中身は空です）。
    """

    def __init__(self, config):
        lock_dir = config.get("LOCK_DIR")
        self.path = Path(lock_dir) / LOCK_FILE_NAME if lock_dir is not None else None
        self.file = None

    def acquire(self):
        """ロックを取る。取れたら True、ほかのプロセスが持っていれば False（待たない）"""
        if self.file is not None:
            return True
        if self.path is None:
            raise OSError("ロックの場所（LOCK_DIR）が設定されていません")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        f = open(self.path, "a+b")
        try:
            lock_without_waiting(f)
        except OSError:
            f.close()
            return False
        self.file = f
        return True

    def release(self):
        if self.file is None:
            return
        try:
            unlock(self.file)
        except OSError:
            pass  # 閉じればロックは外れる
        self.file.close()
        self.file = None


def lock_without_waiting(f):
    """ファイルの先頭の1バイトをロックする。ほかのプロセスが持っていれば、すぐに OSError"""
    if sys.platform == "win32":
        import msvcrt
        f.seek(0)
        msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
    else:
        import fcntl
        fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)


def unlock(f):
    if sys.platform == "win32":
        import msvcrt
        f.seek(0)
        msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
    else:
        import fcntl
        fcntl.flock(f.fileno(), fcntl.LOCK_UN)


def is_running(config):
    """常駐処理が動いていれば True、動いていなければ False、確かめられなければ None（ロックを取れるかで調べる）"""
    lock = InstanceLock(config)
    if lock.path is None:
        return None
    try:
        acquired = lock.acquire()
    except OSError:
        return None
    if acquired:
        lock.release()
        return False
    return True


def control_file(config, name):
    """CONTROL_DIR の中のファイルのパス。CONTROL_DIR が設定されていなければ None"""
    control_dir = config.get("CONTROL_DIR")
    if control_dir is None:
        return None
    return Path(control_dir) / name


def read_status_file(config):
    """常駐処理が書いた状態（service.status.json）の辞書。なければ None"""
    path = control_file(config, STATUS_FILE_NAME)
    if path is None:
        return None
    try:
        value = fsutil.read_json(path)
    except (OSError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def request_shutdown(config, now=None):
    """常駐処理に終了を依頼する（python -m pip0 shutdown）。{"ok", "reason"}

    依頼のファイルは消さずに、次の依頼で書き換えます。常駐処理は、自分が起動した後の依頼（または、
    自分の番号 instance が書かれた依頼）だけを受け付けるので、古い依頼で次の起動が止まることはありません。
    """
    now = time.time() if now is None else now
    path = control_file(config, SHUTDOWN_REQUEST_NAME)
    if path is None:
        return {"ok": False, "reason": "データフォルダー（DATA_DIR）が設定されていないため、依頼できません"}
    status = read_status_file(config) or {}
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fsutil.atomic_write_json(path, {"at": now, "instance": status.get("instance")})
    except OSError as error:
        return {"ok": False, "reason": f"終了の依頼を書けませんでした（{type(error).__name__}）"}
    return {"ok": True, "reason": ""}


def short_text(value, max_chars=TEXT_MAX_CHARS):
    """画面に出す短い文にする（文字列でなければ空。空白をまとめ、長すぎる分は切る）"""
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())[:max_chars]


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


# ----------------------------------------------------------------------
# 高負荷の処理のワーカー
# ----------------------------------------------------------------------


class HeavyWorker:
    """高負荷の処理（解析、保管庫へのコピー）を1つずつ行う、ワーカーのスレッド（1つだけ）

    メインのスレッドが submit(仕事) で仕事を渡し、終わったら results に (仕事, 結果) が入ります。
    仕事を行う関数 run_job は、このスレッドで呼ばれます。予想外のエラーでもスレッドは止まらず、
    結果を {"status": "error", ...} にして返します（ログにはエラーの種類だけを書く）。
    """

    def __init__(self, run_job):
        self.run_job = run_job
        self.jobs = queue.Queue()
        self.results = queue.Queue()
        self.thread = None

    def start(self):
        self.thread = threading.Thread(target=self.loop, name="pip0-heavy-work", daemon=True)
        self.thread.start()

    def submit(self, job):
        self.jobs.put(job)

    def loop(self):
        while True:
            job = self.jobs.get()
            if job is None:
                break  # 終わりの合図
            try:
                result = self.run_job(job)
            except Exception as error:  # ワーカーが止まると、高負荷の処理が二度と進まなくなるため
                logger.error("高負荷の処理（%s）で予想外のエラーが起きました（%s）", job["kind"], type(error).__name__)
                result = {"status": "error", "ok": False, "state": None, "item_id": None,
                          "reason": f"予想外のエラーが起きました（{type(error).__name__}）"}
            self.results.put((job, result))

    def stop(self, timeout):
        """今の仕事が区切りで終わるのを待って、スレッドを止める。止まったら True"""
        if self.thread is None:
            return True
        self.jobs.put(None)
        self.thread.join(timeout)
        return not self.thread.is_alive()


# ----------------------------------------------------------------------
# 常駐処理
# ----------------------------------------------------------------------


def run(config, rules, platform, ui, conn, link=None, keystore=None):
    """常駐処理を動かす（docs/design.md 6-6 の service.run）。終了の依頼まで戻らない。戻り値：{"ok", "reason"}"""
    return Service(config, rules, platform, ui, conn, link=link, keystore=keystore).run()


class Service:
    """常駐処理（状態をたくさん持つので、クラスにしています）

    config：config.load_config() の辞書、rules：規則のモジュール（pip0.rules）
    platform：OS 連携（WindowsPlatform、テストでは FakePlatform）
    ui：画面への指示（ShellUi、テストでは RecordingUi）
    conn：暗号化DB の接続（メインのスレッドだけが使う）
    link：pip0 シェルとのつながり（ShellLink）。None なら、シェルを起動しない（テストとデモ）
    clock：今の時刻を返す関数（テストでは、決まった時刻を返す関数を渡す）
    start_threads：False なら、ワーカーのスレッドとフォルダーの監視を使わない（テスト用）
    keystore：ワーカーのスレッドが自分の DB の接続を開くときに使う鍵の保管場所（None なら OS の鍵保管機構）

    使い方：run() が start() → step() のくり返し → shutdown() を行う。テストでは start()、handle_event()、
    handle_file_event()、step() を直接呼ぶ。
    """

    def __init__(self, config, rules, platform, ui, conn, link=None, clock=time.time, start_threads=True,
                 keystore=None):
        self.config = config
        self.rules = rules
        self.platform = platform
        self.ui = ui
        self.conn = conn
        self.link = link
        self.clock = clock
        self.start_threads = start_threads
        self.keystore = keystore

        # ほかのスレッドから届く知らせ（入れるのはほかのスレッド、取り出すのはメインのスレッド）
        self.shell_events = queue.Queue()
        self.file_events = queue.Queue()
        # ワーカーのスレッドも見る合図
        self.kill_event = threading.Event()   # キルスイッチ：実行中の高負荷の処理を、次の区切りで止める
        self.stop_event = threading.Event()   # 終了：メインループと実行中の処理を止める

        # 機能の部品（それぞれのモジュールの、状態を持つクラス）
        self.registry = watcher.SelfChangeRegistry()        # pip0 自身の移動・改名の知らせを無視するため
        self.tracker = watcher.DownloadTracker(config, rules, platform)  # M1 ダウンロードの完了
        self.dock = inflow.MiniDock(config)                 # M1 3秒のミニドック
        self.desk_controller = desk.DeskController(config)  # M2 浮上式デスク
        self.shake_detector = desk.ShakeDetector(config)    # M2 シェイク
        self.hazard_session = hazard.HazardSession(config)  # M5 警告と消音
        self.gate = throttle.HeavyGate(platform, config, clock=clock, extra_stop=self.heavy_work_stopped)
        self.lock = InstanceLock(config)
        self.folder_watcher = None
        self.worker = HeavyWorker(self.run_job) if start_threads else None
        self.worker_conn = None   # ワーカーのスレッド専用の DB の接続（退避のときに開く）
        self.current_job = None   # ワーカーのスレッドが今している仕事（なければ None）

        # メモリーの中だけに持つもの（DB にもファイルにも保存しない）
        self.context = None               # 今の作業文脈（ウィンドウタイトルを含む）
        self.recent_items_enabled = None  # Windows の「最近使ったファイル」の記録が有効か（シェルが知らせる）
        self.desk_handle_engaged = False  # デスクの「つまみ」で操作中か（操作中はシェイクを数えない）
        self.shown_desks = {}             # デスクの番号 → 出した候補のパスの集合
        self.features = {}                # 機能の名前 → {"feature", "ok", "reason", "label", "source"}
        self.newly_failed = []            # 使えなくなったばかりの機能（まとめて1回知らせる）
        self.fetch_times = []             # ゴーストを開いたときの応答時間の記録
        self.reopened = {}                # 開かれたゴースト（項目ID）→ {"due", "attempts"}（通常のファイルへ戻す予定）
        self.deletion_checks = {}         # 削除の知らせが届いたゴースト（項目ID）→ 確かめる時刻
        self.evacuation_queue = []        # 退避の候補（evacuation.find_candidates の結果）
        self.fed_event_ids = set()        # DownloadTracker に渡した、ブラウザー拡張の記録の id
        self.held_downloads = []          # 画面が動いていない間に完了したダウンロード（画面が戻ったら提案する）
        self.error_logged_at = {}         # 予想外のエラーの種類 → 最後にログに書いた時刻

        # 全復元
        self.restore_requested = False
        self.restoring = False
        self.restore_counts = None
        self.restore_retry_at = 0.0

        # pip0 シェル
        self.shell_version = None
        self.shell_capabilities = None
        self.shell_failures = 0
        self.shell_restart_at = None

        # 予定と状態
        self.started = False
        self.started_at = None
        self.started_wall = None
        self.instance_id = None
        self.stop_reason = ""
        self.automation_engaged = False
        self.next_control_poll = 0.0
        self.next_download_poll = 0.0
        self.next_scan = 0.0
        self.next_evacuation_check = 0.0
        self.next_expire = 0.0
        self.last_status = None
        self.last_status_at = None
        self.last_status_file_at = None

        # シェルの知らせの種類 → 処理する関数
        self.handlers = {
            "shell.ready": self.on_shell_ready,
            "shell.exited": self.on_shell_exited,
            "feature.status": self.on_feature_status,
            "context.foreground": self.on_foreground,
            "input.cursor_batch": self.on_cursor_batch,
            "drag.started": self.on_drag_started,
            "drag.target_changed": self.on_drag_target_changed,
            "drag.ended": self.on_drag_ended,
            "session.event": self.on_session_event,
            "ui.mini_dock.interaction": self.on_mini_dock_interaction,
            "ui.mini_dock.action": self.on_mini_dock_action,
            "ui.desk.action": self.on_desk_action,
            "ui.desk.handle": self.on_desk_handle,
            "tray.command": self.on_tray_command,
            "cf.fetch": self.on_cf_fetch,
            "cf.hydrated": self.on_cf_hydrated,
            "cf.notify_delete": self.on_cf_notify_delete,
            "cf.notify_rename": self.on_cf_notify_rename,
            "usage.recent_items": self.on_recent_items,
        }

        if link is not None:
            link.on_event = self.receive_event  # シェルの知らせを、この常駐処理が受け取る

    # ==================================================================
    # 起動・メインループ・終了
    # ==================================================================

    def run(self):
        """常駐処理を動かす（終了の依頼まで戻らない）。戻り値：{"ok", "reason"}"""
        # 外部通信を止める（監査フック）。許可する外部コマンドは pip0 シェルだけ
        netguard.install([str(self.config["SHELL_EXE"])])
        started = self.start()
        if not started["ok"]:
            return started
        try:
            while not self.stop_event.is_set():
                try:
                    self.step()
                except Exception as error:  # 1つの失敗で常駐処理（とキルスイッチ）を止めない
                    self.report_loop_error(error)
                self.stop_event.wait(self.config["LOOP_SECONDS"])
        except KeyboardInterrupt:
            self.stop_reason = "Ctrl+C"
        finally:
            self.shutdown()
        return {"ok": True, "reason": self.stop_reason}

    def start(self, now=None):
        """起動する。戻り値：{"ok", "reason"}（2つ目の常駐処理や、危険な設定のときは起動しない）"""
        now = self.clock() if now is None else now
        problems = self.config.get("CONFIG_ERRORS") or []
        if problems:
            return {"ok": False,
                    "reason": "設定の場所の組み合わせに問題があるため、起動しません：" + "／".join(problems)}
        try:
            acquired = self.lock.acquire()
        except OSError as error:
            return {"ok": False, "reason": f"ロックのファイルを使えないため、起動しません（{type(error).__name__}）"}
        if not acquired:
            return {"ok": False, "reason": ALREADY_RUNNING_REASON}
        try:
            self.start_parts(now)
        except BaseException:
            self.started = False
            self.lock.release()
            raise
        return {"ok": True, "reason": ""}

    def start_parts(self, now):
        """起動の中身（ロックを取った後）"""
        self.started = True
        self.started_at = now
        self.started_wall = time.time()
        self.instance_id = uuid.uuid4().hex
        self.next_control_poll = now
        self.next_download_poll = now
        self.next_scan = now
        self.next_evacuation_check = now + FIRST_EVACUATION_CHECK_SECONDS
        self.next_expire = now + EXPIRE_EVENTS_SECONDS

        # 1. DB を保管庫の manifest.json に合わせる（DB を作り直した後でも、退避した項目を見失わない）
        synced = vault.sync_from_manifests(self.conn, self.config)
        if synced["loaded"] or synced["problems"]:
            logger.info("起動：保管庫の項目を読み直しました（新しく %d 件、問題 %d 件）",
                        synced["loaded"], len(synced["problems"]))
        # 2. 前回「解析中」のまま終わった仕事を、待ちに戻す。古いダウンロードの記録を期限切れにする
        analysis_queue.reset_running(self.conn, now)
        provenance.expire_old_events(self.conn, now)
        # 3. 自動処理が止まっているか（キルスイッチ）
        self.automation_engaged = killswitch.is_engaged(self.conn, self.config)
        if self.automation_engaged:
            self.kill_event.set()

        # 4. pip0 シェル（init、同期ルート）。シェルがなくても本体は動き続ける
        if isinstance(self.link, NoShellLink):
            self.set_feature("shell", False, NO_SHELL_REASON)  # シェルなしと決めている（起動し直さない）
        if self.link is not None and not isinstance(self.link, NoShellLink):
            self.start_shell(now)
        else:
            # シェルを使わない：OS 連携に直接頼む
            # （代役は登録できる。WindowsPlatform は、シェルなしでは「使えない」と答える）
            sync = register_pip0_root(self.platform, self.config)
            self.set_feature("sync_root", sync["ok"], sync["reason"])

        # 5. 保管庫の起動時の点検（途中で止まった退避・復元をそろえる。シェルが要るので、その後に行う）
        self.check_vault(now)

        # 6. 全復元が途中なら続ける。全復元の依頼が届いていれば受け付ける
        progress = killswitch.read_progress(self.config)
        if progress is not None and progress.get("finished") is False:
            self.restore_requested = True
            self.restore_counts = progress
        if killswitch.take_restore_request(self.config) is not None:
            self.engage_kill_switch(now, "コマンド（restore-all）からの全復元の依頼", actor="user")

        # 7. フォルダーの監視とワーカーのスレッド
        if self.start_threads:
            self.start_folder_watcher()
            self.worker.start()

        self.update_status(now, force=True)
        logger.info("常駐処理を始めました")

    def step(self, now=None):
        """メインループの1回分（docs の上の 1〜6）"""
        now = self.clock() if now is None else now
        self.process_shell_events(now)
        self.process_file_events(now)
        self.collect_worker_results(now)
        self.restart_shell_if_due(now)  # 先に起動し直す（この後の表示が、新しいシェルに届くように）
        if now >= self.next_control_poll:
            self.poll_control_files(now)
        if now >= self.next_download_poll:
            self.poll_download_events(now)
        self.held_downloads.extend(self.tracker.ready(now))
        if self.held_downloads and self.screen_available():
            ready_list, self.held_downloads = self.held_downloads, []
            for ready in ready_list:
                self.propose(ready, now)
        self.held_downloads = self.held_downloads[-HELD_DOWNLOADS_KEPT:]
        self.apply_dock_actions(self.dock.tick(now), now)
        self.apply_desk_actions(self.desk_controller.tick(now))
        self.run_due_vault_work(now)
        if self.restore_requested and self.current_job is None and now >= self.restore_retry_at:
            self.run_restore_all(now)
        if now >= self.next_scan:
            self.scan(now)
        if now >= self.next_evacuation_check:
            self.check_evacuation(now)
        if now >= self.next_expire:
            self.next_expire = now + EXPIRE_EVENTS_SECONDS
            provenance.expire_old_events(self.conn, now)
        self.schedule_heavy_work(now)
        self.update_status(now)
        self.flush_feature_notices()

    def shutdown(self, now=None):
        """終了する（ワーカーを区切りで止め、画面を片付け、シェルとロックを放す）"""
        if not self.started:
            return
        now = self.clock() if now is None else now
        self.stop_event.set()
        # 1. 実行中の高負荷の処理を、次の区切りで止める（解析は待ちに戻り、退避は原本のままになる）
        worker_stopped = True
        if self.worker is not None:
            worker_stopped = self.worker.stop(WORKER_STOP_SECONDS)
            self.collect_worker_results(now)
            if not worker_stopped:
                logger.warning("ワーカーのスレッドが時間内に止まりませんでした")
        if self.worker_conn is not None and worker_stopped:
            self.worker_conn.close()
            self.worker_conn = None
        # 2. 警告の枠を消し、セッションの消音を消す（pip0 の終了はセッションの終わり）
        self.apply_hazard_actions(self.hazard_session.end_session("pip0_exit"))
        # 3. ミニドックを閉じる（表示中の提案は、自動では実行しない。inflow テーブルに提案のまま残る）
        if self.dock.dock_id is not None:
            self.ui.close_mini_dock(self.dock.dock_id, "shutdown")
        # 4. フォルダーの監視を止め、最後の状態を書く
        if self.folder_watcher is not None:
            self.folder_watcher.stop()
            self.folder_watcher = None
        try:
            self.write_status_file(self.build_status(now), running=False)
        except Exception as error:  # 終了の途中のエラーで、ロックを放し損ねないようにする
            logger.warning("終了の前に状態を書けませんでした（%s）", type(error).__name__)
        # 5. シェルを止め、ロックを放す
        if self.link is not None:
            self.link.stop()
        self.lock.release()
        self.started = False
        logger.info("常駐処理を終了しました")

    def request_stop(self, reason):
        """終了を決める（メインループは、次の回の前に終わる）"""
        self.stop_reason = reason
        self.stop_event.set()

    def report_loop_error(self, error):
        """メインループの1回分で起きた予想外のエラーを記録する（同じ種類は ERROR_LOG_SECONDS に1回だけログに書く）"""
        kind = type(error).__name__
        now = time.time()
        if now - self.error_logged_at.get(kind, 0.0) >= ERROR_LOG_SECONDS:
            self.error_logged_at[kind] = now
            frames = traceback.extract_tb(error.__traceback__)
            place = f"{os.path.basename(frames[-1].filename)}:{frames[-1].lineno}" if frames else "不明"
            # 例外の文には、パスが入っていることがあるため書かない（種類と、pip0 のコードの場所だけ）
            logger.error("常駐処理の途中で予想外のエラーが起きました（%s、%s）", kind, place)
        try:
            self.set_feature("service_loop", False,
                             f"予想外のエラーが起きました（{kind}）。処理は続けています（ログを確かめてください）")
        except Exception as again:  # 状態も書けない（DB の故障など）ときも、メインループは止めない
            logger.error("エラーの状態を記録できませんでした（%s）", type(again).__name__)

    # ==================================================================
    # pip0 シェル
    # ==================================================================

    def receive_event(self, event):
        """pip0 シェルの知らせを受け取る（シェルの読み取りのスレッドから呼ばれるので、順番待ちに入れるだけ）

        キルスイッチと終了だけは、メインのスレッドが知らせを取り出す前から効くように、合図を先に立てます
        （ワーカーの高負荷の処理は、次の区切り（1MB ごと）で止まります。DB と停止の印は、メインのスレッドが書きます）。
        """
        if isinstance(event, dict) and event.get("type") == "tray.command":
            payload = event.get("payload")
            if not isinstance(payload, dict):
                payload = {}
            if payload.get("command") == "kill_switch":
                self.kill_event.set()
            elif payload.get("command") == "quit":
                self.stop_event.set()
        self.shell_events.put(event)

    def start_shell(self, now):
        """pip0 シェルを起動して準備する。できたら True（できなければ、しばらく後に起動し直す）"""
        result = connect_shell(self.link, self.platform, self.config, headless=False)
        if not result["ok"]:
            self.mark_shell_down(result["reason"], now)
            return False
        self.shell_failures = 0
        self.shell_version = result["shell_version"] or self.shell_version
        self.shell_capabilities = result["capabilities"]
        self.set_feature("shell", True, "")
        self.set_feature("sync_root", result["sync_root"]["ok"], result["sync_root"]["reason"])
        self.resend_screen(now)
        return True

    def mark_shell_down(self, reason, now):
        """シェルが使えないことを記録し、起動し直す時刻を決める"""
        self.set_feature("shell", False, reason)
        # シェルが知らせた機能の状態は、シェルとともに古くなるため、起動し直した後の知らせを待つ
        for feature in [name for name, entry in self.features.items() if entry["source"] == "shell"]:
            del self.features[feature]
        if isinstance(self.link, NoShellLink):
            return  # シェルなしで動かすと決めているので、起動し直さない
        delay = SHELL_RESTART_DELAYS[min(self.shell_failures, len(SHELL_RESTART_DELAYS) - 1)]
        self.shell_failures += 1
        self.shell_restart_at = now + delay

    def restart_shell_if_due(self, now):
        if self.link is None or self.shell_restart_at is None or now < self.shell_restart_at:
            return
        if self.stop_event.is_set():
            return
        self.shell_restart_at = None
        if self.start_shell(now) and not self.features.get("vault_check", {}).get("ok", True):
            self.check_vault(now)  # シェルが動かず確かめられなかった項目を、確かめ直す

    def resend_screen(self, now):
        """シェルを起動し直したときに、表示中のミニドックとデスク、状態を送り直す"""
        if self.dock.dock_id is not None:
            # 古いシェルの上にマウスがあったまま終わった場合に備えて、時間を動かし直す
            self.apply_dock_actions(self.dock.interaction(self.dock.dock_id, "leave", now), now)
            payload = self.dock.payload(now)
            if payload is not None:
                self.ui.show_mini_dock(payload)
        if self.desk_controller.visible and self.desk_controller.shown_desk is not None:
            self.ui.show_desk(dict(self.desk_controller.shown_desk, desk_id=self.desk_controller.desk_id))
            self.ui.set_cursor_stream(True)
        self.update_status(now, force=True)

    def screen_available(self):
        """ミニドックなどの画面を、ユーザーが見られるか

        pip0 シェルが落ちて起動し直すまでの間は、ミニドックが見えないので、ダウンロードの提案（3秒後の自動の仕分け）を
        待たせる（見えないまま自動で動かさない）。シェルを使わない設定（テスト、--no-shell）では待たせない。
        """
        if self.link is None or isinstance(self.link, NoShellLink):
            return True
        return self.link.is_alive()

    def ghosts_available(self):
        """ゴーストを作れる見込みがあるか（同期ルートが使え、シェルが動いている）。なければ退避を始めない

        ゴーストを作れないのに保管庫へコピーすると、大きなファイルを無駄に読むだけなので、先に確かめます
        （作れなくても、vault.evacuate は原本をそのままにして失敗にするので、安全ではあります）。
        """
        sync = self.features.get("sync_root")
        if sync is not None and not sync["ok"]:
            return False
        return self.link is None or self.link.is_alive()

    def ask_shell(self, request_type, payload):
        """ファイルを開くなどを、pip0 シェルに頼む。{"ok", "reason"}"""
        if self.link is None:
            return {"ok": False, "reason": "pip0 シェルが動いていないため、できません"}
        try:
            reply = self.link.request(request_type, payload, timeout=SHELL_REQUEST_TIMEOUT_SECONDS)
        except shell_link.ShellError as error:
            return {"ok": False, "reason": f"pip0 シェルに頼めませんでした（{error.code}）"}
        return {"ok": reply.get("ok") is True, "reason": short_text(reply.get("reason"))}

    # ==================================================================
    # 知らせの処理
    # ==================================================================

    def process_shell_events(self, now):
        while True:
            try:
                event = self.shell_events.get_nowait()
            except queue.Empty:
                return
            self.handle_event(event, now)

    def handle_event(self, event, now):
        """pip0 シェルの知らせ1つを処理する（docs/ipc-protocol.md 4節）。知らない知らせは無視する"""
        if not isinstance(event, dict):
            return
        handler = self.handlers.get(event.get("type"))
        if handler is None:
            logger.debug("知らない知らせを無視しました")
            return
        payload = event.get("payload")
        handler(payload if isinstance(payload, dict) else {}, now)

    def on_shell_ready(self, payload, now):
        self.shell_version = short_text(payload.get("shell_version")) or self.shell_version

    def on_shell_exited(self, payload, now):
        if payload.get("requested_stop") is True or self.stop_event.is_set():
            return  # pip0 が止めた
        if self.shell_restart_at is not None:
            return  # 起動の失敗として、もう記録した（起動し直す時刻も決めてある）
        code = payload.get("returncode")
        if code == 3:
            reason = ("同じサインインの中で、ほかの pip0 シェルが動いています（終了コード 3）。"
                      "しばらく後に起動し直します")
        else:
            reason = f"pip0 シェルが終了しました（終了コード {code}）。しばらく後に起動し直します"
        logger.warning("pip0 シェルが終了しました（終了コード %s）", code)
        self.mark_shell_down(reason, now)

    def on_feature_status(self, payload, now):
        """シェルが知らせた機能の状態（権限がない・取り消された・フックが外れた等も含む）を記録して表示する"""
        feature = payload.get("feature")
        if not isinstance(feature, str) or not feature:
            return
        self.set_feature(feature, payload.get("ok") is True, short_text(payload.get("reason")), source="shell")

    # --- M2 浮上式デスク ---

    def on_foreground(self, payload, now):
        """前面のウィンドウが変わった：作業文脈を読み、デスクの候補を出し直す（文脈はメモリーの中だけ）"""
        parsed = context.parse_foreground(payload, self.rules)
        if desk.is_pip0_window(parsed):
            return  # pip0 自身のウィンドウ（デスク、ミニドック）は、作業文脈として扱わない
        current = context.carry_over(self.context, parsed)  # ファイルダイアログは、同じアプリの直前の文脈を引き継ぐ
        self.context = current
        ranked = desk.rank_files(self.conn, current, now, self.config, self.rules)
        self.apply_desk_actions(self.desk_controller.on_context(current, ranked, now))

    def on_cursor_batch(self, payload, now):
        """マウスの位置の列：シェイクならデスクを隠す（デスクのつまみで操作中は数えない）"""
        if self.desk_handle_engaged or not self.desk_controller.visible:
            return
        if self.shake_detector.feed(payload.get("samples")):
            self.apply_desk_actions(self.desk_controller.on_shake(now))

    def on_desk_handle(self, payload, now):
        self.desk_handle_engaged = payload.get("state") == "engaged"
        self.shake_detector.reset()

    def on_desk_action(self, payload, now):
        """デスクのボタン（開く、場所を開く、ダイアログに入力）。出した候補のパスだけを受け付ける"""
        path = payload.get("path")
        action = payload.get("action")
        desk_id = payload.get("desk_id")
        shown = self.shown_desks.get(desk_id, ()) if is_number(desk_id) else ()
        if not isinstance(path, str) or path not in shown:
            logger.warning("デスクに出していない候補の操作を無視しました")
            return
        if action == "open":
            result = self.ask_shell("shell.open_file", {"path": path})
        elif action == "reveal":
            result = self.ask_shell("shell.reveal_file", {"path": path})
        elif action == "fill_dialog":
            result = self.ask_shell("shell.fill_file_dialog", {"dialog_hwnd": payload.get("dialog_hwnd"), "path": path})
        else:
            logger.warning("デスクの知らない操作を無視しました")
            return
        if not result["ok"]:
            self.ui.notify("デスクの操作ができませんでした", result["reason"] or "理由は分かりません", "warning")
        elif action in ("open", "fill_dialog"):
            self.record_user_action(path, now)

    def record_user_action(self, path, now):
        """pip0 の画面からファイルを選んだことを、利用の記録に残す（長期間未読の判定に使う）"""
        file_id = usage.find_file_id(self.conn, path)
        if file_id is not None:
            usage.record_usage(self.conn, file_id, "user_action", now)

    # --- M5 スマート・ハザードガード ---

    def on_drag_started(self, payload, now):
        """ドラッグが始まった：ファイルを判定し、機密・未判定があれば枠を出す"""
        items = payload.get("items")
        if payload.get("items_status") != "ok" or not isinstance(items, list):
            return  # ファイルを特定できないドラッグ：判定できないため、警告もできない
        paths = [item for item in items if isinstance(item, str) and item]
        evaluation = hazard.evaluate_items(self.conn, paths, self.config, self.rules)
        file_keys = [self.platform.get_file_key(path) for path in paths]
        actions = self.hazard_session.start_drag(payload.get("drag_id"), evaluation, file_keys,
                                                 payload.get("source_process"), now)
        self.apply_hazard_actions(actions)

    def on_drag_target_changed(self, payload, now):
        actions = self.hazard_session.target_changed(payload.get("drag_id"), payload.get("target_process"), now)
        self.apply_hazard_actions(actions)

    def on_drag_ended(self, payload, now):
        """ドラッグが終わった。ボタンを離したことを確かめられなかった（reason がある）ときは、続行とみなさない"""
        dropped = payload.get("dropped_on_other_process") is True and not payload.get("reason")
        result = self.hazard_session.end_drag(payload.get("drag_id"), payload.get("target_process"), dropped, now)
        self.apply_hazard_actions(result["actions"])

    def on_session_event(self, payload, now):
        """画面のロック・サインアウト・スリープ・Windows の終了（と、ロック解除・復帰）で、消音を消す"""
        kind = payload.get("kind")
        if kind in hazard.SESSION_END_REASONS or kind in hazard.SESSION_START_REASONS:
            self.apply_hazard_actions(self.hazard_session.end_session(kind))

    # --- M1 ミニドック ---

    def on_mini_dock_interaction(self, payload, now):
        actions = self.dock.interaction(payload.get("dock_id"), payload.get("state"), now)
        self.apply_dock_actions(actions, now)

    def on_mini_dock_action(self, payload, now):
        actions = self.dock.user_action(payload.get("dock_id"), payload.get("entry_id"), payload.get("action"), now,
                                        payload.get("alternative_index"))
        self.apply_dock_actions(actions, now)

    # --- 通知領域のアイコン ---

    def on_tray_command(self, payload, now):
        command = payload.get("command")
        if command == "kill_switch":
            self.engage_kill_switch(now, "通知領域の「全復元（自動処理を止める）」", actor="user")
        elif command == "resume":
            self.resume_from_tray(payload.get("confirmed") is True, now)
        elif command == "show_desk":
            self.show_desk_on_request(now)
        elif command == "status":
            self.update_status(now, force=True)
        elif command == "quit":
            self.request_stop("通知領域の「終了」")

    def resume_from_tray(self, confirmed, now):
        """自動処理の再開。シェルの確認画面で承認された（confirmed）ときだけ再開する。勝手には再開しない"""
        if not confirmed:
            self.ui.notify("自動処理は止まったままです",
                           "再開するには、通知領域の「自動処理を再開（確認）」で確認するか、"
                           "python -m pip0 resume を実行してください。", "info")
            return
        result = killswitch.resume(self.conn, self.config, confirmed=True, now=now)
        if result["ok"]:
            self.automation_engaged = False
            self.kill_event.clear()
            self.ui.notify("自動処理を再開しました", "自動仕分け・自動改名・自動退避を再開しました。", "info")
        else:
            self.ui.notify("自動処理を再開できませんでした", result["reason"], "warning")
        self.update_status(now, force=True)

    def show_desk_on_request(self, now):
        """通知領域の「デスクを表示」：シェイクの後でも、すぐに出す"""
        ranked = desk.rank_files(self.conn, self.context, now, self.config, self.rules)
        actions = self.desk_controller.on_show_request(now, ranked=ranked)
        if any(action["do"] == "hide" and action["reason"] == "no_items" for action in actions):
            self.ui.notify("デスクに出す候補がありません", "今の作業に関係しそうなファイルが見つかりませんでした。",
                           "info")
        self.apply_desk_actions(actions)

    # --- M4 ゴースト（Cloud Files API） ---

    def on_cf_fetch(self, payload, now):
        """ゴーストが開かれて中身を渡した：応答時間を覚え、利用として記録する（pip0 自身の読み取りは数えない）"""
        elapsed = payload.get("elapsed_ms")
        if is_number(elapsed):
            self.fetch_times.append({"elapsed_ms": float(elapsed), "result": payload.get("result")})
            self.fetch_times = self.fetch_times[-FETCH_TIMES_KEPT:]
        if payload.get("result") != "served" or payload.get("by_pip0") is True:
            return
        file_id = self.file_id_for_item(payload.get("item_id"), payload.get("path"))
        if file_id is None:
            return
        process_name = short_text(payload.get("process_name")) or None
        detail = {"item_id": payload.get("item_id"), "by_pip0": False,
                  "elapsed_ms": elapsed if is_number(elapsed) else None}
        usage.record_usage(self.conn, file_id, "ghost_open", now, process_name=process_name, detail=detail)

    def on_cf_hydrated(self, payload, now):
        """ゴーストの中身がすべて戻った：RESTORE_AFTER_OPEN_SECONDS 後に、通常のファイルへ戻す"""
        if payload.get("by_pip0") is True:
            return  # pip0 自身の復元（cf.restore）の中で戻したもの
        item_id = valid_item_id(payload.get("item_id"))
        if item_id is None:
            return
        self.reopened[item_id] = {"due": now + self.config["RESTORE_AFTER_OPEN_SECONDS"], "attempts": 0}

    def on_cf_notify_delete(self, payload, now):
        """ゴーストが削除された：少し待ってから確かめ、本当になければ「ゴーストなし」にする（中身は保管庫に残る）"""
        item_id = valid_item_id(payload.get("item_id"))
        if item_id is not None:
            self.deletion_checks[item_id] = now + NOTIFY_DELETE_CHECK_SECONDS

    def on_cf_notify_rename(self, payload, now):
        """ゴーストの名前・場所が変わった：保管庫の項目の今の場所を書き直す"""
        item_id = valid_item_id(payload.get("item_id"))
        new_path = payload.get("new_path")
        if item_id is None or not isinstance(new_path, str) or not new_path:
            return
        result = vault.record_moved(self.conn, self.config, item_id, new_path, now=now)
        if not result["ok"]:
            logger.info("ゴーストの移動を記録しませんでした（項目 %s）", item_id)
        elif payload.get("inside_root") is False:
            logger.info("ゴーストが pip0 専用フォルダーの外へ移されました（項目 %s）", item_id)

    def on_recent_items(self, payload, now):
        """Windows の「最近使ったファイル」：利用の記録に加え、その記録が有効かを覚える"""
        if "tracking_enabled" in payload:
            value = payload.get("tracking_enabled")
            self.recent_items_enabled = value if value in (True, False) else None
        items = payload.get("items")
        if isinstance(items, list) and items:
            usage.record_recent_items(self.conn, items, now)

    def file_id_for_item(self, item_id, path):
        """保管庫の項目（なければパス）から、索引の行の id を探す。見つからなければ None"""
        item_id = valid_item_id(item_id)
        if item_id is not None:
            row = database.query_one(self.conn, "SELECT file_id FROM vault_items WHERE item_id = ?", (item_id,))
            if row is not None and row["file_id"] is not None:
                return row["file_id"]
        if isinstance(path, str) and path:
            return usage.find_file_id(self.conn, path)
        return None

    def run_due_vault_work(self, now):
        """時間になった、ゴーストの後片付け（開かれたゴーストを通常のファイルへ戻す、削除の確かめ）"""
        for item_id, plan in list(self.reopened.items()):
            if plan["due"] > now:
                continue
            result = vault.restore(self.conn, self.platform, item_id, self.config, actor="auto", now=now)
            plan["attempts"] += 1
            if result["ok"] or result["state"] not in ("evacuated", "restoring", "ghosting"):
                del self.reopened[item_id]
                logger.info("開かれたゴーストの後片付け（項目 %s、%s）", item_id, result["state"])
            elif plan["attempts"] >= REOPEN_MAX_ATTEMPTS:
                del self.reopened[item_id]
                logger.warning("開かれたゴーストを通常のファイルに戻せませんでした（項目 %s）", item_id)
            else:
                plan["due"] = now + REOPEN_RETRY_SECONDS  # アプリが開いたままなど。後でやり直す
        for item_id, due in list(self.deletion_checks.items()):
            if due > now:
                continue
            del self.deletion_checks[item_id]
            self.check_deleted_ghost(item_id, now)

    def check_deleted_ghost(self, item_id, now):
        manifest = vault.read_manifest(self.config, item_id)
        if manifest is None or manifest["state"] != "evacuated":
            return
        if os.path.lexists(manifest["current_path"]):
            return  # まだある（削除が取り消された等）。何もしない
        # 元の場所にないので、vault.restore は作り直さずに ghost_missing にする（中身は保管庫に残る）
        result = vault.restore(self.conn, self.platform, item_id, self.config, actor="system", now=now)
        if result["state"] == "ghost_missing":
            self.ui.notify("退避したファイルのゴーストが削除されました",
                           "中身は保管庫に残っています（python -m pip0 vault list で確かめられます）。", "info")

    # ==================================================================
    # フォルダーの監視と M1 流入処理
    # ==================================================================

    def start_folder_watcher(self):
        """ダウンロードフォルダーと pip0 専用フォルダーの監視を始める"""
        folders = [(folder, kind) for folder, kind in config_module.index_folders(self.config)
                   if kind in ("downloads", "pip0_root")]
        self.folder_watcher = watcher.FolderWatcher(folders, self.file_events)
        result = self.folder_watcher.start()
        self.set_feature("folder_watcher", result["ok"], result["reason"])

    def process_file_events(self, now):
        while True:
            try:
                event = self.file_events.get_nowait()
            except queue.Empty:
                return
            self.handle_file_event(event, now)

    def handle_file_event(self, event, now):
        """フォルダーの監視の知らせ1つ（watcher.FolderWatcher の辞書）を処理する

        pip0 自身の移動・改名の知らせは無視する（自分の改名を新しいファイルと思って、また改名しないため）。
        ダウンロードフォルダーの知らせは、ダウンロードの完了の確認（DownloadTracker）へ渡す。
        pip0 専用フォルダーの知らせは、そのファイルの索引を新しくする（中身は読まない）。
        """
        path = event.get("path")
        dest_path = event.get("dest_path")
        if self.registry.is_expected(dest_path or path, now) or self.registry.is_expected(path, now):
            return
        self.tracker.observe(event, now)
        if event.get("location_kind") == "pip0_root" and not event.get("is_dir") \
                and event.get("kind") in ("created", "modified", "moved"):
            self.index_one(dest_path or path, "pip0_root", now)

    def index_one(self, path, location_kind, now):
        if not path:
            return
        skip, _reason = scanner.should_skip(path, self.platform, self.config, self.rules)
        if not skip:
            scanner.upsert_file(self.conn, self.platform, path, location_kind, now)

    def poll_download_events(self, now):
        """ブラウザー拡張の記録（受け口が DB に書いたもの）のうち、新しいものを DownloadTracker に渡す"""
        self.next_download_poll = now + self.config["DOWNLOAD_POLL_SECONDS"]
        rows = database.query_all(self.conn, "SELECT * FROM download_events WHERE state = 'pending' ORDER BY id")
        pending = set()
        for row in rows:
            pending.add(row["id"])
            if row["id"] in self.fed_event_ids:
                continue
            self.fed_event_ids.add(row["id"])
            self.tracker.add_browser_event(row, now)
        self.fed_event_ids &= pending  # 結び付いた・期限切れになった記録は忘れる

    def propose(self, ready, now):
        """ダウンロードの完了を確かめたファイルの提案を作り、ミニドックに出す（3秒は、提案を作り終えた時刻から数える）"""
        proposal = inflow.build_proposal(self.conn, self.platform, ready["path"], ready["download_event"],
                                         self.context, self.config, self.rules, now)
        shown_at = self.clock()
        self.apply_dock_actions(self.dock.add(proposal, shown_at), shown_at)

    def apply_dock_actions(self, actions, now):
        """ミニドックの「すること」を行う（表示、閉じる、提案の実行、ファイルを開く）"""
        for action in actions:
            kind = action["do"]
            if kind == "show":
                self.ui.show_mini_dock(action["dock"])
            elif kind == "close":
                self.ui.close_mini_dock(action["dock_id"], action["reason"])
            elif kind == "execute":
                self.execute_proposal(action, now)
            elif kind == "open":
                self.open_from_dock(action, now)

    def execute_proposal(self, action, now):
        """提案を実行する（時間切れの自動、またはユーザーのボタン）。移動と改名は fileops が行う"""
        proposal = inflow.load_proposal(self.conn, action["proposal_id"])
        if proposal is None:
            logger.warning("ミニドックの提案が見つかりませんでした（提案 %s）", action["proposal_id"])
            return
        result = inflow.execute_proposal(self.conn, self.platform, proposal, action["decision"], self.config,
                                         self.rules, self.registry, now,
                                         alternative_index=action.get("alternative_index"))
        if result["ok"]:
            return
        # ユーザーのボタンで実行できなかったときと、自動の実行が OS の操作で失敗したときは、理由を知らせる
        # （キルスイッチで自動の実行を止めたときは、状態の表示で分かるので知らせない）
        if action["decision"] != "auto" or result["status"] == "failed":
            self.ui.notify("ファイルを仕分けできませんでした", result["reason"] or "理由は分かりません", "warning")

    def open_from_dock(self, action, now):
        result = self.ask_shell("shell.open_file", {"path": action["path"]})
        if result["ok"]:
            self.record_user_action(action["path"], now)
        else:
            self.ui.notify("ファイルを開けませんでした", result["reason"] or "理由は分かりません", "warning")

    def apply_deferred_renames(self, now):
        """解析を待っていた改名（M1）を進める"""
        inflow.apply_deferred_renames(self.conn, self.platform, self.config, self.rules, self.registry, now)

    # ==================================================================
    # 画面への指示（デスクと警告の枠）
    # ==================================================================

    def apply_desk_actions(self, actions):
        """デスクの「すること」を行う。デスクを出している間だけ、シェイクの判定のためにマウスの位置を送ってもらう"""
        for action in actions:
            if action["do"] == "show":
                desk_payload = action["desk"]
                self.remember_desk(desk_payload)
                self.ui.show_desk(desk_payload)
                self.ui.set_cursor_stream(True)
                self.shake_detector.reset()
            elif action["do"] == "hide":
                self.ui.hide_desk(action["reason"])
                self.ui.set_cursor_stream(False)
                self.desk_handle_engaged = False

    def remember_desk(self, desk_payload):
        """デスクに出した候補のパスを覚える（ボタンの知らせが、出した候補のものかを確かめるため）"""
        self.shown_desks[desk_payload["desk_id"]] = {item["path"] for item in desk_payload["items"]}
        for old_id in sorted(self.shown_desks)[:-DESKS_KEPT]:
            del self.shown_desks[old_id]

    def apply_hazard_actions(self, actions):
        for action in actions:
            if action["do"] == "show":
                self.ui.show_hazard(action["hazard"])
            elif action["do"] == "hide":
                self.ui.hide_hazard()

    # ==================================================================
    # 制御用のファイルとキルスイッチ
    # ==================================================================

    def poll_control_files(self, now):
        """全復元の依頼、終了の依頼、停止の印（python -m pip0 restore-all／shutdown／stop／resume）を確かめる"""
        self.next_control_poll = now + CONTROL_POLL_SECONDS
        if killswitch.take_restore_request(self.config) is not None:
            self.engage_kill_switch(now, "コマンド（restore-all）からの全復元の依頼", actor="user")
        if self.shutdown_requested():
            self.request_stop("コマンド（shutdown）からの終了の依頼")
        engaged = killswitch.is_engaged(self.conn, self.config)
        if engaged == self.automation_engaged:
            return
        self.automation_engaged = engaged
        if engaged:
            # python -m pip0 stop などで止められた（復元はしない）
            self.kill_event.set()
            self.evacuation_queue = []
            self.ui.notify("自動処理を止めました",
                           "自動仕分け・自動改名・自動退避を止めました（再開するまで止まったままです）。", "info")
        else:
            # python -m pip0 resume で、ユーザーが確認して再開した
            self.kill_event.clear()
            self.ui.notify("自動処理を再開しました", "自動仕分け・自動改名・自動退避を再開しました。", "info")
        self.update_status(now, force=True)

    def shutdown_requested(self):
        """終了の依頼のファイルが、この常駐処理あてなら True（起動より前の古い依頼は受け付けない）"""
        path = control_file(self.config, SHUTDOWN_REQUEST_NAME)
        if path is None:
            return False
        try:
            request = fsutil.read_json(path)
        except (OSError, ValueError):
            return False
        if not isinstance(request, dict):
            return False
        if request.get("instance") == self.instance_id:
            return True
        at = request.get("at")
        return is_number(at) and at >= self.started_wall

    def heavy_work_stopped(self):
        """高負荷の処理を止めるべきなら True（終了、キルスイッチ）。ワーカーのスレッドからも呼ばれる

        DB は使わず、合図と停止の印（ファイル）だけを見ます。
        """
        if self.stop_event.is_set() or self.kill_event.is_set():
            return True
        return killswitch.is_engaged(None, self.config)

    def engage_kill_switch(self, now, reason, actor):
        """キルスイッチ：すぐに自動処理を止め、ワーカーを次の区切りで止め、その後で全復元する"""
        self.kill_event.set()
        result = killswitch.engage(self.conn, self.config, reason, actor=actor, now=now)
        self.automation_engaged = True
        self.evacuation_queue = []
        already_waiting = self.restore_requested and now >= self.restore_retry_at
        self.restore_requested = True
        self.restore_retry_at = now
        if already_waiting:
            return  # 2回押された：全復元はもう始めるところ（知らせを重ねない）
        # デスクは、全復元の間は隠す（全復元の間は、表示の内容を新しくできないため）
        self.apply_desk_actions(self.desk_controller.hide("kill_switch"))
        message = ("自動仕分け・自動改名・自動退避を止めました。退避したファイルを元の場所へ戻します"
                   "（進み具合は、通知領域の「状態」で見られます）。")
        if not result["ok"] or result["reason"]:
            message += "注意：" + short_text(result["reason"])
        self.ui.notify("全復元を始めます", message, "warning")
        self.update_status(now, force=True)

    def run_restore_all(self, now):
        """全復元（メインのスレッドで行う。1件ごとに進み具合を画面に出す）"""
        self.restore_requested = False
        self.restoring = True
        try:
            counts = killswitch.restore_all(self.conn, self.platform, self.config,
                                            progress=self.on_restore_progress,
                                            should_stop=self.stop_event.is_set, now=now)
        except Exception:
            # 予想外のエラー：後で続きから試す（保管庫の内容と manifest.json は、どの場合も残っている）
            self.restore_requested = True
            self.restore_retry_at = now + RESTORE_RETRY_SECONDS
            self.ui.notify("全復元を続けられませんでした",
                           "予想外のエラーが起きました。しばらく後に、続きから試します"
                           "（python -m pip0 restore-all でも続けられます）。", "error")
            raise
        finally:
            self.restoring = False
        self.restore_counts = counts
        self.automation_engaged = True  # 全復元の後も、自動処理は止まったまま（勝手に再開しない）
        self.kill_event.set()
        if counts["finished"]:
            level = "info" if counts["failed"] == 0 and counts["missing"] == 0 else "warning"
            self.ui.notify("全復元が終わりました", restore_summary(counts), level)
        else:
            if not self.stop_event.is_set():
                self.restore_requested = True
                self.restore_retry_at = now + RESTORE_RETRY_SECONDS
            self.ui.notify("全復元は途中です",
                           f"残り {counts['remaining']} 件です。続きは後で行います"
                           "（もう一度実行すると、残りから続けます）。",
                           "warning")
        self.update_status(self.clock(), force=True)

    def on_restore_progress(self, counts):
        """全復元の1件ごとに呼ばれる：進み具合を画面に出す"""
        self.restore_counts = dict(counts)
        self.update_status(self.clock(), force=True)

    def check_vault(self, now):
        """保管庫の起動時の点検（vault.recover_incomplete）。確かめられなかった項目があれば、機能の状態に出す"""
        summary = vault.recover_incomplete(self.conn, self.platform, self.config, now=now)
        unresolved = summary["unresolved"] + len(summary["problems"])
        if unresolved:
            self.set_feature("vault_check", False,
                             f"確かめられなかった項目が {unresolved} 件あります"
                             "（pip0 シェルが動いていない等。シェルが動いたら確かめ直します）")
        else:
            self.set_feature("vault_check", True, "")

    # ==================================================================
    # 高負荷の処理（解析・退避）
    # ==================================================================

    def schedule_heavy_work(self, now):
        """条件を満たせば、次の高負荷の処理を1つ始める（解析を先に、次に退避）"""
        if self.current_job is not None or self.restore_requested or self.restoring or self.stop_event.is_set():
            return
        if self.automation_engaged or self.kill_event.is_set():
            return  # キルスイッチ：解析も退避も、再開まで始めない
        if not self.gate.may_run():
            return  # 電源接続中かつ3分間無操作、でなければ待つ
        job = self.next_analysis_job(now) or self.next_evacuation_job()
        if job is None:
            return
        if self.worker is None:
            # テスト用：スレッドを使わずに、ここで行う
            self.finish_job(job, self.run_job(job), self.clock())
        else:
            self.current_job = job
            self.worker.submit(job)

    def next_analysis_job(self, now):
        """解析の順番待ちから、次の1件を取り出す（ファイルがない・ゴーストのものは、解析せずに片付ける）"""
        while True:
            task = analysis_queue.next_task(self.conn, "analyse")
            if task is None:
                return None
            row = database.query_one(self.conn, "SELECT path, status FROM files WHERE id = ?", (task["file_id"],))
            if row is None or row["status"] != "present":
                analysis_queue.mark(self.conn, task["id"], "failed",
                                    error="ファイルが見つからないか、退避中のため、解析しません", now=now)
                continue
            analysis_queue.mark(self.conn, task["id"], "running", now=now)
            return {"kind": "analyse", "task_id": task["id"], "file_id": task["file_id"], "path": row["path"]}

    def next_evacuation_job(self):
        """退避の候補から、次の1件を取り出す（ゴーストを作れないときは、取り出さずに待つ）"""
        if not self.evacuation_queue or not self.ghosts_available():
            return None
        candidate = self.evacuation_queue.pop(0)
        return {"kind": "evacuate", "file_id": candidate["file_id"], "path": candidate["path"],
                "reasons": list(candidate["reasons"])}

    def run_job(self, job):
        """高負荷の処理を1つ行う（ワーカーのスレッドで呼ばれる。start_threads=False なら step の中）"""
        if job["kind"] == "analyse":
            # DB を使わない。区切りごとに条件（と、キルスイッチ・終了）を確かめ、満たさなければ一時停止する
            return analysis_queue.analyse_file(job["path"], self.platform, self.config, self.rules,
                                               self.gate.should_continue)
        if job["kind"] == "evacuate":
            # vault.evacuate は状態が変わるたびに manifest.json と DB を書くので、このスレッド専用の接続を使う
            return vault.evacuate(self.worker_connection(), self.platform, job["path"], self.config,
                                  reasons=job["reasons"], should_continue=self.gate.should_continue,
                                  actor="auto", rules=self.rules)
        raise ValueError(f"知らない仕事の種類です：{job['kind']}")

    def worker_connection(self):
        """ワーカーのスレッド専用の DB の接続（start_threads=False なら、メインの接続）"""
        if self.worker is None:
            return self.conn
        if self.worker_conn is None:
            self.worker_conn = database.open_database(self.config, self.keystore)
        return self.worker_conn

    def collect_worker_results(self, now):
        if self.worker is None:
            return
        while True:
            try:
                job, result = self.worker.results.get_nowait()
            except queue.Empty:
                return
            self.finish_job(job, result, now)

    def finish_job(self, job, result, now):
        """高負荷の処理の結果を、メインのスレッドで片付ける（解析の結果を DB に書く等）"""
        self.current_job = None
        if job["kind"] == "analyse":
            self.finish_analysis(job, result, now)
        else:
            logger.info("退避：%s（項目 %s）", result.get("state"), result.get("item_id"))

    def finish_analysis(self, job, result, now):
        status = result.get("status")
        if status == "paused":
            # 条件を満たさなくなった・止められた：結果は保存せず、待ちに戻す（次はこのファイルの最初から）
            analysis_queue.mark(self.conn, job["task_id"], "queued", now=now)
            return
        if status in ("skipped", "error"):
            # 使用中などで読めなかった。解析の行は「解析待ち」のまま残り、次の見直しのときにやり直す
            analysis_queue.mark(self.conn, job["task_id"], "failed", error=short_text(result.get("reason")), now=now)
            return
        row = database.query_one(self.conn, "SELECT path FROM files WHERE id = ?", (job["file_id"],))
        if row is None:
            analysis_queue.mark(self.conn, job["task_id"], "failed", error="索引の行がなくなりました", now=now)
            return
        analysis_queue.store_result(self.conn, job["file_id"], row["path"], result, self.config, self.rules, now)
        analysis_queue.mark(self.conn, job["task_id"], "done", now=now)
        self.apply_deferred_renames(now)  # 解析を待っていた改名（M1）があれば進める

    def check_evacuation(self, now):
        """EVACUATE_CHECK_HOURS ごとに、自動退避の候補を探す（キルスイッチの間と、無効のときは探さない）"""
        self.next_evacuation_check = now + self.config["EVACUATE_CHECK_HOURS"] * 3600
        if self.automation_engaged or not self.config.get("AUTO_EVACUATE_ENABLED") or not self.ghosts_available():
            self.evacuation_queue = []
            return
        self.record_access_times()
        self.evacuation_queue = evacuation.find_candidates(self.conn, self.platform, now, self.config, self.rules,
                                                           self.recent_items_enabled)
        if self.evacuation_queue:
            logger.info("自動退避の候補：%d 件", len(self.evacuation_queue))

    def record_access_times(self):
        """pip0 専用フォルダーのファイルの最終アクセス日時を、利用の記録に加える（更新が有効なドライブだけ）

        usage.tracking_sources は、最終アクセス日時を「閲覧を確かめる手段」として数えます。
        その日時を記録しておかないと、読んだだけ（変更していない）のファイルを、長期間未読と判定してしまうため、
        候補を探す前に記録します。
        pip0 自身の読み取り（解析・ハッシュ・コピー）は、最終アクセス日時を変えない開き方で行います（platform）。
        """
        rows = database.query_all(
            self.conn,
            "SELECT f.id, f.path, (SELECT max(u.at) FROM usage_events AS u "
            "WHERE u.file_id = f.id AND u.kind = 'access_time') AS last_access "
            "FROM files AS f WHERE f.location_kind = 'pip0_root' AND f.status = 'present'",
        )
        for row in rows:
            if self.platform.access_time_reliable(row["path"]) is not True:
                continue
            try:
                accessed = os.stat(row["path"]).st_atime
            except OSError:
                continue
            if row["last_access"] is None or accessed > row["last_access"] + 1:
                usage.record_usage(self.conn, row["id"], "access_time", accessed)

    def scan(self, now):
        """SCAN_MINUTES ごとに、対象フォルダーを見直す（一覧と日時だけ。中身は読まない）"""
        self.next_scan = now + self.config["SCAN_MINUTES"] * 60
        totals = scanner.scan_all(self.conn, self.platform, self.config, self.rules, now)
        if totals["folders"] == 0:
            self.set_feature("scan", False, "見直す対象のフォルダーが設定されていません")
        else:
            self.set_feature("scan", totals["ok"], totals["reason"])
        self.requeue_skipped_analyses(now)
        self.apply_deferred_renames(now)

    def requeue_skipped_analyses(self, now):
        """使用中などで読めずに終わった解析を、待ちに戻す（見直しのたびに1回。ファイルがあるものだけ）"""
        rows = database.query_all(
            self.conn,
            "SELECT t.file_id FROM tasks AS t "
            "JOIN analysis AS a ON a.file_id = t.file_id JOIN files AS f ON f.id = t.file_id "
            "WHERE t.kind = 'analyse' AND t.state = 'failed' AND a.status = 'pending' AND f.status = 'present'",
        )
        for row in rows:
            analysis_queue.enqueue(self.conn, "analyse", row["file_id"], now=now)

    # ==================================================================
    # 機能の状態と、状態の表示
    # ==================================================================

    def set_feature(self, feature, ok, reason, source="core"):
        """機能の状態を記録する。使えなくなったら理由を知らせる（失敗を成功として記録しない）"""
        old = self.features.get(feature)
        entry = {"feature": feature, "ok": bool(ok), "reason": short_text(reason),
                 "label": FEATURE_LABELS.get(feature, feature), "source": source}
        self.features[feature] = entry
        if old == entry:
            return
        if not ok and (old is None or old["ok"]):
            self.newly_failed.append(entry)
        logger.info("機能の状態：%s は %s", feature, "使えます" if ok else "使えません")
        if self.started:
            self.update_status(self.clock(), force=True)

    def flush_feature_notices(self):
        """使えなくなったばかりの機能を、まとめて1回だけ知らせる"""
        if not self.newly_failed:
            return
        lines = []
        for entry in self.newly_failed:
            lines.append(f"{entry['label']}：{entry['reason'] or '理由は分かりません'}")
        self.newly_failed = []
        self.ui.notify("使えない機能があります", "／".join(lines)[:TEXT_MAX_CHARS * 2], "warning")

    def feature_list(self):
        """機能の状態のリスト（pip0 本体の機能が先、次にシェルの機能を名前の順）"""
        core = [self.features[name] for name in CORE_FEATURES if name in self.features]
        others = [self.features[name] for name in sorted(self.features) if name not in CORE_FEATURES]
        return [{key: entry[key] for key in ("feature", "ok", "reason", "label")} for entry in core + others]

    def build_status(self, now):
        """状態（ui.status の内容）を作る。パス・ファイル名・ウィンドウタイトルは入れない"""
        if self.gate.is_older_than(self.config["THROTTLE_CHECK_SECONDS"]):
            self.gate.refresh()
        state = self.gate.state
        if self.restore_counts is not None:
            restore = dict(self.restore_counts)
        else:
            restore = killswitch.read_progress(self.config) or {}
        return {
            "automation": "stopped" if self.automation_engaged else "running",
            "throttle": {
                "allowed": state["allowed"],
                "power": state["power"],
                "idle_seconds": state["idle_seconds"],
                "reason": state["reason"],
                "history": [dict(entry) for entry in self.gate.history],
            },
            "restore": restore,
            "restoring": self.restoring,
            "features": self.feature_list(),
            "shell": {
                "connected": self.link is not None and self.link.is_alive(),
                "version": self.shell_version,
                "capabilities": self.shell_capabilities,
            },
            "analysis": {"pending": analysis_queue.pending_count(self.conn, "analyse")},
            "vault": self.vault_counts(),
            "evacuation_waiting": len(self.evacuation_queue),
            "ghost_open": self.fetch_summary(),
        }

    def vault_counts(self):
        rows = database.query_all(self.conn, "SELECT state, count(*) AS n FROM vault_items GROUP BY state")
        return {row["state"]: row["n"] for row in rows}

    def fetch_summary(self):
        """ゴーストを開いてから使えるまでの時間の実測（pip0 シェルの cf.fetch の elapsed_ms）"""
        if not self.fetch_times:
            return {"count": 0}
        times = [entry["elapsed_ms"] for entry in self.fetch_times]
        failed = sum(1 for entry in self.fetch_times if entry["result"] != "served")
        return {"count": len(times), "last_ms": times[-1], "median_ms": statistics.median(times),
                "max_ms": max(times), "failed": failed}

    def update_status(self, now, force=False):
        """状態を作り直し、変わっていれば画面に送り、状態のファイルにも書く"""
        if not self.started:
            return
        if not force and self.last_status_at is not None and now - self.last_status_at < STATUS_SECONDS:
            return
        status = self.build_status(now)
        self.last_status_at = now
        if force or status != self.last_status:
            self.ui.update_status(status)
            self.last_status = status
        if force or self.last_status_file_at is None or now - self.last_status_file_at >= STATUS_FILE_SECONDS:
            self.last_status_file_at = now
            self.write_status_file(status, running=True)

    def write_status_file(self, status, running):
        """状態を CONTROL_DIR/service.status.json に書く（python -m pip0 status が読む。パスや名前は書かない）"""
        path = control_file(self.config, STATUS_FILE_NAME)
        if path is None:
            return
        value = dict(status, running=running, pid=os.getpid(), instance=self.instance_id,
                     started_at=self.started_wall, updated_at=time.time())
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            fsutil.atomic_write_json(path, value)
        except OSError as error:
            logger.warning("状態のファイルを書けませんでした（%s）", type(error).__name__)


# ----------------------------------------------------------------------
# 小さな部品
# ----------------------------------------------------------------------


def valid_item_id(value):
    """保管庫の項目ID（32桁の16進数）にそろえて返す。形が違えば None"""
    if not isinstance(value, str):
        return None
    item_id = vault.normalise_item_id(value)
    return item_id if vault.is_valid_item_id(item_id) else None


def restore_summary(counts):
    """全復元の件数を、知らせの文にする"""
    text = (f"戻した {counts['restored']} 件、すでに戻っていた {counts['already']} 件、"
            f"衝突 {counts['conflict']} 件（元の場所に別のファイルがあったため、"
            f"横に「(pip0復元)」の名前で戻しました）、"
            f"開いた後の編集を残した {counts['local_newer']} 件、ゴーストが見つからない {counts['missing']} 件、"
            f"失敗 {counts['failed']} 件。")
    if counts["failed"] or counts["missing"]:
        text += "戻せなかった項目の中身は、保管庫に残っています（python -m pip0 vault list）。"
    text += "自動処理は止まったままです（再開は通知領域の「自動処理を再開」）。"
    return text
