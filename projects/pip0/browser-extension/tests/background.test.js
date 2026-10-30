// background.js の試験：chrome API の代役（tests/helpers/chrome-mock.js）でイベントを起こし、
// 受け口へ送るメッセージ、控えの扱い、バッジの表示を確かめます。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, describe, test } from "node:test";

import { createChromeMock } from "./helpers/chrome-mock.js";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

// background.js を読み込む前に、chrome と navigator（Chrome のふり）を置きます
const mock = createChromeMock();
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
globalThis.chrome = mock.chrome;
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    userAgentData: { brands: [{ brand: "Google Chrome", version: "130" }, { brand: "Chromium", version: "130" }, { brand: "Not?A_Brand", version: "99" }] },
  },
});
await import("../background.js");

// Slack からのダウンロードの例（完了した後の DownloadItem）
function completedItem(id, changes = {}) {
  return {
    id,
    url: `https://files.slack.com/files-pri/T0-F${id}/report.pdf?t=xoxe-secret-token`,
    finalUrl: `https://files.slack.com/files-pri/T0-F${id}/report.pdf?t=xoxe-secret-token&origin_team=T0`,
    referrer: "https://app.slack.com/",
    filename: `C:\\Users\\u\\Downloads\\report-${id}.pdf`,
    mime: "application/pdf",
    startTime: "2026-10-29T03:12:00.000Z",
    endTime: "2026-10-29T03:12:04.500Z",
    fileSize: 123456,
    totalBytes: 123456,
    bytesReceived: 123456,
    danger: "safe",
    incognito: false,
    state: "complete",
    exists: true,
    ...changes,
  };
}

// 始まったばかりの DownloadItem（onCreated で渡されるもの）
function startedItem(item) {
  const started = { ...item, state: "in_progress", bytesReceived: 0 };
  delete started.endTime;
  return started;
}

const slackTab = {
  id: 3,
  windowId: 1,
  active: true,
  incognito: false,
  url: "https://app.slack.com/client/T0/C0?cdn_fallback=1",
  title: "予算 (Channel) - ws - Slack",
};

async function startDownload(item) {
  mock.state.downloads.set(item.id, startedItem(item));
  await mock.chrome.downloads.onCreated.dispatch(startedItem(item));
}

async function completeDownload(item) {
  mock.state.downloads.set(item.id, item);
  await mock.chrome.downloads.onChanged.dispatch({
    id: item.id,
    state: { previous: "in_progress", current: "complete" },
    endTime: { current: item.endTime },
  });
}

describe("background.js", () => {
  beforeEach(() => {
    mock.reset();
  });

  after(() => {
    delete globalThis.chrome;
    if (originalNavigator) {
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    } else {
      delete globalThis.navigator;
    }
  });

  test("イベントの受け取り手を、最上位で1つずつ登録している", () => {
    assert.equal(mock.chrome.downloads.onCreated.listeners.length, 1);
    assert.equal(mock.chrome.downloads.onChanged.listeners.length, 1);
    assert.equal(mock.chrome.downloads.onErased.listeners.length, 1);
    assert.equal(mock.chrome.action.onClicked.listeners.length, 1);
  });

  test("ダウンロード完了：受け口へ1回だけ、5節の形のメッセージを送り、控えを消す", async () => {
    mock.state.activeTabs = [slackTab];
    const item = completedItem(42);
    const before = Date.now();
    await startDownload(item);
    const after = Date.now();

    // 開始時：最後に操作したウィンドウの前面のタブを、storage.session に控える
    assert.deepEqual(mock.state.calls.tabsQuery, [{ active: true, lastFocusedWindow: true }]);
    assert.deepEqual([...mock.state.session.keys()], ["pageSnapshot:42"]);
    assert.equal(mock.state.calls.nativeMessages.length, 0, "開始時にはまだ送らない");

    await completeDownload(item);

    assert.deepEqual(mock.state.calls.search, [{ id: 42 }]);
    assert.equal(mock.state.calls.nativeMessages.length, 1);
    const sent = mock.state.calls.nativeMessages[0];
    assert.equal(sent.hostName, "pip0.bridge");

    const capturedAt = sent.message.page.capturedAt;
    assert.ok(Date.parse(capturedAt) >= before && Date.parse(capturedAt) <= after, "控えた時刻が付いている");
    assert.deepEqual(sent.message, {
      type: "download_completed",
      protocol: 1,
      browser: "chrome",
      download: {
        id: 42,
        url: "https://files.slack.com/files-pri/T0-F42/report.pdf",
        finalUrl: "https://files.slack.com/files-pri/T0-F42/report.pdf",
        referrer: "https://app.slack.com/",
        filename: "C:\\Users\\u\\Downloads\\report-42.pdf",
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
        capturedAt,
        capture: "active_tab_at_download_start",
      },
    });
    // JSON にしても同じ（本物は JSON にして受け口へ渡す）
    assert.deepEqual(JSON.parse(sent.json), sent.message);
    assert.ok(!sent.json.includes("xoxe-secret-token"), "鍵を含む ? 以降は送らない");

    assert.equal(mock.state.session.size, 0, "送った後は控えを消す");
    assert.deepEqual(mock.state.calls.badgeText, [""]);
    assert.deepEqual(mock.state.calls.titles, [manifest.action.default_title]);
  });

  test("シークレットのダウンロード：控えず、送らない", async () => {
    mock.state.activeTabs = [{ ...slackTab, incognito: true }];
    const item = completedItem(7, { incognito: true });
    await startDownload(item);
    await completeDownload(item);

    assert.equal(mock.state.calls.tabsQuery.length, 0, "タブを読みに行かない");
    assert.equal(mock.state.session.size, 0);
    assert.equal(mock.state.calls.nativeMessages.length, 0);
    assert.deepEqual(mock.state.calls.badgeText, []);
  });

  test("受け口に届かない（lastError）：バッジ「!」と、日本語の説明を出す", async () => {
    mock.state.activeTabs = [slackTab];
    mock.state.nativeReply = { mode: "lastError", message: "Specified native messaging host not found." };
    const item = completedItem(43);
    await startDownload(item);
    await completeDownload(item);

    assert.equal(mock.state.calls.nativeMessages.length, 1);
    assert.deepEqual(mock.state.calls.badgeText, ["!"]);
    assert.deepEqual(mock.state.calls.badgeColour, ["#B3261E"]);
    assert.equal(mock.state.calls.titles.length, 1);
    const title = mock.state.calls.titles[0];
    assert.match(title, /pip0 の受け口に届きませんでした/);
    assert.match(title, /導入されていないか、起動できない/);
    assert.match(title, /register-native-host\.ps1/);
    assert.match(title, /Specified native messaging host not found\./);
    assert.equal(mock.state.session.size, 0, "失敗しても控えは消す");
    assert.equal(mock.chrome.runtime.lastError, undefined, "lastError はコールバックの間だけ");
  });

  test("エラーの後に成功したら、バッジを消して説明を元に戻す", async () => {
    mock.state.nativeReply = { mode: "lastError", message: "Native host has exited." };
    await completeDownload(completedItem(44));
    mock.state.nativeReply = { mode: "reply", response: { ok: true, stored: true } };
    await completeDownload(completedItem(45));

    assert.equal(mock.state.calls.nativeMessages.length, 2);
    assert.deepEqual(mock.state.calls.badgeText, ["!", ""]);
    assert.equal(mock.state.calls.titles.at(-1), manifest.action.default_title);
  });

  test("受け口が断った（ok: false）：バッジ「!」と、受け口の理由を出す", async () => {
    mock.state.nativeReply = { mode: "reply", response: { ok: false, error: "許可されていない拡張機能です" } };
    await completeDownload(completedItem(46));

    assert.deepEqual(mock.state.calls.badgeText, ["!"]);
    assert.match(mock.state.calls.titles[0], /受け口が記録しませんでした/);
    assert.match(mock.state.calls.titles[0], /許可されていない拡張機能です/);
  });

  test("受け口の返事の形が違う：バッジ「!」", async () => {
    mock.state.nativeReply = { mode: "reply", response: undefined };
    await completeDownload(completedItem(47));
    assert.deepEqual(mock.state.calls.badgeText, ["!"]);
    assert.match(mock.state.calls.titles[0], /返事の形が違います/);
  });

  test("控えを書き終わる前に完了しても、控えを待ってから送る", async () => {
    mock.state.activeTabs = [slackTab];
    mock.state.tabsQueryDelayMs = 30;
    const item = completedItem(48);
    mock.state.downloads.set(item.id, startedItem(item));
    const created = mock.chrome.downloads.onCreated.dispatch(startedItem(item)); // 待たずに
    await completeDownload(item);
    await created;

    assert.equal(mock.state.calls.nativeMessages.length, 1);
    assert.equal(mock.state.calls.nativeMessages[0].message.page.tabUrl, "https://app.slack.com/client/T0/C0");
    assert.equal(mock.state.session.size, 0, "控えが後から残らない");
  });

  test("開始を見ていない（控えがない）：page の欄を null にして送る", async () => {
    await completeDownload(completedItem(49));
    assert.equal(mock.state.calls.nativeMessages.length, 1);
    assert.deepEqual(mock.state.calls.nativeMessages[0].message.page, {
      tabUrl: null,
      tabTitle: null,
      capturedAt: null,
      capture: null,
    });
  });

  test("前面のタブがない・シークレットのタブ・タブを読めない：控えずに送る（page は null）", async (t) => {
    t.mock.method(console, "warn", () => {}); // 予想どおりの警告を表示しない

    const cases = [
      { activeTabs: [], tabsQueryError: null },
      { activeTabs: [{ ...slackTab, incognito: true }], tabsQueryError: null },
      { activeTabs: [slackTab], tabsQueryError: "No window" },
    ];
    let id = 60;
    for (const setting of cases) {
      mock.reset();
      mock.state.activeTabs = setting.activeTabs;
      mock.state.tabsQueryError = setting.tabsQueryError;
      const item = completedItem(id++);
      await startDownload(item);
      assert.equal(mock.state.session.size, 0);
      await completeDownload(item);
      assert.equal(mock.state.calls.nativeMessages.length, 1);
      assert.equal(mock.state.calls.nativeMessages[0].message.page.tabUrl, null);
    }
  });

  test("控えを読めなくても、page の欄を null にして記録は送る", async (t) => {
    t.mock.method(console, "warn", () => {});
    mock.state.activeTabs = [slackTab];
    const item = completedItem(54);
    await startDownload(item);
    mock.state.sessionGetError = "storage unavailable";
    await completeDownload(item);

    assert.equal(mock.state.calls.nativeMessages.length, 1);
    assert.equal(mock.state.calls.nativeMessages[0].message.download.id, 54);
    assert.equal(mock.state.calls.nativeMessages[0].message.page.tabUrl, null);
    assert.equal(mock.state.session.size, 0, "控えは消す");
  });

  test("中断されたら控えを消し、送らない", async () => {
    mock.state.activeTabs = [slackTab];
    const item = completedItem(50);
    await startDownload(item);
    assert.equal(mock.state.session.size, 1);

    await mock.chrome.downloads.onChanged.dispatch({ id: 50, state: { previous: "in_progress", current: "interrupted" }, error: { current: "NETWORK_FAILED" } });
    assert.equal(mock.state.session.size, 0);
    assert.equal(mock.state.calls.nativeMessages.length, 0);
  });

  test("一覧から消されたら控えを消す", async () => {
    mock.state.activeTabs = [slackTab];
    await startDownload(completedItem(51));
    assert.equal(mock.state.session.size, 1);
    await mock.chrome.downloads.onErased.dispatch(51);
    assert.equal(mock.state.session.size, 0);
  });

  test("状態以外の変化（ファイル名など）では何もしない", async () => {
    await mock.chrome.downloads.onChanged.dispatch({ id: 52, filename: { current: "C:\\Users\\u\\Downloads\\a.pdf" } });
    await mock.chrome.downloads.onChanged.dispatch({ id: 52, state: { previous: "complete", current: "in_progress" } });
    assert.equal(mock.state.calls.search.length, 0);
    assert.equal(mock.state.calls.nativeMessages.length, 0);
  });

  test("履歴の読み込み等（始まったばかりでない項目の onCreated）では控えない", async () => {
    mock.state.activeTabs = [slackTab];
    await mock.chrome.downloads.onCreated.dispatch(completedItem(53));
    assert.equal(mock.state.calls.tabsQuery.length, 0);
    assert.equal(mock.state.session.size, 0);
  });

  test("完了したダウンロードが見つからない（消された）ときは送らない", async () => {
    await mock.chrome.downloads.onChanged.dispatch({ id: 999, state: { previous: "in_progress", current: "complete" } });
    assert.deepEqual(mock.state.calls.search, [{ id: 999 }]);
    assert.equal(mock.state.calls.nativeMessages.length, 0);
  });

  test("アイコンを押すと ping を送り、接続できたらタイトルで知らせる", async () => {
    mock.state.nativeReply = { mode: "reply", response: { ok: true, pong: true } };
    await mock.chrome.action.onClicked.dispatch({ id: 3 });

    assert.equal(mock.state.calls.nativeMessages.length, 1);
    assert.equal(mock.state.calls.nativeMessages[0].hostName, "pip0.bridge");
    assert.deepEqual(mock.state.calls.nativeMessages[0].message, { type: "ping", protocol: 1 });
    assert.deepEqual(mock.state.calls.badgeText, [""]);
    assert.match(mock.state.calls.titles[0], /pip0 の受け口に接続できました/);
  });

  test("アイコンを押して受け口に届かなければ、バッジ「!」", async () => {
    mock.state.nativeReply = { mode: "lastError", message: "Access to the specified native messaging host is forbidden." };
    await mock.chrome.action.onClicked.dispatch({ id: 3 });

    assert.deepEqual(mock.state.calls.badgeText, ["!"]);
    assert.match(mock.state.calls.titles[0], /受け口に届きませんでした/);
    assert.match(mock.state.calls.titles[0], /forbidden/);
  });
});
