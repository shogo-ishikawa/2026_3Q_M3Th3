import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {analyseFrame, clamp, computeTargets, demoSignal, SCENES} from '../core.js';
import {VisualField} from '../renderer.js';
import {AudioEngine} from '../audio.js';
import {LIGHT_LOOKS, normaliseLook, parseLookHash, makeLookHash, createShareUrl} from '../looks.js';
import {CanvasRecorder} from '../recorder.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};

// ブラウザそのものを置き換える試験ではありません。実際のappのイベント処理を実行し、
// AudioEngine→analyseFrame→VisualFieldの経路とライフサイクルをブラウザAPIのテストダブルで確認します。
class Element {
  constructor(tagName = 'DIV') {this.tagName = tagName.toUpperCase(); this.events = new Map(); this.attributes = new Map(); this.dataset = {}; this.style = {}; this.children = []; this._text = ''; this.value = ''; this.hidden = false; this.checked = false; this.files = []; this.clicks = 0;}
  addEventListener(type, callback) {if (!this.events.has(type)) this.events.set(type, []); this.events.get(type).push(callback);}
  async dispatch(type, props = {}) {const event = {target: this, preventDefault() {}, ...props}; await Promise.all((this.events.get(type) ?? []).map(fn => fn(event)));}
  setAttribute(key, value) {this.attributes.set(key, String(value));}
  getAttribute(key) {return this.attributes.get(key) ?? null;}
  removeAttribute(key) {this.attributes.delete(key);}
  append(...children) {this.children.push(...children);}
  replaceChildren(...children) {this.children = children; this._text = '';}
  set textContent(value) {this._text = String(value); this.children = [];}
  get textContent() {return this._text + this.children.map(child => typeof child === 'string' ? child : child.textContent).join('');}
  click() {this.clicks++; return this.dispatch('click');}
  getBoundingClientRect() {return {left: 0, top: 0, width: 900, height: 600};}
  setPointerCapture(id) {this.capture = id;}
  get clientWidth() {return 900;}
  get clientHeight() {return 600;}
  focus() {this.focused = true; if (this.ownerDocument) this.ownerDocument.activeElement = this;}
  select() {this.selected = true;}
  classNames = new Set();
  classList = {toggle: (name, force) => {const enabled = force ?? !this.classNames.has(name); if (enabled) this.classNames.add(name); else this.classNames.delete(name); return enabled;}, contains: name => this.classNames.has(name)};
}

function canvasContext() {
  const gradient = () => ({addColorStop() {}});
  return {save() {}, restore() {}, setTransform() {}, fillRect() {}, moveTo() {}, lineTo() {}, beginPath() {}, closePath() {}, fill() {}, stroke() {}, arc() {}, ellipse() {}, bezierCurveTo() {}, createRadialGradient: gradient, createLinearGradient: gradient};
}

class Param {
  constructor() {this.value = 0;}
  cancelScheduledValues() {}
  setValueAtTime(value) {this.value = value;}
  linearRampToValueAtTime(value) {this.value = value;}
  exponentialRampToValueAtTime(value) {this.value = value;}
}
class AudioNode {
  constructor(kind) {this.kind = kind; this.connections = []; this.gain = new Param(); this.frequency = new Param();}
  connect(node) {this.connections.push(node);}
  disconnect() {this.connections = []; this.disconnected = true;}
  start(...args) {this.started = args;}
  stop() {this.stopped = true;}
}
class AudioContextFixture {
  constructor() {this.state = 'running'; this.currentTime = 0; this.sampleRate = 48000; this.destination = new AudioNode('destination'); this.nodes = [];}
  node(kind) {const node = new AudioNode(kind); this.nodes.push(node); return node;}
  createGain() {return this.node('gain');}
  createDynamicsCompressor() {const node = this.node('limiter'); for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) node[key] = new Param(); return node;}
  createAnalyser() {const node = this.node('analyser'); node.fftSize = 2048; Object.defineProperty(node, 'frequencyBinCount', {get() {return this.fftSize / 2;}}); node.getFloatTimeDomainData = array => {for (let i = 0; i < array.length; i++) array[i] = .12 * Math.sin(2 * Math.PI * 440 * i / this.sampleRate);}; node.getFloatFrequencyData = array => {array.fill(-Infinity); array[19] = -15;}; return node;}
  createMediaStreamSource() {return this.node('microphone');}
  createBufferSource() {return this.node('file');}
  createOscillator() {return this.node('oscillator');}
  async decodeAudioData() {return {duration: 30};}
  async resume() {this.state = 'running';}
  async close() {this.state = 'closed';}
}
const streamFixture = () => {const track = {stops: 0, stop() {this.stops++;}}; return {track, getTracks() {return [track];}};};

function appHarness({getUserMedia, reduced = false, hash = '', clipboardAvailable = true, recordingSupported = true, canvasSupported = true} = {}) {
  const elements = new Map([...html.matchAll(/\bid="([\w-]+)"/g)].map(match => [match[1], new Element()]));
  assert.equal(elements.size, [...html.matchAll(/\bid="([\w-]+)"/g)].length, 'HTMLのidは一意');
  for (const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([\w-]+)"[^>]*)>/gi)) {
    const element = elements.get(match[3]);
    element.tagName = match[1].toUpperCase();
    element.hidden = /(?:^|\s)hidden(?:\s|=|$)/.test(match[2]);
  }
  const canvas = elements.get('art-canvas'); canvas.tagName = 'CANVAS'; canvas.getContext = canvasSupported ? canvasContext : () => null;
  canvas.toBlob = (callback, type) => {canvas.exportType = type; callback(new Blob(['canvas snapshot'], {type}));};
  const values = {intensity: '65', motion: '55', trails: '70', palette: 'spectral', quality: 'auto', 'output-volume': '25', frequency: '880', volume: '95'};
  for (const [id, value] of Object.entries(values)) elements.get(id).value = value;
  elements.get('auto-draw').checked = true; elements.get('comparison').hidden = true;
  const scenes = SCENES.map(scene => {const button = new Element('button'); button.dataset.scene = scene.id; return button;});
  const tones = ['880,95', '165,95', '880,20', '165,20'].map(tone => {const button = new Element('button'); button.dataset.tone = tone; return button;});
  const looks = LIGHT_LOOKS.map(look => {const button = new Element('button'); button.dataset.look = look.id; return button;});
  const document = new Element('document'); document.hidden = false; document.fullscreenElement = null; document.body = new Element('body');
  for (const element of elements.values()) element.ownerDocument = document;
  document.getElementById = id => {assert.ok(elements.has(id), `DOM id ${id} exists`); return elements.get(id);};
  document.querySelector = selector => {assert.equal(selector, '.level-track'); return elements.get('level-fill');};
  document.querySelectorAll = selector => {if (selector === '[data-scene]') return scenes; if (selector === '[data-tone]') return tones; if (selector === '[data-look]') return looks; throw Error(`Unexpected selector ${selector}`);};
  document.createTextNode = text => ({textContent: String(text)});
  const anchors = [];
  document.createElement = name => {const node = new Element(name); if (name === 'a') anchors.push(node); return node;};
  document.createElementNS = (namespace, name) => {const node = new Element(name); node.namespaceURI = namespace; return node;};
  const window = new Element('window'); window.devicePixelRatio = 1;
  const context = new AudioContextFixture(), stream = streamFixture(), frames = new Map(), urls = [], timers = [];
  const location = {href: `https://example.test/projects/sound-visual-art/?private-query=remove${hash}`, hash};
  const clipboard = [];
  const navigator = {clipboard: clipboardAvailable ? {async writeText(text) {clipboard.push(text);}} : undefined};
  const videoStreams = [], videoRecorders = [], recordingTimers = new Map(); let nextTimer = 0;
  const videoStream = () => {const track = {kind: 'video', stops: 0, stop() {this.stops++;}, addEventListener() {}, removeEventListener() {}}; const stream = {track, getTracks: () => [track], getVideoTracks: () => [track], getAudioTracks: () => []}; videoStreams.push(stream); return stream;};
  if (recordingSupported) canvas.captureStream = fps => {canvas.captureFps = fps; return videoStream();};
  class RecorderFixture {
    static isTypeSupported(type) {return type.startsWith('video/webm');}
    constructor(stream, options) {this.stream = stream; this.options = options; this.mimeType = options.mimeType; this.state = 'inactive'; videoRecorders.push(this);}
    start(interval) {this.interval = interval; this.state = 'recording';}
    stop() {this.state = 'inactive'; queueMicrotask(() => {this.ondataavailable?.({data: new Blob(['recorded light'], {type: this.mimeType})}); this.onstop?.();});}
  }
  let field, audio, recorder, nextFrame = 0;
  class Field extends VisualField {constructor(target) {super(target); field = this;}}
  class Audio extends AudioEngine {constructor(options) {super({...options, contextFactory: () => context, getUserMedia: getUserMedia ?? (async () => stream)}); audio = this;}}
  class Recording extends CanvasRecorder {constructor(options) {super({...options, RecorderClass: RecorderFixture, setTimer(callback, delay) {const id = ++nextTimer; recordingTimers.set(id, {callback, delay}); return id;}, clearTimer(id) {recordingTimers.delete(id);}}); recorder = this;}}
  const run = new Function('LIGHT_LOOKS', 'normaliseLook', 'parseLookHash', 'createShareUrl', 'CanvasRecorder', 'location', 'navigator', 'clamp', 'computeTargets', 'demoSignal', 'SCENES', 'VisualField', 'AudioEngine', 'document', 'window', 'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'URL', 'setTimeout', source.replace(/^import .*;\s*$/gm, ''));
  run(LIGHT_LOOKS, normaliseLook, parseLookHash, createShareUrl, Recording, location, navigator, clamp, computeTargets, demoSignal, SCENES, Field, Audio, document, window,
    () => ({matches: reduced, addEventListener() {}}),
    callback => {const id = ++nextFrame; frames.set(id, callback); return id;},
    id => frames.delete(id), class {observe() {}},
    {createObjectURL(blob) {urls.push(blob); return `blob:test-${urls.length}`;}, revokeObjectURL() {}}, callback => timers.push(callback));
  return {elements, canvas, document, window, context, stream, scenes, tones, looks, frames, urls, anchors, location, clipboard, videoStreams, videoRecorders, recordingTimers,
    get recorder() {return recorder;},
    get field() {return field;}, get audio() {return audio;},
    async click(id) {await elements.get(id).dispatch('click');},
    async input(id, value) {const element = elements.get(id); if (typeof value === 'boolean') element.checked = value; else element.value = String(value); await element.dispatch('input');},
    frame(timestamp = 1000) {assert.equal(frames.size, 1, '描画ループは一つ'); const [id, callback] = frames.entries().next().value; frames.delete(id); callback(timestamp); assert.ok(frames.size <= 1);},
    async hide() {document.hidden = true; await document.dispatch('visibilitychange');},
    async changeHash(hash) {location.hash = hash; location.href = `https://example.test/projects/sound-visual-art/${hash}`; await window.dispatch('hashchange');},
    async close() {await window.dispatch('pagehide', {persisted: false}); await settle();},
  };
}

async function usingHarness(options, callback) {const harness = appHarness(options); try {await callback(harness);} finally {await harness.close();}}

test('実際の初期化で無音デモを表示し、自動描画を切ると仮想音高も止める', async () => {
  await usingHarness({}, async h => {
    assert.equal(h.audio.state.soundEnabled, false); assert.equal(h.context.nodes.length, 0);
    h.frame(1000); assert.match(h.elements.get('pitch-value').textContent, /\d/);
    await h.input('auto-draw', false);
    // 読み出し表示は150ms間隔で更新するため、その周期を超えて進めます。
    for (const timestamp of [1050, 1100, 1150, 1200]) h.frame(timestamp);
    assert.equal(h.field.demo, false);
    assert.match(h.elements.get('pitch-value').textContent, /—/);
    assert.equal(h.elements.get('level-fill').style.width, '0%');
    assert.match(h.elements.get('source-badge').textContent, /DRAW/);
  });
});

test('場面・一時停止・なぞり・再開を切り替えてもrAFを重複させない', async () => {
  await usingHarness({}, async h => {
    for (const button of h.scenes) {await button.dispatch('click'); assert.equal(h.field.scene, button.dataset.scene); assert.equal(button.getAttribute('aria-pressed'), 'true');}
    await h.click('pause'); assert.equal(h.frames.size, 0);
    await h.canvas.dispatch('pointerdown', {pointerId: 1, clientX: 120, clientY: 180, pressure: .5, timeStamp: 0});
    assert.ok(h.field.stats.particles > 0); assert.equal(h.frames.size, 0);
    await h.canvas.dispatch('pointercancel', {pointerId: 1}); assert.equal(h.field.pointers.size, 0);
    await h.click('pause'); assert.equal(h.frames.size, 1); h.frame(2000);
    await h.click('clear'); assert.equal(h.field.demo, false); assert.equal(h.field.pointers.size, 0); assert.equal(h.field.stats.particles, 0);
  });
});

test('音源の読み込み・再生・解析から、デモを使わず新しい光を発生させる', async () => {
  await usingHarness({}, async h => {
    h.elements.get('audio-file').files = [{name: 'test.wav', size: 8, arrayBuffer: async () => new ArrayBuffer(8)}];
    await h.elements.get('audio-file').dispatch('change');
    assert.equal(h.audio.state.source, 'file'); assert.equal(h.audio.state.playing, false);
    assert.equal(h.elements.get('file-player').hidden, false); assert.equal(h.field.demo, false);
    h.field.clear(); await h.click('file-play'); assert.equal(h.audio.state.playing, true);
    h.frame(1000); h.frame(1060); h.frame(1120);
    assert.ok(h.field.stats.particles > 0, '入力音の特徴から粒子が生まれる');
    assert.match(h.elements.get('pitch-value').textContent, /440/);
    await h.click('sound-toggle'); assert.equal(h.audio.state.soundEnabled, false);
    assert.equal(h.audio.state.playing, true); assert.equal(h.field.demo, false);
    await h.click('file-play'); assert.equal(h.audio.state.playing, false);
  });
});

test('非表示では音源を停止位置付きで保持し、自動再生せず再開できる', async () => {
  await usingHarness({}, async h => {
    h.elements.get('audio-file').files = [{name: 'test.wav', size: 8, arrayBuffer: async () => new ArrayBuffer(8)}];
    await h.elements.get('audio-file').dispatch('change'); await h.click('file-play');
    h.context.currentTime = 6.25; await h.hide();
    assert.equal(h.frames.size, 0); assert.equal(h.audio.state.source, 'file'); assert.equal(h.audio.state.playing, false);
    h.document.hidden = false;
    assert.equal(h.frames.size, 0, 'ページへ戻っただけでは再開しない');
    await h.click('file-play');
    const resumed = h.context.nodes.filter(node => node.kind === 'file').at(-1);
    assert.deepEqual(resumed.started, [0, 6.25]);
    assert.equal(h.frames.size, 1);
  });
});

test('マイク入力の分析が光へ届き、非表示でトラックを解放する', async () => {
  await usingHarness({}, async h => {
    await h.click('microphone'); assert.equal(h.audio.state.micActive, true);
    const input = h.context.nodes.find(node => node.kind === 'microphone');
    assert.deepEqual(input.connections.map(node => node.kind), ['analyser']);
    h.field.clear(); h.frame(1000); h.frame(1060); h.frame(1120);
    assert.ok(h.field.stats.particles > 0); assert.equal(h.field.demo, false);
    await h.hide(); assert.equal(h.stream.track.stops, 1); assert.equal(h.audio.state.micActive, false); assert.equal(h.frames.size, 0);
  });
});

test('周期を検出しない雑音でも周波数重心から色を変え、デモなしで粒子と波紋を作る', () => {
  let seed = 2026;
  const noise = Float32Array.from({length: 2048}, () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed / 4294967296 - .5) * .3;});
  const spectrum = bin => {const data = new Float32Array(1024); data.fill(-Infinity); data[bin] = -12; return data;};
  const low = analyseFrame(noise, spectrum(8), 48000), high = analyseFrame(noise, spectrum(200), 48000);
  assert.equal(low.hasPitch, false); assert.equal(high.hasPitch, false);
  assert.equal(low.pitchHz, null); assert.equal(high.pitchHz, null);
  assert.ok(high.centroidHz > low.centroidHz);
  const fields = [low, high].map(signal => {
    const canvas = new Element('canvas'); canvas.getContext = canvasContext;
    const field = new VisualField(canvas, {seed: 27}); field.resize(900, 600); field.setScene('water'); field.setDemo(false); field.clear();
    for (let i = 0; i < 40; i++) field.render({time: i * .05, dt: .05, signal});
    assert.ok(field.stats.particles > 0); assert.ok(field.stats.ripples > 0);
    assert.ok(field.stats.particles <= field.stats.maxParticles);
    return field;
  });
  assert.ok(fields[1].particles[0].hue < fields[0].particles[0].hue, '重心が高い音は暖色側へ変わる');
  for (const field of fields) {
    field.clear();
    for (let i = 0; i < 40; i++) field.render({time: i * .05, dt: .05, signal: {level: 0, hasPitch: false, pitchHz: null, centroidHz: 0}});
    assert.equal(field.stats.particles, 0); assert.equal(field.stats.ripples, 0);
    field.dispose();
  }
});

test('許可待ちのマイクをデモで取り消し、遅い許可が音源状態を上書きしない', async () => {
  const permission = deferred(), late = streamFixture();
  await usingHarness({getUserMedia: () => permission.promise}, async h => {
    const pending = h.click('microphone'); await settle();
    assert.equal(h.elements.get('microphone').disabled, true);
    await h.click('demo-input'); permission.resolve(late); await pending;
    assert.equal(late.track.stops, 1); assert.equal(h.audio.state.source, 'none'); assert.equal(h.audio.state.micActive, false);
    assert.equal(h.elements.get('microphone').disabled, false); assert.equal(h.field.demo, true);
    assert.equal(h.frames.size, 1);
  });
});

test('比較実験の実イベントが学生の4条件と反転・比較表示へつながる', async () => {
  await usingHarness({}, async h => {
    for (const button of h.tones) {
      await button.dispatch('click'); const [hz, volume] = button.dataset.tone.split(',').map(Number);
      const expected = computeTargets(hz, volume);
      assert.equal(h.elements.get('colour-disc').style.background, expected.hexColour);
      assert.equal(Number(h.elements.get('number-result').textContent), expected.numberValue);
    }
    await h.click('reverse'); assert.equal(h.elements.get('reverse').getAttribute('aria-pressed'), 'true');
    assert.equal(Number(h.elements.get('number-result').textContent), computeTargets(165, 20, true).numberValue);
    await h.click('compare'); assert.equal(h.elements.get('comparison').hidden, false); assert.equal(h.elements.get('comparison').children.length, 4);
    await h.click('compare'); assert.equal(h.elements.get('comparison').hidden, true);
  });
});

test('PNG保存は現在のCanvasだけをimage/pngで出力し、音声状態を変更しない', async () => {
  await usingHarness({}, async h => {
    await h.click('save-image');
    assert.equal(h.canvas.exportType, 'image/png'); assert.equal(h.urls.length, 1); assert.equal(h.urls[0].type, 'image/png');
    assert.equal(h.anchors.at(-1).download, 'lumen-garden.png'); assert.equal(h.anchors.at(-1).clicks, 1);
    assert.equal(h.audio.state.source, 'none'); assert.equal(h.audio.state.soundEnabled, false);
  });
});

test('動きを減らす設定では静止画から始め、明示的な再開だけでループを始める', async () => {
  await usingHarness({reduced: true}, async h => {
    assert.equal(h.frames.size, 0); assert.equal(h.field.options.motion, 0);
    assert.match(h.elements.get('pause').getAttribute('aria-label'), /再開/);
    await h.click('pause'); assert.equal(h.frames.size, 1);
  });
});

test('公開HTMLとES moduleのローカル参照先が全て存在し、外部スクリプトへ依存しない', () => {
  const references = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(match => match[1]);
  for (const path of references.filter(path => !/^(?:https?:|dist\/|\.\.\/)/.test(path))) {
    assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), path);
  }
  assert.doesNotMatch(html, /<script[^>]+src="https?:/i);
  for (const file of ['app.js', 'audio.js', 'renderer.js', 'core.js', 'looks.js', 'recorder.js']) {
    const code = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const match of code.matchAll(/from\s+['"](\.\/[^'"]+)['"]/g)) assert.ok(existsSync(new URL(`../${match[1]}`, import.meta.url)), `${file}: ${match[1]}`);
  }
});


function currentLook(harness) {
  const e = harness.elements;
  return normaliseLook({scene: harness.field.scene, palette: e.get('palette').value,
    intensity: Number(e.get('intensity').value) / 100, motion: Number(e.get('motion').value) / 100,
    trails: Number(e.get('trails').value) / 100, quality: e.get('quality').value,
    autoDraw: e.get('auto-draw').checked});
}

test('6つの光のレシピを実際のボタンから適用し、入力・音出力を勝手に切り替えない', async () => {
  await usingHarness({}, async h => {
    await h.click('microphone');
    await h.click('sound-toggle');
    for (const look of LIGHT_LOOKS) {
      assert.match(html, new RegExp(`data-look="${look.id}"`));
      const button = h.looks.find(item => item.dataset.look === look.id);
      await button.dispatch('click');
      assert.deepEqual(currentLook(h), look.settings);
      assert.equal(button.getAttribute('aria-pressed'), 'true');
      assert.equal(h.looks.filter(item => item.getAttribute('aria-pressed') === 'true').length, 1);
      assert.equal(h.audio.state.source, 'microphone');
      assert.equal(h.audio.state.micActive, true);
      assert.equal(h.audio.state.soundEnabled, true);
      assert.equal(h.field.demo, false, 'レシピで自動描画をONにしても実入力をデモへ戻さない');
    }
    await h.input('intensity', 91);
    assert.equal(h.looks.filter(item => item.getAttribute('aria-pressed') === 'true').length, 0);
  });
});

test('共有リンクは実際の表示設定だけをコピーし、開き直しても音を開始しない', async () => {
  let shared;
  await usingHarness({}, async h => {
    h.elements.get('audio-file').files = [{name: 'private-recording.wav', size: 8, arrayBuffer: async () => new ArrayBuffer(8)}];
    await h.elements.get('audio-file').dispatch('change'); await h.click('file-play');
    await h.looks.find(item => item.dataset.look === 'dusk-aurora').dispatch('click');
    await h.input('auto-draw', false); await h.input('motion', 0);
    const expected = currentLook(h);
    assert.equal(h.elements.get('share-result').hidden, true);
    await h.click('share-look');
    shared = h.elements.get('share-url').value;
    assert.equal(h.clipboard.length, 1); assert.equal(h.clipboard[0], shared);
    assert.equal(h.elements.get('share-result').hidden, false);
    const url = new URL(shared);
    assert.equal(url.origin, 'https://example.test'); assert.equal(url.search, '');
    assert.deepEqual(parseLookHash(url.hash), {settings: expected});
    assert.doesNotMatch(shared, /private-recording|private-query|file|microphone|soundEnabled/i);
    assert.equal(h.audio.state.source, 'file'); assert.equal(h.audio.state.playing, true);
    assert.equal(h.audio.state.soundEnabled, true);
  });
  await usingHarness({hash: new URL(shared).hash}, async h => {
    assert.equal(h.field.scene, 'aurora'); assert.equal(h.field.options.palette, 'dusk');
    assert.equal(h.field.options.motion, 0); assert.equal(h.field.demo, false);
    assert.equal(h.audio.state.source, 'none'); assert.equal(h.audio.state.soundEnabled, false);
    assert.equal(h.context.nodes.length, 0, '共有リンクから音声機器へ接続しない');
    assert.equal(h.field.stats.particles <= h.field.stats.maxParticles, true);
  });
});

test('クリップボードを使えない場合は共有URLを選択状態で表示して手動コピーできる', async () => {
  await usingHarness({clipboardAvailable: false}, async h => {
    await h.looks[2].dispatch('click');
    await h.click('share-look');
    assert.equal(h.elements.get('share-result').hidden, false);
    assert.equal(h.elements.get('share-url').focused, true);
    assert.equal(h.elements.get('share-url').selected, true);
    assert.deepEqual(parseLookHash(new URL(h.elements.get('share-url').value).hash), {settings: LIGHT_LOOKS[2].settings});
    assert.match(h.elements.get('status').textContent, /コピー/);
    assert.equal(h.audio.state.soundEnabled, false);
  });
});

test('ハッシュ変更で設定を復元し、不正なリンクや通常アンカーでは表示設定を壊さない', async () => {
  await usingHarness({}, async h => {
    await h.changeHash(makeLookHash(LIGHT_LOOKS[4].settings));
    assert.deepEqual(currentLook(h), LIGHT_LOOKS[4].settings);
    const before = currentLook(h);
    await h.changeHash('#lumen=1&scene=water&density=NaN');
    assert.deepEqual(currentLook(h), before);
    assert.match(h.elements.get('status').textContent, /共有リンク/);
    await h.changeHash('#lab'); assert.deepEqual(currentLook(h), before);
    await h.changeHash('#lumen=999'); assert.deepEqual(currentLook(h), before);
    assert.equal(h.audio.state.source, 'none'); assert.equal(h.context.nodes.length, 0);
  });
});

test('鑑賞モードは操作を隠し、操作に戻るとEscapeのどちらでも元へ戻せる', async () => {
  await usingHarness({}, async h => {
    await h.click('pause');
    await h.click('focus-mode');
    assert.equal(h.elements.get('experience').classList.contains('is-focused'), true);
    assert.equal(h.document.body.classList.contains('viewing-art'), true);
    assert.equal(h.elements.get('exit-focus').hidden, false);
    assert.equal(h.document.activeElement, h.elements.get('exit-focus'));
    assert.equal(h.elements.get('experience').getAttribute('role'), 'dialog');
    assert.equal(h.elements.get('experience').getAttribute('aria-modal'), 'true');
    await h.document.dispatch('keydown', {key: 'Tab', target: h.elements.get('exit-focus')});
    assert.equal(h.document.activeElement, h.canvas);
    await h.document.dispatch('keydown', {key: 'Tab', shiftKey: true, target: h.canvas});
    assert.equal(h.document.activeElement, h.elements.get('exit-focus'));
    assert.equal(h.frames.size, 0, '鑑賞モードを開くだけでは再生しない');
    await h.click('exit-focus');
    assert.equal(h.elements.get('experience').classList.contains('is-focused'), false);
    assert.equal(h.document.body.classList.contains('viewing-art'), false);
    assert.equal(h.elements.get('exit-focus').hidden, true);
    assert.equal(h.elements.get('experience').getAttribute('role'), 'region');
    assert.equal(h.elements.get('experience').getAttribute('aria-modal'), null);
    assert.equal(h.document.activeElement, h.elements.get('focus-mode'));
    await h.click('focus-mode');
    await h.document.dispatch('keydown', {key: 'Escape', target: h.elements.get('exit-focus')});
    assert.equal(h.elements.get('experience').classList.contains('is-focused'), false);
    assert.equal(h.frames.size, 0);
  });
});

test('動画ボタンはCanvasだけを撮り、途中停止で無音の動画を一度だけ保存する', async () => {
  await usingHarness({}, async h => {
    await h.click('pause'); assert.equal(h.frames.size, 0);
    await h.click('record-video');
    assert.equal(h.recorder.recording, true); assert.equal(h.frames.size, 1);
    assert.equal(h.canvas.captureFps, 24); assert.equal(h.videoStreams.length, 1);
    assert.equal(h.videoStreams[0].getAudioTracks().length, 0);
    assert.equal(h.elements.get('record-status').hidden, false);
    assert.equal(h.elements.get('record-video').getAttribute('aria-label'), '録画を止めて保存');
    const pending = h.click('record-video');
    assert.equal(h.elements.get('record-video').disabled, true);
    assert.equal(h.elements.get('record-video').getAttribute('aria-label'), '動画を作成中');
    assert.equal(h.elements.get('record-status').hidden, false);
    await pending;
    assert.equal(h.recorder.recording, false);
    assert.equal(h.elements.get('record-video').disabled, false);
    assert.equal(h.elements.get('record-status').hidden, true);
    assert.equal(h.elements.get('record-video').getAttribute('aria-label'), '動画を保存');
    assert.equal(h.videoStreams[0].track.stops, 1); assert.equal(h.recordingTimers.size, 0);
    assert.equal(h.anchors.filter(item => item.download.endsWith('.webm')).length, 1);
    assert.equal(h.urls[0].type, 'video/webm;codecs=vp9');
    assert.equal(await h.urls[0].text(), 'recorded light');
    assert.equal(h.audio.state.source, 'none'); assert.equal(h.audio.state.soundEnabled, false);
  });
});

test('12秒の自動終了でも一度だけ動画を保存し、非表示とページ終了では撮影を解放する', async () => {
  await usingHarness({}, async h => {
    await h.click('record-video');
    const timer = [...h.recordingTimers].find(([, value]) => value.delay === 12000);
    assert.ok(timer); h.recordingTimers.delete(timer[0]); timer[1].callback(); await settle();
    assert.equal(h.urls.length, 1); assert.equal(h.videoStreams[0].track.stops, 1);
    await h.click('record-video'); await h.hide(); await settle();
    assert.equal(h.recorder.recording, false); assert.equal(h.videoStreams[1].track.stops, 1);
    assert.equal(h.urls.length, 2, '非表示になるまでの短い動画を保存');
  });
  const h = appHarness();
  await h.click('record-video'); await h.close();
  assert.equal(h.videoStreams[0].track.stops, 1);
  assert.equal(h.urls.length, 0, 'ページ破棄後に動画をダウンロードしない');
  assert.equal(h.recordingTimers.size, 0);
});

test('動画APIがない環境ではボタンを無効化し、PNG保存と鑑賞は使える', async () => {
  await usingHarness({recordingSupported: false}, async h => {
    assert.equal(h.elements.get('record-video').disabled, true);
    assert.match(h.elements.get('record-video').title, /PNG/);
    await h.click('save-image');
    assert.equal(h.urls.length, 1); assert.equal(h.urls[0].type, 'image/png');
    await h.click('focus-mode'); assert.equal(h.elements.get('exit-focus').hidden, false);
    assert.equal(h.context.nodes.length, 0);
  });
});

test('動きを減らす端末設定では共有レシピを開いても音とアニメーションを自動開始しない', async () => {
  await usingHarness({reduced: true, hash: makeLookHash(LIGHT_LOOKS[5].settings)}, async h => {
    assert.deepEqual(currentLook(h), LIGHT_LOOKS[5].settings);
    assert.equal(h.frames.size, 0); assert.equal(h.audio.state.source, 'none');
    assert.equal(h.context.nodes.length, 0); assert.equal(h.audio.state.soundEnabled, false);
    await h.click('focus-mode'); assert.equal(h.frames.size, 0);
  });
});


test('2D描画を開始できない環境では動画とPNGを出力せず、比較実験は引き続き使える', async () => {
  await usingHarness({canvasSupported: false}, async h => {
    assert.equal(h.field.supported, false);
    assert.equal(h.elements.get('record-video').disabled, true);
    assert.equal(h.frames.size, 0);
    await h.click('record-video');
    assert.equal(h.videoStreams.length, 0); assert.equal(h.recorder.recording, false);
    await h.click('save-image');
    assert.equal(h.urls.length, 0); assert.match(h.elements.get('status').textContent, /保存できません/);
    await h.tones[3].dispatch('click');
    assert.equal(h.elements.get('colour-disc').style.background, '#3d4860');
    assert.equal(Number(h.elements.get('number-result').textContent), 8);
    assert.equal(h.context.nodes.length, 0);
  });
});
