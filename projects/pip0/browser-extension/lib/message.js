// 受け口（Native Messaging の "pip0.bridge"）へ渡すメッセージを作る関数です。
//
// メッセージの形は docs/ipc-protocol.md の5節のとおりです。
// 形を変えるときは、受け口（pip0/native_host.py の validate_message）と、
// docs/ipc-protocol.md も一緒に直してください。

import { cleanTitle, cutText, sanitiseUrl } from "./sanitise.js";

// 受け口の名前（native-host/pip0.bridge.json の "name" と、レジストリーのキーの名前）
export const NATIVE_HOST_NAME = "pip0.bridge";

// メッセージの形の版
export const PROTOCOL_VERSION = 1;

// page の取り方：ダウンロード開始時に、最後に操作したウィンドウで前面だったタブ
// （ダウンロードを始めたタブとは限らないため、受け口は送信元の判定には使いません）
export const PAGE_CAPTURE = "active_tab_at_download_start";

// 申告できるブラウザーの種類
const KNOWN_BROWSERS = ["chrome", "edge", "chromium"];

// mime と danger の最大文字数
const SHORT_TEXT_MAX_CHARS = 255;

// 受け口が断った理由として表示する最大文字数
const REASON_MAX_CHARS = 200;

// ブラウザーの種類を返します："edge"、"chrome"、"chromium"、分からなければ null。
// nav には navigator（サービスワーカーの中の navigator）を渡します。
export function detectBrowser(nav) {
  if (!nav) {
    return null;
  }

  // 1. navigator.userAgentData.brands：ブラウザーが自分の名前を申告したもの
  const brands = [];
  if (nav.userAgentData && Array.isArray(nav.userAgentData.brands)) {
    for (const entry of nav.userAgentData.brands) {
      if (entry && typeof entry.brand === "string") {
        brands.push(entry.brand);
      }
    }
  }
  if (brands.includes("Microsoft Edge")) return "edge";
  if (brands.includes("Google Chrome")) return "chrome";
  if (brands.includes("Chromium")) return "chromium";

  // 2. userAgentData がないときは、User-Agent の文字列で判断します。
  //    Chrome を元にしたほかのブラウザーも「Chrome/」を含むため、目安です。
  const userAgent = typeof nav.userAgent === "string" ? nav.userAgent : "";
  if (/\bEdg\//.test(userAgent)) return "edge";
  if (/\bChromium\//.test(userAgent)) return "chromium";
  if (/\bChrome\//.test(userAgent)) return "chrome";
  return null;
}

// ダウンロード開始時のタブの控え { tabUrl, tabTitle, capturedAt } を作ります。
//   tab        … chrome.tabs.query で得たタブ（なければ undefined）
//   capturedAt … 控えた時刻（Date）
// タブがないとき、シークレットのタブのときは null を返します。
export function buildPageSnapshot(tab, capturedAt) {
  if (!tab || tab.incognito !== false) {
    return null;
  }
  return {
    tabUrl: sanitiseUrl(tab.url),
    tabTitle: cleanTitle(tab.title),
    capturedAt: toIsoTime(capturedAt),
  };
}

// ダウンロードの完了を知らせるメッセージを作ります。
//   item     … chrome.downloads.search で読み直した DownloadItem
//   snapshot … buildPageSnapshot で作った控え（なければ null か undefined）
//   browser  … detectBrowser の結果
// 送らないもの（シークレットのダウンロード、保存先が分からないもの）は null を返します。
export function buildDownloadMessage(item, snapshot, browser) {
  // シークレットのダウンロードは送りません（シークレットかどうか分からないものも送りません）
  if (!item || item.incognito !== false) {
    return null;
  }
  // 受け口が記録に使う番号と保存先のパスがなければ、送りません
  if (!Number.isInteger(item.id) || typeof item.filename !== "string" || item.filename === "") {
    return null;
  }

  return {
    type: "download_completed",
    protocol: PROTOCOL_VERSION,
    browser: KNOWN_BROWSERS.includes(browser) ? browser : null,
    download: {
      id: item.id,
      url: sanitiseUrl(item.url), // リダイレクト前のダウンロード URL
      finalUrl: sanitiseUrl(item.finalUrl), // リダイレクト後のダウンロード URL
      referrer: sanitiseUrl(item.referrer), // 参照元
      filename: item.filename, // 保存先の絶対パス
      mime: shortTextOrNull(item.mime),
      startTime: toIsoTime(item.startTime),
      endTime: toIsoTime(item.endTime),
      fileSize: sizeOrNull(item.fileSize),
      danger: shortTextOrNull(item.danger),
      incognito: false,
    },
    page: buildPageFields(snapshot),
  };
}

// 受け口に接続できるかを確かめるメッセージです（受け口は何も記録しません）
export function buildPingMessage() {
  return { type: "ping", protocol: PROTOCOL_VERSION };
}

// 受け口の返事を読み、{ ok: true, reason: null } か { ok: false, reason: "理由" } を返します。
//   成功：{"ok": true, "stored": true}（ping には {"ok": true, "pong": true}）
//   失敗：{"ok": false, "error": "日本語の理由"}
export function readHostReply(response) {
  if (response && response.ok === true) {
    return { ok: true, reason: null };
  }
  if (response && response.ok === false) {
    const reason = cleanTitle(response.error);
    if (reason === null) {
      return { ok: false, reason: "受け口は理由を示しませんでした" };
    }
    return { ok: false, reason: cutText(reason, REASON_MAX_CHARS) };
  }
  return { ok: false, reason: "受け口の返事の形が違います" };
}

// page の欄を作ります。控えがあれば、念のためもう一度整えてから使います。
// 控えがなければ（開始を見ていない、タブがなかった等）、すべて null にします。
function buildPageFields(snapshot) {
  if (!snapshot) {
    return { tabUrl: null, tabTitle: null, capturedAt: null, capture: null };
  }
  return {
    tabUrl: sanitiseUrl(snapshot.tabUrl),
    tabTitle: cleanTitle(snapshot.tabTitle),
    capturedAt: toIsoTime(snapshot.capturedAt),
    capture: PAGE_CAPTURE,
  };
}

// 時刻（Date か ISO 8601 の文字列）を "2026-10-29T03:12:00.000Z" の形にします。読めなければ null。
function toIsoTime(value) {
  let milliseconds = NaN;
  if (value instanceof Date) {
    milliseconds = value.getTime();
  } else if (typeof value === "string") {
    milliseconds = Date.parse(value);
  }
  if (Number.isNaN(milliseconds)) {
    return null;
  }
  return new Date(milliseconds).toISOString();
}

// ファイルの大きさ（バイト数）。分からないとき（Chrome は -1 にします）は null。
function sizeOrNull(value) {
  if (Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  return null;
}

// 短い文字列（mime、danger）。空や文字列でないときは null。
function shortTextOrNull(value) {
  if (typeof value !== "string" || value === "") {
    return null;
  }
  return cutText(value, SHORT_TEXT_MAX_CHARS);
}
