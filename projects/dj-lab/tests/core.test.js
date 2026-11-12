import test from 'node:test';
import assert from 'node:assert/strict';
import { KEYS, clipRate, nextBoundary, clipProgress, finiteRange, groupOf } from '../core.js';

test('学生版と同じ16キー・4行の対応', () => {
  assert.deepEqual(KEYS, ['1', '3', '5', '7', 'q', 'e', 't', 'u', 'a', 'd', 'g', 'j', 'z', 'c', 'b', 'm']);
  assert.deepEqual(KEYS.map((_, i) => groupOf(i)), [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3]);
  assert.throws(() => groupOf(16)); assert.throws(() => groupOf(0.5));
});

test('8拍は120BPMで4秒、量子化は先行時間も考慮して未来の境界を使う', () => {
  assert.equal(nextBoundary(10.1, 10, 120, 8), 14);
  assert.equal(nextBoundary(13.99, 10, 120, 8), 18);
  assert.equal(nextBoundary(10.1, 10, 120, 4), 12);
  assert.equal(nextBoundary(10.1, 10, 120, 1), 10.5);
  assert.ok(Math.abs(nextBoundary(10.1, 10, 120, 0) - 10.108) < 1e-12);
  assert.equal(nextBoundary(9.9, 10, 120, 0), 10);
  assert.throws(() => nextBoundary(1, 0, 120, 3));
});

test('同期ループは表示BPMで指定拍数を正確に使い切り、未同期ファイルは原速', () => {
  for (const bpm of [40, 90, 120, 173, 200]) {
    for (const duration of [0.4, 4, 9.3]) {
      const rate = clipRate(bpm, duration, 8, true);
      assert.ok(Math.abs(duration / rate - 8 * 60 / bpm) < 1e-10);
      assert.equal(clipRate(bpm, duration, 8, false), 1);
    }
  }
  assert.throws(() => clipRate(120, 0, 8, true));
  assert.throws(() => clipRate(120, 4, NaN, true));
});

test('再生位置は速度に応じて進み、ループ境界で戻る', () => {
  assert.equal(clipProgress(0.9, 1, 1, 4, true), 0);
  assert.equal(clipProgress(2, 1, 2, 4, true), 0.5);
  assert.equal(clipProgress(3, 1, 2, 4, true), 0);
  assert.equal(clipProgress(7, 1, 2, 4, false), 1);
});

test('数値設定は非有限値や範囲外を拒否する', () => {
  for (const invalid of [NaN, Infinity, -1, 1.1]) assert.throws(() => finiteRange(invalid, 0, 1));
  assert.throws(() => clipRate(201, 4, 8, true));
});
