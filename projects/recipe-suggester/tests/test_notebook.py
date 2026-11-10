"""追加Notebookのデータ一致と、最初からの実行を確認する。"""
from pathlib import Path
import base64
import contextlib
import importlib.util
import io
import json
import unittest
import zlib

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("meal_notebook", ROOT / "tools/build_notebook.py")
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)


class NotebookTests(unittest.TestCase):
    def notebook_namespace(self):
        notebook = json.loads((ROOT / "meal_planner.ipynb").read_text())
        namespace = {}
        with contextlib.redirect_stdout(io.StringIO()):
            for cell in notebook["cells"]:
                if cell["cell_type"] == "code":
                    self.assertEqual(cell["outputs"], [])
                    self.assertIsNone(cell["execution_count"])
                    exec(compile("".join(cell["source"]), "meal-notebook", "exec"), namespace)
        return namespace

    def test_notebook_uses_current_data_and_executes_without_extra_libraries(self):
        namespace = self.notebook_namespace()
        self.assertEqual(namespace["DATA"], builder.dataset())
        self.assertGreaterEqual(len(namespace["RECIPES"]), 200)
        self.assertTrue(namespace["candidates"])
        for recipe in namespace["candidates"]:
            allergens, _, _ = namespace["recipe_features"](recipe)
            self.assertFalse(allergens & namespace["avoid_ids"])
        bad = {"role": "main", "ingredients": [{"id": "unknown-food", "amount": 1}]}
        self.assertFalse(namespace["is_candidate"](bad))
        namespace["avoid_ids"] = {a["id"] for a in namespace["ALLERGENS"]}
        for recipe in namespace["RECIPES"]:
            if namespace["is_candidate"](recipe):
                self.assertEqual(namespace["recipe_features"](recipe)[0], set())

    def test_registered_tomato_forms_are_excluded_along_with_the_raw_ingredient(self):
        namespace = self.notebook_namespace()
        namespace["avoid_ids"] = set()
        namespace["excluded_ingredients"] = ["tomato"]
        tomato_ids = {"tomato", "canned_tomato", "tomato_paste"}
        tomato_recipes = [recipe for recipe in namespace["RECIPES"]
                          if recipe["role"] == "main" and
                          any(item["id"] in tomato_ids for item in recipe["ingredients"])]
        self.assertTrue(tomato_recipes)
        self.assertTrue(any(any(item["id"] == "canned_tomato" for item in recipe["ingredients"])
                            for recipe in tomato_recipes))
        for recipe in tomato_recipes:
            self.assertFalse(namespace["is_candidate"](recipe), recipe["id"])
        candidates = [recipe for recipe in namespace["RECIPES"] if namespace["is_candidate"](recipe)]
        self.assertTrue(candidates)
        self.assertFalse(any(item["id"] in tomato_ids for recipe in candidates for item in recipe["ingredients"]))

    def test_ancestor_allergens_are_unioned_without_inventing_food_groups(self):
        namespace = self.notebook_namespace()
        namespace["INGREDIENTS"].update({
            "test_egg_parent": {"name": "卵原料", "unit": "g", "allergens": ["egg"], "groups": ["protein"], "proteinSources": ["egg"]},
            "test_processed": {"name": "卵由来の加工材料", "unit": "g", "allergens": [], "groups": [], "proteinSources": [], "derivedFrom": ["test_egg_parent"]},
            "test_processed_twice": {"name": "さらに加工した材料", "unit": "g", "allergens": [], "groups": [], "proteinSources": [], "derivedFrom": ["test_processed"]},
        })
        recipe = {"role": "main", "ingredients": [{"id": "test_processed_twice", "amount": 1}]}
        allergens, groups, proteins = namespace["recipe_features"](recipe)
        self.assertEqual(allergens, {"egg"})
        self.assertEqual(groups, set())
        self.assertEqual(proteins, set())
        namespace["avoid_ids"] = {"egg"}
        self.assertFalse(namespace["is_candidate"](recipe))
        namespace["avoid_ids"] = set()
        namespace["excluded_ingredients"] = ["test_egg_parent"]
        self.assertFalse(namespace["is_candidate"](recipe))
        namespace["excluded_ingredients"] = ["test_processed"]
        raw = {"role": "main", "ingredients": [{"id": "test_egg_parent", "amount": 1}]}
        self.assertTrue(namespace["is_candidate"](raw))

    def test_unknown_cyclic_or_invalid_ingredient_metadata_never_becomes_a_candidate(self):
        namespace = self.notebook_namespace()
        namespace["avoid_ids"] = set()
        normal = {"name": "確認用材料", "unit": "g", "allergens": [], "groups": [], "proteinSources": []}
        broken_cases = [
            {**normal, "allergens": ["unknown-allergen"]},
            {**normal, "derivedFrom": ["unknown-parent"]},
            {**normal, "derivedFrom": ["test_broken"]},
            {**normal, "derivedFrom": "tomato"},
            {**normal, "derivedFrom": None},
            {**normal, "groups": ["unknown-group"]},
            {**normal, "proteinSources": ["unknown-protein"]},
        ]
        for ingredient in broken_cases:
            with self.subTest(ingredient=ingredient):
                namespace["INGREDIENTS"]["test_broken"] = ingredient
                recipe = {"role": "main", "ingredients": [{"id": "test_broken", "amount": 1}]}
                self.assertFalse(namespace["is_candidate"](recipe))
        namespace["INGREDIENTS"].update({
            "test_broken": {**normal, "derivedFrom": ["test_parent"]},
            "test_parent": {**normal, "allergens": ["unknown-allergen"]},
        })
        self.assertFalse(namespace["is_candidate"]({"role": "main", "ingredients": [{"id": "test_broken", "amount": 1}]}))

    def test_each_allergen_and_all_selected_allergens_stay_excluded(self):
        namespace = self.notebook_namespace()
        scenarios = [{item["id"]} for item in namespace["ALLERGENS"]]
        scenarios.append({item["id"] for item in namespace["ALLERGENS"]})
        for avoid_ids in scenarios:
            namespace["avoid_ids"] = avoid_ids
            candidates = [recipe for recipe in namespace["RECIPES"] if namespace["is_candidate"](recipe)]
            for recipe in candidates:
                self.assertFalse(namespace["recipe_features"](recipe)[0] & avoid_ids)

    def test_no_candidates_does_not_relax_the_selected_constraints(self):
        namespace = self.notebook_namespace()
        namespace["avoid_ids"] = {"egg"}
        namespace["excluded_ingredients"] = []
        only_egg = [{"role": "main", "ingredients": [{"id": "egg", "amount": 1}]}]
        candidates = [recipe for recipe in only_egg if namespace["is_candidate"](recipe)]
        self.assertEqual(candidates, [])
        self.assertEqual(namespace["avoid_ids"], {"egg"})


if __name__ == "__main__":
    unittest.main()
