"""画像の色と形の解析（analyse_image.py）のテスト

グラフ・写真・文書の画面の画像を、Pillow でその場で作って確かめます（tmp_path の中だけを使います）。
"""

import random
import struct
import zlib

import pytest
from PIL import Image, ImageDraw

from pip0 import analyse_image, rules

BLUE = (31, 119, 180)
RED = (214, 39, 40)


# ---------------------------------------------------------------------- テスト用の画像を作る


def bar_chart(colour, size=(640, 480)):
    """白い背景に、軸と5本の棒と目盛りの文字がある棒グラフ"""
    width, height = size
    image = Image.new("RGB", size, (255, 255, 255))
    draw = ImageDraw.Draw(image)
    left, bottom, top, right = 70, height - 60, 50, width - 30
    slot = (right - left) / 5
    for index, share in enumerate([0.55, 0.8, 0.35, 0.95, 0.65]):
        x0 = left + index * slot + slot * 0.2
        x1 = left + (index + 1) * slot - slot * 0.2
        draw.rectangle([x0, bottom - share * (bottom - top), x1, bottom - 1], fill=colour)
        draw.text((x0 + 5, bottom + 10), f"Q{index + 1}", fill=(0, 0, 0))
    draw.line([(left, top - 10), (left, bottom)], fill=(0, 0, 0), width=2)
    draw.line([(left, bottom), (right, bottom)], fill=(0, 0, 0), width=2)
    for step in range(5):
        draw.text((20, bottom - step * (bottom - top) / 4 - 6), str(step * 25), fill=(0, 0, 0))
    draw.text((width // 2 - 60, 15), "2026 budget", fill=(0, 0, 0))
    return image


def photo_like(size=(480, 360), seed=1):
    """写真のような画像：なめらかな空のグラデーション（大部分）と地面に、細かいむら（ノイズ）を足したもの"""
    rnd = random.Random(seed)
    width, height = size
    image = Image.new("RGB", size)
    pixels = image.load()
    horizon = int(height * 0.7)
    for y in range(height):
        for x in range(width):
            if y < horizon:
                t = y / horizon
                base = (60 + 110 * t, 120 + 90 * t, 200 + 40 * t)
            else:
                t = (y - horizon) / (height - horizon)
                base = (70 + 40 * t, 110 - 30 * t, 40 + 10 * t)
            noise = rnd.randint(-18, 18)
            pixels[x, y] = tuple(max(0, min(255, int(c) + noise + rnd.randint(-6, 6))) for c in base)
    return image


def document_screenshot(size=(800, 1000)):
    """白い背景に黒い文字が並ぶ、文書の画面"""
    rnd = random.Random(3)
    image = Image.new("RGB", size, (255, 255, 255))
    draw = ImageDraw.Draw(image)
    words = "the budget plan for next year includes new equipment staff training and travel".split()
    draw.text((60, 40), "Annual report 2026", fill=(0, 0, 0))
    for y in range(80, size[1] - 60, 18):
        draw.text((60, y), " ".join(rnd.choice(words) for _ in range(12)), fill=(0, 0, 0))
    return image


def save(image, path, **options):
    image.save(path, **options)
    return path


def analyse(path, platform, config):
    return analyse_image.analyse_image(path, platform, config)


def png_header_only(path, width, height):
    """画像の大きさだけを書いた PNG（中身は空）。圧縮爆弾の確認に使う"""
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(b""))
                     + chunk(b"IEND", b""))
    return path


# ---------------------------------------------------------------------- 色の名前


@pytest.mark.parametrize("colour, name", [
    ((255, 0, 0), "red"), ((255, 128, 0), "orange"), ((255, 230, 0), "yellow"), ((0, 200, 0), "green"),
    ((0, 220, 220), "cyan"), ((0, 0, 255), "blue"), ((31, 119, 180), "blue"), ((140, 0, 255), "purple"),
    ((255, 0, 200), "pink"), ((255, 0, 50), "red"), ((214, 39, 40), "red"),
])
def test_colour_names_follow_the_hue_ranges(colour, name):
    assert analyse_image.colour_name(colour) == name


@pytest.mark.parametrize("colour", [(255, 255, 255), (250, 248, 240), (128, 128, 128), (100, 110, 125),
                                    (0, 0, 0), (30, 10, 45)])
def test_white_grey_and_black_are_neutral(colour):
    assert analyse_image.colour_name(colour) is None


def test_colour_names_match_the_search_rules():
    assert analyse_image.COLOUR_NAMES == ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"]
    assert set(rules.COLOUR_WORDS.values()) <= set(analyse_image.COLOUR_NAMES)
    assert set(rules.COLOUR_GROUPS) <= set(analyse_image.COLOUR_NAMES)


# ---------------------------------------------------------------------- グラフ・写真・文書


def test_blue_bar_chart(env, platform, tmp_path):
    result = analyse(save(bar_chart(BLUE), tmp_path / "chart.png"), platform, env)
    assert result["status"] == "done"
    assert result["width"] == 640 and result["height"] == 480
    assert result["chart_score"] >= 0.6
    assert result["visual_kind"] == "chart"
    assert result["colours"]["blue"] >= 0.35
    assert result["colourful_ratio"] >= env["COLOUR_MIN_COLOURFUL"]
    assert set(result["colours"]) == set(analyse_image.COLOUR_NAMES)
    assert any(text.startswith("背景が単色（") for text in result["chart_evidence"])
    assert any(text.startswith("色数が少ない（") for text in result["chart_evidence"])
    assert "縦横の長い線（軸）を検出" in result["chart_evidence"]
    assert "単色の長方形（棒）を5個検出" in result["chart_evidence"]
    assert result["error"] is None


def test_red_bar_chart(env, platform, tmp_path):
    result = analyse(save(bar_chart(RED), tmp_path / "chart.png"), platform, env)
    assert result["chart_score"] >= 0.6
    assert result["visual_kind"] == "chart"
    assert result["colours"]["red"] >= 0.35
    assert result["colours"]["blue"] < 0.35


def test_jpeg_bar_chart_keeps_its_colour_and_shape(env, platform, tmp_path):
    result = analyse(save(bar_chart(BLUE), tmp_path / "chart.jpg", quality=80), platform, env)
    assert result["visual_kind"] == "chart"
    assert result["colours"]["blue"] >= 0.35


def test_large_chart_is_reduced_before_analysis(env, platform, tmp_path):
    result = analyse(save(bar_chart(BLUE, size=(1600, 1200)), tmp_path / "big.png"), platform, env)
    assert result["width"] == 1600 and result["height"] == 1200  # 元の大きさを返す
    assert result["visual_kind"] == "chart"
    assert result["colours"]["blue"] >= 0.35


def test_photo_like_image_is_not_a_chart(env, platform, tmp_path):
    result = analyse(save(photo_like(), tmp_path / "photo.png"), platform, env)
    assert result["status"] == "done"
    assert result["chart_score"] < 0.6
    assert result["visual_kind"] == "photo"
    assert result["colourful_ratio"] > 0.9
    assert result["colours"]["blue"] + result["colours"]["cyan"] > 0.5  # 大部分は空


def test_document_screenshot_is_not_a_coloured_chart(env, platform, tmp_path):
    result = analyse(save(document_screenshot(), tmp_path / "Screenshot 2026-10-29.png"), platform, env)
    assert result["status"] == "done"
    assert result["visual_kind"] != "chart"
    assert result["chart_score"] < 0.6
    # 色付きの部分がほとんどないので、検索で「青い」等の色には一致しない（search は COLOUR_MIN_COLOURFUL 未満を見ない）
    assert result["colourful_ratio"] < env["COLOUR_MIN_COLOURFUL"]


def test_transparent_background_is_composited_onto_white(env, platform, tmp_path):
    image = bar_chart(BLUE).convert("RGBA")
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            if pixels[x, y][:3] == (255, 255, 255):
                pixels[x, y] = (0, 0, 0, 0)  # 白い部分を「透明な黒」にする
    result = analyse(save(image, tmp_path / "transparent.png"), platform, env)
    assert result["visual_kind"] == "chart"
    assert result["background_ratio"] > 0.6  # 透明な部分は黒ではなく白として数える


def test_only_the_first_frame_is_analysed(env, platform, tmp_path):
    first = Image.new("RGB", (120, 90), RED)
    second = Image.new("RGB", (120, 90), BLUE)
    path = tmp_path / "anim.gif"
    first.save(path, save_all=True, append_images=[second], duration=100, loop=0)
    result = analyse(path, platform, env)
    assert result["status"] == "done"
    assert result["colours"]["red"] > 0.9
    assert result["colours"]["blue"] < 0.1


def test_blank_image_has_no_colours(env, platform, tmp_path):
    result = analyse(save(Image.new("L", (50, 40), 255), tmp_path / "blank.bmp"), platform, env)
    assert result["status"] == "done"
    assert result["colourful_ratio"] == 0
    assert all(share == 0 for share in result["colours"].values())
    assert result["visual_kind"] != "chart"


# ---------------------------------------------------------------------- 壊れた画像と圧縮爆弾


def test_corrupt_and_truncated_images_fail(env, platform, tmp_path):
    broken = tmp_path / "broken.png"
    broken.write_bytes(b"\x89PNG\r\n\x1a\nnot an image at all")
    result = analyse(broken, platform, env)
    assert result["status"] == "failed"
    assert result["error"].startswith("画像を読めませんでした")
    data = save(bar_chart(BLUE), tmp_path / "full.png").read_bytes()
    truncated = tmp_path / "truncated.png"
    truncated.write_bytes(data[: len(data) // 2])
    assert analyse(truncated, platform, env)["status"] == "failed"


def test_decompression_bomb_is_refused(env, platform, tmp_path):
    path = png_header_only(tmp_path / "bomb.png", 20000, 20000)  # 4億画素（Pillow の上限の2倍を超える）
    result = analyse(path, platform, env)
    assert result["status"] == "failed"
    assert "圧縮爆弾" in result["error"]


def test_very_large_image_is_refused_before_decoding(env, platform, tmp_path):
    path = png_header_only(tmp_path / "huge.png", 10000, 10000)  # 1億画素（Pillow は警告だけ出す大きさ）
    with pytest.warns(Image.DecompressionBombWarning):
        result = analyse(path, platform, env)
    assert result["status"] == "failed"
    assert "大きすぎる" in result["error"]


def test_images_are_opened_through_the_platform(env, platform, tmp_path):
    path = save(bar_chart(BLUE), tmp_path / "chart.png")
    platform.fail_next["open_for_analysis"] = PermissionError("使用中")
    result = analyse(path, platform, env)
    assert result["status"] == "failed"
    assert "PermissionError" in result["error"]


def test_analysis_size_comes_from_config(env, platform, tmp_path):
    path = save(bar_chart(BLUE), tmp_path / "chart.png")
    small = analyse_image.load_small_image(path, platform, 64)
    assert max(small["image"].size) == 64
    result = analyse(path, platform, dict(env, IMAGE_ANALYSE_PIXELS=128))
    assert result["visual_kind"] == "chart"
