"""ダミーデータ（demo_data.py）のテスト

ダミーのファイルを一時フォルダー（tmp_path）に作り、代役の OS 連携（FakePlatform）で索引・入手経路・解析を作って、
「青いグラフ」「Slackで貰った」「先週の予算資料」の3つの検索が、期待どおりの結果と理由になることを確かめます。
時刻は 2026-10-29（木）10:00 の日本時間に固定します（「先週」は 2026-10-19〜25）。
本物のデスクトップ・ダウンロード・ドキュメントには作らないことも確かめます（ホームフォルダーは一時フォルダーで代用）。
"""

import hashlib
import json
import os
import re
import tempfile
import time
from datetime import datetime
from pathlib import Path

import pytest

from pip0 import config as config_module
from pip0 import database, demo_data, hazard, keystore, rules, search, sensitivity, timeutil
from pip0.platform_fake import FakePlatform


def set_timezone(tz):
    if tz is None:
        os.environ.pop("TZ", None)
    else:
        os.environ["TZ"] = tz
    time.tzset()


def tokyo_now():
    return datetime(2026, 10, 29, 10, 0).timestamp()  # 木曜日（TZ=Asia/Tokyo のときに呼ぶ）


@pytest.fixture(autouse=True)
def tokyo(monkeypatch):
    """日付の表示と「先週」の範囲が、どの環境でも同じになるように、日本時間で動かす"""
    monkeypatch.setenv("TZ", "Asia/Tokyo")
    time.tzset()
    yield
    monkeypatch.undo()
    time.tzset()


def build(target, now, week_starts_on=0):
    """ダミーのファイルを作り、メモリーの暗号化DB に索引・入手経路・解析を作る"""
    manifest = demo_data.create_demo_dataset(target, now, week_starts_on=week_starts_on)
    assert manifest["ok"], manifest["reason"]
    config = config_module.load_config(overrides=demo_data.demo_config_overrides(target), read_user_file=False)
    config["WEEK_STARTS_ON"] = week_starts_on
    conn = database.open_encrypted(":memory:", keystore.new_key_hex())
    platform = FakePlatform(vault_dir=config["VAULT_DIR"])
    loaded = demo_data.load_demo(conn, platform, config, rules, manifest, now)
    return {"target": Path(target), "now": now, "manifest": manifest, "config": config, "conn": conn,
            "platform": platform, "loaded": loaded}


@pytest.fixture(scope="module")
def demo(tmp_path_factory):
    """1回だけ作るデモのデータ（このファイルのテストで共有する）"""
    saved = os.environ.get("TZ")
    set_timezone("Asia/Tokyo")
    try:
        data = build(tmp_path_factory.mktemp("module") / "demo", tokyo_now())
        yield data
        data["conn"].close()
    finally:
        set_timezone(saved)


def run(demo, text):
    return search.search(demo["conn"], text, demo["now"], demo["config"], rules)


def names(result, key="results"):
    return [item["name"] for item in result[key]]


# ---------------------------------------------------------------------- 3つの検索


def test_loading_indexes_records_and_analyses_every_file(demo):
    assert demo["loaded"] == {"ok": True, "reason": "", "conditions": demo_data.SIMULATED_CONDITIONS,
                              "scanned": 10, "provenance": 4, "analysed": 10, "skipped": 0}
    rows = database.query_all(demo["conn"], "SELECT f.name, a.status FROM files AS f JOIN analysis AS a "
                                            "ON a.file_id = f.id ORDER BY f.name")
    assert {row["name"]: row["status"] for row in rows} == {
        "F0A1B2C3.pdf": "done", "IMG_2041.png": "done", "IMG_2042.png": "done", "IMG_2043.jpg": "done",
        "attachment.zip": "unsupported", "document (1).docx": "done", "document.docx": "done",
        "untitled.txt": "done", "申請書_下書き.txt": "done", "社外秘_打ち合わせメモ.txt": "done"}


def test_three_queries_match_the_expectations(demo):
    expectations = demo_data.expected_results(demo["manifest"])
    assert list(expectations) == demo_data.DEMO_QUERIES
    for text, expectation in expectations.items():
        result = run(demo, text)
        assert demo_data.check_search_result(result, expectation) == [], text
        assert names(result) == expectation["matches"], text  # 並び順も（新しい順）
        assert result["partial_results"] == []                 # 一致があるときは、一部一致を出さない


def test_blue_chart_query(demo):
    result = run(demo, "青いグラフ")
    assert result["status"] == "found" and names(result) == ["IMG_2041.png"]
    colour, shape = result["results"][0]["reasons"]
    # 数値は analyse_image.py の計算で決まる。形と、しきい値以上であることを確かめる
    share = int(re.fullmatch(r"色：青系 (\d+)%（画像の色解析）", colour).group(1))
    assert share >= demo["config"]["COLOUR_MIN_SHARE"] * 100
    match = re.fullmatch(r"見た目：グラフらしさ (\d\.\d\d)（(.+)）", shape)
    assert float(match.group(1)) >= demo["config"]["CHART_MIN_SCORE"]
    assert "単色の長方形（棒）を5個検出" in match.group(2)
    assert result["notes"] == []


def test_slack_query(demo):
    result = run(demo, "Slackで貰った")
    assert result["status"] == "found"
    assert {item["name"]: item["reasons"] for item in result["results"]} == {
        "IMG_2041.png": ["入手経路：Slack（ブラウザー拡張の記録：files.slack.com からのダウンロード）"],
        "F0A1B2C3.pdf": ["入手経路：Slack（Windows のダウンロード元情報（Zone.Identifier）：files.slack.com）"],
    }
    assert result["notes"] == [
        "入手経路の記録がないファイルが 6 件あります（記録がないファイルを、Slack 等から入手したとは扱いません）",
        "読み飛ばした言葉：で、貰った",
    ]


def test_last_week_budget_query(demo):
    result = run(demo, "先週の予算資料")
    assert result["status"] == "found"
    assert names(result) == ["document (1).docx"]
    assert result["results"][0]["reasons"] == [
        "時期：ダウンロード日 2026-10-22（ブラウザー拡張の記録）",
        "種類：文書（.docx）",
        "内容：タイトル・本文に「予算」",
    ]
    assert result["notes"] == ["時期：先週（2026-10-19（月）〜2026-10-25（日））は、端末の現地時刻で調べました",
                               "読み飛ばした言葉：の"]


def test_files_without_provenance_are_never_labelled_slack(demo):
    with_record = {entry["name"] for entry in demo["manifest"]["files"] if entry["provenance"]}
    assert with_record == {"IMG_2041.png", "IMG_2042.png", "F0A1B2C3.pdf", "document (1).docx"}
    rows = database.query_all(demo["conn"], "SELECT f.name, p.source_label FROM provenance AS p "
                                            "JOIN files AS f ON f.id = p.file_id")
    assert {row["name"]: row["source_label"] for row in rows} == {
        "IMG_2041.png": "Slack", "F0A1B2C3.pdf": "Slack", "IMG_2042.png": "Gmail", "document (1).docx": "Gmail"}
    # 「Slackで貰った写真」：写真には入手経路の記録がないので、一致させずに「情報不足」にする
    result = run(demo, "Slackで貰った写真")
    assert result["status"] == "insufficient_info" and result["results"] == []
    photo = next(item for item in result["partial_results"] if item["name"] == "IMG_2043.jpg")
    assert photo["unmatched"] == [{"cue": "入手経路：Slack", "reason": "入手経路の記録なし", "missing_info": True}]
    for item in result["partial_results"]:
        if item["name"] not in with_record:
            assert not any("Slack" in reason for reason in item["reasons"])


def test_other_queries_students_can_try(demo):
    # docs/test-data.md の「ほかにも試せる検索」
    assert names(run(demo, "青い写真")) == ["IMG_2043.jpg"]
    assert names(run(demo, "赤いグラフ")) == ["IMG_2042.png"]
    assert names(run(demo, "メールで貰った")) == ["document (1).docx", "IMG_2042.png"]
    assert names(run(demo, "2か月前の予算")) == ["document.docx"]
    no_match = run(demo, "先月の予算")
    assert no_match["status"] == "no_match"
    assert names(no_match, "partial_results") == ["document (1).docx", "document.docx"]


def test_sensitivity_of_every_dummy_file(demo):
    for entry in demo["manifest"]["files"]:
        item = hazard.evaluate_items(demo["conn"], [entry["path"]], demo["config"], rules)["items"][0]
        assert item["level"] == entry["expected_sensitivity"], entry["name"]
    secret = next(entry for entry in demo["manifest"]["files"] if entry["key"] == "secret_by_content")
    item = hazard.evaluate_items(demo["conn"], [secret["path"]], demo["config"], rules)["items"][0]
    assert item["reasons"] == ["本文に、検査用数字が正しい12桁の個人番号らしい数字（1件）"]


@pytest.mark.parametrize("when, week_starts_on", [
    ((2026, 10, 26, 0, 30), 0),   # 月曜日の深夜（先週が終わった直後）
    ((2026, 11, 1, 23, 30), 0),   # 日曜日の夜（週の最後）
    ((2026, 10, 29, 10, 0), 6),   # 週の始まりを日曜日にした場合
])
def test_expectations_hold_for_other_dates_and_week_starts(tmp_path, when, week_starts_on):
    now = datetime(*when).timestamp()
    data = build(tmp_path / "demo", now, week_starts_on)
    try:
        for text, expectation in demo_data.expected_results(data["manifest"]).items():
            result = search.search(data["conn"], text, now, data["config"], rules)
            assert demo_data.check_search_result(result, expectation) == [], (text, when)
    finally:
        data["conn"].close()


# ---------------------------------------------------------------------- 作ったファイル


def test_names_do_not_reveal_the_answers(demo):
    answer_words = ["青", "赤", "グラフ", "写真", "slack", "予算", "議事録", "chart", "blue", "budget"]
    for entry in demo["manifest"]["files"]:
        if entry["key"] in ("secret_by_name",):
            continue  # 名前で機密と分かることを試すファイル
        for word in answer_words:
            assert word not in entry["name"].lower(), (entry["name"], word)


def test_dates_are_relative_to_now(demo):
    now = demo["now"]
    last_week = timeutil.find_period("先週", now)
    times = demo_data.demo_times(now)
    for key in ("last_week_day2", "last_week_day3", "last_week_day4"):
        assert last_week["start"] <= times[key] < last_week["end"], key
    assert times["two_weeks_ago"] < last_week["start"]
    assert round((now - times["two_months_ago"]) / 86400) == 61
    for entry in demo["manifest"]["files"]:
        assert os.stat(entry["path"]).st_mtime == pytest.approx(entry["modified_at"])


def test_dummy_my_number_has_a_valid_check_digit():
    number = demo_data.add_my_number_check_digit(demo_data.DUMMY_MY_NUMBER_FIRST_ELEVEN)
    assert number == "123456789018"  # 連番の11桁に、検査用数字を付けたダミー
    assert sensitivity.is_valid_my_number(number)
    assert not sensitivity.is_valid_my_number("123456789010")


def test_generated_files_are_the_same_every_time(demo, tmp_path):
    other = demo_data.create_demo_dataset(tmp_path / "again", demo["now"])
    for first, second in zip(demo["manifest"]["files"], other["files"]):
        assert first["name"] == second["name"]
        assert digest(first["path"]) == digest(second["path"]), first["name"]


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def test_manifest_is_written_next_to_the_files(demo):
    saved = json.loads((demo["target"] / demo_data.MANIFEST_NAME).read_text(encoding="utf-8"))
    assert saved["conditions"] == demo_data.SIMULATED_CONDITIONS
    assert [entry["name"] for entry in saved["files"]] == [entry["name"] for entry in demo["manifest"]["files"]]
    kinds = {entry["name"]: (entry["provenance"] or {}).get("kind") for entry in saved["files"]}
    assert kinds["IMG_2041.png"] == "browser_extension" and kinds["F0A1B2C3.pdf"] == "zone_identifier"
    assert kinds["IMG_2043.jpg"] is None
    # 保存したマニフェストからも、同じ期待を作れる
    assert demo_data.expected_results(saved) == demo_data.expected_results(demo["manifest"])


# ---------------------------------------------------------------------- まねた条件と、安全のための断り


def test_analysis_runs_only_under_the_simulated_conditions(demo):
    assert demo["platform"].power == "ac"
    assert demo["platform"].idle_seconds == demo["config"]["HEAVY_IDLE_SECONDS"] == 180
    assert "実機の電源・アイドル状態ではありません" in demo_data.SIMULATED_CONDITIONS


class PowerUnknownPlatform(FakePlatform):
    """電源の状態を読めない代役（条件を満たしたことにしないかを確かめる）"""

    def get_power_source(self):
        return "unknown"


def test_analysis_is_not_faked_when_the_gate_is_closed(tmp_path):
    target = tmp_path / "demo"
    manifest = demo_data.create_demo_dataset(target, tokyo_now())
    config = config_module.load_config(overrides=demo_data.demo_config_overrides(target), read_user_file=False)
    conn = database.open_encrypted(":memory:", keystore.new_key_hex())
    try:
        loaded = demo_data.load_demo(conn, PowerUnknownPlatform(), config, rules, manifest, tokyo_now())
        assert loaded["ok"] is False
        assert loaded["reason"].startswith("解析の条件を満たしません：電源の状態を取得できません")
        done = database.query_one(conn, "SELECT count(*) AS n FROM analysis WHERE status = 'done'")
        assert done["n"] == 0
    finally:
        conn.close()


def test_load_demo_refuses_a_real_platform_and_a_failed_manifest(tmp_path, env):
    class RealLooking:
        name = "windows"

    manifest = demo_data.create_demo_dataset(tmp_path / "demo", tokyo_now())
    conn = database.open_encrypted(":memory:", keystore.new_key_hex())
    try:
        refused = demo_data.load_demo(conn, RealLooking(), env, rules, manifest, tokyo_now())
        assert refused["ok"] is False and "FakePlatform" in refused["reason"]
        failed = demo_data.load_demo(conn, FakePlatform(), env, rules, {"ok": False, "reason": "作れません"},
                                     tokyo_now())
        assert failed == {"ok": False, "reason": "作れません"}
        assert database.query_one(conn, "SELECT count(*) AS n FROM files")["n"] == 0
    finally:
        conn.close()


@pytest.fixture
def fake_home(tmp_path, monkeypatch):
    """本物のホームフォルダーの代わり（Desktop、Downloads、Documents を持つ）"""
    home = tmp_path / "home"
    for name in ["Desktop", "Downloads", "Documents"]:
        (home / name).mkdir(parents=True)
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USERPROFILE", str(home))
    for name in ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]:
        monkeypatch.delenv(name, raising=False)
    assert Path.home() == home
    return home


@pytest.mark.parametrize("folder", ["Desktop", "Downloads", "Documents"])
def test_refuses_the_real_desktop_downloads_and_documents(fake_home, folder):
    for target in [fake_home / folder, fake_home / folder / "pip0-demo"]:
        result = demo_data.create_demo_dataset(target, tokyo_now())
        assert result["ok"] is False
        assert f"本物の「{folder}」の中には、デモのファイルを作りません" in result["reason"]
    assert list((fake_home / folder).iterdir()) == []  # 何も作っていない


def test_refuses_onedrive_folders_and_the_real_pip0_folder(fake_home, tmp_path, monkeypatch):
    onedrive = tmp_path / "OneDrive"
    monkeypatch.setenv("OneDrive", str(onedrive))
    assert demo_data.create_demo_dataset(onedrive / "Documents" / "demo", tokyo_now())["ok"] is False
    assert demo_data.create_demo_dataset(fake_home / "pip0" / "demo", tokyo_now())["ok"] is False
    assert not (onedrive / "Documents").exists() and not (fake_home / "pip0").exists()
    # ホームフォルダーの中でも、ほかの空のフォルダーなら作れる
    assert demo_data.create_demo_dataset(fake_home / "pip0-demo", tokyo_now())["ok"] is True


def test_refuses_non_empty_folders_and_files(tmp_path):
    busy = tmp_path / "busy"
    busy.mkdir()
    (busy / "mine.txt").write_text("ユーザーのファイル", encoding="utf-8")
    result = demo_data.create_demo_dataset(busy, tokyo_now())
    assert result["ok"] is False and "空でないフォルダー" in result["reason"]
    assert [path.name for path in busy.iterdir()] == ["mine.txt"]
    assert (busy / "mine.txt").read_text(encoding="utf-8") == "ユーザーのファイル"
    a_file = tmp_path / "file.txt"
    a_file.write_text("x", encoding="utf-8")
    assert demo_data.create_demo_dataset(a_file, tokyo_now())["reason"] == "指定した場所はフォルダーではありません"


def test_write_failures_are_reported_not_raised(tmp_path, monkeypatch):
    def disk_full(entry, path):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(demo_data, "write_demo_file", disk_full)
    result = demo_data.create_demo_dataset(tmp_path / "demo", tokyo_now())
    assert result["ok"] is False
    assert result["reason"].startswith("ダミーのファイルを作れませんでした（OSError）")


def test_missing_dummy_file_stops_loading(tmp_path, env):
    manifest = demo_data.create_demo_dataset(tmp_path / "demo", tokyo_now())
    os.remove(manifest["files"][0]["path"])  # 作った後に、誰かが消した
    conn = database.open_encrypted(":memory:", keystore.new_key_hex())
    try:
        loaded = demo_data.load_demo(conn, FakePlatform(), env, rules, manifest, tokyo_now())
        assert loaded == {"ok": False, "reason": "ダミーのファイルの日時を設定できませんでした（FileNotFoundError）"}
    finally:
        conn.close()


def test_refuses_extra_protected_folders(tmp_path, env):
    result = demo_data.create_demo_dataset(env["DOWNLOADS_DIR"] / "demo", tokyo_now(),
                                           protected=[env["DOWNLOADS_DIR"]])
    assert result["ok"] is False
    assert not (env["DOWNLOADS_DIR"] / "demo").exists()


# ---------------------------------------------------------------------- まとめて実行（python -m pip0 demo の中身）


def test_run_demo_reports_every_expectation(tmp_path):
    report = demo_data.run_demo(tmp_path / "demo", now=tokyo_now())
    assert report["ok"] is True and report["problems"] == []
    assert [query["text"] for query in report["queries"]] == demo_data.DEMO_QUERIES
    assert all(item["ok"] for item in report["sensitivity"])
    lines = demo_data.report_lines(report)
    assert demo_data.SIMULATED_CONDITIONS in lines[2]
    assert lines.count("  ✓ 期待どおり（docs/test-data.md）") == 3
    assert lines[-1] == "結果：すべて期待どおりです"


def test_run_demo_refusal_is_reported_without_creating_files(fake_home):
    report = demo_data.run_demo(fake_home / "Desktop", now=tokyo_now())
    assert report["ok"] is False and report["load"] is None
    lines = demo_data.report_lines(report)
    assert lines[-1].startswith("デモを実行できませんでした：本物の「Desktop」の中には")
    assert list((fake_home / "Desktop").iterdir()) == []


def test_run_demo_without_a_folder_uses_a_new_temporary_folder(tmp_path, monkeypatch):
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    report = demo_data.run_demo(now=tokyo_now())
    assert report["ok"] is True
    assert Path(report["target_dir"]).parent == tmp_path.resolve()
