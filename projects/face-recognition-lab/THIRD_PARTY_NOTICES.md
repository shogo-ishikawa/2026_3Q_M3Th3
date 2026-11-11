# 配布モデルと実行ライブラリ

FACEGATEのブラウザ版は、次の既存モデルと実行ライブラリを使います。取得元、固定した版、SHA-256は[`tools/web_assets.json`](tools/web_assets.json)に記載し、[`取得処理`](tools/fetch_web_assets.py)で照合します。学習済みモデルの出力を使うアプリで、このプロジェクトでモデルを新しく学習したものではありません。

| 配布物 | 役割 | 配布元・利用条件 |
| --- | --- | --- |
| YuNet `face_detection_yunet_2023mar.onnx` | 顔と5個の基準点の検出 | OpenCV Zoo。MIT。原文：[yunet-LICENSE.txt](docs/licences/yunet-LICENSE.txt) |
| SFace `face_recognition_sface_2021dec.onnx` | 顔から128次元の特徴量を作成 | OpenCV Zoo。Apache License 2.0。原文：[sface-LICENSE.txt](docs/licences/sface-LICENSE.txt) |
| FER+ `emotion-ferplus-8.onnx` | 表情画像を8ラベルへ分類 | ONNX Model Zoo。[モデルREADMEのMIT表記](docs/licences/ferplus-model-README.md)、[元のFER+のMIT原文](docs/licences/ferplus-LICENSE.txt)。リポジトリ全体のApache条件：[onnx-model-zoo-LICENSE.txt](docs/licences/onnx-model-zoo-LICENSE.txt) |
| ONNX Runtime Web 1.22.0 | ブラウザ内での推論 | Microsoft。MIT。原文：[onnxruntime-LICENSE.txt](docs/licences/onnxruntime-LICENSE.txt)、[ThirdPartyNotices](docs/licences/onnxruntime-ThirdPartyNotices.txt) |

モデルごとの説明と取得元は[参考資料](docs/sources.md)にも記載しています。同梱のライセンス、著作権表示、第三者表示を再配布時にも保持してください。

ブラウザ版では、モデルの後処理と入力の準備をJavaScriptで実装しています。YuNetの出力復元とSFaceの位置合わせは、OpenCVの実装と比較して検査しました。Python版の元作品とは、画像の縮小方法や登録テンプレートのまとめ方が異なります。同じ数値が必ず出ることを前提にしません。

## 学生の元作品

`local/`は授業で提出された学生作品「FACEGATE」をもとに、公開配布に向けて保存・削除・説明などを修正したものです。登録済みの顔データ、本人の写真、実測ログ、発表資料の写真・動画は含めていません。

Python版が使うOpenCV、NumPy、Pillow、Matplotlibは、インストール先の各配布物に含まれる利用条件に従います。
