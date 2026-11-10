// 実際のapp.jsへ操作を送り、抽選・保存・再挑戦のつながりを確認します。
// DOMスタブはレイアウトやブラウザ固有の動作を検証するものではありません。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { OUTCOMES, createSession, draw, simulateDistribution } from '../engine.js';

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

async function loadApp(t, storage = { value: null }, { seeds, reducedMotion = true } = {}) {
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)]
    .map(match => [`#${match[1]}`, new Element(match[1])]));
  for (const selector of ['#draw-one span', '#probability-table caption', '#probability-table tbody']) {
    elements.set(selector, new Element(selector));
  }
  for (const match of html.matchAll(/<[a-z]+\b([^>]*\bid="[^"]+"[^>]*)>/g)) {
    const id = match[1].match(/id="([^"]+)"/)[1];
    elements.get(`#${id}`).hidden = /\bhidden\b/.test(match[1]);
    elements.get(`#${id}`).disabled = /\bdisabled\b/.test(match[1]);
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
  let now = 0;
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
  install('matchMedia', () => ({ matches: reducedMotion }));
  install('confirm', () => true);
  let timerId = 0;
  install('setTimeout', (callback, delay = 0) => {
    timers.push({ callback, time: now + delay, id: ++timerId });
    return timerId;
  });
  install('clearTimeout', id => {
    const index = timers.findIndex(timer => timer.id === id);
    if (index >= 0) timers.splice(index, 1);
  });
  if (seeds) {
    let nextSeed = 0;
    install('crypto', { getRandomValues(array) {
      array[0] = seeds[Math.min(nextSeed++, seeds.length - 1)];
      return array;
    } });
  }
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
  const advance = async (duration = Infinity) => {
    const end = now + duration;
    timers.sort((left, right) => left.time - right.time || left.id - right.id);
    while (timers.length && timers[0].time <= end) {
      const timer = timers.shift();
      now = timer.time;
      timer.callback();
      await Promise.resolve();
      timers.sort((left, right) => left.time - right.time || left.id - right.id);
    }
    if (Number.isFinite(end)) now = end;
    await Promise.resolve();
  };
  const flush = () => advance();
  return { get, buttons, storage, blobs, downloads, flush, advance,
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
  const expected = createSession({ seed, model: 'published', setting: 1 });
  draw(expected, 1000);
  assert.equal(app.get('#game-count').textContent, '1,000');
  assert.equal(app.get('#draw-one span').textContent, 'もう一度試す');
  assert.equal(app.saved().previous.length, 1);
  assert.deepEqual(app.saved().previous[0], { model: 'published', setting: 1, games: 1000,
    net: expected.balance - 50, seed, bonus: expected.counts.BIG + expected.counts.REG });
  const collection = app.saved().collection;
  for (const row of OUTCOMES.filter(row => row.id !== 'miss')) {
    assert.equal(collection[row.id], expected.counts[row.id]);
  }

  // 完走後の再挑戦は新しい回を作り、完走分を二重保存しません。
  app.buttons[0].click();
  await app.flush();
  assert.equal(app.get('#game-count').textContent, '0');
  assert.equal(app.saved().previous.length, 1);
  assert.deepEqual(app.saved().collection, collection);

  // 同じ保存領域を使ってapp.jsを読み込み直す＝再読込後の状態です。
  const reloaded = await loadApp(t, storage);
  assert.match(reloaded.get('#previous-runs').innerHTML, /設定1 · 1000回/);
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
  assert.equal(app.saved().previous[0].setting, 1);
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
  app.get('#model-select').value = 'student';
  app.get('#model-select').fire('change');
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
  assert.equal(lines[0], 'model,setting,seed,game,balance,net');
  assert.equal(lines.length, 12);
  for (let game = 0; game <= 10; game++) {
    assert.equal(lines[game + 1], `student,1,${app.seed()},${game},${expected.history[game]},${expected.history[game] - 50}`);
  }
  assert.equal(app.downloads[0].name, `lottery-student-setting1-${app.seed()}.csv`);
  await app.flush();
});

test('STOP order and repeated stops do not redraw, and old timers cannot stop a new spin', async t => {
  const app = await loadApp(t, { value: null }, { seeds: [0], reducedMotion: false });
  const expected = createSession({ setting: 1, model: 'published', seed: 0 });
  const first = draw(expected)[0];
  app.buttons[0].fire('click');
  app.buttons[0].fire('click');
  app.get('#stop-reel-2').click();
  app.get('#stop-reel-2').fire('click');
  app.get('#stop-reel-0').click();
  await app.advance(419);
  assert.equal(app.get('#stop-reel-1').disabled, false);
  app.get('#stop-reel-1').click();
  await app.advance(0);
  assert.equal(app.get('#game-count').textContent, '1');
  assert.equal(app.get('#ticket').dataset.result, first.id);
  assert.equal(app.get('#balance').textContent, String(expected.balance));

  // 前回の自動停止は420/660/900msに予約済み。2回目に干渉させません。
  const second = draw(expected)[0];
  app.buttons[0].click();
  await app.advance(1);
  assert.equal(app.get('#reel-0').classes.has('rolling'), true);
  assert.equal(app.get('#stop-reel-0').disabled, false);
  await app.advance(419);
  assert.equal(app.get('#stop-reel-0').disabled, true);
  assert.equal(app.get('#stop-reel-1').disabled, false);
  await app.advance(241);
  assert.equal(app.get('#stop-reel-1').disabled, true);
  assert.equal(app.get('#stop-reel-2').disabled, false);
  app.get('#stop-reel-1').fire('click');
  await app.advance(240);
  assert.equal(app.get('#game-count').textContent, '2');
  assert.equal(app.get('#ticket').dataset.result, second.id);
  assert.equal(app.get('#balance').textContent, String(expected.balance));
  assert.equal(app.get('#bonus-lamp').dataset.lit, String(['BIG', 'REG'].includes(second.id)));
  await app.flush();
  assert.equal(app.get('#game-count').textContent, '2');
});

test('batch display shows its final draw even when an earlier draw was BIG', async t => {
  const app = await loadApp(t, { value: null }, { seeds: [0] });
  const expected = createSession({ setting: 1, model: 'published', seed: 0 });
  const results = draw(expected, 10);
  assert.ok(results.some(row => row.id === 'BIG'));
  assert.equal(results.at(-1).id, 'miss');
  app.buttons[1].click();
  await app.flush();
  assert.equal(app.get('#ticket').dataset.result, 'miss');
  assert.equal(app.get('#result-name').textContent, 'ハズレ');
  assert.equal(app.get('#bonus-lamp').dataset.lit, 'false');
  assert.equal(app.get('#ticket-serial').textContent, 'DRAW / 0010');
  const rows = [...app.get('#probability-table tbody').innerHTML.matchAll(/<td>(\d+) 回<\/td>/g)];
  assert.deepEqual(rows.map(row => Number(row[1])), OUTCOMES.map(row => expected.counts[row.id]));
  for (const row of OUTCOMES.filter(row => row.id !== 'miss')) {
    assert.equal(app.saved().collection[row.id], expected.counts[row.id]);
  }
  assert.match(app.get('#batch-note').textContent, /最後の1回/);
});

test('model changes archive the previous model and legacy records retain student meaning', async t => {
  const legacy = { setting: 6, games: 40, net: 45, seed: 3, bonus: 1 };
  const storage = { value: JSON.stringify({ previous: [legacy] }) };
  const app = await loadApp(t, storage, { seeds: [0, 42] });
  assert.match(app.get('#previous-runs').innerHTML, /学生の簡略モデル/);
  assert.match(app.get('#probability-table caption').textContent, /公式値に合わせたモデル・設定1/);
  app.buttons[1].click();
  await app.flush();
  const before = app.saved().collection;
  app.get('#model-select').value = 'student';
  app.get('#model-select').fire('change');
  assert.equal(app.saved().previous[0].model, 'published');
  assert.equal(app.saved().previous[0].games, 10);
  assert.deepEqual(app.saved().previous[1], { ...legacy, model: 'student' });
  assert.deepEqual(app.saved().collection, before);
  assert.equal(app.get('#game-count').textContent, '0');
  assert.match(app.get('#probability-table caption').textContent, /学生の簡略モデル・設定1/);
  assert.equal(app.get('#risk-results').hidden, true);
  assert.equal(app.get('#comparison-results').hidden, true);
});

test('5000 published-model trials do not alter play and zero rare events are not called impossible', async t => {
  // seed20973の最初の10回はBIGが3回。seed1からの5000試行には同等以上がありません。
  const app = await loadApp(t, { value: null }, { seeds: [20973, 1] });
  app.buttons[1].click();
  await app.flush();
  const before = {
    points: app.get('#balance').textContent,
    table: app.get('#probability-table tbody').innerHTML,
    chart: app.get('#history-chart').innerHTML,
    collection: app.get('#collection').innerHTML,
    storage: app.storage.value,
  };
  app.get('#analyse-result').fire('click');
  app.get('#analyse-result').fire('click');
  app.buttons[0].fire('click');
  assert.equal(app.get('#model-select').disabled, true);
  assert.equal(app.get('#new-round').disabled, true);
  await app.flush();
  assert.equal(app.get('#risk-results').hidden, false);
  assert.equal(app.get('#tail-estimate').textContent, '5000試行中 0回');
  assert.match(app.get('#tail-note').textContent, /起きる確率が0という意味ではありません/);
  assert.doesNotMatch(app.get('#tail-note').textContent, /試行に1回/);
  assert.match(app.get('#tail-interval').textContent, /0〜0\.08%/);
  const published = simulateDistribution({ setting: 1, model: 'published', games: 10, runs: 5000, seed: 1 });
  const student = simulateDistribution({ setting: 1, model: 'student', games: 10, runs: 5000, seed: 1 });
  assert.notEqual(published.upper95, student.upper95);
  assert.equal(app.get('#analysis-range').textContent, `−${Math.abs(published.lower95)} 〜 +${published.upper95} pt`);
  assert.equal(app.get('#balance').textContent, before.points);
  assert.equal(app.get('#game-count').textContent, '10');
  assert.equal(app.get('#probability-table tbody').innerHTML, before.table);
  assert.equal(app.get('#history-chart').innerHTML, before.chart);
  assert.equal(app.get('#collection').innerHTML, before.collection);
  assert.equal(app.storage.value, before.storage);
  app.buttons[0].click();
  assert.equal(app.get('#risk-results').hidden, true);
  await app.flush();
  app.get('#analyse-result').click();
  await app.flush();
  assert.equal(app.get('#risk-results').hidden, false);
  app.get('#model-select').value = 'student';
  app.get('#model-select').fire('change');
  assert.equal(app.get('#risk-results').hidden, true);
  assert.equal(app.get('#game-count').textContent, '0');
});

test('loss examples and yen units use net loss rather than remaining or spent points', async t => {
  const app = await loadApp(t, { value: null }, { seeds: [5] });
  app.buttons[2].click();
  await app.flush();
  assert.equal(app.get('#balance').textContent, '-46');
  assert.equal(app.get('#net').textContent, '−96 pt');
  assert.equal(app.get('#yen-net').textContent, '−1,920 円');
  assert.match(app.get('#loss-examples').innerHTML, /昼食なら 2 回分/);
  assert.match(app.get('#loss-examples').innerHTML, /本なら 1 回分/);
  assert.doesNotMatch(app.get('#loss-examples').innerHTML, /映画なら/);
  assert.equal(app.get('#expected-net').textContent, '−9 pt');
  assert.equal(app.get('#expectation-gap').textContent, '−87 pt');
  const collection = app.get('#collection').innerHTML;
  app.get('#yen-per-point').value = '5';
  app.get('#yen-per-point').fire('change');
  assert.equal(app.get('#yen-net').textContent, '−480 円');
  assert.match(app.get('#loss-examples').innerHTML, /800円の昼食予算から表示/);
  assert.equal(app.get('#game-count').textContent, '100');
  assert.equal(app.get('#collection').innerHTML, collection);
  app.get('#yen-per-point').value = '1';
  app.get('#yen-per-point').fire('change');
  assert.equal(app.get('#yen-net').textContent, '−96 円');
});
