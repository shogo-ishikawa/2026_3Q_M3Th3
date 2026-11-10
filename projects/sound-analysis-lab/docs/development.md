# 開発と更新

この作品は授業リポジトリの`projects/sound-analysis-lab/`で管理します。Web版は音の見方を知る入口、Colab版は音源の入力から分離・分析・比較・保存までを行う教材です。

## Macに置いて開く

配布ZIPを展開すると`v1.0.0/`になります。そのフォルダーを次の場所に置けます。

```text
/Users/shogo/Dropbox/share_data/open_material/misc/apps/SoundAnalysisLab/v1.0.0
```

ターミナルでそのフォルダーへ移動し、Web版を開きます。

```bash
python3 tools/serve.py
```

表示されたURLをブラウザで開いてください。終了するときはターミナルでControl+Cを押します。Colab版は公開Notebookへのリンクから開けるため、手元へのPythonライブラリの導入は必須ではありません。

## コードを変更して確認する

ローカルでPython側も調べる場合は、依存ライブラリを導入してから確認します。

```bash
python3 -m pip install -r requirements.txt
python3 tools/build_notebook.py
python3 -m unittest discover -s tests -p 'test_*.py'
python3 tools/build_release.py
```

実音源の分離にはDemucs、PyTorchと学習済みモデルが必要です。モデルの読み込みには公式のget_model、適用にはapply_modelを使います。モデルの実行はCPUだけでも可能ですが、処理時間やメモリの使用量は音源と環境で変わります。YouTube取得、モデル取得、GPU利用は、それぞれ別に確認してください。

| ファイル | 主な内容 |
| --- | --- |
| sound_core.py | 合成音、周波数分析、指標、グラフ、音の加工 |
| sound_workflow.py | 入力、区間選択、Demucs分離、比較と保存の流れ |
| tools/notebook_cells.json | Colabの説明と入力フォーム |
| tools/build_notebook.py | Pythonのコードとフォームを埋め込んでNotebookを生成 |
| demo_engine.js・app.js | Webの合成音と操作 |
| index.html | Webの解説とページ構成 |

Notebookは元のコードと説明から再生成します。生成したNotebookだけを編集すると、再生成時に変更が消えてしまいます。コードを変えるときは対応するPythonモジュール、操作や説明を変えるときはNotebookの生成元も更新します。

## 初めに変えてみるところ

| 変更 | 確かめること |
| --- | --- |
| 合成音の基本周波数 | 波の繰り返しとスペクトルの位置 |
| 倍音の割合 | 基本周波数が同じときの音色と重心 |
| 同じ音の振幅 | RMSと波形の大きさ、重心の変化 |
| 分析する区間 | イントロ・歌・間奏などでの成分の違い |
| フィルターやゲートの設定 | 加工前後で残る音と失われる音 |

比較では1つずつ条件を変えます。分析区間、STFTの窓と刻み幅、無音判定、グラフの基準をそろえてください。パートごとの個別の音量正規化を加えると元の音量比が変わるため、解析用の音声と試聴用の倍率を分けて扱います。

合成デモは内容が分かっているので、処理の正しさを確認する入口にもなります。実際の楽曲に対しては、元トラックがない限り分離精度そのものを測れません。グラフや重心だけでモデルの性能を評価しないでください。

## HTTPSで授業リポジトリへ同期する

作品のフォルダーとは別に、授業リポジトリ全体を置く場所を引数に指定します。

```bash
cd /Users/shogo/Dropbox/share_data/open_material/misc/apps/SoundAnalysisLab/v1.0.0
bash tools/sync_project.sh /Users/shogo/Dropbox/share_data/open_material/misc/apps/2026_3Q_M3Th3
```

このコマンドは授業リポジトリのmainを更新し、作品のファイルをコピーしてコミット・pushまで行います。未コミットの変更がある場合は停止します。認証が求められたらGitHubの案内に従ってください。

Notebookを公開する前に出力と実行番号を消し、氏名・学籍番号・ローカルパス・入力URLなどがコードや結果に残っていないか確認します。元の楽曲音源や分離結果は、利用条件を確認せず配布ZIPやリポジトリへ加えないでください。

## 共通Pages公開

Web版は、リポジトリ共通のGitHub Actionsで既存作品と一緒に公開します。作品を追加するたびにPagesの公開元を切り替える必要はありません。

共通の公開設定を変更した場合は、リポジトリのルートでも確認します。

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
python3 tools/build_pages.py
```

動作を確認した範囲と未確認の環境は、検証記録に分けて残します。デモの成功を、実音源の分離やYouTube取得が成功した確認の代わりにはしません。
