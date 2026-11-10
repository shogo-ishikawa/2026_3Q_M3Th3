"""Webと同じ料理データで、Pythonの絞り込みを学べるNotebookを作る。"""
from pathlib import Path
import base64
import json
import subprocess
import zlib

ROOT = Path(__file__).resolve().parents[1]

FEATURES_CODE = '''KNOWN_ALLERGENS = {item["id"] for item in ALLERGENS}
KNOWN_GROUPS = {"staple", "vegetable", "protein", "dairy", "fruit"}
KNOWN_PROTEINS = {"meat", "fish", "egg", "soy"}


def ingredient_info(ingredient_id):
    ingredient = INGREDIENTS.get(ingredient_id)
    if not isinstance(ingredient, dict):
        raise ValueError("登録されていない食材です。")
    for field, choices in [("allergens", KNOWN_ALLERGENS),
                           ("groups", KNOWN_GROUPS),
                           ("proteinSources", KNOWN_PROTEINS)]:
        values = ingredient.get(field, [] if field == "proteinSources" else None)
        if not isinstance(values, list) or any(not isinstance(value, str) or value not in choices for value in values):
            raise ValueError("材料のアレルゲン・食品群の確認情報が不明です。")
    return ingredient


def ingredient_ancestors(ingredient_id, visiting=None):
    if visiting is None:
        visiting = set()
    if ingredient_id in visiting:
        raise ValueError("材料の派生元が循環しています。")
    ingredient = ingredient_info(ingredient_id)
    parents = ingredient.get("derivedFrom", [])
    if not isinstance(parents, list) or any(not isinstance(parent, str) or not parent for parent in parents):
        raise ValueError("材料の派生元の確認情報が不明です。")
    ancestors = set()
    for parent_id in parents:
        ancestors.add(parent_id)
        ancestors.update(ingredient_ancestors(parent_id, visiting | {ingredient_id}))
    return ancestors


def recipe_features(recipe):
    if not isinstance(recipe, dict) or not isinstance(recipe.get("ingredients"), list) or not recipe["ingredients"]:
        raise ValueError("材料の情報がありません。")
    allergens = set()
    groups = set()
    proteins = set()
    for item in recipe["ingredients"]:
        ingredient_id = item["id"]
        ingredient = ingredient_info(ingredient_id)
        # 加工食品の記載から漏れていても、登録された原料のアレルゲンは引き継ぎます。
        family = ingredient_ancestors(ingredient_id) | {ingredient_id}
        for family_id in family:
            allergens.update(ingredient_info(family_id)["allergens"])
        # 食品群は実際に使う材料の区分だけを数えます。しょうゆを大豆料理とは数えません。
        groups.update(ingredient["groups"])
        proteins.update(ingredient.get("proteinSources", []))
    return allergens, groups, proteins


def is_candidate(recipe):
    if not isinstance(recipe, dict) or recipe.get("role") != role:
        return False
    try:
        allergens, _, _ = recipe_features(recipe)
        for item in recipe["ingredients"]:
            family = ingredient_ancestors(item["id"]) | {item["id"]}
            if family & set(excluded_ingredients):
                return False
    except (ValueError, KeyError, TypeError):
        return False
    return not bool(allergens & avoid_ids)


candidates = [recipe for recipe in RECIPES if is_candidate(recipe)]
print(f"条件に合う候補：{len(candidates)}品")
if not candidates:
    print("候補がありません。除外条件は解除しません。")
'''


def dataset():
    script = "import {ALLERGENS,INGREDIENTS,RECIPES} from './data.js'; console.log(JSON.stringify({allergens:ALLERGENS,ingredients:INGREDIENTS,recipes:RECIPES}));"
    result = subprocess.run(["node", "--input-type=module", "-e", script], cwd=ROOT,
                            capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def build():
    encoded = base64.b64encode(zlib.compress(json.dumps(dataset(), ensure_ascii=False).encode(), 9)).decode()
    definitions = [
        ("markdown", "# 献立ノートをPythonで調べる\n\n[Web版](https://shogo-ishikawa.github.io/2026_3Q_M3Th3/projects/recipe-suggester/)と同じ料理データを使います。上から実行した後、除外する食材や食事の記録を変えてみましょう。基本機能は追加ライブラリやAPIキーなしで動きます。\n\nこれはPythonで条件判定・集計・並べ替えを学ぶ教材です。献立の作成や記録の保存はWeb版を使えます。実際に調理するときは商品の原材料表示も確認してください。"),
        ("code", 'import base64\nimport json\nimport zlib\nfrom collections import Counter\nfrom datetime import date, timedelta\n\nDATA = json.loads(zlib.decompress(base64.b64decode(' + repr(encoded) + ')))\nRECIPES = DATA["recipes"]\nINGREDIENTS = DATA["ingredients"]\nALLERGENS = DATA["allergens"]\nprint(f"料理 {len(RECIPES)}品を読み込みました。")\nprint("選べるアレルゲン：", "、".join(a["label"] for a in ALLERGENS))\n'),
        ("markdown", "## 条件を変えてみる\n\n`avoid_names`はアレルゲン名のリストです。表示された選択肢を正確に入力します。選択肢にない食材は、登録食材のIDを`excluded_ingredients`へ追加できます。トマトを除外するとトマト缶・ペーストなど登録された派生食材も外します。逆にトマト缶だけの除外では、生のトマトまで一律には外しません。空リスト`[]`は追加の除外なしです。\n\n人数は材料の分量に反映します。アレルギーの除外と料理の順位付けは分けて扱い、候補がなくなっても除外を解除しません。"),
        ("code", 'avoid_names = ["卵", "乳"]  # ★ここを変えて試そう\nexcluded_ingredients = []  # 例："tomato"でトマトと登録された派生食材を除外\nservings = 2\nrole = "main"  # main：主菜、side：副菜、soup：汁物\n\nlabels = {a["label"]: a["id"] for a in ALLERGENS}\nunknown = set(avoid_names) - set(labels)\nif unknown:\n    raise ValueError(f"選択肢にないアレルゲン名です：{unknown}")\nif not isinstance(servings, int) or isinstance(servings, bool) or not 1 <= servings <= 8:\n    raise ValueError("人数は1〜8の整数にしてください。")\nif set(excluded_ingredients) - set(INGREDIENTS):\n    raise ValueError("登録されていない食材IDがあります。")\nif role not in {"main", "side", "soup", "staple"}:\n    raise ValueError("料理の区分を確認してください。")\navoid_ids = {labels[name] for name in avoid_names}\n'),
        ("markdown", "## 辞書・リスト・if・forで候補を調べる\n\nレシピの材料を1つずつ調べます。食材の情報が不明な場合も候補から外します。調味料も同じ方法で確認します。`ingredient_ancestors`は加工食品の原料をたどる補助関数です。初めは、`is_candidate`の中の`for`と`if`が何を判定しているかを確認してください。メーカーによって材料が変わるため、登録された情報だけで実際の商品の安全を判断するものではありません。"),
        ("code", FEATURES_CODE),
        ("markdown", "## 過去7日の記録を数える\n\n下の`history`を自分の記録に変えられます。`recipeIds`には登録料理のID、手入力の食事には食品群を指定します。食品群は`staple`（主食）、`vegetable`（副菜の食材）、`protein`（主菜の食材）、`dairy`（乳製品）、`fruit`（果物）です。\n\n数えるのは記録に含まれる食品群の有無です。食事量・栄養量・食事バランスガイドのSVは計算しません。記録のない食事を「食べなかった」とは扱いません。"),
        ("code", 'today = date.today()\nhistory = [\n    {"date": str(today - timedelta(days=1)), "recipeIds": [],\n     "groups": ["staple", "protein"], "proteinSources": ["meat"]},\n]\n\nrecipe_by_id = {r["id"]: r for r in RECIPES}\ngroup_counts = Counter()\nprotein_counts = Counter()\nrecipe_counts = Counter()\nfor meal in history:\n    recorded = date.fromisoformat(meal["date"])\n    if not today - timedelta(days=7) <= recorded < today:\n        continue\n    groups = set(meal.get("groups", []))\n    proteins = set(meal.get("proteinSources", []))\n    for recipe_id in meal.get("recipeIds", []):\n        if recipe_id not in recipe_by_id:\n            raise ValueError(f"登録されていない料理IDです：{recipe_id}")\n        _, recipe_groups, recipe_proteins = recipe_features(recipe_by_id[recipe_id])\n        groups.update(recipe_groups)\n        proteins.update(recipe_proteins)\n        recipe_counts[recipe_id] += 1\n    group_counts.update(groups)\n    protein_counts.update(proteins)\nprint("記録に含まれる食品群：", dict(group_counts))\nprint("主菜の食材の種類：", dict(protein_counts))\n'),
        ("markdown", "## 候補を並べ替えてレシピを読む\n\n最近食べた同じ料理を下位にし、記録に少ない主菜の種類や野菜を含む料理を上位にする簡単な例です。重みを変えると何が起こるでしょうか。除外判定を通った候補だけを並べ替える順序は保ってください。"),
        ("code", 'def priority(recipe):\n    _, groups, proteins = recipe_features(recipe)\n    score = -5 * recipe_counts[recipe["id"]]\n    if "vegetable" in groups:\n        score += 2 / (1 + group_counts["vegetable"])\n    for source in proteins:\n        score += 1 / (1 + protein_counts[source])\n    return score\n\n\nranked = sorted(candidates, key=priority, reverse=True)\nfor recipe in ranked[:3]:\n    print("\\n", recipe["name"], f"（{servings}人分）")\n    for item in recipe["ingredients"]:\n        ingredient = INGREDIENTS[item["id"]]\n        amount = item["amount"] * servings / recipe["servings"]\n        print(f"  {ingredient[\"name\"]}：{amount:g}{ingredient[\"unit\"]}")\n    for number, step in enumerate(recipe["steps"], 1):\n        print(f"  {number}. {step}")\n'),
        ("markdown", "## ここから発展させる\n\n候補の並び方を変える、直近3日と7日で比べる、主菜・副菜・汁物を組み合わせるなど、1つずつ変更して同じ条件で比較しましょう。レシピを増やす場合は材料・調味料とアレルゲンの情報を一緒に追加します。"),
    ]
    cells = []
    for index, (kind, source) in enumerate(definitions):
        cell = {"cell_type": kind, "id": f"meal-python-{index+1}", "metadata": {}, "source": source.splitlines(keepends=True)}
        if kind == "code":
            cell.update(execution_count=None, outputs=[])
        cells.append(cell)
    notebook = {"nbformat": 4, "nbformat_minor": 5, "metadata": {
        "colab": {"name": "献立ノートをPythonで調べる", "provenance": []},
        "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"}}, "cells": cells}
    output = ROOT / "meal_planner.ipynb"
    output.write_text(json.dumps(notebook, ensure_ascii=False, indent=1) + "\n")
    return output


if __name__ == "__main__":
    print(build())
