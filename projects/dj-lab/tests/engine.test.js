import test from 'node:test';
import assert from 'node:assert/strict';
import { DJEngine } from '../engine.js';

class Param {
  constructor(value = 0) { this.value = value; this.events = []; }
  setValueAtTime(value, when) { this.value = value; this.events.push(['set', value, when]); }
  linearRampToValueAtTime(value, when) { this.value = value; this.events.push(['ramp', value, when]); }
  setTargetAtTime(value, when, time) { this.value = value; this.events.push(['target', value, when, time]); }
  cancelScheduledValues(when) { this.events.push(['cancel', when]); }
  cancelAndHoldAtTime(when) { this.events.push(['hold', when]); }
}
class Node {
  constructor() {
    this.connections = []; this.disconnected = false;
    for (const key of ['gain', 'pan', 'frequency', 'Q', 'threshold', 'knee', 'ratio', 'attack', 'release', 'delayTime', 'playbackRate']) this[key] = new Param(key === 'gain' || key === 'playbackRate' ? 1 : 0);
  }
  connect(target) { this.connections.push(target); return target; }
  disconnect(target) { if (target) this.connections = this.connections.filter(node => node !== target); else { this.connections = []; this.disconnected = true; } }
}
class Source extends Node {
  constructor(context) { super(); this.context = context; this.stoppedAt = null; this.startedAt = null; this.ended = false; this.loop = false; }
  start(when, offset) {
    assert.equal(this.startedAt, null, 'A source may only be started once');
    this.startedAt = when; this.offset = offset;
  }
  stop(when) { this.stoppedAt = when; }
  finish() { if (!this.ended) { this.ended = true; this.onended?.(); } }
}
class MockContext {
  constructor() { this.currentTime = 0; this.state = 'suspended'; this.sampleRate = 48000; this.destination = new Node(); this.sources = []; }
  async resume() { this.state = 'running'; }
  createGain() { return new Node(); }
  createStereoPanner() { return new Node(); }
  createBiquadFilter() { return new Node(); }
  createDynamicsCompressor() { return new Node(); }
  createWaveShaper() { return new Node(); }
  createDelay() { return new Node(); }
  createAnalyser() { return new Node(); }
  createMediaStreamDestination() { const node = new Node(); node.stream = { id: 'mix-only-stream' }; return node; }
  createBufferSource() { const source = new Source(this); this.sources.push(source); return source; }
  advance(time) {
    this.currentTime = time;
    for (const source of this.sources) {
      if (source.ended || source.startedAt === null) continue;
      const naturalEnd = source.loop ? Infinity : source.startedAt + source.buffer.duration / source.playbackRate.value;
      if (Math.min(source.stoppedAt ?? Infinity, naturalEnd) <= time) source.finish();
    }
  }
}
globalThis.AudioContext = MockContext;
const buffer = duration => ({ duration, numberOfChannels: 1 });
async function ready(indices = [0], options = {}) {
  const engine = new DJEngine(); await engine.initialise();
  for (const i of indices) engine.load(i, { buffer: buffer(options.duration ?? 4), name: `Clip ${i}`, ...options });
  return engine;
}
function passOrigin(engine, delta = 0.1) { engine.context.advance(engine.origin + delta); return engine.getSnapshot(); }

test('停止中の予約を保持し、複数行を同一AudioContext時刻で開始する', async () => {
  const engine = await ready([0, 4, 8, 12]);
  for (const i of [0, 4, 8, 12]) engine.toggle(i);
  assert.equal(engine.context.sources.length, 0);
  assert.equal(engine.getSnapshot().queuedCount, 4);
  engine.start();
  assert.equal(engine.getSnapshot().playingCount, 0);
  assert.deepEqual(engine.context.sources.map(source => source.startedAt), Array(4).fill(engine.origin));
  assert.equal(passOrigin(engine).playingCount, 4);
  assert.equal(engine.getSnapshot().queuedCount, 0);
});

test('次の8拍境界への発音予約を取り消すと未来にも音源は開始しない', async () => {
  const engine = await ready(); engine.start(); passOrigin(engine, 0.4);
  engine.toggle(0);
  const source = engine.slots[0].voice.source;
  assert.equal(source.startedAt, engine.origin + 4);
  engine.toggle(0);
  assert.ok(source.stoppedAt < source.startedAt);
  engine.context.advance(engine.origin + 5);
  assert.equal(engine.getSnapshot().playingCount, 0);
  assert.equal(engine.getSnapshot().queuedCount, 0);
  assert.equal(engine.voices.size, 0);
  assert.ok(source.disconnected);
});

test('停止予約の取消は同じsourceを鳴らし続け、取消不能なsource.stopを予約しない', async () => {
  const engine = await ready(); engine.toggle(0); engine.start(); passOrigin(engine);
  const voice = engine.slots[0].voice;
  engine.toggle(0);
  assert.equal(engine.getSnapshot().slots[0].pending, 'stop');
  assert.equal(voice.source.stoppedAt, null);
  engine.toggle(0);
  engine.context.advance(engine.origin + 4.2);
  assert.equal(engine.getSnapshot().slots[0].playing, true);
  assert.equal(engine.slots[0].voice, voice);
  assert.equal(voice.source.stoppedAt, null);
});

test('停止境界を通過するとsourceを止めて接続を解放する', async () => {
  const engine = await ready(); engine.toggle(0); engine.start(); passOrigin(engine);
  const source = engine.slots[0].voice.source;
  engine.toggle(0); engine.context.advance(engine.origin + 4);
  assert.equal(engine.getSnapshot().playingCount, 0);
  assert.equal(source.stoppedAt, engine.origin + 4.008);
  engine.context.advance(engine.origin + 4.02);
  assert.ok(source.disconnected); assert.equal(engine.voices.size, 0);
});

test('同じ行の切替予約を取り消すと元のループを復帰する', async () => {
  const engine = await ready([0, 1]); engine.toggle(0); engine.start(); passOrigin(engine);
  const first = engine.slots[0].voice;
  engine.toggle(1);
  assert.equal(engine.getSnapshot().slots[0].pending, 'stop');
  engine.toggle(1);
  assert.equal(engine.getSnapshot().slots[0].pending, null);
  engine.context.advance(engine.origin + 4.2);
  assert.equal(engine.getSnapshot().playingCount, 1);
  assert.equal(engine.slots[0].voice, first);
});

test('同じ行の予約を二度切り替えても古い停止予約の解除により二重再生しない', async () => {
  const engine = await ready([0, 1, 2]); engine.toggle(0); engine.start(); passOrigin(engine);
  engine.toggle(1); engine.toggle(2);
  assert.equal(engine.getSnapshot().slots[0].pending, 'stop');
  assert.equal(engine.getSnapshot().slots[1].pending, null);
  assert.equal(engine.getSnapshot().slots[2].pending, 'start');
  engine.context.advance(engine.origin + 4.1);
  assert.deepEqual(engine.getSnapshot().slots.slice(0, 4).filter(slot => slot.playing).map(slot => slot.index), [2]);
});

test('量子化幅を変えた後の切替も同じ行の古い停止予約を上書きする', async () => {
  const engine = await ready([0, 1]); engine.toggle(0); engine.start(); passOrigin(engine);
  engine.toggle(0); // 8拍境界の停止予約。
  engine.setQuantise(1); engine.toggle(1); // 次の1拍で同じ行を切替。
  engine.context.advance(engine.origin + 0.6);
  assert.deepEqual(engine.getSnapshot().slots.filter(slot => slot.playing).map(slot => slot.index), [1]);
});

test('全停止は未来予約・echo出力も止め、素材は残す', async () => {
  const engine = await ready([0, 4]); engine.toggle(0); engine.start(); passOrigin(engine);
  engine.setMaster({ echo: 0.4 }); engine.toggle(4);
  const future = engine.slots[4].voice.source;
  engine.stop();
  assert.equal(engine.output.gain.value, 0);
  assert.ok(future.stoppedAt < future.startedAt);
  assert.equal(engine.getSnapshot().queuedCount, 0);
  assert.equal(engine.getSnapshot().playingCount, 0);
  assert.equal(engine.getSnapshot().slots[0].loaded, true);
  engine.context.advance(20);
  assert.equal(engine.voices.size, 0);
});

test('置換後に届く旧source.onendedは新しい音源の状態を壊さない', async () => {
  const engine = await ready(); engine.toggle(0); engine.start(); passOrigin(engine);
  const old = engine.slots[0].voice.source;
  engine.load(0, { buffer: buffer(2), name: 'Replacement', beats: 4 });
  engine.setQuantise(0); engine.toggle(0); engine.context.advance(engine.context.currentTime + 0.02);
  assert.equal(engine.getSnapshot().slots[0].playing, true);
  const replacement = engine.slots[0].voice;
  old.onended();
  assert.equal(engine.slots[0].voice, replacement);
  assert.equal(engine.getSnapshot().slots[0].playing, true);
});

test('BPM・ループ構造のlive編集を拒否し、音量・mute・panは即時反映する', async () => {
  const engine = await ready(); engine.toggle(0); engine.start(); passOrigin(engine);
  assert.throws(() => engine.setBpm(150), /停止/);
  assert.equal(engine.bpm, 120);
  assert.throws(() => engine.updateSlot(0, { beats: 4 }), /停止/);
  assert.throws(() => engine.updateSlot(0, { sync: false }), /停止/);
  assert.throws(() => engine.updateSlot(0, { loop: false }), /停止/);
  engine.updateSlot(0, { volume: 0.2, pan: -0.5, muted: true });
  assert.equal(engine.slots[0].gain.gain.value, 0);
  assert.equal(engine.slots[0].panner.pan.value, -0.5);
  engine.stop(); engine.setBpm(150); engine.updateSlot(0, { beats: 4, sync: false, loop: false });
  assert.equal(engine.bpm, 150);
  assert.equal(engine.getSnapshot().slots[0].beats, 4);
});

test('同期clipと未同期ファイルの速度・loop progressは音声時計から計算する', async () => {
  const engine = await ready([0, 4], { duration: 8 });
  engine.load(4, { buffer: buffer(8), name: 'Imported file', kind: 'file' });
  assert.equal(engine.slots[4].sync, false);
  engine.toggle(0); engine.toggle(4); engine.start();
  assert.equal(engine.slots[0].voice.rate, 2);
  assert.equal(engine.slots[4].voice.rate, 1);
  const snap = passOrigin(engine, 2);
  assert.equal(snap.slots[0].progress, 0.5);
  assert.equal(snap.slots[4].progress, 0.25);
});

test('ワンショットの自然終了でvoice接続を解放し、clockは継続する', async () => {
  const engine = await ready([0], { duration: 1, loop: false, sync: false });
  engine.toggle(0); engine.start(); passOrigin(engine, 0.1);
  const source = engine.slots[0].voice.source;
  engine.context.advance(engine.origin + 1.1);
  assert.equal(engine.getSnapshot().playingCount, 0);
  assert.equal(engine.running, true);
  assert.equal(engine.voices.size, 0);
  assert.ok(source.disconnected);
});

test('全同時modeからexclusiveへ戻すと各行一音源だけを残す', async () => {
  const engine = await ready([0, 1, 4, 5]); engine.setExclusive(false);
  for (const i of [0, 1, 4, 5]) engine.toggle(i);
  engine.start(); assert.equal(passOrigin(engine).playingCount, 4);
  engine.setExclusive(true);
  assert.deepEqual(engine.getSnapshot().slots.filter(slot => slot.playing).map(slot => slot.index), [0, 4]);
});

test('master outputの解析・録音経路と非有限パラメータの拒否', async () => {
  const engine = await ready();
  assert.ok(engine.analyser.connections.includes(engine.context.destination));
  assert.ok(engine.analyser.connections.includes(engine.recordDestination));
  assert.ok([...engine.guard.curve].every(value => Number.isFinite(value) && Math.abs(value) < 0.98));
  engine.setMaster({ filter: 0.5, low: -6, high: 3, volume: 1.2 });
  assert.equal(engine.filter.type, 'lowpass');
  engine.setMaster({ filter: 1 }); assert.equal(engine.filter.type, 'allpass');
  assert.throws(() => engine.setMaster({ echo: 0.41 }));
  assert.throws(() => engine.updateSlot(0, { volume: Infinity }));
  assert.throws(() => engine.setBpm(NaN));
  assert.throws(() => engine.setQuantise(2));
});
