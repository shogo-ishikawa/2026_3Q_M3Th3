"""浮上式デスク（M2 作業連動・浮上式デスク）

作業中のアプリの文脈（context.py）に関係しそうなファイルを、上位3件まで、画面の端
（前面がファイルダイアログなら、ダイアログの上辺）に出します。画面を描くのは pip0 シェルで、
このモジュールは「どのファイルを、いつ出すか・隠すか」を決めます。

- rank_files：索引（files）、解析の結果（analysis）、入手経路（provenance）、利用の記録（usage_events）から
  関連度の点数を計算し、上位を返す。DB にある情報だけを使い、重い解析はしない
- DeskController：表示・非表示の決まり（シェイクで隠す、再表示の条件、通知領域からの表示）
- ShakeDetector：マウスの左右の振り（シェイク）を見分ける

点数の決まり（docs/design.md 4-4。★点数は下の定数で変えられます）
  文脈の語ごとに：ファイル名かタイトルに含まれれば +3、本文（解析済み）に含まれれば +2
  入手経路が作業中のアプリと同じ（Slack を使っているときに、Slack から入手したファイル）なら +2
  7日以内に使用・変更されていれば +1、30日以内なら +0.5
  DESK_MIN_SCORE 以上の上位 DESK_MAX_ITEMS 件を出す（候補が少なければ、その件数だけ）
"""

import logging

from pip0 import context as context_module
from pip0 import database, timeutil, usage

logger = logging.getLogger(__name__)

# ★点数（docs/design.md 4-4）
NAME_OR_TITLE_POINTS = 3  # 文脈の語が、ファイル名か文書のタイトルにある
TEXT_POINTS = 2           # 文脈の語が、解析した本文にある
SAME_SOURCE_POINTS = 2    # 入手経路が、作業中のアプリと同じ
WEEK_POINTS = 1           # WEEK_DAYS 日以内に使用・変更
MONTH_POINTS = 0.5        # MONTH_DAYS 日以内に使用・変更
WEEK_DAYS = 7
MONTH_DAYS = 30

SECONDS_PER_DAY = 24 * 60 * 60

# 候補にするファイル（存在するもの、退避中のゴースト）と、その解析結果・入手経路
FILES_SQL = (
    "SELECT f.id, f.path, f.name, f.status, f.mtime, a.status AS analysis_status, a.title, a.text_excerpt, "
    "p.source_label "
    "FROM files AS f "
    "LEFT JOIN analysis AS a ON a.file_id = f.id "
    "LEFT JOIN provenance AS p ON p.file_id = f.id "
    "WHERE f.status IN ('present', 'ghost') "
    "ORDER BY f.id"
)


# ----------------------------------------------------------------------
# 順位の計算
# ----------------------------------------------------------------------


def rank_files(conn, context, now, config, rules, limit=3):
    """作業文脈に関係しそうなファイルを、点数の高い順に返す

    context：context.parse_foreground の辞書（分からなければ None）
    rules：今は使いません（点数の規則を rules.py に移すときのために受け取ります）
    戻り値：[{"file_id", "path", "name", "status", "score", "reasons"}, ...]
    - DESK_MIN_SCORE 以上のものだけ。多くても limit 件と DESK_MAX_ITEMS 件の少ないほう
    - 同じ点数なら、最近使った・変更したものを先にする
    """
    keywords = []
    app_label = None
    if context:
        keywords = [word for word in context.get("keywords") or [] if word]
        app_label = context.get("app")
    count = config["DESK_MAX_ITEMS"] if limit is None else min(limit, config["DESK_MAX_ITEMS"])
    if count <= 0:
        return []

    recent = recent_uses(conn, now)
    ranked = []
    for row in database.query_all(conn, FILES_SQL):
        score, reasons, last_at = score_file(row, keywords, app_label, recent.get(row["id"]), now)
        if score < config["DESK_MIN_SCORE"]:
            continue
        ranked.append({"file_id": row["id"], "path": row["path"], "name": row["name"], "status": row["status"],
                       "score": score, "reasons": reasons, "last_at": last_at})

    # 点数の高い順。同じ点数なら最近使ったもの、次に名前の順
    ranked.sort(key=lambda item: (-item["score"], -(item["last_at"] or 0.0), item["name"], item["file_id"]))
    result = []
    for item in ranked[:count]:
        del item["last_at"]
        result.append(item)
    logger.debug("デスクの候補：%d 件（文脈の語 %d 個）", len(result), len(keywords))
    return result


def score_file(row, keywords, app_label, recent_use, now):
    """1つのファイルの点数と理由を計算する。(点数, 理由のリスト, 最後に使った時刻) を返す"""
    score = 0.0
    reasons = []
    analysed = row["analysis_status"] == "done"
    title = row["title"] if analysed else None
    text = row["text_excerpt"] if analysed else None

    for keyword in keywords:
        places = []
        if context_module.contains_word(row["name"], keyword):
            places.append("ファイル名")
        if context_module.contains_word(title, keyword):
            places.append("タイトル")
        if places:
            score += NAME_OR_TITLE_POINTS
            reasons.append(f"{'・'.join(places)}に「{keyword}」（+{NAME_OR_TITLE_POINTS}）")
        if context_module.contains_word(text, keyword):
            score += TEXT_POINTS
            reasons.append(f"本文に「{keyword}」（+{TEXT_POINTS}）")

    source = row["source_label"]
    if app_label and source and context_module.fold(source) == context_module.fold(app_label):
        score += SAME_SOURCE_POINTS
        reasons.append(f"作業中のアプリと同じ {source} から入手（+{SAME_SOURCE_POINTS}）")

    last = latest_use(row, recent_use)
    if last is not None:
        days = (now - last["at"]) / SECONDS_PER_DAY
        when = f"{timeutil.local_date_str(last['at'])}、{usage.USAGE_KIND_LABELS.get(last['kind'], last['kind'])}"
        if days <= WEEK_DAYS:
            score += WEEK_POINTS
            reasons.append(f"{WEEK_DAYS}日以内に使用・変更（{when}）（+{WEEK_POINTS}）")
        elif days <= MONTH_DAYS:
            score += MONTH_POINTS
            reasons.append(f"{MONTH_DAYS}日以内に使用・変更（{when}）（+{MONTH_POINTS}）")
    return score, reasons, (last["at"] if last else None)


def recent_uses(conn, now):
    """MONTH_DAYS 日以内の利用の記録のうち、ファイルごとに最も新しいもの {file_id: {"at", "kind"}}

    usage.last_use と同じ決まり（usage_events と、files の最終更新日時）を、ファイルごとに問い合わせると
    遅くなるため、ここでまとめて1回で読みます。最終更新日時は latest_use で比べます。
    """
    since = now - MONTH_DAYS * SECONDS_PER_DAY
    latest = {}
    rows = database.query_all(conn, "SELECT file_id, kind, at FROM usage_events WHERE at >= ? ORDER BY at, id",
                              (since,))
    for row in rows:
        latest[row["file_id"]] = {"at": row["at"], "kind": row["kind"]}  # 新しい記録で上書きする
    return latest


def latest_use(row, recent_use):
    """最終更新日時（files.mtime）と利用の記録の、新しいほう {"at", "kind"}。どちらもなければ None"""
    best = None
    if row["mtime"] is not None:
        best = {"at": float(row["mtime"]), "kind": "modified"}
    if recent_use is not None and (best is None or recent_use["at"] > best["at"]):
        best = {"at": float(recent_use["at"]), "kind": recent_use["kind"]}
    return best


# ----------------------------------------------------------------------
# 表示・非表示の決まり
# ----------------------------------------------------------------------


class DeskController:
    """浮上式デスクを出すか・隠すかを決める（画面を描くのは pip0 シェル）

    on_context、on_shake、on_show_request、tick は、動作のリストを返します。
    - {"do": "show", "desk": ui.desk.show の内容}
    - {"do": "hide", "reason": "shake"/"no_items"/"context"}
    決まり（docs/design.md 4-4）
    - 作業文脈が変わったら（on_context）、そのときの候補を出す。候補がなければ隠す
    - シェイクを見分けたら（on_shake）、すぐに隠す
    - シェイクで隠した後は、作業文脈が変わり（アプリ、会話、ページ、文書、ダイアログのどれか）、
      かつ隠してから DESK_RESHOW_COOLDOWN_SECONDS（60秒）たつまで、出さない
    - 通知領域アイコンの「デスクを表示」（on_show_request）では、すぐに出す
    - pip0 自身のウィンドウ（デスクなど）が前面になっても、文脈が変わったとはみなさない
    """

    def __init__(self, config):
        self.cooldown = config["DESK_RESHOW_COOLDOWN_SECONDS"]
        self.context = None
        self.ranked = []
        self.visible = False
        self.shown_desk = None   # 最後に出したデスクの内容（desk_id を除く）。同じ内容を送り直さないため
        self.desk_id = 0
        self.shaken_key = None   # シェイクで隠したときの文脈の鍵（None なら、シェイクで隠していない）
        self.shaken_at = None

    def on_context(self, context, ranked, now):
        """作業文脈が変わったとき。ranked は rank_files の結果"""
        if context is not None and is_pip0_window(context):
            return []  # デスク自身などが前面になった：前の文脈のまま
        self.context = context
        self.ranked = list(ranked or [])
        if self.shaken_key is not None:
            if not self.may_reshow(now):
                return []
            self.forget_shake()
        if context is None:
            return self.hide("context")
        if not self.ranked:
            return self.hide("no_items")
        return self.show()

    def on_shake(self, now):
        """マウスのシェイクを見分けたとき：表示中ならすぐに隠す"""
        if not self.visible:
            return []
        self.shaken_key = context_key(self.context)
        self.shaken_at = now
        return self.hide("shake")

    def on_show_request(self, now):
        """通知領域アイコンの「デスクを表示」：シェイクの後でも、すぐに出す

        候補がないときは、すでに隠れていても {"do": "hide", "reason": "no_items"} を1つ返します
        （常駐処理が「候補がありません」と知らせられるように）。
        """
        self.forget_shake()
        if not self.ranked:
            self.visible = False
            self.shown_desk = None
            return [{"do": "hide", "reason": "no_items"}]
        return self.show(force=True)

    def tick(self, now):
        """時間がたったことを知らせる（常駐処理のメインループから呼ぶ）

        シェイクで隠した後、すでに別の作業文脈に移っていて、隠してから60秒たったら、ここで出します。
        """
        if self.shaken_key is None or not self.may_reshow(now):
            return []
        self.forget_shake()
        if self.context is None or not self.ranked:
            return []
        return self.show()

    # --- 内部で使う部品 ---

    def may_reshow(self, now):
        """シェイクで隠した後に、もう出してよいか（文脈が変わり、かつ待つ時間がたった）"""
        changed = context_key(self.context) != self.shaken_key
        waited = now - self.shaken_at >= self.cooldown
        return changed and waited

    def forget_shake(self):
        self.shaken_key = None
        self.shaken_at = None

    def show(self, force=False):
        desk = make_desk(self.context, self.ranked)
        if self.visible and desk == self.shown_desk and not force:
            return []  # 同じ内容を出し直さない（ちらつきを防ぐ）
        self.desk_id += 1
        self.visible = True
        self.shown_desk = desk
        return [{"do": "show", "desk": dict(desk, desk_id=self.desk_id)}]

    def hide(self, reason):
        if not self.visible:
            return []
        self.visible = False
        self.shown_desk = None
        return [{"do": "hide", "reason": reason}]


def make_desk(context, ranked):
    """ui.desk.show の内容（desk_id を除く）を作る。docs/ipc-protocol.md 3節"""
    is_dialog = bool(context and context.get("is_file_dialog"))
    return {
        "context_label": context_module.summary_label(context),
        "partner_label": context_module.partner_label(context),
        "dialog_hwnd": context.get("dialog_hwnd") if is_dialog else None,
        "dialog_rect": context.get("dialog_rect") if is_dialog else None,
        "items": [{"path": item["path"], "name": item["name"], "status": item["status"],
                   "reasons": list(item["reasons"])} for item in ranked],
    }


def context_key(context):
    """作業文脈が「変わった」かを比べるための鍵（アプリ、会話、ページ、文書、ダイアログかどうか）"""
    if context is None:
        return None
    return (context.get("process"), context.get("conversation"), context.get("page_title"),
            context.get("document_name"), bool(context.get("is_file_dialog")))


def is_pip0_window(context):
    """pip0 自身（シェルのデスク、ミニドックなど）のウィンドウなら True"""
    return (context.get("process") or "").lower() in usage.PIP0_PROCESS_NAMES


# ----------------------------------------------------------------------
# シェイク（マウスを左右に素早く振る）
# ----------------------------------------------------------------------


class ShakeDetector:
    """マウスの位置の列から、シェイク（左右に素早く振る動き）を見分ける

    pip0 シェルは、デスクの表示中だけマウスの位置を調べ（33ms ごと）、まとめて送ります（input.cursor_batch）。
    feed(samples) に [[ミリ秒, x, y], ...] を渡すと、シェイクを見分けたときに1回だけ True を返します。

    決まり（★値は settings.py の SHAKE_* で変えられます）
    - 左右の向きが変わった所（折り返し）を数える。前の折り返しから SHAKE_MIN_DISTANCE_PX（40px）以上
      動いてから向きを変えたものだけを数える（小さな手ぶれは数えない）
    - SHAKE_WINDOW_SECONDS（0.8秒）の間に、折り返しが SHAKE_MIN_REVERSALS（4回）以上あればシェイク
    - ゆっくりした往復（折り返しの間が長い）や、上下だけの動き（x が変わらない）は、シェイクではない
    - 見分けたら、数えた折り返しを忘れて、最初から数え直す
    """

    def __init__(self, config):
        self.min_reversals = config["SHAKE_MIN_REVERSALS"]
        self.window_ms = config["SHAKE_WINDOW_SECONDS"] * 1000
        self.min_distance = config["SHAKE_MIN_DISTANCE_PX"]
        self.reset()

    def reset(self):
        """数えた内容を忘れる（デスクを出し直したとき等にも呼ぶ）"""
        self.last_t = None
        self.direction = 0     # 今の振りの向き（1：右へ、-1：左へ、0：まだ決まっていない）
        self.start_x = None    # 向きが決まる前の、最初の位置
        self.turn_x = None     # 今の振りで、いちばん遠くまで行った位置
        self.turn_t = None     # その時刻（ミリ秒）
        self.reversals = []    # 折り返しの時刻（ミリ秒）

    def feed(self, samples):
        """マウスの位置の列 [[ミリ秒, x, y], ...] を加える。シェイクを見分けたら True"""
        for sample in samples or []:
            point = read_sample(sample)
            if point is None:
                continue  # 形の正しくない値は使わない
            t, x = point
            if self.last_t is not None and (t < self.last_t or t - self.last_t > self.window_ms):
                self.reset()  # 時刻が戻った、または間が空いた：最初から数え直す
            self.last_t = t
            if self.add_point(t, x):
                self.reset()
                return True
        return False

    def add_point(self, t, x):
        """1つの位置を加え、シェイクになったら True"""
        if self.start_x is None:
            self.start_x = x
            self.turn_x, self.turn_t = x, t
            return False
        if self.direction == 0:
            # 最初の振り：最初の位置から min_distance 以上動いたら、向きが決まる
            if abs(x - self.start_x) >= self.min_distance:
                self.direction = 1 if x > self.start_x else -1
                self.turn_x, self.turn_t = x, t
            return False
        if (x - self.turn_x) * self.direction > 0:
            self.turn_x, self.turn_t = x, t  # 同じ向きに、さらに進んだ
            return False
        if abs(x - self.turn_x) < self.min_distance:
            return False  # 戻り方が小さい（手ぶれ）
        # 逆の向きに min_distance 以上戻った：いちばん遠くまで行った所を、折り返しとして数える
        self.reversals.append(self.turn_t)
        self.direction = -self.direction
        self.turn_x, self.turn_t = x, t
        self.reversals = [r for r in self.reversals if t - r <= self.window_ms]
        return len(self.reversals) >= self.min_reversals


def read_sample(sample):
    """[ミリ秒, x, y] から (ミリ秒, x) を取り出す。形が正しくなければ None"""
    if not isinstance(sample, (list, tuple)) or len(sample) < 3:
        return None
    t, x = sample[0], sample[1]
    for value in (t, x):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
    return float(t), float(x)
