# ローカルでコードを読む・更新する

通常の利用は、[Colabの操作マニュアル](manual.md)に沿って進めてください。このページは、Pythonファイルを編集して公開版を更新する方向けです。

## 配布ZIPの置き方

`ai-music-arranger_v1.0.2.zip` を展開すると、`v1.0.2` フォルダーができます。Macでは、次の場所へ置いて作業できます。

```text
/Users/shogo/Dropbox/share_data/open_material/misc/apps/ai-music-arranger/v1.0.2
```

この配布フォルダーは、授業リポジトリの `projects/ai-music-arranger/` に対応しています。

## Notebookを更新する

Pythonファイルを変更した場合は、次のコマンドで、そのコードをNotebookにも反映します。Notebookはプログラムを内包しているため、この手順を省くとPythonファイルとNotebookの内容が異なります。

```bash
cd /Users/shogo/Dropbox/share_data/open_material/misc/apps/ai-music-arranger/v1.0.2
python3 tools/build_notebook.py
```

全コードセルを `@title` とフォーム表示のメタデータで折りたたみ、出力と実行番号を消したNotebookが生成されます。セル3〜5には入力・生成・保存の標準フォームを埋め込みます。Notebook上だけで試した変更を公開版に戻す場合は、対応する `.py` に変更を反映してから再生成します。

## HTTPSで授業リポジトリへ反映する

最初に、配布フォルダーとは別の場所へ授業リポジトリを取得します。既に取得済みの場合は、そのリポジトリを使ってください。

```bash
cd /Users/shogo/Dropbox/share_data/open_material/misc/apps
git clone https://github.com/shogo-ishikawa/2026_3Q_M3Th3.git
cd 2026_3Q_M3Th3
git switch -c update/ai-music-arranger
```

変更したファイルを `projects/ai-music-arranger/` へコピーし、差分を確認してからアップロードします。`rsync` は追加・更新だけを行い、ほかの作品は変更しません。

```bash
rsync -av \
  --exclude '.git/' --exclude 'dist/' --exclude '__pycache__/' \
  --exclude '.pytest_cache/' --exclude 'music_work/' \
  --exclude '.ai_music_arranger_runtime/' --exclude '.venv/' \
  /Users/shogo/Dropbox/share_data/open_material/misc/apps/ai-music-arranger/v1.0.2/ \
  projects/ai-music-arranger/
git diff -- projects/ai-music-arranger/
git status --short
git add projects/ai-music-arranger
git commit -m "Update AI music arranger"
git push -u origin update/ai-music-arranger
```

GitHubの認証は、Git Credential Managerなど、通常のHTTPS認証を利用します。トークンをコードやURLへ書き込まないでください。

## ローカル実行と検証

Python 3.11以降、FFmpeg、Deno 2.3以降またはNode.js 22以降が必要です。FFmpegとJavaScript実行環境は、各公式サイトまたは利用中のパッケージ管理ツールから導入します。ColabではNotebookの準備セルが確認します。

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
python tools/build_notebook.py
python -m pytest -q tests
```

Colab標準フォームはColab上で表示されます。ローカルJupyterではコード内の変数を編集して実行するか、従来の `colab_app.py` を読み込んでウィジェット版を使います。通常の利用者はColabで操作してください。

配布ZIPを作り直す場合は `python tools/build_release.py` を実行します。音源、生成音声、アップロード元の資料は配布ZIPに含めません。
