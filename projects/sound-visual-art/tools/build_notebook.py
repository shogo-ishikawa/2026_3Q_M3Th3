"""公開発展版の小さなPython実験教材を生成します。提出Notebookは梱包しません。"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def cell(kind, source):
    result = {'cell_type': kind, 'metadata': {}, 'source': source.strip().splitlines(keepends=True)}
    if kind == 'code':
        result.update(execution_count=None, outputs=[])
    return result


def build():
    cells = [cell('markdown', '''
# LUMEN：音を色と形に変える小さな実験
公開発展版 v1.0.0。学生が考えた「音の高さ・大きさを色・形・数字に対応させる」計算を、Pythonの関数とリストで試します。元の提出Notebookとは別の教材です。

上から順に実行してください。外部APIやマイクは使いません。色と音の対応はこの作品の設定であり、全ての人が同じように感じることを示すものではありません。
'''), cell('code', '''
import math
import colorsys
import io
import struct
import wave
from IPython.display import HTML, Audio, display

def clamp(value, low=0.0, high=1.0):
    return max(low, min(high, value))

def compute_targets(freq_hz, volume_pct, reversed_mode=False):
    """学生版と同じ対応式。NumPy配列をPythonのリストへ置き換えています。"""
    pitch = clamp((freq_hz - 130.0) / 870.0)
    volume = clamp((volume_pct - 10.0) / 90.0)
    if reversed_mode:
        pitch = 1.0 - pitch
        volume = 1.0 - volume

    hue = (0.64 - pitch * 0.62) % 1.0
    saturation = 0.28 + volume * 0.72
    brightness = 0.30 + volume * 0.70
    rgb = colorsys.hsv_to_rgb(hue, saturation, brightness)
    colour = "#" + "".join(f"{int(value * 255):02x}" for value in rgb)
    count = round(4 + volume * 12)
    radius = 0.68
    points = []
    if pitch < 0.35:
        amplitude = radius * (0.04 + pitch * 0.25)
        for i in range(200):
            angle = i * 2 * math.pi / 199
            r = radius - amplitude * 0.5 + amplitude * 0.5 * math.cos(count * angle)
            points.append([r * math.cos(angle), r * math.sin(angle)])
        shape = f"丸形({count}波)"
    else:
        for i in range(count * 2):
            angle = i * 2 * math.pi / (count * 2) - math.pi / 2
            r = radius if i % 2 == 0 else radius * (1.0 - pitch * 0.60)
            points.append([r * math.cos(angle), r * math.sin(angle)])
        shape = f"トゲ星型({count}角)"
    return {"colour": colour, "points": points, "shape": shape,
            "number": round(1 + (0.5 * pitch + 0.5 * volume) * 99), "vertices": count}
'''), cell('code', '''
def result_html(freq_hz, volume_pct, reversed_mode=False):
    target = compute_targets(freq_hz, volume_pct, reversed_mode)
    points = " ".join(f"{x:.10f},{y:.10f}" for x, y in target["points"])
    return f"""<div style="display:inline-block;border:1px solid #cbd5d1;border-radius:12px;padding:20px;margin:5px;font-family:sans-serif;background:#f6f8f2;color:#253b32">
    <p>{freq_hz} Hz / {volume_pct}%</p>
    <div style="display:flex;align-items:center;gap:25px">
    <svg width="95" height="95" viewBox="-1 -1 2 2" aria-label="色"><circle r="0.68" fill="{target['colour']}"/></svg>
    <svg width="95" height="95" viewBox="-1 -1 2 2" aria-label="形"><polygon points="{points}" fill="#94aa9c"/></svg>
    <strong style="font-size:45px">{target['number']}</strong></div>
    <p>{target['colour']} / {target['shape']}</p></div>"""

# @title 音の条件を変える
freq_hz = 880 # @param {type:"slider", min:130, max:1000, step:5}
volume_pct = 95 # @param {type:"slider", min:10, max:100, step:1}
reversed_mode = False # @param {type:"boolean"}
display(HTML(result_html(freq_hz, volume_pct, reversed_mode)))
'''), cell('markdown', '''
## 4条件を比べる
高い・低い音と、大きい・小さい音を組み合わせます。逆モードにすると色・輪郭・数値の対応が入れ替わります。
'''), cell('code', '''
presets = [(880, 95), (165, 95), (880, 20), (165, 20)]
display(HTML("".join(result_html(freq, volume, reversed_mode) for freq, volume in presets)))
'''), cell('markdown', '''
## 設定した音を聴く
学生版の基音と第2〜4倍音を混ぜる方法を引き継いでいます。波形をリストで作り、最大振幅をそろえ、立ち上がりと終わりをなめらかにします。再生ボタンを押したときだけ音が鳴ります。

音量の%は計算上の振幅で、スピーカーから出る音圧の測定値ではありません。
'''), cell('code', '''
def make_sound(freq_hz, volume_pct, duration=0.6, sample_rate=22050):
    sharpness = clamp((freq_hz - 130.0) / 870.0)
    normal_volume = max(0.06, min(1.0, (volume_pct / 100.0) ** 1.35))
    samples = []
    for i in range(int(sample_rate * duration)):
        t = i / sample_rate
        fundamental = math.sin(2 * math.pi * freq_hz * t)
        harmonics = (0.50 * math.sin(2 * math.pi * freq_hz * 2 * t)
                     + 0.30 * math.sin(2 * math.pi * freq_hz * 3 * t)
                     + 0.20 * math.sin(2 * math.pi * freq_hz * 4 * t))
        samples.append((1 - 0.55 * sharpness) * fundamental + 0.55 * sharpness * harmonics)
    maximum = max(abs(value) for value in samples) or 1.0
    pcm = bytearray()
    for i, value in enumerate(samples):
        envelope = math.sin(math.pi * (i / sample_rate) / duration) ** 0.4
        value = normal_volume * envelope * value / maximum * 0.85
        pcm.extend(struct.pack("<h", int(clamp(value, -1, 1) * 32767)))
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as stream:
        stream.setparams((1, 2, sample_rate, 0, "NONE", "not compressed"))
        stream.writeframes(pcm)
    return buffer.getvalue()

display(Audio(make_sound(freq_hz, volume_pct), autoplay=False))
'''), cell('markdown', '''
## 自分の表現へ広げる
- `hue`の式を変えて、青から緑へ変わる色の範囲を作る。
- `count`の式を変えて、輪郭の角を増やす。
- `presets`へ新しい音の条件を追加する。

ブラウザ作品の`core.js`にも同じ計算があります。光の粒子は`renderer.js`で、位置と速度をリストに入れて繰り返し更新しています。Pythonの計算とブラウザの絵をつなげる入口として使ってください。
''')]
    notebook = {'cells': cells, 'metadata': {'kernelspec': {'display_name': 'Python 3', 'language': 'python', 'name': 'python3'}, 'language_info': {'name': 'python'}}, 'nbformat': 4, 'nbformat_minor': 5}
    path = ROOT / 'lumen_lab.ipynb'
    path.write_text(json.dumps(notebook, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    return path


if __name__ == '__main__':
    print(build())
