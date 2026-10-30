// 受け口のファイル（native-host/ と scripts/register-native-host.ps1）が、
// 拡張機能と食い違っていないこと、Windows で正しく読める形であることの試験
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { NATIVE_HOST_NAME } from "../lib/message.js";
import { extensionIdFromKey } from "./helpers/extension-id.js";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const templateBytes = readFileSync(new URL("../../native-host/pip0.bridge.json.template", import.meta.url));
const launcherBytes = readFileSync(new URL("../../native-host/pip0-native-host.bat", import.meta.url));
const scriptBytes = readFileSync(new URL("../../scripts/register-native-host.ps1", import.meta.url));

const UTF8_BOM = [0xef, 0xbb, 0xbf];
const startsWithBom = (bytes) => bytes[0] === UTF8_BOM[0] && bytes[1] === UTF8_BOM[1] && bytes[2] === UTF8_BOM[2];

test("ひな形：Chrome・Edge の受け口の設定の形（名前、相対パス、stdio、許可する拡張機能）", () => {
  assert.equal(startsWithBom(templateBytes), false, "ブラウザーが読めるよう、BOM を付けない");
  const template = JSON.parse(templateBytes.toString("utf8"));
  assert.deepEqual(Object.keys(template).sort(), ["allowed_origins", "description", "name", "path", "type"]);
  assert.equal(template.name, "pip0.bridge");
  assert.equal(template.name, NATIVE_HOST_NAME, "拡張機能が送る相手の名前と同じ");
  assert.match(template.name, /^[a-z0-9_]+(\.[a-z0-9_]+)*$/, "Chrome が受け付ける名前の形");
  assert.match(template.description, /[぀-ヿ一-鿿]/, "説明は日本語");
  assert.equal(template.path, "pip0-native-host.bat", "設定ファイルと同じフォルダーの .bat（相対パス）");
  assert.equal(template.type, "stdio");
  assert.deepEqual(template.allowed_origins, [`chrome-extension://${extensionIdFromKey(manifest.key)}/`]);
});

test("起動用の .bat：ASCII だけ、改行は CRLF、pip0 専用の Python を -I で起動する", () => {
  const text = launcherBytes.toString("latin1");
  assert.ok(launcherBytes.every((byte) => byte < 0x80), "日本語などを含めない（cmd.exe はコードページで読むため）");
  assert.ok(text.endsWith("\r\n"), "最後の行も CRLF で終わる");
  assert.equal(text.split("\n").length - 1, text.split("\r\n").length - 1, "改行はすべて CRLF");

  const lines = text.split("\r\n").filter((line) => line !== "");
  assert.equal(lines[0], "@echo off", "コマンドを標準出力に表示しない（標準出力は返事に使う）");
  const commands = lines.filter((line) => !/^rem( |$)/i.test(line));
  assert.deepEqual(commands, ["@echo off", '"%~dp0..\\runtime\\python.exe" -I -m pip0.native_host %*']);
});

test("登録スクリプト：UTF-8（BOM 付き）、HKCU の2つのキーだけ、管理者の権限を求めない", () => {
  assert.ok(startsWithBom(scriptBytes), "Windows PowerShell 5.1 が日本語を正しく読むため、BOM を付ける");
  const text = scriptBytes.toString("utf8");
  assert.ok(text.includes("HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\$HostName"));
  assert.ok(text.includes("HKCU:\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\$HostName"));
  assert.ok(text.includes("$HostName = 'pip0.bridge'"));
  assert.ok(text.includes('[string]$InstallDir = "$env:LOCALAPPDATA\\Programs\\pip0"'));
  assert.ok(text.includes("[switch]$Unregister"));
  assert.doesNotMatch(text, /HKLM|HKEY_LOCAL_MACHINE|RunAsAdministrator|Start-Process[^\n]*RunAs/i);
  // 書き込むレジストリーの操作は、pip0.bridge のキーの作成・既定の値・削除だけ
  const registryWrites = text.match(/^\s*(?:New-Item|Set-ItemProperty|Remove-Item|Set-Item|New-ItemProperty|Remove-ItemProperty)\b.*$/gm) ?? [];
  assert.deepEqual(
    registryWrites.map((line) => line.trim()),
    [
      "New-Item -ItemType Directory -Path $hostDir | Out-Null",
      "New-Item -Path $target.Key -Force | Out-Null",
      "Set-ItemProperty -LiteralPath $target.Key -Name '(default)' -Value $manifestPath",
      "Remove-Item -LiteralPath $target.Key -Recurse",
    ],
  );
});
