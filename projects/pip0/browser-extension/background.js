// pip0 連携（ブラウザー拡張）のサービスワーカーです。
//
// 処理の流れ
//   1. ダウンロードが始まったとき（downloads.onCreated）
//      最後に操作したウィンドウで前面だったタブの URL と題名を、
//      メモリーの中の記憶域（storage.session）に、ダウンロードの番号ごとに控えます。
//   2. ダウンロードが完了したとき（downloads.onChanged で state が "complete"）
//      ダウンロードの情報を読み直し、控えと合わせたメッセージを、
//      この PC の pip0 の受け口（Native Messaging の "pip0.bridge"）へ1件送ります。送ったら控えを消します。
//   3. 中断されたとき（state が "interrupted"）と、一覧から消されたときは、控えを消します。
//   4. ツールバーのアイコンを押したときは、受け口に接続できるかを確かめます。
//
// 外へ出す経路は、chrome.runtime.sendNativeMessage（この PC の受け口）だけです。
// ネットワークを使う機能は使いません（tests/no-network.test.js で確かめています）。
// シークレット ウィンドウのダウンロードは、控えることも送ることもしません。

import {
  NATIVE_HOST_NAME,
  buildDownloadMessage,
  buildPageSnapshot,
  buildPingMessage,
  detectBrowser,
  readHostReply,
} from "./lib/message.js";

// ツールバーのアイコンの説明（manifest.json の action.default_title と同じ文）
const DEFAULT_TITLE = "pip0 連携（クリックすると、pip0 の受け口に接続できるかを確かめます）";

// 受け口に届かなかったときに、アイコンの右下に出すバッジ
const ERROR_BADGE_TEXT = "!";
const ERROR_BADGE_COLOUR = "#B3261E";

// 受け口に届かなかった（見つからない・起動できない）ときの説明
const NOT_REACHABLE_TITLE =
  "pip0 連携：pip0 の受け口に届きませんでした。\n" +
  "受け口が導入されていないか、起動できない状態です。\n" +
  "scripts\\register-native-host.ps1 で登録したか、pip0 の導入先に runtime\\python.exe があるかを確かめてください。";

// ブラウザーの種類（"chrome"、"edge"、"chromium"、分からなければ null）
const browserName = detectBrowser(globalThis.navigator);

// 控えを書いている途中のダウンロード（番号 → 書き終わりを待つための Promise）。
// ごく小さなファイルでは、控えを書き終わる前に完了の知らせが来ることがあるため、
// 完了の処理は、控えを書き終わるのを待ってから始めます。
const pendingSnapshots = new Map();

// イベントの受け取りは、サービスワーカーの最上位で登録します（Manifest V3 の決まり）
chrome.downloads.onCreated.addListener(handleDownloadCreated);
chrome.downloads.onChanged.addListener(handleDownloadChanged);
chrome.downloads.onErased.addListener(handleDownloadErased);
chrome.action.onClicked.addListener(handleActionClicked);

// ----------------------------------------------------------------------
// 1. ダウンロードの開始：前面のタブを控える
// ----------------------------------------------------------------------

function handleDownloadCreated(item) {
  const task = saveSnapshot(item).finally(() => {
    pendingSnapshots.delete(item.id);
  });
  pendingSnapshots.set(item.id, task);
  return task;
}

async function saveSnapshot(item) {
  // シークレットのダウンロードと、いま始まったのではないもの（履歴の読み込み等）は控えません
  if (item.incognito !== false || item.state !== "in_progress") {
    return;
  }
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const snapshot = buildPageSnapshot(tabs[0], new Date());
    if (snapshot !== null) {
      // キーは「pageSnapshot:ダウンロードの番号」
      await chrome.storage.session.set({ [snapshotKey(item.id)]: snapshot });
    }
  } catch (error) {
    // 控えがなくても、完了の知らせは送れます（page の欄が null になります）
    console.warn("pip0 連携：タブの控えを作れませんでした。", error.message);
  }
}

// ----------------------------------------------------------------------
// 2. ダウンロードの完了・中断・削除
// ----------------------------------------------------------------------

async function handleDownloadChanged(delta) {
  // 状態（state）が変わった知らせだけを扱います（ファイル名や大きさの変化は無視します）
  if (!delta.state) {
    return;
  }
  if (delta.state.current === "complete") {
    await reportCompleted(delta.id);
  } else if (delta.state.current === "interrupted") {
    await forgetSnapshot(delta.id);
  }
}

async function reportCompleted(downloadId) {
  // 開始時の控えを書いている途中なら、書き終わるまで待ちます
  if (pendingSnapshots.has(downloadId)) {
    await pendingSnapshots.get(downloadId);
  }
  try {
    // 完了した時点の情報（保存先、終了時刻、大きさ等）を読み直します
    const items = await chrome.downloads.search({ id: downloadId });
    const snapshot = await readSnapshot(downloadId);
    const message = buildDownloadMessage(items[0], snapshot, browserName);
    if (message === null) {
      return; // シークレットのダウンロード等は送りません
    }
    const result = await sendToReceiver(message);
    await showResult(result, DEFAULT_TITLE);
  } catch (error) {
    console.warn("pip0 連携：完了の知らせを送れませんでした。", error.message);
  } finally {
    await forgetSnapshot(downloadId);
  }
}

function handleDownloadErased(downloadId) {
  return forgetSnapshot(downloadId);
}

// ----------------------------------------------------------------------
// 3. アイコンを押したとき：受け口に接続できるかを確かめる
// ----------------------------------------------------------------------

async function handleActionClicked() {
  const result = await sendToReceiver(buildPingMessage());
  const checkedAt = new Date().toLocaleTimeString("ja-JP");
  await showResult(result, "pip0 連携：pip0 の受け口に接続できました（" + checkedAt + " に確認）");
}

// ----------------------------------------------------------------------
// 4. 受け口への送信と、結果の表示
// ----------------------------------------------------------------------

// メッセージを受け口へ1件送り、結果を { ok, kind, reason } で返します。
//   kind が "connection"：受け口に届かなかった（見つからない、起動できない、途中で終わった）
//   kind が "reply"     ：受け口から返事があった（ok が false なら、受け口が記録を断った）
function sendToReceiver(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, message, (response) => {
        // 届かなかったときは、chrome.runtime.lastError に理由が入ります
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          resolve({ ok: false, kind: "connection", reason: String(lastError.message) });
          return;
        }
        const reply = readHostReply(response);
        resolve({ ok: reply.ok, kind: "reply", reason: reply.reason });
      });
    } catch (error) {
      resolve({ ok: false, kind: "connection", reason: String(error.message) });
    }
  });
}

// 結果をツールバーのアイコンに表示します。成功なら、バッジを消して説明を successTitle にします。
async function showResult(result, successTitle) {
  if (result.ok) {
    await clearErrorBadge(successTitle);
  } else if (result.kind === "connection") {
    await showErrorBadge(NOT_REACHABLE_TITLE + "\n（ブラウザーの説明：" + result.reason + "）");
  } else {
    await showErrorBadge("pip0 連携：pip0 の受け口が記録しませんでした。\n理由：" + result.reason);
  }
}

async function showErrorBadge(title) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: ERROR_BADGE_COLOUR });
    await chrome.action.setBadgeText({ text: ERROR_BADGE_TEXT });
    await chrome.action.setTitle({ title: title });
  } catch (error) {
    console.warn("pip0 連携：バッジを表示できませんでした。", error.message);
  }
}

async function clearErrorBadge(title) {
  try {
    await chrome.action.setBadgeText({ text: "" });
    await chrome.action.setTitle({ title: title });
  } catch (error) {
    console.warn("pip0 連携：バッジを消せませんでした。", error.message);
  }
}

// ----------------------------------------------------------------------
// 控えの保存場所：storage.session（メモリーの中だけ。ブラウザーを閉じると消えます）
// ----------------------------------------------------------------------

function snapshotKey(downloadId) {
  return "pageSnapshot:" + downloadId;
}

// 控えを読みます。ない・読めないときは null（page の欄が null になるだけで、記録は送ります）
async function readSnapshot(downloadId) {
  const key = snapshotKey(downloadId);
  try {
    const stored = await chrome.storage.session.get(key);
    return stored[key] ?? null;
  } catch (error) {
    console.warn("pip0 連携：控えを読めませんでした。", error.message);
    return null;
  }
}

async function forgetSnapshot(downloadId) {
  try {
    await chrome.storage.session.remove(snapshotKey(downloadId));
  } catch (error) {
    console.warn("pip0 連携：控えを消せませんでした。", error.message);
  }
}
