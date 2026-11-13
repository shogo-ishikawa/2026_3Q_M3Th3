import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioEngine, MAX_FILE_BYTES, MAX_FILE_SECONDS} from '../audio.js';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; };
const settle = () => new Promise(resolve => setImmediate(resolve));
class Param {
  constructor(value = 0) { this.value = value; this.events = []; }
  cancelScheduledValues(t) { this.events.push(['cancel', t]); }
  setValueAtTime(value, t) { this.value = value; this.events.push(['set', value, t]); }
  linearRampToValueAtTime(value, t) { this.value = value; this.events.push(['linear', value, t]); }
  exponentialRampToValueAtTime(value, t) { this.value = value; this.events.push(['exponential', value, t]); }
}
class Node {
  constructor(kind) { this.kind = kind; this.connections = []; this.gain = new Param(); this.frequency = new Param(); this.stops = []; }
  connect(target) { this.connections.push(target); return target; }
  disconnect() { this.connections = []; this.disconnected = true; }
  start(...args) { this.started = args; }
  stop(...args) { this.stops.push(args); }
}
class Context {
  constructor() { this.state = 'running'; this.currentTime = 0; this.sampleRate = 48000; this.destination = new Node('destination'); this.nodes = []; this.decodeQueue = []; this.closes = 0; }
  node(kind) { const n = new Node(kind); this.nodes.push(n); return n; }
  createGain() { return this.node('gain'); }
  createDynamicsCompressor() {
    const n = this.node('limiter');
    for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[key] = new Param();
    return n;
  }
  createAnalyser() {
    const n = this.node('analyser'); n.fftSize = 2048;
    Object.defineProperty(n, 'frequencyBinCount', {get() { return this.fftSize / 2; }});
    n.getFloatTimeDomainData = a => { for (let i = 0; i < a.length; i++) a[i] = 0.15 * Math.sin(2 * Math.PI * 220 * i / this.sampleRate); };
    n.getFloatFrequencyData = a => { a.fill(-Infinity); a[9] = -10; };
    return n;
  }
  createMediaStreamSource(stream) { const n = this.node('microphone'); n.stream = stream; return n; }
  createBufferSource() { return this.node('file'); }
  createOscillator() { return this.node('oscillator'); }
  async decodeAudioData(bytes) { this.decodedBytes = bytes; return this.decodeQueue.length ? this.decodeQueue.shift()() : {duration: 20}; }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; this.closes++; }
}
const mic = () => {
  const tracks = [{stops: 0, stop() { this.stops++; }}, {stops: 0, stop() { this.stops++; }}];
  return {tracks, getTracks() { return tracks; }};
};
const file = (name = '音.wav', size = 200) => ({name, size, arrayBuffer: async () => new ArrayBuffer(8)});
const setup = (options = {}) => {
  const context = new Context(), states = [], errors = [];
  const engine = new AudioEngine({contextFactory: () => context, onState: state => states.push(state), onError: error => errors.push(error), ...options});
  return {engine, context, states, errors};
};

test('初期化では機器もAudioContextも開かず、無音から始まる', () => {
  let contexts = 0, requests = 0;
  const engine = new AudioEngine({contextFactory: () => { contexts++; return new Context(); }, getUserMedia: () => { requests++; }});
  assert.equal(contexts, 0); assert.equal(requests, 0);
  assert.deepEqual(engine.state, {source: 'none', micActive: false, fileName: '', playing: false, soundEnabled: false, volume: 0.25});
  assert.equal(engine.sample().pitchHz, null); assert.equal(engine.sample().level, 0);
});

test('マイクは解析器だけへ接続し、全トラックを停止して再開できる', async () => {
  const streams = [mic(), mic()]; let calls = 0;
  const {engine, context} = setup({getUserMedia: async () => streams[calls++]});
  await engine.startMicrophone();
  const input = context.nodes.find(n => n.kind === 'microphone');
  const analyser = context.nodes.find(n => n.kind === 'analyser');
  assert.deepEqual(input.connections, [analyser]);
  assert.deepEqual(analyser.connections, []);
  assert.equal(engine.state.micActive, true);
  const signal = engine.sample(); assert.ok(Math.abs(signal.pitchHz - 220) < 3); assert.ok(signal.level > 0);
  engine.stopMicrophone();
  assert.ok(streams[0].tracks.every(track => track.stops === 1));
  assert.equal(input.disconnected, true); assert.equal(engine.state.source, 'none');
  assert.equal(engine.sample().level, 0);
  await engine.startMicrophone(); assert.equal(calls, 2);
  await engine.dispose(); assert.ok(streams[1].tracks.every(track => track.stops === 1));
});

test('マイク許可を待つ間の停止で、遅れて届いた機器も解放する', async () => {
  const permission = deferred(), stream = mic();
  const {engine} = setup({getUserMedia: () => permission.promise});
  const pending = engine.startMicrophone(); await settle();
  engine.stopMicrophone(); permission.resolve(stream);
  assert.equal(await pending, false);
  assert.ok(stream.tracks.every(track => track.stops === 1));
  assert.equal(engine.state.source, 'none');
});

test('古いマイク要求が新しい要求を上書きしない', async () => {
  const first = deferred(), oldStream = mic(), newStream = mic(); let requests = 0;
  const {engine} = setup({getUserMedia: () => requests++ ? Promise.resolve(newStream) : first.promise});
  const previous = engine.startMicrophone(); await settle();
  await engine.startMicrophone(); first.resolve(oldStream);
  assert.equal(await previous, false);
  assert.ok(oldStream.tracks.every(track => track.stops === 1));
  assert.ok(newStream.tracks.every(track => track.stops === 0));
  assert.equal(engine.state.micActive, true); await engine.dispose();
});

test('拒否や機器なしでは入力を閉じ、再試行可能な案内を返す', async () => {
  const {engine, errors} = setup({getUserMedia: async () => { throw Object.assign(new Error('private platform detail'), {name: 'NotAllowedError'}); }});
  await assert.rejects(engine.startMicrophone(), /許可が得られませんでした/);
  assert.equal(errors.length, 1); assert.equal(engine.state.micActive, false);
  assert.equal(engine.state.source, 'none');
});

test('未対応の音声環境は操作時に検出し、音をONの表示へ進まない', async () => {
  const {engine, errors} = setup({contextFactory: () => { throw new Error('このブラウザは音声処理に対応していません。'); }});
  await assert.rejects(engine.enableSound(true), /対応していません/);
  assert.equal(errors.length, 1); assert.equal(engine.state.soundEnabled, false);
});

test('初期化途中の失敗でも接続を閉じ、再試行で新しいContextを使える', async () => {
  const broken = new Context(), healthy = new Context(); let calls = 0;
  broken.createAnalyser = () => { throw new Error('解析器を作れませんでした。'); };
  const {engine} = setup({contextFactory: () => calls++ ? healthy : broken});
  await assert.rejects(engine.enableSound(true), /解析器を作れませんでした/);
  assert.equal(broken.closes, 1);
  assert.ok(broken.nodes.every(n => n.disconnected));
  assert.equal(await engine.enableSound(true), true);
  assert.equal(engine.state.soundEnabled, true); await engine.dispose();
});

test('マイクから音源へ切り替えると機器を閉じ、ファイルは無音でも解析できる', async () => {
  const stream = mic(); const {engine, context} = setup({getUserMedia: async () => stream});
  await engine.startMicrophone(); await engine.loadFile(file('波.wav'));
  assert.ok(stream.tracks.every(track => track.stops === 1));
  assert.equal(engine.state.fileName, '波.wav'); assert.equal(engine.state.playing, false);
  await engine.playFile();
  assert.equal(engine.state.soundEnabled, false);
  const input = context.nodes.find(n => n.kind === 'file');
  assert.ok(input.connections.some(n => n.kind === 'analyser'));
  assert.ok(input.connections.some(n => n.kind === 'gain'));
  assert.equal(context.nodes.find(n => n.kind === 'gain').gain.value, 0);
  assert.ok(engine.sample().pitchHz > 0); await engine.dispose();
});

test('一時停止と再開では再生位置を保ち、自然終了後は先頭から始める', async () => {
  const {engine, context} = setup(); await engine.loadFile(file()); await engine.playFile();
  context.currentTime = 6.25; engine.pauseFile();
  assert.equal(engine.state.playing, false); assert.equal(engine.sample().level, 0);
  await engine.playFile();
  const resumed = context.nodes.filter(n => n.kind === 'file').at(-1);
  assert.deepEqual(resumed.started, [0, 6.25]);
  resumed.onended(); assert.equal(engine.state.playing, false);
  await engine.playFile();
  assert.deepEqual(context.nodes.filter(n => n.kind === 'file').at(-1).started, [0, 0]);
  await engine.dispose();
});

test('1サンプルのごく短い音源でも負の再生位置を指定しない', async () => {
  const {engine, context} = setup(); context.sampleRate = 192000;
  context.decodeQueue.push(() => ({duration: 1 / context.sampleRate}));
  await engine.loadFile(file()); await engine.playFile();
  assert.deepEqual(context.nodes.find(n => n.kind === 'file').started, [0, 0]);
  await engine.dispose();
});

test('入力停止後、非同期の再生開始が遅れて復活しない', async () => {
  const {engine, context} = setup(); await engine.loadFile(file());
  const resumed = deferred(); context.state = 'suspended';
  context.resume = () => resumed.promise.then(() => { context.state = 'running'; });
  const playback = engine.playFile(); await engine.stopInput(); resumed.resolve();
  assert.equal(await playback, false); assert.equal(engine.state.playing, false);
  assert.equal(context.nodes.filter(n => n.kind === 'file').length, 0);
});

test('大きすぎるファイルと空ファイルはデコード前に拒否する', async () => {
  const {engine, context} = setup();
  await assert.rejects(engine.loadFile(file('large.wav', MAX_FILE_BYTES + 1)), /60MB/);
  await assert.rejects(engine.loadFile(file('empty.wav', 0)), /音源ファイル/);
  assert.equal(context.decodedBytes, undefined); assert.equal(engine.state.source, 'none');
});

test('壊れた音源や20分を超えた音源では以前の再生を止めて状態を消す', async () => {
  const {engine, context, errors} = setup(); await engine.loadFile(file()); await engine.playFile();
  const first = context.nodes.find(n => n.kind === 'file');
  context.decodeQueue.push(() => { throw new Error('デコードできません。'); });
  await assert.rejects(engine.loadFile(file('broken.wav')), /読み込めませんでした/);
  assert.ok(first.stops.length); assert.equal(engine.state.playing, false); assert.equal(engine.state.fileName, '');
  context.decodeQueue.push(() => ({duration: MAX_FILE_SECONDS + 1}));
  await assert.rejects(engine.loadFile(file('long.wav')), /20分以内/);
  assert.equal(engine.state.source, 'none'); assert.equal(errors.length, 2);
});

test('古いデコード完了が、新しく選んだ音源を上書きしない', async () => {
  const {engine, context} = setup(); const slow = deferred();
  context.decodeQueue.push(() => slow.promise, () => ({duration: 8}));
  const old = engine.loadFile(file('old.wav')); await settle();
  await engine.loadFile(file('new.wav')); slow.resolve({duration: 50});
  assert.equal(await old, false); assert.equal(engine.state.fileName, 'new.wav');
  await engine.playFile(); assert.equal(context.nodes.find(n => n.kind === 'file').buffer.duration, 8);
});

test('ミュートと音量0を保ち、ON要求より後のOFFを優先する', async () => {
  const {engine, context} = setup(); const wait = deferred();
  context.state = 'suspended'; context.resume = () => wait.promise.then(() => { context.state = 'running'; });
  const enabling = engine.enableSound(true); await engine.enableSound(false); wait.resolve();
  assert.equal(await enabling, false); assert.equal(engine.state.soundEnabled, false);
  await engine.enableSound(true); engine.setVolume(0);
  assert.equal(engine.state.volume, 0); assert.equal(engine.playTone(440, 100), false);
  assert.equal(context.nodes.find(n => n.kind === 'gain').gain.value, 0);
  engine.setVolume(2); assert.equal(engine.state.volume, 1);
  await engine.enableSound(false); assert.equal(context.nodes.find(n => n.kind === 'gain').gain.value, 0);
});

test('短音は上限付きの同時発音とリミッターを通り、なぞり音を連打しない', async () => {
  const {engine, context} = setup(); await engine.enableSound(true);
  for (let i = 0; i < 30; i++) engine.playTone(440, 100);
  const voices = context.nodes.filter(n => n.kind === 'oscillator');
  assert.equal(voices.filter(n => !n.disconnected).length, 8);
  assert.ok(voices.every(n => n.stops.length >= 1 && n.stops.length <= 2));
  assert.ok(voices.filter(n => n.disconnected).every(n => n.stops.some(args => args.length === 0)));
  const limiter = context.nodes.find(n => n.kind === 'limiter');
  assert.deepEqual(limiter.connections, [context.destination]); assert.equal(limiter.ratio.value, 20);
  assert.equal(engine.playTouch(0.5, 0.5), true); assert.equal(engine.playTouch(0.5, 0.5), false);
  context.currentTime = 0.1; assert.equal(engine.playTouch(0.5, 0.5), true);
  await engine.dispose(); assert.ok(voices.every(n => n.disconnected));
});

test('終了後に届いたマイク許可を解放し、AudioContextも一度だけ閉じる', async () => {
  const permission = deferred(), stream = mic(); const {engine, context} = setup({getUserMedia: () => permission.promise});
  const pending = engine.startMicrophone(); await settle(); await engine.dispose(); permission.resolve(stream);
  assert.equal(await pending, false); assert.ok(stream.tracks.every(t => t.stops === 1));
  await engine.dispose(); assert.equal(context.closes, 1);
  assert.equal(engine.state.soundEnabled, false); assert.equal(engine.state.micActive, false);
  await assert.rejects(engine.playFile(), /終了しています/);
});

test('解析機器の例外を毎フレーム繰り返さず、入力を解放する', async () => {
  const stream = mic(); const {engine, context, errors} = setup({getUserMedia: async () => stream});
  await engine.startMicrophone();
  context.nodes.find(n => n.kind === 'analyser').getFloatTimeDomainData = () => { throw new Error('解析器エラー'); };
  assert.equal(engine.sample().level, 0); assert.equal(engine.sample().level, 0);
  assert.equal(errors.length, 1); assert.ok(stream.tracks.every(t => t.stops === 1));
});
