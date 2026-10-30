// manifest.json の試験：必要な権限だけを持ち、外へ送る経路を増やす項目がないこと
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const extensionDir = fileURLToPath(new URL("..", import.meta.url));
const manifestBytes = readFileSync(join(extensionDir, "manifest.json"));
const manifest = JSON.parse(manifestBytes.toString("utf8"));

test("基本の項目（Manifest V3、名前、版、Chrome 116 以上）", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "pip0 連携");
  assert.equal(manifest.version, "0.1.0");
  assert.equal(manifest.minimum_chrome_version, "116");
});

test("説明は日本語で、Chrome の上限（132文字）以内", () => {
  assert.match(manifest.description, /[぀-ヿ一-鿿]/);
  assert.ok(Array.from(manifest.description).length <= 132, `${Array.from(manifest.description).length} 文字`);
});

test("権限はちょうど downloads、nativeMessaging、tabs、storage の4つ", () => {
  assert.deepEqual(manifest.permissions, ["downloads", "nativeMessaging", "tabs", "storage"]);
});

test("サイトへの権限、コンテンツスクリプト、外部との接続口などの項目がない", () => {
  const forbiddenKeys = [
    "host_permissions", // Web サイトの内容を読む・書く権限
    "optional_permissions", // 後から権限を求める
    "optional_host_permissions",
    "content_scripts", // Web ページの中で動くスクリプト
    "web_accessible_resources", // Web ページから拡張機能のファイルを読ませる
    "externally_connectable", // Web ページ・ほかの拡張機能からの接続口
    "update_url", // 更新の確認のためにサーバーへ接続する
    "oauth2",
    "declarative_net_request",
    "sandbox",
    "chrome_url_overrides",
    "devtools_page",
    "options_page",
    "options_ui",
    "side_panel",
  ];
  for (const key of forbiddenKeys) {
    assert.equal(key in manifest, false, `manifest.json に ${key} がある`);
  }
});

test("シークレット ウィンドウでは動かない（incognito: not_allowed）", () => {
  assert.equal(manifest.incognito, "not_allowed");
});

test("サービスワーカーは background.js（ES モジュール）", () => {
  assert.deepEqual(manifest.background, { service_worker: "background.js", type: "module" });
  assert.ok(existsSync(join(extensionDir, "background.js")));
});

test("ツールバーのアイコン：説明があり、ポップアップはない（クリックで接続を確かめるため）", () => {
  assert.equal(typeof manifest.action.default_title, "string");
  assert.ok(manifest.action.default_title.startsWith("pip0 連携"));
  assert.equal("default_popup" in manifest.action, false);
});

test("拡張機能のページからの通信をブラウザーに断らせる（connect-src 'none'）", () => {
  const policy = manifest.content_security_policy.extension_pages;
  const directives = policy.split(";").map((part) => part.trim()).filter((part) => part !== "");
  assert.ok(directives.includes("connect-src 'none'"), policy);
  assert.ok(directives.includes("script-src 'self'"), policy);
  assert.ok(directives.includes("object-src 'self'"), policy);
  assert.equal("sandbox" in manifest.content_security_policy, false);
});

test("Chrome が読み込めるファイル構成（UTF-8、BOM なし、「_」で始まる名前がない）", () => {
  assert.notDeepEqual([...manifestBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], "manifest.json に BOM がある");

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const problems = [];
  function walk(dir, relative) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = relative === "" ? entry.name : relative + "/" + entry.name;
      if (entry.name.startsWith("_")) {
        problems.push(`${path}：「_」で始まる名前は Chrome が予約しているため、読み込めません`);
      }
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), path);
      } else if (/\.(js|json|html|css)$/.test(entry.name)) {
        try {
          decoder.decode(readFileSync(join(dir, entry.name)));
        } catch (error) {
          problems.push(`${path}：UTF-8 ではない`);
        }
      }
    }
  }
  walk(extensionDir, "");
  assert.deepEqual(problems, []);
});
