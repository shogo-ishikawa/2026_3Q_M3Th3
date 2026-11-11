#!/usr/bin/env bash
# vX.Y.Zフォルダーの公開用ソースを、同じ授業リポジトリへHTTPSで送ります。
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CHECKOUT_DIR="${1:-$(dirname "$PROJECT_DIR")/repository}"
REPOSITORY_URL="https://github.com/shogo-ishikawa/2026_3Q_M3Th3.git"
VERSION="$(tr -d '\r\n' < "$PROJECT_DIR/VERSION")"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "VERSIONを確認してください。" >&2; exit 1
fi
if [[ ! -d "$CHECKOUT_DIR/.git" ]]; then
  git clone "$REPOSITORY_URL" "$CHECKOUT_DIR"
fi
if [[ "$(git -C "$CHECKOUT_DIR" remote get-url origin)" != "$REPOSITORY_URL" ]]; then
  echo "指定先のoriginが授業リポジトリと一致しません。" >&2; exit 1
fi
if [[ -n "$(git -C "$CHECKOUT_DIR" status --porcelain)" ]]; then
  echo "指定先に未確定の変更があります。先に保存・整理してください。" >&2; exit 1
fi
git -C "$CHECKOUT_DIR" fetch origin main
BRANCH="update/facegate-v$VERSION-$(date +%Y%m%d%H%M%S)"
git -C "$CHECKOUT_DIR" switch -c "$BRANCH" origin/main
python3 - "$PROJECT_DIR" "$CHECKOUT_DIR" <<'PY'
from pathlib import Path
import shutil
import sys

source = Path(sys.argv[1])
destination = Path(sys.argv[2]) / 'projects' / 'face-recognition-lab'
sys.path.insert(0, str(source / 'tools'))
import build_release

# 実行データや大きなモデルは送らず、公開用ソースだけを扱います。
for path in build_release.public_sources(source):
    target = destination / path.relative_to(source)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, target)
PY
git -C "$CHECKOUT_DIR" add -- projects/face-recognition-lab
if git -C "$CHECKOUT_DIR" diff --cached --quiet; then
  echo "送る変更はありません。"; exit 0
fi
git -C "$CHECKOUT_DIR" commit -m "Update FaceGate to v$VERSION"
git -C "$CHECKOUT_DIR" push -u origin "$BRANCH"
echo "変更を送信しました。GitHubでこのブランチのPull Requestを開けます。"
