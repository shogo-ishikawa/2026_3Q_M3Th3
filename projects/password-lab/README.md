# パスワード実験室

文字を1つ増やすと、探す時間はどれくらい変わるのでしょうか。文字数・文字の種類・探し方・照合計算を変えて、違いを確かめる教材です。学生作品の「同じ候補をCPUとGPUで調べて速さを比べる」というアイデアから、Web版とColab版を用意しました。

[ブラウザで試す](https://shogo-ishikawa.github.io/2026_3Q_M3Th3/projects/password-lab/) ／ [Colabで開く](https://colab.research.google.com/github/shogo-ishikawa/2026_3Q_M3Th3/blob/main/projects/password-lab/password_lab.ipynb) ／ [使い方](docs/manual.md)

**実際に使っているパスワードは入力せず、練習用の文字列で試してください。**

## まずはWeb版で試す

1. 最初の例のまま「試してみる」を押します。
2. 辞書・よくある規則・総当たりで、どの方法が先に見つけたか確認します。
3. 文字数や使える文字を変えて生成し、結果と推定時間を比べます。

入力内容はブラウザの中で処理し、送信・保存しません。GPUがなくてもCPUで動きます。対応環境では、WebGPUで同じSHA-256総当たりも試せます。SHA-256とPBKDF2を切り替えると、照合1回の重さによる違いを体験できます。

## Colabでコードも調べる

セル1から5まで順に実行します。リンクからそのまま実行でき、変更を残したい場合は「ドライブにコピーを保存」を使います。

| セル | 操作 |
| --- | --- |
| 1 | 実行環境を準備 |
| 2 | デモを選ぶ、入力する、または文字数と文字種を指定して生成 |
| 3 | 辞書・単語の変形・形式のヒント・総当たりを比較し、Python・Numba・Numba並列・GPUの速さを測定 |
| 4 | 総当たりの時間を推定し、SHA-256とPBKDF2の照合コストを比較 |
| 5 | 実験条件と集計結果をZIPで保存 |

GPUは任意です。Colabの「ランタイム → ランタイムのタイプを変更」でGPUを選び、セル1の`gpu_enabled`を有効にします。利用できない場合もCPUで続けられます。

ColabはGoogle上で動き、フォームや画面出力がNotebookに残る場合があります。結果ZIPには入力文字列・照合用ハッシュ・形式のヒント・探索候補を含めませんが、Notebookを共有するときは入力と出力も確認してください。

## 結果を読むときに

「発見」は実際に候補を照合した結果です。時間内に見つからなかった場合は、実測した速度から総当たりの時間を見積もります。未発見や長い推定時間は、安全の証明ではありません。

照合には実際のSHA-256を使います。元作品の整数変換から方式を変更し、CPUとGPUで同じ計算を比較できるようにしました。ただし、単発のSHA-256は速度比較のための教材条件です。PBKDF2の反復回数も実用の推奨設定ではありません。表示はこの端末・照合方式・オフライン条件での目安であり、実サービスの突破時間を示しません。[前提と出典](docs/model-notes.md)も参照できます。

## コードを読む入口

| ファイル | 内容 |
| --- | --- |
| `password_lab.ipynb` | 単体で動くColab教材 |
| `password_core.py` | Pythonの候補生成・探索・推定 |
| `hash_engines.py` | 同じSHA-256を使うPython・Numba・Numba並列・CuPyの照合 |
| `engine.js` | Web版の文字集合・候補生成・SHA-256・辞書・規則 |
| `worker.js` | 画面を止めずに行うCPU照合と速度計測 |
| `gpu.js` | WebGPUによる任意のSHA-256照合 |
| `app.js` | Web版の入力から結果表示までの流れ |
| `tools/notebook_cells.json` | Colabの説明と入力フォーム |

Pythonでは、`for`で候補を作り、`if`で一致を調べ、関数で処理を分けています。最初は`password_core.py`の`WORDS`や`rule_candidates`を変えるところから試せます。

配布ZIPは`v1.1.0/`に展開します。Macでは`/Users/shogo/Dropbox/share_data/open_material/misc/apps/PasswordLab/v1.1.0`に置けます。起動・検証・HTTPSでの更新方法は[開発手順](docs/development.md)にまとめています。
