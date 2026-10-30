"""画像の色と形を調べる（ローカル解析）

「青いグラフ」のような検索（M3）と、改名の「内容」（M1）のために、画像から次の値を計算します。
Pillow と標準ライブラリだけを使い、機械学習のモデルは使いません（すべてこの PC の中で計算します）。

手順：
1. platform.open_for_analysis() で開き、最初のコマ（アニメーションなら1枚目）を読む
2. 透明な部分を白の上に重ね、長い辺が IMAGE_ANALYSE_PIXELS（256）画素になるよう縮小する
3. 画素を「色なし」（白・灰色・黒に近い）と「色付き」に分け、色付きの画素を色相で8色に分ける
4. グラフらしさ（chart_score、0〜1）を、4つの手掛かりの重み付きの合計で計算する

    手掛かり（重み）                      グラフのとき          写真のとき
    背景が単色（0.2）                     白などが大部分        いろいろな色
    色数が少ない（0.2）                   数色                  数百色
    縦横の長い線（0.15）                  軸、枠、目盛りの線    ほとんどない
    データの印（0.45）                    単色の棒・扇形、      なめらかな変化と細かいむら
                                          色付きの折れ線

色の名前と色相（0〜360度）の範囲：
    赤 red 345〜15、橙 orange 15〜45、黄 yellow 45〜70、緑 green 70〜165、
    水色 cyan 165〜200、青 blue 200〜255、紫 purple 255〜290、ピンク pink 290〜345

できないこと：写っている物の認識（「犬の写真」など）。アプリの画面のスクリーンショットや表は、
単色の背景、線、色の付いた領域があるため、グラフと見分けにくいことがあります。
"""

import colorsys

from PIL import Image

# 色の名前（rules.COLOUR_WORDS の値と同じ名前）
COLOUR_NAMES = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"]

# 色相（度）の範囲 → 色の名前。赤は 345〜360 と 0〜15 の2つに分かれる
HUE_RANGES = [
    (0, 15, "red"), (15, 45, "orange"), (45, 70, "yellow"), (70, 165, "green"),
    (165, 200, "cyan"), (200, 255, "blue"), (255, 290, "purple"), (290, 345, "pink"), (345, 360, "red"),
]

# --- 色なし・色付きの分け方 ---
NEUTRAL_MAX_CHROMA = 40  # ★ 最も強い色成分と最も弱い色成分の差がこれ未満なら、白・灰色（色なし）
NEAR_BLACK_MAX = 50      # ★ 最も強い色成分がこれ未満なら、黒に近い（色なし）
QUANTISE_STEP = 16       # 色数を数えるとき、各成分（0〜255）を何ずつまとめるか
PALETTE_COVERAGE = 0.95  # 画素のこの割合を覆うのに必要な色の数を「色数」とする

# --- 長い線（軸、枠、目盛りの線） ---
INK_MIN_DISTANCE = 60     # 背景の色との違い（R、G、B の差の合計）がこれより大きい画素を「描かれた画素」とする
RUN_STEP_DISTANCE = 30    # 隣の画素との違いがこれ以下なら「滑らかにつながっている」
RUN_MIN_SMOOTH = 0.8      # 線の中の隣どうしの組の、この割合以上が滑らかなら線（縮小した文字の並びは変化が大きい）
LINE_MIN_FRACTION = 0.4   # ★ 画像の幅（高さ）のこの割合以上続けば「長い線」
LINE_MAX_THICKNESS = 3    # この画素数より太いものは、線ではなく面とみなす

# --- 単色の領域（棒グラフの棒、円グラフの扇形） ---
BLOCK_TOLERANCE = 30      # 最初の画素との違いがこれ以下の、つながった画素を同じ領域とする
BLOCK_EDGE_DISTANCE = 80  # 領域の外へ1〜2画素のうちに、これ以上違う色になれば「くっきりした境目」
BLOCK_MIN_SHARE = 0.002   # 画像のこの割合より小さい領域は数えない
BLOCK_MIN_SIDE = 3        # 幅か高さがこの画素数より小さい領域（細い線）は数えない
BLOCK_MIN_SHARP_EDGE = 0.7  # 境目のこの割合以上がくっきりしていれば、データの印とみなす（グラデーションを除く）
BLOCK_FULL_SHARE = 0.05   # 単色の領域が画像のこの割合以上あれば、この手掛かりは満点
RECTANGLE_MIN_FILL = 0.9  # 領域を囲む長方形のこの割合以上を埋めていれば「長方形（棒）」
# 画像の端に接する領域（アプリの画面の上の帯、写真の空など）は、データの印として数えない

# --- 色付きの細い線（折れ線グラフ）。長い線（軸）があるときだけ数える ---
STROKE_FULL_COLOURFUL = 0.03  # 色付きの画素が画像のこの割合あれば満点
STROKE_MAX_COLOURFUL = 0.25   # 色付きの画素がこれより多い画像（写真など）は、細い線とはみなさない
STROKE_MAX_SCORE = 0.6        # 棒や扇形より弱い手掛かりなので、満点を 0.6 にする

# ★ グラフらしさの重み（合計 1.0）
CHART_WEIGHTS = {"background": 0.2, "palette": 0.2, "lines": 0.15, "marks": 0.45}
# 背景の割合の点：30% 以下で0点、60% 以上で満点
BACKGROUND_ZERO, BACKGROUND_FULL = 0.3, 0.6
# 色数の点：8色以下で満点、24色以上で0点
PALETTE_FULL, PALETTE_ZERO = 8, 24

# ★ 写真とみなす条件：色数がこれ以上で、背景（最も多い色）の割合がこれ以下
PHOTO_MIN_PALETTE = 16
PHOTO_MAX_BACKGROUND = 0.3

# これより画素の多い画像は解析しない（Pillow の圧縮爆弾の既定の上限と同じ、約9,000万画素）
MAX_SOURCE_PIXELS = 89_478_485


def analyse_image(path, platform, config):
    """画像の色の割合とグラフらしさを計算する

    返す辞書：{"status": "done"/"failed", "width", "height", "colours", "colourful_ratio", "background_ratio",
              "palette_size", "chart_score", "chart_evidence", "visual_kind", "error"}
    - colours：色付きの部分のうち、それぞれの色が占める割合 {"blue": 0.62, ...}（8色すべて）
    - colourful_ratio：画像全体のうち、色付きの部分の割合
    - chart_evidence：グラフらしさの根拠（日本語の短い文。数値つき）
    - visual_kind："chart"（グラフ）/"photo"（写真）/"other"
    """
    result = {"status": "failed", "width": None, "height": None, "colours": {}, "colourful_ratio": None,
              "background_ratio": None, "palette_size": None, "chart_score": None, "chart_evidence": [],
              "visual_kind": None, "error": None}
    loaded = load_small_image(path, platform, config["IMAGE_ANALYSE_PIXELS"])
    if loaded["error"] is not None:
        result["error"] = loaded["error"]
        return result

    small = loaded["image"]
    width, height = small.size
    pixels = pixel_list(small)
    colours = measure_colours(small)
    lines = {
        "horizontal": count_thin_lines(rows_of(pixels, width, height), width, colours["background"]),
        "vertical": count_thin_lines(columns_of(pixels, width), height, colours["background"]),
    }
    blocks = find_blocks(pixels, width, height, colours["background"])
    score, evidence = score_chart(colours, lines, blocks, width * height)

    if score >= config["CHART_MIN_SCORE"]:
        visual_kind = "chart"
    elif colours["palette_size"] >= PHOTO_MIN_PALETTE and colours["background_ratio"] <= PHOTO_MAX_BACKGROUND:
        visual_kind = "photo"
    else:
        visual_kind = "other"

    result.update({
        "status": "done",
        "width": loaded["width"],
        "height": loaded["height"],
        "colours": colours["shares"],
        "colourful_ratio": round(colours["colourful_ratio"], 3),
        "background_ratio": round(colours["background_ratio"], 3),
        "palette_size": colours["palette_size"],
        "chart_score": score,
        "chart_evidence": evidence,
        "visual_kind": visual_kind,
    })
    return result


# ----------------------------------------------------------------------
# 読み込みと縮小
# ----------------------------------------------------------------------


def load_small_image(path, platform, longest_side):
    """画像の最初のコマを、白の上に重ねた RGB の小さな画像にする

    返す辞書：{"error": None, "image", "width", "height"}（width と height は元の大きさ）、
    読めないときは {"error": "日本語の理由"}
    """
    try:
        with platform.open_for_analysis(path) as f:
            with Image.open(f) as image:  # ここでは大きさなどの情報だけを読む
                width, height = image.size
                if width * height > MAX_SOURCE_PIXELS:
                    return {"error": f"画像が大きすぎるため、解析しません（{width}×{height}画素）"}
                image.seek(0)  # 最初のコマ
                image.draft("RGB", (longest_side, longest_side))  # JPEG なら、縮小しながら読む（速い）
                small = flatten_onto_white(image)
        small.thumbnail((longest_side, longest_side), Image.Resampling.BOX)  # 画素の平均で縮小する
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):  # 警告をエラーにする設定のときは警告も届く
        return {"error": "画像が大きすぎるため、解析しません（圧縮爆弾の疑い）"}
    except Exception as error:  # Pillow は壊れた画像で、さまざまな種類の例外を出すため、まとめて受け止める
        return {"error": f"画像を読めませんでした（{type(error).__name__}）"}
    return {"error": None, "image": small, "width": width, "height": height}


def flatten_onto_white(image):
    """透明な部分を白の上に重ねて、RGB（透明なし）の画像にする"""
    has_alpha = image.mode in ("RGBA", "LA", "PA", "RGBa", "La") or "transparency" in image.info
    if not has_alpha:
        return image.convert("RGB")
    rgba = image.convert("RGBA")
    white = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    return Image.alpha_composite(white, rgba).convert("RGB")


def pixel_list(image):
    """RGB の画像の画素を、左上から右へ、上から下への順に (R, G, B) のリストにする"""
    data = image.tobytes()
    return [(data[i], data[i + 1], data[i + 2]) for i in range(0, len(data), 3)]


def rows_of(pixels, width, height):
    return [pixels[y * width:(y + 1) * width] for y in range(height)]


def columns_of(pixels, width):
    return [pixels[x::width] for x in range(width)]


def distance(a, b):
    """2つの色の違い（R、G、B の差の絶対値の合計。0〜765）"""
    return abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])


def clamp(value):
    """0〜1 の範囲に収める"""
    return max(0.0, min(1.0, value))


# ----------------------------------------------------------------------
# 色
# ----------------------------------------------------------------------


def colour_name(colour):
    """色付きの画素なら色の名前、白・灰色・黒に近い画素なら None"""
    r, g, b = colour
    strongest, weakest = max(colour), min(colour)
    if strongest < NEAR_BLACK_MAX or strongest - weakest < NEUTRAL_MAX_CHROMA:
        return None
    hue = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)[0] * 360
    for start, end, name in HUE_RANGES:
        if start <= hue < end:
            return name
    return "red"


def quantise(colour):
    """近い色を1つにまとめる（色数を数えるため）"""
    return (colour[0] // QUANTISE_STEP, colour[1] // QUANTISE_STEP, colour[2] // QUANTISE_STEP)


def measure_colours(image):
    """色の割合、背景の色と割合、色数を数える

    同じ色の画素はまとめて数えます（Pillow の getcolors。グラフのように色が少ない画像では速い）。
    """
    total = image.width * image.height
    counted = image.getcolors(maxcolors=total)  # [(画素数, (R, G, B)), ...]
    bin_counts = {}    # まとめた色 → 画素数
    most_common = {}   # まとめた色 → (画素数, その中で最も多い実際の色)
    colour_counts = {name: 0 for name in COLOUR_NAMES}
    colourful = 0
    for count, colour in counted:
        key = quantise(colour)
        bin_counts[key] = bin_counts.get(key, 0) + count
        if count > most_common.get(key, (0, None))[0]:
            most_common[key] = (count, colour)
        name = colour_name(colour)
        if name is not None:
            colour_counts[name] += count
            colourful += count

    background_key = max(bin_counts, key=bin_counts.get)
    palette_size = 0
    covered = 0
    for count in sorted(bin_counts.values(), reverse=True):
        palette_size += 1
        covered += count
        if covered >= PALETTE_COVERAGE * total:
            break

    shares = {}
    for name in COLOUR_NAMES:
        shares[name] = round(colour_counts[name] / colourful, 3) if colourful else 0.0
    return {
        "shares": shares,
        "colourful_ratio": colourful / total,
        "background": most_common[background_key][1],
        "background_ratio": bin_counts[background_key] / total,
        "palette_size": palette_size,
    }


# ----------------------------------------------------------------------
# 長い線（軸、枠、目盛りの線）
# ----------------------------------------------------------------------


def longest_run(line, background):
    """1行（または1列）の中で、背景と違う画素が途切れずに続き、色の変化が滑らかな部分の最も長い長さ

    軸の線は、棒と接する所で色が少し変わっても、ほとんどの所で隣と同じ色です。
    縮小した文字の並びも細い帯になりますが、文字と隙間で色が細かく変わるため、線とはみなしません。
    """
    longest = 0
    run = []
    for colour in line + [background]:  # 最後に背景の色を足して、最後の続きも同じ方法で調べる
        if distance(colour, background) > INK_MIN_DISTANCE:
            run.append(colour)
            continue
        if len(run) > longest and is_smooth(run):
            longest = len(run)
        run = []
    return longest


def is_smooth(run):
    """隣どうしの画素の組のうち、色の違いが小さい組が RUN_MIN_SMOOTH 以上なら True"""
    if len(run) < 2:
        return True
    smooth = 0
    for a, b in zip(run, run[1:]):
        if distance(a, b) <= RUN_STEP_DISTANCE:
            smooth += 1
    return smooth >= RUN_MIN_SMOOTH * (len(run) - 1)


def count_thin_lines(lines, length, background):
    """長い線のある行（列）がまとまっている場所を数える

    長い線のある行が LINE_MAX_THICKNESS 行より多く続く場所は、線ではなく面（空、横向きの棒など）とみなします。
    """
    min_length = LINE_MIN_FRACTION * length
    count = 0
    thickness = 0
    for line in lines + [[]]:  # 最後に空の行を足して、最後のまとまりも同じ方法で数える
        if line and longest_run(line, background) >= min_length:
            thickness += 1
            continue
        if 1 <= thickness <= LINE_MAX_THICKNESS:
            count += 1
        thickness = 0
    return count


# ----------------------------------------------------------------------
# 単色の領域（棒、扇形）
# ----------------------------------------------------------------------


def find_blocks(pixels, width, height, background):
    """背景以外の、単色で境目がくっきりした大きな領域を探す"""
    total = width * height
    seen = [False] * total
    blocks = []
    for start in range(total):
        if seen[start] or distance(pixels[start], background) <= BLOCK_TOLERANCE:
            continue
        region = grow_region(pixels, width, height, start, seen)
        if is_block(region, total):
            blocks.append(region)
    return blocks


def grow_region(pixels, width, height, start, seen):
    """start の画素と同じ色（違いが BLOCK_TOLERANCE 以下）で上下左右につながった領域を調べる"""
    seed = pixels[start]
    seen[start] = True
    waiting = [start]
    area = 0
    left, right, top, bottom = width, -1, height, -1
    edges = 0  # 領域の外の画素と接している辺の数
    sharp = 0  # そのうち、色がはっきり違う（BLOCK_EDGE_DISTANCE 以上）辺の数
    while waiting:
        index = waiting.pop()
        x, y = index % width, index // width
        area += 1
        left, right = min(left, x), max(right, x)
        top, bottom = min(top, y), max(bottom, y)
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nx, ny = x + dx, y + dy
            if nx < 0 or ny < 0 or nx >= width or ny >= height:
                continue
            neighbour = ny * width + nx
            if distance(pixels[neighbour], seed) <= BLOCK_TOLERANCE:
                if not seen[neighbour]:
                    seen[neighbour] = True
                    waiting.append(neighbour)
            else:
                edges += 1
                if is_sharp_edge(pixels, width, height, seed, x, y, dx, dy):
                    sharp += 1
    touches_border = left == 0 or top == 0 or right == width - 1 or bottom == height - 1
    return {"area": area, "width": right - left + 1, "height": bottom - top + 1, "edges": edges, "sharp": sharp,
            "touches_border": touches_border}


def is_sharp_edge(pixels, width, height, seed, x, y, dx, dy):
    """領域の端 (x, y) から (dx, dy) の向きへ1〜2画素のうちに、色がはっきり変わるなら True

    縮小した画像では、棒と背景の間に、中間の色の画素が1つ入ることがあるため、2画素先まで見ます。
    なめらかなグラデーション（空など）は、2画素先でも色が少ししか変わりません。
    """
    for step in (1, 2):
        nx, ny = x + dx * step, y + dy * step
        if nx < 0 or ny < 0 or nx >= width or ny >= height:
            return False
        if distance(pixels[ny * width + nx], seed) >= BLOCK_EDGE_DISTANCE:
            return True
    return False


def is_block(region, total):
    """データの印（棒、扇形）とみなせる領域なら True"""
    if region["area"] < BLOCK_MIN_SHARE * total or region["touches_border"]:
        return False
    if region["width"] < BLOCK_MIN_SIDE or region["height"] < BLOCK_MIN_SIDE:
        return False
    if region["edges"] == 0:
        return False  # 周りがすべて似た色（別の領域として数えた所）なら、くっきりした境目はない
    return region["sharp"] / region["edges"] >= BLOCK_MIN_SHARP_EDGE


def is_rectangle(region):
    return region["area"] >= RECTANGLE_MIN_FILL * region["width"] * region["height"]


# ----------------------------------------------------------------------
# グラフらしさ
# ----------------------------------------------------------------------


def score_chart(colours, lines, blocks, total):
    """手掛かりごとの点（0〜1）に重みを掛けて合計し、(グラフらしさ, 根拠のリスト) を返す"""
    evidence = []

    background = clamp((colours["background_ratio"] - BACKGROUND_ZERO) / (BACKGROUND_FULL - BACKGROUND_ZERO))
    if background >= 0.5:
        evidence.append(f"背景が単色（{percent(colours['background_ratio'])}%）")

    palette = clamp((PALETTE_ZERO - colours["palette_size"]) / (PALETTE_ZERO - PALETTE_FULL))
    if palette >= 0.5:
        evidence.append(f"色数が少ない（{colours['palette_size']}色で{percent(PALETTE_COVERAGE)}%）")

    horizontal, vertical = lines["horizontal"], lines["vertical"]
    if horizontal and vertical:
        line_part = 1.0
        evidence.append("縦横の長い線（軸）を検出")
    elif horizontal or vertical:
        line_part = 0.5
        if horizontal:
            evidence.append(f"横の長い線を検出（{horizontal}本）")
        else:
            evidence.append(f"縦の長い線を検出（{vertical}本）")
    else:
        line_part = 0.0

    block_share = sum(block["area"] for block in blocks) / total
    block_part = clamp(block_share / BLOCK_FULL_SHARE)
    rectangles = [block for block in blocks if is_rectangle(block)]
    stroke_part = 0.0
    colourful_ratio = colours["colourful_ratio"]
    if line_part > 0 and colourful_ratio <= STROKE_MAX_COLOURFUL:
        stroke_part = STROKE_MAX_SCORE * clamp(colourful_ratio / STROKE_FULL_COLOURFUL)
    if block_part >= stroke_part and block_part > 0:
        if rectangles:
            evidence.append(f"単色の長方形（棒）を{len(rectangles)}個検出")
        else:
            evidence.append(f"単色のくっきりした領域を{len(blocks)}個検出（画像の{percent(block_share)}%）")
    elif stroke_part > 0:
        evidence.append(f"色付きの細い線（画像の{percent(colourful_ratio)}%）")
    marks = max(block_part, stroke_part)

    score = (CHART_WEIGHTS["background"] * background + CHART_WEIGHTS["palette"] * palette
             + CHART_WEIGHTS["lines"] * line_part + CHART_WEIGHTS["marks"] * marks)
    return round(score, 2), evidence


def percent(ratio):
    return round(ratio * 100)
