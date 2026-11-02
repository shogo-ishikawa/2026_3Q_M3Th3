"""文書の本文とタイトルを取り出す（ローカル解析）

Word（.docx）、Excel（.xlsx）、PowerPoint（.pptx）、PDF、テキスト（.txt、.md、.csv）から、
検索（M3）、仕分けと改名（M1）、機密の判定（M5）に使う情報を取り出します。
処理はすべてこの PC の中で、標準ライブラリと pypdf だけを使って行います（外部へは何も送りません）。

- extract_text()：本文、タイトル、グラフの有無、秘密度ラベルを取り出す（高負荷の解析）。
  電源接続中かつ3分間無操作のときに、analysis_queue.analyse_file() から呼ばれます。
- light_metadata()：文書のタイトルだけを軽く読む。ダウンロード直後の3秒の間（ミニドック）に使います。

Office 文書（.docx など）の中身は、XML ファイルをまとめた ZIP です。読む場所は次のとおりです。

    word/document.xml       Word の本文（<w:t> の中の文字）
    xl/sharedStrings.xml    Excel のセルの文字（共有文字列）
    xl/worksheets/sheet1.xml …  Excel のシート（セルに直接書かれた文字 <is><t>）
    ppt/slides/slide1.xml …  PowerPoint のスライドの文字（<a:t> の中の文字）
    docProps/core.xml       タイトルなどの文書情報（<dc:title>）
    docProps/custom.xml     ユーザー定義の情報。秘密度ラベルの名前（MSIP_Label_…_Name）もここにある
    word/charts/ など        グラフが入っていると、ここにグラフの部品がある

機密の判定（M5）のためだけに、次の場所も読みます（「社外秘」などの表示は、本文ではなく、ここに書かれることが
多いため）。ここの文字は DB に保存せず、検索や名前の提案にも使いません（EXTRA_PARTS）。

    word/header1.xml …、word/footer1.xml …       Word のヘッダー・フッター（透かしの文字も。下の textpath）
    word/footnotes.xml、endnotes.xml、comments.xml  Word の脚注・文末脚注・コメント
    ppt/notesSlides/、slideMasters/、slideLayouts/  PowerPoint のノート、スライドマスター、レイアウト
    ppt/notesMasters/、handoutMasters/            PowerPoint のノートと配布資料のマスター
    xl/worksheets/sheet1.xml …                     Excel のヘッダー・フッター（<oddHeader> など）と、
                                                   12桁以上の整数が入った数値のセル（<v>）
    PDF の注釈（/Annots の /Contents）              コメント、付箋、テキストボックスの文字
    PDF のフォームの入力欄（/AcroForm の値 /V）     入力して保存した文字（申請書の個人番号など）

Word の透かし（デザイン → 透かし →「社外秘」）やワードアートの文字は、<w:t> ではなく、図形（VML）の
<v:textpath string="社外秘"> に書かれています。この string も文字として読みます。
Excel のシートは大きいことがあるため、ヘッダー・フッターと長い整数は、シートの XML の全体を解析せずに、
決まった形の部分だけを探します（EXCEL_HEADER_FOOTER_PATTERN、EXCEL_LONG_NUMBER_PATTERN）。

本文を読む量には上限があります（PDF は設定の PDF_MAX_PAGES ページ、テキストは CHECK_MAX_CHARS 文字の分など）。
上限で読むのをやめた部分は unread（読まなかった部分の説明）に書き、機密の判定は「未判定」になります
（sensitivity.overall。一部しか調べていない文書を「非機密」としないため）。

安全のための決まり：

- ファイルは platform.open_for_analysis() で開きます（Windows では最終アクセス日時を更新しない開き方。
  pip0 自身の読み取りを「ユーザーが使った」と数えないため）。
- 展開すると大きすぎる部品は読みません（圧縮爆弾の対策。settings.OFFICE_MAX_XML_BYTES）。
- DOCTYPE や ENTITY の宣言を含む XML は読みません（Office の XML には含まれません）。
  外部のファイルの参照や、文字の展開を繰り返して大きくする攻撃を避けるためです。
- 壊れたファイルでも例外にせず、status="failed" と日本語の理由を返します。
"""

import codecs
import html
import io
import logging
import os
import re
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
import zlib

# pypdf の警告には、PDF の中のデータの断片が含まれることがあるため、pip0 のログに書かれないようにする
# （pip0 のログには、ファイル名・本文・URL を書かない決まり。docs/design.md 5-1）
logging.getLogger("pypdf").setLevel(logging.CRITICAL)

# 拡張子ごとの読み方。ここにない形式（.doc、.xls、.ppt などの古い形式）は「対象外の形式」です
OFFICE_EXTENSIONS = [".docx", ".xlsx", ".pptx"]
PDF_EXTENSIONS = [".pdf"]
PLAIN_TEXT_EXTENSIONS = [".txt", ".md", ".csv"]

# グラフの部品が置かれるフォルダー（ZIP の中の場所）
CHART_FOLDERS = ["word/charts/", "xl/charts/", "ppt/charts/"]

# 本文の場所の名前（check_texts の鍵。機密の判定の理由に「本文に「社外秘」」のように書く）
BODY = "本文"
# 機密の判定のためだけに読む部品：[(ZIP の中の名前の始まり, 判定の理由に書く場所の名前)]。
# 名前の始まりの後に番号（なくてもよい）と .xml が続く部品を読む（例：word/header → word/header1.xml）
EXTRA_PARTS = {
    ".docx": [("word/header", "ヘッダー"), ("word/footer", "フッター"), ("word/footnotes", "脚注"),
              ("word/endnotes", "文末脚注"), ("word/comments", "コメント")],
    ".pptx": [("ppt/notesSlides/notesSlide", "ノート"), ("ppt/slideMasters/slideMaster", "スライドマスター"),
              ("ppt/slideLayouts/slideLayout", "スライドのレイアウト"),
              ("ppt/notesMasters/notesMaster", "ノートのマスター"),
              ("ppt/handoutMasters/handoutMaster", "配布資料のマスター")],
    ".xlsx": [],  # Excel のヘッダー・フッターは、シートの中にある（read_sheets で読む）
}
# Excel のシートの、印刷するときのヘッダー・フッターの要素（<oddHeader>…</oddHeader>、<evenFooter> など）。
# 中身は文字だけ（< は &lt; と書かれる）なので、「<」の手前までを取り出す。名前空間の接頭辞（x: など）があってもよい
EXCEL_HEADER_FOOTER_PATTERN = re.compile(rb"<(?:\w+:)?(?:odd|even|first)(?:Header|Footer)>([^<]*)<")
# ヘッダー・フッターの書式の指定（&L：左寄せ、&"ＭＳ ゴシック,太字"：字体、&12：文字の大きさ（3桁まで）、
# &KFF0000：文字の色、&P：ページ番号 など）。書式の指定は空白に置き換えてから調べる
EXCEL_HEADER_FOOTER_CODE = re.compile(r'&(?:"[^"]*"|\d{1,3}|K[0-9A-Fa-f]{6}|.)')
# ★ Excel の数値のセルのうち、個人番号・カード番号の判定に使う整数の最小の桁数（これより短い数値は調べない）
EXCEL_NUMBER_MIN_DIGITS = 12
# 数値のセルの値（<v>123456789018</v>）のうち、EXCEL_NUMBER_MIN_DIGITS 桁以上の整数だけのもの
EXCEL_LONG_NUMBER_PATTERN = re.compile(rb"<(?:\w+:)?v>\s*([0-9]{%d,})\s*</" % EXCEL_NUMBER_MIN_DIGITS)
# PDF で、機密の判定のためだけに読む場所の名前（判定の理由に書く）
PDF_NOTES = "注釈"
PDF_FORM_FIELDS = "フォームの入力欄"

# ★ 機密の判定のために読む文字数の目安。本文がこれより長い文書は、残りを読まずに unread に書きます
#   （その文書の判定は「未判定」）。DB に保存する本文は、これとは別に、設定の TEXT_MAX_CHARS 文字までです
CHECK_MAX_CHARS = 2_000_000

# 秘密度ラベル（Microsoft Purview）の名前を入れる項目の名前。例：MSIP_Label_1234abcd-…_Name
LABEL_NAME_PATTERN = re.compile(r"^MSIP_Label_[0-9A-Fa-f-]+_Name$")

# ★ 1つの文書で読む XML の合計の上限を、OFFICE_MAX_XML_BYTES の何倍にするか
TOTAL_XML_FACTOR = 4
# ZIP の中の部品の数の上限（これより多いものは、普通の Office 文書ではないとみなして読まない）
MAX_ZIP_MEMBERS = 10000
# ダウンロード直後（3秒の間）に読む docProps/core.xml の大きさの上限（普通は数 KB）
LIGHT_XML_MAX_BYTES = 1024 * 1024
# ★ タイトルとして残す最大の文字数
TITLE_MAX_CHARS = 200
# ★ PDF のタイトルの先頭に付くことがある、意味の薄い語（Office から PDF に印刷したとき等）
TITLE_PREFIXES = ["Microsoft Word - ", "Microsoft PowerPoint - ", "Microsoft Excel - "]
# 上の語を取り除いた後、末尾に残っていたら取り除く拡張子
TITLE_OFFICE_SUFFIXES = [".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt"]

# ZIP と XML を読むときに起こりうる失敗（壊れたファイル、未対応の圧縮、パスワード付き等）
OFFICE_READ_ERRORS = (zipfile.BadZipFile, zipfile.LargeZipFile, ET.ParseError, EOFError, zlib.error,
                      NotImplementedError, RuntimeError, ValueError, OSError)


class Refused(Exception):
    """安全のために読むのをやめた（理由は日本語のメッセージ）"""


# ----------------------------------------------------------------------
# 入口1：本文の取り出し（高負荷の解析）
# ----------------------------------------------------------------------


def extract_text(path, platform, config, rules):
    """文書から本文などを取り出す

    返す辞書：{"status": "done"/"unsupported"/"failed", "kind", "title", "text", "has_chart", "labels", "error",
              "check_texts", "unread"}
    - text：本文（先頭から TEXT_MAX_CHARS 文字まで。DB に保存し、検索と名前の提案に使う）。読めなかったときは None
    - has_chart：Office 文書がグラフを含むか（True/False）。分からない形式は None
    - labels：秘密度ラベルの名前のリスト（Office 文書だけ。ほかは None）
    - check_texts：機密の判定に使う文字 {場所: 文字列}。「本文」は切り詰めていない本文の全体で、Office 文書には
      「ヘッダー」「フッター」「ノート」「スライドマスター」なども入る。DB には保存しない。読めなかったときは None
    - unread：読まなかった部分の説明のリスト（全体を読めたら空のリスト）。読めなかったときは None
    """
    ext = extension_of(path)
    result = {"status": "done", "kind": rules.FILE_KINDS.get(ext, "other"), "title": None, "text": None,
              "has_chart": None, "labels": None, "error": None, "check_texts": None, "unread": None}

    if ext in OFFICE_EXTENSIONS:
        outcome = read_office_file(path, platform, config, ext)
    elif ext in PDF_EXTENSIONS:
        outcome = read_pdf_file(path, platform, config, want_text=True)
    elif ext in PLAIN_TEXT_EXTENSIONS:
        outcome = read_plain_text_file(path, platform, config)
    else:
        result["status"] = "unsupported"
        result["error"] = f"この形式（{ext or '拡張子なし'}）の本文は読み取れません"
        return result

    if outcome["status"] != "done":
        result["status"] = "failed"
        result["error"] = outcome["error"]
        return result
    for key in ["title", "has_chart", "labels", "unread"]:
        result[key] = outcome[key]
    # 機密の判定には、読んだ文字の全体を使う。DB に保存する本文は、先頭の TEXT_MAX_CHARS 文字だけ
    check_texts = {}
    for place, text in outcome["texts"].items():
        check_texts[place] = tidy_text(text)
    result["check_texts"] = check_texts
    result["text"] = check_texts[BODY][:config["TEXT_MAX_CHARS"]]
    return result


# ----------------------------------------------------------------------
# 入口2：タイトルだけを軽く読む（ダウンロード直後の3秒の間）
# ----------------------------------------------------------------------


def light_metadata(path, platform, config, rules):
    """Office 文書の docProps/core.xml のタイトルか、PDF の文書情報のタイトルだけを読む

    返す辞書：{"status": "done"/"skipped"/"failed", "title", "kind", "source": "office_core"/"pdf_info"/None, "reason"}
    大きいファイル（LIGHT_METADATA_MAX_BYTES より大きい）と、タイトルを持たない形式は読まずに "skipped" にします。
    タイトルが設定されていない文書は、status="done"、title=None です。
    """
    ext = extension_of(path)
    result = {"status": "skipped", "title": None, "kind": rules.FILE_KINDS.get(ext, "other"),
              "source": None, "reason": ""}
    if ext not in OFFICE_EXTENSIONS and ext not in PDF_EXTENSIONS:
        result["reason"] = "タイトルを持つ形式（Office 文書、PDF）ではありません"
        return result
    if platform.get_local_state(path).get("local") is not True:
        result["reason"] = "中身がこの PC にないファイル（ゴースト等）は読みません"
        return result
    try:
        size = os.stat(path).st_size
    except OSError as error:
        result["status"] = "failed"
        result["reason"] = f"ファイルの大きさを確かめられません（{type(error).__name__}）"
        return result
    if size > config["LIGHT_METADATA_MAX_BYTES"]:
        result["reason"] = f"大きいファイル（{megabytes(size)}）のため、ダウンロード直後には読みません（後の解析で読みます）"
        return result

    if ext in OFFICE_EXTENSIONS:
        outcome = read_office_title(path, platform)
        source = "office_core"
    else:
        outcome = read_pdf_file(path, platform, config, want_text=False)
        source = "pdf_info"

    if outcome["status"] != "done":
        result["status"] = "failed"
        result["reason"] = outcome["error"]
        return result
    result["status"] = "done"
    result["title"] = outcome["title"]
    if outcome["title"]:
        result["source"] = source
    else:
        result["reason"] = "文書のタイトルが設定されていません"
    return result


# ----------------------------------------------------------------------
# Office 文書（ZIP の中の XML）
# ----------------------------------------------------------------------


def read_office_file(path, platform, config, ext):
    """Office 文書から本文・タイトル・グラフの有無・ラベルを取り出す"""
    try:
        with platform.open_for_analysis(path) as f:
            with zipfile.ZipFile(f) as archive:
                return read_office_parts(archive, config, ext)
    except Refused as error:
        return {"status": "failed", "error": str(error)}
    except zipfile.BadZipFile:
        return {"status": "failed",
                "error": "ZIP 形式として読めません（壊れているか、パスワード付きの Office 文書かもしれません）"}
    except OFFICE_READ_ERRORS as error:
        return {"status": "failed", "error": f"Office 文書を読めませんでした（{type(error).__name__}）"}


def read_office_parts(archive, config, ext):
    names = archive.namelist()
    if len(names) > MAX_ZIP_MEMBERS:
        raise Refused(f"ZIP の中の部品が多すぎるため、読みません（{len(names)}個）")
    limit = config["OFFICE_MAX_XML_BYTES"]

    # 読む部品：(ZIP の中の名前, 場所, 段落の区切りの要素, 読み飛ばす要素)。本文の部品が先、判定だけに使う部品が後
    # Fallback は、同じ内容の古い形式での表現（図形の中の文字が二重に読まれないように飛ばす）
    if ext == ".docx":
        if "word/document.xml" not in names:
            raise Refused("Word 文書の本文（word/document.xml）がありません")
        parts = [("word/document.xml", BODY, ["p"], ["Fallback"])]
    elif ext == ".xlsx":
        parts = []
        if "xl/sharedStrings.xml" in names:
            # 1つの <si> が1つのセルの文字。<rPh> はふりがな（読み）なので飛ばす
            parts.append(("xl/sharedStrings.xml", BODY, ["si"], ["rPh", "Fallback"]))
    else:
        parts = [(name, BODY, ["p"], ["Fallback"]) for name in numbered_parts(names, "ppt/slides/slide")]
    for prefix, place in EXTRA_PARTS[ext]:
        for name in numbered_parts(names, prefix):
            parts.append((name, place, ["p"], ["Fallback"]))

    info_parts = [name for name in ["docProps/core.xml", "docProps/custom.xml"] if name in names]
    checked_total = check_sizes(archive, [part[0] for part in parts] + info_parts, limit)

    texts = {BODY: []}  # 場所 → 読んだ文字のリスト
    unread = []
    skipped = 0
    length = 0
    for name, place, line_end_names, skip_names in parts:
        if length >= CHECK_MAX_CHARS:
            skipped += 1  # 読む文字数の目安に達したら、残りの部品は読まない（unread に書く）
            continue
        part_text = collect_xml_text(read_member(archive, name, limit), line_end_names, skip_names)
        if place not in texts:
            texts[place] = []
        texts[place].append(part_text)
        length += len(part_text)
    if skipped:
        unread.append(f"文字数の目安（{CHECK_MAX_CHARS:,}文字）に達した後の部品 {skipped}個")
    if ext == ".xlsx":
        budget = limit * TOTAL_XML_FACTOR - checked_total
        sheets = read_sheets(archive, names, limit, budget, CHECK_MAX_CHARS - length)
        texts[BODY].append(sheets["inline"])
        texts["ヘッダー・フッター"] = [sheets["header_footer"]]
        texts["セルの数値"] = [sheets["numbers"]]
        unread += sheets["unread"]

    return {
        "status": "done",
        "title": read_core_title(archive, limit) if "docProps/core.xml" in names else None,
        "texts": {place: "\n".join(found) for place, found in texts.items()},
        "has_chart": any(name.startswith(folder) for name in names for folder in CHART_FOLDERS),
        "labels": read_labels(archive, limit) if "docProps/custom.xml" in names else [],
        "unread": unread,
    }


def read_sheets(archive, names, limit, budget, max_chars):
    """Excel のシートから、セルに直接書かれた文字（本文）、ヘッダー・フッター、長い整数のセルを集める

    多くの Excel ファイルでは、セルの文字は sharedStrings.xml にあり、シートには番号と数値があります。
    - inline：セルに直接書かれた文字（<c t="inlineStr"><is><t>）。本文として保存する。
      そういうセルがあるシートだけ、XML を解析して読む（数値だけの大きなシートを解析しないため）
    - header_footer：印刷するときのヘッダー・フッター（書式の指定は空白にする）。判定だけに使う
    - numbers：EXCEL_NUMBER_MIN_DIGITS 桁以上の整数の数値のセル（<v>）。個人番号の判定だけに使う
    ヘッダー・フッターと数値は、XML を解析せずに、決まった形の部分だけを探します（大きなシートでも速いように）。
    シートは大きいことがあるため、大きすぎるシート、合計の上限（budget）を超える分、文字数の目安を超えた後の
    シートは読まず、その数を unread（読まなかった部分の説明）に書きます。
    """
    inline_texts = []
    header_footer_texts = []
    numbers = []
    skipped = 0
    length = 0
    for name in numbered_parts(names, "xl/worksheets/sheet"):
        size = archive.getinfo(name).file_size
        if size > limit or size > budget or length >= max_chars:
            skipped += 1
            continue
        budget -= size
        data = read_member(archive, name, limit)
        refuse_doctype(data)
        if b"inlineStr" in data:  # 直接書かれた文字がないシート（数値だけ等）は、XML を解析しない
            sheet_text = collect_xml_text(data, ["is"], ["rPh"])
            inline_texts.append(sheet_text)
            length += len(sheet_text)
        start = data.find(b"headerFooter")  # ヘッダー・フッターは <headerFooter> の中（シートの終わりのほう）にある
        if start >= 0:
            for match in EXCEL_HEADER_FOOTER_PATTERN.finditer(data, start):
                text = html.unescape(match.group(1).decode("utf-8", errors="replace"))  # &amp; などを元の文字に戻す
                header_footer_texts.append(EXCEL_HEADER_FOOTER_CODE.sub(" ", text))
        for match in EXCEL_LONG_NUMBER_PATTERN.finditer(data):
            numbers.append(match.group(1).decode("ascii"))
    unread = []
    if skipped:
        unread.append(f"大きすぎるか、文字数の目安に達した後のシート {skipped}個")
    return {"inline": "\n".join(inline_texts), "header_footer": "\n".join(header_footer_texts),
            "numbers": "\n".join(numbers), "unread": unread}


def read_office_title(path, platform):
    """Office 文書の docProps/core.xml のタイトルだけを読む（3秒の間に使う軽い読み取り）"""
    try:
        with platform.open_for_analysis(path) as f:
            with zipfile.ZipFile(f) as archive:
                names = archive.namelist()
                if len(names) > MAX_ZIP_MEMBERS:
                    raise Refused(f"ZIP の中の部品が多すぎるため、読みません（{len(names)}個）")
                if "docProps/core.xml" not in names:
                    return {"status": "done", "title": None}
                check_sizes(archive, ["docProps/core.xml"], LIGHT_XML_MAX_BYTES)
                return {"status": "done", "title": read_core_title(archive, LIGHT_XML_MAX_BYTES)}
    except Refused as error:
        return {"status": "failed", "error": str(error)}
    except zipfile.BadZipFile:
        return {"status": "failed",
                "error": "ZIP 形式として読めません（壊れているか、パスワード付きの Office 文書かもしれません）"}
    except OFFICE_READ_ERRORS as error:
        return {"status": "failed", "error": f"Office 文書を読めませんでした（{type(error).__name__}）"}


def numbered_parts(names, prefix):
    """「ppt/slides/slide」で始まり番号.xml で終わる部品を、番号の順（1, 2, …, 10）に並べる

    番号のない部品（例：「word/footnotes」に対する word/footnotes.xml）も含め、先頭に並べます。
    """
    found = []
    for name in names:
        match = re.fullmatch(re.escape(prefix) + r"(\d*)\.xml", name)
        if match:
            found.append((int(match.group(1) or 0), name))
    found.sort()
    return [name for _, name in found]


def check_sizes(archive, names, limit):
    """読む部品の展開後の大きさ（ZIP に書かれた値）を、読む前に確かめる（圧縮爆弾の対策）。合計を返す

    zipfile は、書かれた大きさより多くは展開しません（多ければ壊れたファイルとして失敗します）。
    """
    total = 0
    for name in names:
        size = archive.getinfo(name).file_size
        if size > limit:
            raise Refused(f"展開すると大きすぎる部品があるため、読みません（{megabytes(size)}、上限 {megabytes(limit)}）")
        total += size
    if total > limit * TOTAL_XML_FACTOR:
        raise Refused(f"展開すると合計が大きすぎるため、読みません（{megabytes(total)}。圧縮爆弾の疑い）")
    return total


def read_member(archive, name, limit):
    """ZIP の中の部品を、多くても limit バイトまで読む"""
    with archive.open(name) as member:
        data = member.read(limit + 1)
    if len(data) > limit:
        raise Refused(f"展開すると大きすぎる部品があるため、読みません（上限 {megabytes(limit)}）")
    return data


def refuse_doctype(data):
    """DOCTYPE や ENTITY の宣言を含む XML は読まない（Office の XML には含まれない）"""
    for word in ["<!DOCTYPE", "<!ENTITY"]:
        for encoding in ["utf-8", "utf-16-le", "utf-16-be"]:
            if word.encode(encoding) in data:
                raise Refused("XML に DOCTYPE・ENTITY の宣言があるため、読みません")


def local_name(tag):
    """「{名前空間}t」→「t」。XML の名前空間を除いた要素の名前"""
    return tag.rsplit("}", 1)[-1]


def collect_xml_text(data, line_end_names, skip_names):
    """XML の中の文字（名前が t の要素）を、文書の順に集めて1つの文字列にする

    図形（VML）の文字（<v:textpath string="…">。Word の透かしやワードアート）も、1行として集めます。
    line_end_names の要素（段落など）の終わりと、改行の要素（br）で行を分けます。
    skip_names の要素の中（ふりがな、同じ内容の代わりの表現 Fallback）は読み飛ばします。
    読み終えた要素は親から外して、大きな XML でもメモリーを使いすぎないようにします。
    """
    refuse_doctype(data)
    parts = []
    open_elements = []  # 読んでいる途中の要素（親から順に）
    skip_depth = 0      # 読み飛ばす要素の中にいる深さ
    for event, element in ET.iterparse(io.BytesIO(data), events=("start", "end")):
        name = local_name(element.tag)
        if event == "start":
            open_elements.append(element)
            if name in skip_names:
                skip_depth += 1
            continue
        open_elements.pop()
        if name in skip_names:
            skip_depth -= 1
        elif skip_depth == 0:
            if name == "t" and element.text:
                parts.append(element.text)
            elif name == "textpath" and element.get("string"):
                parts.append(element.get("string") + "\n")  # 透かしの「社外秘」などは、属性 string にある
            elif name == "br" or name in line_end_names:
                parts.append("\n")
        if open_elements:
            open_elements[-1].remove(element)
    return "".join(parts)


def read_small_xml(archive, name, limit):
    """小さな XML（docProps の中など）を読んで、要素の木にする"""
    data = read_member(archive, name, limit)
    refuse_doctype(data)
    return ET.fromstring(data)


def read_core_title(archive, limit):
    """docProps/core.xml の <dc:title> を読む。なければ None"""
    root = read_small_xml(archive, "docProps/core.xml", limit)
    for element in root.iter():
        if local_name(element.tag) == "title":
            return tidy_title(element.text)
    return None


def read_labels(archive, limit):
    """docProps/custom.xml から、秘密度ラベルの名前（MSIP_Label_…_Name の値）を集める"""
    labels = []
    root = read_small_xml(archive, "docProps/custom.xml", limit)
    for element in root.iter():
        if local_name(element.tag) != "property":
            continue
        if not LABEL_NAME_PATTERN.match(element.get("name", "")):
            continue
        for value in element:  # 値は子の要素（<vt:lpwstr> など）に入っている
            label = (value.text or "").strip()
            if label and label not in labels:
                labels.append(label)
    return labels


# ----------------------------------------------------------------------
# PDF（pypdf）
# ----------------------------------------------------------------------


def read_pdf_file(path, platform, config, want_text):
    """PDF の文書情報のタイトルと、本文（先頭から PDF_MAX_PAGES ページまで）を読む

    本文は、設定の PDF_MAX_PAGES ページか、読む文字数の目安（CHECK_MAX_CHARS）に達するまで読み、
    残りのページがあれば unread（読まなかった部分の説明）に書きます。
    機密の判定のためだけに、読んだページの注釈の文字と、フォームの入力欄に入力された文字も読みます
    （どちらもページの本文 page.extract_text() には含まれません。DB には保存しません）。
    """
    try:
        from pypdf import PasswordType, PdfReader
    except ImportError:
        return {"status": "failed", "error": "PDF を読むライブラリ（pypdf）がありません。requirements.txt で導入してください"}
    try:
        with platform.open_for_analysis(path) as f:
            reader = PdfReader(f, strict=False)
            if reader.is_encrypted and reader.decrypt("") == PasswordType.NOT_DECRYPTED:
                return {"status": "failed", "error": "パスワードで保護された PDF のため、読めません"}
            info = reader.metadata
            title = tidy_title(info.title) if info is not None else None
            if not want_text:
                return {"status": "done", "title": title}
            page_texts = []
            notes = []
            unread = []
            length = 0
            page_count = len(reader.pages)
            for page_number, page in enumerate(reader.pages):
                if page_number >= config["PDF_MAX_PAGES"] or length >= CHECK_MAX_CHARS:
                    first = page_number + 1  # 読まなかった最初のページ（1から数える）
                    unread.append(f"{first}ページ" if first == page_count else f"{first}〜{page_count}ページ")
                    break
                page_text = page.extract_text() or ""
                page_texts.append(page_text)
                length += len(page_text)
                notes += annotation_texts(page)
            fields = form_field_texts(reader)
    except Exception as error:  # pypdf は壊れた PDF で、さまざまな種類の例外を出すため、まとめて受け止める
        return {"status": "failed", "error": f"PDF を読めませんでした（{type(error).__name__}）"}
    texts = {BODY: "\n".join(page_texts), PDF_NOTES: "\n".join(notes), PDF_FORM_FIELDS: "\n".join(fields)}
    return {"status": "done", "title": title, "texts": texts, "has_chart": None, "labels": None, "unread": unread}


def annotation_texts(page):
    """PDF のページの注釈（コメント、付箋、テキストボックスなど）に書かれた文字（/Contents）のリスト"""
    if "/Annots" not in page:
        return []
    annotations = page["/Annots"]  # [] で読むと、別の場所にある値（間接参照）も、その値になる
    if not isinstance(annotations, list):
        return []
    texts = []
    for annotation in annotations:
        annotation = annotation.get_object()
        if isinstance(annotation, dict) and "/Contents" in annotation:
            contents = annotation["/Contents"]
            if isinstance(contents, str):
                texts.append(contents)
    return texts


def form_field_texts(reader):
    """PDF のフォームの、文字を入力する欄に入っている値（/V）のリスト（入力して保存した申請書の番号など）"""
    texts = []
    for value in reader.get_form_text_fields().values():
        if isinstance(value, str) and value:
            texts.append(value)
    return texts


# ----------------------------------------------------------------------
# テキストファイル（.txt、.md、.csv）
# ----------------------------------------------------------------------


def read_plain_text_file(path, platform, config):
    """テキストファイルを読み、文字コードを判定して文字列にする

    文字コードは、UTF-16 の目印（BOM）があれば UTF-16、なければ UTF-8（BOM 付きも可）、
    だめなら Shift_JIS（Windows の cp932）の順に試します。
    読む文字数の目安（CHECK_MAX_CHARS）の分より大きいファイルは、残りを unread（読まなかった部分の説明）に書きます。
    """
    limit = CHECK_MAX_CHARS * 4  # 1文字は多くても4バイト。読む文字数の目安の分だけ読む
    try:
        with platform.open_for_analysis(path) as f:
            data = f.read(limit + 1)
    except OSError as error:
        return {"status": "failed", "error": f"ファイルを読めませんでした（{type(error).__name__}）"}
    truncated = len(data) > limit
    text = decode_text(data[:limit], truncated)
    if text is None:
        return {"status": "failed",
                "error": "文字コードを判別できません（UTF-8、UTF-16、Shift_JIS のどれでもないか、文字のファイルではありません）"}
    unread = [f"ファイルの先頭 {limit:,} バイトより後"] if truncated else []
    return {"status": "done", "title": None, "texts": {BODY: text}, "has_chart": None, "labels": None,
            "unread": unread}


def decode_text(data, truncated):
    """バイト列を文字列にする。どの文字コードでも読めなければ None"""
    if data.startswith(codecs.BOM_UTF16_LE) or data.startswith(codecs.BOM_UTF16_BE):
        encodings = ["utf-16"]
    elif b"\x00" in data:
        return None  # UTF-8 や Shift_JIS の文字には 0 のバイトがない。画像などの文字でないファイル
    else:
        encodings = ["utf-8-sig", "cp932"]
    for encoding in encodings:
        # 途中まで読んだときは、最後の文字が切れていることがあるので、少しずつ読む仕組み（incremental）を使う
        decoder = codecs.getincrementaldecoder(encoding)()
        try:
            return decoder.decode(data, final=not truncated)
        except UnicodeDecodeError:
            continue
    return None


# ----------------------------------------------------------------------
# 小さな部品
# ----------------------------------------------------------------------


def extension_of(path):
    """「C:\\…\\予算.PDF」→「.pdf」（小文字）"""
    return os.path.splitext(os.fspath(path))[1].lower()


def megabytes(size):
    return f"{size / (1024 * 1024):.1f}MB"


def remove_control_characters(text):
    """制御文字（Cc）と書式用の見えない文字（Cf）を取り除く。タブは残す"""
    kept = []
    for ch in text:
        if ch == "\t" or unicodedata.category(ch) not in ("Cc", "Cf"):
            kept.append(ch)
    return "".join(kept)


def tidy_text(text):
    """本文を整える：改行をそろえ、制御文字を除き、空の行と行末の空白を詰める"""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = []
    for line in text.split("\n"):
        line = remove_control_characters(line).strip()
        if line:
            lines.append(line)
    return "\n".join(lines)


def tidy_title(title):
    """タイトルを整える。空なら None"""
    if title is None:
        return None
    text = " ".join(remove_control_characters(str(title)).split())  # 改行や連続する空白を1つの空白に
    for prefix in TITLE_PREFIXES:
        if text.startswith(prefix):
            text = text[len(prefix):]
            for suffix in TITLE_OFFICE_SUFFIXES:
                if text.lower().endswith(suffix):
                    text = text[:-len(suffix)]
                    break
            break
    text = text.strip()[:TITLE_MAX_CHARS]
    return text or None
