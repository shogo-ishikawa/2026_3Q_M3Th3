import test from 'node:test';
import assert from 'node:assert/strict';
import { DJEngine } from '../engine.js';
import { partGains } from '../core.js';

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

test('パートミックスは中央で原音量、両端で片方を消し、非有限値を拒否する', () => {
  assert.deepEqual(partGains(0), [1, 0]);
  assert.deepEqual(partGains(0.25), [1, 0.5]);
  assert.deepEqual(partGains(0.5), [1, 1]);
  assert.deepEqual(partGains(0.75), [0.5, 1]);
  assert.deepEqual(partGains(1), [0, 1]);
  for (const value of [-0.1, 1.1, NaN, Infinity]) assert.throws(() => partGains(value));
});

test('パート別busだけをフェードし、サンプラーは同じマスターFXと録音経路へ送る', async () => {
  const engine = await ready([0, 4, 8, 12]);
  for (const i of [0, 4]) assert.ok(engine.slots[i].panner.connections.includes(engine.rhythmBus));
  for (const i of [8, 12]) assert.ok(engine.slots[i].panner.connections.includes(engine.melodyBus));
  engine.setMaster({ balance: 0 });
  assert.equal(engine.rhythmBus.gain.value, 1); assert.equal(engine.melodyBus.gain.value, 0);
  engine.triggerSample(10, buffer(1), { volume: 1 });
  const sample = engine.sampleVoices.get(10);
  assert.deepEqual(sample.gain.connections, [engine.sampleBus]);
  assert.deepEqual(engine.sampleBus.connections, [engine.mix]);
  assert.deepEqual(engine.mix.connections, [engine.low]);
  assert.ok(engine.analyser.connections.includes(engine.recordDestination));
  assert.ok(engine.analyser.connections.includes(engine.context.destination));
  assert.equal(sample.gain.gain.value, 1);
  engine.setMaster({ balance: 1 });
  assert.equal(engine.rhythmBus.gain.value, 0); assert.equal(engine.melodyBus.gain.value, 1);
  assert.equal(sample.gain.gain.value, 1, 'the sample is not faded with the rhythm part');
});

test('クロック停止中にも単発サンプルを鳴らし、自然終了時に音声接続を解放する', async () => {
  const engine = await ready();
  const at = engine.triggerSample(3, buffer(0.4));
  assert.equal(at, 0.008); assert.equal(engine.running, false);
  assert.equal(engine.output.gain.value, 1);
  assert.equal(engine.getSnapshot().sampleQueuedCount, 1);
  const voice = engine.sampleVoices.get(3);
  assert.equal(voice.source.loop, false); assert.equal(voice.source.playbackRate.value, 1);
  engine.context.advance(at + 0.1);
  const snap = engine.getSnapshot();
  assert.equal(snap.samples[3].playing, true); assert.equal(snap.samples[3].pending, false);
  assert.equal(snap.sampleCount, 1); assert.equal(snap.playingCount, 0);
  engine.context.advance(at + 0.5);
  assert.equal(engine.getSnapshot().sampleCount, 0); assert.equal(engine.sampleSources.size, 0);
  assert.equal(engine.sampleVoices.size, 0); assert.ok(voice.source.disconnected); assert.ok(voice.gain.disconnected);
});

test('演奏中のサンプルは指定した拍境界へ予約し、未開始の表示を区別する', async () => {
  const engine = await ready(); engine.start(); passOrigin(engine, 0.2);
  const at = engine.triggerSample(8, buffer(0.6), { quantise: 1 });
  assert.equal(at, engine.origin + 0.5);
  assert.equal(engine.getSnapshot().samples[8].pending, true);
  assert.equal(engine.getSnapshot().sampleCount, 0);
  engine.context.advance(at + 0.01);
  assert.equal(engine.getSnapshot().sampleCount, 1);
  assert.equal(engine.getSnapshot().sampleQueuedCount, 0);
});

test('DROPのシーンと効果音を同一の音声時計時刻に揃える', async () => {
  const engine = await ready([0, 4, 8, 12]); engine.start(); passOrigin(engine, 0.7);
  const at = engine.setScene([0, 4, 8, 12]);
  assert.equal(at, engine.origin + 4);
  assert.equal(engine.triggerSample(10, buffer(1), { at }), at);
  assert.ok(engine.slots.every(slot => !slot.voice || slot.voice.startedAt === at));
  assert.equal(engine.sampleVoices.get(10).source.startedAt, at);
  engine.context.advance(at + 0.1);
  assert.equal(engine.getSnapshot().playingCount, 4); assert.equal(engine.getSnapshot().sampleCount, 1);
  engine.stop(); assert.equal(engine.setScene([0]), null, 'a stopped scene still waits for transport start');
});

test('不正なサンプル操作は既存の発音を壊さず拒否する', async () => {
  const engine = await ready(); engine.context.advance(1);
  engine.triggerSample(0, buffer(1)); const original = engine.sampleVoices.get(0);
  const invalid = [
    () => engine.triggerSample(16, buffer(1)),
    () => engine.triggerSample(0, buffer(0)),
    () => engine.triggerSample(0, buffer(1), { volume: Infinity }),
    () => engine.triggerSample(0, buffer(1), { quantise: 2 }),
    () => engine.triggerSample(0, buffer(1), { at: 0.9 }),
    () => engine.triggerSample(0, buffer(1), { at: NaN }),
  ];
  for (const call of invalid) { assert.throws(call); assert.equal(engine.sampleVoices.get(0), original); }
  assert.equal(original.source.stoppedAt, null);
});

test('同じサンプルの連打は再発音し、旧onendedが新しい発音表示を消さない', async () => {
  const engine = await ready(); engine.triggerSample(2, buffer(2));
  engine.context.advance(0.1); const old = engine.sampleVoices.get(2);
  engine.triggerSample(2, buffer(2)); const replacement = engine.sampleVoices.get(2);
  assert.notEqual(old, replacement); assert.ok(Math.abs(old.source.stoppedAt - 0.108) < 1e-12);
  old.source.onended();
  assert.equal(engine.sampleVoices.get(2), replacement); assert.ok(old.source.disconnected);
  engine.context.advance(0.12); assert.equal(engine.getSnapshot().samples[2].playing, true);
});

test('サンプルの多重押しを8音に制限し、古いフェード中の接続も際限なく増やさない', async () => {
  const engine = await ready();
  for (let i = 0; i < 8; i++) engine.triggerSample(i, buffer(2));
  engine.context.advance(0.1);
  for (let i = 0; i < 256; i++) {
    engine.triggerSample(i % 16, buffer(2));
    assert.ok(engine.sampleVoices.size <= 8);
    assert.ok(engine.sampleSources.size <= 16);
  }
  engine.context.advance(0.12); assert.equal(engine.getSnapshot().sampleCount, 8);
  engine.context.advance(3); assert.equal(engine.sampleSources.size, 0); assert.equal(engine.sampleVoices.size, 0);
  assert.ok(engine.context.sources.every(source => source.disconnected));
});

test('全停止は未来の効果音と押しているFXも取り消し、再開時に復活させない', async () => {
  const engine = await ready(); engine.toggle(0); engine.start(); passOrigin(engine);
  engine.setMaster({ low: 4, echo: 0.2 });
  for (const effect of ['filter', 'echo', 'bass']) engine.setPerformance(effect, true);
  const at = engine.triggerSample(0, buffer(2), { quantise: 8 });
  const future = engine.sampleVoices.get(0);
  engine.stop();
  assert.equal(engine.sampleVoices.size, 0); assert.ok(future.source.stoppedAt < at);
  assert.equal(engine.output.gain.value, 0); assert.equal(engine.low.gain.value, 4);
  assert.equal(engine.echoReturn.gain.value, 0.2); assert.equal(engine.filter.type, 'allpass');
  assert.deepEqual(engine.getSnapshot().performance, { filter: false, echo: false, bass: false });
  engine.start(); engine.context.advance(10);
  assert.equal(engine.getSnapshot().sampleCount, 0); assert.equal(engine.sampleSources.size, 0);
});

test('押しているFXは独立して重ねられ、離すと最新のマスター設定に戻る', async () => {
  const engine = await ready(); engine.setMaster({ filter: 0.8, echo: 0.1, low: 3, high: -2 });
  for (const effect of ['filter', 'echo', 'bass']) engine.setPerformance(effect, true);
  assert.equal(engine.filter.frequency.value, 400); assert.equal(engine.low.gain.value, -24); assert.equal(engine.echoReturn.gain.value, 0.4);
  engine.setMaster({ filter: 0.5, echo: 0.2, low: 6 });
  assert.equal(engine.filter.frequency.value, 400); assert.equal(engine.low.gain.value, -24); assert.equal(engine.echoReturn.gain.value, 0.4);
  assert.equal(engine.master.filter, 0.5); assert.equal(engine.master.low, 6); assert.equal(engine.master.echo, 0.2);
  engine.setPerformance('filter', false); assert.equal(engine.filter.type, 'lowpass');
  assert.ok(Math.abs(engine.filter.frequency.value - 20 * Math.sqrt(1000)) < 1e-9);
  assert.equal(engine.low.gain.value, -24); engine.setPerformance('bass', false); assert.equal(engine.low.gain.value, 6);
  engine.setPerformance('echo', false); assert.equal(engine.echoReturn.gain.value, 0.2); assert.equal(engine.high.gain.value, -2);
});

test('音声開始前のFX・音量設定も反映し、不明な効果や範囲外を拒否する', async () => {
  const engine = new DJEngine(); engine.setPerformance('echo', true); engine.setSampleVolume(0.35);
  engine.setMaster({ balance: 0.25 }); await engine.initialise();
  assert.equal(engine.echoReturn.gain.value, 0.4); assert.equal(engine.sampleBus.gain.value, 0.35);
  assert.equal(engine.rhythmBus.gain.value, 1); assert.equal(engine.melodyBus.gain.value, 0.5);
  assert.throws(() => engine.setPerformance('unknown', true));
  for (const invalid of [-0.1, 1.1, NaN, Infinity]) assert.throws(() => engine.setSampleVolume(invalid));
  assert.equal(engine.sampleVolume, 0.35); assert.throws(() => engine.setMaster({ balance: -1 }));
});

test('サンプラー音量は発音中の音にも反映し、パート音量と独立する', async () => {
  const engine = await ready(); engine.triggerSample(2, buffer(1), { volume: 1 });
  engine.context.advance(0.1); const voice = engine.sampleVoices.get(2);
  engine.setSampleVolume(0);
  assert.equal(engine.sampleBus.gain.value, 0); assert.equal(voice.gain.gain.value, 1);
  engine.setSampleVolume(0.25); assert.equal(engine.getSnapshot().sampleVolume, 0.25);
  assert.equal(engine.sampleBus.gain.value, 0.25); assert.equal(engine.master.volume, 0.75);
});

test('サンプル発音中のクロック開始で出力を無音へ戻さない', async () => {
  const engine = await ready(); engine.triggerSample(1, buffer(2)); engine.context.advance(0.1);
  const sample = engine.sampleVoices.get(1), events = engine.output.gain.events.length;
  engine.toggle(0); engine.start();
  assert.equal(sample.source.stoppedAt, null);
  assert.ok(!engine.output.gain.events.slice(events).some(event => event[0] === 'set' && event[1] === 0));
  assert.equal(engine.getSnapshot().sampleCount, 1);
});

test('音声未開始でも全停止でき、押したFXだけ解除し保存設定を残す', () => {
  const engine = new DJEngine(); engine.setPerformance('bass', true); engine.setSampleVolume(0.2); engine.setMaster({ balance: 0.8 });
  assert.doesNotThrow(() => engine.stop());
  assert.equal(engine.getSnapshot().performance.bass, false);
  assert.equal(engine.sampleVolume, 0.2); assert.equal(engine.master.balance, 0.8);
});

test('DROPから別シーンへ切り替えると、未発音のDROP効果音だけ取り消す', async () => {
  const engine = await ready([0, 4, 8, 12]); engine.start(); passOrigin(engine, 0.3);
  const at = engine.setScene([0, 4, 8, 12]);
  engine.triggerSample(10, buffer(1), { at, tag: 'scene' });
  const drop = engine.sampleVoices.get(10);
  engine.setScene([8, 12]);
  assert.ok(drop.source.stoppedAt < at); assert.ok(drop.source.disconnected);
  assert.equal(engine.getSnapshot().samples[10].pending, false);
  engine.context.advance(at + 0.1);
  assert.equal(engine.getSnapshot().sampleCount, 0);
  assert.deepEqual(engine.getSnapshot().slots.filter(slot => slot.playing).map(slot => slot.index), [8, 12]);
});

test('DROP連打は古い効果音の予約を除き、最後の予約を1つだけ残す', async () => {
  const engine = await ready([0, 4, 8, 12]); engine.start(); passOrigin(engine, 0.3);
  const drops = [];
  for (let i = 0; i < 4; i++) {
    const at = engine.setScene([0, 4, 8, 12]);
    engine.triggerSample(10, buffer(1), { at, tag: 'scene' });
    drops.push(engine.sampleVoices.get(10));
  }
  for (const old of drops.slice(0, -1)) assert.ok(old.source.stoppedAt < old.startedAt && old.source.disconnected);
  assert.equal(engine.sampleVoices.size, 1); assert.equal(engine.sampleSources.size, 1);
  const last = drops.at(-1); assert.equal(last.source.stoppedAt, null);
  engine.context.advance(last.startedAt + 0.1); assert.equal(engine.getSnapshot().sampleCount, 1);
});

test('手動impactがDROP予約を置換した後のシーン変更は、その手動音を消さない', async () => {
  const engine = await ready([0, 4, 8]); engine.start(); passOrigin(engine, 0.3);
  const at = engine.setScene([0, 4]);
  engine.triggerSample(10, buffer(1), { at, tag: 'scene' });
  const drop = engine.sampleVoices.get(10);
  engine.triggerSample(10, buffer(1)); const manual = engine.sampleVoices.get(10);
  assert.notEqual(drop, manual); assert.equal(manual.tag, null);
  engine.setScene([8]);
  assert.equal(engine.sampleVoices.get(10), manual); assert.equal(manual.source.stoppedAt, null);
  engine.context.advance(manual.startedAt + 0.1); assert.equal(engine.getSnapshot().samples[10].playing, true);
});

test('発音済みのDROPの余韻はシーンを変えても自然終了まで残る', async () => {
  const engine = await ready([0, 4]); engine.start(); passOrigin(engine, 0.3);
  const at = engine.setScene([0]); engine.triggerSample(10, buffer(2), { at, tag: 'scene' });
  engine.context.advance(at + 0.1); const sounding = engine.sampleVoices.get(10);
  engine.setScene([4]);
  assert.equal(engine.sampleVoices.get(10), sounding); assert.equal(sounding.source.stoppedAt, null);
  engine.context.advance(at + 2.1); assert.equal(engine.sampleVoices.size, 0);
});

test('不正なシーン入力は既存の効果音予約もループ予約も変更しない', async () => {
  const engine = await ready([0]); engine.start(); passOrigin(engine, 0.3);
  const at = engine.setScene([0]); engine.triggerSample(10, buffer(1), { at, tag: 'scene' });
  const effect = engine.sampleVoices.get(10), pending = engine.slots[0].pending;
  for (const invalid of [null, [16], [4], [0, 1]]) {
    assert.throws(() => engine.setScene(invalid));
    assert.equal(engine.sampleVoices.get(10), effect); assert.equal(effect.source.stoppedAt, null);
    assert.equal(engine.slots[0].pending, pending);
  }
});

