import test from 'node:test';
import assert from 'node:assert/strict';
import {clamp, computeTargets, detectPitch, analyseFrame, demoSignal, SCENES, PALETTES} from '../core.js';

const near = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);
const tone = (frequency, sampleRate = 48000, length = 4096, amplitude = 0.5, offset = 0) =>
  Float32Array.from({length}, (_, i) => offset + amplitude * Math.sin(2 * Math.PI * frequency * i / sampleRate));

test('範囲外・非有限の入力を有限な境界へ収める', () => {
  assert.equal(clamp(4, -1, 1), 1);
  assert.equal(clamp(-4, -1, 1), -1);
  assert.equal(clamp(Infinity), 1);
  assert.equal(clamp(-Infinity), 0);
  assert.equal(clamp(NaN), 0);
  assert.equal(clamp(undefined), 0);
  assert.throws(() => clamp(1, 2, 0), RangeError);
});

// 提出Notebookの関数をPythonで抽出して計算した固定値。画面の実装とは独立です。
test('学生版の低音・高音・中間値と順逆モードの固定値に一致する', () => {
  const fixtures = [
    [130, 10, false, '#373a4c', 4, 1, '丸形(4波)', 28, 30],
    [1000, 100, false, '#ff1e00', 16, 100, 'トゲ星型(16角)', 100, 100],
    [565, 55, false, '#3da53b', 10, 50, 'トゲ星型(10角)', 64, 64],
    [880, 95, false, '#f59e09', 15, 90, 'トゲ星型(15角)', 96, 96],
    [165, 20, false, '#3d4860', 5, 8, '丸形(5波)', 36, 37],
    [880, 20, true, '#12a4eb', 15, 52, '丸形(15波)', 92, 92],
  ];
  for (const [frequency, volume, reverse, colour, vertices, number, shape, saturation, brightness] of fixtures) {
    const actual = computeTargets(frequency, volume, reverse);
    assert.equal(actual.hexColour, colour);
    assert.equal(actual.vertexCount, vertices);
    assert.equal(actual.numberValue, number);
    assert.equal(actual.shapeLabel, shape);
    assert.equal(Math.trunc(actual.saturation * 100), saturation);
    assert.equal(Math.trunc(actual.brightness * 100), brightness);
  }
});

test('Pythonの偶数丸めを保ち、外径と丸形の閉じた端点を保つ', () => {
  assert.equal(computeTargets(130, 13.75).vertexCount, 4); // 4.5 → 4
  assert.equal(computeTargets(130, 21.25).vertexCount, 6); // 5.5 → 6
  assert.equal(computeTargets(565, 55).numberValue, 50); // 50.5 → 50
  const low = computeTargets(130, 10);
  assert.equal(low.shapePoints.length, 200);
  near(low.shapePoints[0][0], 0.68);
  near(low.shapePoints.at(-1)[0], low.shapePoints[0][0]);
  near(low.shapePoints.at(-1)[1], 0);
  for (const target of [low, computeTargets(880, 95), computeTargets(1000, 100)]) {
    for (const [x, y] of target.shapePoints) assert.ok(Math.hypot(x, y) <= 0.68 + 1e-12);
    near(Math.max(...target.shapePoints.map(([x, y]) => Math.hypot(x, y))), 0.68);
  }
});

test('順逆は正規化値を補数へ変え、範囲外入力も安全に表示する', () => {
  const normal = computeTargets(300, 70), reverse = computeTargets(300, 70, true);
  near(normal.pitchNorm + reverse.pitchNorm, 1);
  near(normal.volumeNorm + reverse.volumeNorm, 1);
  assert.deepEqual(computeTargets(-500, -10), computeTargets(130, 10));
  assert.deepEqual(computeTargets(Infinity, Infinity), computeTargets(1000, 100));
  for (const n of [NaN, undefined]) {
    const result = computeTargets(n, n);
    assert.equal(result.numberValue, 1);
    assert.ok(result.shapePoints.flat().every(Number.isFinite));
  }
});

test('YINは複数のサンプルレートと音高の既知の周期を復元する', () => {
  for (const sampleRate of [22050, 44100, 48000]) {
    for (const length of [2048, 4096]) {
      for (const frequency of [80, 110, 165, 220, 440, 880, 1200]) {
        const result = detectPitch(tone(frequency, sampleRate, length), sampleRate);
        assert.notEqual(result.frequency, null, `${sampleRate}Hz / ${frequency}Hz`);
        near(result.frequency, frequency, Math.max(0.8, frequency * 0.005));
        assert.ok(result.confidence > 0.95);
        near(result.rms, 0.5 / Math.sqrt(2), 0.008);
      }
    }
  }
});

test('基本波より第2倍音が強い音も、最大FFTビンではなく基本周期から読む', () => {
  const sampleRate = 48000, frequency = 220;
  const samples = Float32Array.from({length: 4096}, (_, i) =>
    0.25 * Math.sin(2 * Math.PI * frequency * i / sampleRate) +
    0.65 * Math.sin(2 * Math.PI * frequency * 2 * i / sampleRate) +
    0.15 * Math.sin(2 * Math.PI * frequency * 3 * i / sampleRate));
  const result = detectPitch(samples, sampleRate);
  near(result.frequency, 220, 0.8);
  assert.ok(result.confidence > 0.95);
});

test('直流成分を除いて音高を読み、無音・直流だけ・小さすぎる音を未検出にする', () => {
  near(detectPitch(tone(330, 48000, 4096, 0.3, 0.5), 48000).frequency, 330, 0.8);
  for (const samples of [new Float32Array(4096), new Float32Array(4096).fill(0.75), tone(440, 48000, 4096, 0.001)]) {
    const result = detectPitch(samples, 48000);
    assert.equal(result.frequency, null);
    assert.equal(result.confidence, 0);
    assert.ok(Number.isFinite(result.rms));
  }
});

test('周期を持たない雑音と指定範囲外の高音を音高として表示しない', () => {
  let state = 8721;
  const noise = Float32Array.from({length: 4096}, () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return (state / 2 ** 32 - 0.5) * 0.5;
  });
  assert.equal(detectPitch(noise, 48000).frequency, null);
  assert.equal(detectPitch(tone(2000), 48000).frequency, null);
});

test('不正な波形・サンプルレート・検出範囲を例外やNaNへ流さない', () => {
  const corrupted = tone(440); corrupted[53] = NaN;
  const cases = [
    [null, 48000], [[], 48000], [tone(440, 48000, 16), 48000],
    [tone(440), 0], [tone(440), NaN], [corrupted, 48000],
    [Array(4096).fill(Number.MAX_VALUE), 48000],
    [tone(440), 48000, {minHz: -1}], [tone(440), 48000, {minHz: 600, maxHz: 300}],
    [tone(440), 48000, {threshold: 0}],
  ];
  for (const args of cases) {
    const result = detectPitch(...args);
    assert.deepEqual(result, {frequency: null, confidence: 0, rms: 0});
  }
});

test('FFT重心はdBを振幅へ戻し、ビン幅と直流除去を使ってHzで求める', () => {
  // 8ビン / 8000Hz → 1ビン500Hz。2番1.0と6番0.5の重心は1666.67Hz。
  const frequencyDb = Float32Array.from([20, -Infinity, 0, -Infinity, -Infinity, -Infinity, 20 * Math.log10(0.5), -Infinity]);
  const result = analyseFrame(new Float32Array(4096), frequencyDb, 8000);
  near(result.centroidHz, (1000 + 0.5 * 3000) / 1.5, 0.0001);
  assert.equal(result.level, 0);
  assert.equal(result.pitchHz, null);
  assert.equal(result.hasPitch, false);
  assert.equal(analyseFrame([], [], NaN).centroidHz, 0);
  assert.equal(analyseFrame([], new Float32Array(8).fill(-Infinity), 8000).centroidHz, 0);
});

test('相対音量は振幅とともに増え、音高検出と別々の値を返す', () => {
  const quiet = analyseFrame(tone(440, 48000, 4096, 0.01), [], 48000);
  const loud = analyseFrame(tone(440, 48000, 4096, 0.2), [], 48000);
  assert.ok(quiet.level > 0 && quiet.level < loud.level && loud.level <= 1);
  for (const result of [quiet, loud]) {
    assert.equal(result.hasPitch, true);
    near(result.pitchHz, 440, 0.8);
  }
});

test('音源なしのデモは再現可能で、定義済みのシーンと色を変更できない', () => {
  assert.deepEqual(demoSignal(12.5), demoSignal(12.5));
  assert.deepEqual(demoSignal(NaN), demoSignal(0));
  assert.notDeepEqual(demoSignal(5), demoSignal(15));
  for (let t = -100; t <= 100; t += 1.25) {
    const signal = demoSignal(t);
    assert.ok(signal.level >= 0 && signal.level <= 1);
    assert.ok(signal.pitchHz >= 80 && signal.pitchHz <= 1200);
    assert.equal(signal.hasPitch, true);
    assert.ok(Object.values(signal).every(value => typeof value === 'boolean' || Number.isFinite(value)));
  }
  assert.deepEqual(SCENES.map(scene => scene.id), ['garden', 'water', 'aurora']);
  assert.deepEqual(PALETTES.map(palette => palette.id), ['spectral', 'lagoon', 'dusk']);
  assert.ok(Object.isFrozen(SCENES) && SCENES.every(Object.isFrozen));
  assert.ok(Object.isFrozen(PALETTES) && PALETTES.every(Object.isFrozen));
});
