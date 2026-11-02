"""python -m pip0 <コマンド> の入口（中身は cli.py にあります）"""

import sys

from pip0 import cli

if __name__ == "__main__":
    sys.exit(cli.main())
