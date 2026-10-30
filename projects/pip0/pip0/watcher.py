"""フォルダーの変更の監視と、ダウンロードの完了の確認（M1）

- FolderWatcher：watchdog ライブラリで、対象フォルダーの変更（作成・変更・名前の変更・削除）の知らせを受け取り、
  辞書にしてキュー（queue.Queue）へ入れます。Windows では ReadDirectoryChangesW が使われます。
- SelfChangeRegistry：pip0 自身が行った移動・改名を覚えておき、その知らせを無視できるようにします
  （自分の改名を「新しいファイル」と思って、また改名する、という繰り返しを防ぐため）。
- DownloadTracker：ダウンロードフォルダーの知らせと、ブラウザー拡張の「完了」の記録から、
  ダウンロードが完了したファイルを見分けます。完了を確かめていないファイルは、移動も改名もしません。

完了とみなす条件（docs/design.md 4-3）
1. 拡張機能の記録がある：そのパスのファイルが報告どおりの大きさで、途中の名前（.crdownload 等）でなく、
   ほかのプロセスが使っていない（排他的に開ける）とき。そろわなければ最大 DOWNLOAD_BROWSER_WAIT_SECONDS 秒待ち、
   その後は 2. の決まりで判断する。
2. 記録がない：途中の名前でなく、大きさと更新日時が DOWNLOAD_STABLE_SECONDS 秒変わらず、
   拡張機能の記録を DOWNLOAD_EVENT_WAIT_SECONDS 秒以上待ち、ほかのプロセスが使っていないとき。
"""

import logging
import os
import stat
import time

from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from pip0 import provenance, scanner

logger = logging.getLogger(__name__)

# キューへ入れる知らせの種類（watchdog の opened、closed などは使わない）
EVENT_KINDS = ["created", "modified", "moved", "deleted"]

# ★ブラウザーがダウンロードの途中に付ける名前の終わり（Chrome・Edge は .crdownload）。
# この名前から別の名前に変わったファイルは、新しく作られたファイル（ダウンロードの完了）として扱う
PARTIAL_DOWNLOAD_SUFFIXES = [".crdownload", ".part", ".partial", ".download"]

# 報告済みのファイルを覚えておく秒数（同じファイルを2回報告しないため）
REPORTED_MEMORY_SECONDS = 24 * 3600


# ----------------------------------------------------------------------
# フォルダーの監視（watchdog）
# ----------------------------------------------------------------------


class FolderWatcher:
    """対象フォルダーの変更の知らせを、辞書にして out_queue へ入れる

    folders：[(フォルダーのパス, location_kind), ...]（config.index_folders の結果）
    知らせの辞書：{"kind": "created"/"modified"/"moved"/"deleted", "path", "dest_path", "is_dir",
                  "location_kind", "at"}
    dest_path は、名前の変更・移動の後のパス（ほかの種類では None）。at は知らせを受けた時刻（秒）。
    """

    def __init__(self, folders, out_queue):
        self.folders = list(folders)
        self.out_queue = out_queue
        self.observer = None
        self.watching = 0

    def start(self):
        """監視を始める。戻り値：{"ok", "reason", "watching"（監視しているフォルダーの数）}"""
        if self.observer is not None:
            return {"ok": True, "reason": "", "watching": self.watching}
        observer = Observer()
        problems = []
        watching = 0
        for folder, location_kind in self.folders:
            if folder is None:
                continue
            label = scanner.LOCATION_LABELS.get(location_kind, location_kind)
            if not os.path.isdir(folder):
                problems.append(f"{label}：フォルダーが見つからないため、監視しません")
                continue
            handler = EventForwarder(location_kind, self.out_queue)
            try:
                observer.schedule(handler, os.fspath(folder), recursive=True)
            except OSError as error:
                problems.append(f"{label}：監視を始められません（{type(error).__name__}）")
                continue
            watching += 1
        if watching == 0:
            problems.append("監視できるフォルダーがありません")
            return {"ok": False, "reason": "／".join(problems), "watching": 0}
        try:
            observer.start()
        except OSError as error:
            observer.stop()  # 途中まで始まった監視のスレッドを止める
            reason = f"フォルダーの監視を始められませんでした（{type(error).__name__}）"
            return {"ok": False, "reason": reason, "watching": 0}
        self.observer = observer
        self.watching = watching
        logger.info("フォルダーの監視を始めました（%d か所）", watching)
        return {"ok": not problems, "reason": "／".join(problems), "watching": watching}

    def stop(self, timeout=5.0):
        """監視を止める（止まるまで最大 timeout 秒待つ）"""
        if self.observer is None:
            return
        self.observer.stop()
        self.observer.join(timeout)
        self.observer = None
        self.watching = 0


class EventForwarder(FileSystemEventHandler):
    """watchdog から呼ばれ、知らせを辞書にしてキューへ入れる（watchdog の決まりで、クラスにします）

    watchdog の監視のスレッドで動くため、ここでは DB を使わず、キューに入れるだけにします。
    """

    def __init__(self, location_kind, out_queue):
        super().__init__()
        self.location_kind = location_kind
        self.out_queue = out_queue

    def on_any_event(self, event):
        if event.event_type not in EVENT_KINDS:
            return
        dest_path = None
        if event.event_type == "moved":
            dest_path = os.fsdecode(event.dest_path)
        self.out_queue.put({
            "kind": event.event_type,
            "path": os.fsdecode(event.src_path),
            "dest_path": dest_path,
            "is_dir": bool(event.is_directory),
            "location_kind": self.location_kind,
            "at": time.time(),
        })


# ----------------------------------------------------------------------
# pip0 自身の変更の記録
# ----------------------------------------------------------------------


class SelfChangeRegistry:
    """pip0 自身が移動・改名したパスを、しばらく覚えておく

    fileops などが変更の直前に expect(パス, now) を呼び、常駐処理は監視の知らせごとに
    is_expected(パス, now) を確かめて、真なら知らせを無視します。
    パスは provenance.normalise_path でそろえて比べます（大文字・小文字と区切りの書き方の違いは無視）。
    """

    def __init__(self):
        self.expected = {}  # そろえたパス → いつまで覚えておくか（秒）

    def expect(self, path, now, seconds=10):
        """path の変更の知らせを、now から seconds 秒の間は pip0 自身のものとみなす"""
        key = provenance.normalise_path(path)
        until = now + seconds
        if key in self.expected:
            until = max(until, self.expected[key])
        self.expected[key] = until

    def is_expected(self, path, now):
        """path の知らせが pip0 自身の変更によるもの（期限内）なら True"""
        self.forget_expired(now)
        if not path:
            return False
        return provenance.normalise_path(path) in self.expected

    def forget_expired(self, now):
        """期限を過ぎたものを忘れる"""
        for key, until in list(self.expected.items()):
            if until < now:
                del self.expected[key]


# ----------------------------------------------------------------------
# ダウンロードの完了の確認
# ----------------------------------------------------------------------


def is_temporary_download_name(name, rules):
    """ダウンロード途中の名前（.crdownload 等）や一時ファイルの名前なら True

    rules.EXCLUDED_NAME_PATTERNS（索引にも入れない名前）を使います。
    この名前のファイルは、完了したダウンロードとして決して報告しません。
    """
    return scanner.is_excluded_name(name, rules)


def is_partial_download_name(name):
    """ブラウザーがダウンロードの途中に付ける名前（PARTIAL_DOWNLOAD_SUFFIXES）なら True"""
    lower = name.lower()
    for suffix in PARTIAL_DOWNLOAD_SUFFIXES:
        if lower.endswith(suffix):
            return True
    return False


class DownloadTracker:
    """ダウンロードが完了したファイルを見分ける（候補と報告済みの記録を持つので、クラスにしています）

    常駐処理のメインループから、次のように使います。
    - observe(event, now)：FolderWatcher の知らせを渡す
      （pip0 自身の移動・改名の知らせは、SelfChangeRegistry で除いてから渡す）
    - add_browser_event(row, now)：ブラウザー拡張の記録（download_events の行の辞書）を渡す
    - ready(now)：完了を確かめられたファイルのリストを受け取る。同じファイル（パス・大きさ・更新日時）は1回だけ返す
    対象は、ダウンロードフォルダー（DOWNLOADS_DIR）の中のファイルだけです。
    """

    def __init__(self, config, rules, platform):
        self.config = config
        self.rules = rules
        self.platform = platform
        self.candidates = {}  # そろえたパス → 候補（まだ完了を確かめていないファイル）の辞書
        self.reported = {}  # 報告済みの印 → 報告した時刻

    def observe(self, event, now):
        """FolderWatcher の知らせを1つ受け取る

        - created：新しいファイルを候補にする
        - moved：.crdownload などから最終的な名前に変わったら、新しいファイルとして候補にする
          （候補だったファイルの名前が変わったときも、新しい名前で候補にし直す）
        - deleted：候補から外す
        - modified：候補を新しく作らない（すでにあるファイルの編集は、ダウンロードではないため）。
          候補の大きさと更新日時は、ready で確かめ直す
        """
        if event.get("is_dir"):
            return
        kind = event.get("kind")
        if kind == "created":
            self._add_candidate(event.get("path"), now)
        elif kind == "moved":
            was_candidate = self._forget(event.get("path"))
            old_name = os.path.basename(event.get("path") or "")
            if was_candidate is not None or is_partial_download_name(old_name):
                self._add_candidate(event.get("dest_path"), now)
        elif kind == "deleted":
            self._forget(event.get("path"))

    def add_browser_event(self, row, now):
        """ブラウザー拡張の記録（download_events の行）を、そのパスの候補に結び付ける。結び付けたら True

        ダウンロードフォルダーの外や、途中の名前の記録は扱わない（False）。
        """
        candidate = self._add_candidate(row.get("filename"), now)
        if candidate is None:
            return False
        old_event = candidate["browser_event"]
        if old_event is None or old_event.get("id") != row.get("id"):
            # 同じ記録を何度渡されても、待つ時間を数え直さない
            candidate["browser_event"] = row
            candidate["browser_since"] = now
        return True

    def ready(self, now):
        """完了を確かめられたファイルのリスト：[{"path", "completed_at", "via", "download_event"}]

        via："browser_extension"（拡張機能の記録で確かめた）または "stable_size"（大きさと更新日時が安定した）
        completed_at：pip0 が完了を確かめた時刻（now）
        download_event：結び付いた拡張機能の記録（なければ None）
        """
        self._forget_old_reports(now)
        results = []
        for key in list(self.candidates):
            decision, result = self._check(self.candidates[key], now)
            if decision == "wait":
                continue
            del self.candidates[key]
            if decision == "ready":
                results.append(result)
        return results

    # --- ここから下は、このクラスの中だけで使う関数 ---

    def _add_candidate(self, path, now):
        """path を候補にして、候補の辞書を返す。候補にしないファイルなら None"""
        if not path or not self._inside_downloads(path):
            return None
        if is_temporary_download_name(os.path.basename(path), self.rules):
            return None  # ダウンロード途中・一時ファイルの名前は、候補にしない
        key = provenance.normalise_path(path)
        if key not in self.candidates:
            self.candidates[key] = {
                "path": os.fspath(path),
                "added_at": now,
                "state": None,  # 最後に調べた (大きさ, 更新日時)
                "stable_since": None,  # その状態を最初に見た時刻
                "browser_event": None,
                "browser_since": None,
            }
        return self.candidates[key]

    def _forget(self, path):
        """path の候補を外し、その辞書を返す（候補でなければ None）"""
        if not path:
            return None
        return self.candidates.pop(provenance.normalise_path(path), None)

    def _inside_downloads(self, path):
        downloads = self.config.get("DOWNLOADS_DIR")
        return downloads is not None and scanner.is_under(path, downloads)

    def _check(self, candidate, now):
        """候補を1つ確かめ、("wait", None)、("drop", None)、("ready", 結果の辞書) のどれかを返す"""
        path = candidate["path"]
        event = candidate["browser_event"]
        browser_wait = self.config["DOWNLOAD_BROWSER_WAIT_SECONDS"]
        try:
            st = os.lstat(path)
        except OSError:
            # ファイルがない。拡張機能の記録が先に届いたときは、少し待つ
            if event is not None and now - candidate["browser_since"] < browser_wait:
                return "wait", None
            return "drop", None
        if not stat.S_ISREG(st.st_mode):
            return "drop", None  # フォルダー、リンクなど
        size = st.st_size
        marks = self._marks(path, size, st.st_mtime_ns)
        if any(mark in self.reported for mark in marks):
            return "drop", None  # 同じファイル（パス・大きさ・更新日時）は、もう報告した
        if candidate["state"] != (size, st.st_mtime_ns):
            # 大きさか更新日時が変わった（または初めて調べた）。ここから、安定した時間を数え直す
            candidate["state"] = (size, st.st_mtime_ns)
            candidate["stable_since"] = now

        # 1. 拡張機能の記録がある：報告どおりの大きさで、ほかのプロセスが使っていなければ完了
        if event is not None:
            reported_size = event.get("file_size")
            size_matches = reported_size is None or reported_size < 0 or reported_size == size
            if size_matches and self.platform.can_open_exclusively(path):
                return "ready", self._report(path, marks, now, "browser_extension", event)
            if now - candidate["browser_since"] < browser_wait:
                return "wait", None
            if not size_matches:
                event = None  # 大きさが報告と違う：この記録は、今のファイルのものとは言えない

        # 2. 記録がない（または待ってもそろわない）：大きさと更新日時が安定したかで決める
        stable_for = now - candidate["stable_since"]
        if stable_for < self.config["DOWNLOAD_STABLE_SECONDS"]:
            return "wait", None
        if stable_for < self.config["DOWNLOAD_EVENT_WAIT_SECONDS"]:
            return "wait", None  # 拡張機能の記録が届くかもしれないので、もう少し待つ
        if size == 0 and event is None:
            # 0 バイトのファイルは、ダウンロードの場所を確保しただけのことがあるため、記録なしでは完了としない
            return "wait", None
        if not self.platform.can_open_exclusively(path):
            return "wait", None
        return "ready", self._report(path, marks, now, "stable_size", event)

    def _marks(self, path, size, mtime_ns):
        """報告済みかを調べる印のリスト（パスの印と、実体の番号 file_key の印）

        file_key の印があるので、報告したファイルの名前が変わっても、もう一度は報告しません。
        """
        marks = [("path", provenance.normalise_path(path), size, mtime_ns)]
        file_key = self.platform.get_file_key(path)
        if file_key is not None:
            marks.append(("file_key", file_key, size, mtime_ns))
        return marks

    def _report(self, path, marks, now, via, event):
        for mark in marks:
            self.reported[mark] = now
        logger.info("ダウンロードの完了を確かめました（%s）", via)
        return {"path": path, "completed_at": now, "via": via, "download_event": event}

    def _forget_old_reports(self, now):
        for mark, reported_at in list(self.reported.items()):
            if now - reported_at > REPORTED_MEMORY_SECONDS:
                del self.reported[mark]
