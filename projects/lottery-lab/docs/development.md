# 開発とPythonの学習ガイド

## 元作品からの変更

元作品は、指定した回数の抽選を一度に実行し、当選回数とポイントの推移を表示するPythonコードでした。公開版では次のように広げています。

| 受け継いだこと | 加えたこと |
| --- | --- |
| 設定1〜6の当選確率と配当 | ブラウザで1回ずつ引く操作とまとめ引き |
| 消費3点、初期50点 | コレクションと前のチャレンジの記録 |
| マイナスでも指定回数まで続行 | 全設定の繰り返し比較と理論上の平均 |
| 累積確率による抽選と推移グラフ | 再現用seed、入力値の確認、CSV保存 |

発表資料にあった「全設定の平均収支の比較」「シミュレーションの複数回実行」を比較機能へ取り込みました。学生の氏名・学籍番号・提出時の出力は公開ファイルへ含めていません。

## Pythonを読む順番

学習用の本体は `lottery.py` です。Notebookのセル1にも同じコードを内包しているので、Notebookだけでも実行できます。

| 箇所 | 見る文法 | 何をしているか |
| --- | --- | --- |
| `BONUS_PROBABILITIES`、`PAYOUTS` | 辞書 | 設定ごとの確率と役ごとの配当を記録 |
| `probabilities` | リスト、`if`、関数 | 設定から抽選に使う確率表を作る |
| `pick_result` | `for`、`if`、`return` | 乱数が入った確率の区間を調べる |
| `simulate` | 変数、繰り返し | 消費と配当を足し引きし、履歴を残す |
| `compare_settings` | 二重の繰り返し | 設定と試行を変えながら結果を集計 |

例えばBIGの確率が約0.00366なら、0以上1未満の乱数のうち、最初の約0.00366の区間をBIGに割り当てます。その次の区間をREGにし、残りの役も順に足します。どの役にも入らない残りがハズレです。

1回の平均収支は `sum(確率 × 配当) - 消費ポイント` で求めます。試行ごとの収支とは異なります。回数を増やしたときの変化を観察してみましょう。

### 自分で変えてみる

1. `PAYOUTS` のBIGの配当を変え、同じseedで元の結果と比べます。
2. `play_cost` を変え、理論上の平均収支もどう変わるか調べます。
3. 繰り返し回数を増やし、平均がどのくらい変わるか比べます。

確率を書き換えるときは、各値を0〜1にし、ハズレ以外の合計を1以下にしてください。画面に入力する設定番号や回数は検証しますが、プログラムの定数を編集する際は編集した値も確認してください。

ブラウザ版の `engine.js` とPython版は同じ確率・配当を使います。乱数の実装が異なるため、同じseedで1回ずつの結果を一致させる設計にはしていません。

## ローカルで置く場所

配布ZIPを展開すると `v1.0.0` フォルダーができます。Macでは次の場所へ置けます。

```text
/Users/shogo/Dropbox/share_data/open_material/misc/apps/lottery-lab/v1.0.0
```

このフォルダーは授業リポジトリの `projects/lottery-lab/` に対応します。遊ぶだけなら `index.html` をダブルクリックしてブラウザで開けます。必要なコードとCSSはHTML内にまとめてあります。ブラウザによってローカルファイルの記録保存が制限される場合もあります。

開発中にHTTPサーバーから開く場合は、次のようにします。

```bash
cd /Users/shogo/Dropbox/share_data/open_material/misc/apps/lottery-lab/v1.0.0
python3 -m http.server 8000
```

ブラウザで `http://localhost:8000/` を開きます。サーバーはターミナルでControl+Cを押すと終了します。

## HTTPSで授業リポジトリを更新する

### GitHub Pagesの初回設定

授業リポジトリの Settings → Pages を開き、Sourceを **Deploy from a branch**、Branchを **main / (root)** にしてSaveします。設定はリポジトリ全体で1回だけ行います。

作品のURLは `https://shogo-ishikawa.github.io/2026_3Q_M3Th3/projects/lottery-lab/` です。リポジトリのトップには作品ギャラリーを置き、`.nojekyll` で静的ファイルをそのまま配信します。後から別作品を追加する場合も、`projects/作品名/` ごとにURLを分けられます。

### コードをアップロードする

初回は、配布フォルダーとは別の場所へ授業リポジトリを取得します。既に取得している場合は、その作業フォルダーを使ってください。

```bash
git clone https://github.com/shogo-ishikawa/2026_3Q_M3Th3.git \
  /Users/shogo/Dropbox/share_data/open_material/misc/apps/2026_3Q_M3Th3
```

更新前に未コミットの変更を確認し、配布内容を作品の管理ディレクトリへコピーします。

```bash
cd /Users/shogo/Dropbox/share_data/open_material/misc/apps/2026_3Q_M3Th3
git status
git pull --ff-only
mkdir -p projects/lottery-lab
rsync -av --exclude dist/ --exclude __pycache__/ \
  /Users/shogo/Dropbox/share_data/open_material/misc/apps/lottery-lab/v1.0.0/ \
  projects/lottery-lab/
git diff --stat
git add projects/lottery-lab
git commit -m "Update lottery lab"
git push origin main
```

HTTPS認証はGit Credential Managerなど通常のGitHub認証を使います。トークンをコードやURLへ書き込まないでください。

## 更新と確認

JavaScriptの確認はNode.jsで `npm test`、Pythonの確認は `python3 -m unittest discover -s tests -p 'test_*.py'` で実行できます。ブラウザ上では1回引き・まとめ引き・やり直し・比較・保存を確認します。

ブラウザ版のHTMLの元は `tools/index.template.html`、処理は `engine.js` と `app.js`、見た目は `styles.css` です。変更した後は、配布HTML・Notebook・ZIPを作り直します。

```bash
python3 tools/build_web.py
python3 tools/build_notebook.py
python3 tools/build_release.py
```

ZIPは `dist/lottery-lab_v1.0.0.zip` に作られます。提出元ファイル、個人情報、ブラウザの保存記録、テスト中の出力は含めません。
