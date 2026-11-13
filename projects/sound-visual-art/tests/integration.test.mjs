import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {analyseFrame, clamp, computeTargets, demoSignal, SCENES} from '../core.js';
import {VisualField} from '../renderer.js';
import {AudioEngine} from '../audio.js';

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
  append(...children) {this.children.push(...children);}
  replaceChildren(...children) {this.children = children; this._text = '';}
  set textContent(value) {this._text = String(value); this.children = [];}
  get textContent() {return this._text + this.children.map(child => typeof child === 'string' ? child : child.textContent).join('');}
  click() {this.clicks++; return this.dispatch('click');}
  getBoundingClientRect() {return {left: 0, top: 0, width: 900, height: 600};}
  setPointerCapture(id) {this.capture = id;}
  get clientWidth() {return 900;}
  get clientHeight() {return 600;}
  classList = {toggle() {}};
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

function appHarness({getUserMedia, reduced = false} = {}) {
  const elements = new Map([...html.matchAll(/\bid="([\w-]+)"/g)].map(match => [match[1], new Element()]));
  assert.equal(elements.size, [...html.matchAll(/\bid="([\w-]+)"/g)].length, 'HTMLのidは一意');
  const canvas = elements.get('art-canvas'); canvas.tagName = 'CANVAS'; canvas.getContext = canvasContext;
  canvas.toBlob = (callback, type) => {canvas.exportType = type; callback(new Blob(['canvas snapshot'], {type}));};
  const values = {intensity: '65', motion: '55', trails: '70', palette: 'spectral', quality: 'auto', 'output-volume': '25', frequency: '880', volume: '95'};
  for (const [id, value] of Object.entries(values)) elements.get(id).value = value;
  elements.get('auto-draw').checked = true; elements.get('comparison').hidden = true;
  const scenes = SCENES.map(scene => {const button = new Element('button'); button.dataset.scene = scene.id; return button;});
  const tones = ['880,95', '165,95', '880,20', '165,20'].map(tone => {const button = new Element('button'); button.dataset.tone = tone; return button;});
  const document = new Element('document'); document.hidden = false; document.fullscreenElement = null;
  document.getElementById = id => {assert.ok(elements.has(id), `DOM id ${id} exists`); return elements.get(id);};
  document.querySelector = selector => {assert.equal(selector, '.level-track'); return elements.get('level-fill');};
  document.querySelectorAll = selector => {if (selector === '[data-scene]') return scenes; if (selector === '[data-tone]') return tones; throw Error(`Unexpected selector ${selector}`);};
  document.createTextNode = text => ({textContent: String(text)});
  const anchors = [];
  document.createElement = name => {const node = new Element(name); if (name === 'a') anchors.push(node); return node;};
  document.createElementNS = (namespace, name) => {const node = new Element(name); node.namespaceURI = namespace; return node;};
  const window = new Element('window'); window.devicePixelRatio = 1;
  const context = new AudioContextFixture(), stream = streamFixture(), frames = new Map(), urls = [], timers = [];
  let field, audio, nextFrame = 0;
  class Field extends VisualField {constructor(target) {super(target); field = this;}}
  class Audio extends AudioEngine {constructor(options) {super({...options, contextFactory: () => context, getUserMedia: getUserMedia ?? (async () => stream)}); audio = this;}}
  const run = new Function('clamp', 'computeTargets', 'demoSignal', 'SCENES', 'VisualField', 'AudioEngine', 'document', 'window', 'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'URL', 'setTimeout', source.replace(/^import .*;\s*$/gm, ''));
  run(clamp, computeTargets, demoSignal, SCENES, Field, Audio, document, window,
    () => ({matches: reduced, addEventListener() {}}),
    callback => {const id = ++nextFrame; frames.set(id, callback); return id;},
    id => frames.delete(id), class {observe() {}},
    {createObjectURL(blob) {urls.push(blob); return `blob:test-${urls.length}`;}, revokeObjectURL() {}}, callback => timers.push(callback));
  return {elements, canvas, document, window, context, stream, scenes, tones, frames, urls, anchors,
    get field() {return field;}, get audio() {return audio;},
    async click(id) {await elements.get(id).dispatch('click');},
    async input(id, value) {const element = elements.get(id); if (typeof value === 'boolean') element.checked = value; else element.value = String(value); await element.dispatch('input');},
    frame(timestamp = 1000) {assert.equal(frames.size, 1, '描画ループは一つ'); const [id, callback] = frames.entries().next().value; frames.delete(id); callback(timestamp); assert.ok(frames.size <= 1);},
    async hide() {document.hidden = true; await document.dispatch('visibilitychange');},
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
  for (const file of ['app.js', 'audio.js', 'renderer.js', 'core.js']) {
    const code = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const match of code.matchAll(/from\s+['"](\.\/[^'"]+)['"]/g)) assert.ok(existsSync(new URL(`../${match[1]}`, import.meta.url)), `${file}: ${match[1]}`);
  }
});
