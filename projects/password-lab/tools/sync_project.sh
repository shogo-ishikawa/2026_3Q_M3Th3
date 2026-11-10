#!/usr/bin/env bash
set -euo pipefail

# ZIPを展開したバージョンの場所から、授業リポジトリの同じ作品だけを更新します。
PROJECT_SOURCE="$(cd "$(dirname "$0")/.." && pwd)"
CLASS_CHECKOUT="${1:?授業リポジトリのローカルパスを引数に指定してください。}"
if [ ! -d "$CLASS_CHECKOUT/.git" ]; then
  git clone https://github.com/shogo-ishikawa/2026_3Q_M3Th3.git "$CLASS_CHECKOUT"
fi
if [ "$(git -C "$CLASS_CHECKOUT" remote get-url origin)" != "https://github.com/shogo-ishikawa/2026_3Q_M3Th3.git" ]; then
  echo "originが指定の授業リポジトリと異なります。HTTPSのURLを確認してください。" >&2
  exit 1
fi
if [ -n "$(git -C "$CLASS_CHECKOUT" status --porcelain)" ]; then
  echo "作業中の変更があります。先に保存・コミットしてから実行してください。" >&2
  exit 1
fi
git -C "$CLASS_CHECKOUT" switch main
git -C "$CLASS_CHECKOUT" pull --ff-only
mkdir -p "$CLASS_CHECKOUT/projects/password-lab"
rsync -a --exclude dist --exclude __pycache__ --exclude node_modules --exclude '.openai' --exclude '.git' "$PROJECT_SOURCE/" "$CLASS_CHECKOUT/projects/password-lab/"
git -C "$CLASS_CHECKOUT" add -- projects/password-lab
if git -C "$CLASS_CHECKOUT" diff --cached --quiet; then
  echo "変更はありません。"
  exit 0
fi
git -C "$CLASS_CHECKOUT" commit -m "Update password lab"
git -C "$CLASS_CHECKOUT" push origin main
