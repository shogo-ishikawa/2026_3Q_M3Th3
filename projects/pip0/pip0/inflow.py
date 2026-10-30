"""M1 流入処理：ダウンロードしたファイルの自動仕分けと「日付_内容_送信元」への自動改名、3秒のミニドック

ダウンロードが完了したファイル1つごとに、次の順で進みます（docs/design.md 4-3）。

1. watcher.DownloadTracker が、ダウンロードの完了を確かめる（未完了のファイルは、ここに来ません）
2. build_proposal：仕分け先（rules.SORT_RULES の点数）と新しい名前（naming.py）を考え、
   「提案」として inflow テーブルに記録する。重い解析はしない（文書のタイトルを軽く読み、すでにある解析結果を使う）
3. MiniDock：画面の右下に3秒だけ提案を表示する。画面を描くのは pip0 シェル（C#）で、
   このクラスは「いつ・何をするか」だけを決める
4. execute_proposal：時間切れ（自動）か、ユーザーのボタンで、提案を実行する。移動と改名は fileops.py が行う
5. apply_deferred_renames：内容が「解析待ち」だったファイルを、解析が終わった後に改名する

作業中のアプリのウィンドウタイトル（Slack の会話名、ブラウザーのページ題名など）と、
ダウンロード開始時のページ題名は、その場で点数に使うだけで、inflow テーブル・操作履歴・ログには書きません。
残すのは「作業中のアプリ（Slack）の会話名に「予算」」のような、アプリ名と規則の語だけです。
"""

import contextlib
import json
import logging
import os
import threading
import unicodedata
from pathlib import Path

from pip0 import analyse_text, database, fileops, killswitch, naming, provenance, safe_names, scanner

# PDF のタイトルを読むライブラリ（pypdf）を、先に読み込んでおく。
# analyse_text は、使うときに初めて pypdf を読み込むため、そのままでは最初の PDF のときだけ、
# 読み込みの時間（0.1 秒以上）が、タイトルを読む時間の上限（LIGHT_METADATA_BUDGET_SECONDS）に入ってしまう
try:
    import pypdf  # noqa: F401
except ImportError:
    pypdf = None  # なければ、PDF のタイトルは「読めなかった」になる（理由は analyse_text が返す）

logger = logging.getLogger(__name__)

# ----------------------------------------------------------------------
# 決まりの値（★ここを変えて試そう）
# ----------------------------------------------------------------------

# 仕分けの点数（docs/design.md 4-3）。合計が SORT_MIN_SCORE（settings.py）以上の、最高点の規則を提案する
KEYWORD_POINTS = 2     # ファイル名・文書のタイトル・ダウンロード開始時のページ題名に、規則の語がある
CONTEXT_POINTS = 2     # 作業中のアプリの会話名・ページ題名などに、規則の文脈語がある
EXTENSION_POINTS = 1   # 拡張子が規則に一致する

# ミニドックに出す「ほかの仕分け先」の数と、その最低点。
# SORT_MIN_SCORE 未満の規則は自動では選ばないが、ユーザーがボタンで選ぶことはできる（0点の規則は出さない）
MAX_ALTERNATIVES = 2
ALTERNATIVE_MIN_SCORE = 1

# ミニドックに出す、作業文脈の説明の最大文字数
CONTEXT_LABEL_MAX_CHARS = 30

# 規則の語を探す文字列（texts のキー）と、根拠の文に出す名前
TEXT_PLACES = [
    ("name", "ファイル名"),
    ("title", "文書のタイトル"),
    ("page_title", "ダウンロード開始時のページ題名"),
]

# 実行のきっかけ（inflow テーブルの decision）と、操作履歴に書く説明
DECISION_TEXTS = {
    "auto": "ミニドックの表示時間が過ぎたため、自動で実行しました",
    "user_accept": "ユーザーがミニドックで提案を承認しました",
    "user_alternative": "ユーザーがミニドックで、ほかの仕分け先を選びました",
    "user_keep": "ユーザーがミニドックで「このまま」を選びました",
}

# ミニドックのボタン（シェルから届く action）→ 実行のきっかけ
USER_DECISIONS = {"accept": "user_accept", "alternative": "user_alternative", "keep": "user_keep"}

# ミニドックの時間切れで、自動で実行する提案の状態（"no_candidate" は何もせずに閉じる）
AUTO_EXECUTE_STATUSES = ["proposed", "needs_analysis"]

# もう実行しない inflow の状態（同じ提案を2回実行しないため）
FINISHED_STATES = ["executed", "deferred", "kept"]

# 提案の辞書のうち、inflow.proposal_json に保存しないもの（作業文脈の説明は、画面に出すだけ）
NOT_STORED_KEYS = ["proposal_id", "context_label"]


# ----------------------------------------------------------------------
# 仕分け先の点数
# ----------------------------------------------------------------------


def score_rules(texts, context, ext, rules):
    """仕分けの規則（rules.SORT_RULES）ごとに点数を付け、点数の高い順に並べたリストを返す

    texts：{"name": ファイル名, "title": 文書のタイトル, "page_title": ダウンロード開始時のページ題名}
           （分からないものは None）
    context：作業中のアプリの文脈（context.parse_foreground の辞書）。分からなければ None
    ext：拡張子（例：".pdf"）
    戻り値：[{"rule": 規則の名前, "folder": 仕分け先のフォルダー名, "score": 点数, "reasons": [根拠の文]}, ...]

    - 規則の語が texts のどれかにあれば +2（同じ語は、いくつの場所にあっても1回だけ数える）
    - 規則の文脈語が、作業中のアプリの会話名・ページ題名・題名の語にあれば +2
    - 拡張子が規則に一致すれば +1
    同じ点数なら rules.SORT_RULES の順のまま。根拠の文には、アプリ名と規則の語だけを書き、
    ウィンドウタイトルや会話名そのものは書きません。
    """
    scored = []
    for rule in rules.SORT_RULES:
        score = 0
        reasons = []
        for keyword in rule.get("keywords", []):
            places = [label for key, label in TEXT_PLACES if contains(texts.get(key), keyword)]
            if places:
                score += KEYWORD_POINTS
                reasons.append(f"{'・'.join(places)}に「{keyword}」（+{KEYWORD_POINTS}）")
        for keyword in rule.get("context_keywords", []):
            place = find_in_context(context, keyword)
            if place is not None:
                score += CONTEXT_POINTS
                reasons.append(f"作業中のアプリ（{app_label(context)}）の{place}に「{keyword}」（+{CONTEXT_POINTS}）")
        extensions = [extension.lower() for extension in rule.get("extensions", [])]
        if ext and ext.lower() in extensions:
            score += EXTENSION_POINTS
            reasons.append(f"拡張子が {ext.lower()}（+{EXTENSION_POINTS}）")
        scored.append({"rule": rule["name"], "folder": rule["folder"], "score": score, "reasons": reasons})
    # 点数の高い順に並べる（sort は、同じ点数の順番を変えない）
    scored.sort(key=lambda item: item["score"], reverse=True)
    return scored


def find_in_context(context, keyword):
    """作業中のアプリの文脈のどこに keyword があるか（"会話名" など）。なければ None"""
    if not context:
        return None
    if contains(context.get("conversation"), keyword):
        return "会話名"
    if contains(context.get("page_title"), keyword):
        return "ページ題名"
    for word in context.get("keywords") or []:
        if contains(word, keyword):
            return "ウィンドウタイトルの語"
    return None


def app_label(context):
    """作業中のアプリの表示名（"Slack" など）"""
    return context.get("app") or context.get("process") or "名前の分からないアプリ"


def contains(text, keyword):
    """text の中に keyword があれば True（全角・半角と、英字の大文字・小文字の違いは無視する）"""
    if not text or not keyword:
        return False
    return normalise_text(keyword) in normalise_text(text)


def normalise_text(text):
    """比べるための形にそろえる（「ＢＵＤＧＥＴ」→「budget」のように、全角の英数字を半角にし、小文字にする）"""
    return unicodedata.normalize("NFKC", str(text)).casefold()


# ----------------------------------------------------------------------
# 提案を作る
# ----------------------------------------------------------------------


def build_proposal(conn, platform, path, download_event, context, config, rules, now):
    """ダウンロードが完了したファイルの提案（仕分け先と新しい名前）を作り、inflow テーブルに記録して返す

    download_event：watcher.DownloadTracker が結び付けた拡張機能の記録（download_events の行）。
                    None なら provenance.find_download_event で探す
    context：今の作業文脈（context.parse_foreground の辞書）。分からなければ None
    重い解析はしません。文書のタイトルを軽く読み（LIGHT_METADATA_BUDGET_SECONDS 秒まで）、
    すでにある解析結果を使います。

    戻り値の提案の辞書
    - "proposal_id"：inflow テーブルの行の id
    - "status"："proposed"（仕分け先か、すぐにできる改名がある）、
                "needs_analysis"（名前の内容は解析の後に決める。仕分け先があれば、移動は先に行う）、
                "no_candidate"（仕分け先も改名もない）
    - "destination"：仕分け先 {"rule", "folder", "dest_dir", "score", "reasons"}。なければ None
    - "alternatives"：ほかの仕分け先のリスト（それぞれに "index" が付く）
    - "name"：naming.propose_name の結果
    - "source"：送信元 {"label", "kind", "evidence"}
    - "reasons"：ミニドックに出す根拠の文のリスト
    - "context_label"：ミニドックに出す作業文脈の説明（DB には保存しない）
    - ほかに "file_id"、"path"、"file_name"、"file_key"、"detected_at"、"completed_at"、"date_basis"、
      "download_event_id"、"light_metadata"
    """
    path = os.path.abspath(os.fspath(path))

    # 1. 扱ってよいファイルかを確かめる（リンク、中身がこの PC にないもの、一時ファイル等は扱わない）
    skip, skip_reason = scanner.should_skip(path, platform, config, rules)
    if skip:
        return build_skipped_proposal(conn, platform, path, download_event, skip_reason, now)

    # 2. 文書のタイトルを軽く読む（時間の上限つき。DB は使わないので、まとめて書く前に行う）
    light = read_light_metadata(path, platform, config, rules)

    with write_together(conn):
        # 3. 索引（files テーブル）に記録する（新しいファイルは、解析の順番待ちにも入る）
        file_id = index_file(conn, platform, path, config, now)

        # 4. 送信元：ブラウザー拡張の記録 → Windows のダウンロード元情報（Zone.Identifier）の順。
        #    ダウンロード開始時に表示していたタブは、送信元には使わない（provenance.determine_source）
        if download_event is None:
            download_event = provenance.find_download_event(conn, path, file_size(path), now)
        zone = provenance.parse_zone_identifier(platform.read_zone_identifier(path))
        source = provenance.determine_source(download_event, zone, rules)
        if file_id is not None:
            provenance.record_provenance(conn, file_id, source, event=download_event, zone=zone, now=now)
            if download_event is not None and download_event.get("state") == "pending":
                provenance.mark_event_matched(conn, download_event["id"], file_id)

        # 5. 仕分け先と新しい名前を考える
        analysis = read_analysis(conn, file_id)
        completed_at, date_basis = completion_time(download_event, now)
        file_name = os.path.basename(path)
        texts = {
            "name": file_name,
            "title": known_title(light, analysis),
            "page_title": download_event.get("tab_title") if download_event else None,
        }
        ranked = score_rules(texts, context, safe_names.split_ext(file_name)[1], rules)
        destination, alternatives = choose_destinations(ranked, config)
        name = naming.propose_name(file_name, light, source, completed_at, analysis, config, rules)

        proposal = {
            "proposal_id": None,
            "file_id": file_id,
            "path": path,
            "file_name": file_name,
            "file_key": platform.get_file_key(path),
            "detected_at": now,
            "completed_at": completed_at,
            "date_basis": date_basis,
            "download_event_id": download_event.get("id") if download_event else None,
            "status": decide_status(destination, name),
            "destination": destination,
            "alternatives": alternatives,
            "name": name,
            "source": {"label": source["label"], "kind": source["kind"], "evidence": source["evidence"]},
            "light_metadata": {"status": light["status"], "source": light.get("source"), "reason": light.get("reason")},
            "reasons": [],
            "context_label": None,
        }
        proposal["reasons"] = proposal_reasons(proposal, config)
        if proposal["status"] in AUTO_EXECUTE_STATUSES:
            # 自動の実行が止まっている・無効なら、ミニドックの先頭にそう書く（時間が過ぎても実行しないため）
            proposal["reasons"] = automation_notes(conn, config) + proposal["reasons"]

        # 6. 提案を inflow テーブルに記録する（作業文脈の説明は保存しない）
        proposal["proposal_id"] = insert_inflow_row(conn, proposal, now)

    proposal["context_label"] = make_context_label(context)
    logger.info("流入：提案を作りました（%s、仕分け先 %s、名前 %s）", proposal["status"],
                "あり" if destination else "なし", name["status"])
    return proposal


def build_skipped_proposal(conn, platform, path, download_event, reason, now):
    """扱わないファイル（リンク、中身がこの PC にないもの等）の提案。何もしない（"no_candidate"）ことを記録する"""
    proposal = {
        "proposal_id": None,
        "file_id": None,
        "path": path,
        "file_name": os.path.basename(path),
        "file_key": platform.get_file_key(path),
        "detected_at": now,
        "completed_at": now,
        "date_basis": None,
        "download_event_id": download_event.get("id") if download_event else None,
        "status": "no_candidate",
        "destination": None,
        "alternatives": [],
        "name": {"rename": False, "new_name": None, "status": "keep",
                 "parts": {"date": None, "content": None, "source": None},
                 "evidence": {"date": None, "content": None, "source": None},
                 "reason": "扱わないファイルのため、改名しません"},
        "source": {"label": None, "kind": None, "evidence": None},
        "light_metadata": None,
        "reasons": ["このファイルは扱いません：" + reason],
        "context_label": None,
    }
    with write_together(conn):
        proposal["proposal_id"] = insert_inflow_row(conn, proposal, now, detail=reason)
    logger.info("流入：扱わないファイルのため、提案しません")
    return proposal


def read_light_metadata(path, platform, config, rules):
    """文書のタイトルを軽く読む（analyse_text.light_metadata）。LIGHT_METADATA_BUDGET_SECONDS 秒で待つのをやめる

    PDF を読むライブラリ（pypdf）は途中で止められないため、別のスレッドで読み、
    時間内に終わらなければ、その結果は使いません（スレッドは、読み終えると自然に終わります）。
    """
    results = []

    def work():
        try:
            results.append(analyse_text.light_metadata(path, platform, config, rules))
        except Exception as error:  # 予想外の失敗でも、提案は続ける（ログには種類だけを書く）
            logger.warning("流入：文書のタイトルを読めませんでした（%s）", type(error).__name__)
            results.append({"status": "failed", "title": None, "kind": None, "source": None,
                            "reason": f"文書のタイトルを読めませんでした（{type(error).__name__}）"})

    worker = threading.Thread(target=work, name="pip0-light-metadata", daemon=True)
    worker.start()
    worker.join(config["LIGHT_METADATA_BUDGET_SECONDS"])
    if results:
        return results[0]
    return {"status": "skipped", "title": None, "kind": None, "source": None,
            "reason": "決められた時間内に文書のタイトルを読めなかったため、後の解析で読みます"}


def index_file(conn, platform, path, config, now):
    """files テーブルに記録し、その行の id を返す。記録できなければ None"""
    location_kind = fileops.location_kind_for(path, config) or "downloads"
    indexed = scanner.upsert_file(conn, platform, path, location_kind, now)
    if indexed is None:
        return None
    return indexed["file_id"]


def file_size(path):
    try:
        return os.stat(path).st_size
    except OSError:
        return None


def read_analysis(conn, file_id):
    """analysis テーブルの行（辞書）。なければ None"""
    if file_id is None:
        return None
    return database.query_one(conn, "SELECT * FROM analysis WHERE file_id = ?", (file_id,))


def completion_time(download_event, now):
    """ダウンロード完了の時刻と、その基準の説明を返す

    ブラウザー拡張の記録の終了時刻があればそれを、なければ pip0 が完了を確かめた時刻（now）を使う。
    """
    if download_event is not None:
        ended_at = download_event.get("ended_at")
        if isinstance(ended_at, (int, float)) and not isinstance(ended_at, bool):
            return float(ended_at), "ブラウザー拡張が記録したダウンロードの終了時刻"
    return now, "pip0 がダウンロードの完了を確かめた時刻"


def known_title(light, analysis):
    """今分かっている文書のタイトル（軽く読んだもの、なければ解析で得たもの）。なければ None"""
    if light is not None and light.get("status") == "done" and light.get("title"):
        return light["title"]
    if analysis is not None and analysis.get("status") == "done" and analysis.get("title"):
        return analysis["title"]
    return None


def choose_destinations(ranked, config):
    """点数の高い順のリストから、仕分け先とほかの候補を選ぶ。(仕分け先 または None, ほかの候補のリスト)

    仕分け先：SORT_MIN_SCORE 点以上で最高点の規則。ほかの候補：残りのうち ALTERNATIVE_MIN_SCORE 点以上の、
    点数の高いものから MAX_ALTERNATIVES 件。仕分け先は pip0 専用フォルダー（PIP0_ROOT）の中のフォルダー。
    """
    root = config.get("PIP0_ROOT")
    if root is None:
        return None, []
    candidates = [item for item in ranked if item["score"] >= ALTERNATIVE_MIN_SCORE]
    destination = None
    if candidates and candidates[0]["score"] >= config["SORT_MIN_SCORE"]:
        destination = make_destination(candidates[0], root)
        candidates = candidates[1:]
    alternatives = []
    for index, item in enumerate(candidates[:MAX_ALTERNATIVES]):
        alternative = make_destination(item, root)
        alternative["index"] = index
        alternatives.append(alternative)
    return destination, alternatives


def make_destination(item, root):
    """score_rules の1件から、仕分け先の辞書を作る（dest_dir は pip0 専用フォルダーの中の絶対パス）"""
    return {
        "rule": item["rule"],
        "folder": item["folder"],
        "dest_dir": str(Path(root) / item["folder"]),
        "score": item["score"],
        "reasons": list(item["reasons"]),
    }


def decide_status(destination, name):
    """提案の状態（"proposed"、"needs_analysis"、"no_candidate"）を決める"""
    if name["status"] == "needs_analysis":
        return "needs_analysis"
    if destination is not None or name["status"] == "ready":
        return "proposed"
    return "no_candidate"


def proposal_reasons(proposal, config):
    """ミニドックに出す根拠の文のリスト（仕分け先の点数、新しい名前の根拠）"""
    reasons = []
    destination = proposal["destination"]
    if destination is not None:
        reasons.append(destination_summary(destination, config))
        reasons.extend(destination["reasons"])
    elif config.get("PIP0_ROOT") is None:
        reasons.append("仕分け先：pip0 専用フォルダーが設定されていないため、提案しません")
    else:
        reasons.append(f"仕分け先：候補なし（{config['SORT_MIN_SCORE']}点以上の規則がありません）")
    reasons.extend(name_reasons(proposal["name"], proposal["date_basis"]))
    light = proposal.get("light_metadata")
    if proposal["name"]["status"] == "needs_analysis" and light and light.get("reason"):
        reasons.append("文書のタイトル：" + light["reason"])
    return reasons


def automation_notes(conn, config):
    """自動の実行が止まっている（キルスイッチ）・無効（設定）ときの説明の文のリスト。動くなら空のリスト"""
    if killswitch.is_engaged(conn, config):
        return ["自動処理は停止中です（キルスイッチ）。時間が過ぎても実行しません（ボタンでは実行できます）"]
    notes = []
    if not config["AUTO_SORT_ENABLED"]:
        notes.append("自動仕分けは無効です。時間が過ぎても移動しません（ボタンでは実行できます）")
    if not config["AUTO_RENAME_ENABLED"]:
        notes.append("自動改名は無効です。時間が過ぎても改名しません（ボタンでは実行できます）")
    return notes


def destination_summary(destination, config):
    return f"仕分け先「{destination['rule']}」：{destination['score']}点（{config['SORT_MIN_SCORE']}点以上で提案）"


def name_reasons(name, date_basis=None):
    """新しい名前の根拠を、ミニドックと操作履歴に出す文のリストにする"""
    parts = name["parts"]
    evidence = name["evidence"]
    if parts["date"] is None:
        return ["名前：" + name["reason"]]  # 意味のある名前など、改名を考えなかったとき
    reasons = [f"日付「{parts['date']}」：{evidence['date']}"]
    if date_basis:
        reasons.append(f"日付の基準：{date_basis}")
    if parts["content"] is not None:
        reasons.append(f"内容「{parts['content']}」：{evidence['content']}")
    else:
        reasons.append(f"内容：{evidence['content']}")
    reasons.append(f"送信元「{parts['source']}」：{evidence['source']}")
    if name["status"] == "keep":
        reasons.append("名前：" + name["reason"])
    return reasons


def make_context_label(context):
    """ミニドックに出す、作業文脈の短い説明（例：「作業中：Slack（予算）」）。DB には保存しない"""
    if not context:
        return None
    app = app_label(context)
    detail = context.get("conversation") or context.get("page_title")
    if detail:
        return f"作業中：{app}（{shorten(detail, CONTEXT_LABEL_MAX_CHARS)}）"
    if context.get("category") == "chat":
        return f"作業中：{app}（チャット相手：取得不可）"
    return f"作業中：{app}"


def shorten(text, max_chars):
    text = " ".join(str(text).split())
    if len(text) <= max_chars:
        return text
    return text[:max_chars - 1] + "…"


def insert_inflow_row(conn, proposal, now, detail=None):
    """提案を inflow テーブルに1行追加し、その id を返す（状態は "proposed" か "no_candidate"）"""
    state = "no_candidate" if proposal["status"] == "no_candidate" else "proposed"
    return database.execute(
        conn,
        "INSERT INTO inflow (file_id, path, download_event_id, detected_at, state, proposal_json, detail) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (proposal["file_id"], proposal["path"], proposal["download_event_id"], now, state,
         proposal_to_json(proposal), detail),
    )


def proposal_to_json(proposal):
    """inflow.proposal_json に書く JSON の文字列（NOT_STORED_KEYS は書かない）"""
    stored = {}
    for key, value in proposal.items():
        if key not in NOT_STORED_KEYS:
            stored[key] = value
    return json.dumps(stored, ensure_ascii=False)


def load_proposal(conn, proposal_id):
    """inflow テーブルに記録した提案を読み直す。なければ None

    ミニドックの {"do": "execute"} を受けた常駐処理が、execute_proposal に渡す提案を用意するときに使います。
    保存していない "context_label" は None になります（実行には使いません）。
    """
    row = database.query_one(conn, "SELECT proposal_json FROM inflow WHERE id = ?", (proposal_id,))
    if row is None or not row["proposal_json"]:
        return None
    proposal = json.loads(row["proposal_json"])
    proposal["proposal_id"] = proposal_id
    proposal["context_label"] = None
    return proposal


# ----------------------------------------------------------------------
# 提案を実行する
# ----------------------------------------------------------------------


def execute_proposal(conn, platform, proposal, decision, config, rules, registry, now, alternative_index=None):
    """提案を実行する（ミニドックの時間切れ、またはユーザーのボタン）

    decision："auto"（時間切れ）、"user_accept"（提案どおり）、"user_alternative"（ほかの仕分け先。
              alternative_index で選ぶ）、"user_keep"（元のまま残す）
    registry：watcher.SelfChangeRegistry（pip0 自身の移動の知らせを無視するため。fileops に渡す）

    - "auto" は、キルスイッチが押されていないときだけ実行する。自動仕分け（AUTO_SORT_ENABLED）が無効なら移動を、
      自動改名（AUTO_RENAME_ENABLED）が無効なら改名を、しない
    - 実行の直前に、ファイルがまだあり、同じファイルで、中身がこの PC にあり、ほかのアプリが使っていないことを確かめる
    - 移動と改名は fileops.move_and_rename で1回で行う（上書きしない、操作履歴に前後のパスと根拠を残す）
    - 名前が「解析待ち」なら、移動だけを先に行い、改名は apply_deferred_renames に回す（状態 "deferred"）

    戻り値：{"ok", "status", "path", "state", "reason"}
    - status："done"（移動・改名した）、"deferred"（改名を解析の後に回しただけ）、"kept"（元のまま）、
              "skipped"（何もしなかった）、"failed"（OS の操作が失敗した）
    - path：ファイルの今の場所、state：inflow テーブルの状態
    """
    if decision not in DECISION_TEXTS:
        raise ValueError(f"知らない実行のきっかけです：{decision}")
    proposal_id = proposal["proposal_id"]
    path = proposal["path"]
    row = database.query_one(conn, "SELECT state FROM inflow WHERE id = ?", (proposal_id,))
    if row is None:
        raise ValueError("この提案は inflow テーブルにありません")
    state = row["state"]
    if state in FINISHED_STATES:
        return outcome(False, "skipped", path, state, "この提案は、すでに処理しました")

    if decision == "user_keep":
        reason = "ユーザーの選択で、元の場所と名前のまま残しました"
        update_inflow(conn, proposal_id, "kept", decision, now, reason)
        logger.info("流入：提案を実行しませんでした（ユーザーが「このまま」を選択）")
        return outcome(True, "kept", path, "kept", reason)

    destination = choose_target(proposal, decision, alternative_index)
    plan = make_plan(proposal, destination)
    actor = "auto" if decision == "auto" else "user"
    notes = []
    if decision == "auto":
        if killswitch.is_engaged(conn, config):
            reason = "自動処理は停止中です（キルスイッチ）。自動の仕分け・改名をしません"
            if plan["move"] or plan["rename"] or plan["defer"]:
                database.log_operation(
                    conn, operation_kind(plan), actor=actor, status="skipped", file_id=proposal.get("file_id"),
                    before_path=path, reasons=operation_reasons(proposal, destination, plan, decision, config),
                    detail=reason, at=now,
                )
            # 状態は変えない（提案のまま残すので、ユーザーが後から実行できる）
            update_inflow(conn, proposal_id, state, decision, now, reason)
            logger.info("流入：キルスイッチのため、自動の実行をしませんでした")
            return outcome(False, "skipped", path, state, reason)
        notes = apply_auto_settings(plan, config)

    if not (plan["move"] or plan["rename"] or plan["defer"]):
        reason = "。".join(notes) or "仕分け先も新しい名前もないため、何もしません"
        update_inflow(conn, proposal_id, state, decision, now, reason)
        return outcome(False, "skipped", path, state, reason)

    kind = operation_kind(plan)
    reasons = operation_reasons(proposal, destination, plan, decision, config)

    # 実行の直前に、もう一度確かめる（提案から数秒の間に、開かれた・消された・置き換わったかもしれない）
    touch_now = plan["move"] or plan["rename"]
    problem = check_file_now(platform, path, proposal.get("file_key"), config, rules, need_exclusive=touch_now)
    if problem is not None:
        database.log_operation(conn, kind, actor=actor, status="skipped", file_id=proposal.get("file_id"),
                               before_path=path, reasons=reasons, detail=problem, at=now)
        update_inflow(conn, proposal_id, "failed", decision, now, problem)
        logger.info("流入：実行の直前の確認で、実行をやめました（%s）", decision)
        return outcome(False, "skipped", path, "failed", problem)

    new_path = path
    if touch_now:
        if plan["move"]:
            dest_dir = destination["dest_dir"]
        else:
            dest_dir = os.path.dirname(path)  # 名前だけを変える
        new_name = proposal["name"]["new_name"] if plan["rename"] else None
        moved = fileops.move_and_rename(
            conn, platform, path, dest_dir, new_name, kind=kind, actor=actor, reasons=reasons, config=config,
            registry=registry, file_id=proposal.get("file_id"), now=now,
        )
        if not moved["ok"]:
            update_inflow(conn, proposal_id, "failed", decision, now, moved["reason"])
            logger.info("流入：提案を実行できませんでした（%s、%s）", decision, moved["status"])
            return outcome(False, moved["status"], path, "failed", moved["reason"])
        new_path = moved["path"]
        if moved["reason"]:
            notes.append(moved["reason"])

    if plan["defer"]:
        new_state = "deferred"
        notes.append("改名は、内容の解析が終わった後に行います")
    else:
        new_state = "executed"
    detail = "。".join(notes)
    update_inflow(conn, proposal_id, new_state, decision, now, detail or None, path=new_path)
    status = "done" if touch_now else "deferred"
    logger.info("流入：提案を実行しました（%s、%s）", decision, kind)
    return outcome(True, status, new_path, new_state, detail)


def choose_target(proposal, decision, alternative_index):
    """移動先の辞書を選ぶ（"user_alternative" なら、alternative_index の番号のほかの候補）。移動しないなら None"""
    if decision != "user_alternative":
        return proposal.get("destination")
    for alternative in proposal.get("alternatives") or []:
        if alternative.get("index") == alternative_index:
            return alternative
    raise ValueError(f"ほかの仕分け先の番号が正しくありません：{alternative_index}")


def make_plan(proposal, destination):
    """何をするか：{"move": 仕分け先へ移すか, "rename": 今すぐ改名するか, "defer": 改名を解析の後に回すか}"""
    name_status = proposal["name"]["status"]
    return {
        "move": destination is not None,
        "rename": name_status == "ready",
        "defer": name_status == "needs_analysis",
    }


def apply_auto_settings(plan, config):
    """自動の実行で、無効にされている処理を plan から外す（plan を書き換える）。説明の文のリストを返す"""
    notes = []
    if plan["move"] and not config["AUTO_SORT_ENABLED"]:
        plan["move"] = False
        notes.append("自動仕分けが無効のため、移動しません")
    if (plan["rename"] or plan["defer"]) and not config["AUTO_RENAME_ENABLED"]:
        plan["rename"] = False
        plan["defer"] = False
        notes.append("自動改名が無効のため、改名しません")
    return notes


def operation_kind(plan):
    """操作履歴に書く操作の種類（"sort_rename"、"sort"、"rename"）"""
    renames = plan["rename"] or plan["defer"]
    if plan["move"] and renames:
        return "sort_rename"
    if plan["move"]:
        return "sort"
    return "rename"


def operation_reasons(proposal, destination, plan, decision, config):
    """操作履歴に残す根拠の文のリスト（実行のきっかけ、仕分け先の点数、新しい名前の根拠）"""
    reasons = [DECISION_TEXTS[decision]]
    if plan["move"]:
        if decision == "user_alternative":
            reasons.append(f"仕分け先「{destination['rule']}」：{destination['score']}点（ユーザーが選んだ、ほかの候補）")
        else:
            reasons.append(destination_summary(destination, config))
        reasons.extend(destination["reasons"])
    if plan["rename"] or plan["defer"]:
        reasons.extend(name_reasons(proposal["name"], proposal.get("date_basis")))
    return reasons


def check_file_now(platform, path, expected_key, config, rules, need_exclusive):
    """実行の直前に、ファイルがまだ扱える状態かを確かめる。扱えれば None、扱えなければ理由（日本語）

    ファイルがある、通常のファイル（リンク等でない）、中身がこの PC にある（scanner.should_skip）、
    提案したときと同じファイル（file_key が同じ）、need_exclusive なら、ほかのアプリが使っていない。
    """
    skip, reason = scanner.should_skip(path, platform, config, rules)
    if skip:
        return reason
    if expected_key is not None and platform.get_file_key(path) != expected_key:
        return "提案した後に、別のファイルに置き換わったため、扱いません"
    if need_exclusive and not platform.can_open_exclusively(path):
        return "ほかのアプリが使用中のため、移動・改名しません"
    return None


def update_inflow(conn, proposal_id, state, decision, decided_at, detail, path=None):
    """inflow テーブルの行に、状態・実行のきっかけ・時刻・説明（と、ファイルの今の場所）を書く"""
    if path is None:
        conn.execute("UPDATE inflow SET state = ?, decision = ?, decided_at = ?, detail = ? WHERE id = ?",
                     (state, decision, decided_at, detail, proposal_id))
    else:
        conn.execute("UPDATE inflow SET state = ?, path = ?, decision = ?, decided_at = ?, detail = ? WHERE id = ?",
                     (state, str(path), decision, decided_at, detail, proposal_id))


def outcome(ok, status, path, state, reason):
    return {"ok": ok, "status": status, "path": str(path), "state": state, "reason": reason}


# ----------------------------------------------------------------------
# 解析の後の改名
# ----------------------------------------------------------------------


def apply_deferred_renames(conn, platform, config, rules, registry, now):
    """改名を後回しにした提案（inflow の状態 "deferred"）のうち、解析が終わったものを改名する

    1件ごとに、解析の結果で名前を考え直し、ファイルが記録した場所に同じファイル（file_key が同じ）のままあり、
    ほかのアプリが使っていないときだけ、その場で改名する（fileops.move_and_rename。操作履歴に残る）。
    - 解析がまだ：そのまま待つ
    - ほかのアプリが使用中：次の機会にやり直す
    - 移動・削除・置き換えられていた：改名をやめる（状態 "failed"）
    - 内容も送信元も分からない：名前は元のまま（状態 "executed"、説明に理由）
    後回しの改名も自動の処理なので、キルスイッチが押されている間と、自動改名が無効の間は、何もせずに待ちます。

    戻り値：{"checked", "renamed", "name_kept", "waiting", "failed"}（件数）
    """
    counts = {"checked": 0, "renamed": 0, "name_kept": 0, "waiting": 0, "failed": 0}
    rows = database.query_all(conn, "SELECT * FROM inflow WHERE state = 'deferred' ORDER BY id")
    counts["checked"] = len(rows)
    if not rows:
        return counts
    if killswitch.is_engaged(conn, config) or not config["AUTO_RENAME_ENABLED"]:
        counts["waiting"] = len(rows)
        return counts
    for row in rows:
        result = apply_one_deferred(conn, platform, row, config, rules, registry, now)
        counts[result] += 1
    if counts["renamed"] or counts["name_kept"] or counts["failed"]:
        logger.info("流入：解析の後の改名（改名 %d、名前はそのまま %d、失敗 %d、待ち %d）",
                    counts["renamed"], counts["name_kept"], counts["failed"], counts["waiting"])
    return counts


def apply_one_deferred(conn, platform, row, config, rules, registry, now):
    """後回しにした改名を1件だけ進める。"renamed"、"name_kept"、"waiting"、"failed" のどれかを返す"""
    proposal = json.loads(row["proposal_json"])
    path = row["path"]
    file_id = row["file_id"]
    if file_id is None:
        finish_deferred(conn, row["id"], "failed", path, "索引（files テーブル）の行がなくなったため、改名をやめました")
        return "failed"
    analysis = read_analysis(conn, file_id)
    if not naming.analysis_finished(analysis):
        return "waiting"

    name = naming.propose_name(proposal["file_name"], None, proposal.get("source"), proposal["completed_at"],
                               analysis, config, rules)
    reasons = (["中身の解析が終わったため、後回しにしていた改名を行います"]
               + name_reasons(name, proposal.get("date_basis")))
    problem = check_file_now(platform, path, proposal.get("file_key"), config, rules, need_exclusive=False)
    if problem is not None:
        database.log_operation(conn, "rename", actor="auto", status="skipped", file_id=file_id,
                               before_path=path, reasons=reasons, detail=problem, at=now)
        finish_deferred(conn, row["id"], "failed", path, problem)
        return "failed"
    if name["status"] != "ready":
        database.log_operation(conn, "rename", actor="auto", status="skipped", file_id=file_id,
                               before_path=path, reasons=reasons, detail=name["reason"], at=now)
        finish_deferred(conn, row["id"], "executed", path, name["reason"])
        return "name_kept"
    if not platform.can_open_exclusively(path):
        return "waiting"  # ほかのアプリが使用中。次の機会にやり直す

    moved = fileops.move_and_rename(
        conn, platform, path, os.path.dirname(path), name["new_name"], kind="rename", actor="auto",
        reasons=reasons, config=config, registry=registry, file_id=file_id, now=now,
    )
    if not moved["ok"]:
        finish_deferred(conn, row["id"], "failed", path, moved["reason"])
        return "failed"
    finish_deferred(conn, row["id"], "executed", moved["path"], "中身の解析の後に改名しました")
    return "renamed"


def finish_deferred(conn, inflow_id, state, path, detail):
    conn.execute("UPDATE inflow SET state = ?, path = ?, detail = ? WHERE id = ?",
                 (state, str(path), detail, inflow_id))


# ----------------------------------------------------------------------
# 3秒のミニドック（状態を持つので、クラスにしています）
# ----------------------------------------------------------------------


class MiniDock:
    """3秒のミニドックの状態（表示中の行、順番待ち、マウスが上にあるか）を持ち、「すること」のリストを返す

    画面には何も描かず、DB もファイルも触りません（それは呼び出す側＝常駐処理の役目です）。
    時刻は、どのメソッドも引数の now（秒）で受け取ります。
    どのメソッドも、次の「すること」（動作）の辞書のリストを返します。
    - {"do": "show", "dock": {...}}：ミニドックを表示する。dock は表示中の全行（docs/ipc-protocol.md 3節の
      ui.mini_dock.show の形）。ui.show_mini_dock(dock) に渡す
    - {"do": "close", "dock_id", "reason"}：ミニドックを閉じる。ui.close_mini_dock(dock_id, reason) に渡す
    - {"do": "execute", "proposal_id", "decision", "alternative_index"}：提案を実行する。
      load_proposal と execute_proposal に渡す
    - {"do": "open", "proposal_id", "path"}：ファイルを既定のアプリで開く（行は閉じない）

    決まり（docs/design.md 4-3）
    - 同時に表示する行は MINI_DOCK_MAX_ROWS まで。超えた分は順番待ちにし、行が空いたら表示して、
      そこから MINI_DOCK_SECONDS 秒を数える。行ごとに残り時間を数える
    - マウスがミニドックの上にある間（"enter" から "leave" まで）は、全行の残り時間を止める
    - マウスが離れたら、残り時間が MINI_DOCK_GRACE_AFTER_LEAVE_SECONDS 秒未満の行は、その秒数にしてから数え直す
    - 時間が尽きた行は、提案（"proposed"、"needs_analysis"）なら自動で実行し、候補なし（"no_candidate"）なら
      何もせずに閉じる
    - ボタン（accept、alternative、keep）は、すぐに実行して、その行を閉じる。「開く」（open）は行を閉じない
    - 行がなくなったら、ミニドックを閉じる。次に開くミニドックには、新しい番号（dock_id）を付ける
    """

    def __init__(self, config):
        self.seconds = config["MINI_DOCK_SECONDS"]
        # 0 行にすると、順番待ちのまま表示も実行もされなくなるため、少なくとも 1 行にする
        self.max_rows = max(1, int(config["MINI_DOCK_MAX_ROWS"]))
        self.grace_seconds = config["MINI_DOCK_GRACE_AFTER_LEAVE_SECONDS"]
        self.dock_id = None        # 表示中のミニドックの番号。閉じているときは None
        self.rows = []             # 表示中の行 {"entry_id", "proposal", "deadline", "remaining"}
        self.waiting = []          # 順番待ちの提案（先に来たものから表示する）
        self.interacting = False   # マウスがミニドックの上にあるか（残り時間を止めているか）
        self.dock_count = 0        # これまでに開いたミニドックの数（番号を付けるため）
        self.entry_count = 0       # これまでに表示した行の数（番号を付けるため）

    # --- 常駐処理が呼ぶメソッド ---

    def add(self, proposal, now):
        """提案を1つ加える（ダウンロードの完了を確かめた直後に呼ぶ）。行に空きがなければ順番待ちにする"""
        actions, changed = self._expire(now)
        if not self._has_proposal(proposal.get("proposal_id")):
            if len(self.rows) < self.max_rows:
                self._start_row(proposal, now)
                changed = True
            else:
                self.waiting.append(proposal)
        return self._finish(actions, changed, now)

    def interaction(self, dock_id, state, now):
        """マウスがミニドックの上に来た（state="enter"）・離れた（"leave"）"""
        if self.dock_id is None or dock_id != self.dock_id:
            return []  # 閉じたミニドックからの、遅れて届いた知らせは無視する
        if state == "enter":
            actions, changed = self._expire(now)  # 来る前に時間が尽きていた行は、先に片付ける
            if self.rows and not self.interacting:
                self._freeze(now)
            return self._finish(actions, changed, now)
        if state == "leave":
            if not self.interacting:
                return self.tick(now)
            self._resume(now)
            return self._finish([], True, now)  # 残り時間が変わったので、表示し直す
        logger.warning("ミニドック：知らない操作の状態を無視しました")
        return []

    def user_action(self, dock_id, entry_id, action, now, alternative_index=None):
        """ミニドックのボタンが押された（action は "accept"、"alternative"、"keep"、"open"）"""
        if self.dock_id is None or dock_id != self.dock_id:
            return []
        actions, changed = self._expire(now)
        row = self._find_row(entry_id)
        if row is None:
            return self._finish(actions, changed, now)  # 時間切れで閉じた行など
        proposal = row["proposal"]
        if action == "open":
            actions.append({"do": "open", "proposal_id": proposal.get("proposal_id"), "path": proposal.get("path")})
            return self._finish(actions, changed, now)
        decision = USER_DECISIONS.get(action)
        if decision is None:
            logger.warning("ミニドック：知らないボタンの操作を無視しました")
            return self._finish(actions, changed, now)
        if decision == "user_alternative":
            if not has_alternative(proposal, alternative_index):
                logger.warning("ミニドック：ほかの仕分け先の番号が正しくないため、無視しました")
                return self._finish(actions, changed, now)
        else:
            alternative_index = None
        self.rows.remove(row)
        actions.append(execute_action(proposal, decision, alternative_index))
        self._fill_rows(now)
        return self._finish(actions, True, now)

    def tick(self, now):
        """時間を進める（常駐処理のメインループから、短い間隔で呼ぶ）"""
        actions, changed = self._expire(now)
        return self._finish(actions, changed, now)

    def payload(self, now):
        """表示中のミニドックの内容（ui.mini_dock.show の形）。閉じていれば None

        シェルを起動し直したときに、表示を送り直すのにも使えます。
        """
        if self.dock_id is None:
            return None
        return {"dock_id": self.dock_id, "rows": [self._row_payload(row, now) for row in self.rows]}

    # --- ここから下は、このクラスの中だけで使うメソッド ---

    def _expire(self, now):
        """時間が尽きた行を閉じる。(実行の動作のリスト, 行が変わったか) を返す"""
        if self.interacting:
            return [], False  # マウスが上にある間は、時間を止めている
        expired = [row for row in self.rows if row["deadline"] <= now]
        expired.sort(key=lambda row: row["deadline"])
        actions = []
        for row in expired:
            self.rows.remove(row)
            if row["proposal"].get("status") in AUTO_EXECUTE_STATUSES:
                actions.append(execute_action(row["proposal"], "auto"))
        if expired:
            self._fill_rows(now)
        return actions, bool(expired)

    def _start_row(self, proposal, now):
        """提案を表示する行を作る（ミニドックが閉じていれば、新しい番号で開く）"""
        if self.dock_id is None:
            self.dock_count += 1
            self.dock_id = self.dock_count
        self.entry_count += 1
        row = {"entry_id": self.entry_count, "proposal": proposal, "deadline": None, "remaining": None}
        if self.interacting:
            row["remaining"] = self.seconds  # マウスが上にある間は、数え始めない
        else:
            row["deadline"] = now + self.seconds
        self.rows.append(row)

    def _fill_rows(self, now):
        """空いた行に、順番待ちの提案を先に来たものから入れる"""
        while self.waiting and len(self.rows) < self.max_rows:
            self._start_row(self.waiting.pop(0), now)

    def _freeze(self, now):
        """全行の残り時間を止める（締め切りの時刻を、残りの秒数に直して持つ）"""
        for row in self.rows:
            row["remaining"] = max(0.0, row["deadline"] - now)
            row["deadline"] = None
        self.interacting = True

    def _resume(self, now):
        """止めていた残り時間を数え直す。残りが短い行は、MINI_DOCK_GRACE_AFTER_LEAVE_SECONDS 秒にする"""
        for row in self.rows:
            row["deadline"] = now + max(row["remaining"], self.grace_seconds)
            row["remaining"] = None
        self.interacting = False

    def _finish(self, actions, changed, now):
        """最後に、表示の動作を足す（行がなければ閉じる、行が変わったら表示し直す）"""
        if self.dock_id is None:
            return actions
        if not self.rows:
            actions.append({"do": "close", "dock_id": self.dock_id, "reason": "empty"})
            self.dock_id = None
            self.interacting = False
        elif changed:
            actions.append({"do": "show", "dock": self.payload(now)})
        return actions

    def _find_row(self, entry_id):
        for row in self.rows:
            if row["entry_id"] == entry_id:
                return row
        return None

    def _has_proposal(self, proposal_id):
        """同じ提案が、すでに表示中か順番待ちなら True（同じ提案を2回表示しない）"""
        if proposal_id is None:
            return False
        for row in self.rows:
            if row["proposal"].get("proposal_id") == proposal_id:
                return True
        for proposal in self.waiting:
            if proposal.get("proposal_id") == proposal_id:
                return True
        return False

    def _remaining(self, row, now):
        if row["deadline"] is None:
            return row["remaining"]
        return max(0.0, row["deadline"] - now)

    def _row_payload(self, row, now):
        """1行の表示内容（docs/ipc-protocol.md 3節の rows の1つ）"""
        proposal = row["proposal"]
        destination = proposal.get("destination")
        name = proposal.get("name") or {}
        alternatives = []
        for alternative in proposal.get("alternatives") or []:
            alternatives.append({"index": alternative["index"], "label": alternative["rule"]})
        return {
            "entry_id": row["entry_id"],
            "file_name": proposal.get("file_name"),
            "status": proposal.get("status"),
            "dest_label": destination["rule"] if destination else None,
            "new_name": name.get("new_name"),
            "reasons": list(proposal.get("reasons") or []),
            "alternatives": alternatives,
            "context_label": proposal.get("context_label"),
            "remaining_seconds": round(self._remaining(row, now), 1),
        }


def execute_action(proposal, decision, alternative_index=None):
    """ミニドックが返す「提案を実行する」動作の辞書"""
    return {"do": "execute", "proposal_id": proposal.get("proposal_id"), "decision": decision,
            "alternative_index": alternative_index}


def has_alternative(proposal, index):
    """提案に、番号 index の「ほかの仕分け先」があれば True"""
    if not isinstance(index, int) or isinstance(index, bool):
        return False
    for alternative in proposal.get("alternatives") or []:
        if alternative.get("index") == index:
            return True
    return False


def write_together(conn):
    """まとめて書く（途中で失敗したら、すべて取り消す）。すでにまとめて書いている途中なら、その中で書く"""
    if conn.in_transaction:
        return contextlib.nullcontext()
    return database.transaction(conn)
