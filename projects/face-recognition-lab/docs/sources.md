# モデルと参考資料

## 使用するモデル

| 役割 | 名称 | 配布元 |
| --- | --- | --- |
| 顔の検出 | YuNet | [OpenCV Zoo：face_detection_yunet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) |
| 顔の特徴量 | SFace | [OpenCV Zoo：face_recognition_sface](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface) |
| 表情ラベルの分類 | FER+ | [ONNX Model Zoo：emotion_ferplus](https://github.com/onnx/models/tree/main/validated/vision/body_analysis/emotion_ferplus) |
| ブラウザでのモデル実行 | ONNX Runtime Web | [ONNX Runtimeの公式資料](https://onnxruntime.ai/docs/get-started/with-javascript/web.html) |

使用するモデルの版、取得URL、照合用ハッシュは[`tools/fetch_web_assets.py`](../tools/fetch_web_assets.py)に、配布条件は[配布モデルと実行ライブラリ](../THIRD_PARTY_NOTICES.md)に記載しています。モデル全体と、それを実行するコードの利用条件は分けて確認してください。

## 処理と計算

- [OpenCV：DNN-based Face Detection And Recognition](https://docs.opencv.org/4.11.0/d0/dd4/tutorial_dnn_face.html)：検出、位置合わせ、特徴量、照合の一連の例と、評価データセットごとの基準値。
- [OpenCV：FaceRecognizerSF](https://docs.opencv.org/4.11.0/da/d09/classcv_1_1FaceRecognizerSF.html)：位置合わせ・特徴量抽出・比較のAPI。
- [ONNX Runtime：Webでモデルを実行する](https://onnxruntime.ai/docs/tutorials/web/)：ブラウザ内の推論と、モデルの読み込み・実行の考え方。

## 表情ラベルの扱い

[Microsoft FER+](https://github.com/microsoft/FERPlus)では、元の表情画像に複数の人が付けたラベルの分布を使って学習します。本人がその時に感じていた気持ちを直接測った値としては扱いません。

Barsoum, E., Zhang, C., Canton Ferrer, C. and Zhang, Z. (2016), [Training Deep Networks for Facial Expression Recognition with Crowd-Sourced Label Distribution](https://arxiv.org/abs/1608.01041), ICMI 2016.

## 元作品

計算科学基礎の学生作品「FACEGATE」のPythonアプリと発表資料を出発点にしています。Python版を`local/`に残し、公開URLから試せるブラウザ版と、計算を追うためのColab教材を加えています。発表に使われた顔写真、登録済みの特徴量、個人の実測ログは配布データに含めません。
