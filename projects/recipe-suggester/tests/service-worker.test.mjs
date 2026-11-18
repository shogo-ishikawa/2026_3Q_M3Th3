import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const worker = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');
const listing = readFileSync(new URL('../assets/pwa-shell.js', import.meta.url), 'utf8');
const scope = 'https://example.test/course/projects/recipe-suggester/';
const prefix = 'meal-palette-shell:' + encodeURIComponent(scope) + ':';

function workerEvents(cacheEntries, {rejectInstall = false} = {}) {
  const handlers = new Map();
  const cacheNames = new Set(cacheEntries);
  const requests = [];
  let claimed = false;
  const cache = {
    async addAll(batch) {
      if (rejectInstall) throw new Error('asset integrity mismatch');
      requests.push(...batch);
    },
    async match(url) { return requests.find(request => request.url === url)?.url; }
  };
  const caches = {
    async open(name) { cacheNames.add(name); return cache; },
    async keys() { return [...cacheNames]; },
    async delete(name) { return cacheNames.delete(name); }
  };
  const context = vm.createContext({
    self: {
      registration: {scope},
      clients: {async claim() { claimed = true; }},
      addEventListener(type, listener) { handlers.set(type, listener); }
    },
    caches, URL, Request,
    importScripts() { vm.runInContext(listing, context); }
  });
  vm.runInContext(worker, context);

  function dispatch(type, event = {}) {
    let response;
    const capture = result => { response = result; };
    handlers.get(type)({...event, waitUntil: capture, respondWith: capture});
    return response;
  }
  function request(url, mode = 'cors', method = 'GET') {
    return dispatch('fetch', {request: {url, mode, method, headers: new Headers()}});
  }
  return {dispatch, request, cacheNames, requests, claimed: () => claimed};
}

test('オフライン準備はハッシュ付きの教材本体だけを取得し、他の作品のキャッシュを保持する', async () => {
  const otherProject = 'meal-palette-shell:' + encodeURIComponent(scope + 'other/') + ':v1';
  const app = workerEvents([otherProject, 'student-work', prefix + 'previous']);
  await app.dispatch('install');
  assert.ok(app.requests.length > 0);
  assert.ok(app.requests.every(request => request.url.startsWith(scope) && request.integrity.startsWith('sha256-')));
  assert.ok(app.requests.every(request => !request.url.includes('/recipe-art/') && !request.url.includes('/dist/')));
  assert.equal(app.claimed(), false);
  await app.dispatch('activate');
  assert.equal(app.claimed(), true);
  assert.equal(app.cacheNames.has(prefix + 'previous'), false);
  assert.equal(app.cacheNames.has(otherProject), true);
  assert.equal(app.cacheNames.has('student-work'), true);
});

test('通信のない起動でURLごとの画面とモジュールを復元し、他作品・外部リンクを処理しない', async () => {
  const app = workerEvents([]);
  await app.dispatch('install');
  const entry = scope + 'index.html';
  assert.equal(await app.request(scope + '?demo=week', 'navigate'), entry);
  assert.equal(await app.request(entry, 'navigate'), entry);
  const expected = app.requests.find(req => new URL(req.url).pathname.endsWith('/app.js')).url;
  assert.equal(await app.request(expected), expected);
  assert.equal(await app.request(scope + 'app.js'), expected);
  assert.equal(app.request(scope + 'app.js?v=other'), undefined);
  assert.equal(app.request(scope + 'assets/recipe-art/meal.webp'), undefined);
  assert.equal(app.request(scope + 'dist/old.zip', 'navigate'), undefined);
  assert.equal(app.request('https://example.test/course/projects/other/', 'navigate'), undefined);
  assert.equal(app.request('https://external.test/', 'navigate'), undefined);
  assert.equal(app.request(expected, 'cors', 'POST'), undefined);
});

test('新しい版の資産が揃わないとインストールを中断し、使用中の版を維持する', async () => {
  const previous = prefix + 'previous';
  const app = workerEvents([previous], {rejectInstall: true});
  await assert.rejects(app.dispatch('install'), /integrity mismatch/);
  assert.equal(app.cacheNames.has(previous), true);
  assert.equal(app.claimed(), false);
});
