"""浮上式デスク（desk.py）のテスト

- rank_files：点数の計算（docs/design.md 4-4 の決まりどおりか）を、DB に直接入れた索引の行で確かめる
- DeskController：シェイク、再表示の待ち時間、作業文脈の変化、通知領域からの表示
- ShakeDetector：シェイクと、シェイクでない動き
ファイルの中身は読まないので、索引の行だけを作ります（実際のファイルは作りません）。
"""

import time

import pytest

from pip0 import context, database, desk, rules

NOW = 1_793_235_600.0  # 2026-10-29 10:00（日本時間）
DAY = 24 * 60 * 60

SLACK_EVENT = {"hwnd": 1, "process_name": "slack.exe", "window_title": "予算2026 (Channel) - 研究室 - Slack",
               "is_file_dialog": False, "dialog_rect": None, "inaccessible": False, "at": NOW}


def slack_context(title="予算2026 (Channel) - 研究室 - Slack", **values):
    return context.parse_foreground(dict(SLACK_EVENT, window_title=title, **values), rules)


def add_file(db, env, name, *, status="present", mtime=NOW - 100 * DAY, analysis="done", title=None, text=None,
             source=None):
    """索引（files）に1行を加え、必要なら解析の結果と入手経路も加える。file_id を返す"""
    path = str(env["DOWNLOADS_DIR"] / name)
    ext = "." + name.rsplit(".", 1)[1].lower() if "." in name else ""
    file_id = database.execute(
        db,
        "INSERT INTO files (path, file_key, name, ext, size, mtime, location_kind, status, first_seen_at, "
        "last_seen_at, updated_at) VALUES (?, NULL, ?, ?, 100, ?, 'downloads', ?, ?, ?, ?)",
        (path, name, ext, mtime, status, NOW - 200 * DAY, NOW, NOW),
    )
    if analysis is not None:
        db.execute("INSERT INTO analysis (file_id, status, title, text_excerpt) VALUES (?, ?, ?, ?)",
                   (file_id, analysis, title, text))
    if source is not None:
        db.execute("INSERT INTO provenance (file_id, source_label, source_kind, evidence, recorded_at) "
                   "VALUES (?, ?, 'browser_extension', 'テスト', ?)", (file_id, source, NOW))
    return file_id


@pytest.fixture(autouse=True)
def tokyo(monkeypatch):
    """理由の文の日付（現地時刻）が、どの環境でも同じになるように、日本時間で動かす"""
    monkeypatch.setenv("TZ", "Asia/Tokyo")
    time.tzset()
    yield
    monkeypatch.undo()
    time.tzset()


@pytest.fixture
def ranked_db(db, env):
    ids = {
        "a": add_file(db, env, "予算2026.xlsx", mtime=NOW - 2 * DAY, title="2026年度 予算案", text="予算の内訳",
                      source="Slack"),
        "b": add_file(db, env, "memo.txt", mtime=NOW - 20 * DAY, text="来年度の予算について"),
        "c": add_file(db, env, "old.txt", text="関係のない文書"),
        "d": add_file(db, env, "予算.pdf", status="missing", mtime=NOW - DAY, title="予算"),
        "e": add_file(db, env, "2026計画.docx", status="ghost", analysis="pending", title="予算", text="予算"),
    }
    return ids


# ---------------------------------------------------------------------- 順位の計算


def test_rank_formula_scores_each_part(ranked_db, db, env):
    ranked = desk.rank_files(db, slack_context(), NOW, env, rules)
    assert [item["name"] for item in ranked] == ["予算2026.xlsx", "2026計画.docx", "memo.txt"]
    first, second, third = ranked
    # 名前・タイトルに「予算」+3、「2026」+3、本文に「予算」+2、Slack から入手 +2、2日前に変更 +1
    assert first["score"] == 11
    assert set(first) == {"file_id", "path", "name", "status", "score", "reasons"}
    assert first["file_id"] == ranked_db["a"] and first["status"] == "present"
    assert first["reasons"] == [
        "ファイル名・タイトルに「予算」（+3）",
        "本文に「予算」（+2）",
        "ファイル名・タイトルに「2026」（+3）",
        "作業中のアプリと同じ Slack から入手（+2）",
        "7日以内に使用・変更（2026-10-27、ファイルの更新）（+1）",
    ]
    # ゴースト（退避中）も候補。解析し直し待ち（pending）の古いタイトル・本文は数えない
    assert second["status"] == "ghost" and second["score"] == 3
    assert second["reasons"] == ["ファイル名に「2026」（+3）"]
    # 本文に「予算」+2、20日前に変更 +0.5
    assert third["score"] == 2.5
    assert third["reasons"] == ["本文に「予算」（+2）", "30日以内に使用・変更（2026-10-09、ファイルの更新）（+0.5）"]


def test_missing_files_and_low_scores_are_not_candidates(ranked_db, db, env):
    names = [item["name"] for item in desk.rank_files(db, slack_context(), NOW, env, rules, limit=10)]
    assert "予算.pdf" not in names  # 見つからないファイル
    assert "old.txt" not in names   # 0点（DESK_MIN_SCORE 未満）


def test_fewer_than_three_candidates_shows_only_those(db, env):
    add_file(db, env, "予算メモ.txt")
    add_file(db, env, "2026.txt")
    add_file(db, env, "関係なし.txt")
    ranked = desk.rank_files(db, slack_context(), NOW, env, rules)
    assert [item["name"] for item in ranked] == ["2026.txt", "予算メモ.txt"]  # 同じ点数・同じ日時なら名前の順
    assert all(item["score"] == 3 for item in ranked)


def test_limit_and_settings_cap_the_number_of_items(ranked_db, db, env):
    assert len(desk.rank_files(db, slack_context(), NOW, env, rules, limit=1)) == 1
    assert len(desk.rank_files(db, slack_context(), NOW, dict(env, DESK_MAX_ITEMS=2), rules, limit=3)) == 2
    high = desk.rank_files(db, slack_context(), NOW, dict(env, DESK_MIN_SCORE=3), rules)
    assert [item["name"] for item in high] == ["予算2026.xlsx", "2026計画.docx"]


def test_recent_use_records_count_as_well_as_modification(db, env):
    file_id = add_file(db, env, "資料.pdf", mtime=NOW - 300 * DAY)
    assert desk.rank_files(db, None, NOW, env, rules) == []
    db.execute("INSERT INTO usage_events (file_id, kind, at) VALUES (?, 'recent_item', ?)", (file_id, NOW - 3 * DAY))
    ranked = desk.rank_files(db, None, NOW, env, rules)
    assert ranked[0]["score"] == 1
    assert ranked[0]["reasons"] == ["7日以内に使用・変更（2026-10-26、「最近使ったファイル」の記録）（+1）"]


def test_source_points_only_when_the_app_is_the_same(ranked_db, db, env):
    chrome = context.parse_foreground({"process_name": "chrome.exe", "window_title": "予算2026 - Google Chrome"},
                                      rules)
    first = desk.rank_files(db, chrome, NOW, env, rules)[0]
    assert first["name"] == "予算2026.xlsx"
    assert first["score"] == 9  # Slack から入手した +2 はない
    assert not any("入手" in reason for reason in first["reasons"])


def test_without_context_only_recent_files_qualify(ranked_db, db, env):
    ranked = desk.rank_files(db, None, NOW, env, rules)
    # 文脈の語がないので、最近の変更の点だけ。DESK_MIN_SCORE（1.0）未満の memo.txt（0.5点）は出ない
    assert [(item["name"], item["score"]) for item in ranked] == [("予算2026.xlsx", 1)]


def test_equal_scores_put_recently_used_files_first(db, env):
    add_file(db, env, "予算_古い.txt", mtime=NOW - 100 * DAY)
    add_file(db, env, "予算_新しい.txt", mtime=NOW - 40 * DAY)
    ranked = desk.rank_files(db, slack_context(), NOW, env, rules)
    assert [item["name"] for item in ranked] == ["予算_新しい.txt", "予算_古い.txt"]


def test_keywords_match_full_width_text(db, env):
    add_file(db, env, "report.docx", text="２０２６年度の計画")
    ranked = desk.rank_files(db, slack_context(), NOW, env, rules)
    assert ranked[0]["reasons"] == ["本文に「2026」（+2）"]


# ---------------------------------------------------------------------- 表示・非表示の決まり


ITEMS = [{"file_id": 1, "path": "/demo/予算.xlsx", "name": "予算.xlsx", "status": "present", "score": 6,
          "reasons": ["ファイル名に「予算」（+3）"]}]


def test_context_change_shows_the_desk_with_its_payload(env):
    controller = desk.DeskController(env)
    actions = controller.on_context(slack_context(), ITEMS, NOW)
    assert actions == [{"do": "show", "desk": {
        "desk_id": 1, "context_label": "Slack（予算2026）", "partner_label": "チャット相手：予算2026（チャンネル）",
        "dialog_hwnd": None, "dialog_rect": None,
        "items": [{"path": "/demo/予算.xlsx", "name": "予算.xlsx", "status": "present",
                   "reasons": ["ファイル名に「予算」（+3）"]}]}}]
    assert controller.visible
    # 同じ内容は送り直さない（ちらつかないように）
    assert controller.on_context(slack_context(), ITEMS, NOW + 1) == []
    # 候補がなくなったら隠す
    assert controller.on_context(slack_context("別 (Channel) - 研究室 - Slack"), [], NOW + 2) == [
        {"do": "hide", "reason": "no_items"}]
    assert not controller.visible
    assert controller.on_context(slack_context("別 (Channel) - 研究室 - Slack"), [], NOW + 3) == []


def test_shake_hides_immediately_and_waits_for_a_new_context_and_the_cooldown(env):
    controller = desk.DeskController(env)
    controller.on_context(slack_context(), ITEMS, NOW)
    assert controller.on_shake(NOW + 1) == [{"do": "hide", "reason": "shake"}]
    assert controller.on_shake(NOW + 2) == []  # すでに隠れている
    # 同じ文脈のまま：60秒たっても出さない
    assert controller.on_context(slack_context(), ITEMS, NOW + 120) == []
    # 文脈が変わっても、60秒たつまでは出さない
    other = slack_context("経理 (Channel) - 研究室 - Slack")
    assert controller.on_context(other, ITEMS, NOW + 30) == []
    # 文脈が変わり、かつ60秒たった
    actions = controller.on_context(other, ITEMS, NOW + 61)
    assert [action["do"] for action in actions] == ["show"]
    assert actions[0]["desk"]["context_label"] == "Slack（経理）"


def test_returning_to_the_shaken_context_keeps_the_desk_hidden(env):
    controller = desk.DeskController(env)
    controller.on_context(slack_context(), ITEMS, NOW)
    controller.on_shake(NOW)
    other = slack_context("経理 (Channel) - 研究室 - Slack")
    assert controller.on_context(other, ITEMS, NOW + 10) == []
    assert controller.on_context(slack_context(), ITEMS, NOW + 100) == []  # 元の文脈に戻った
    assert [action["do"] for action in controller.on_context(other, ITEMS, NOW + 110)] == ["show"]


def test_tick_reshows_after_the_cooldown_when_the_context_has_already_changed(env):
    controller = desk.DeskController(env)
    controller.on_context(slack_context(), ITEMS, NOW)
    controller.on_shake(NOW)
    assert controller.on_context(slack_context("経理 (Channel) - 研究室 - Slack"), ITEMS, NOW + 10) == []
    assert controller.tick(NOW + 30) == []
    assert [action["do"] for action in controller.tick(NOW + 60)] == ["show"]
    assert controller.tick(NOW + 70) == []


def test_tray_request_shows_at_once_even_after_a_shake(env):
    controller = desk.DeskController(env)
    controller.on_context(slack_context(), ITEMS, NOW)
    controller.on_shake(NOW)
    actions = controller.on_show_request(NOW + 1)
    assert [action["do"] for action in actions] == ["show"]
    assert actions[0]["desk"]["desk_id"] == 2
    # シェイクの待ちは解除される：次の文脈の変化ですぐに出る
    other = slack_context("経理 (Channel) - 研究室 - Slack")
    assert [action["do"] for action in controller.on_context(other, ITEMS, NOW + 2)] == ["show"]


def test_tray_request_without_items_reports_no_items(env):
    controller = desk.DeskController(env)
    assert controller.on_show_request(NOW) == [{"do": "hide", "reason": "no_items"}]
    controller.on_context(slack_context(), [], NOW)
    assert controller.on_show_request(NOW + 1) == [{"do": "hide", "reason": "no_items"}]


def test_file_dialog_puts_the_desk_on_the_dialog(env):
    controller = desk.DeskController(env)
    rect = {"left": 100, "top": 80, "right": 900, "bottom": 600}
    dialog = context.carry_over(slack_context(), slack_context("開く", hwnd=777, is_file_dialog=True,
                                                                 dialog_rect=rect))
    actions = controller.on_context(dialog, ITEMS, NOW)
    payload = actions[0]["desk"]
    assert payload["dialog_hwnd"] == 777 and payload["dialog_rect"] == rect
    assert payload["context_label"] == "Slack（予算2026）・ファイルダイアログ"


def test_pip0_own_windows_do_not_change_the_context(env):
    controller = desk.DeskController(env)
    controller.on_context(slack_context(), ITEMS, NOW)
    own = context.parse_foreground({"process_name": "Pip0Shell.exe", "window_title": "pip0"}, rules)
    assert controller.on_context(own, [], NOW + 1) == []
    assert controller.visible
    assert controller.context["process"] == "slack.exe"


def test_unknown_foreground_hides_with_reason_context(env):
    controller = desk.DeskController(env)
    controller.on_context(slack_context(), ITEMS, NOW)
    assert controller.on_context(None, [], NOW + 1) == [{"do": "hide", "reason": "context"}]


# ---------------------------------------------------------------------- シェイク


def path(turns, step_px=40, step_ms=33, start_ms=0, axis="x"):
    """turns の位置を順に折り返しながら、step_ms ごとに step_px ずつ動くマウスの位置の列"""
    samples = []
    t = start_ms
    position = turns[0]
    for target in turns:
        while True:
            x, y = (position, 300) if axis == "x" else (500, position)
            if not samples or samples[-1][0] != t:
                samples.append([t, x, y])
            if position == target:
                break
            move = min(step_px, abs(target - position))
            position += move if target > position else -move
            t += step_ms
    return samples


SHAKE = path([500, 620, 420, 620, 420, 620])  # 120〜200px の振りを4回折り返す（約0.6秒）


def test_fast_horizontal_shake_is_detected(env):
    assert desk.ShakeDetector(env).feed(SHAKE) is True


def test_slow_drift_and_slow_back_and_forth_are_not_shakes(env):
    assert desk.ShakeDetector(env).feed(path([100, 900], step_px=10)) is False  # ゆっくり右へ動くだけ
    slow = path([500, 620, 420, 620, 420, 620, 420], step_ms=300)  # 同じ振りでも、1回に1秒以上かかる
    assert desk.ShakeDetector(env).feed(slow) is False


def test_small_jitter_and_vertical_motion_are_not_shakes(env):
    jitter = path([500, 515, 485, 515, 485, 515, 485, 515, 485], step_px=15)  # 40px 未満の手ぶれ
    assert desk.ShakeDetector(env).feed(jitter) is False
    vertical = path([300, 420, 220, 420, 220, 420, 220], axis="y")  # 上下だけに振る
    assert desk.ShakeDetector(env).feed(vertical) is False


def test_shake_is_reported_once_then_counting_starts_again(env):
    detector = desk.ShakeDetector(env)
    assert detector.feed(SHAKE) is True
    end = SHAKE[-1][0]
    assert detector.feed([[end + 33, 580, 300], [end + 66, 540, 300]]) is False
    assert detector.feed(path([500, 620, 420, 620, 420, 620], start_ms=end + 500)) is True


def test_shake_split_across_batches(env):
    detector = desk.ShakeDetector(env)
    batches = [SHAKE[i:i + 3] for i in range(0, len(SHAKE), 3)]  # 100ms ごとにまとめて届く
    results = [detector.feed(batch) for batch in batches]
    assert results.count(True) == 1


def test_a_pause_resets_the_count(env):
    detector = desk.ShakeDetector(env)
    first = path([500, 620, 420, 620])  # 折り返し2回
    assert detector.feed(first) is False
    second = path([620, 420, 620, 420], start_ms=first[-1][0] + 1000)  # 1秒止まってから、折り返し2回
    assert detector.feed(second) is False


def test_malformed_samples_are_ignored(env):
    detector = desk.ShakeDetector(env)
    noisy = [["x", 1, 2], [1, None, 2], [True, 3, 4], [5]] + SHAKE
    assert detector.feed(noisy) is True
    assert detector.feed(None) is False
