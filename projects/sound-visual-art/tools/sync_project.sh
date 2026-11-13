#!/usr/bin/env bash
set -euo pipefail

# /Users/shogo/Dropbox/share_data/open_material/misc/apps/LUMEN/v1.1.1 など、
# 今回展開したバージョン自身を同期元にします。
PROJECT_SOURCE="$(cd "$(dirname "$0")/.." && pwd)"
CLASS_CHECKOUT="${1:?授業リポジトリのローカルパスを指定してください。}"
if [ ! -e "$CLASS_CHECKOUT/.git" ]; then
  git clone https://github.com/shogo-ishikawa/2026_3Q_M3Th3.git "$CLASS_CHECKOUT"
fi
if [ "$(git -C "$CLASS_CHECKOUT" remote get-url origin)" != "https://github.com/shogo-ishikawa/2026_3Q_M3Th3.git" ]; then
  echo "originのHTTPS URLが授業リポジトリと異なります。" >&2
  exit 1
fi
if [ -n "$(git -C "$CLASS_CHECKOUT" status --porcelain)" ]; then
  echo "作業中の変更を保存・コミットしてから実行してください。" >&2
  exit 1
fi
git -C "$CLASS_CHECKOUT" switch main
git -C "$CLASS_CHECKOUT" pull --ff-only
python3 "$PROJECT_SOURCE/tools/build_release.py" --stage "$CLASS_CHECKOUT/projects/sound-visual-art"
git -C "$CLASS_CHECKOUT" add -- projects/sound-visual-art
if git -C "$CLASS_CHECKOUT" diff --cached --quiet; then
  echo "変更はありません。"
  exit 0
fi
git -C "$CLASS_CHECKOUT" commit -m "Update LUMEN light art"
git -C "$CLASS_CHECKOUT" push origin main
