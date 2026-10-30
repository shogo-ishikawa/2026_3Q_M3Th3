// lib/sanitise.js の試験：URL から鍵になりうる部分を除くこと、題名を整えること
import assert from "node:assert/strict";
import test from "node:test";

import { TITLE_MAX_CHARS, URL_MAX_CHARS, cleanTitle, cutText, sanitiseUrl } from "../lib/sanitise.js";

test("sanitiseUrl：? 以降（一時的な鍵）と # 以降を除く", () => {
  assert.equal(
    sanitiseUrl("https://files.slack.com/files-pri/T0-F0/report.pdf?t=xoxe-123456&pub_secret=abcdef#page=2"),
    "https://files.slack.com/files-pri/T0-F0/report.pdf",
  );
  assert.equal(
    sanitiseUrl("https://drive.usercontent.google.com/download?id=1AbC&export=download&confirm=t&uuid=0b1c"),
    "https://drive.usercontent.google.com/download",
  );
  assert.equal(sanitiseUrl("https://example.com/#access_token=abc"), "https://example.com/");
  assert.equal(sanitiseUrl("https://example.com/a?"), "https://example.com/a");
});

test("sanitiseUrl：ユーザー名・パスワードを除き、ポートは残す", () => {
  assert.equal(sanitiseUrl("https://user:pass@example.com:8443/a/b?x=1"), "https://example.com:8443/a/b");
  assert.equal(sanitiseUrl("http://alice@intranet.example.jp/files/a.xlsx"), "http://intranet.example.jp/files/a.xlsx");
  assert.equal(sanitiseUrl("http://[::1]:8080/p?q=1"), "http://[::1]:8080/p");
});

test("sanitiseUrl：スキームとホストは小文字、パスは空なら /、既定のポートは省く", () => {
  assert.equal(sanitiseUrl("HTTPS://Example.COM/Path/File.PDF?Q=1"), "https://example.com/Path/File.PDF");
  assert.equal(sanitiseUrl("http://example.com"), "http://example.com/");
  assert.equal(sanitiseUrl("https://example.com:443/x"), "https://example.com/x");
  assert.equal(sanitiseUrl("  https://example.com/a?b=1  "), "https://example.com/a");
});

test("sanitiseUrl：日本語のホストとパスは、ブラウザーと同じ形（Punycode、%XX）になる", () => {
  assert.equal(sanitiseUrl("https://例え.jp/パス?q=1"), "https://xn--r8jz45g.jp/%E3%83%91%E3%82%B9");
});

test("sanitiseUrl：data:、blob:、javascript:、file: などはスキームだけ", () => {
  assert.equal(sanitiseUrl("data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="), "data:");
  assert.equal(sanitiseUrl("blob:https://app.slack.com/0b1c2d3e-0000-4000-8000-000000000000"), "blob:");
  assert.equal(sanitiseUrl("javascript:alert(document.cookie)"), "javascript:");
  assert.equal(sanitiseUrl("JavaScript:void(0)"), "javascript:");
  assert.equal(sanitiseUrl("file:///C:/Users/u/Downloads/secret.pdf"), "file:");
  assert.equal(sanitiseUrl("filesystem:https://example.com/temporary/a.txt"), "filesystem:");
  assert.equal(sanitiseUrl("ftp://user:pw@ftp.example.com/a.zip"), "ftp:");
  assert.equal(sanitiseUrl("chrome://downloads/"), "chrome:");
  assert.equal(sanitiseUrl("edge://downloads/all"), "edge:");
  assert.equal(sanitiseUrl("about:blank"), "about:");
  assert.equal(sanitiseUrl("mailto:someone@example.com?subject=x"), "mailto:");
});

test("sanitiseUrl：長すぎる URL は 2048 文字で切る（? 以降を除いた後で数える）", () => {
  const longPath = "a".repeat(5000);
  const result = sanitiseUrl("https://example.com/" + longPath + "?token=" + "b".repeat(100));
  assert.equal(result.length, URL_MAX_CHARS);
  assert.equal(result, ("https://example.com/" + longPath).slice(0, URL_MAX_CHARS));
  assert.ok(!result.includes("token"));

  // ちょうど 2048 文字なら、そのまま
  const exact = "https://example.com/" + "c".repeat(URL_MAX_CHARS - "https://example.com/".length);
  assert.equal(sanitiseUrl(exact), exact);

  // 鍵が ? 以降にあれば、長くても除かれる
  assert.equal(sanitiseUrl("https://example.com/x?" + "k".repeat(10000)), "https://example.com/x");
});

test("sanitiseUrl：URL として読めないもの、文字列でないものは null", () => {
  for (const value of ["", "   ", "not a url", "http://", "https://exa mple.com/", "//example.com/p", "/relative/path", "http://user@/x"]) {
    assert.equal(sanitiseUrl(value), null, JSON.stringify(value));
  }
  for (const value of [null, undefined, 123, {}, [], true]) {
    assert.equal(sanitiseUrl(value), null, String(value));
  }
});

test("sanitiseUrl：2回かけても結果は変わらない（受け口がもう一度かけるため）", () => {
  const samples = [
    "https://files.slack.com/files-pri/T0-F0/report.pdf?t=xoxe-123",
    "https://user:pass@example.com:8443/a/b?x=1#y",
    "http://example.com",
    "https://例え.jp/パス?q=1",
    "data:text/plain,hello",
    "blob:https://example.com/0b1c",
    "https://example.com/" + "a".repeat(3000),
  ];
  for (const sample of samples) {
    const once = sanitiseUrl(sample);
    assert.equal(sanitiseUrl(once), once, sample.slice(0, 60));
  }
});

test("cleanTitle：制御文字を空白にし、前後の空白を除く", () => {
  assert.equal(cleanTitle("予算 (Channel) - ws - Slack"), "予算 (Channel) - ws - Slack");
  assert.equal(cleanTitle("a\u0000b\nc\td\u007fe\u0085f\u009fg"), "a b c d e f g");
  assert.equal(cleanTitle("\r\n  題名  \r\n"), "題名");
  assert.equal(cleanTitle("\u0000\u0001\n\t "), null);
  assert.equal(cleanTitle(""), null);
});

test("cleanTitle：512 文字（コードポイント）で切り、絵文字を壊さない", () => {
  const japanese = cleanTitle("あ".repeat(600));
  assert.equal(Array.from(japanese).length, TITLE_MAX_CHARS);

  const emoji = cleanTitle("😀".repeat(600));
  assert.equal(Array.from(emoji).length, TITLE_MAX_CHARS);
  assert.equal(emoji.length, TITLE_MAX_CHARS * 2); // 絵文字は UTF-16 で2つ分
  assert.ok(emoji.isWellFormed());

  const exact = "い".repeat(TITLE_MAX_CHARS);
  assert.equal(cleanTitle(exact), exact);
});

test("cleanTitle：壊れた文字（対のないサロゲート）は置き換え、文字列でないものは null", () => {
  assert.equal(cleanTitle("a\ud800b"), "a\ufffdb");
  for (const value of [null, undefined, 42, {}, ["title"]]) {
    assert.equal(cleanTitle(value), null, String(value));
  }
});

test("cutText：短い文字列はそのまま、長い文字列は指定の文字数まで", () => {
  assert.equal(cutText("abc", 5), "abc");
  assert.equal(cutText("abcdef", 3), "abc");
  assert.equal(cutText("😀😀😀", 2), "😀😀");
});
