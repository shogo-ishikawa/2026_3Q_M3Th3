/* この作品の HTML・レシピデータ・表示プログラムだけを、同じ版でそろえます。 */
importScripts('./assets/pwa-shell.js');

const scope = self.registration.scope;
const prefix = 'meal-palette-shell:' + encodeURIComponent(scope) + ':';
const currentCache = prefix + SHELL_REVISION;
const entry = new URL('index.html', scope).href;
const assets = new Map();
const unversionedModules = new Map();
for (const [path, integrity] of Object.entries(SHELL_FILES)) {
  const url = new URL(path, scope);
  assets.set(url.href, integrity);
  if (url.pathname.endsWith('.js') && url.search) {
    unversionedModules.set(url.origin + url.pathname, url.href);
  }
}

self.addEventListener('install', event => {
  // 全ファイルが揃うまで新しい版を有効にしません。途中で失敗しても旧版を使えます。
  event.waitUntil((async () => {
    const cache = await caches.open(currentCache);
    const requests = Array.from(assets, ([url, integrity]) =>
      new Request(url, {cache: 'reload', integrity}));
    await cache.addAll(requests);
  })());
});

self.addEventListener('activate', event => {
  // 開いている旧版のタブがすべて閉じた後、ブラウザーが新版を有効にします。
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(prefix) && name !== currentCache)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  let key = url.href;
  if (request.mode === 'navigate') {
    // お試し画面のクエリや起動先タブは、ページが元のURLから読み取ります。
    const path = url.origin + url.pathname;
    if (path !== scope && path !== entry) return;
    key = entry;
  } else if (unversionedModules.has(key)) {
    key = unversionedModules.get(key);
  } else if (!assets.has(key)) {
    // イラスト・配布ZIP・外部サイトなどを保存対象に加えません。
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(currentCache);
    return await cache.match(key) || fetch(request);
  })());
});
