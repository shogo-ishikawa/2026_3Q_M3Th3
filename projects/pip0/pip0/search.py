"""エピソード記憶検索（M3）

「青いグラフ」「Slackで貰った」「先週の予算資料」のような、あいまいな言葉からファイルを探します。
正確なファイル名を知らなくても、見た目（色・グラフ）、入手経路、時期、内容を手掛かりにできます。

検索のときに重い解析はしません。使うのは、すでに暗号化DB にある情報だけです。
  files（名前、拡張子、最終更新日時）、analysis（解析の結果：本文、タイトル、色の割合、グラフらしさ）、
  provenance（入手経路の記録）、inflow（pip0 が流入を確認した日時）

手順
1. parse_query：言葉を手掛かり（cues）に分ける。使う辞書は rules.py（★言葉を足すときは rules.py を直します）
     時期（先週、3日前…）→ 入手経路（Slack、メール…）→ 色（青い、赤…）→ 見た目（グラフ、写真…）
     → 文書の種類（資料、表…）の順に探し、入手を表す言葉（貰った…）と助詞・ひらがなを読み飛ばし、
     残った2文字以上の語を「内容の語」にする
2. search：ファイルごとに、すべての手掛かりを調べ、一致した理由（根拠）を付ける
   - すべての手掛かりに一致 → 「一致」（results）
   - 一致がなければ、一部の手掛かりに一致したファイル → 「一部一致」（partial_results）
   - 一致しなかった理由が「情報が足りないこと」だけのファイルがある → 「情報不足」（insufficient_info）
     そうでなければ → 「該当なし」（no_match）
入手経路の記録がないファイルを、Slack 等から入手したとは扱いません。

「情報が足りない」（missing_info）とは、その種類のファイルで pip0 がふだん使う情報が、まだない・読めないことです。
  未解析・解析に失敗・対象外の大きさで、画像の色と形や文書の本文が分からない、入手経路の記録がない、など。
  画像の中の文字のように、pip0 がもともと調べないものは、情報不足ではありません（名前だけで判定します）。
"""

import json
import logging

from pip0 import context as context_module
from pip0 import database, timeutil

logger = logging.getLogger(__name__)

# 色の名前（analyse_image.COLOUR_NAMES）の表示名
COLOUR_LABELS = {
    "blue": "青系", "cyan": "水色系", "red": "赤系", "green": "緑系", "yellow": "黄色系",
    "orange": "橙系", "purple": "紫系", "pink": "ピンク系",
}
# 見た目の種類（rules.VISUAL_KIND_WORDS の値）の表示名
VISUAL_LABELS = {"chart": "グラフ", "photo": "写真", "image": "画像", "other": "そのほかの画像"}
# 文書の種類（rules.DOC_KIND_WORDS の値）の表示名
DOC_KIND_LABELS = {"document": "文書", "spreadsheet": "表", "slides": "スライド", "pdf": "PDF"}

# 本文を取り出す種類（rules.FILE_KINDS の値。analysis_queue.TEXT_KINDS と同じ）
TEXT_KINDS = ["pdf", "document", "spreadsheet", "slides", "text"]

# 入手経路の記録がないときの理由（provenance.NO_RECORD と同じ言葉は、補足として付けない）
MISSING_PROVENANCE = "入手経路の記録なし"
NO_DOWNLOAD_RECORD = "ダウンロードの記録なし"

# ★内容の語として使う、最も短い文字数
MIN_KEYWORD_CHARS = 2

# ★色の言葉に「色」を付けた言葉（「青色」「ピンク色」）も、同じ色の言葉として扱う
COLOUR_WORD_SUFFIX = "色"


# ----------------------------------------------------------------------
# 1. 言葉を手掛かりに分ける
# ----------------------------------------------------------------------


def parse_query(text, now, config, rules):
    """検索の言葉を、手掛かり（cues）に分ける

    返す辞書：{"text": 元の言葉, "cues": [手掛かり], "ignored": [読み飛ばした言葉]}
    手掛かりは {"type", "word", "label", …} の辞書で、type ごとに次の値を持ちます。
    - "time"：start、end（現地時刻の範囲の秒数。end は含まない）、period_label
    - "source"：labels（送信元の名前のリスト。「メール」なら ["Gmail", "Outlook"]）
    - "colour"：colour（色の名前）、colours（足し合わせる色。rules.COLOUR_GROUPS）
    - "visual"：kind（"chart"、"photo"、"image"）
    - "doc_kind"：kind、extensions（当てはまる拡張子）
    - "keyword"：内容の語（word）
    """
    original = str(text or "")
    remaining = context_module.normalise(original)
    cues = []
    ignored = []

    # 時期（「先週」「3日前」など）。範囲は端末の現地時刻で決める（timeutil）
    period = timeutil.find_period(remaining, now, config["WEEK_STARTS_ON"], config["RECENT_DAYS"])
    if period is not None:
        cues.append({"type": "time", "word": period["word"], "start": period["start"], "end": period["end"],
                     "period_label": period["label"], "label": "時期：" + period["label"]})
        remaining = context_module.blank_out(remaining, period["span"][0], period["span"][1])

    # 入手経路（「Slack」、まとめて指す「メール」）
    table = {}
    for label, words in rules.SOURCE_WORDS.items():
        for word in words:
            table[context_module.normalise(word)] = [label]
    for word, labels in rules.SOURCE_GROUP_WORDS.items():
        table[context_module.normalise(word)] = list(labels)
    found, remaining = context_module.take_words(remaining, list(table))
    for word in found:
        labels = table[word]
        label = f"入手経路：{labels[0]}" if len(labels) == 1 else f"入手経路：{word}（{'・'.join(labels)}）"
        add_cue(cues, {"type": "source", "word": word, "labels": labels, "label": label})

    # 色（長い言葉から探すので、「青い」は「青」より先に見つかる）
    table = {}
    for word, colour in rules.COLOUR_WORDS.items():
        table[context_module.normalise(word)] = colour
        table.setdefault(context_module.normalise(word + COLOUR_WORD_SUFFIX), colour)
    found, remaining = context_module.take_words(remaining, list(table))
    for word in found:
        colour = table[word]
        add_cue(cues, {"type": "colour", "word": word, "colour": colour,
                       "colours": list(rules.COLOUR_GROUPS.get(colour, [colour])),
                       "label": f"色：{COLOUR_LABELS.get(colour, colour)}"})

    # 見た目（グラフ、写真、画像）
    table = {context_module.normalise(word): kind for word, kind in rules.VISUAL_KIND_WORDS.items()}
    found, remaining = context_module.take_words(remaining, list(table))
    for word in found:
        kind = table[word]
        add_cue(cues, {"type": "visual", "word": word, "kind": kind,
                       "label": f"見た目：{VISUAL_LABELS.get(kind, kind)}"})

    # 文書の種類（資料、表、スライド、PDF）
    table = {context_module.normalise(word): kind for word, kind in rules.DOC_KIND_WORDS.items()}
    found, remaining = context_module.take_words(remaining, list(table))
    for word in found:
        kind = table[word]
        add_cue(cues, {"type": "doc_kind", "word": word, "kind": kind,
                       "extensions": list(rules.KIND_EXTENSIONS.get(kind, [])),
                       "label": f"種類：{DOC_KIND_LABELS.get(kind, kind)}"})

    # 読み飛ばす言葉：入手を表す言葉（「貰った」）、助詞など（rules.QUERY_PARTICLES）、ひらがなの続き
    found, remaining = context_module.take_words(remaining, rules.ACQUIRE_WORDS, whole_word=False)
    ignored.extend(found)
    found, remaining = context_module.take_words(remaining, rules.QUERY_PARTICLES)
    ignored.extend(found)
    found, remaining = take_hiragana(remaining)
    ignored.extend(found)

    # 残った語が、内容の語（「予算」）
    particles = {context_module.fold(word) for word in rules.QUERY_PARTICLES}
    for word in context_module.split_words(remaining):
        if len(word) < MIN_KEYWORD_CHARS or context_module.fold(word) in particles:
            ignored.append(word)
            continue
        add_cue(cues, {"type": "keyword", "word": word, "label": f"内容：{word}"})

    # 読み飛ばした言葉は、元の言葉の中に出てきた順に並べる
    position_text = context_module.ascii_lower(context_module.normalise(original))
    ignored = unique(ignored)
    ignored.sort(key=lambda word: position_text.find(context_module.ascii_lower(word)))
    return {"text": original, "cues": cues, "ignored": ignored}


def add_cue(cues, cue):
    """同じ手掛かり（同じ種類で同じ値）がなければ加える"""
    for other in cues:
        if other["type"] == cue["type"] and cue_value(other) == cue_value(cue):
            return
    cues.append(cue)


def cue_value(cue):
    """手掛かりを比べるための値"""
    if cue["type"] == "source":
        return tuple(cue["labels"])
    if cue["type"] == "colour":
        return cue["colour"]
    if cue["type"] in ("visual", "doc_kind"):
        return cue["kind"]
    return context_module.fold(cue["word"])


def take_hiragana(text):
    """ひらがなの続き（助詞、送り仮名、「もらった」の残りなど）を取り除く。(取り除いた部分のリスト, 残りの文)

    ★検索の言葉では、ひらがなを語の区切りとして読み飛ばします（「予算の内訳」→「予算」「内訳」）。
    ひらがなだけの語（「まとめ」など）で探したいときは、ここを変える必要があります。
    """
    runs = []
    current = ""
    kept = []
    for ch in text:
        if context_module.character_type(ch) == "hiragana":
            current += ch
            kept.append(" ")
            continue
        if current:
            runs.append(current)
            current = ""
        kept.append(ch)
    if current:
        runs.append(current)
    return runs, "".join(kept)


def unique(items):
    """同じものを除いたリスト（順番はそのまま）"""
    result = []
    for item in items:
        if item and item not in result:
            result.append(item)
    return result


# ----------------------------------------------------------------------
# 2. 検索する
# ----------------------------------------------------------------------


def search(conn, text, now, config, rules, limit=None):
    """検索の言葉に一致するファイルを、一致の理由と一緒に返す

    戻り値：{"query", "status", "results", "partial_results", "notes"}
    - query：parse_query の結果
    - status："found"（一致あり）、"no_match"（該当なし）、"insufficient_info"（情報不足）、"empty_query"（手掛かりなし）
    - results：すべての手掛かりに一致したファイル
    - partial_results：一致がないとき、一部の手掛かりに一致したファイル（一致した手掛かりの多い順）
      それぞれ {"file_id", "path", "name", "status", "reasons", "unmatched", "matched_count", "cue_count"}
      reasons は一致した手掛かりの根拠、unmatched は一致しなかった手掛かり {"cue", "reason", "missing_info"}
    - notes：補足（未解析の件数、入手経路の記録がない件数、読み飛ばした言葉など）
    """
    limit = config["SEARCH_MAX_RESULTS"] if limit is None else limit
    query = parse_query(text, now, config, rules)
    if not query["cues"]:
        notes = ["手掛かりになる言葉が見つかりませんでした（例：「青いグラフ」「Slackで貰った」「先週の予算資料」）"]
        if query["ignored"]:
            notes.append("読み飛ばした言葉：" + "、".join(query["ignored"]))
        return {"query": query, "status": "empty_query", "results": [], "partial_results": [], "notes": notes}

    candidates = load_candidates(conn)
    results = []
    partial = []
    insufficient = False
    for candidate in candidates:
        entry = evaluate(candidate, query["cues"], config, rules)
        if not entry["unmatched"]:
            results.append(entry)
            continue
        if entry["matched_count"] > 0:
            partial.append(entry)
        if all(item["missing_info"] for item in entry["unmatched"]):
            insufficient = True  # 未解析・記録なしでなければ、一致したかもしれない

    if results:
        status = "found"
    elif insufficient:
        status = "insufficient_info"
    else:
        status = "no_match"

    results.sort(key=lambda item: (-(item["sort_time"] or 0.0), item["name"], item["file_id"]))
    partial.sort(key=lambda item: (-item["matched_count"], -(item["sort_time"] or 0.0), item["name"],
                                   item["file_id"]))
    results = [drop_sort_time(item) for item in results[:limit]]
    partial = [] if results else [drop_sort_time(item) for item in partial[:limit]]
    notes = make_notes(query, candidates, status, config, rules)
    logger.info("検索：手掛かり %d 個、一致 %d 件、一部一致 %d 件（%s）",
                len(query["cues"]), len(results), len(partial), status)
    return {"query": query, "status": status, "results": results, "partial_results": partial, "notes": notes}


def load_candidates(conn):
    """検索の対象（存在するファイルと、退避中のゴースト）を、解析の結果・入手経路・流入の日時と一緒に読む"""
    files = database.query_all(conn, "SELECT * FROM files WHERE status IN ('present', 'ghost') ORDER BY id")
    analyses = {}
    for row in database.query_all(conn, "SELECT * FROM analysis"):
        analyses[row["file_id"]] = row
    provenances = {}
    for row in database.query_all(conn, "SELECT * FROM provenance"):
        provenances[row["file_id"]] = row
    detected = {}
    rows = database.query_all(conn, "SELECT file_id, detected_at FROM inflow WHERE file_id IS NOT NULL "
                                    "ORDER BY detected_at, id")
    for row in rows:
        detected.setdefault(row["file_id"], row["detected_at"])  # 最初に流入を確認した日時
    candidates = []
    for file_row in files:
        candidates.append({"file": file_row, "analysis": analyses.get(file_row["id"]),
                           "provenance": provenances.get(file_row["id"]), "detected_at": detected.get(file_row["id"])})
    return candidates


def evaluate(candidate, cues, config, rules):
    """1つのファイルを、すべての手掛かりで調べた結果（results の1件の形）"""
    reasons = []
    unmatched = []
    for cue in cues:
        check = check_cue(cue, candidate, config, rules)
        if check["matched"]:
            reasons.append(check["text"])
        else:
            unmatched.append({"cue": cue["label"], "reason": check["text"], "missing_info": check["missing_info"]})
    file_row = candidate["file"]
    return {"file_id": file_row["id"], "path": file_row["path"], "name": file_row["name"],
            "status": file_row["status"], "reasons": reasons, "unmatched": unmatched,
            "matched_count": len(reasons), "cue_count": len(cues), "sort_time": time_basis(candidate)[0]}


def drop_sort_time(entry):
    entry = dict(entry)
    del entry["sort_time"]
    return entry


def matched(text):
    return {"matched": True, "text": text, "missing_info": False}


def unmatched(text, missing_info=False):
    """一致しなかった。missing_info：未解析・記録なしのため分からない（情報不足）なら True"""
    return {"matched": False, "text": text, "missing_info": missing_info}


def check_cue(cue, candidate, config, rules):
    """1つの手掛かりで1つのファイルを調べる。{"matched", "text"（根拠か理由）, "missing_info"}"""
    kind = cue["type"]
    if kind == "time":
        return check_time(cue, candidate)
    if kind == "source":
        return check_source(cue, candidate)
    if kind == "colour":
        return check_colour(cue, candidate, config, rules)
    if kind == "visual":
        return check_visual(cue, candidate, config, rules)
    if kind == "doc_kind":
        return check_doc_kind(cue, candidate)
    if kind == "keyword":
        return check_keyword(cue, candidate, rules)
    raise ValueError(f"知らない手掛かりの種類です: {kind}")


# ----------------------------------------------------------------------
# 手掛かりごとの調べ方（★一致の決まりや根拠の文を変えたいときは、ここを直します）
# ----------------------------------------------------------------------


def time_basis(candidate):
    """時期を比べる日時 (秒数, 何の日時か, 何の記録か)。分からなければ (None, None, None)

    ダウンロード日時（ブラウザー拡張の記録）→ pip0 が流入を確認した日時 → 最終更新日時 の順に使う。
    """
    provenance = candidate["provenance"]
    if provenance is not None and provenance.get("downloaded_at") is not None:
        return float(provenance["downloaded_at"]), "ダウンロード日", "ブラウザー拡張の記録"
    if candidate["detected_at"] is not None:
        return float(candidate["detected_at"]), "流入を確認した日", "pip0 の流入の記録"
    if candidate["file"].get("mtime") is not None:
        return float(candidate["file"]["mtime"]), "最終更新日", "ファイルの更新日時"
    return None, None, None


def check_time(cue, candidate):
    at, what, record = time_basis(candidate)
    if at is None:
        return unmatched("時期：日時の記録がありません", missing_info=True)
    text = f"{what} {timeutil.local_date_str(at)}（{record}）"
    if cue["start"] <= at < cue["end"]:
        return matched(f"時期：{text}")
    return unmatched(f"時期：{text}は、{cue['period_label']}ではありません")


def check_source(cue, candidate):
    provenance = candidate["provenance"]
    label = provenance.get("source_label") if provenance else None
    if not label:
        # 記録がない・ホスト名が分からない：送信元は不明のまま（推測で Slack 等にしない）
        reason = MISSING_PROVENANCE
        evidence = provenance.get("evidence") if provenance else None
        if evidence and evidence != NO_DOWNLOAD_RECORD:
            reason += f"（{evidence}）"
        return unmatched(reason, missing_info=True)
    wanted = [context_module.fold(name) for name in cue["labels"]]
    if context_module.fold(label) in wanted:
        return matched(f"入手経路：{label}（{provenance.get('evidence') or '入手経路の記録'}）")
    return unmatched(f"入手経路：{label}（{'・'.join(cue['labels'])}ではありません）")


def check_colour(cue, candidate, config, rules):
    ext = candidate["file"]["ext"]
    if ext not in rules.KIND_EXTENSIONS["image"]:
        return unmatched(f"色：画像ではありません（{ext_label(ext)}）")
    analysis = candidate["analysis"]
    problem = analysis_problem(analysis)
    if problem is not None:
        return unmatched(f"色：{problem}（画像の色を調べていません）", missing_info=True)
    colours = read_json(analysis.get("colours_json"))
    colourful = analysis.get("colourful_ratio")
    if not isinstance(colours, dict) or colourful is None:
        return unmatched("色：色の解析の結果がありません", missing_info=True)
    if colourful < config["COLOUR_MIN_COLOURFUL"]:
        return unmatched(f"色：色付きの部分が少ない画像です（{percent(colourful)}%、"
                         f"{percent(config['COLOUR_MIN_COLOURFUL'])}% 未満）")
    share = 0.0
    for name in cue["colours"]:
        share += float(colours.get(name) or 0.0)
    text = f"{COLOUR_LABELS.get(cue['colour'], cue['colour'])} {percent(share)}%"
    if share >= config["COLOUR_MIN_SHARE"]:
        return matched(f"色：{text}（画像の色解析）")
    return unmatched(f"色：{text}（{percent(config['COLOUR_MIN_SHARE'])}% 未満）")


def check_visual(cue, candidate, config, rules):
    kind = cue["kind"]
    ext = candidate["file"]["ext"]
    analysis = candidate["analysis"]
    images = rules.KIND_EXTENSIONS["image"]
    if kind == "image":
        if ext in images:
            return matched(f"見た目：画像（{ext}）")
        return unmatched(f"見た目：画像ではありません（{ext_label(ext)}）")

    if kind == "photo":
        if ext not in rules.KIND_EXTENSIONS["photo"]:
            return unmatched(f"見た目：写真の形式ではありません（{ext_label(ext)}）")
        problem = analysis_problem(analysis)
        if problem is not None:
            return unmatched(f"見た目：{problem}（写真かどうかを調べていません）", missing_info=True)
        visual_kind = analysis.get("visual_kind")
        if visual_kind == "photo":
            return matched("見た目：写真（色数が多く、単色の背景が少ない画像）")
        return unmatched(f"見た目：写真ではありません（{VISUAL_LABELS.get(visual_kind, '不明')}）")

    # グラフ：画像はグラフらしさ、Office 文書はグラフの部品があるか
    if ext not in rules.KIND_EXTENSIONS["chart"]:
        return unmatched(f"見た目：グラフを探す形式ではありません（{ext_label(ext)}）")
    problem = analysis_problem(analysis)
    if problem is not None:
        return unmatched(f"見た目：{problem}（グラフかどうかを調べていません）", missing_info=True)
    if ext in images:
        score = analysis.get("chart_score")
        if score is None:
            return unmatched("見た目：グラフらしさの解析の結果がありません", missing_info=True)
        if score >= config["CHART_MIN_SCORE"]:
            evidence = read_json(analysis.get("chart_evidence_json"))
            detail = "、".join(evidence) if isinstance(evidence, list) and evidence else "画像の形の解析"
            return matched(f"見た目：グラフらしさ {score:.2f}（{detail}）")
        return unmatched(f"見た目：グラフらしさ {score:.2f}（{config['CHART_MIN_SCORE']:.2f} 未満）")
    has_chart = analysis.get("has_chart")
    if has_chart == 1:
        return matched(f"見た目：グラフを含む文書（{ext}）")
    if has_chart == 0:
        return unmatched(f"見た目：グラフを含まない文書（{ext}）")
    return unmatched("見た目：グラフの有無が分かりません", missing_info=True)


def check_doc_kind(cue, candidate):
    ext = candidate["file"]["ext"]
    label = DOC_KIND_LABELS.get(cue["kind"], cue["kind"])
    if ext in cue["extensions"]:
        return matched(f"種類：{label}（{ext}）")
    return unmatched(f"種類：{label}ではありません（{ext_label(ext)}）")


def check_keyword(cue, candidate, rules):
    """内容の語：ファイル名と、解析済みのタイトル・本文から探す

    本文を調べるのは、文書の種類（TEXT_KINDS）のファイルだけです。画像や ZIP などは名前だけを調べ、
    名前になければ「該当しない」とします（pip0 は画像の中の文字を読まないので、解析を待っても変わらない）。
    文書の本文が未解析・解析に失敗・対象外の大きさなどで読めていないときは「情報不足」です。
    """
    word = cue["word"]
    file_row = candidate["file"]
    analysis = candidate["analysis"]
    analysed = analysis is not None and analysis.get("status") == "done"
    places = []
    if context_module.contains_word(file_row["name"], word):
        places.append("ファイル名")
    if analysed and context_module.contains_word(analysis.get("title"), word):
        places.append("タイトル")
    if analysed and context_module.contains_word(analysis.get("text_excerpt"), word):
        places.append("本文")
    if places:
        return matched(f"内容：{'・'.join(places)}に「{word}」")

    kind = rules.FILE_KINDS.get(file_row["ext"], "other")
    if kind not in TEXT_KINDS:
        return unmatched(f"内容：名前に「{word}」がありません（この形式の本文は調べません）")
    problem = analysis_problem(analysis)
    if problem is not None:
        return unmatched(f"内容：名前に「{word}」がなく、本文は{problem}", missing_info=True)
    if not (analysis.get("text_excerpt") or "").strip():
        return unmatched(f"内容：名前・タイトルに「{word}」がなく、本文の文字は取り出せませんでした（スキャンした PDF など）")
    return unmatched(f"内容：名前・タイトル・本文に「{word}」がありません")


def analysis_problem(analysis):
    """解析の結果を使えないときの理由（未解析、解析に失敗 など）。使えるなら None"""
    status = analysis.get("status") if analysis else None
    if status == "done":
        return None
    if status == "failed":
        return "解析に失敗したため分かりません"
    if status == "unsupported":
        return "解析できない形式・大きさのため分かりません"
    return "未解析"


def read_json(value):
    """DB の JSON の文字列を読む。読めなければ None"""
    if not value:
        return None
    try:
        return json.loads(value)
    except ValueError:
        return None


def percent(ratio):
    """割合を、切り捨てた百分率の整数にする（0.629 → 62）。基準のすぐ下の値を、基準と同じ数で見せないため"""
    return int(ratio * 100 + 1e-9)


def ext_label(ext):
    return ext or "拡張子なし"


# ----------------------------------------------------------------------
# 補足（notes）
# ----------------------------------------------------------------------


def make_notes(query, candidates, status, config, rules):
    """検索の結果に添える補足の文のリスト"""
    notes = []
    cues = query["cues"]
    types = [cue["type"] for cue in cues]
    images = rules.KIND_EXTENSIONS["image"]

    for cue in cues:
        if cue["type"] == "time":
            notes.append(f"{cue['label']}は、端末の現地時刻で調べました")
    needs_image_analysis = "colour" in types or any(
        cue["type"] == "visual" and cue["kind"] in ("chart", "photo") for cue in cues)
    if needs_image_analysis:
        waiting, unreadable = count_analysis_states(candidates, lambda ext: ext in images)
        if waiting:
            notes.append(f"色・形をまだ調べていない画像が {waiting} 件あります"
                         "（電源接続中かつ3分間無操作のときに解析します）")
        if unreadable:
            notes.append(f"色・形を調べられなかった画像が {unreadable} 件あります（解析の失敗、大きすぎる画像など）")
    if "source" in types:
        count = 0
        for candidate in candidates:
            provenance = candidate["provenance"]
            if provenance is None or not provenance.get("source_label"):
                count += 1
        if count:
            notes.append(f"入手経路の記録がないファイルが {count} 件あります"
                         "（記録がないファイルを、Slack 等から入手したとは扱いません）")
    if "keyword" in types:
        waiting, unreadable = count_analysis_states(
            candidates, lambda ext: rules.FILE_KINDS.get(ext, "other") in TEXT_KINDS)
        if waiting:
            notes.append(f"本文をまだ解析していない文書が {waiting} 件あります"
                         "（電源接続中かつ3分間無操作のときに解析します）")
        if unreadable:
            notes.append(f"本文を読めなかった文書が {unreadable} 件あります（解析の失敗、対象外の形式・大きさなど）")
        for cue in cues:
            if cue["type"] == "keyword" and not any(mentions(candidate, cue["word"]) for candidate in candidates):
                notes.append(f"「{cue['word']}」は、ファイル名と、解析済みのタイトル・本文のどれにもありません")
    if query["ignored"]:
        notes.append("読み飛ばした言葉：" + "、".join(query["ignored"]))
    if not candidates:
        notes.append("索引にファイルがありません（対象のフォルダーを見直した後に、もう一度試してください）")
    if status == "insufficient_info":
        notes.append("一致しなかった理由が「未解析」や「入手経路の記録なし」だけのファイルがあります。"
                     "情報がそろえば一致する可能性があります（情報不足）")
    elif status == "no_match":
        notes.append("手掛かりのすべてに一致するファイルはありません（該当なし）")
    return notes


def count_analysis_states(candidates, wanted):
    """wanted(拡張子) が True のファイルのうち、(解析待ちの件数, 解析できなかった件数) を数える

    解析待ち：まだ解析していない（行がない、pending）。解析できなかった：解析に失敗した、対象外の形式・大きさ
    """
    waiting = 0
    unreadable = 0
    for candidate in candidates:
        if not wanted(candidate["file"]["ext"]):
            continue
        analysis = candidate["analysis"]
        status = analysis.get("status") if analysis else None
        if status in ("failed", "unsupported"):
            unreadable += 1
        elif status != "done":
            waiting += 1
    return waiting, unreadable


def mentions(candidate, word):
    """名前、または解析済みのタイトル・本文のどこかに word があれば True（check_keyword と同じ決まり）"""
    if context_module.contains_word(candidate["file"]["name"], word):
        return True
    analysis = candidate["analysis"]
    if analysis is None or analysis.get("status") != "done":
        return False
    return (context_module.contains_word(analysis.get("title"), word)
            or context_module.contains_word(analysis.get("text_excerpt"), word))
