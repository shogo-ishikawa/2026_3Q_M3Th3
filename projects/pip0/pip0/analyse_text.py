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

安全のための決まり：

- ファイルは platform.open_for_analysis() で開きます（Windows では最終アクセス日時を更新しない開き方。
  pip0 自身の読み取りを「ユーザーが使った」と数えないため）。
- 展開すると大きすぎる部品は読みません（圧縮爆弾の対策。settings.OFFICE_MAX_XML_BYTES）。
- DOCTYPE や ENTITY の宣言を含む XML は読みません（Office の XML には含まれません）。
  外部のファイルの参照や、文字の展開を繰り返して大きくする攻撃を避けるためです。
- 壊れたファイルでも例外にせず、status="failed" と日本語の理由を返します。
"""

import codecs
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

    返す辞書：{"status": "done"/"unsupported"/"failed", "kind", "title", "text", "has_chart", "labels", "error"}
    - text：本文（先頭から TEXT_MAX_CHARS 文字まで）。読めなかったときは None
    - has_chart：Office 文書がグラフを含むか（True/False）。分からない形式は None
    - labels：秘密度ラベルの名前のリスト（Office 文書だけ。ほかは None）
    """
    ext = extension_of(path)
    result = {"status": "done", "kind": rules.FILE_KINDS.get(ext, "other"), "title": None, "text": None,
              "has_chart": None, "labels": None, "error": None}

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

    result.update(outcome)
    if result["status"] == "done":
        result["text"] = tidy_text(result["text"] or "")[:config["TEXT_MAX_CHARS"]]
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
    max_chars = config["TEXT_MAX_CHARS"]

    # 本文が入っている部品と、その中の要素の名前（段落の区切り、読み飛ばす要素）
    # Fallback は、同じ内容の古い形式での表現（図形の中の文字が二重に読まれないように飛ばす）
    if ext == ".docx":
        if "word/document.xml" not in names:
            raise Refused("Word 文書の本文（word/document.xml）がありません")
        text_parts = [("word/document.xml", ["p"], ["Fallback"])]
    elif ext == ".xlsx":
        text_parts = []
        if "xl/sharedStrings.xml" in names:
            # 1つの <si> が1つのセルの文字。<rPh> はふりがな（読み）なので飛ばす
            text_parts.append(("xl/sharedStrings.xml", ["si"], ["rPh", "Fallback"]))
    else:
        text_parts = [(name, ["p"], ["Fallback"]) for name in numbered_parts(names, "ppt/slides/slide")]

    info_parts = [name for name in ["docProps/core.xml", "docProps/custom.xml"] if name in names]
    checked_total = check_sizes(archive, [part[0] for part in text_parts] + info_parts, limit)

    texts = []
    length = 0
    for name, line_end_names, skip_names in text_parts:
        if length >= max_chars:
            break  # 保存する文字数に達したら、残りの部品は読まない
        part_text = collect_xml_text(read_member(archive, name, limit), line_end_names, skip_names)
        texts.append(part_text)
        length += len(part_text)
    if ext == ".xlsx" and length < max_chars:
        budget = limit * TOTAL_XML_FACTOR - checked_total
        texts.append(read_inline_strings(archive, names, limit, budget, max_chars - length))

    return {
        "status": "done",
        "title": read_core_title(archive, limit) if "docProps/core.xml" in names else None,
        "text": "\n".join(texts),
        "has_chart": any(name.startswith(folder) for name in names for folder in CHART_FOLDERS),
        "labels": read_labels(archive, limit) if "docProps/custom.xml" in names else [],
    }


def read_inline_strings(archive, names, limit, budget, max_chars):
    """Excel のシートのセルに直接書かれた文字（<c t="inlineStr"><is><t>）を集める

    多くの Excel ファイルでは、セルの文字は sharedStrings.xml にあり、シートには番号だけがあります。
    シートは大きいことがあるため、大きすぎるシートと、合計の上限（budget）を超える分は読み飛ばします。
    """
    texts = []
    length = 0
    for name in numbered_parts(names, "xl/worksheets/sheet"):
        size = archive.getinfo(name).file_size
        if size > limit or size > budget or length >= max_chars:
            continue
        budget -= size
        data = read_member(archive, name, limit)
        if b"inlineStr" not in data:
            continue  # 直接書かれた文字がないシート（数値だけ等）は、XML を解析しない
        sheet_text = collect_xml_text(data, ["is"], ["rPh"])
        texts.append(sheet_text)
        length += len(sheet_text)
    return "\n".join(texts)


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
    """「ppt/slides/slide」で始まり番号.xml で終わる部品を、番号の順（1, 2, …, 10）に並べる"""
    found = []
    for name in names:
        match = re.fullmatch(re.escape(prefix) + r"(\d+)\.xml", name)
        if match:
            found.append((int(match.group(1)), name))
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
    """PDF の文書情報のタイトルと、本文（先頭から PDF_MAX_PAGES ページまで）を読む"""
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
            texts = []
            length = 0
            for page_number, page in enumerate(reader.pages):
                if page_number >= config["PDF_MAX_PAGES"] or length >= config["TEXT_MAX_CHARS"]:
                    break
                page_text = page.extract_text() or ""
                texts.append(page_text)
                length += len(page_text)
    except Exception as error:  # pypdf は壊れた PDF で、さまざまな種類の例外を出すため、まとめて受け止める
        return {"status": "failed", "error": f"PDF を読めませんでした（{type(error).__name__}）"}
    return {"status": "done", "title": title, "text": "\n".join(texts), "has_chart": None, "labels": None}


# ----------------------------------------------------------------------
# テキストファイル（.txt、.md、.csv）
# ----------------------------------------------------------------------


def read_plain_text_file(path, platform, config):
    """テキストファイルの先頭を読み、文字コードを判定して文字列にする

    文字コードは、UTF-16 の目印（BOM）があれば UTF-16、なければ UTF-8（BOM 付きも可）、
    だめなら Shift_JIS（Windows の cp932）の順に試します。
    """
    limit = config["TEXT_MAX_CHARS"] * 4  # 1文字は多くても4バイト。保存する文字数の分だけ読む
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
    return {"status": "done", "title": None, "text": text, "has_chart": None, "labels": None}


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
