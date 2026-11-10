# Web作品をGitHub Pagesで公開する

このクラスのWeb作品は、1つのGitHub Actions workflowでまとめて公開します。作品ごとに別のデプロイを行うと、後の公開でほかの作品が抜けるためです。

## 最初の設定

リポジトリの Settings → Pages で、Sourceを **GitHub Actions** にします。以後はmainへの更新でテスト・公開が進みます。Actionsの「Publish class projects to Pages」から手動実行することもできます。

プルリクエストではテストと公開フォルダーの作成まで行い、本番へは公開しません。mainへの反映後に、同じworkflowが全作品をまとめて公開します。

| 公開するもの | URLの末尾 |
| --- | --- |
| 作品ギャラリー | `/2026_3Q_M3Th3/` |
| くじびきラボ | `/2026_3Q_M3Th3/projects/lottery-lab/` |

Colab教材は、ギャラリーからGitHub上のNotebookを開きます。Notebookや提出資料をPages用にコピーする必要はありません。

## 新しいWeb作品を加える

作品のコードは `projects/作品名/` に置きます。`pages-projects.json` の `projects` に、次のような設定を追加してください。今ある作品の設定も残します。

```json
{
  "source": "projects/example-app/dist",
  "destination": "projects/example-app",
  "files": ["index.html", "assets/"]
}
```

`source`は公開するファイルがある場所、`destination`は公開先のURLに対応する場所です。`files`には公開するHTML・画像・CSS・JavaScriptなどだけを列挙します。ディレクトリを指定した場合は、その中の通常ファイルをまとめてコピーします。隠しファイルとシンボリックリンクは公開しません。

Reactなどビルドが必要な作品では、`.github/workflows/pages.yml` の「Assemble all published projects」より前に、依存関係の導入とビルドの手順を追加してください。公開先のパスに合うbase URLも設定します。完成済みのHTMLだけならビルド手順は不要です。

ギャラリーの `index.html` にも、新しい作品へのリンクを追加します。すべての作品を同じ公開フォルダーへ集めるため、既存作品のURLを変えずに追加できます。

## 手元で公開内容を確認する

リポジトリのトップで次を実行します。

```bash
python3 projects/lottery-lab/tools/build_web.py
python3 tools/build_pages.py
```

`_site/` にギャラリーと登録済みのWeb作品ができます。公開物はこのフォルダーだけです。リポジトリ全体、未登録の作品、学習用コード、テスト、発表資料を一括でアップロードしません。

公開用フォルダーは毎回作り直すため、`_site/` のファイルは直接編集しないでください。元のコードと公開設定を編集して再生成します。
