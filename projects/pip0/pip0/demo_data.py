"""検索の3例を試すためのダミーデータ（M3 エピソード記憶検索・M5 機密の判定）

「青いグラフ」「Slackで貰った」「先週の予算資料」の3つの検索を、学生が自分の PC で試せるように、
ダミーのファイルをその場で作り、代役の OS 連携（FakePlatform）で索引・入手経路・解析を作ります。
外部のデータや、リポジトリに置いた画像・文書は使いません（すべてこのファイルのコードで作ります）。

- create_demo_dataset：空のフォルダーに、ダミーのファイルを作る。名前からは答えが分からないようにしてある
  （例：青い棒グラフは IMG_2041.png）。日時は実行した時刻を基準に決める（「先週」がいつ実行しても先週になるように）
- load_demo：日時を付け、入手経路の記録をまね（ブラウザー拡張の記録、Zone.Identifier）、索引を作り、解析する。
  解析は、電源接続中・180秒無操作を「まねた」条件で行う（実機の電源・アイドル状態ではない）
- expected_results：3つの検索で、一致するはずのファイルと、出るはずの一致の理由
- run_demo：上の全部と、検索・機密の判定の確認をまとめて行う（python -m pip0 demo の中身）

本物のデスクトップ・ダウンロード・ドキュメントの中や、空でないフォルダーには作りません。
説明は docs/test-data.md にあります。★ダミーのファイルを足す・変えるときは demo_files() を直します。
"""

import io
import os
import random
import tempfile
import time
import zipfile
from datetime import timedelta
from pathlib import Path
from xml.sax.saxutils import escape

from PIL import Image, ImageDraw, ImageFilter

from pip0 import analysis_queue, database, fsutil, hazard, keystore, platform_fake, provenance, scanner, search
from pip0 import config as config_module
from pip0 import rules as default_rules
from pip0 import throttle, timeutil

# デモが代役の条件で解析したことの説明（画面と記録に出す）
SIMULATED_CONDITIONS = ("代役の OS 連携（FakePlatform）で、電源接続中・180秒無操作の状態をまねて解析しました"
                        "（実機の電源・アイドル状態ではありません）")

# まねたブラウザー拡張の呼び出し元（本物の拡張機能の ID ではないことが分かる名前）
DEMO_EXTENSION_ORIGIN = "chrome-extension://pip0-demo-simulated/"

# デモのファイルを置くフォルダー（作った場所の中）と、索引の種類（location_kind）
DEMO_FOLDERS = [
    {"name": "Downloads", "location_kind": "downloads"},  # ダウンロードフォルダーの代わり
    {"name": "pip0", "location_kind": "pip0_root"},       # pip0 専用フォルダーの代わり
]

# 作った場所に残す、ダミーのファイルの一覧（学生が中身を確かめるため）
MANIFEST_NAME = "pip0-demo-manifest.json"

# デモのファイルを作らない、本物のフォルダーの名前（ホームフォルダーと OneDrive の中）
PROTECTED_FOLDER_NAMES = ["Desktop", "Downloads", "Documents", "デスクトップ", "ダウンロード", "ドキュメント"]

# 検査用数字を付けて、ダミーの個人番号にする11桁（連番。実在の人の番号として使わないこと）
DUMMY_MY_NUMBER_FIRST_ELEVEN = "12345678901"

# 3つの検索の言葉
DEMO_QUERIES = ["青いグラフ", "Slackで貰った", "先週の予算資料"]


# ----------------------------------------------------------------------
# ダミーのファイルの一覧（★ここを変えると、デモのファイルが変わります）
# ----------------------------------------------------------------------


def demo_files(times):
    """ダミーのファイルの一覧。times は demo_times() の辞書

    1つのファイルは辞書です。
      key：プログラムの中で使う名前、folder：作る場所（作った場所からの相対パス）、name：ファイル名
      make：作り方（bar_chart、sky_photo、pdf、docx、text、zip）と、その材料
      description：説明、modified_at：最終更新日時
      provenance：まねる入手経路（ブラウザー拡張の記録、Zone.Identifier だけ、なし）
      expected_sensitivity：機密の判定の期待（sensitive、not_sensitive、unknown）
    """
    my_number = add_my_number_check_digit(DUMMY_MY_NUMBER_FIRST_ELEVEN)
    formatted = f"{my_number[:4]}-{my_number[4:8]}-{my_number[8:]}"
    return [
        {"key": "blue_chart", "folder": "Downloads", "name": "IMG_2041.png",
         "make": "bar_chart", "colour": [31, 119, 180], "values": [0.45, 0.7, 0.55, 0.9, 0.62],
         "description": "青い棒グラフ（白い背景、黒い軸、5本の青い棒）",
         "modified_at": times["last_week_day3"],
         "provenance": extension_record("https://files.slack.com/files-pri/T0DEMO-F0DEMO01/img_2041.png",
                                        "https://app.slack.com/", "https://app.slack.com/client/T0DEMO/C0DEMO",
                                        "予算2026 (Channel) - 研究室 - Slack", times["last_week_day3"], "image/png"),
         "expected_sensitivity": "unknown"},
        {"key": "red_chart", "folder": "Downloads", "name": "IMG_2042.png",
         "make": "bar_chart", "colour": [214, 39, 40], "values": [0.8, 0.5, 0.65, 0.3, 0.75],
         "description": "赤い棒グラフ（青いグラフと同じ形で、色だけが違う）",
         "modified_at": times["two_weeks_ago"],
         "provenance": extension_record("https://mail-attachment.googleusercontent.com/attachment/u/0/",
                                        "https://mail.google.com/", "https://mail.google.com/mail/u/0/",
                                        "受信トレイ - Gmail", times["two_weeks_ago"], "image/png"),
         "expected_sensitivity": "unknown"},
        {"key": "sky_photo", "folder": "Downloads", "name": "IMG_2043.jpg",
         "make": "sky_photo", "seed": 2043,
         "description": "青空の写真のような画像（なめらかな青のグラデーション、雲、地面、細かいむら）",
         "modified_at": times["two_weeks_ago"],
         "provenance": None,
         "expected_sensitivity": "unknown"},
        {"key": "slack_pdf", "folder": "Downloads", "name": "F0A1B2C3.pdf",
         "make": "pdf", "title": "研究室ミーティング 配布資料（ダミー）",
         "lines": ["Lab meeting handout (dummy data for the pip0 demo)", "Agenda: room booking and schedule"],
         "description": "研究室ミーティングの配布資料（PDF。タイトルは日本語、本文は英語）",
         "modified_at": times["two_weeks_ago"],
         "provenance": zone_record("https://files.slack.com/files-pri/T0DEMO-F0DEMO02/download",
                                   "https://app.slack.com/"),
         "expected_sensitivity": "not_sensitive"},
        {"key": "budget_last_week", "folder": "Downloads", "name": "document (1).docx",
         "make": "docx", "title": "2026年度 予算案",
         "paragraphs": ["2026年度 予算案（ダミー）", "部門別の内訳と、前年度との比較をまとめた資料です。",
                        "この文書は pip0 のデモ用に作った架空のものです。"],
         "description": "2026年度の予算案（Word 文書。タイトルと本文に「予算」）",
         "modified_at": times["last_week_day4"],
         "provenance": extension_record("https://mail-attachment.googleusercontent.com/attachment/u/0/",
                                        "https://mail.google.com/", "https://mail.google.com/mail/u/0/",
                                        "受信トレイ - Gmail", times["last_week_day4"],
                                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
         "expected_sensitivity": "not_sensitive"},
        {"key": "budget_old", "folder": "pip0/予算・会計", "name": "document.docx",
         "make": "docx", "title": "2026年度 予算（第1次案）",
         "paragraphs": ["2026年度 予算（第1次案・ダミー）", "最初の案です。この後、予算案にまとめ直しました。"],
         "description": "2か月前の、古い予算の文書（Word 文書。pip0 専用フォルダーの中）",
         "modified_at": times["two_months_ago"],
         "provenance": None,
         "expected_sensitivity": "not_sensitive"},
        {"key": "minutes_last_week", "folder": "Downloads", "name": "untitled.txt",
         "make": "text",
         "text": "定例ミーティングの議事録（ダミー）\n議題：研究発表会の準備\n・発表の順番を決めた\n・会場の予約を確かめた\n",
         "description": "先週の議事録（テキスト。「予算」という語はない）",
         "modified_at": times["last_week_day2"],
         "provenance": None,
         "expected_sensitivity": "not_sensitive"},
        {"key": "secret_by_name", "folder": "Downloads", "name": "社外秘_打ち合わせメモ.txt",
         "make": "text", "text": "打ち合わせのメモです（pip0 のデモ用のダミー）。\n",
         "description": "名前に「社外秘」がある文書（中身には機密の語がない）",
         "modified_at": times["two_weeks_ago"],
         "provenance": None,
         "expected_sensitivity": "sensitive"},
        {"key": "secret_by_content", "folder": "Downloads", "name": "申請書_下書き.txt",
         "make": "text",
         "text": (f"申請書の下書き（ダミー）\n登録番号：{formatted}\n"
                  "（pip0 のデモ用に、連番の11桁に検査用数字を付けて作った番号です）\n"),
         "description": "本文に、検査用数字が正しい12桁の個人番号らしい数字がある文書（名前は普通）",
         "modified_at": times["two_weeks_ago"],
         "provenance": None,
         "expected_sensitivity": "sensitive"},
        {"key": "unsupported", "folder": "Downloads", "name": "attachment.zip",
         "make": "zip", "members": {"readme.txt": "pip0 demo: the contents of this archive are not analysed.\n"},
         "description": "pip0 が中身を解析しない形式（ZIP）。機密の判定は「未判定」になる",
         "modified_at": times["two_weeks_ago"],
         "provenance": None,
         "expected_sensitivity": "unknown"},
    ]


def extension_record(url, referrer_url, tab_url, tab_title, ended_at, mime):
    """まねるブラウザー拡張の記録（ダウンロードが完了したときに、拡張機能が送る内容）"""
    return {"kind": "browser_extension", "url": url, "referrer_url": referrer_url, "tab_url": tab_url,
            "tab_title": tab_title, "ended_at": ended_at, "mime": mime}


def zone_record(host_url, referrer_url):
    """まねる Zone.Identifier（Windows がダウンロードしたファイルに付ける小さな記録）だけの入手経路"""
    text = f"[ZoneTransfer]\r\nZoneId=3\r\nReferrerUrl={referrer_url}\r\nHostUrl={host_url}\r\n"
    return {"kind": "zone_identifier", "zone_identifier": text}


def demo_times(now, week_starts_on=0):
    """ダミーのファイルの日時。「先週」は timeutil.find_period と同じ決まり（端末の現地時刻）で決める"""
    last_week = timeutil.find_period("先週", now, week_starts_on)
    first_day = timeutil.to_local(last_week["start"])  # 先週の最初の日（週の始まりが月曜なら月曜日）の 0時
    week_before = first_day - timedelta(weeks=1)
    today = timeutil.start_of_day(timeutil.to_local(now))
    return {
        "last_week_day2": timeutil.from_local(first_day + timedelta(days=1, hours=15)),           # 先週の火曜日 15:00
        "last_week_day3": timeutil.from_local(first_day + timedelta(days=2, hours=14, minutes=30)),  # 先週の水曜日 14:30
        "last_week_day4": timeutil.from_local(first_day + timedelta(days=3, hours=10, minutes=15)),  # 先週の木曜日 10:15
        "two_weeks_ago": timeutil.from_local(week_before + timedelta(days=2, hours=11)),          # 先々週の水曜日 11:00
        "two_months_ago": timeutil.from_local(today - timedelta(days=61) + timedelta(hours=10)),  # 61日前の 10:00
    }


def add_my_number_check_digit(first_eleven):
    """11桁の数字に、個人番号の検査用数字（12桁目）を付ける（sensitivity.is_valid_my_number と同じ計算）"""
    total = 0
    for n in range(1, 12):
        digit = int(first_eleven[-n])          # 右から n 番目の数字
        weight = n + 1 if n <= 6 else n - 5
        total += digit * weight
    remainder = total % 11
    check = 0 if remainder <= 1 else 11 - remainder
    return first_eleven + str(check)


# ----------------------------------------------------------------------
# ダミーのファイルを作る
# ----------------------------------------------------------------------


def create_demo_dataset(target_dir, now, week_starts_on=0, protected=None):
    """空のフォルダー target_dir に、ダミーのファイルを作り、その一覧（マニフェスト）を返す

    week_starts_on：週の始まり（設定の WEEK_STARTS_ON）。「先週」の日付を、検索と同じ決まりで決める
    protected：ほかにも作ってはいけないフォルダー（例：設定のダウンロードフォルダー）のリスト
    戻り値：{"ok": True, "reason": "", "target_dir", "now", "week_starts_on", "folders", "files"}
            作らなかったときは {"ok": False, "reason": 日本語の理由}
    """
    checked = check_target(target_dir, protected)
    if not checked["ok"]:
        return checked
    target = checked["path"]
    entries = demo_files(demo_times(now, week_starts_on))

    folders = []
    try:
        target.mkdir(parents=True, exist_ok=True)
        for folder in DEMO_FOLDERS:
            path = target / folder["name"]
            path.mkdir(exist_ok=True)
            folders.append({"path": str(path), "location_kind": folder["location_kind"]})
        for entry in entries:
            folder = target / entry["folder"]
            folder.mkdir(parents=True, exist_ok=True)
            path = folder / entry["name"]
            write_demo_file(entry, path)
            entry["path"] = str(path)
        manifest = {"ok": True, "reason": "", "format": 1, "target_dir": str(target), "now": now,
                    "week_starts_on": week_starts_on, "conditions": SIMULATED_CONDITIONS,
                    "folders": folders, "files": entries}
        fsutil.atomic_write_json(target / MANIFEST_NAME, manifest)
    except OSError as error:
        # 書き込みの権限がない、空き容量がない など（作りかけのファイルは、指定したフォルダーの中にだけある）
        return {"ok": False, "reason": f"ダミーのファイルを作れませんでした（{type(error).__name__}）。"
                                       "作りかけのファイルがあれば、指定したフォルダーごと削除してください"}
    return manifest


def check_target(target_dir, protected=None):
    """デモのファイルを作ってよい場所かを確かめる。{"ok", "reason", "path"}"""
    target = Path(target_dir).expanduser().resolve()
    for folder in protected_folders(protected):
        if config_module.is_inside(target, folder):
            return {"ok": False, "reason": f"本物の「{Path(folder).name}」の中には、デモのファイルを作りません。"
                                           "空のフォルダーを別の場所に用意して指定してください"}
    if target.exists():
        if not target.is_dir():
            return {"ok": False, "reason": "指定した場所はフォルダーではありません"}
        try:
            has_entries = any(target.iterdir())
        except OSError as error:
            return {"ok": False, "reason": f"フォルダーの中を確かめられません（{type(error).__name__}）"}
        if has_entries:
            return {"ok": False, "reason": "空でないフォルダーには、デモのファイルを作りません"
                                           "（ほかのファイルと混ざらないように）。空のフォルダーを指定してください"}
    return {"ok": True, "reason": "", "path": target}


def protected_folders(extra=None):
    """デモのファイルを作らない、本物のフォルダーのリスト

    - ホームフォルダー（と OneDrive）の中のデスクトップ、ダウンロード、ドキュメント
    - 本物の pip0 専用フォルダー（%USERPROFILE%\\pip0）
    - Windows では、Windows が知っている「ダウンロード」の場所（別のドライブに移した場合も）と、
      pip0 のデータフォルダー（%LOCALAPPDATA%\\pip0）。Windows 以外では、これらは None なので加えない
    - extra：呼び出し側が渡す、ほかの作ってはいけないフォルダー（例：設定のダウンロードフォルダー）
    """
    homes = [Path.home()]
    for name in ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]:
        value = os.environ.get(name)
        if value:
            homes.append(Path(value))  # OneDrive に移したデスクトップ・ドキュメント
    folders = []
    for home in homes:
        for name in PROTECTED_FOLDER_NAMES:
            folders.append(home / name)
    folders.append(Path.home() / "pip0")  # 本物の pip0 専用フォルダー（既定の場所）
    for folder in config_module.windows_default_paths().values():
        if folder is not None:
            folders.append(Path(folder))
    for folder in extra or []:
        if folder:
            folders.append(Path(folder))
    return folders


def write_demo_file(entry, path):
    """1つのダミーのファイルを、entry["make"] の方法で作る"""
    make = entry["make"]
    if make == "bar_chart":
        draw_bar_chart(tuple(entry["colour"]), entry["values"]).save(path, format="PNG")
    elif make == "sky_photo":
        draw_sky_photo(entry["seed"]).save(path, format="JPEG", quality=88)
    elif make == "pdf":
        path.write_bytes(pdf_bytes(entry["title"], entry["lines"]))
    elif make == "docx":
        path.write_bytes(docx_bytes(entry["title"], entry["paragraphs"]))
    elif make == "text":
        path.write_bytes(entry["text"].encode("utf-8"))
    elif make == "zip":
        path.write_bytes(zip_bytes(entry["members"]))
    else:
        raise ValueError(f"知らない作り方です: {make}")


def draw_bar_chart(colour, values, size=(640, 480)):
    """白い背景に、黒い軸と目盛り、colour の色の棒（values の高さ）がある棒グラフ

    文字（軸の数字など）は描きません。文字を描くと Pillow に入っているフォントを使うことになり、
    環境によって画像が変わり、フォントの利用条件も関わるためです。目盛りは短い線で描きます。
    """
    width, height = size
    image = Image.new("RGB", size, (255, 255, 255))
    draw = ImageDraw.Draw(image)
    left, right, top, bottom = 70, width - 30, 50, height - 60
    slot = (right - left) / len(values)
    for index, value in enumerate(values):
        x0 = left + index * slot + slot * 0.2
        x1 = left + (index + 1) * slot - slot * 0.2
        draw.rectangle([x0, bottom - value * (bottom - top), x1, bottom - 1], fill=colour)
        middle = (x0 + x1) / 2
        draw.line([(middle, bottom), (middle, bottom + 8)], fill=(0, 0, 0), width=2)  # 横軸の目盛り
    draw.line([(left, top - 10), (left, bottom)], fill=(0, 0, 0), width=2)    # 縦軸
    draw.line([(left, bottom), (right, bottom)], fill=(0, 0, 0), width=2)     # 横軸
    for step in range(5):
        y = bottom - step * (bottom - top) / 4
        draw.line([(left - 8, y), (left, y)], fill=(0, 0, 0), width=2)        # 縦軸の目盛り
    return image


def draw_sky_photo(seed, size=(640, 427)):
    """青空の写真のような画像（上から下へ明るくなる青、地面、ぼかした雲、細かいむら）。seed で毎回同じ画像になる"""
    rnd = random.Random(seed)
    width, height = size
    ground = int(height * 0.85)
    data = []
    for y in range(height):
        for x in range(width):
            if y < ground:
                t = y / ground
                base = (40 + 120 * t, 95 + 105 * t, 185 + 50 * t)   # 空：濃い青 → 明るい青
            else:
                t = (y - ground) / (height - ground)
                base = (60 + 30 * t, 90 + 20 * t, 50 + 10 * t)      # 地面：暗い緑
            noise = rnd.randint(-14, 14)
            data.append(tuple(max(0, min(255, int(c) + noise + rnd.randint(-5, 5))) for c in base))
    image = Image.new("RGB", size)
    image.putdata(data)
    clouds = Image.new("L", size, 0)
    draw = ImageDraw.Draw(clouds)
    for _ in range(6):
        cx, cy = rnd.randint(40, width - 40), rnd.randint(30, ground - 60)
        w, h = rnd.randint(60, 140), rnd.randint(20, 45)
        draw.ellipse([cx - w, cy - h, cx + w, cy + h], fill=rnd.randint(150, 220))
    clouds = clouds.filter(ImageFilter.GaussianBlur(18))
    white = Image.new("RGB", size, (250, 250, 252))
    return Image.composite(white, image, clouds)


def pdf_bytes(title, lines):
    """1ページの PDF を作る。本文 lines は英数字だけ（標準の Helvetica の字形を使うため）、タイトルは日本語でもよい

    PDF は「番号の付いた部品（オブジェクト）」を並べ、最後に各部品の位置の表（xref）を書いた形です。
    """
    content = "BT /F1 14 Tf 72 770 Td 20 TL\n"  # 文字を書き始める位置と、行の間隔
    for line in lines:
        text = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        content += f"({text}) Tj T*\n"           # 1行書いて、次の行へ
    content += "ET\n"
    stream = content.encode("ascii")
    title_hex = ("FEFF" + title.encode("utf-16-be").hex()).upper()  # 日本語のタイトルは UTF-16 の16進数で書く
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n" + stream + b"endstream",
        ("<< /Title <" + title_hex + "> /Producer (pip0 demo) >>").encode("ascii"),
    ]
    data = b"%PDF-1.4\n"
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(data))
        data += str(number).encode("ascii") + b" 0 obj\n" + body + b"\nendobj\n"
    xref_at = len(data)
    data += b"xref\n0 " + str(len(objects) + 1).encode("ascii") + b"\n0000000000 65535 f \n"
    for offset in offsets:
        data += f"{offset:010d} 00000 n \n".encode("ascii")
    data += b"trailer\n<< /Size " + str(len(objects) + 1).encode("ascii") + b" /Root 1 0 R /Info 6 0 R >>\n"
    data += b"startxref\n" + str(xref_at).encode("ascii") + b"\n%%EOF\n"
    return data


def docx_bytes(title, paragraphs):
    """タイトル（docProps/core.xml）と段落のある、最小限の Word 文書（.docx）を作る"""
    body = "".join(f"<w:p><w:r><w:t>{escape(text)}</w:t></w:r></w:p>" for text in paragraphs)
    header = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    members = {
        "[Content_Types].xml": (
            header + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            '<Override PartName="/docProps/core.xml" '
            'ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'),
        "_rels/.rels": (
            header + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Target="word/document.xml" Type="http://schemas.openxmlformats.org/'
            'officeDocument/2006/relationships/officeDocument"/>'
            '<Relationship Id="rId2" Target="docProps/core.xml" Type="http://schemas.openxmlformats.org/'
            'package/2006/relationships/metadata/core-properties"/></Relationships>'),
        "word/document.xml": (
            header + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            f"<w:body>{body}</w:body></w:document>"),
        "docProps/core.xml": (
            header + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/'
            'core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">'
            f"<dc:title>{escape(title)}</dc:title></cp:coreProperties>"),
    }
    return zip_bytes(members)


def zip_bytes(members):
    """{名前: 文字列} から ZIP を作る。日時を固定するので、毎回同じ内容になる"""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, text in members.items():
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, text.encode("utf-8"))
    return buffer.getvalue()


# ----------------------------------------------------------------------
# 索引・入手経路・解析を作る
# ----------------------------------------------------------------------


def load_demo(conn, platform, config, rules, manifest, now):
    """ダミーのファイルに日時を付け、入手経路の記録をまね、索引を作り、解析する

    platform は代役（FakePlatform）だけを受け付けます。電源接続中・HEAVY_IDLE_SECONDS（180秒）無操作に設定し、
    throttle.HeavyGate を通して analysis_queue.analyse_file / store_result で解析します（まねた条件）。
    戻り値：{"ok", "reason", "conditions", "scanned", "provenance", "analysed", "skipped"}
    """
    if not manifest.get("ok"):
        return {"ok": False, "reason": manifest.get("reason") or "ダミーのファイルを作れていません"}
    if getattr(platform, "name", None) != "fake":
        return {"ok": False, "reason": "デモは代役の OS 連携（FakePlatform）でだけ動かします（本物の PC の状態を使わないため）"}

    # 1. まねた条件：電源接続中で、180秒操作がない
    platform.power = "ac"
    platform.idle_seconds = config["HEAVY_IDLE_SECONDS"]

    # 2. 最終更新日時と、Zone.Identifier（だけ）の記録
    for entry in manifest["files"]:
        try:
            os.utime(entry["path"], (entry["modified_at"], entry["modified_at"]))
        except OSError as error:
            return {"ok": False, "reason": f"ダミーのファイルの日時を設定できませんでした（{type(error).__name__}）"}
        record = entry.get("provenance")
        if record and record["kind"] == "zone_identifier":
            platform.zone_identifiers[str(Path(entry["path"]))] = record["zone_identifier"]

    # 3. 索引（files）を作る。新しいファイルは解析の順番待ちに入る
    scanned = 0
    for folder in manifest["folders"]:
        counts = scanner.scan_folder(conn, platform, folder["path"], folder["location_kind"], config, rules, now)
        scanned += counts["seen"]

    # 4. 入手経路の記録（provenance）
    recorded = 0
    for number, entry in enumerate(manifest["files"], start=1):
        if entry.get("provenance") and record_demo_provenance(conn, platform, rules, entry, number, now):
            recorded += 1

    # 5. 解析（高負荷の処理の門 HeavyGate を通す）
    gate = throttle.HeavyGate(platform, config)
    if not gate.may_run():
        return {"ok": False, "reason": "解析の条件を満たしません：" + gate.state["reason"]}
    paths = {entry["path"] for entry in manifest["files"]}
    tasks = database.query_all(
        conn,
        "SELECT t.id, t.file_id, f.path FROM tasks AS t JOIN files AS f ON f.id = t.file_id "
        "WHERE t.kind = 'analyse' AND t.state = 'queued' ORDER BY t.id",
    )
    analysed = 0
    skipped = 0
    for task in tasks:
        if task["path"] not in paths:
            continue  # デモのファイルではない
        analysis_queue.mark(conn, task["id"], "running", now=now)
        result = analysis_queue.analyse_file(task["path"], platform, config, rules, gate.should_continue)
        if result["status"] == "paused":
            analysis_queue.mark(conn, task["id"], "queued", now=now)
            return {"ok": False, "reason": "解析の途中で、条件を満たさなくなりました"}
        if result["status"] == "skipped":
            analysis_queue.mark(conn, task["id"], "failed", error=result["reason"], now=now)
            skipped += 1
            continue
        analysis_queue.store_result(conn, task["file_id"], task["path"], result, config, rules, now)
        analysis_queue.mark(conn, task["id"], "done", now=now)
        analysed += 1

    return {"ok": True, "reason": "", "conditions": SIMULATED_CONDITIONS, "scanned": scanned,
            "provenance": recorded, "analysed": analysed, "skipped": skipped}


def record_demo_provenance(conn, platform, rules, entry, number, now):
    """1つのファイルの、まねた入手経路を記録する。記録したら True

    ブラウザー拡張の記録は、受け口（native_host）が書くのと同じ provenance.store_download_event で書き、
    そのファイルに結び付けます。Zone.Identifier だけのファイルは、代役の platform から読み直して判定します。
    """
    row = database.query_one(conn, "SELECT id, size FROM files WHERE path = ?", (entry["path"],))
    if row is None:
        return False
    record = entry["provenance"]
    if record["kind"] == "browser_extension":
        message = {
            "type": "download_completed",
            "browser": "chrome",
            "download": {"id": number, "filename": entry["path"], "url": record["url"], "final_url": record["url"],
                         "referrer_url": record["referrer_url"], "mime": record["mime"],
                         "started_at": record["ended_at"] - 2.0, "ended_at": record["ended_at"],
                         "file_size": row["size"], "danger": "safe"},
            "page": {"tab_url": record["tab_url"], "tab_title": record["tab_title"],
                     "captured_at": record["ended_at"] - 2.0},
        }
        event_id = provenance.store_download_event(conn, message, DEMO_EXTENSION_ORIGIN, record["ended_at"] + 0.5)
        event = database.query_one(conn, "SELECT * FROM download_events WHERE id = ?", (event_id,))
        source = provenance.determine_source(event, None, rules)
        provenance.record_provenance(conn, row["id"], source, event=event, now=now)
        provenance.mark_event_matched(conn, event_id, row["id"])
        return True
    zone = provenance.parse_zone_identifier(platform.read_zone_identifier(entry["path"]))
    source = provenance.determine_source(None, zone, rules)
    provenance.record_provenance(conn, row["id"], source, zone=zone, now=now)
    return True


# ----------------------------------------------------------------------
# 期待する検索結果
# ----------------------------------------------------------------------


def expected_results(manifest):
    """3つの検索の、期待する結果 {検索の言葉: 期待}

    期待：{"status", "matches": [一致するファイル名], "reasons": {ファイル名: [根拠に含まれるはずの文]},
          "not_matches": {一致しないはずのファイル名: その理由の説明}, "notes": [補足に出るはずの文]}
    根拠の文のうち、解析の数値（色の割合、グラフらしさ）を含むものは、数値の前後の決まった部分を確かめます
    （数値は analyse_image.py の計算の決まりで変わるため）。
    """
    files = {entry["key"]: entry for entry in manifest["files"]}
    name = {key: entry["name"] for key, entry in files.items()}
    downloaded = timeutil.local_date_str(files["budget_last_week"]["provenance"]["ended_at"])
    last_week = timeutil.find_period("先週", manifest["now"], manifest["week_starts_on"])
    without_provenance = sum(1 for entry in manifest["files"] if not entry.get("provenance"))
    return {
        "青いグラフ": {
            "status": "found",
            "matches": [name["blue_chart"]],
            "reasons": {name["blue_chart"]: ["色：青系", "（画像の色解析）", "見た目：グラフらしさ",
                                             "単色の長方形（棒）を5個検出"]},
            "not_matches": {name["red_chart"]: "赤い棒グラフ（グラフだが、青くない）",
                            name["sky_photo"]: "青空の写真（青いが、グラフらしさが低い）"},
            "notes": [],
        },
        "Slackで貰った": {
            "status": "found",
            "matches": [name["blue_chart"], name["slack_pdf"]],
            "reasons": {
                name["blue_chart"]: ["入手経路：Slack（ブラウザー拡張の記録：files.slack.com からのダウンロード）"],
                name["slack_pdf"]: ["入手経路：Slack（Windows のダウンロード元情報（Zone.Identifier）：files.slack.com）"],
            },
            "not_matches": {name["red_chart"]: "Gmail から入手（ブラウザー拡張の記録）",
                            name["budget_last_week"]: "Gmail から入手（ブラウザー拡張の記録）",
                            name["sky_photo"]: "入手経路の記録なし（記録がないファイルを Slack とは扱わない）",
                            name["minutes_last_week"]: "入手経路の記録なし"},
            "notes": [f"入手経路の記録がないファイルが {without_provenance} 件あります"
                      "（記録がないファイルを、Slack 等から入手したとは扱いません）"],
        },
        "先週の予算資料": {
            "status": "found",
            "matches": [name["budget_last_week"]],
            "reasons": {name["budget_last_week"]: [f"時期：ダウンロード日 {downloaded}（ブラウザー拡張の記録）",
                                                   "種類：文書（.docx）", "内容：タイトル・本文に「予算」"]},
            "not_matches": {name["budget_old"]: "2か月前の予算の文書（時期が違う）",
                            name["minutes_last_week"]: "先週の議事録（「予算」という語がない）"},
            "notes": [f"時期：{last_week['label']}は、端末の現地時刻で調べました"],
        },
    }


def check_search_result(result, expectation):
    """search.search の結果が期待どおりかを確かめ、違いの説明のリストを返す（空なら期待どおり）"""
    problems = []
    if result["status"] != expectation["status"]:
        problems.append(f"状態が「{result['status']}」でした（期待：{expectation['status']}）")
    names = sorted(item["name"] for item in result["results"])
    if names != sorted(expectation["matches"]):
        problems.append(f"一致したファイルが {names} でした（期待：{sorted(expectation['matches'])}）")
    for file_name, wanted_reasons in expectation["reasons"].items():
        entry = next((item for item in result["results"] if item["name"] == file_name), None)
        if entry is None:
            continue  # 一致しなかったことは、上で書いた
        for wanted in wanted_reasons:
            if not any(wanted in reason for reason in entry["reasons"]):
                problems.append(f"{file_name} の一致の理由に「{wanted}」がありません")
    for file_name in expectation["not_matches"]:
        if file_name in names:
            problems.append(f"{file_name} は一致しないはずです（{expectation['not_matches'][file_name]}）")
    for note in expectation.get("notes", []):
        if note not in result["notes"]:
            problems.append(f"補足に「{note}」がありません")
    return problems


# ----------------------------------------------------------------------
# まとめて実行する（python -m pip0 demo）
# ----------------------------------------------------------------------


def demo_config_overrides(target_dir):
    """デモの設定：作った場所の中だけを使う（本物のフォルダーや、settings.py の追加フォルダーを使わない）"""
    target = Path(target_dir).expanduser().resolve()
    return {
        "DOWNLOADS_DIR": target / "Downloads",
        "PIP0_ROOT": target / "pip0",
        "DATA_DIR": target / "data",
        "VAULT_DIR": None,
        "EXTRA_INDEX_DIRS": [],
        "SENSITIVE_DIRS": [],
    }


def run_demo(target_dir=None, now=None, rules=None, protected=None):
    """ダミーデータを作り、索引・入手経路・解析を作って、3つの検索と機密の判定を確かめる

    target_dir：空のフォルダー（なければ作る）。None なら、一時フォルダーの中に新しく作る
    now：基準の時刻（None なら今）。rules：規則（None なら rules.py）
    protected：ほかにも作ってはいけないフォルダー（例：本物の設定のダウンロードフォルダー）
    DB はメモリーの中だけに作り（鍵もメモリーだけ）、終わると消えます。作ったファイルは残ります。
    戻り値：{"ok", "reason", "target_dir", "conditions", "load", "queries", "sensitivity", "problems"}
    """
    now = time.time() if now is None else now
    rules = default_rules if rules is None else rules
    if target_dir is None:
        target_dir = tempfile.mkdtemp(prefix="pip0-demo-")
    config = config_module.load_config(overrides=demo_config_overrides(target_dir), read_user_file=False)
    report = {"ok": False, "reason": "", "target_dir": str(Path(target_dir).expanduser().resolve()),
              "conditions": SIMULATED_CONDITIONS, "load": None, "queries": [], "sensitivity": [], "problems": []}

    manifest = create_demo_dataset(target_dir, now, week_starts_on=config["WEEK_STARTS_ON"], protected=protected)
    if not manifest["ok"]:
        report["reason"] = manifest["reason"]
        return report

    conn = database.open_encrypted(":memory:", keystore.new_key_hex())
    try:
        platform = platform_fake.FakePlatform(vault_dir=config["VAULT_DIR"])
        loaded = load_demo(conn, platform, config, rules, manifest, now)
        report["load"] = loaded
        if not loaded["ok"]:
            report["reason"] = loaded["reason"]
            return report
        expectations = expected_results(manifest)
        for text in DEMO_QUERIES:
            result = search.search(conn, text, now, config, rules)
            problems = check_search_result(result, expectations[text])
            report["queries"].append({"text": text, "result": result, "expected": expectations[text],
                                      "problems": problems})
            report["problems"].extend(f"「{text}」：{problem}" for problem in problems)
        for entry in manifest["files"]:
            item = hazard.evaluate_items(conn, [entry["path"]], config, rules)["items"][0]
            matches = item["level"] == entry["expected_sensitivity"]
            report["sensitivity"].append({"name": entry["name"], "level": item["level"], "reasons": item["reasons"],
                                          "expected": entry["expected_sensitivity"], "ok": matches})
            if not matches:
                report["problems"].append(f"{entry['name']} の機密の判定が「{item['level']}」でした"
                                          f"（期待：{entry['expected_sensitivity']}）")
    finally:
        conn.close()
    report["ok"] = not report["problems"]
    report["reason"] = "" if report["ok"] else "期待と違う結果があります"
    return report


# 画面に出す、状態と判定の名前
STATUS_LABELS = {"found": "一致あり", "no_match": "該当なし", "insufficient_info": "情報不足",
                 "empty_query": "手掛かりなし"}
SENSITIVITY_LABELS = {"sensitive": "機密", "not_sensitive": "非機密", "unknown": "未判定"}


def report_lines(report):
    """run_demo の結果を、画面に出す日本語の行のリストにする"""
    lines = ["pip0 のデモ（ダミーデータ）", f"作った場所：{report['target_dir']}"]
    if report["load"] is None or not report["load"].get("ok"):
        lines.append(f"デモを実行できませんでした：{report['reason']}")
        return lines
    load = report["load"]
    lines.append(f"条件：{report['conditions']}")
    lines.append(f"索引 {load['scanned']} 件、入手経路の記録 {load['provenance']} 件、"
                 f"解析 {load['analysed']} 件（読まなかったもの {load['skipped']} 件）")
    for query in report["queries"]:
        result = query["result"]
        lines.append("")
        lines.append(f"検索「{query['text']}」：{STATUS_LABELS.get(result['status'], result['status'])}"
                     f"（一致 {len(result['results'])} 件）")
        for item in result["results"]:
            lines.append(f"  ・{item['name']}")
            for reason in item["reasons"]:
                lines.append(f"      {reason}")
        for item in result["partial_results"]:
            lines.append(f"  ・（一部一致）{item['name']}")
            for unmatched in item["unmatched"]:
                lines.append(f"      一致しない：{unmatched['reason']}")
        for note in result["notes"]:
            lines.append(f"  ※ {note}")
        if query["problems"]:
            for problem in query["problems"]:
                lines.append(f"  ✗ 期待と違う：{problem}")
        else:
            lines.append("  ✓ 期待どおり（docs/test-data.md）")
    lines.append("")
    lines.append("機密の判定（M5。ドラッグしたときの警告に使う）")
    for item in report["sensitivity"]:
        mark = "✓" if item["ok"] else "✗"
        reasons = "、".join(item["reasons"])
        lines.append(f"  {mark} {item['name']}：{SENSITIVITY_LABELS.get(item['level'], item['level'])}（{reasons}）")
    lines.append("")
    lines.append("結果：すべて期待どおりです" if report["ok"] else f"結果：期待と違うものが {len(report['problems'])} 件あります")
    return lines
