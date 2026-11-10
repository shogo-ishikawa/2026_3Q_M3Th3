# パスワードラボ

「文字を1つ増やすと、探す時間はどれくらい変わるのでしょうか？」

長さや使える文字を変え、候補の探し方と計算方法を比べるColab教材です。短い実験で実際に探索を試し、時間がかかる場合は測定した速度から必要時間を見積もります。

**実際に使っているパスワードは入力しないでください。授業用の文字列で試しましょう。**

[Colabで開く](https://colab.research.google.com/github/shogo-ishikawa/2026_3Q_M3Th3/blob/main/projects/password-lab/password_lab.ipynb) ／ [操作マニュアル](docs/manual.md)

## 使い方

セル1から順に実行します。数字4文字と「単語＋数字」のデモがあり、文字列の入力・自動生成もできます。

| セル | 操作 |
| --- | --- |
| 1 | 実行環境を準備 |
| 2 | 文字列を入力、または長さと文字種を選んで自動生成 |
| 3 | 辞書・単語の変形・形式のヒント・総当たりを比較し、CPU・GPUの速度を測定 |
| 4 | 総当たりの所要時間を推定し、保存方式による照合コストを比較 |
| 5 | 実験条件と集計結果をZIPで保存 |

GPUは任意です。Colabの「ランタイム → ランタイムのタイプを変更」でGPUを選択し、セル1のgpu_enabledを有効にします。利用できない場合もCPUで実験できます。初回のNumba・GPUには準備時間がかかるため、探索速度とは別に表示します。

## 比べてみましょう

- 数字だけの文字列を1文字長くする。
- 同じ長さで、数字だけの場合と英字を含む場合を比べる。
- 単語に数字を付けた文字列と、自動生成した文字列を比べる。
- 同じ候補をPython・Numba・Numba並列・GPUで調べる。

結果は「発見」「打切り」「この候補群では未発見」などに分けて表示します。見つからなかったことだけで安全とは判断しません。

## この教材で測っているもの

候補の照合にはSHA-256を使います。表示する時間は、この教材の照合処理での実測・推定です。実際のサービスの突破時間を表すものではありません。

元の学生作品の「CPUとGPUの性能を比べる」という着眼点を引き継ぎ、可逆な整数変換をSHA-256による照合へ変更しました。単発のSHA-256は教材の速度比較のために使います。実際のパスワード保存には、ソルトと照合の計算を重くする仕組みが必要です。

保存するCSV・JSONには実験条件と集計結果だけを含め、入力した文字列・照合用ハッシュ・形式のヒント・探索候補は含めません。Notebookのコピーや画面出力は別なので、実際のパスワードを入力しないでください。

## コードを読んで変更する

| ファイル | 内容 |
| --- | --- |
| password_lab.ipynb | 単体で動くColab教材 |
| password_core.py | 候補生成、探索、推定 |
| hash_engines.py | 同じSHA-256を使う4種類の実行方式 |
| tools/notebook_cells.json | Notebookの説明・フォーム |
| tools/build_notebook.py | 部品を埋め込んでNotebookを生成 |
| tests/ | hashlibとの一致、範囲境界、探索、推定、Notebookの確認 |

最初はpassword_core.pyのWORDSやrule_candidatesを変えてみましょう。「何件で見つかるか」が変わる理由を考えやすい部分です。

ローカルで確認する場合は、Python 3.12以降で次を実行します。

```bash
python -m pip install -r requirements.txt ipython
python -m unittest discover -s tests -v
python tools/build_notebook.py
python tools/build_release.py
```

配布ZIPはv1.0.0というフォルダーに展開します。Macでは必要に応じて /Users/shogo/Dropbox/share_data/open_material/misc/apps/PasswordLab/v1.0.0 に置けます。この作品はクラス共通リポジトリの projects/password-lab/ で管理します。

## 参考資料

- [Python hashlib](https://docs.python.org/3/library/hashlib.html)
- [Numbaの並列処理](https://numba.readthedocs.io/en/stable/user/parallel.html)
- [CuPyの計測時の注意](https://docs.cupy.dev/en/stable/user_guide/performance.html)
- [NISTのパスワードに関する案内](https://pages.nist.gov/800-63-4/sp800-63b.html)
