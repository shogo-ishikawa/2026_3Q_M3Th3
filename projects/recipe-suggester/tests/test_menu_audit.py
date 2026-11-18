"""保存した栄養・食事区分表と、現行の全メニューを照合する。"""
from pathlib import Path
import subprocess
import sys
import unittest


class MenuAuditTest(unittest.TestCase):
    def test_bundled_csv_matches_current_recipes(self):
        root = Path(__file__).resolve().parents[1]
        audit = root / "tools" / "audit_menu_nutrition.py"
        subprocess.run([sys.executable, str(audit), "--check"], cwd=root, check=True,
                       stdout=subprocess.DEVNULL)
