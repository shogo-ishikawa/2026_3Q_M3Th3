import test from 'node:test';
import assert from 'node:assert/strict';
import { DJEngine } from '../engine.js';

class Param {
  constructor(value = 0) { this.value = value; this.events = []; }
  setValueAtTime(value, at) { this.value = value; this.events.push(['set', value, at]); }
  linearRampToValueAtTime(value, at) { this.value = value; this.events.push(['ramp', value, at]); }
  setTargetAtTime(value) { this.value = value; }
  cancelScheduledValues() {}
  cancelAndHoldAtTime() {}
}
class Node {
  constructor() {
    this.connections = [];
    for (const key of ['gain', 'pan', 'frequency', 'Q', 'threshold', 'knee', 'ratio', 'attack', 'release', 'delayTime', 'playbackRate']) this[key] = new Param(key === 'gain' || key === 'playbackRate' ? 1 : 0);
  }
  connect(node) { this.connections.push(node); return node; }
  disconnect(node) { this.connections = node ? this.connections.filter(other => other !== node) : []; }
}
class Context {
  constructor() { this.currentTime = 0; this.state = 'running'; this.sampleRate = 48000; this.destination = new Node(); this.sources = []; }
  async resume() { this.state = 'running'; }
  createGain() { return new Node(); }
  createStereoPanner() { return new Node(); }
  createBiquadFilter() { return new Node(); }
  createDynamicsCompressor() { return new Node(); }
  createWaveShaper() { return new Node(); }
  createDelay() { return new Node(); }
  createAnalyser() { return new Node(); }
  createMediaStreamDestination() { const node = new Node(); node.stream = {}; return node; }
  createBufferSource() {
    const source = new Node();
    source.start = at => { source.startedAt = at; };
    source.stop = at => { source.stoppedAt = at; };
    this.sources.push(source); return source;
  }
  advance(at) {
    this.currentTime = at;
    for (const source of this.sources) if (!source.ended && source.stoppedAt !== undefined && source.stoppedAt <= at) {
      source.ended = true; source.onended?.();
    }
  }
}
globalThis.AudioContext = Context;
async function ready() {
  const engine = new DJEngine(); await engine.initialise();
  for (let i = 0; i < 16; i += 1) engine.load(i, { buffer: { duration: 4 }, name: `Clip ${i}` });
  return engine;
}
const playing = engine => engine.getSnapshot().slots.filter(slot => slot.playing).map(slot => slot.index);
const planned = engine => engine.getSnapshot().slots.filter(slot => slot.pending === 'start' || (slot.playing && slot.pending !== 'stop')).map(slot => slot.index);
function startScene(engine, indices) {
  engine.setScene(indices); engine.start(); engine.context.advance(engine.origin + 0.1); engine.getSnapshot();
}

test('切替待ちの別パッドをMinimalで取り消しても古い予約を再投入しない', async () => {
  const engine = await ready(); startScene(engine, [0, 4]);
  const original = engine.slots[0].voice;
  engine.toggle(1);
  assert.equal(engine.getSnapshot().slots[0].pending, 'stop');
  assert.equal(engine.getSnapshot().slots[1].pending, 'start');
  engine.setScene([0, 4]);
  assert.deepEqual(planned(engine), [0, 4]);
  engine.context.advance(engine.origin + 4.1);
  assert.deepEqual(playing(engine), [0, 4]);
  assert.equal(engine.slots[0].voice, original, 'the retained loop should not be restarted');
});

test('シーンの停止・開始を1回の量子化境界計算で同時予約する', async () => {
  const engine = await ready(); startScene(engine, [0, 4, 8, 12]);
  engine.toggle(2); engine.toggle(6);
  engine.setScene([1, 5, 9, 13]);
  const scheduled = engine.slots.filter(slot => slot.pending);
  assert.equal(scheduled.length, 8);
  assert.equal(new Set(scheduled.map(slot => slot.pending.at)).size, 1);
  assert.deepEqual(planned(engine), [1, 5, 9, 13]);
  engine.context.advance(engine.origin + 4.1);
  assert.deepEqual(playing(engine), [1, 5, 9, 13]);
});

test('境界前にFull→Break→Minimalと押しても最後の目標集合だけを発音する', async () => {
  const engine = await ready(); startScene(engine, [0, 4, 8, 12]);
  for (const want of [[1, 5, 8, 12], [9, 14], [0, 4]]) {
    engine.setScene(want);
    assert.deepEqual(planned(engine), want);
  }
  engine.context.advance(engine.origin + 4.1);
  assert.deepEqual(playing(engine), [0, 4]);
});

test('停止中の旧予約と停止直後の再開も指定シーンだけを開始する', async () => {
  const engine = await ready();
  engine.toggle(3); engine.toggle(7); engine.setScene([0, 4]);
  engine.start(); engine.context.advance(engine.origin + 0.1);
  assert.deepEqual(playing(engine), [0, 4]);
  engine.stop(); engine.setScene([9, 14]); engine.start();
  engine.context.advance(engine.origin + 0.1);
  assert.deepEqual(playing(engine), [9, 14]);
});

test('全同時モードのシーンは複数の同一行音源を選択・除外できる', async () => {
  const engine = await ready(); engine.setExclusive(false); startScene(engine, [0, 1, 4, 5]);
  engine.setScene([1, 2, 5]);
  assert.deepEqual(planned(engine), [1, 2, 5]);
  engine.context.advance(engine.origin + 4.1);
  assert.deepEqual(playing(engine), [1, 2, 5]);
  engine.setScene([]); engine.context.advance(engine.origin + 8.1);
  assert.deepEqual(playing(engine), []);
});

test('不正・欠損音源を含むシーンは既存の予約を変更する前に拒否する', async () => {
  const engine = await ready(); startScene(engine, [0, 4]); engine.toggle(1);
  const before = planned(engine);
  for (const want of [[16], [0, 1], '0', [NaN]]) {
    assert.throws(() => engine.setScene(want)); assert.deepEqual(planned(engine), before);
  }
  engine.clear(9);
  assert.throws(() => engine.setScene([9])); assert.deepEqual(planned(engine), before);
});
