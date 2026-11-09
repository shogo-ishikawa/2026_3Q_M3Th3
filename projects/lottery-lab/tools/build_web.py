"""画面のHTML・CSS・JavaScriptを、単体でも開けるindex.htmlへまとめます。"""
from pathlib import Path
import re

PROJECT = Path(__file__).resolve().parents[1]


def build():
    template = (PROJECT / "tools/index.template.html").read_text()
    style = (PROJECT / "styles.css").read_text()
    engine = re.sub(r"^export ", "", (PROJECT / "engine.js").read_text(), flags=re.MULTILINE)
    app = re.sub(r"^import .*;\n", "", (PROJECT / "app.js").read_text(), count=1)
    assert "import " not in app and "export " not in engine
    output = template.replace('<link rel="stylesheet" href="styles.css">', f"<style>\n{style}\n</style>")
    output = output.replace('<script type="module" src="app.js"></script>', f'<script type="module">\n{engine}\n{app}\n</script>')
    (PROJECT / "index.html").write_text(output)
    print("Created standalone index.html")


if __name__ == "__main__":
    build()
