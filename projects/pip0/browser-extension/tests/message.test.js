// lib/message.js の試験：docs/ipc-protocol.md 5節のメッセージを作ること
import assert from "node:assert/strict";
import test from "node:test";

import {
  NATIVE_HOST_NAME,
  PAGE_CAPTURE,
  PROTOCOL_VERSION,
  buildDownloadMessage,
  buildPageSnapshot,
  buildPingMessage,
  detectBrowser,
  readHostReply,
} from "../lib/message.js";

// chrome.downloads.search が返す DownloadItem の例（Slack からのダウンロード）
function sampleItem(changes = {}) {
  return {
    id: 42,
    url: "https://files.slack.com/files-pri/T0-F0/report.pdf?t=xoxe-123456",
    finalUrl: "https://files.slack.com/files-pri/T0-F0/report.pdf?t=xoxe-123456&origin_team=T0",
    referrer: "https://app.slack.com/client/T0/C0?cdn_fallback=1",
    filename: "C:\\Users\\u\\Downloads\\report.pdf",
    mime: "application/pdf",
    startTime: "2026-10-29T03:12:00.000Z",
    endTime: "2026-10-29T03:12:04.500Z",
    fileSize: 123456,
    totalBytes: 123456,
    bytesReceived: 123456,
    danger: "safe",
    incognito: false,
    state: "complete",
    paused: false,
    exists: true,
    byExtensionId: undefined,
    ...changes,
  };
}

function sampleSnapshot() {
  return {
    tabUrl: "https://app.slack.com/client/T0/C0",
    tabTitle: "予算 (Channel) - ws - Slack",
    capturedAt: "2026-10-29T03:12:00.010Z",
  };
}

test("定数：受け口の名前と版", () => {
  assert.equal(NATIVE_HOST_NAME, "pip0.bridge");
  assert.equal(PROTOCOL_VERSION, 1);
  assert.equal(PAGE_CAPTURE, "active_tab_at_download_start");
});

test("buildDownloadMessage：docs/ipc-protocol.md 5節の形（URL は ? 以降を除く）", () => {
  const message = buildDownloadMessage(sampleItem(), sampleSnapshot(), "chrome");
  assert.deepEqual(message, {
    type: "download_completed",
    protocol: 1,
    browser: "chrome",
    download: {
      id: 42,
      url: "https://files.slack.com/files-pri/T0-F0/report.pdf",
      finalUrl: "https://files.slack.com/files-pri/T0-F0/report.pdf",
      referrer: "https://app.slack.com/client/T0/C0",
      filename: "C:\\Users\\u\\Downloads\\report.pdf",
      mime: "application/pdf",
      startTime: "2026-10-29T03:12:00.000Z",
      endTime: "2026-10-29T03:12:04.500Z",
      fileSize: 123456,
      danger: "safe",
      incognito: false,
    },
    page: {
      tabUrl: "https://app.slack.com/client/T0/C0",
      tabTitle: "予算 (Channel) - ws - Slack",
      capturedAt: "2026-10-29T03:12:00.010Z",
      capture: "active_tab_at_download_start",
    },
  });
});

test("buildDownloadMessage：JSON にしても内容が変わらない（undefined の欄がない）", () => {
  const cases = [
    buildDownloadMessage(sampleItem(), sampleSnapshot(), "edge"),
    buildDownloadMessage(sampleItem({ finalUrl: undefined, referrer: "", endTime: undefined, mime: "", danger: undefined }), undefined, null),
  ];
  for (const message of cases) {
    assert.deepEqual(JSON.parse(JSON.stringify(message)), message);
  }
});

test("buildDownloadMessage：シークレットのダウンロードは null（送らない）", () => {
  assert.equal(buildDownloadMessage(sampleItem({ incognito: true }), sampleSnapshot(), "chrome"), null);
  // シークレットかどうか分からないものも送らない
  assert.equal(buildDownloadMessage(sampleItem({ incognito: undefined }), sampleSnapshot(), "chrome"), null);
});

test("buildDownloadMessage：ダウンロードがない・番号や保存先がないときは null", () => {
  assert.equal(buildDownloadMessage(undefined, null, "chrome"), null);
  assert.equal(buildDownloadMessage(null, null, "chrome"), null);
  assert.equal(buildDownloadMessage(sampleItem({ filename: "" }), null, "chrome"), null);
  assert.equal(buildDownloadMessage(sampleItem({ filename: undefined }), null, "chrome"), null);
  assert.equal(buildDownloadMessage(sampleItem({ id: "42" }), null, "chrome"), null);
});

test("buildDownloadMessage：開始時の控えがなければ page の欄はすべて null", () => {
  for (const snapshot of [undefined, null]) {
    const message = buildDownloadMessage(sampleItem(), snapshot, "chrome");
    assert.deepEqual(message.page, { tabUrl: null, tabTitle: null, capturedAt: null, capture: null });
  }
});

test("buildDownloadMessage：分からない値は null にする", () => {
  const message = buildDownloadMessage(
    sampleItem({
      finalUrl: undefined,
      referrer: "",
      mime: "",
      endTime: undefined,
      startTime: "not a time",
      fileSize: -1,
      danger: undefined,
    }),
    null,
    "chrome",
  );
  assert.equal(message.download.finalUrl, null);
  assert.equal(message.download.referrer, null);
  assert.equal(message.download.mime, null);
  assert.equal(message.download.endTime, null);
  assert.equal(message.download.startTime, null);
  assert.equal(message.download.fileSize, null);
  assert.equal(message.download.danger, null);
  assert.equal(message.download.incognito, false);
});

test("buildDownloadMessage：data:・blob: のダウンロードは、スキームだけを送る", () => {
  const message = buildDownloadMessage(
    sampleItem({ url: "data:image/png;base64,iVBORw0KGgo=", finalUrl: "blob:https://example.com/0b1c", referrer: "https://example.com/page?session=abc" }),
    null,
    "chrome",
  );
  assert.equal(message.download.url, "data:");
  assert.equal(message.download.finalUrl, "blob:");
  assert.equal(message.download.referrer, "https://example.com/page");
});

test("buildDownloadMessage：控えの値も、送る前にもう一度整える", () => {
  const snapshot = {
    tabUrl: "https://app.slack.com/client/T0/C0?token=secret",
    tabTitle: "題名\n二行目",
    capturedAt: "2026-10-29T03:12:00.010Z",
  };
  const message = buildDownloadMessage(sampleItem(), snapshot, "chrome");
  assert.equal(message.page.tabUrl, "https://app.slack.com/client/T0/C0");
  assert.equal(message.page.tabTitle, "題名 二行目");
});

test("buildDownloadMessage：browser は chrome／edge／chromium 以外なら null", () => {
  assert.equal(buildDownloadMessage(sampleItem(), null, "edge").browser, "edge");
  assert.equal(buildDownloadMessage(sampleItem(), null, "chromium").browser, "chromium");
  assert.equal(buildDownloadMessage(sampleItem(), null, "firefox").browser, null);
  assert.equal(buildDownloadMessage(sampleItem(), null, undefined).browser, null);
});

test("buildPageSnapshot：前面のタブの URL を整え、題名を 512 文字までにし、時刻を付ける", () => {
  const tab = {
    id: 7,
    windowId: 1,
    active: true,
    incognito: false,
    url: "https://user:pw@app.slack.com/client/T0/C0?redir=1#msg",
    title: "予算\t(Channel) - ws - Slack" + "x".repeat(1000),
  };
  const snapshot = buildPageSnapshot(tab, new Date("2026-10-29T03:12:00.010Z"));
  assert.equal(snapshot.tabUrl, "https://app.slack.com/client/T0/C0");
  assert.equal(Array.from(snapshot.tabTitle).length, 512);
  assert.ok(snapshot.tabTitle.startsWith("予算 (Channel) - ws - Slack"));
  assert.equal(snapshot.capturedAt, "2026-10-29T03:12:00.010Z");
  assert.deepEqual(Object.keys(snapshot).sort(), ["capturedAt", "tabTitle", "tabUrl"]);
});

test("buildPageSnapshot：タブがない・シークレットのタブは null", () => {
  assert.equal(buildPageSnapshot(undefined, new Date()), null);
  assert.equal(buildPageSnapshot(null, new Date()), null);
  assert.equal(buildPageSnapshot({ url: "https://example.com/", title: "x", incognito: true }, new Date()), null);
});

test("buildPageSnapshot：URL や題名がないタブ（読めないページ等）は、その欄を null にする", () => {
  const snapshot = buildPageSnapshot({ incognito: false }, new Date("2026-10-29T00:00:00Z"));
  assert.deepEqual(snapshot, { tabUrl: null, tabTitle: null, capturedAt: "2026-10-29T00:00:00.000Z" });
  assert.equal(buildPageSnapshot({ incognito: false, url: "chrome://newtab/", title: "新しいタブ" }, new Date()).tabUrl, "chrome:");
});

test("buildPingMessage：接続の確認用", () => {
  assert.deepEqual(buildPingMessage(), { type: "ping", protocol: 1 });
});

test("detectBrowser：userAgentData.brands で判断する", () => {
  const brands = (...names) => ({ userAgentData: { brands: names.map((brand) => ({ brand, version: "130" })) } });
  assert.equal(detectBrowser(brands("Google Chrome", "Chromium", "Not?A_Brand")), "chrome");
  assert.equal(detectBrowser(brands("Not_A Brand", "Chromium", "Microsoft Edge")), "edge");
  assert.equal(detectBrowser(brands("Chromium", "Not=A?Brand")), "chromium");
  assert.equal(detectBrowser(brands("Opera", "Chromium", "Not.A/Brand")), "chromium");
});

test("detectBrowser：userAgentData がなければ User-Agent の文字列で判断する", () => {
  const edge = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";
  const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
  const chromium = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chromium/130.0.0.0 Chrome/130.0.0.0 Safari/537.36";
  assert.equal(detectBrowser({ userAgent: edge }), "edge");
  assert.equal(detectBrowser({ userAgent: chrome }), "chrome");
  assert.equal(detectBrowser({ userAgent: chromium }), "chromium");
  // brands に知っている名前がなければ、User-Agent で判断する
  assert.equal(detectBrowser({ userAgentData: { brands: [{ brand: "Not A Brand", version: "99" }] }, userAgent: edge }), "edge");
});

test("detectBrowser：分からなければ null", () => {
  assert.equal(detectBrowser(undefined), null);
  assert.equal(detectBrowser({}), null);
  assert.equal(detectBrowser({ userAgent: "Mozilla/5.0 (Windows NT 10.0; rv:131.0) Gecko/20100101 Firefox/131.0" }), null);
  assert.equal(detectBrowser({ userAgentData: { brands: null }, userAgent: 42 }), null);
  assert.equal(detectBrowser({ userAgentData: { brands: [null, { brand: 5 }] } }), null);
});

test("readHostReply：受け口の返事を読む", () => {
  assert.deepEqual(readHostReply({ ok: true, stored: true }), { ok: true, reason: null });
  assert.deepEqual(readHostReply({ ok: true, pong: true }), { ok: true, reason: null });
  assert.deepEqual(readHostReply({ ok: false, error: "許可されていない拡張機能です" }), { ok: false, reason: "許可されていない拡張機能です" });
  assert.deepEqual(readHostReply({ ok: false }), { ok: false, reason: "受け口は理由を示しませんでした" });
  assert.equal(readHostReply({ ok: false, error: "長".repeat(500) }).reason.length, 200);
  for (const response of [undefined, null, {}, { ok: "true" }, "ok"]) {
    assert.deepEqual(readHostReply(response), { ok: false, reason: "受け口の返事の形が違います" }, JSON.stringify(response));
  }
});
