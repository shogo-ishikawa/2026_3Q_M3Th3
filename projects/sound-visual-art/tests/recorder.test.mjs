import test from 'node:test';
import assert from 'node:assert/strict';
import {CanvasRecorder, MAX_VIDEO_BYTES} from '../recorder.js';

const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture({supportedTypes = ['video/webm;codecs=vp8'], constructorFails = false,
  startFails = false, stopFails = false, hangs = false, noData = false, withAudio = false} = {}) {
  const ready = [], errors = [], rawErrors = [], states = [], timers = new Map();
  let timerId = 0;
  const makeTrack = kind => ({kind, stops: 0, listeners: new Map(),
    stop() { this.stops++; },
    addEventListener(name, listener) { this.listeners.set(name, listener); },
    removeEventListener(name, listener) { if (this.listeners.get(name) === listener) this.listeners.delete(name); },
    end() { this.listeners.get('ended')?.(); },
  });
  const video = makeTrack('video'), audio = makeTrack('audio');
  const tracks = withAudio ? [video, audio] : [video];
  const stream = {getTracks: () => [...tracks], getAudioTracks: () => tracks.filter(track => track.kind === 'audio'),
    getVideoTracks: () => tracks.filter(track => track.kind === 'video'),
    removeTrack(track) { tracks.splice(tracks.indexOf(track), 1); },
  };
  const canvas = {captures: [], captureStream(fps) { this.captures.push(fps); return stream; }};
  class Recorder {
    static instances = [];
    static isTypeSupported(type) { return supportedTypes.includes(type); }
    constructor(input, options) {
      if (constructorFails) throw Error('constructor failure');
      this.stream = input; this.options = options; this.mimeType = options.mimeType || 'video/webm';
      this.state = 'inactive'; this.stopCalls = 0; Recorder.instances.push(this);
    }
    start(timeslice) { if (startFails) throw Error('start failure'); this.timeslice = timeslice; this.state = 'recording'; }
    chunk(data = new Blob(['moving light'], {type: this.mimeType})) { this.ondataavailable?.({data}); }
    stop() {
      this.stopCalls++;
      if (stopFails) throw Error('stop failure');
      this.state = 'inactive';
      if (hangs) return;
      queueMicrotask(() => { if (!noData) this.chunk(); this.onstop?.(); });
    }
  }
  const recorder = new CanvasRecorder({RecorderClass: Recorder,
    onReady: value => ready.push(value), onError: error => { errors.push(error.message); rawErrors.push(error); }, onState: value => states.push(value),
    setTimer: (callback, delay) => { timers.set(++timerId, {callback, delay}); return timerId; },
    clearTimer: id => timers.delete(id),
  });
  const fire = delay => {
    const entry = [...timers].find(([, timer]) => timer.delay === delay);
    assert.ok(entry, `timer ${delay}ms exists`);
    timers.delete(entry[0]); entry[1].callback();
  };
  return {recorder, Recorder, canvas, video, audio, ready, errors, rawErrors, states, timers, fire};
}

test('キャンバスだけを12秒・24fpsで撮り、最後のデータを待って一度だけ書き出す', async () => {
  const f = fixture({withAudio: true});
  assert.equal(f.recorder.supports(f.canvas), true);
  assert.equal(CanvasRecorder.supports(f.canvas, f.Recorder), true);
  assert.equal(f.recorder.start(f.canvas), true);
  assert.equal(f.recorder.recording, true);
  assert.deepEqual(f.canvas.captures, [24]);
  assert.equal(f.audio.stops, 1, '余分な音声トラックは除去する');
  const native = f.Recorder.instances[0];
  assert.deepEqual(native.stream.getTracks(), [f.video]);
  native.chunk(new Blob(['first'], {type: native.mimeType}));
  const promise = f.recorder.stop();
  assert.equal(f.recorder.recording, false);
  assert.strictEqual(f.recorder.stop(), promise, '停止を重ねても同じ完了待ち');
  const result = await promise;
  assert.equal(await result.blob.text(), 'firstmoving light');
  assert.equal(result.extension, 'webm');
  assert.equal(result.mimeType, 'video/webm;codecs=vp8');
  assert.equal(f.ready.length, 1);
  assert.equal(f.video.stops, 1);
  assert.equal(f.video.listeners.size, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(native.ondataavailable, null);
  assert.deepEqual(f.states, [
    {recording: true, duration: 12, processing: false},
    {recording: false, duration: 12, processing: true},
    {recording: false, duration: 12, processing: false},
  ], '撮影中・保存処理中・完了を分けて通知する');
  assert.deepEqual(f.errors, []);
  assert.equal(await f.recorder.stop(), null);
});

test('対応形式を選べないブラウザやcaptureStreamのない環境では収録を開始しない', () => {
  const f = fixture({supportedTypes: []});
  assert.equal(f.recorder.supported, false);
  assert.equal(f.recorder.start(f.canvas), false);
  assert.equal(f.canvas.captures.length, 0);
  assert.match(f.errors[0], /画像の保存/);
  const available = fixture();
  assert.equal(available.recorder.supports({}), false);
  assert.equal(available.recorder.start({}), false);
  assert.equal(available.Recorder.instances.length, 0);
});

test('MP4だけ対応する環境は適切な形式と拡張子を選ぶ', async () => {
  const f = fixture({supportedTypes: ['video/mp4']});
  assert.equal(f.recorder.start(f.canvas), true);
  const result = await f.recorder.stop();
  assert.equal(result.extension, 'mp4');
  assert.equal(result.blob.type, 'video/mp4');
});

test('形式照会のない古い実装ではブラウザの既定形式を使う', async () => {
  const f = fixture();
  f.Recorder.isTypeSupported = undefined;
  assert.equal(f.recorder.start(f.canvas), true);
  assert.equal('mimeType' in f.Recorder.instances[0].options, false);
  assert.equal((await f.recorder.stop()).extension, 'webm');
});

test('連打しても二つ目のstreamやエンコーダーを作らず、自動終了で解放する', async () => {
  const f = fixture();
  assert.equal(f.recorder.start(f.canvas), true);
  assert.equal(f.recorder.start(f.canvas), false);
  assert.equal(f.canvas.captures.length, 1);
  f.fire(12000);
  assert.equal(f.recorder.start(f.canvas), false, '終了イベントを待つ間も重ねない');
  await settle();
  assert.equal(f.ready.length, 1);
  assert.equal(f.recorder.recording, false);
  assert.equal(f.video.stops, 1);
  assert.equal(f.timers.size, 0);
  assert.equal(f.Recorder.instances[0].stopCalls, 1);
});

test('長さは15秒・fpsは30までとし、不正値は穏やかな既定値へ戻す', async () => {
  const f = fixture();
  f.recorder.start(f.canvas, {duration: 100, fps: 1000});
  assert.deepEqual(f.canvas.captures, [30]);
  f.fire(15000); await settle();
  const g = fixture();
  g.recorder.start(g.canvas, {duration: NaN, fps: Infinity});
  assert.deepEqual(g.canvas.captures, [24]);
  g.fire(12000); await settle();
  assert.equal(g.ready.length, 1);
});

test('取り消した動画はダウンロード対象にせずトラックを止める', async () => {
  const f = fixture();
  f.recorder.start(f.canvas);
  f.Recorder.instances[0].chunk();
  assert.equal(await f.recorder.stop({discard: true}), null);
  assert.equal(f.ready.length, 0);
  assert.equal(f.video.stops, 1);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.errors, []);
});

test('停止待ちにdisposeしても結果を後から通知せず、すぐ撮影トラックを解放する', async () => {
  const f = fixture({hangs: true});
  f.recorder.start(f.canvas);
  f.Recorder.instances[0].chunk();
  const pending = f.recorder.stop();
  await f.recorder.dispose();
  assert.equal(f.video.stops, 1);
  assert.equal(await pending, null);
  assert.equal(f.timers.size, 0);
  assert.equal(f.ready.length, 0);
  assert.equal(f.recorder.start(f.canvas), false);
});

for (const option of ['constructorFails', 'startFails', 'stopFails']) {
  test(`${option}でもCanvasの撮影トラックを残さない`, async () => {
    const f = fixture({[option]: true});
    const started = f.recorder.start(f.canvas);
    if (option === 'stopFails') { assert.equal(started, true); await f.recorder.stop(); }
    else assert.equal(started, false);
    assert.equal(f.recorder.recording, false);
    assert.equal(f.video.stops, 1);
    assert.equal(f.ready.length, 0);
    assert.equal(f.timers.size, 0);
    assert.equal(f.errors.length, 1);
    assert.ok(f.rawErrors[0].cause instanceof Error, '元の例外を診断用に保持する');
  });
}

test('空の動画を有効なファイルとして通知しない', async () => {
  const f = fixture({noData: true});
  f.recorder.start(f.canvas);
  assert.equal(await f.recorder.stop(), null);
  assert.equal(f.ready.length, 0);
  assert.match(f.errors[0], /保存できませんでした/);
  assert.equal(f.video.stops, 1);
});

test('エンコーダーエラーを一度だけ通知して収録物を破棄する', async () => {
  const f = fixture();
  f.recorder.start(f.canvas);
  const native = f.Recorder.instances[0];
  native.chunk();
  native.onerror();
  await settle();
  assert.equal(f.ready.length, 0);
  assert.equal(f.errors.length, 1);
  assert.equal(f.video.stops, 1);
  assert.equal(f.timers.size, 0);
});

test('20MiBを超えるデータが届いたら蓄積せず収録を終了する', async () => {
  const f = fixture();
  f.recorder.start(f.canvas);
  const native = f.Recorder.instances[0];
  native.chunk(new Blob([new Uint8Array(MAX_VIDEO_BYTES)]));
  native.chunk(new Blob(['overflow']));
  await settle();
  assert.equal(f.ready.length, 0);
  assert.match(f.errors[0], /容量/);
  assert.equal(f.video.stops, 1);
  assert.equal(f.timers.size, 0);
});

test('撮影トラックの終了からも動画の後処理へ進む', async () => {
  const f = fixture();
  f.recorder.start(f.canvas);
  f.video.end();
  await settle();
  assert.equal(f.ready.length, 1);
  assert.equal(f.video.stops, 1);
  assert.equal(f.timers.size, 0);
});

test('終了イベントが届かない場合も有限時間で失敗を通知し資源を解放する', async () => {
  const f = fixture({hangs: true});
  f.recorder.start(f.canvas);
  const pending = f.recorder.stop();
  f.fire(2500);
  assert.equal(await pending, null);
  assert.equal(f.video.stops, 1);
  assert.equal(f.ready.length, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.errors.length, 1);
});

test('ブラウザーのタイマーを正しいglobal receiverで呼び、保存開始と後処理を完了する', async () => {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  const timers = new Map(), ready = [], errors = [];
  let timerId = 0;
  try {
    // Windowのブランド検査を再現します。CanvasRecorderをthisにして呼ぶと失敗します。
    globalThis.setTimeout = function(callback, delay) {
      assert.strictEqual(this, globalThis, 'setTimeout requires the Window receiver');
      timers.set(++timerId, {callback, delay}); return timerId;
    };
    globalThis.clearTimeout = function(id) {
      assert.strictEqual(this, globalThis, 'clearTimeout requires the Window receiver');
      timers.delete(id);
    };
    const f = fixture();
    const recorder = new CanvasRecorder({RecorderClass: f.Recorder,
      onReady: value => ready.push(value), onError: error => errors.push(error)});
    assert.equal(recorder.start(f.canvas), true);
    assert.equal(recorder.recording, true);
    assert.equal((await recorder.stop()).extension, 'webm');
    assert.equal(ready.length, 1);
    assert.equal(errors.length, 0);
    assert.equal(f.video.stops, 1);
    assert.equal(timers.size, 0);
  } finally {
    globalThis.setTimeout = originalSet;
    globalThis.clearTimeout = originalClear;
  }
});

test('注入したタイマーは余計なreceiverを渡さず呼び出す', async () => {
  const f = fixture();
  let next = 0;
  const timers = new Map();
  const recorder = new CanvasRecorder({RecorderClass: f.Recorder,
    setTimer: function(callback, delay) {
      assert.equal(this, undefined);
      timers.set(++next, {callback, delay}); return next;
    },
    clearTimer: function(id) { assert.equal(this, undefined); timers.delete(id); },
  });
  assert.equal(recorder.start(f.canvas), true);
  await recorder.stop();
  assert.equal(f.video.stops, 1);
  assert.equal(timers.size, 0);
});
