// 実際のapp.jsへ操作を送り、抽選・保存・再挑戦のつながりを確認します。
// DOMスタブはレイアウトやブラウザ固有の動作を検証するものではありません。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { OUTCOMES, createSession, draw } from '../engine.js';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const STORAGE_KEY = 'lottery-lab-v1';
let loadNumber = 0;
const cleanupByTest = new WeakMap();

class Element {
  constructor(id = '') {
    this.id = id;
    this._text = '';
    this.innerHTML = '';
    this.value = '';
    this.dataset = {};
    this.handlers = new Map();
    this.attributes = new Map();
    this.disabled = false;
    this.hidden = false;
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(name => this.classes.add(name)),
      remove: (...names) => names.forEach(name => this.classes.delete(name)),
      toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name),
    };
    this.style = { setProperty() {} };
  }
  set textContent(value) { this._text = String(value); }
  get textContent() { return this._text; }
  addEventListener(name, handler) { this.handlers.set(name, handler); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  fire(name, event = {}) { return this.handlers.get(name)?.({ preventDefault() {}, ...event }); }
  click() { if (!this.disabled) return this.fire('click'); }
  replaceChildren() {}
}

async function loadApp(t, storage = { value: null }) {
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)]
    .map(match => [`#${match[1]}`, new Element(match[1])]));
  for (const selector of ['#draw-one span', '#probability-table caption', '#probability-table tbody']) {
    elements.set(selector, new Element(selector));
  }
  for (const match of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
    const id = match[1].match(/id="([^"]+)"/)?.[1];
    if (!id) continue;
    const options = [...match[2].matchAll(/<option\b([^>]*)>/g)];
    const chosen = options.find(row => /\bselected\b/.test(row[1])) || options[0];
    elements.get(`#${id}`).value = chosen[1].match(/value="([^"]+)"/)[1];
  }
  const buttons = [...html.matchAll(/<button\b([^>]*)>/g)]
    .filter(match => /\bdata-draw=/.test(match[1])).map(match => {
      const id = match[1].match(/id="([^"]+)"/)?.[1];
      const button = id ? elements.get(`#${id}`) : new Element();
      button.dataset.draw = match[1].match(/data-draw="([^"]+)"/)[1];
      return button;
    });
  const get = selector => {
    assert.ok(elements.has(selector), `実際のHTMLにないセレクター: ${selector}`);
    return elements.get(selector);
  };
  const timers = [];
  const blobs = [];
  const downloads = [];
  const originals = new Map();
  const install = (name, value) => {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  const originalCreateUrl = URL.createObjectURL;
  const originalRevokeUrl = URL.revokeObjectURL;
  URL.createObjectURL = blob => { blobs.push(blob); return `blob:test/${blobs.length}`; };
  URL.revokeObjectURL = () => {};
  if (!cleanupByTest.has(t)) {
    const cleanups = [];
    cleanupByTest.set(t, cleanups);
    t.after(() => { for (const cleanup of cleanups.reverse()) cleanup(); });
  }
  cleanupByTest.get(t).push(() => {
    URL.createObjectURL = originalCreateUrl;
    URL.revokeObjectURL = originalRevokeUrl;
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  install('document', {
    querySelector: get,
    querySelectorAll(selector) {
      assert.ok(['.draw-button', '[data-draw]'].includes(selector));
      return buttons;
    },
    createElement(tag) {
      const element = new Element();
      if (tag === 'a') element.click = () => downloads.push({ href: element.href, name: element.download });
      return element;
    },
    createDocumentFragment() { return { append() {} }; },
  });
  install('window', {});
  install('matchMedia', () => ({ matches: true }));
  install('confirm', () => true);
  install('setTimeout', callback => { timers.push(callback); return timers.length; });
  install('localStorage', {
    getItem(key) {
      assert.equal(key, STORAGE_KEY);
      if (storage.failRead) throw new Error('Storage blocked');
      return storage.value;
    },
    setItem(key, value) {
      assert.equal(key, STORAGE_KEY);
      if (storage.failWrite) throw new Error('Storage full');
      storage.value = value;
    },
  });
  await import(`../app.js?ui-test=${++loadNumber}`);
  const flush = async () => {
    // タイマー後のasync処理と、そこから予約した処理を順に終わらせます。
    while (timers.length) {
      timers.shift()();
      await Promise.resolve();
    }
    await Promise.resolve();
  };
  return { get, buttons, storage, blobs, downloads, flush,
    saved: () => JSON.parse(storage.value),
    seed: () => Number(get('#seed-label').textContent.split('：')[1]),
  };
}

test('a completed result survives reload and restarting does not archive it twice', async t => {
  const storage = { value: null };
  const app = await loadApp(t, storage);
  app.get('#draw-rest').click();
  await app.flush();
  const seed = app.seed();
  const expected = createSession({ seed });
  draw(expected, 1000);
  assert.equal(app.get('#game-count').textContent, '1,000');
  assert.equal(app.get('#draw-one span').textContent, 'もう一度遊ぶ');
  assert.equal(app.saved().previous.length, 1);
  assert.deepEqual(app.saved().previous[0], { setting: 6, games: 1000,
    net: expected.balance - 50, seed, bonus: expected.counts.BIG + expected.counts.REG });
  const collection = app.saved().collection;
  for (const row of OUTCOMES.filter(row => row.id !== 'miss')) {
    assert.equal(collection[row.id], expected.counts[row.id]);
  }

  // 完走後の「もう一度遊ぶ」は新しい回を作り、完走分を二重保存しません。
  app.buttons[0].click();
  await app.flush();
  assert.equal(app.get('#game-count').textContent, '0');
  assert.equal(app.saved().previous.length, 1);
  assert.deepEqual(app.saved().collection, collection);

  // 同じ保存領域を使ってapp.jsを読み込み直す＝再読込後の状態です。
  const reloaded = await loadApp(t, storage);
  assert.match(reloaded.get('#previous-runs').innerHTML, /設定6 · 1000回/);
  assert.deepEqual(reloaded.saved().collection, collection);
  reloaded.get('#new-round').click();
  assert.equal(reloaded.saved().previous.length, 1);
});

test('changing setting records the old result and keeps only the most recent five', async t => {
  const app = await loadApp(t);
  app.buttons[1].click();
  await app.flush();
  const collection = app.saved().collection;
  app.get('#setting').value = '2';
  app.get('#setting').fire('change');
  assert.equal(app.get('#game-count').textContent, '0');
  assert.equal(app.saved().previous[0].setting, 6);
  assert.equal(app.saved().previous[0].games, 10);
  assert.deepEqual(app.saved().collection, collection);
  assert.match(app.get('#probability-table caption').textContent, /設定2/);
  for (let run = 0; run < 6; run++) {
    app.buttons[0].click();
    await app.flush();
    app.get('#new-round').click();
  }
  assert.equal(app.saved().previous.length, 5);
  assert.ok(app.saved().previous.every(row => row.setting === 2 && row.games === 1));
});

test('overlapping click handlers draw once and batches stop at the target', async t => {
  const app = await loadApp(t);
  app.buttons[0].fire('click');
  app.buttons[0].fire('click');
  assert.ok(app.buttons.every(button => button.disabled));
  assert.equal(app.get('#setting').disabled, true);
  await app.flush();
  assert.equal(app.get('#game-count').textContent, '1');
  app.get('#draw-rest').click();
  await app.flush();
  assert.equal(app.get('#game-count').textContent, '1,000');
  assert.equal(app.get('#draw-rest').disabled, true);
  assert.equal(app.buttons[1].disabled, true);
  assert.equal(app.buttons[2].disabled, true);
  assert.equal(app.saved().previous[0].games, 1000);
});

test('comparison leaves the active game and collection unchanged', async t => {
  const app = await loadApp(t);
  app.buttons[2].click();
  await app.flush();
  const before = {
    points: app.get('#balance').textContent,
    table: app.get('#probability-table tbody').innerHTML,
    chart: app.get('#history-chart').innerHTML,
    collection: app.get('#collection').innerHTML,
    storage: app.storage.value,
  };
  app.get('#compare-tab').click();
  assert.equal(app.get('#play-view').hidden, true);
  app.get('#comparison-form').fire('submit');
  app.get('#comparison-form').fire('submit');
  await app.flush();
  assert.equal(app.get('#comparison-results').hidden, false);
  assert.match(app.get('#comparison-body').innerHTML, /設定 6/);
  assert.equal(app.get('#compare-button').disabled, false);
  assert.equal(app.get('#balance').textContent, before.points);
  assert.equal(app.get('#game-count').textContent, '100');
  assert.equal(app.get('#probability-table tbody').innerHTML, before.table);
  assert.equal(app.get('#history-chart').innerHTML, before.chart);
  assert.equal(app.get('#collection').innerHTML, before.collection);
  assert.equal(app.storage.value, before.storage);
});

test('invalid saved values are ignored and blocked storage does not prevent play', async t => {
  const storage = { value: JSON.stringify({ collection: { BIG: -1, REG: '4', grape: 4 },
    previous: [null, { setting: 7, games: 5, net: 0, seed: 3, bonus: 0 }] }) };
  const app = await loadApp(t, storage);
  assert.match(app.get('#collection').innerHTML, /累計 4 回/);
  app.get('#new-round').click();
  app.buttons[0].click();
  await app.flush();
  assert.equal(app.saved().previous.length, 0);
  assert.ok(app.saved().collection.BIG >= 0);
  assert.ok(app.saved().collection.grape >= 4);

  const blocked = await loadApp(t, { value: null, failRead: true, failWrite: true });
  assert.match(blocked.get('#storage-note').textContent, /保存できません/);
  blocked.buttons[0].click();
  await blocked.flush();
  assert.equal(blocked.get('#game-count').textContent, '1');
  assert.match(blocked.get('#storage-note').textContent, /保存できません/);
  assert.equal(blocked.buttons[0].disabled, false);
});

test('CSV contains every actual balance and the theoretical mean keeps its sign', async t => {
  const app = await loadApp(t);
  app.get('#setting').value = '1';
  app.get('#setting').fire('change');
  assert.match(app.get('#probability-table caption').textContent, /−0\.046 pt/);
  app.buttons[1].click();
  await app.flush();
  const expected = createSession({ setting: 1, seed: app.seed() });
  draw(expected, 10);
  app.get('#export-csv').click();
  const text = await app.blobs[0].text();
  const lines = text.replace(/^\ufeff/, '').split('\r\n');
  assert.equal(lines[0], 'setting,seed,game,balance,net');
  assert.equal(lines.length, 12);
  for (let game = 0; game <= 10; game++) {
    assert.equal(lines[game + 1], `1,${app.seed()},${game},${expected.history[game]},${expected.history[game] - 50}`);
  }
  assert.equal(app.downloads[0].name, `lottery-setting1-${app.seed()}.csv`);
  await app.flush();
});
