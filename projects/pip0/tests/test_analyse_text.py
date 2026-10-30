"""文書の本文とタイトルの取り出し（analyse_text.py）のテスト

Office 文書（.docx、.xlsx、.pptx）は zipfile で最小限の XML を組み立て、PDF は手で組み立てます。
ファイルはすべて一時フォルダー（tmp_path）の中に作ります。
"""

import codecs
import logging
import re
import types
import zipfile

import pytest

from pip0 import analyse_text, rules

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
S_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
MC_NS = "http://schemas.openxmlformats.org/markup-compatibility/2006"
LABEL_GUID = "3a1b2c4d-0000-4f5e-9a8b-1234567890ab"


# ---------------------------------------------------------------------- テスト用の文書を作る


def core_xml(title):
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"'
            ' xmlns:dc="http://purl.org/dc/elements/1.1/">'
            f'<dc:title>{title}</dc:title><dc:creator>pip0 test</dc:creator></cp:coreProperties>')


def custom_xml(properties):
    items = []
    for pid, (name, value) in enumerate(properties, start=2):
        items.append(f'<property fmtid="{{D5CDD505-2E9C-101B-9397-08002B2CF9AE}}" pid="{pid}" name="{name}">'
                     f'<vt:lpwstr>{value}</vt:lpwstr></property>')
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"'
            ' xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
            + "".join(items) + "</Properties>")


def write_zip(path, parts):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types/>')
        for name, data in parts.items():
            archive.writestr(name, data.encode("utf-8") if isinstance(data, str) else data)
    return path


def word_body(paragraphs):
    xml = "".join(f"<w:p><w:r><w:t>{text}</w:t></w:r></w:p>" for text in paragraphs)
    return (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<w:document xmlns:w="{W_NS}"><w:body>{xml}</w:body></w:document>')


def make_docx(path, paragraphs, title=None, chart=False, custom=None, body=None):
    parts = {"word/document.xml": body if body is not None else word_body(paragraphs)}
    if title is not None:
        parts["docProps/core.xml"] = core_xml(title)
    if chart:
        parts["word/charts/chart1.xml"] = "<c:chartSpace xmlns:c='urn:c'/>"
    if custom is not None:
        parts["docProps/custom.xml"] = custom_xml(custom)
    return write_zip(path, parts)


def make_xlsx(path, shared_xml=None, sheets=None, title=None, chart=False):
    parts = {}
    if shared_xml is not None:
        parts["xl/sharedStrings.xml"] = (f'<?xml version="1.0" encoding="UTF-8"?><sst xmlns="{S_NS}">'
                                         f"{shared_xml}</sst>")
    for number, cells in (sheets or {}).items():
        parts[f"xl/worksheets/sheet{number}.xml"] = (f'<?xml version="1.0" encoding="UTF-8"?>'
                                                     f'<worksheet xmlns="{S_NS}"><sheetData><row r="1">'
                                                     f"{cells}</row></sheetData></worksheet>")
    if title is not None:
        parts["docProps/core.xml"] = core_xml(title)
    if chart:
        parts["xl/charts/chart1.xml"] = "<c:chartSpace xmlns:c='urn:c'/>"
    return write_zip(path, parts)


def slide_xml(texts):
    paragraphs = "".join(f"<a:p><a:r><a:t>{text}</a:t></a:r></a:p>" for text in texts)
    return (f'<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="{P_NS}" xmlns:a="{A_NS}"><p:cSld><p:spTree>'
            f"<p:sp><p:txBody>{paragraphs}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>")


def make_pptx(path, slides, title=None, chart=False):
    parts = {f"ppt/slides/slide{number}.xml": slide_xml(texts) for number, texts in slides.items()}
    if title is not None:
        parts["docProps/core.xml"] = core_xml(title)
    if chart:
        parts["ppt/charts/chart1.xml"] = "<c:chartSpace xmlns:c='urn:c'/>"
    return write_zip(path, parts)


def pdf_text_string(text):
    """PDF の文字列（日本語は UTF-16BE の16進数で書く）"""
    return "<FEFF" + text.encode("utf-16-be").hex().upper() + ">"


def build_pdf(page_texts, info=None):
    """小さな PDF を手で組み立てる（本文は Helvetica の ASCII、xref の位置も計算する）"""
    objects = {1: b"<< /Type /Catalog /Pages 2 0 R >>"}
    page_ids = [4 + 2 * index for index in range(len(page_texts))]
    kids = " ".join(f"{page_id} 0 R" for page_id in page_ids)
    objects[2] = f"<< /Type /Pages /Kids [{kids}] /Count {len(page_texts)} >>".encode()
    objects[3] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    for page_id, text in zip(page_ids, page_texts):
        stream = f"BT /F1 24 Tf 72 720 Td ({text}) Tj ET".encode("ascii")
        objects[page_id] = (f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
                            f"/Resources << /Font << /F1 3 0 R >> >> /Contents {page_id + 1} 0 R >>").encode()
        objects[page_id + 1] = (f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream")
    info_id = None
    if info is not None:
        info_id = max(objects) + 1
        objects[info_id] = info.encode("ascii")
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = {}
    for number in sorted(objects):
        offsets[number] = len(out)
        out += f"{number} 0 obj\n".encode() + objects[number] + b"\nendobj\n"
    xref_at = len(out)
    size = max(objects) + 1
    out += f"xref\n0 {size}\n0000000000 65535 f \n".encode()
    for number in range(1, size):
        out += f"{offsets[number]:010d} 00000 n \n".encode()
    trailer = f"trailer\n<< /Size {size} /Root 1 0 R" + (f" /Info {info_id} 0 R" if info_id else "") + " >>\n"
    out += trailer.encode() + f"startxref\n{xref_at}\n%%EOF\n".encode()
    return bytes(out)


def extract(path, platform, config):
    return analyse_text.extract_text(path, platform, config, rules)


# ---------------------------------------------------------------------- Word


def test_docx_text_title_and_paragraphs(env, platform, tmp_path):
    path = make_docx(tmp_path / "file_0001.docx", ["2026年度 予算案", "部門別の内訳"], title="2026年度 予算案（確定版）")
    result = extract(path, platform, env)
    assert result["status"] == "done"
    assert result["kind"] == "document"
    assert result["title"] == "2026年度 予算案（確定版）"
    assert result["text"] == "2026年度 予算案\n部門別の内訳"
    assert result["has_chart"] is False
    assert result["labels"] == []
    assert result["error"] is None


def test_docx_runs_are_joined_and_alternate_content_is_read_once(env, platform, tmp_path):
    body = (f'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="{W_NS}" xmlns:mc="{MC_NS}"><w:body>'
            "<w:p><w:r><w:t>予</w:t></w:r><w:r><w:t>算</w:t></w:r><w:r><w:br/><w:t>案</w:t></w:r></w:p>"
            "<w:p><w:r><mc:AlternateContent><mc:Choice Requires='wps'><w:t>図形の文字</w:t></mc:Choice>"
            "<mc:Fallback><w:t>図形の文字</w:t></mc:Fallback></mc:AlternateContent></w:r></w:p>"
            "<w:p><w:r><w:delText>削除済み</w:delText><w:instrText>PAGE</w:instrText></w:r></w:p>"
            "</w:body></w:document>")
    path = make_docx(tmp_path / "a.docx", None, body=body)
    result = extract(path, platform, env)
    assert result["status"] == "done"
    assert result["text"] == "予算\n案\n図形の文字"
    assert result["text"].count("図形の文字") == 1


def test_office_charts_are_detected(env, platform, tmp_path):
    assert extract(make_docx(tmp_path / "g.docx", ["本文"], chart=True), platform, env)["has_chart"] is True
    assert extract(make_xlsx(tmp_path / "g.xlsx", "<si><t>売上</t></si>", chart=True), platform, env)["has_chart"]
    assert extract(make_pptx(tmp_path / "g.pptx", {1: ["推移"]}, chart=True), platform, env)["has_chart"] is True
    assert extract(make_pptx(tmp_path / "n.pptx", {1: ["推移"]}), platform, env)["has_chart"] is False


def test_sensitivity_label_names_are_read_from_custom_properties(env, platform, tmp_path):
    custom = [
        (f"MSIP_Label_{LABEL_GUID}_Enabled", "true"),
        (f"MSIP_Label_{LABEL_GUID}_Name", "Confidential"),
        (f"MSIP_Label_{LABEL_GUID}_SiteId", "0000"),
        ("MSIP_Label_not-a-guid_Name_x", "Public"),
        ("Project", "予算"),
    ]
    result = extract(make_docx(tmp_path / "l.docx", ["本文"], custom=custom), platform, env)
    assert result["labels"] == ["Confidential"]


# ---------------------------------------------------------------------- Excel と PowerPoint


def test_xlsx_shared_strings_skip_phonetic_readings(env, platform, tmp_path):
    shared = ("<si><t>2026年度 予算案</t></si>"
              "<si><r><t>部門</t></r><r><t>別</t></r><rPh sb='0' eb='2'><t>ブモン</t></rPh></si>"
              "<si><t>経費</t><rPh sb='0' eb='2'><t>ケイヒ</t></rPh></si>")
    path = make_xlsx(tmp_path / "budget.xlsx", shared, title="予算表")
    result = extract(path, platform, env)
    assert result["status"] == "done"
    assert result["kind"] == "spreadsheet"
    assert result["title"] == "予算表"
    assert result["text"] == "2026年度 予算案\n部門別\n経費"
    assert "ブモン" not in result["text"] and "ケイヒ" not in result["text"]


def test_xlsx_inline_strings_in_sheets(env, platform, tmp_path):
    sheets = {
        1: '<c r="A1" t="inlineStr"><is><t>見積</t></is></c><c r="B1"><v>12000</v></c>',
        2: '<c r="A1"><v>3</v></c>',  # 数値だけのシート
    }
    result = extract(make_xlsx(tmp_path / "inline.xlsx", sheets=sheets), platform, env)
    assert result["status"] == "done"
    assert result["text"] == "見積"


def test_pptx_slides_are_read_in_number_order(env, platform, tmp_path):
    slides = {10: ["十枚目"], 2: ["二枚目"], 1: ["2026年度 予算案", "概要"]}
    result = extract(make_pptx(tmp_path / "deck.pptx", slides, title="予算説明"), platform, env)
    assert result["status"] == "done"
    assert result["kind"] == "slides"
    assert result["title"] == "予算説明"
    assert result["text"] == "2026年度 予算案\n概要\n二枚目\n十枚目"


def test_text_is_cut_to_text_max_chars(env, platform, tmp_path):
    config = dict(env, TEXT_MAX_CHARS=5)
    result = extract(make_docx(tmp_path / "long.docx", ["あいうえおかきくけこ"]), platform, config)
    assert result["text"] == "あいうえお"


# ---------------------------------------------------------------------- 圧縮爆弾と壊れたファイル


def test_part_larger_than_limit_is_refused(env, platform, tmp_path):
    config = dict(env, OFFICE_MAX_XML_BYTES=64 * 1024)
    padding = "<w:p><w:r><w:t>" + "0" * (200 * 1024) + "</w:t></w:r></w:p>"
    body = f'<?xml version="1.0"?><w:document xmlns:w="{W_NS}"><w:body>{padding}</w:body></w:document>'
    path = make_docx(tmp_path / "bomb.docx", None, body=body)
    assert path.stat().st_size < 64 * 1024  # 圧縮すると小さい
    result = extract(path, platform, config)
    assert result["status"] == "failed"
    assert "大きすぎる" in result["error"]
    assert result["text"] is None


def test_total_of_parts_larger_than_limit_is_refused(env, platform, tmp_path):
    config = dict(env, OFFICE_MAX_XML_BYTES=64 * 1024)
    filler = "x" * (60 * 1024)
    slides = {number: [filler] for number in range(1, 7)}  # 1枚は上限未満、合計は上限の4倍を超える
    result = extract(make_pptx(tmp_path / "many.pptx", slides), platform, config)
    assert result["status"] == "failed"
    assert "合計" in result["error"]


def forge_declared_size(path, member, new_size):
    """ZIP の中の member の「展開後の大きさ」を new_size に書き換える（中央ディレクトリとローカルヘッダーの両方）"""
    raw = bytearray(path.read_bytes())
    name = member.encode("ascii")
    index = raw.find(b"PK\x01\x02")
    while index >= 0:
        name_length = int.from_bytes(raw[index + 28:index + 30], "little")
        if raw[index + 46:index + 46 + name_length] == name:
            raw[index + 24:index + 28] = new_size.to_bytes(4, "little")
            local = int.from_bytes(raw[index + 42:index + 46], "little")
            raw[local + 22:local + 26] = new_size.to_bytes(4, "little")
        index = raw.find(b"PK\x01\x02", index + 4)
    path.write_bytes(bytes(raw))


def test_zip_never_inflates_more_than_the_declared_size(env, platform, tmp_path):
    path = make_docx(tmp_path / "forged.docx", ["予算" * 2000])
    forge_declared_size(path, "word/document.xml", 100)  # 実際は約 12KB。上限の確認を「すり抜ける」大きさ
    with zipfile.ZipFile(path) as archive:
        assert archive.getinfo("word/document.xml").file_size == 100
    result = extract(path, platform, env)
    assert result["status"] == "failed"  # 書かれた大きさで止め、壊れたファイルとして扱う
    assert result["text"] is None


def test_doctype_and_entities_are_refused(env, platform, tmp_path):
    body = (f'<?xml version="1.0"?><!DOCTYPE w:document [<!ENTITY a "予算予算予算">]>'
            f'<w:document xmlns:w="{W_NS}"><w:body><w:p><w:r><w:t>&a;</w:t></w:r></w:p></w:body></w:document>')
    result = extract(make_docx(tmp_path / "dtd.docx", None, body=body), platform, env)
    assert result["status"] == "failed"
    assert "DOCTYPE" in result["error"]
    utf16 = body.replace('encoding="UTF-8"', "").encode("utf-16")
    result = extract(make_docx(tmp_path / "dtd16.docx", None, body=utf16), platform, env)
    assert result["status"] == "failed"


@pytest.mark.parametrize("data", [b"", b"PK\x03\x04 not really a zip", b"\xd0\xcf\x11\xe0" + b"\x00" * 600])
def test_corrupt_office_files_fail_without_exceptions(env, platform, tmp_path, data):
    path = tmp_path / "broken.docx"
    path.write_bytes(data)
    result = extract(path, platform, env)
    assert result["status"] == "failed"
    assert result["error"] and result["text"] is None


def test_truncated_and_incomplete_office_files_fail(env, platform, tmp_path):
    full = make_docx(tmp_path / "full.docx", ["予算" * 500], title="予算").read_bytes()
    truncated = tmp_path / "cut.docx"
    truncated.write_bytes(full[: len(full) // 2])
    assert extract(truncated, platform, env)["status"] == "failed"
    no_body = write_zip(tmp_path / "nobody.docx", {"docProps/core.xml": core_xml("題")})
    result = extract(no_body, platform, env)
    assert result["status"] == "failed"
    assert "word/document.xml" in result["error"]
    bad_xml = make_docx(tmp_path / "badxml.docx", None, body="<w:document><w:body><w:p>")
    assert extract(bad_xml, platform, env)["status"] == "failed"


# ---------------------------------------------------------------------- テキストファイル


@pytest.mark.parametrize("encoding", ["utf-8", "utf-8-sig", "utf-16", "utf-16-le-bom", "utf-16-be-bom", "cp932"])
def test_plain_text_encodings(env, platform, tmp_path, encoding):
    text = "2026年度 予算案\r\n経費：１２０万円\r\n"
    if encoding == "utf-16-le-bom":
        data = codecs.BOM_UTF16_LE + text.encode("utf-16-le")
    elif encoding == "utf-16-be-bom":
        data = codecs.BOM_UTF16_BE + text.encode("utf-16-be")
    else:
        data = text.encode(encoding)
    path = tmp_path / "memo.txt"
    path.write_bytes(data)
    result = extract(path, platform, env)
    assert result["status"] == "done"
    assert result["kind"] == "text"
    assert result["text"] == "2026年度 予算案\n経費：１２０万円"
    assert result["title"] is None and result["has_chart"] is None and result["labels"] is None


def test_csv_is_a_spreadsheet_read_as_text(env, platform, tmp_path):
    path = tmp_path / "list.csv"
    path.write_bytes("項目,金額\n予算,100\n".encode("cp932"))
    result = extract(path, platform, env)
    assert result["status"] == "done"
    assert result["kind"] == "spreadsheet"
    assert "予算,100" in result["text"]


def test_long_cp932_text_is_cut_inside_a_character_without_errors(env, platform, tmp_path):
    config = dict(env, TEXT_MAX_CHARS=7)
    path = tmp_path / "long.txt"
    path.write_bytes(("予算" * 100).encode("cp932"))  # 4 × 7 = 28 バイトだけ読む（文字の途中では切らない）
    result = extract(path, platform, config)
    assert result["status"] == "done"
    assert result["text"] == "予算予算予算予"


def test_binary_data_in_a_text_file_fails(env, platform, tmp_path):
    path = tmp_path / "not_text.txt"
    path.write_bytes(b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR")
    result = extract(path, platform, env)
    assert result["status"] == "failed"
    assert "文字コード" in result["error"]


def test_control_characters_are_removed(env, platform, tmp_path):
    path = tmp_path / "ctrl.md"
    path.write_text("# 予算\x07\n\n\n﻿本文​ です  \n", encoding="utf-8")
    assert extract(path, platform, env)["text"] == "# 予算\n本文 です"


# ---------------------------------------------------------------------- PDF


def test_pdf_title_from_metadata_and_ascii_text(env, platform, tmp_path):
    path = tmp_path / "scan_0001.pdf"
    path.write_bytes(build_pdf(["Budget plan 2026"], info=f"<< /Title {pdf_text_string('2026年度 予算案')} >>"))
    result = extract(path, platform, env)
    assert result["status"] == "done"
    assert result["kind"] == "pdf"
    assert result["title"] == "2026年度 予算案"
    assert "Budget plan 2026" in result["text"]
    assert result["has_chart"] is None and result["labels"] is None


def test_pdf_pages_are_limited(env, platform, tmp_path):
    path = tmp_path / "pages.pdf"
    path.write_bytes(build_pdf(["Page one", "Page two", "Page three"]))
    result = extract(path, platform, dict(env, PDF_MAX_PAGES=2))
    assert "Page one" in result["text"] and "Page two" in result["text"]
    assert "Page three" not in result["text"]
    assert result["title"] is None


def test_pdf_title_printed_from_word_is_tidied(env, platform, tmp_path):
    path = tmp_path / "print.pdf"
    path.write_bytes(build_pdf(["x"], info=f"<< /Title {pdf_text_string('Microsoft Word - 予算案.docx')} >>"))
    assert extract(path, platform, env)["title"] == "予算案"


def test_corrupt_pdf_fails_without_exceptions(env, platform, tmp_path):
    path = tmp_path / "broken.pdf"
    path.write_bytes(b"%PDF-1.4\nthis is not a pdf\n")
    result = extract(path, platform, env)
    assert result["status"] == "failed"
    assert result["error"].startswith("PDF を読めませんでした")


def test_pdf_library_warnings_do_not_reach_the_logs(env, platform, tmp_path, caplog):
    caplog.set_level(logging.DEBUG)
    # xref の位置をずらした PDF：pypdf は「Ignoring wrong pointing object …」などの警告を出しながら読み直す
    shifted = re.sub(rb"(\d{10}) 00000 n", lambda m: b"%010d 00000 n" % (int(m.group(1)) + 3),
                     build_pdf(["SECRET MARKER TEXT"]))
    path = tmp_path / "secret_marker_name.pdf"
    path.write_bytes(shifted)
    assert extract(path, platform, env)["status"] == "done"
    no_eof = tmp_path / "no_eof.pdf"
    no_eof.write_bytes(b"%PDF-1.4\n(SECRET MARKER TEXT)\n")  # pypdf は「EOF marker not found」を出す
    assert extract(no_eof, platform, env)["status"] == "failed"
    assert not [record for record in caplog.records if record.name.startswith("pypdf")]
    assert "SECRET" not in caplog.text and "secret_marker_name" not in caplog.text


# ---------------------------------------------------------------------- 対象外と開き方


@pytest.mark.parametrize("name, kind", [("old.doc", "document"), ("old.xls", "spreadsheet"), ("a.zip", "other"),
                                        ("noext", "other")])
def test_unsupported_formats(env, platform, tmp_path, name, kind):
    path = tmp_path / name
    path.write_bytes(b"data")
    result = extract(path, platform, env)
    assert result["status"] == "unsupported"
    assert result["kind"] == kind
    assert result["error"]


def test_files_are_opened_through_the_platform(env, platform, tmp_path):
    path = make_docx(tmp_path / "a.docx", ["予算"])
    opened = []
    original = platform.open_for_analysis

    def recording_open(target):
        opened.append(str(target))
        return original(target)

    platform.open_for_analysis = recording_open
    assert extract(path, platform, env)["status"] == "done"
    assert opened == [str(path)]
    platform.fail_next["open_for_analysis"] = PermissionError("使用中")
    platform.open_for_analysis = original
    result = extract(path, platform, env)
    assert result["status"] == "failed"
    assert "PermissionError" in result["error"]


# ---------------------------------------------------------------------- 3秒の間の軽い読み取り


def test_light_metadata_reads_office_core_title(env, platform, tmp_path):
    path = make_docx(tmp_path / "file_0001.docx", ["本文"], title="2026年度 予算案")
    result = analyse_text.light_metadata(path, platform, env, rules)
    assert result == {"status": "done", "title": "2026年度 予算案", "kind": "document",
                      "source": "office_core", "reason": ""}


def test_light_metadata_reads_pdf_info_title(env, platform, tmp_path):
    path = tmp_path / "doc.pdf"
    path.write_bytes(build_pdf(["x"], info=f"<< /Title {pdf_text_string('会議資料')} >>"))
    result = analyse_text.light_metadata(path, platform, env, rules)
    assert result["status"] == "done"
    assert result["title"] == "会議資料"
    assert result["source"] == "pdf_info"
    assert result["kind"] == "pdf"


def test_light_metadata_without_title(env, platform, tmp_path):
    path = make_docx(tmp_path / "plain.docx", ["本文"])
    result = analyse_text.light_metadata(path, platform, env, rules)
    assert result["status"] == "done"
    assert result["title"] is None and result["source"] is None
    assert result["reason"]


def test_light_metadata_skips_large_files_and_other_formats(env, platform, tmp_path):
    path = make_docx(tmp_path / "big.docx", ["本文" * 1000], title="大きい")
    small_limit = dict(env, LIGHT_METADATA_MAX_BYTES=100)
    result = analyse_text.light_metadata(path, platform, small_limit, rules)
    assert result["status"] == "skipped"
    assert result["title"] is None and "大きい" in result["reason"]
    image = tmp_path / "IMG_0001.png"
    image.write_bytes(b"\x89PNG")
    result = analyse_text.light_metadata(image, platform, env, rules)
    assert result["status"] == "skipped" and result["kind"] == "image"


def test_light_metadata_does_not_read_ghosts(env, platform, tmp_path):
    path = make_docx(tmp_path / "ghost.docx", ["本文"], title="題")
    platform.not_local.add(str(path))
    opened = []
    platform.open_for_analysis = lambda target: opened.append(target)
    result = analyse_text.light_metadata(path, platform, env, rules)
    assert result["status"] == "skipped"
    assert opened == []


def test_light_metadata_reports_failures(env, platform, tmp_path):
    path = tmp_path / "broken.pptx"
    path.write_bytes(b"not a zip")
    result = analyse_text.light_metadata(path, platform, env, rules)
    assert result["status"] == "failed"
    assert result["reason"]
    missing = analyse_text.light_metadata(tmp_path / "missing.pdf", platform, env, rules)
    assert missing["status"] == "failed"


def test_rules_are_received_as_a_parameter(env, platform, tmp_path):
    custom_rules = types.SimpleNamespace(FILE_KINDS={".docx": "report"})
    path = make_docx(tmp_path / "a.docx", ["本文"])
    assert analyse_text.extract_text(path, platform, env, custom_rules)["kind"] == "report"
