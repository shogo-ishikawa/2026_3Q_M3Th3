"""解析の順番待ちと、1ファイルの解析・結果の保存（analysis_queue.py）のテスト

ファイルは一時フォルダー（tmp_path）の中のダミーだけを使い、OS 連携は代役（FakePlatform）です。
"""

import hashlib
import json
import logging
import os
import zipfile

from PIL import Image, ImageDraw

from pip0 import analyse_text, analysis_queue, database, rules, throttle

NOW = 1_793_250_000.0
W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


# ---------------------------------------------------------------------- テスト用のファイルと行


def make_docx(path, text, title=None):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml",
                         f'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="{W_NS}"><w:body>'
                         f"<w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body></w:document>")
        if title is not None:
            archive.writestr("docProps/core.xml",
                             '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/'
                             'metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">'
                             f"<dc:title>{title}</dc:title></cp:coreProperties>")
    return path


def make_chart_png(path, colour=(31, 119, 180)):
    image = Image.new("RGB", (400, 300), (255, 255, 255))
    draw = ImageDraw.Draw(image)
    for index, height in enumerate([120, 200, 90, 160]):
        draw.rectangle([70 + index * 80, 260 - height, 120 + index * 80, 259], fill=colour)
    draw.line([(50, 30), (50, 260)], fill=(0, 0, 0), width=2)
    draw.line([(50, 260), (380, 260)], fill=(0, 0, 0), width=2)
    image.save(path)
    return path


def add_file_row(db, path):
    """files テーブルに1行を加え、その id を返す（scanner を使わずに、テストの準備だけをする）"""
    st = os.stat(path)
    return database.execute(
        db,
        "INSERT INTO files (path, name, ext, size, mtime, location_kind, first_seen_at, last_seen_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, 'downloads', ?, ?, ?)",
        (str(path), path.name, path.suffix.lower(), st.st_size, st.st_mtime, NOW, NOW, NOW),
    )


def analysis_row(db, file_id):
    return database.query_one(db, "SELECT * FROM analysis WHERE file_id = ?", (file_id,))


def always():
    return True


def analyse(path, platform, config, should_continue=always):
    return analysis_queue.analyse_file(path, platform, config, rules, should_continue)


# ---------------------------------------------------------------------- 順番待ち（作成済みの関数）


def test_queue_order_marking_and_reset(db, tmp_path):
    first = add_file_row(db, make_docx(tmp_path / "a.docx", "a"))
    second = add_file_row(db, make_docx(tmp_path / "b.docx", "b"))
    low = analysis_queue.enqueue(db, "analyse", first, now=NOW)
    high = analysis_queue.enqueue(db, "analyse", second, priority=5, now=NOW + 1)
    assert analysis_queue.enqueue(db, "analyse", first, now=NOW + 2) == low  # 同じものは増やさない
    assert analysis_queue.pending_count(db) == 2
    assert analysis_queue.next_task(db)["id"] == high
    analysis_queue.mark(db, high, "running", now=NOW + 3)
    analysis_queue.reset_running(db, now=NOW + 4)  # 前回の終了時に実行中だったものは待ちに戻す
    assert analysis_queue.next_task(db, "analyse")["id"] == high
    analysis_queue.mark(db, high, "done", now=NOW + 5)
    assert analysis_queue.pending_count(db, "analyse") == 1
    assert analysis_queue.next_task(db, "evacuate") is None


# ---------------------------------------------------------------------- 1ファイルの解析


def test_analyse_document(env, platform, tmp_path):
    path = make_docx(tmp_path / "file_0001.docx", "2026年度 予算案", title="予算案")
    result = analyse(path, platform, env)
    assert set(result) == set(analysis_queue.RESULT_KEYS)
    assert result["status"] == "done"
    assert result["kind"] == "document"
    assert result["sha256"] == hashlib.sha256(path.read_bytes()).hexdigest()
    assert result["size"] == path.stat().st_size and result["mtime"] == path.stat().st_mtime
    assert result["title"] == "予算案"
    assert result["text"] == "2026年度 予算案"
    assert result["has_chart"] is False and result["labels"] == []
    assert result["colours"] is None and result["chart_score"] is None  # 画像の項目は空


def test_analyse_image(env, platform, tmp_path):
    path = make_chart_png(tmp_path / "IMG_0001.png")
    result = analyse(path, platform, env)
    assert result["status"] == "done"
    assert result["kind"] == "image"
    assert result["colours"]["blue"] >= 0.35
    assert result["visual_kind"] == "chart"
    assert result["chart_evidence"]
    assert result["text"] is None and result["title"] is None


def test_ghosts_and_cloud_placeholders_are_not_read(env, platform, tmp_path):
    path = make_docx(tmp_path / "ghost.docx", "本文")
    platform.not_local.add(str(path))
    opened = []
    platform.open_for_analysis = lambda target: opened.append(target)
    result = analyse(path, platform, env)
    assert result["status"] == "skipped"
    assert result["reason"]
    assert opened == []  # 開いていない（Windows では、開くと中身の取得が始まる）


def test_missing_file_is_skipped(env, platform, tmp_path):
    result = analyse(tmp_path / "gone.docx", platform, env)
    assert result["status"] == "skipped"


def test_large_file_is_not_analysed(env, platform, tmp_path):
    path = make_docx(tmp_path / "big.docx", "本文" * 100)
    result = analyse(path, platform, dict(env, ANALYSE_MAX_FILE_BYTES=100))
    assert result["status"] == "unsupported"
    assert result["sha256"] is None
    assert "大きい" in result["error"]


def test_unknown_format_is_hashed_but_not_analysed(env, platform, tmp_path):
    path = tmp_path / "archive.zip"
    path.write_bytes(b"PK\x05\x06" + b"\x00" * 18)
    result = analyse(path, platform, env)
    assert result["status"] == "unsupported"
    assert result["kind"] == "other"
    assert result["sha256"] == hashlib.sha256(path.read_bytes()).hexdigest()


def test_broken_document_is_failed_with_a_reason(env, platform, tmp_path):
    path = tmp_path / "broken.xlsx"
    path.write_bytes(b"not a zip")
    result = analyse(path, platform, env)
    assert result["status"] == "failed"
    assert result["error"] and result["sha256"]


def test_pauses_in_the_middle_of_hashing_and_completes_later(env, platform, tmp_path):
    config = dict(env, HASH_CHUNK_BYTES=1024)
    path = tmp_path / "memo.txt"
    path.write_text("予算の説明。" * 1000, encoding="utf-8")  # 約 18KB（18 個の区切り）
    answers = iter([True, True, True, False])  # 3つ目の区切りの後で、ユーザーが操作を再開した

    def should_continue():
        return next(answers)

    assert analyse(path, platform, config, should_continue) == {"status": "paused"}
    result = analyse(path, platform, config)  # 次に条件を満たしたとき、最初からやり直す
    assert result["status"] == "done"
    assert result["sha256"] == hashlib.sha256(path.read_bytes()).hexdigest()
    assert result["text"].startswith("予算の説明。")


def test_heavy_gate_pauses_hashing_when_the_user_returns(env, tmp_path):
    from pip0.platform_fake import FakePlatform

    platform = FakePlatform(idle_seconds=200, power="ac")
    clock = {"now": NOW}
    gate = throttle.HeavyGate(platform, env, clock=lambda: clock["now"])
    config = dict(env, HASH_CHUNK_BYTES=1024)
    path = tmp_path / "data.csv"
    path.write_text("項目,金額\n" * 2000, encoding="utf-8")
    calls = []

    def should_continue():
        calls.append(1)
        clock["now"] += 0.3  # 1つの区切りに 0.3 秒かかるとする
        if len(calls) == 5:
            platform.idle_seconds = 0  # 5つ目の区切りで、マウスが動いた
        return gate.should_continue()

    assert analyse(path, platform, config, should_continue) == {"status": "paused"}
    assert len(calls) < 10  # 18 個の区切りの途中で止まった
    platform.idle_seconds = 400
    clock["now"] += 1
    assert gate.may_run() is False  # may_run() は THROTTLE_CHECK_SECONDS の間、前の結果を使う
    clock["now"] += env["THROTTLE_CHECK_SECONDS"]
    assert gate.may_run() is True
    assert analyse(path, platform, config, gate.should_continue)["status"] == "done"


def test_pauses_after_analysis_when_conditions_break(env, platform, tmp_path):
    path = make_docx(tmp_path / "a.docx", "本文")
    answers = iter([True, True, False])  # ハッシュ（区切り2つ）は続け、解析の後で止める
    assert analyse(path, platform, env, lambda: next(answers)) == {"status": "paused"}


def test_file_changed_during_analysis_is_not_stored(env, platform, tmp_path, monkeypatch):
    path = make_docx(tmp_path / "a.docx", "本文")
    real_extract = analyse_text.extract_text

    def extract_while_someone_edits(target, *args):
        result = real_extract(target, *args)
        with open(target, "ab") as f:
            f.write(b"edited")  # 解析の途中で、ほかのアプリが書き換えた
        return result

    monkeypatch.setattr(analyse_text, "extract_text", extract_while_someone_edits)
    result = analyse(path, platform, env)
    assert result["status"] == "skipped"
    assert "変わった" in result["reason"]


# ---------------------------------------------------------------------- 結果の保存と機密の判定


def test_store_result_writes_analysis_and_sensitivity(env, platform, db, tmp_path):
    path = make_docx(tmp_path / "report.docx", "この資料は社外秘です", title="2026年度 予算案")
    file_id = add_file_row(db, path)
    result = analyse(path, platform, env)
    verdict = analysis_queue.store_result(db, file_id, path, result, env, rules, NOW)
    assert verdict["level"] == "sensitive"
    row = analysis_row(db, file_id)
    assert row["status"] == "done"
    assert row["analysed_at"] == NOW
    assert row["analyser_version"] == analysis_queue.ANALYSER_VERSION
    assert row["sha256"] == result["sha256"]
    assert row["size_at_analysis"] == result["size"]
    assert row["kind"] == "document" and row["title"] == "2026年度 予算案"
    assert row["text_excerpt"] == "この資料は社外秘です"
    assert row["has_chart"] == 0
    assert json.loads(row["labels_json"]) == []
    assert row["sensitivity"] == "sensitive"
    assert json.loads(row["sensitivity_reasons_json"]) == ["本文に「社外秘」"]


def test_store_result_for_a_clean_document_and_an_image(env, platform, db, tmp_path):
    doc = make_docx(tmp_path / "plain.docx", "2026年度 予算案")
    doc_id = add_file_row(db, doc)
    analysis_queue.store_result(db, doc_id, doc, analyse(doc, platform, env), env, rules, NOW)
    assert analysis_row(db, doc_id)["sensitivity"] == "not_sensitive"

    image = make_chart_png(tmp_path / "chart.png")
    image_id = add_file_row(db, image)
    verdict = analysis_queue.store_result(db, image_id, image, analyse(image, platform, env), env, rules, NOW)
    row = analysis_row(db, image_id)
    assert json.loads(row["colours_json"])["blue"] >= 0.35
    assert row["colourful_ratio"] > 0
    assert row["chart_score"] >= 0.6 and row["visual_kind"] == "chart"
    assert json.loads(row["chart_evidence_json"])
    assert row["has_chart"] is None and row["text_excerpt"] is None
    assert verdict["level"] == "unknown"  # 画像の中の文字は調べていないので、非機密とは言えない
    assert row["sensitivity"] == "unknown"


def test_store_result_replaces_the_pending_row_made_by_the_scanner(env, platform, db, tmp_path):
    path = make_docx(tmp_path / "a.docx", "本文")
    file_id = add_file_row(db, path)
    db.execute("INSERT INTO analysis (file_id, status) VALUES (?, 'pending')", (file_id,))
    analysis_queue.store_result(db, file_id, path, analyse(path, platform, env), env, rules, NOW)
    rows = database.query_all(db, "SELECT status FROM analysis WHERE file_id = ?", (file_id,))
    assert rows == [{"status": "done"}]


def test_paused_and_skipped_results_are_not_written(env, platform, db, tmp_path):
    path = make_docx(tmp_path / "a.docx", "本文")
    file_id = add_file_row(db, path)
    db.execute("INSERT INTO analysis (file_id, status) VALUES (?, 'pending')", (file_id,))
    for result in [{"status": "paused"}, {"status": "skipped", "reason": "ゴースト"}]:
        assert analysis_queue.store_result(db, file_id, path, result, env, rules, NOW) is None
    row = analysis_row(db, file_id)
    assert row["status"] == "pending" and row["analysed_at"] is None and row["sensitivity"] == "unknown"


def test_failed_and_unsupported_results_are_unknown_unless_the_name_says_otherwise(env, platform, db, tmp_path):
    broken = tmp_path / "broken.docx"
    broken.write_bytes(b"not a zip")
    broken_id = add_file_row(db, broken)
    verdict = analysis_queue.store_result(db, broken_id, broken, analyse(broken, platform, env), env, rules, NOW)
    assert verdict["level"] == "unknown"
    assert verdict["reasons"][0].startswith("解析に失敗")
    assert analysis_row(db, broken_id)["error"]

    secret = tmp_path / "社外秘_旧形式.doc"
    secret.write_bytes(b"\xd0\xcf\x11\xe0 old word file")
    secret_id = add_file_row(db, secret)
    verdict = analysis_queue.store_result(db, secret_id, secret, analyse(secret, platform, env), env, rules, NOW)
    assert analysis_row(db, secret_id)["status"] == "unsupported"
    assert verdict == {"level": "sensitive", "reasons": ["名前に「社外秘」"]}


def test_store_result_cuts_text_and_works_inside_a_transaction(env, db, tmp_path):
    path = make_docx(tmp_path / "a.docx", "本文")
    file_id = add_file_row(db, path)
    result = {key: None for key in analysis_queue.RESULT_KEYS}
    result.update({"status": "done", "kind": "text", "text": "あ" * 50, "sha256": "0" * 64})
    with database.transaction(db):
        analysis_queue.store_result(db, file_id, path, result, dict(env, TEXT_MAX_CHARS=10), rules, NOW)
    assert analysis_row(db, file_id)["text_excerpt"] == "あ" * 10


def test_analysis_writes_no_names_or_contents_to_the_logs(env, platform, db, tmp_path, caplog):
    caplog.set_level(logging.DEBUG)
    paths = [
        make_docx(tmp_path / "MARKERNAME_一.docx", "MARKERTEXT 社外秘", title="MARKERTITLE"),
        make_chart_png(tmp_path / "MARKERNAME_二.png"),
        tmp_path / "MARKERNAME_三.pdf",
    ]
    paths[2].write_bytes(b"%PDF-1.4\n(MARKERTEXT) broken")
    for path in paths:
        file_id = add_file_row(db, path)
        analysis_queue.store_result(db, file_id, path, analyse(path, platform, env), env, rules, NOW)
    assert "MARKER" not in caplog.text
    assert str(tmp_path) not in caplog.text


def test_store_result_with_a_card_number_does_not_store_it_in_the_reasons(env, platform, db, tmp_path):
    path = tmp_path / "memo.txt"
    path.write_text("支払い用 4111 1111 1111 1111", encoding="utf-8")
    file_id = add_file_row(db, path)
    analysis_queue.store_result(db, file_id, path, analyse(path, platform, env), env, rules, NOW)
    row = analysis_row(db, file_id)
    assert row["sensitivity"] == "sensitive"
    assert "4111" not in row["sensitivity_reasons_json"]
