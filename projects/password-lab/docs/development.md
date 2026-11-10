# 開発と更新

作品は授業リポジトリの`projects/password-lab/`で管理します。Web版は他作品と同じGitHub Actionsから公開します。

## Macに置いて開く

配布ZIPを展開すると`v1.2.0/`になります。そのフォルダーを次の場所に置けます。

```text
/Users/shogo/Dropbox/share_data/open_material/misc/apps/PasswordLab/v1.2.0
```

ターミナルでそのフォルダーへ移動し、サーバーを起動します。

```bash
python3 tools/serve.py
```

ブラウザで`http://localhost:8000`を開きます。HTMLのダブルクリックではモジュールやWorkerが動かないため、HTTPサーバーを使います。WebGPUの利用可否はブラウザ・ドライバー・装置によります。

## Pythonの準備と確認

Python 3.12以降とNode.js 24を使います。Pythonの依存ライブラリは`requirements.txt`にまとめています。GPU用のCuPyは任意です。ColabではGPUランタイムを選び、セル1から実行すると準備されます。独自のCUDA環境では、公式案内に従って対応するCuPyを選んでください。

作品のフォルダーで次を実行します。

```bash
python3 -m pip install -r requirements.txt ipython
npm test
python3 -m unittest discover -s tests -p 'test_*.py'
python3 tools/build_notebook.py
python3 tools/build_release.py
```

`tools/build_notebook.py`は`tools/notebook_cells.json`の説明・フォームに、`password_core.py`と`hash_engines.py`を埋め込みます。Notebookのコードや説明を変えるときは元の部品を編集し、再生成します。配布ZIPは`dist/`に作られます。

Python・Numba・Numba並列・CuPyは同じSHA-256を計算し、`hashlib`との一致をテストします。Numba・CuPyが利用できない環境のテストは、その理由とともにスキップされます。GPUを模擬するテストは、実機での照合確認や速度計測とは区別してください。

WebGPUは利用開始時に既知の正答を照合し、一致しなければ速度を表示しません。CPUとGPUの準備時間を探索時間から分け、同じ方式・文字集合・長さで比較します。Web版とColab版は照合データの作り方や実装が異なるため、速度を直接比較しません。

## 変更する入口

| 変更したいこと | 編集するファイル |
| --- | --- |
| Pythonの辞書・単語の変形 | `password_core.py`の`WORDS`、`rule_candidates` |
| Pythonの実行方式 | `hash_engines.py` |
| Colabの説明と入力フォーム | `tools/notebook_cells.json` |
| Web版の辞書・規則・文字集合 | `engine.js` |
| Web版の照合・表示 | `worker.js`、`gpu.js`、`app.js` |
| Web版の見た目 | `index.html`、`styles.css` |

最初は辞書に単語を追加し、「何件で見つかるか」が変わる理由を確認してみましょう。長さ・文字種・保存方式・探索順序は、1つずつ変えると違いを追いやすくなります。

## HTTPSで授業リポジトリへ同期する

作品のフォルダーとは別に、授業リポジトリ全体を置く場所を引数に指定します。

```bash
cd /Users/shogo/Dropbox/share_data/open_material/misc/apps/PasswordLab/v1.2.0
bash tools/sync_project.sh /Users/shogo/Dropbox/share_data/open_material/misc/apps/2026_3Q_M3Th3
```

未取得ならHTTPSでcloneします。取得済みなら未コミット変更がないことを確認し、mainを更新してから、この作品だけをコピー・commit・pushします。認証が求められたらGitHubの案内に従ってください。

## 共通Pages公開

ルートの`pages-projects.json`に、この作品のHTML・CSS・JavaScriptを登録しています。NotebookやテストはGitHubで管理し、Webの公開フォルダーには含めません。更新は他作品と共通の公開成果物にまとめるため、作品ごとにPagesの公開元を切り替える必要はありません。

ルートの公開処理や登録ファイルを変えた場合は、授業リポジトリのルートでも確認します。

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
python3 tools/build_pages.py
```
