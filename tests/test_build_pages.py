"""共通Pages公開で作品が抜けたり、対象外ファイルが混ざったりしないことを確認。"""
import importlib.util
import json
from pathlib import Path
import posixpath
import re
import tempfile
import unittest
from html.parser import HTMLParser


SPEC = importlib.util.spec_from_file_location("build_pages", Path(__file__).resolve().parents[1] / "tools/build_pages.py")
pages = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pages)


class EntryAssets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []
        self.module_map = ""
        self.in_module_map = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script" and attrs.get("type") == "importmap":
            self.in_module_map = True
        if tag == "script" and attrs.get("src"):
            self.paths.append(attrs["src"])
        if tag == "link" and attrs.get("rel") == "stylesheet":
            self.paths.append(attrs["href"])

    def handle_endtag(self, tag):
        if tag == "script":
            self.in_module_map = False

    def handle_data(self, data):
        if self.in_module_map:
            self.module_map += data


class MealPalettePublishedAssetsTests(unittest.TestCase):
    def test_all_entry_assets_and_transitive_modules_are_published(self):
        root = Path(__file__).resolve().parents[1]
        manifest = json.loads((root / "pages-projects.json").read_text())
        project = next(p for p in manifest["projects"] if p["source"] == "projects/recipe-suggester")
        source = root / project["source"]
        listed = set(project["files"])
        entry = EntryAssets()
        entry.feed((source / "index.html").read_text())
        version = (source / "VERSION").read_text().strip()
        module_map = json.loads(entry.module_map)["imports"]
        self.assertEqual(module_map, {"./" + path.name: "./" + path.name + "?v=" + version
                                     for path in sorted(source.glob("*.js"))})
        pending = list(entry.paths)
        pending.extend(module_map.values())
        visited = set()
        while pending:
            relative = pending.pop().split("?", 1)[0].split("#", 1)[0]
            if re.match(r"^(?:[a-z]+:|//)", relative):
                continue
            relative = posixpath.normpath(relative)
            if relative in visited:
                continue
            visited.add(relative)
            self.assertTrue(relative in listed or any(parent.as_posix() in listed for parent in Path(relative).parents),
                            f"Pages manifest omits required asset: {relative}")
            asset = source / relative
            self.assertTrue(asset.is_file(), f"Missing source asset: {relative}")
            if asset.suffix == ".js":
                imports = re.findall(r'''(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)['"](\.[^'"]+)['"]''', asset.read_text())
                pending.extend(posixpath.join(posixpath.dirname(relative), path) for path in imports)


class PagesBuildTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.write("index.html", "gallery")
        self.write("projects/alpha/index.html", "alpha")
        self.write("projects/alpha/assets/style.css", "alpha css")
        self.write("projects/alpha/private.py", "not for Pages")
        self.write("projects/beta/dist/index.html", "beta")
        self.write("projects/beta/dist/assets/beta.js", "beta js")
        self.manifest = {"projects": [
            {"source": "projects/alpha", "destination": "projects/alpha", "files": ["index.html", "assets/"]},
            {"source": "projects/beta/dist", "destination": "projects/beta", "files": ["index.html", "assets/"]},
        ]}
        self.save_manifest()

    def write(self, name, content):
        target = self.root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
        return target

    def save_manifest(self):
        self.write("pages-projects.json", json.dumps(self.manifest))

    def test_two_projects_survive_a_rebuild_and_unlisted_files_are_absent(self):
        output = pages.build(self.root)
        expected = {"index.html", ".nojekyll", "projects/alpha/index.html", "projects/alpha/assets/style.css",
                    "projects/beta/index.html", "projects/beta/assets/beta.js"}
        actual = {path.relative_to(output).as_posix() for path in output.rglob("*") if path.is_file()}
        self.assertEqual(actual, expected)
        self.write("projects/alpha/index.html", "updated alpha")
        self.write("_site/stale.html", "old output")
        pages.build(self.root)
        self.assertEqual((output / "projects/alpha/index.html").read_text(), "updated alpha")
        self.assertEqual((output / "projects/beta/index.html").read_text(), "beta")
        self.assertFalse((output / "stale.html").exists())
        self.assertTrue((self.root / "projects/alpha/private.py").is_file())

    def test_invalid_paths_fail_before_replacing_previous_output(self):
        self.write("_site/sentinel.txt", "keep old site")
        for field, invalid in [("source", "../outside"), ("source", "/tmp"),
                               ("destination", "projects/../../tools"), ("destination", "."),
                               ("files", ["../private.py"]), ("files", [".env"])]:
            with self.subTest(field=field, invalid=invalid):
                original = self.manifest["projects"][0][field]
                self.manifest["projects"][0][field] = invalid
                self.save_manifest()
                with self.assertRaises(ValueError):
                    pages.build(self.root)
                self.assertEqual((self.root / "_site/sentinel.txt").read_text(), "keep old site")
                self.manifest["projects"][0][field] = original

    def test_duplicate_destinations_or_overlapping_files_are_rejected(self):
        self.manifest["projects"][1]["destination"] = "projects/alpha"
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, "重複"):
            pages.build(self.root)
        self.manifest["projects"].pop()
        self.manifest["projects"][0]["files"].append("assets/style.css")
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, "重複"):
            pages.build(self.root)

    def test_links_in_source_or_output_are_rejected_without_deleting_source(self):
        link = self.root / "projects/alpha/assets/link.css"
        try:
            link.symlink_to(self.root / "projects/alpha/private.py")
        except (OSError, NotImplementedError):
            self.skipTest("symbolic links unavailable")
        with self.assertRaisesRegex(ValueError, "シンボリックリンク"):
            pages.build(self.root)
        link.unlink()
        (self.root / "_site").symlink_to(self.root / "projects", target_is_directory=True)
        with self.assertRaises(ValueError):
            pages.build(self.root)
        self.assertEqual((self.root / "projects/alpha/index.html").read_text(), "alpha")

    def test_missing_entry_page_is_rejected(self):
        self.manifest["projects"][0]["files"] = ["assets/"]
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, "index.html"):
            pages.build(self.root)


if __name__ == "__main__":
    unittest.main()
