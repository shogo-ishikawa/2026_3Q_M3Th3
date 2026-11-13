import test from 'node:test';
import assert from 'node:assert/strict';
import {SCENES, PALETTES} from '../core.js';
import {LIGHT_LOOKS, DEFAULT_LOOK, normaliseLook, makeLookHash, parseLookHash, createShareUrl} from '../looks.js';

const keys = ['scene', 'palette', 'intensity', 'motion', 'trails', 'quality', 'autoDraw'].sort();
const defaultHash = makeLookHash(DEFAULT_LOOK);

test('6つの配合は既存の場面と配色を使い、静かな設定を独立に保持する', () => {
  assert.equal(LIGHT_LOOKS.length, 6);
  assert.equal(new Set(LIGHT_LOOKS.map(item => item.id)).size, 6);
  assert.deepEqual(LIGHT_LOOKS.map(item => item.id), ['jade-garden', 'rose-garden', 'moon-water', 'lagoon-water', 'silk-aurora', 'dusk-aurora']);
  for (const recipe of LIGHT_LOOKS) {
    assert.ok(SCENES.some(scene => scene.id === recipe.settings.scene));
    assert.ok(PALETTES.some(palette => palette.id === recipe.settings.palette));
    assert.deepEqual(Object.keys(recipe.settings).sort(), keys);
    assert.ok(recipe.settings.motion >= .15 && recipe.settings.motion <= .7);
    assert.equal(recipe.settings.autoDraw, true);
    assert.deepEqual(normaliseLook(recipe.settings), recipe.settings);
    assert.ok(Object.isFrozen(recipe));
    assert.ok(Object.isFrozen(recipe.settings));
  }
  assert.ok(Object.isFrozen(LIGHT_LOOKS));
  assert.ok(Object.isFrozen(DEFAULT_LOOK));
  assert.throws(() => LIGHT_LOOKS[0].settings.motion = .9, TypeError);
});

test('数値の型と有限性を確認し、境界へ収めて百分率にそろえる', () => {
  assert.deepEqual(normaliseLook(null), DEFAULT_LOOK);
  assert.deepEqual(normaliseLook(['garden']), DEFAULT_LOOK);
  const settings = normaliseLook({scene: 'water', palette: 'lagoon', intensity: -2, motion: 8, trails: .236, quality: 'low', autoDraw: false});
  assert.deepEqual(settings, {scene: 'water', palette: 'lagoon', intensity: .1, motion: 1, trails: .24, quality: 'low', autoDraw: false});
  for (const value of [undefined, null, true, '0.8', NaN, Infinity, -Infinity, {}, []]) {
    const result = normaliseLook({intensity: value, motion: value, trails: value, autoDraw: value});
    assert.equal(result.intensity, DEFAULT_LOOK.intensity);
    assert.equal(result.motion, DEFAULT_LOOK.motion);
    assert.equal(result.trails, DEFAULT_LOOK.trails);
    assert.equal(result.autoDraw, typeof value === 'boolean' ? value : DEFAULT_LOOK.autoDraw);
  }
  assert.equal(normaliseLook({motion: 0, trails: 0}).motion, 0);
  assert.equal(normaliseLook({scene: 'none', palette: 'script', quality: 'ultra'}).scene, DEFAULT_LOOK.scene);
});

test('getterや継承設定を実行せず、外部の値を共有内容へ混ぜない', () => {
  let reads = 0;
  const input = Object.create({scene: 'water', palette: 'dusk', intensity: .9});
  Object.defineProperty(input, 'motion', {get() {reads++; throw Error('do not run');}});
  input.autoDraw = false;
  input.fileName = 'private-recording.wav';
  input.microphone = true;
  input.soundEnabled = true;
  input.names = ['private'];
  assert.deepEqual(normaliseLook(input), {...DEFAULT_LOOK, autoDraw: false});
  assert.equal(reads, 0);
  const hash = makeLookHash(input);
  assert.equal(reads, 0);
  assert.doesNotMatch(hash, /private|wav|file|microphone|sound|names/);
  const polluted = JSON.parse('{"__proto__":{"motion":0.99},"constructor":{"prototype":{"scene":"water"}}}');
  assert.deepEqual(normaliseLook(polluted), DEFAULT_LOOK);
  assert.equal({}.motion, undefined);
});

test('各配合と手動設定のリンクが一意の公開設定へ往復する', () => {
  for (const settings of [...LIGHT_LOOKS.map(item => item.settings), DEFAULT_LOOK,
    {scene: 'water', palette: 'dusk', intensity: .1, motion: 0, trails: 1, quality: 'high', autoDraw: false}]) {
    const hash = makeLookHash(settings);
    assert.match(hash, /^#lumen=1&/);
    assert.ok(hash.length < 150);
    assert.deepEqual(parseLookHash(hash), {settings: normaliseLook(settings)});
    assert.equal(makeLookHash(parseLookHash(hash).settings), hash);
  }
  assert.deepEqual(parseLookHash(makeLookHash({motion: .3456, trails: .9999})).settings,
    {...DEFAULT_LOOK, motion: .35, trails: 1});
});

test('通常のアンカーや空入力へ介入しない', () => {
  for (const hash of ['', '#', '#lab', '#experience', '#lumens', '#lumen-title', null, undefined, 44, {}]) {
    assert.equal(parseLookHash(hash), null);
  }
});

test('壊れた共有リンクは一部だけ適用せず日本語のエラーを返す', () => {
  const cases = [
    '#lumen', '#lumen=1', '#lumen=2',
    defaultHash.replace('density=65', 'density=-10'),
    defaultHash.replace('density=65', 'density=0'),
    defaultHash.replace('density=65', 'density=101'),
    defaultHash.replace('motion=55', 'motion=1e2'),
    defaultHash.replace('motion=55', 'motion=NaN'),
    defaultHash.replace('motion=55', 'motion=Infinity'),
    defaultHash.replace('motion=55', 'motion=5.5'),
    defaultHash.replace('motion=55', 'motion=055'),
    defaultHash.replace('auto=1', 'auto=true'),
    defaultHash.replace('scene=garden', 'scene=%3Cscript%3E'),
    defaultHash.replace('palette=spectral', 'palette=%E0%A4%A'),
    `${defaultHash}&scene=water`, `${defaultHash}&file=private.wav`,
    `${defaultHash}&__proto__=anything`, `${defaultHash}&constructor=anything`,
    `${defaultHash}&ignored=${'a'.repeat(1000)}`,
  ];
  for (const hash of cases) {
    const result = parseLookHash(hash);
    assert.equal(typeof result?.error, 'string', hash);
    assert.match(result.error, /共有リンク/);
    assert.equal(result.settings, undefined);
  }
});

test('共有URLはクエリと古いアンカーを捨て、認証情報を受け付けない', () => {
  const url = createShareUrl('https://example.org/atelier/?token=private#old', LIGHT_LOOKS[3].settings);
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://example.org');
  assert.equal(parsed.pathname, '/atelier/');
  assert.equal(parsed.search, '');
  assert.doesNotMatch(url, /private|token|old/);
  assert.deepEqual(parseLookHash(parsed.hash).settings, LIGHT_LOOKS[3].settings);
  assert.match(createShareUrl('http://localhost:8000/', DEFAULT_LOOK), /^http:\/\/localhost:8000\/#lumen=/);
  for (const base of ['javascript:alert(1)', 'data:text/html,hello', 'file:///tmp/art.html', '/relative/',
    'https://user:secret@example.org/', 'https://user@example.org/', 'https://', null, {}, 'a'.repeat(9000)]) {
    assert.throws(() => createShareUrl(base, DEFAULT_LOOK), /共有/);
  }
});
