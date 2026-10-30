"""テストとデモ用の「代役」の OS 連携（FakePlatform）

Windows 以外（授業の Linux 環境、Colab、macOS）で、pip0 の Python の処理を試すためのものです。
電源・アイドル状態、ゴースト（Cloud Files API のプレースホルダー）、ごみ箱、確認画面を、
決められた規則でまねします。実際の Windows の動作を保証するものではありません。

代役のゴーストは、Windows の「中身をディスクに置かないプレースホルダー」をまねて、
元のサイズのまま中身をすべて 0 にしたファイル（スパースファイル）にします。
pip0 の処理がうっかりゴーストを直接読むと 0 が読めてしまい、テストで間違いに気付けます。
Windows では、アプリがゴーストを開くと OS が pip0 を呼び出して中身を戻します。
代役では simulate_app_open() がその動きをまねます。
"""

import hashlib
import json
import os
import shutil
from pathlib import Path


class FakePlatform:
    name = "fake"

    def __init__(self, idle_seconds=0.0, power="ac", vault_dir=None):
        # --- 電源とアイドル（None や "unknown" は「取得できない」） ---
        self.idle_seconds = idle_seconds
        self.power = power
        # --- ボリュームと同期フォルダー（パスの先頭 → 値） ---
        self.filesystems = {}          # 例 {"/tmp/x/usb": "exFAT"}。既定は NTFS
        self.drive_types = {}          # 例 {"/tmp/x/usb": "removable"}。既定は fixed
        self.other_sync_roots = {}     # 例 {"/tmp/x/OneDrive": "OneDrive"}
        self.sync_check_unknown = set()  # 同期フォルダーかどうか判定できない場所
        # --- ファイルの状態 ---
        self.not_local = set()         # ほかのクラウドの「未取得のプレースホルダー」をまねる
        self.pinned = set()            # 「常にこのデバイス上に保持する」
        self.locked = set()            # ほかのプロセスが開いている（排他的に開けない）
        self.zone_identifiers = {}     # パス → Zone.Identifier の中身
        self.file_attributes = {}      # パス → Windows のファイルの属性（例 stat.FILE_ATTRIBUTE_READONLY）
        self.access_time_reliable_value = False
        # --- ゴースト（Cloud Files API のまね） ---
        self.vault_dir = Path(vault_dir) if vault_dir else None
        self.registered_roots = set()
        self.ghosts = {}               # パス → {"item_id", "size", "mtime_ns", "dehydrated", "modified"}
        self.provider_running = True   # False にすると「pip0 が起動していない」状態
        # --- ごみ箱と確認画面 ---
        self.trash_dir = None
        self.recycle_bin_available = True  # False にすると、ごみ箱のない場所をまねる
        self.dialog_answer = "cancel"      # "approve" | "cancel" | "closed"
        self.dialog_requests = []
        # --- 障害の注入：操作名 → 次の1回だけ起こすこと（リストなら、呼ばれるたびに先頭から1つずつ。None は「いつもどおり」）---
        self.fail_next = {}
        self.calls = []

    # ------------------------------------------------------------------
    # 電源・アイドル
    # ------------------------------------------------------------------

    def get_idle_seconds(self):
        return self.idle_seconds

    def get_power_source(self):
        if self.power in ("ac", "battery"):
            return self.power
        return "unknown"

    # ------------------------------------------------------------------
    # ファイルとボリューム
    # ------------------------------------------------------------------

    def _match_prefix(self, table, path, default):
        path = str(Path(path))
        best = None
        for prefix, value in table.items():
            prefix = str(Path(prefix))
            if path == prefix or path.startswith(prefix + os.sep):
                if best is None or len(prefix) > len(best[0]):
                    best = (prefix, value)
        return best[1] if best else default

    def get_file_key(self, path):
        try:
            st = os.stat(path)
        except OSError:
            return None
        return f"{st.st_dev}:{st.st_ino}"

    def get_local_state(self, path):
        """Windows と同じ形。プレースホルダー（ゴースト）は、中身が戻った後も再解析ポイント（reparse=True）"""
        path = str(Path(path))
        attributes = self.file_attributes.get(path)
        if path in self.ghosts and self.ghosts[path]["dehydrated"]:
            return {"local": False, "placeholder": True, "pinned": False, "reparse": True,
                    "attributes": attributes, "reason": "pip0 のゴースト（中身は保管庫）"}
        if path in self.not_local:
            return {"local": False, "placeholder": True, "pinned": False, "reparse": True,
                    "attributes": attributes, "reason": "クラウドの未取得のプレースホルダー"}
        if path in self.ghosts:
            return {"local": True, "placeholder": True, "pinned": False, "reparse": True,
                    "attributes": attributes, "reason": "クラウドのプレースホルダーです（中身はこの PC にあります）"}
        is_link = os.path.islink(path)
        return {"local": not is_link, "placeholder": False, "pinned": path in self.pinned,
                "reparse": is_link, "attributes": attributes,
                "reason": "リンク（たどらない）" if is_link else ""}

    def get_volume_info(self, path):
        return {
            "filesystem": self._match_prefix(self.filesystems, path, "NTFS"),
            "drive_type": self._match_prefix(self.drive_types, path, "fixed"),
            "reason": "",
        }

    def check_sync_folder(self, path):
        if self._match_prefix({p: True for p in self.sync_check_unknown}, path, False):
            return {"inside": None, "provider": None, "reason": "同期フォルダーかどうか判定できません"}
        provider = self._match_prefix(self.other_sync_roots, path, None)
        if provider:
            return {"inside": True, "provider": provider, "reason": f"{provider} の同期フォルダーの中です"}
        return {"inside": False, "provider": None, "reason": ""}

    def access_time_reliable(self, path):
        return self.access_time_reliable_value

    def read_zone_identifier(self, path):
        return self.zone_identifiers.get(str(Path(path)))

    def write_zone_identifier(self, path, text):
        """ダウンロード元の印を付ける（Windows では、ファイルの Zone.Identifier の代替データストリームに書く）"""
        self.calls.append(("write_zone_identifier", str(path)))
        result = self._maybe_fail("write_zone_identifier")
        if result is not None:
            return result
        path = str(Path(path))
        if not os.path.exists(path) or path in self.zone_identifiers:
            return False
        self.zone_identifiers[path] = text
        return True

    def open_for_copy(self, path):
        self._maybe_fail("open_for_copy")
        if str(Path(path)) in self.locked:
            raise PermissionError(f"ほかのプロセスが使用中です: {path}")
        return open(path, "rb")

    def open_for_analysis(self, path):
        self._maybe_fail("open_for_analysis")
        return open(path, "rb")

    def can_open_exclusively(self, path):
        return str(Path(path)) not in self.locked and os.path.exists(path)

    def known_downloads_dir(self):
        return None

    # ------------------------------------------------------------------
    # ゴースト（Cloud Files API のまね）
    # ------------------------------------------------------------------

    def register_sync_root(self, path, display_name):
        self.calls.append(("register_sync_root", str(path)))
        result = self._maybe_fail("register_sync_root")
        if result is not None:
            return result
        info = self.get_volume_info(path)
        if info["filesystem"] != "NTFS":
            return {"ok": False, "reason": f"{info['filesystem']} のため登録できません（NTFS のみ）"}
        sync = self.check_sync_folder(path)
        if sync["inside"] is not False:
            return {"ok": False, "reason": sync["reason"] or "同期フォルダーの判定ができません"}
        self.registered_roots.add(str(Path(path)))
        return {"ok": True, "reason": ""}

    def is_sync_root_registered(self, path):
        return str(Path(path)) in self.registered_roots

    def _inside_registered_root(self, path):
        return self._match_prefix({r: True for r in self.registered_roots}, path, False)

    def ghost_status(self, path):
        result = self._maybe_fail("ghost_status")
        if result is not None:
            return result
        path = str(Path(path))
        if not os.path.exists(path):
            return {"exists": False, "is_ghost": False, "item_id": None, "dehydrated": None,
                    "in_sync": None, "pinned": None, "reason": "ファイルがありません"}
        ghost = self.ghosts.get(path)
        if ghost is None:
            return {"exists": True, "is_ghost": False, "item_id": None, "dehydrated": False,
                    "in_sync": None, "pinned": path in self.pinned, "reason": ""}
        return {"exists": True, "is_ghost": True, "item_id": ghost["item_id"], "dehydrated": ghost["dehydrated"],
                "in_sync": not ghost["modified"], "pinned": False, "reason": ""}

    def make_ghost(self, path, item_id, expected):
        """中身を保管庫に預けたファイルを、元の場所のままゴーストにする（まね）"""
        self.calls.append(("make_ghost", str(path), item_id))
        result = self._maybe_fail("make_ghost")
        if result is not None:
            return result
        path = str(Path(path))
        if not self.provider_running:
            return {"result": "unavailable", "reason": "OS 連携（pip0 シェル）が動いていません"}
        if not self._inside_registered_root(path):
            return {"result": "not_in_root", "reason": "同期ルートの外にあります"}
        if path in self.locked:
            return {"result": "locked", "reason": "ほかのプロセスが使用中です"}
        try:
            st = os.stat(path)
        except OSError:
            return {"result": "changed", "reason": "ファイルが見つかりません"}
        if (st.st_size != expected["size"] or st.st_mtime_ns != expected["mtime_ns"]
                or self.get_file_key(path) != expected["file_key"]):
            return {"result": "changed", "reason": "保管庫へのコピーの後に、ファイルが変わりました"}
        if expected.get("sha256") and file_sha256(path) != expected["sha256"]:
            return {"result": "changed", "reason": "内容のハッシュが一致しません"}
        # 本物のシェルと同じく、保管庫の内容と manifest.json も、期待どおりかを確かめてから中身を外す。
        # manifest.json がない（テストが保管庫を使わずに直接ゴーストを作る）ときは、この確認を省く
        # （本物のシェルは、保管庫の内容がないと "error" を返す）
        if self.vault_dir is not None and (self.vault_dir / "items" / item_id / "manifest.json").exists():
            content, manifest = self._vault_content(item_id)
            if (manifest.get("item_id") != item_id or manifest.get("size") != expected["size"]
                    or manifest.get("sha256") != expected.get("sha256")
                    or not content.exists() or file_sha256(content) != expected.get("sha256")):
                return {"result": "changed", "reason": "保管庫の内容が、期待した内容と一致しません"}
        # 中身を捨てて、元のサイズのスパースファイルにする（Windows の「ディスク上 0 バイト」のまね）
        with open(path, "r+b") as f:
            f.truncate(0)
            f.truncate(expected["size"])
        os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns))
        self.ghosts[path] = {"item_id": item_id, "size": expected["size"], "mtime_ns": st.st_mtime_ns,
                             "dehydrated": True, "modified": False}
        return {"result": "ghosted", "reason": ""}

    def locate_ghost(self, item_id):
        """pip0 専用フォルダー（同期ルート）の中で、この項目のゴーストの場所を探す（Windows では cf.locate）"""
        self.calls.append(("locate_ghost", item_id))
        result = self._maybe_fail("locate_ghost")
        if result is not None:
            return result
        if not self.provider_running:
            return {"result": "unknown", "paths": [], "reason": "OS 連携（pip0 シェル）が動いていません"}
        paths = sorted(path for path, ghost in self.ghosts.items()
                       if ghost["item_id"] == item_id and os.path.exists(path) and self._inside_registered_root(path))
        if paths:
            return {"result": "found", "paths": paths, "reason": ""}
        return {"result": "not_found", "paths": [], "reason": ""}

    def _vault_content(self, item_id):
        item_dir = self.vault_dir / "items" / item_id
        manifest = json.loads((item_dir / "manifest.json").read_text(encoding="utf-8"))
        return item_dir / "content", manifest

    def _hydrate(self, path):
        """保管庫から中身を戻す（Windows では OS が pip0 シェルの FETCH_DATA を呼ぶ）"""
        ghost = self.ghosts[path]
        if not self.provider_running:
            raise OSError("クラウド ファイル プロバイダーが実行されていません（pip0 が起動していません）")
        content, manifest = self._vault_content(ghost["item_id"])
        if file_sha256(content) != manifest["sha256"]:
            raise OSError("保管庫の内容のハッシュが一致しないため、中身を戻しません")
        st = os.stat(path)
        shutil.copyfile(content, path)
        os.utime(path, ns=(st.st_atime_ns, ghost["mtime_ns"]))
        ghost["dehydrated"] = False

    def restore_ghost(self, path, item_id):
        """ゴーストを通常のファイルに戻す（中身がなければ保管庫から戻す）"""
        self.calls.append(("restore_ghost", str(path), item_id))
        result = self._maybe_fail("restore_ghost")
        if result is not None:
            return result
        path = str(Path(path))
        if not os.path.exists(path):
            return {"result": "missing", "reason": "元の場所にファイルがありません"}
        ghost = self.ghosts.get(path)
        if ghost is None:
            return {"result": "already_regular", "reason": "ゴーストではなく、通常のファイルです"}
        if ghost["item_id"] != item_id:
            return {"result": "not_our_placeholder", "reason": "別の項目のゴーストです"}
        if not self.provider_running:
            return {"result": "unavailable", "reason": "OS 連携（pip0 シェル）が動いていません"}
        if ghost["dehydrated"]:
            try:
                self._hydrate(path)
            except OSError as error:
                return {"result": "error", "reason": str(error)}
        del self.ghosts[path]
        return {"result": "restored", "reason": ""}

    # --- テストで「ユーザーやほかのアプリの操作」をまねるための関数 ---

    def simulate_app_open(self, path):
        """通常のアプリがファイルを開いて読む。ゴーストなら OS が中身を戻してから読ませる"""
        path = str(Path(path))
        if path in self.ghosts and self.ghosts[path]["dehydrated"]:
            self._hydrate(path)
        with open(path, "rb") as f:
            return f.read()

    def simulate_app_modify(self, path, data):
        path = str(Path(path))
        if path in self.ghosts and self.ghosts[path]["dehydrated"]:
            self._hydrate(path)
        with open(path, "wb") as f:
            f.write(data)
        if path in self.ghosts:
            self.ghosts[path]["modified"] = True

    def simulate_user_delete(self, path):
        path = str(Path(path))
        self.ghosts.pop(path, None)
        self.zone_identifiers.pop(path, None)  # 代替データストリームも、ファイルと一緒に消える
        os.remove(path)

    def simulate_user_rename(self, old_path, new_path):
        """ユーザーがファイルかフォルダーの名前を変える（フォルダーなら、中のゴーストも一緒に動く）"""
        old_path, new_path = str(Path(old_path)), str(Path(new_path))
        os.rename(old_path, new_path)
        for table in (self.ghosts, self.zone_identifiers):  # 代替データストリームも、ファイルと一緒に動く
            for path in list(table):
                if path == old_path:
                    table[new_path] = table.pop(path)
                elif path.startswith(old_path + os.sep):
                    table[new_path + path[len(old_path):]] = table.pop(path)

    # ------------------------------------------------------------------
    # 削除の確認とごみ箱
    # ------------------------------------------------------------------

    def confirm_and_recycle(self, request):
        """確認画面を出し（代役では dialog_answer を答えとする）、承認されたものだけをごみ箱へ移す"""
        self.dialog_requests.append(request)
        answer = self.dialog_answer
        items = request["items"]
        if answer != "approve":
            return {"approved": False, "answer": answer,
                    "results": [{"path": item["path"], "status": "not_attempted",
                                 "reason": "確認画面で承認されませんでした"} for item in items]}
        results = []
        for item in items:
            path = item["path"]
            if not self.recycle_bin_available:
                results.append({"path": path, "status": "refused",
                                "reason": "この場所ではごみ箱を使えないため、削除しませんでした（完全削除はしません）"})
                continue
            if not os.path.exists(path):
                results.append({"path": path, "status": "failed", "reason": "ファイルが見つかりません"})
                continue
            self.trash_dir.mkdir(parents=True, exist_ok=True)
            target = self.trash_dir / Path(path).name
            number = 2
            while target.exists():
                target = self.trash_dir / f"{Path(path).stem} ({number}){Path(path).suffix}"
                number += 1
            shutil.move(path, target)
            results.append({"path": path, "status": "recycled", "reason": "", "recycle_path": str(target)})
        return {"approved": True, "answer": "approve", "results": results}

    # ------------------------------------------------------------------

    def _maybe_fail(self, operation):
        """fail_next に登録された障害を1回だけ起こす（例外なら投げ、辞書なら結果として返す）

        リストなら、呼ばれるたびに先頭から1つずつ使う（None は「この回はいつもどおり」）。
        """
        action = self.fail_next.pop(operation, None)
        if isinstance(action, list):
            if len(action) > 1:
                self.fail_next[operation] = action[1:]
            action = action[0] if action else None
        if action is None:
            return None
        if isinstance(action, BaseException):
            raise action
        return action


def file_sha256(path, chunk_size=1024 * 1024):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()
