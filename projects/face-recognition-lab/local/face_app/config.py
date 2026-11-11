"""共通設定。数値はここを変えれば全体に反映されます。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = ROOT / "models"
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "face_db.npz"
DB_META_PATH = DATA_DIR / "face_db.json"
LOG_DIR = ROOT / "logs"
REPORT_DIR = ROOT / "reports"
SHOT_DIR = ROOT / "screenshots"

# --- モデル(初回に python main.py download で取得) ---
MODELS = {
    "detector": {
        "file": "face_detection_yunet_2023mar.onnx",
        "sha256": "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
        "bytes": 232589,
        "url": "https://media.githubusercontent.com/media/opencv/opencv_zoo/48b10fa505aeb51fbd127fc60a5c660040e823b7/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
    },
    "recognizer": {
        "file": "face_recognition_sface_2021dec.onnx",
        "sha256": "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
        "bytes": 38696353,
        "url": "https://media.githubusercontent.com/media/opencv/opencv_zoo/48b10fa505aeb51fbd127fc60a5c660040e823b7/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
    },
    "emotion": {
        "file": "emotion-ferplus-8.onnx",
        "sha256": "a2a2ba6a335a3b29c21acb6272f962bd3d47f84952aaffa03b60986e04efa61c",
        "bytes": 35040571,
        "url": "https://media.githubusercontent.com/media/onnx/models/c5cae0f1942c8d7727372c7b1f6b485aa39e4421/validated/vision/body_analysis/emotion_ferplus/model/emotion-ferplus-8.onnx",
    },
}

# 公開ZIPにはブラウザ版と同じモデルを同梱する。単体コピー時だけ従来の保存先を使う。
_shared_models = ROOT.parent / "models-web"
if all((_shared_models / model["file"]).is_file() for model in MODELS.values()):
    MODEL_DIR = _shared_models

# --- 照合 ---
# OpenCVの例の0.363は特定の評価条件での参考値。
# 学生作品の実験値0.70から開始し、別の確認用データで調整する。
DEFAULT_THRESHOLD = 0.70
DETECT_SCORE = 0.8          # 顔検出の信頼度しきい値

# --- 表情ラベル(FER+ の出力順) ---
EMOTIONS_EN = ["neutral", "happiness", "surprise", "sadness",
               "anger", "disgust", "fear", "contempt"]
EMOTIONS_JA = ["中立", "喜び", "驚き", "悲しみ", "怒り", "嫌悪", "恐れ", "軽蔑"]
# 表示色 (BGR)
EMOTION_COLORS = [
    (180, 180, 180), (60, 200, 255), (255, 200, 60), (220, 120, 40),
    (40, 40, 230), (60, 160, 60), (160, 60, 160), (120, 120, 60),
]
# 表情ラベルの合成スコア用の便宜的な重み。本人の気持ちや場の雰囲気の測定値ではない。
MOOD_WEIGHTS = [0.0, 1.0, 0.3, -1.0, -1.0, -0.8, -0.7, -0.5]

# --- 平滑化(多数決) ---
VOTE_WINDOW = 15            # 直近何フレームで多数決するか
VOTE_MIN_RATIO = 0.6        # 何割以上一致したら確定表示するか
EMOTION_EMA = 0.3           # 表情スコアの指数移動平均の係数

# --- 撮影条件(品質)の基準 ---
QUALITY = {
    "min_face": 80,          # 顔の短辺(px)
    "bright_low": 70, "bright_high": 190,
    "min_contrast": 30,
    "min_sharpness": 40,     # ラプラシアン分散
    "max_yaw": 0.30,         # 正面からのずれ(目の間隔に対する鼻のずれ)
    "max_roll": 15.0,        # 顔の傾き(度)
}
REGISTER_MIN_QUALITY = 70    # この点数未満の画像は登録しない

# --- 動作チャレンジ(動きの確認実験) ---
CHALLENGE_STEPS = 3
CHALLENGE_STEP_SEC = 6.0
YAW_TURN = 0.25
SMILE_PROB = 0.55
