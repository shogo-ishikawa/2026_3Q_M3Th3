"""利用の記録と「長期間未読」の判定（usage.py）のテスト

時刻は決まった値（NOW）を使い、ファイルは一時フォルダー（tmp_path）の中だけで作ります。
"""

import pytest

from pip0 import database, usage

DAY = 24 * 60 * 60
NOW = 1_793_000_000.0  # テストで使う決まった時刻


def add_file_row(db, path, *, first_seen_days_ago, mtime_days_ago, location_kind="pip0_root", size=2_000_000):
    first_seen = NOW - first_seen_days_ago * DAY
    mtime = None if mtime_days_ago is None else NOW - mtime_days_ago * DAY
    file_id = database.execute(
        db,
        "INSERT INTO files (path, name, ext, size, mtime, location_kind, first_seen_at, last_seen_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (str(path), path.name, path.suffix.lower(), size, mtime, location_kind, first_seen, NOW, NOW),
    )
    return database.query_one(db, "SELECT * FROM files WHERE id = ?", (file_id,))


def usage_count(db):
    return database.query_one(db, "SELECT count(*) AS n FROM usage_events")["n"]


@pytest.fixture
def old_file(env, db):
    """200 日前から観測していて、150 日前に更新したきりのファイル"""
    return add_file_row(db, env["PIP0_ROOT"] / "古い資料.pdf", first_seen_days_ago=200, mtime_days_ago=150)


def sources_with_recent(platform, row):
    return usage.tracking_sources(platform, row["path"], recent_items_enabled=True)


# ---------------------------------------------------------------------- 記録


def test_record_usage_stores_a_row(db, old_file):
    row_id = usage.record_usage(db, old_file["id"], "ghost_open", NOW - DAY, process_name="WINWORD.EXE",
                                detail={"by_pip0": False, "elapsed_ms": 12})
    assert row_id is not None
    row = database.query_one(db, "SELECT * FROM usage_events WHERE id = ?", (row_id,))
    assert row["kind"] == "ghost_open"
    assert row["process_name"] == "WINWORD.EXE"
    assert '"elapsed_ms": 12' in row["detail"]


@pytest.mark.parametrize(
    "process_name, detail",
    [
        ("explorer.exe", {"by_pip0": True}),   # シェルが「pip0 自身が開いた」と知らせた
        (None, "by_pip0"),
        ("Pip0Shell.exe", None),               # pip0 シェルそのもの
    ],
)
def test_record_usage_ignores_pip0_itself(db, old_file, process_name, detail):
    assert usage.record_usage(db, old_file["id"], "ghost_open", NOW, process_name=process_name, detail=detail) is None
    assert usage_count(db) == 0


def test_record_usage_rejects_unknown_kind(db, old_file):
    with pytest.raises(ValueError):
        usage.record_usage(db, old_file["id"], "opened_somehow", NOW)


def test_record_recent_items_counts_only_known_files_once(env, db, old_file):
    other = add_file_row(db, env["PIP0_ROOT"] / "別の資料.docx", first_seen_days_ago=10, mtime_days_ago=10)
    items = [
        {"target_path": old_file["path"], "opened_at": NOW - 5 * DAY},
        {"target_path": old_file["path"], "opened_at": NOW - 5 * DAY},      # 同じ記録（二重に数えない）
        {"target_path": other["path"].upper(), "opened_at": NOW - DAY},     # 大文字・小文字だけが違う
        {"target_path": str(env["PIP0_ROOT"] / "索引にない.txt"), "opened_at": NOW},
        {"target_path": old_file["path"], "opened_at": "昨日"},             # 形が正しくない
        {"target_path": old_file["path"], "opened_at": True},
        "壊れた項目",
        {"opened_at": NOW},
        {"target_path": old_file["path"], "opened_at": NOW + 3 * DAY},      # 未来の時刻は NOW として数える
    ]
    assert usage.record_recent_items(db, items, NOW) == 3
    assert usage.record_recent_items(db, items, NOW) == 0  # もう一度送られても増えない
    rows = database.query_all(db, "SELECT file_id, at FROM usage_events ORDER BY at")
    assert [(r["file_id"], r["at"]) for r in rows] == [
        (old_file["id"], NOW - 5 * DAY), (other["id"], NOW - DAY), (old_file["id"], NOW),
    ]


# ---------------------------------------------------------------------- 使える記録


def test_tracking_sources_with_recent_items(platform, old_file):
    platform.access_time_reliable_value = False
    sources = usage.tracking_sources(platform, old_file["path"], recent_items_enabled=True)
    assert sources["reliable"] is True
    assert "recent_item" in sources["sources"]
    assert "access_time" not in sources["sources"]
    assert "「最近使ったファイル」" in sources["reason"]


def test_tracking_sources_with_reliable_access_time(platform, old_file):
    platform.access_time_reliable_value = True
    sources = usage.tracking_sources(platform, old_file["path"], recent_items_enabled=False)
    assert sources["reliable"] is True
    assert "access_time" in sources["sources"]
    assert "recent_item" not in sources["sources"]


@pytest.mark.parametrize("recent, access_time, word", [(False, False, "無効"), (None, None, "分からない")])
def test_tracking_sources_without_a_way_to_see_reads(platform, old_file, recent, access_time, word):
    platform.access_time_reliable_value = access_time
    sources = usage.tracking_sources(platform, old_file["path"], recent_items_enabled=recent)
    assert sources["reliable"] is False
    assert word in sources["reason"]
    assert "判定不能" in sources["reason"]


# ---------------------------------------------------------------------- 判定


def test_short_observation_cannot_be_judged(env, db, platform):
    row = add_file_row(db, env["PIP0_ROOT"] / "新しい.pdf", first_seen_days_ago=30, mtime_days_ago=400)
    result = usage.judge_long_unread(db, row, NOW, env, sources_with_recent(platform, row))
    assert result["unread"] is None
    assert "30 日" in result["reason"] and "90 日" in result["reason"]
    assert "判定不能" in result["reason"]
    assert result["observed_days"] == 30.0


def test_observation_does_not_start_before_the_file_was_created(env, db, platform, old_file):
    # 200 日前から観測している場所に、10 日前にコピーされたファイル（作成日時が 10 日前）
    db.execute("UPDATE files SET ctime = ? WHERE id = ?", (NOW - 10 * DAY, old_file["id"]))
    row = database.query_one(db, "SELECT * FROM files WHERE id = ?", (old_file["id"],))
    result = usage.judge_long_unread(db, row, NOW, env, sources_with_recent(platform, row))
    assert result["unread"] is None
    assert result["observed_days"] == 10.0


def test_no_reliable_source_cannot_be_judged(env, db, platform, old_file):
    platform.access_time_reliable_value = False
    sources = usage.tracking_sources(platform, old_file["path"], recent_items_enabled=False)
    result = usage.judge_long_unread(db, old_file, NOW, env, sources)
    assert result["unread"] is None
    assert "判定不能" in result["reason"]


def test_long_unread_file_is_true_with_numbers(env, db, platform, old_file):
    result = usage.judge_long_unread(db, old_file, NOW, env, sources_with_recent(platform, old_file))
    assert result["unread"] is True
    assert result["idle_days"] == 150.0
    assert result["observed_days"] == 200.0
    assert "150 日間" in result["reason"]
    assert "90 日以上" in result["reason"]
    assert "観測 200 日" in result["reason"]
    assert "ファイルの更新" in result["reason"]


def test_recent_item_within_unread_days_is_false(env, db, platform, old_file):
    usage.record_recent_items(db, [{"target_path": old_file["path"], "opened_at": NOW - 10 * DAY}], NOW)
    result = usage.judge_long_unread(db, old_file, NOW, env, sources_with_recent(platform, old_file))
    assert result["unread"] is False
    assert result["idle_days"] == 10.0
    assert "10 日前" in result["reason"]
    assert "「最近使ったファイル」の記録" in result["reason"]


def test_ghost_open_counts_as_use(env, db, platform, old_file):
    usage.record_usage(db, old_file["id"], "ghost_open", NOW - 3 * DAY, process_name="AcroRd32.exe",
                       detail={"by_pip0": False})
    result = usage.judge_long_unread(db, old_file, NOW, env, sources_with_recent(platform, old_file))
    assert result["unread"] is False
    assert result["idle_days"] == 3.0


def test_pip0_own_reads_are_not_use(env, db, platform, old_file):
    # pip0 シェル自身の読み取り（解析・ハッシュ・コピー）は、利用として数えない
    usage.record_usage(db, old_file["id"], "ghost_open", NOW - DAY, process_name="Pip0Shell.exe")
    usage.record_usage(db, old_file["id"], "ghost_open", NOW - DAY, process_name="pythonw.exe",
                       detail={"by_pip0": True, "result": "served"})
    result = usage.judge_long_unread(db, old_file, NOW, env, sources_with_recent(platform, old_file))
    assert result["unread"] is True
    assert result["idle_days"] == 150.0


def test_access_time_counts_only_when_reliable(env, db, platform, old_file):
    usage.record_usage(db, old_file["id"], "access_time", NOW - 5 * DAY)
    platform.access_time_reliable_value = False
    unreliable = usage.judge_long_unread(db, old_file, NOW, env, sources_with_recent(platform, old_file))
    assert unreliable["unread"] is True  # 更新が無効な最終アクセス日時は、利用として数えない
    platform.access_time_reliable_value = True
    reliable = usage.judge_long_unread(db, old_file, NOW, env, sources_with_recent(platform, old_file))
    assert reliable["unread"] is False
    assert reliable["idle_days"] == 5.0


def test_observation_must_cover_the_whole_unread_period(env, db, platform):
    # MIN_OBSERVED_DAYS を UNREAD_DAYS より短くしても、観測していない期間の利用を「なし」と決めつけない
    config = dict(env, MIN_OBSERVED_DAYS=7, UNREAD_DAYS=90)
    row = add_file_row(db, env["PIP0_ROOT"] / "観測が短い.pdf", first_seen_days_ago=30, mtime_days_ago=200)
    result = usage.judge_long_unread(db, row, NOW, config, sources_with_recent(platform, row))
    assert result["unread"] is None
    assert "30 日だけ" in result["reason"]


def test_file_without_any_record_uses_the_observation_period(env, db, platform):
    row = add_file_row(db, env["PIP0_ROOT"] / "記録なし.bin", first_seen_days_ago=120, mtime_days_ago=None)
    result = usage.judge_long_unread(db, row, NOW, env, sources_with_recent(platform, row))
    assert result["unread"] is True
    assert result["idle_days"] == 120.0
    assert "利用の記録がありません" in result["reason"]


def test_last_use_picks_the_latest_allowed_kind(db, old_file):
    usage.record_usage(db, old_file["id"], "access_time", NOW - DAY)
    usage.record_usage(db, old_file["id"], "recent_item", NOW - 20 * DAY)
    assert usage.last_use(db, old_file) == {"at": NOW - DAY, "kind": "access_time"}
    assert usage.last_use(db, old_file, kinds=["modified", "recent_item"]) == {"at": NOW - 20 * DAY,
                                                                              "kind": "recent_item"}
    assert usage.last_use(db, old_file, kinds=["modified"]) == {"at": NOW - 150 * DAY, "kind": "modified"}
    assert usage.last_use(db, old_file, kinds=[]) == {"at": None, "kind": None}
