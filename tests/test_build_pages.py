"""共通Pages公開で作品が抜けたり、対象外ファイルが混ざったりしないことを確認。"""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


SPEC = importlib.util.spec_from_file_location("build_pages", Path(__file__).resolve().parents[1] / "tools/build_pages.py")
pages = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pages)


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
