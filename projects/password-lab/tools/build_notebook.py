"""読みやすい部品から、単体で動くColab Notebookを作ります。"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def build():
    definitions = json.loads((ROOT / "tools/notebook_cells.json").read_text(encoding="utf-8"))
    sources = {}
    for token, filename in (
        ("__HASH_MODULE_LITERAL__", "hash_engines.py"),
        ("__CORE_MODULE_LITERAL__", "password_core.py"),
    ):
        sources[token] = json.dumps((ROOT / filename).read_text(encoding="utf-8"), ensure_ascii=False)
    cells = []
    for definition in definitions:
        text = definition["text"]
        for token, replacement in sources.items():
            text = text.replace(token, replacement)
        cell = {"cell_type": definition["type"], "metadata": {"id": definition["id"]},
                "source": text.splitlines(keepends=True)}
        if definition["type"] == "code":
            cell["execution_count"] = None
            cell["outputs"] = []
            cell["metadata"].update({"cellView": "form"})
        cells.append(cell)
    notebook = {"nbformat": 4, "nbformat_minor": 0, "cells": cells,
                "metadata": {"colab": {"name": "パスワードラボ", "provenance": []},
                             "kernelspec": {"display_name": "Python 3", "name": "python3"},
                             "language_info": {"name": "python"}}}
    output = ROOT / "password_lab.ipynb"
    output.write_text(json.dumps(notebook, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return output


if __name__ == "__main__":
    print(build())
