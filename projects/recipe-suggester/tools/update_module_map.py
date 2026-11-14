"""ブラウザーが同じ版のモジュールを一度ずつ読むための対応表を更新します。"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def update():
    version = (ROOT / "VERSION").read_text().strip()
    imports = {f"./{path.name}": f"./{path.name}?v={version}"
               for path in sorted(ROOT.glob("*.js"))}
    block = '<script type="importmap" id="app-module-map">' + json.dumps({"imports": imports}, separators=(",", ":")) + '</script>'
    page = ROOT / "index.html"
    source = page.read_text()
    pattern = r'<script type="importmap" id="app-module-map">.*?</script>'
    if re.search(pattern, source, re.S):
        source = re.sub(pattern, lambda _: block, source, flags=re.S)
    else:
        source = source.replace('</head>', block + '\n</head>', 1)
    page.write_text(source)


if __name__ == "__main__":
    update()
