"""公開するソースだけを、バージョン名のフォルダーへまとめます。"""
from pathlib import Path
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FILES = (
    "README.md", "VERSION", "package.json", "CLAUDE_CODE_PROMPT.md",
    "index.html", "styles.css", "app.js", "storage.js", "planner.js", "data.js",
    "recipe_suggester.ipynb", "meal_planner.ipynb",
    "classics-mains.js", "classics-sides.js", "prepared-foods.js", "catalog-metadata.js", "dish-hierarchy.js", "record-actions.js", "sushi-foods.js", "performance-foods.js", "cooking-instructions.js", "japanese-search.js", "varied-recipes.js", "comfort-foods.js", "confectionery-foods.js", "dessert-foods.js", "accompaniment-foods.js", "salad-builder.js", "salad-builder-ui.js", "salad-builder.css", "dish-customisation.js", "dish-customisation-ui.js", "dish-customisation.css", "menu-variations.js", "takeaway-foods.js", "familiar-mains.js", "familiar-sides.js",
    "palette-foods.js", "food-composer.js", "food-composer-ui.js", "food-composer.css",
    "meat-choice-foods.js", "meat-choices.js", "meat-choices-ui.js",
    "mapo-foods.js", "mapo-nutrition.js",
    "simmered-foods.js", "canteen-foods.js", "tavern-foods.js", "bistro-foods.js", "soup311-foods.js",
    "seafood-foods.js", "world-foods.js", "noodle-foods.js", "noodle-composer.js", "noodle-composer-ui.js", "noodle-composer.css", "curry-rice.js", "curry-rice-ui.js",
    "meal-sets.js", "meal-sets-ui.js", "meal-sets-ui.css", "purchase-conversion.js", "purchase-conversion-ui.js", "purchase-conversion-ui.css", "batch-cooking.js", "batch-cooking-ui.js", "batch-cooking-ui.css", "restaurant-menu.js", "restaurant-menu-ui.js", "restaurant-menu-ui.css",
    "recipe-arrangement.js", "recipe-arrangement-ui.js", "recipe-arrangement.css",
    "quantity-input.js", "quantity-input.css",
    "recipe-illustration.js", "recipe-illustration-ui.js",
    "recipe-artwork-manifest.js",
    "favourites.js", "favourites-ui.js", "favourites-ui.css", "meal-overlap.js",
    "nutrition-basis.js", "nutrition-basis-ui.js", "nutrition-basis-ui.css",
    "text-log.js", "text-log-ui.js", "text-log-ui.css",
    "soup-intake.js", "soup-intake-ui.js", "soup-intake-ui.css",
    "catalog.js", "dietary-reference.js", "intake.js", "tabs.js", "everyday-foods.js", "app-icon.svg",
    "journal.js", "nutrition.js", "shopping.js", "ingredient-nutrients.js", "expanded-foods.js",
)
DIRECTORIES = ("docs", "tools", "tests", "assets")
SKIP = {"__pycache__", ".pytest_cache", "node_modules", "dist"}


def public_files():
    for filename in FILES:
        path = ROOT / filename
        if not path.is_file() or path.is_symlink():
            raise ValueError(f"公開用ファイルが見つかりません：{filename}")
        yield path
    for directory in DIRECTORIES:
        for path in sorted((ROOT / directory).rglob("*")):
            relative = path.relative_to(ROOT)
            if any(part in SKIP or part.startswith(".") for part in relative.parts):
                continue
            if path.is_file() and not path.is_symlink():
                yield path


def stage(destination):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    for path in public_files():
        target = destination / path.relative_to(ROOT)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)


def build():
    version = (ROOT / "VERSION").read_text().strip()
    if not version or any(c not in "0123456789." for c in version):
        raise ValueError("VERSIONを確認してください。")
    output = ROOT / "dist" / f"meal-planner_v{version}.zip"
    output.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in public_files():
            archive.write(path, Path(f"v{version}") / path.relative_to(ROOT))
    return output


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", type=Path)
    args = parser.parse_args()
    if args.stage:
        stage(args.stage)
    else:
        print(build())
