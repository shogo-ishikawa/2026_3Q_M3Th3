// The original student's three models; immutable upstream revisions and SHA-256.
// The build downloads these assets. Browser inference uses same-origin files only.
export const RUNTIME_VERSION = '1.22.0';
export const MODEL_FILES = Object.freeze([
  Object.freeze({key:'detector', name:'YuNet（顔の検出）', path:'models-web/face_detection_yunet_2023mar.onnx', bytes:232589, sha256:'8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4'}),
  Object.freeze({key:'recognizer', name:'SFace（登録した顔との照合）', path:'models-web/face_recognition_sface_2021dec.onnx', bytes:38696353, sha256:'0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79'}),
  Object.freeze({key:'expression', name:'FER+（表情の分類）', path:'models-web/emotion-ferplus-8.onnx', bytes:35040571, sha256:'a2a2ba6a335a3b29c21acb6272f962bd3d47f84952aaffa03b60986e04efa61c'}),
]);
export const EXPRESSION_LABELS = Object.freeze(['中立','喜び','驚き','悲しみ','怒り','嫌悪','恐れ','軽蔑']);
export const EXPRESSION_KEYS = Object.freeze(['neutral','happiness','surprise','sadness','anger','disgust','fear','contempt']);
