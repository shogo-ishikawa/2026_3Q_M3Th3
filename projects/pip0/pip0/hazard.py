"""機密ファイルのドラッグの警告（M5 スマート・ハザードガード）

pip0 シェルは、エクスプローラー（デスクトップを含む）や pip0 のデスクからのドラッグを見つけると、
drag.started（ドラッグ中のファイルのパス）、drag.target_changed（マウスの下のアプリ）、
drag.ended（ボタンを離した所のアプリ）を本体へ知らせます。このモジュールは、
「警告の枠を出すか・隠すか」と「続行したとみなして消音するか」を決めます。画面の枠を描くのはシェルです。

- evaluate_items：ドラッグ中のファイルを、機密（赤い枠）・未判定（橙色の枠）・どちらでもない に分ける。
  判定は sensitivity.overall（名前・場所の規則は、解析していなくても使える）。DB の解析結果を使い、重い解析はしない
- HazardSession：1つのセッション（pip0 の起動・ロック解除・スリープからの復帰から、画面のロック・サインアウト・
  スリープ・pip0 の終了まで）の、警告の表示と消音の決まり（docs/design.md 4-7）
  - 続行：警告が HAZARD_MIN_VISIBLE_SECONDS（0.5秒）以上表示された後に、ドラッグ元と別のアプリ
    （pip0 以外）の上でボタンが離されたとき。送り先がドロップを受け入れたかは、Windows から分からない
  - 消音：続行した「ファイル × 送り先のアプリ」の組だけ。別のファイル、別のアプリでは警告する
  - 消音の記録はメモリーだけに持ち、セッションの終わり（end_session）で消える。保存しない
この機能は警告だけです。送信を止める機能（DLP）ではありません。
"""

import logging
import os

from pip0 import database, sensitivity, usage

logger = logging.getLogger(__name__)

# セッションを終える出来事（画面のロック、サインアウト、スリープ、Windows の終了、pip0 の終了）
# session.event の kind（lock、logoff、suspend、shutdown）と、pip0 自身の終了（pip0_exit）
SESSION_END_REASONS = ["lock", "logoff", "suspend", "shutdown", "pip0_exit"]
# 新しいセッションが始まる出来事（ロック解除、スリープからの復帰）。終わりの知らせを受け取り損ねたときに備えて、
# これらでも消音を消す（前のセッションの消音を持ち越さない）
SESSION_START_REASONS = ["unlock", "resume"]

# 判定の表示名
LEVEL_LABELS = {"sensitive": "機密", "unknown": "未判定", "not_sensitive": "非機密"}

# 前回の解析で機密だったが、変更の後にまだ解析し直していないときの補足
STALE_SENSITIVE_NOTE = "前回の解析では機密でした（変更の後、まだ解析し直していないため、機密として扱います）"
NOT_INDEXED_REASON = "pip0 の索引にないため、中身で判定できません（解析の対象フォルダーの外か、まだ見直していないファイル）"
FOLDER_REASON = "フォルダーの中身は調べていないため、判定できません"


# ----------------------------------------------------------------------
# ドラッグ中のファイルの判定
# ----------------------------------------------------------------------


def evaluate_items(conn, paths, config, rules):
    """ドラッグ中のファイルを判定する

    conn：暗号化DB（使えないときは None。名前と場所の規則だけで判定する）
    戻り値：{"level": "sensitive"/"unknown"/"none", "items", "message"}
    - items：[{"path", "name", "level": "sensitive"/"unknown"/"not_sensitive", "reasons", "file_id"}, ...]
    - level：機密が1つでもあれば "sensitive"。なければ、未判定があり WARN_UNANALYSED が True なら "unknown"。
      それ以外は "none"（警告しない）
    """
    items = []
    for path in paths or []:
        items.append(evaluate_one(conn, os.fspath(path), config, rules))
    hazards = [item for item in items if is_hazard(item["level"], config["WARN_UNANALYSED"])]
    if any(item["level"] == "sensitive" for item in hazards):
        level = "sensitive"
    elif hazards:
        level = "unknown"
    else:
        level = "none"
    return {"level": level, "items": items, "message": warning_message(level, hazards)}


def evaluate_one(conn, path, config, rules):
    """1つのファイル（またはフォルダー）の判定

    1. sensitivity.overall：今の名前・場所の規則と、解析済み（done）の中身で判定する
    2. 中身の解析がまだ終わっていない（変更の後の解析し直し待ちなど）のに、前回の解析の本文・タイトル・ラベルが
       機密の規則に当てはまるなら、機密として扱う（警告を弱めない）。前回の名前の規則の理由は使わない
       （名前を変えた後に、古い名前の理由を出さないため）
    """
    name = os.path.basename(path.rstrip("\\/")) or path
    file_id = usage.find_file_id(conn, path) if conn is not None else None
    analysis = None
    if file_id is not None:
        analysis = database.query_one(conn, "SELECT * FROM analysis WHERE file_id = ?", (file_id,))
    verdict = sensitivity.overall(path, analysis, config, rules)
    level = verdict["level"]
    reasons = list(verdict["reasons"])

    if level != "sensitive" and analysis is not None and analysis.get("status") != "done":
        previous = sensitivity.judge_content(analysis, rules)  # 前回の解析で残っている中身で判定し直す
        if previous:
            level = "sensitive"
            reasons = previous + [STALE_SENSITIVE_NOTE]
    if level == "unknown" and file_id is None:
        reasons = [FOLDER_REASON if os.path.isdir(path) else NOT_INDEXED_REASON]
    return {"path": path, "name": name, "level": level, "reasons": reasons, "file_id": file_id}


def is_hazard(level, warn_unanalysed):
    """警告の対象なら True（機密。未判定は warn_unanalysed（設定の WARN_UNANALYSED）が True のときだけ）"""
    if level == "sensitive":
        return True
    return level == "unknown" and bool(warn_unanalysed)


def warning_message(level, hazards):
    """警告の枠に出す文（★文を変えたいときは、ここを直します）"""
    if level == "sensitive":
        count = sum(1 for item in hazards if item["level"] == "sensitive")
        return f"機密のファイルを含むドラッグです（{count}件）。送り先を確かめてください（pip0 は送信を止めません）"
    if level == "unknown":
        return (f"機密か未判定のファイルを含むドラッグです（未判定 {len(hazards)}件）。"
                "送り先を確かめてください（pip0 は送信を止めません）")
    return "機密・未判定のファイルはありません"


# ----------------------------------------------------------------------
# セッションの中の、警告の表示と消音
# ----------------------------------------------------------------------


class HazardSession:
    """1つのセッションの間の、警告の表示と消音を決める（消音の記録はメモリーだけ）

    start_drag と target_changed は動作のリストを返します。
    - {"do": "show", "hazard": ui.hazard.show の内容}（赤：sensitive、橙：unknown）
    - {"do": "hide"}
    end_drag は {"actions", "muted", "continued"} を返します。
    """

    def __init__(self, config):
        self.min_visible = config["HAZARD_MIN_VISIBLE_SECONDS"]
        self.warn_unanalysed = bool(config["WARN_UNANALYSED"])
        self.muted = set()     # 消音した (ファイルの識別子, 送り先のプロセス名) の組
        self.drag = None       # 今のドラッグ
        self.last_end_reason = None

    def start_drag(self, drag_id, evaluation, file_keys, source_process, now):
        """ドラッグが始まった

        evaluation：evaluate_items の結果。file_keys：evaluation["items"] と同じ順の、ファイルの識別子
        （platform.get_file_key の値。分からなければ None。そのときはパスを識別子にする）
        ドラッグのファイルがすべて「どこかのアプリに対して消音中」なら、ここでは出さずに、送り先が分かるのを待つ。
        """
        items = evaluation.get("items") or []
        if len(file_keys) != len(items):
            raise ValueError("file_keys は evaluation の items と同じ数にしてください")
        actions = []
        if self.drag is not None and self.drag["visible"]:
            actions.append({"do": "hide"})  # 前のドラッグの終わりが届かなかった
        hazards = []
        for item, file_key in zip(items, file_keys):
            if is_hazard(item["level"], self.warn_unanalysed):
                hazards.append({"key": mute_key(file_key, item["path"]), "name": item["name"],
                                "level": item["level"], "reasons": list(item["reasons"])})
        self.drag = {"drag_id": drag_id, "source": process_key(source_process), "hazards": hazards,
                     "visible": False, "visible_since": None, "shown": None}
        if not hazards:
            return actions
        if all(self.muted_somewhere(hazard["key"]) for hazard in hazards):
            return actions  # 消音中のファイルだけ：消音していないアプリの上に来たら出す
        return self.show(hazards, now, actions)

    def target_changed(self, drag_id, target_process, now):
        """ドラッグ中に、マウスの下のアプリが変わった

        送り先が、警告の対象のファイルすべてについて消音中なら隠し、そうでなければ出す。
        """
        drag = self.drag
        if drag is None or drag["drag_id"] != drag_id or not drag["hazards"]:
            return []
        target = process_key(target_process)
        unmuted = [hazard for hazard in drag["hazards"] if (hazard["key"], target) not in self.muted]
        if not unmuted:
            return self.hide([])
        return self.show(unmuted, now, [])

    def end_drag(self, drag_id, target_process, dropped_on_other_process, now):
        """ドラッグが終わった（ボタンが離された）。続行したかを判定し、消音する

        戻り値：{"actions", "muted": [新しく消音した (ファイルの識別子, プロセス名)], "continued"}
        """
        result = {"actions": [], "muted": [], "continued": False}
        drag = self.drag
        if drag is None or drag["drag_id"] != drag_id:
            return result
        self.drag = None
        visible_for = now - drag["visible_since"] if drag["visible"] else 0.0
        if drag["visible"]:
            result["actions"].append({"do": "hide"})
        if not drag["hazards"]:
            return result

        target = process_key(target_process)
        other_app = (dropped_on_other_process is True and target is not None and target != drag["source"]
                     and target not in usage.PIP0_PROCESS_NAMES)
        if drag["visible"] and visible_for >= self.min_visible and other_app:
            result["continued"] = True
            for hazard in drag["hazards"]:
                pair = (hazard["key"], target)
                if pair not in self.muted:
                    self.muted.add(pair)
                    result["muted"].append(pair)
            logger.info("警告の後に続行したため、%d 組を消音しました（このセッションの間だけ）", len(result["muted"]))
        return result

    def end_session(self, reason):
        """セッションが終わった（画面のロック、サインアウト、スリープ、Windows の終了、pip0 の終了）

        消音の記録と、今のドラッグを忘れる。動作のリスト（警告を出していれば {"do": "hide"}）を返す。
        reason：SESSION_END_REASONS のどれか。新しいセッションの始まり（SESSION_START_REASONS）も受け付け、
        同じように消音を消す（終わりの知らせを受け取り損ねても、前のセッションの消音を持ち越さないため）
        """
        if reason not in SESSION_END_REASONS and reason not in SESSION_START_REASONS:
            raise ValueError(f"知らないセッションの区切りです: {reason}")
        actions = [{"do": "hide"}] if self.drag is not None and self.drag["visible"] else []
        count = len(self.muted)
        self.muted.clear()
        self.drag = None
        self.last_end_reason = reason
        logger.info("セッションが終わったため（%s）、消音を %d 組解除しました", reason, count)
        return actions

    def muted_pairs(self):
        """消音中の (ファイルの識別子, 送り先のプロセス名) の組のリスト"""
        return sorted(self.muted)

    # --- 内部で使う部品 ---

    def muted_somewhere(self, key):
        """そのファイルが、どれかのアプリに対して消音中なら True"""
        return any(pair[0] == key for pair in self.muted)

    def show(self, hazards, now, actions):
        drag = self.drag
        hazard = warning_payload(hazards)
        if not drag["visible"]:
            drag["visible"] = True
            drag["visible_since"] = now  # 出し始めた時刻（続行の判定に使う）
        elif hazard == drag["shown"]:
            return actions  # 同じ内容を出し直さない
        drag["shown"] = hazard
        actions.append({"do": "show", "hazard": hazard})
        return actions

    def hide(self, actions):
        drag = self.drag
        if drag["visible"]:
            drag["visible"] = False
            drag["visible_since"] = None
            drag["shown"] = None
            actions.append({"do": "hide"})
        return actions


def warning_payload(hazards):
    """ui.hazard.show の内容（docs/ipc-protocol.md 3節）。機密が1つでもあれば赤、なければ橙"""
    level = "sensitive" if any(hazard["level"] == "sensitive" for hazard in hazards) else "unknown"
    return {
        "level": level,
        "message": warning_message(level, hazards),
        "items": [{"name": hazard["name"], "level": hazard["level"], "reasons": list(hazard["reasons"])}
                  for hazard in hazards],
    }


def mute_key(file_key, path):
    """消音に使うファイルの識別子。file_key（ボリューム番号:ファイル番号）がなければパス（小文字）"""
    if file_key:
        return str(file_key)
    return "path:" + os.path.normcase(os.path.normpath(os.fspath(path))).lower()


def process_key(process):
    """プロセス名を比べるための形（小文字）。分からなければ None"""
    if not process:
        return None
    return str(process).strip().lower() or None
