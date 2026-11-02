// テスト用の chrome API の代役です。本物のブラウザーなしで background.js を動かし、
// 呼び出された API と引数を記録します（state.calls）。
//
// 使い方：
//   const mock = createChromeMock();
//   globalThis.chrome = mock.chrome;      // background.js を読み込む前に置く
//   await mock.chrome.downloads.onCreated.dispatch(item);   // イベントを起こす
//   mock.state.calls.nativeMessages      // 受け口へ送られたメッセージ

export function createChromeMock() {
  const state = {};

  // テストごとに、記録と設定を初めの状態に戻します（登録されたイベントの受け取り手は残します）
  function reset() {
    state.downloads = new Map(); // ダウンロードの番号 → DownloadItem（downloads.search が返すもの）
    state.activeTabs = []; // tabs.query が返すタブ
    state.tabsQueryDelayMs = 0; // tabs.query の返事を遅らせる時間（控えの書き込みが遅れる場合の試験）
    state.tabsQueryError = null; // tabs.query を失敗させるときのメッセージ
    state.session = new Map(); // storage.session の中身
    state.sessionGetError = null; // storage.session.get を失敗させるときのメッセージ
    // 受け口の返事：{ mode: "reply", response } か { mode: "lastError", message }
    state.nativeReply = { mode: "reply", response: { ok: true, stored: true } };
    state.calls = {
      search: [],
      tabsQuery: [],
      nativeMessages: [],
      badgeText: [],
      badgeColour: [],
      titles: [],
    };
  }
  reset();

  const chrome = {
    downloads: {
      onCreated: createEvent(),
      onChanged: createEvent(),
      onErased: createEvent(),
      async search(query) {
        state.calls.search.push(structuredClone(query));
        const item = state.downloads.get(query.id);
        return item ? [structuredClone(item)] : [];
      },
    },
    tabs: {
      async query(queryInfo) {
        state.calls.tabsQuery.push(structuredClone(queryInfo));
        if (state.tabsQueryDelayMs > 0) {
          await wait(state.tabsQueryDelayMs);
        }
        if (state.tabsQueryError) {
          throw new Error(state.tabsQueryError);
        }
        return structuredClone(state.activeTabs);
      },
    },
    storage: {
      session: {
        async get(key) {
          if (state.sessionGetError) {
            throw new Error(state.sessionGetError);
          }
          const result = {};
          if (state.session.has(key)) {
            result[key] = structuredClone(state.session.get(key));
          }
          return result;
        },
        async set(items) {
          for (const [key, value] of Object.entries(items)) {
            state.session.set(key, structuredClone(value));
          }
        },
        async remove(key) {
          state.session.delete(key);
        },
      },
    },
    runtime: {
      lastError: undefined,
      // 本物と同じく、返事はあとで（非同期に）コールバックへ渡します。
      // 届かなかったときは、コールバックの間だけ chrome.runtime.lastError を置きます。
      sendNativeMessage(hostName, message, callback) {
        // 本物は JSON にして送るため、JSON にできない値（undefined 等）がないかも確かめられるようにします
        state.calls.nativeMessages.push({ hostName, message: structuredClone(message), json: JSON.stringify(message) });
        const reply = state.nativeReply;
        if (typeof callback !== "function") {
          // コールバックなしで呼んだ場合（Promise の形）
          if (reply.mode === "lastError") {
            return Promise.reject(new Error(reply.message));
          }
          return Promise.resolve(structuredClone(reply.response));
        }
        setTimeout(() => {
          if (reply.mode === "lastError") {
            chrome.runtime.lastError = { message: reply.message };
            try {
              callback(undefined);
            } finally {
              chrome.runtime.lastError = undefined;
            }
          } else {
            callback(structuredClone(reply.response));
          }
        }, 0);
        return undefined;
      },
    },
    action: {
      onClicked: createEvent(),
      async setBadgeText(details) {
        state.calls.badgeText.push(details.text);
      },
      async setBadgeBackgroundColor(details) {
        state.calls.badgeColour.push(details.color);
      },
      async setTitle(details) {
        state.calls.titles.push(details.title);
      },
    },
  };

  return { chrome, state, reset };
}

// イベント（addListener で受け取り手を登録し、dispatch で起こす）
function createEvent() {
  const listeners = [];
  return {
    listeners,
    addListener(listener) {
      listeners.push(listener);
    },
    // すべての受け取り手の処理（Promise）が終わるまで待ちます
    async dispatch(...args) {
      await Promise.all(listeners.map((listener) => listener(...args)));
    },
  };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
