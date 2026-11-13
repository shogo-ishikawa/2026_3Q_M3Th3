import test from 'node:test';
import assert from 'node:assert/strict';
import {VisualField, pointerAppearance} from '../renderer.js';

function fakeCanvas() {
  const calls = {depth: 0, arcs: 0, ellipses: 0, curves: 0, strokes: 0, bad: []};
  const check = (...values) => { for (const value of values) if (typeof value === 'number' && !Number.isFinite(value)) calls.bad.push(value); };
  const gradient = {addColorStop(offset) {check(offset); assert.ok(offset >= 0 && offset <= 1);}};
  const context = {
    save() {calls.depth++;}, restore() {calls.depth--; assert.ok(calls.depth >= 0);},
    setTransform: check, fillRect: check, moveTo: check, lineTo: check, beginPath() {}, closePath() {}, fill() {},
    arc(...args) {check(...args); assert.ok(args[2] >= 0); calls.arcs++;},
    ellipse(...args) {check(...args); assert.ok(args[2] >= 0 && args[3] >= 0); calls.ellipses++;},
    bezierCurveTo(...args) {check(...args); calls.curves++;},
    stroke() {calls.strokes++;},
    createRadialGradient(...args) {check(...args); assert.ok(args[2] >= 0 && args[5] >= 0); return gradient;},
    createLinearGradient(...args) {check(...args); return gradient;},
  };
  return {width: 0, height: 0, getContext() {return context;}, context, calls};
}

const signal = {level: .4, pitchHz: 440, hasPitch: true, centroidHz: 700};

test('学生の上下・形・速さの対応を画面外と不正値でも保つ', () => {
  const high = pointerAppearance(0, 500, 100, .5);
  const low = pointerAppearance(500, 500, 100, .5);
  assert.equal(high.hue, 0); assert.equal(high.shape, 'star'); assert.equal(low.hue, 220); assert.equal(low.shape, 'round');
  assert.ok(pointerAppearance(100, 500, 1000).energy > pointerAppearance(100, 500, 10).energy);
  for (const values of [[-100, 500, -3], [800, 500, Infinity], [NaN, 0, NaN]]) {
    const appearance = pointerAppearance(...values);
    assert.ok(Object.values(appearance).filter(x => typeof x === 'number').every(Number.isFinite));
    assert.ok(appearance.hue >= 0 && appearance.hue <= 220);
  }
});

test('Canvas2D非対応・破棄後は描画も操作も安全に終了する', () => {
  const field = new VisualField({getContext() {throw new Error('unavailable');}});
  assert.equal(field.supported, false);
  field.resize(600, 400, 3); field.render({signal}); field.pointer({id: 1, x: 100, y: 200}); field.dispose();
  field.pointer({id: 2, x: 20, y: 20}); field.burst(20, 20); field.setScene('water'); field.resize(100, 50); field.render();
  assert.equal(field.stats.particles, 0);
});

test('3シーンは異なる描画経路へ到達し保存と復元を均衡させる', () => {
  const canvas = fakeCanvas(), field = new VisualField(canvas);
  field.resize(1200, 700, 3);
  assert.equal(canvas.width, 2400); assert.equal(canvas.height, 1400);
  for (const scene of ['garden', 'water', 'aurora']) {
    field.setScene(scene); const before = {...canvas.calls};
    field.render({time: 12, dt: 1 / 60, signal});
    assert.ok(canvas.calls.strokes > before.strokes);
    if (scene === 'water') assert.ok(canvas.calls.ellipses > before.ellipses);
    else assert.ok(canvas.calls.curves > before.curves);
    assert.equal(canvas.calls.depth, 0);
  }
  assert.deepEqual(canvas.calls.bad, []);
});

test('マルチポインター・巨大dt・長時間デモでも粒子と波紋を上限内に保つ', () => {
  const canvas = fakeCanvas(), field = new VisualField(canvas);
  field.resize(900, 600, 2); field.setScene('water'); field.setOptions({quality: 'low', intensity: 1});
  for (let i = 0; i < 20; i++) field.pointer({id: i, x: -100 + i * 90, y: i * 50});
  assert.equal(field.pointers.size, 12);
  for (let frame = 0; frame < 320; frame++) {
    field.pointer({id: frame % 12, x: Math.sin(frame) * 500 + 400, y: frame % 600});
    if (frame % 7 === 0) field.burst(400, 300);
    field.render({time: frame * 100000, dt: 100000, signal});
    assert.ok(field.stats.particles <= field.stats.maxParticles);
    assert.ok(field.stats.ripples <= 22);
  }
  assert.deepEqual(canvas.calls.bad, []); assert.equal(canvas.calls.depth, 0);
  field.release(1); assert.equal(field.pointers.has(1), false);
});

test('デモ停止後に新粒子を補充せず既存粒子が消え、クリア直後は空になる', () => {
  const canvas = fakeCanvas(), field = new VisualField(canvas);
  field.resize(600, 400); field.setDemo(false);
  assert.ok(field.stats.particles > 0);
  for (let i = 0; i < 180; i++) field.render({time: i * .05, dt: .05, signal: {...signal, level: 0, hasPitch: false}});
  assert.equal(field.stats.particles, 0);
  field.burst(200, 200); assert.ok(field.stats.particles > 0);
  field.clear(); assert.deepEqual(field.stats, {particles: 0, maxParticles: 560, ripples: 0});
});

test('seedが同じデモは同じ初期値を持ち、リサイズと無効設定で値を壊さない', () => {
  const a = new VisualField(fakeCanvas(), {seed: 12}), b = new VisualField(fakeCanvas(), {seed: 12});
  a.resize(800, 600); b.resize(800, 600);
  assert.deepEqual(a.particles, b.particles);
  a.setOptions({intensity: NaN, motion: -10, trails: 10, palette: 'invalid', quality: 'invalid'});
  assert.equal(a.options.motion, 0); assert.equal(a.options.trails, 1); assert.equal(a.options.palette, 'spectral');
  a.resize(NaN, -5, Infinity);
  assert.equal(a.width, 1); assert.equal(a.height, 1); assert.equal(a.dpr, 1);
  a.render({time: NaN, dt: Infinity, signal: {level: NaN, pitchHz: Infinity, hasPitch: true}});
  assert.equal(a.ctx.canvas?.calls?.depth ?? 0, 0);
  assert.ok(a.particles.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
});
