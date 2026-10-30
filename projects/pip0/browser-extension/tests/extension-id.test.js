// 拡張機能の ID の試験：manifest.json の "key" から決まる ID が、
// 受け口の許可（native-host のひな形）と pip0 本体の設定（settings.py）に書いた ID と同じであること
import assert from "node:assert/strict";
import { createPublicKey } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { extensionIdFromKey } from "./helpers/extension-id.js";

const EXPECTED_ID = "jfaghnlhhcojgeodhjalkchddhphnmhi";
const EXPECTED_ORIGIN = `chrome-extension://${EXPECTED_ID}/`;

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

test("manifest.json の key から計算した ID が jfaghnlhhcojgeodhjalkchddhphnmhi になる", () => {
  assert.equal(extensionIdFromKey(manifest.key), EXPECTED_ID);
});

test("ID の計算方法：16進数の 0〜f を a〜p に置き換えた32文字", () => {
  const id = extensionIdFromKey(manifest.key);
  assert.match(id, /^[a-p]{32}$/);
  // 別の鍵なら別の ID になる（鍵を変えると ID も変わる）
  assert.notEqual(extensionIdFromKey(Buffer.from("other key").toString("base64")), id);
});

test("key は、正しい Base64 の RSA 公開鍵（秘密鍵ではない）", () => {
  const der = Buffer.from(manifest.key, "base64");
  assert.equal(der.toString("base64"), manifest.key, "余計な文字のない Base64");
  const publicKey = createPublicKey({ key: der, format: "der", type: "spki" });
  assert.equal(publicKey.type, "public");
  assert.equal(publicKey.asymmetricKeyType, "rsa");
  assert.equal(publicKey.asymmetricKeyDetails.modulusLength, 2048);
});

test("受け口のひな形（native-host/pip0.bridge.json.template）が、この ID だけを許可している", () => {
  const templateUrl = new URL("../../native-host/pip0.bridge.json.template", import.meta.url);
  const template = JSON.parse(readFileSync(templateUrl, "utf8"));
  assert.deepEqual(template.allowed_origins, [`chrome-extension://${extensionIdFromKey(manifest.key)}/`]);
});

test("pip0 本体の設定（pip0/settings.py の ALLOWED_EXTENSION_ORIGINS）に、この ID が書かれている", (t) => {
  const settingsUrl = new URL("../../pip0/settings.py", import.meta.url);
  if (!existsSync(settingsUrl)) {
    t.skip("pip0/settings.py がない（拡張機能のフォルダーだけを取り出した場合）");
    return;
  }
  const settings = readFileSync(settingsUrl, "utf8");
  const block = settings.split("ALLOWED_EXTENSION_ORIGINS")[1] ?? "";
  assert.ok(block.includes(`"${EXPECTED_ORIGIN}"`), "ALLOWED_EXTENSION_ORIGINS に " + EXPECTED_ORIGIN + " がない");
});
