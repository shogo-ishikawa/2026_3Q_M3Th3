# モデルと参考資料

## 使用するモデル

| 役割 | 名称 | 配布元 |
| --- | --- | --- |
| 顔の検出 | YuNet | [OpenCV Zoo：face_detection_yunet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) |
| 顔の特徴量 | SFace | [OpenCV Zoo：face_recognition_sface](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface) |
| 表情ラベルの分類 | FER+ | [ONNX Model Zoo：emotion_ferplus](https://github.com/onnx/models/tree/main/validated/vision/body_analysis/emotion_ferplus) |
| ブラウザでのモデル実行 | ONNX Runtime Web | [ONNX Runtimeの公式資料](https://onnxruntime.ai/docs/get-started/with-javascript/web.html) |

使用するモデルの版、取得URL、照合用ハッシュは[`tools/web_assets.json`](../tools/web_assets.json)に記載し、[`取得処理`](../tools/fetch_web_assets.py)で検査します。配布条件は[配布モデルと実行ライブラリ](../THIRD_PARTY_NOTICES.md)にまとめています。モデル全体と、それを実行するコードの利用条件は分けて確認してください。

## 処理と計算

- [OpenCV：DNN-based Face Detection And Recognition](https://docs.opencv.org/4.11.0/d0/dd4/tutorial_dnn_face.html)：検出、位置合わせ、特徴量、照合の一連の例と、評価データセットごとの基準値。
- [OpenCV：FaceRecognizerSF](https://docs.opencv.org/4.11.0/da/d09/classcv_1_1FaceRecognizerSF.html)：位置合わせ・特徴量抽出・比較のAPI。
- [ONNX Runtime：Webでモデルを実行する](https://onnxruntime.ai/docs/tutorials/web/)：ブラウザ内の推論と、モデルの読み込み・実行の考え方。

## 表情ラベルの扱い

[Microsoft FER+](https://github.com/microsoft/FERPlus)では、元の表情画像に複数の人が付けたラベルの分布を使って学習します。本人がその時に感じていた気持ちを直接測った値としては扱いません。

Barsoum, E., Zhang, C., Canton Ferrer, C. and Zhang, Z. (2016), [Training Deep Networks for Facial Expression Recognition with Crowd-Sourced Label Distribution](https://arxiv.org/abs/1608.01041), ICMI 2016.

## 写真・画面の提示と奥行き

- Ngan, M., Grother, P. and Hom, A. (2023), [Face Analysis Technology Evaluation (FATE) Part 10: Performance of Passive, Software-based Presentation Attack Detection (PAD) Algorithms](https://www.nist.gov/publications/face-analysis-technology-evaluation-fate-part-10-performance-passive-software-based), NISTIR 8491。[報告書PDF](https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=956456)。通常の2D画像を使うPADを評価し、写真や画面などの提示方法によって性能が変わることを報告しています。
- [Google AI Edge：Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker)。画像から3次元の顔の基準点や表情係数を出力するモデルの資料です。画像からの推定を、奥行きセンサーでの実測や生身の本人の証明と同一には扱いません。このアプリにFace Landmarkerを組み込んでいるという意味ではありません。

ブラウザ発展版の動作確認は、画像上の顔が指示に対応して動くかを見る実験です。写真や動画を確実に除外するPADの性能評価は実施していません。

## マスクなどの遮蔽

[NIST FRTE Face Mask Effects](https://pages.nist.gov/frvt/html/frvt_facemask.html)は、マスクの有無で照合の誤り率がどう変わるかを、同じ基準のしきい値で比較した評価です。顔の一部が隠れた場合の性能は、モデルと条件に応じた確認が必要です。

今回のSFaceによる照合で、マスクやサングラスを画像生成で補っても精度を維持できるという検証はありません。そのため、隠れた部分の生成補完と、自動的なしきい値の緩和は実装対象にしていません。

## 元作品

計算科学基礎の学生作品「FACEGATE」のPythonアプリと発表資料を出発点にしています。学生へ配布するものは、提出されたZIPを変更せずに保存した[元提出版](../original/facegate-submitted.zip)です。確認用ハッシュと扱いは[配布の説明](../original/README.md)に記載しています。

ブラウザ発展版は元作品を基に追加開発したものです。`local/`は公開用に保存・削除・起動などを調整したPython参考版で、元提出版そのものではありません。Colabは計算を追うために加えた教材です。発表に使われた顔写真、登録済みの特徴量、個人の実測ログは配布データに含めません。
