// Chrome・Edge が、manifest.json の "key"（公開鍵）から拡張機能の ID を決める方法を、
// テストのために同じ手順で計算します。
//
//   1. "key" の Base64 を戻して、公開鍵のバイト列（DER 形式）にする
//   2. その SHA-256 を計算し、16進数の先頭32文字を取る
//   3. 16進数の各文字 0〜f を、a〜p に置き換える（0→a、1→b、…、f→p）
import { createHash } from "node:crypto";

export function extensionIdFromKey(base64Key) {
  const publicKeyBytes = Buffer.from(base64Key, "base64");
  const hex = createHash("sha256").update(publicKeyBytes).digest("hex").slice(0, 32);
  let id = "";
  for (const digit of hex) {
    id += String.fromCharCode("a".charCodeAt(0) + parseInt(digit, 16));
  }
  return id;
}
