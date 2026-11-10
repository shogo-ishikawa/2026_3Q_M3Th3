"""6つのフォームと教材のPython本体を、単独で動くNotebookへまとめる。"""
from pathlib import Path
import base64
import json
import zlib

ROOT = Path(__file__).resolve().parents[1]


def build():
    definitions = json.loads((ROOT / "tools/notebook_cells.json").read_text())
    embedded = {name: base64.b64encode(zlib.compress((ROOT / name).read_bytes(), 9)).decode("ascii")
                for name in ("sound_core.py", "sound_workflow.py")}
    cells = []
    for index, definition in enumerate(definitions):
        source = definition["source"]
        if index == 0:
            source = source.replace("__EMBEDDED_MODULES__", repr(embedded))
        cells.append({"cell_type": "code", "execution_count": None, "outputs": [],
                      "metadata": {"id": f"sound-lab-{index + 1}", "cellView": "form"},
                      "source": source.splitlines(keepends=True)})
    notebook = {"nbformat": 4, "nbformat_minor": 5, "cells": cells,
                "metadata": {"colab": {"name": "音の実験室", "provenance": []},
                             "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
                             "language_info": {"name": "python", "version": "3"}}}
    destination = ROOT / "sound_analysis_lab.ipynb"
    destination.write_text(json.dumps(notebook, ensure_ascii=False, indent=1) + "\n")
    return destination


if __name__ == "__main__":
    print(build())
