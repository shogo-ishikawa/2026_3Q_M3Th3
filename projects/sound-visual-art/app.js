import {clamp, computeTargets, demoSignal, SCENES} from './core.js';
import {VisualField} from './renderer.js';
import {AudioEngine} from './audio.js';

const $ = id => document.getElementById(id);
const canvas = $('art-canvas');
const field = new VisualField(canvas);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const sceneCopy = {
  garden: ['01 / GARDEN', '光の庭', '小さな光が集い、ほどけて、花ひらく。'],
  water: ['02 / WATER', '水の記憶', '触れた場所から、静かな波が広がる。'],
  aurora: ['03 / AURORA', 'オーロラ', '音の気配が、光のカーテンを揺らす。'],
};
const quiet = () => ({level: 0, pitchHz: null, hasPitch: false, centroidHz: 0, rms: 0, confidence: 0});
let scene = 'garden', paused = reducedMotion.matches, time = 0, lastFrame = null;
let raf = 0, lastAnalysis = -1, lastReadout = -1, signal = quiet();
let disposed = false, reversed = false, sourceEpoch = 0;
const pointers = new Map();
const audio = new AudioEngine({onState: syncAudio, onError: error => tell(error.message, true)});

function tell(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}
function guard(callback) {
  return async event => {
    try { await callback(event); }
    catch (error) { tell(error?.message || '操作を完了できませんでした。もう一度お試しください。', true); }
  };
}
function bind(id, type, callback) { $(id).addEventListener(type, guard(callback)); }

// 入力の解析と、スピーカーへ音を出す設定は独立しています。
function syncAudio(state) {
  const isDemo = state.source === 'none';
  $('demo-input').setAttribute('aria-pressed', String(isDemo));
  $('microphone').setAttribute('aria-pressed', String(state.micActive));
  $('microphone').textContent = state.micActive ? '■ マイクを停止' : '♩ マイク';
  $('sound-toggle').setAttribute('aria-pressed', String(state.soundEnabled));
  $('sound-toggle').textContent = state.soundEnabled ? '音を止める' : '音を出す';
  $('sound-note').textContent = state.soundEnabled ? 'なぞると短い音が鳴ります' : '音を出さずに描けます';
  $('file-player').hidden = state.source !== 'file';
  $('file-name').textContent = state.fileName;
  $('file-play').textContent = state.playing ? '音源を一時停止' : '音源を再生';
  $('source-badge').textContent = state.micActive ? 'MIC / 声に反応' : state.source === 'file'
    ? (state.playing ? 'AUDIO / 音源に反応' : 'AUDIO / 停止中')
    : $('auto-draw').checked ? 'DEMO / 無音' : 'DRAW / 指で描く';
  $('pitch-label').textContent = isDemo ? '仮想の音高' : '推定音高';
  if (state.source !== 'none') field.setDemo(false);
  else field.setDemo($('auto-draw').checked);
}

function applyOptions() {
  const options = {};
  for (const id of ['intensity', 'motion', 'trails']) {
    const value = Number($(id).value);
    $(`${id}-value`).value = `${value}%`;
    options[id] = value / 100;
  }
  options.palette = $('palette').value;
  options.quality = $('quality').value;
  field.setOptions(options);
  field.setDemo(audio.state.source === 'none' && $('auto-draw').checked);
  syncAudio(audio.state);
  if (paused) drawStill();
}

function setScene(next) {
  if (!SCENES.some(item => item.id === next)) return;
  scene = next;
  field.setScene(next);
  const [number, title, caption] = sceneCopy[next];
  $('scene-number').textContent = number;
  $('scene-title').textContent = title;
  $('scene-caption').textContent = caption;
  for (const button of document.querySelectorAll('[data-scene]')) {
    button.setAttribute('aria-pressed', String(button.dataset.scene === next));
  }
  if (paused) drawStill();
}

function readout(current) {
  const value = $('pitch-value');
  value.replaceChildren(document.createTextNode(current.hasPitch && Number.isFinite(current.pitchHz)
    ? `${Math.round(current.pitchHz)} ` : '— '));
  const unit = document.createElement('small'); unit.textContent = 'Hz'; value.append(unit);
  const percent = Math.round(clamp(current.level) * 100);
  $('level-fill').style.width = `${percent}%`;
  document.querySelector('.level-track').setAttribute('aria-valuenow', String(percent));
  $('level-value').textContent = audio.state.source === 'none' ? ($('auto-draw').checked ? '無音のデモ' : 'なぞって描く') : `相対レベル ${percent}%`;
}

function drawStill() {
  const current = audio.state.source === 'none' ? ($('auto-draw').checked ? demoSignal(time) : quiet()) : signal;
  field.render({time, dt: 0, signal: current});
  readout(current);
}

function tick(timestamp) {
  raf = 0;
  if (disposed || paused || document.hidden || !field.supported) return;
  const dt = lastFrame === null ? 1 / 60 : Math.min(.05, Math.max(0, (timestamp - lastFrame) / 1000));
  lastFrame = timestamp;
  time += dt;
  if (audio.state.source === 'none') signal = $('auto-draw').checked ? demoSignal(time) : quiet();
  else if (time - lastAnalysis > .045) { signal = audio.sample(); lastAnalysis = time; }
  field.render({time, dt, signal});
  if (time - lastReadout > .15) { readout(signal); lastReadout = time; }
  raf = requestAnimationFrame(tick);
}

function startAnimation() {
  if (!raf && !disposed && !paused && !document.hidden && field.supported) {
    lastFrame = null;
    raf = requestAnimationFrame(tick);
  }
}

function setPaused(next, message = true) {
  paused = next;
  $('pause').textContent = paused ? '▷' : 'Ⅱ';
  $('pause').setAttribute('aria-label', paused ? '再開' : '一時停止');
  $('pause').title = paused ? '再開（Space）' : '一時停止（Space）';
  if (paused) {
    cancelAnimationFrame(raf); raf = 0;
    audio.pauseFile(); audio.stopMicrophone();
    for (const id of pointers.keys()) field.release(id);
    pointers.clear();
  } else startAnimation();
  if (message) tell(paused ? '光の動きを止めました。音源とマイクの入力も停止しています。' : '光の動きを再開しました。');
}

async function activateDemo() {
  ++sourceEpoch;
  await audio.stopInput();
  $('auto-draw').checked = true;
  field.setDemo(true);
  syncAudio(audio.state);
  setPaused(false, false);
  tell('無音のデモを表示しています。音を出す設定なら、なぞると短い音が鳴ります。');
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  field.resize(rect.width, rect.height, window.devicePixelRatio || 1);
  // サイズ変更で消えた描画バッファを、一時停止中もすぐ描き直します。
  drawStill();
}

canvas.addEventListener('pointerdown', event => {
  if (!field.supported) return;
  const rect = canvas.getBoundingClientRect();
  const point = {x: event.clientX - rect.left, y: event.clientY - rect.top, at: event.timeStamp};
  if (pointers.size >= 12) return;
  pointers.set(event.pointerId, point);
  canvas.setPointerCapture(event.pointerId);
  field.pointer({id: event.pointerId, ...point, pressure: event.pressure || .5});
  audio.playTouch(point.y / rect.height, .6);
  $('canvas-hint').hidden = true;
  if (paused) drawStill();
});
canvas.addEventListener('pointermove', event => {
  const previous = pointers.get(event.pointerId);
  if (!previous) return;
  const rect = canvas.getBoundingClientRect();
  const point = {x: event.clientX - rect.left, y: event.clientY - rect.top, at: event.timeStamp};
  const speed = Math.hypot(point.x - previous.x, point.y - previous.y) / Math.max(1, point.at - previous.at) * 1000;
  pointers.set(event.pointerId, point);
  field.pointer({id: event.pointerId, ...point, pressure: event.pressure || .5});
  audio.playTouch(point.y / rect.height, clamp(speed / 1000));
  if (paused) drawStill();
});
function endPointer(event) { pointers.delete(event.pointerId); field.release(event.pointerId); }
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, endPointer);
canvas.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault(); field.burst(canvas.clientWidth / 2, canvas.clientHeight / 2);
    audio.playTouch(.5, .6); if (paused) drawStill();
  }
});

for (const button of document.querySelectorAll('[data-scene]')) button.addEventListener('click', () => setScene(button.dataset.scene));
for (const id of ['intensity', 'motion', 'trails', 'palette', 'quality', 'auto-draw']) bind(id, 'input', applyOptions);
bind('pause', 'click', () => setPaused(!paused));
bind('clear', 'click', () => {
  field.clear(); pointers.clear(); $('auto-draw').checked = false; applyOptions(); drawStill();
  tell('描いた光をリセットしました。なぞるか「自動で描く」を選んで続きを描けます。');
});
bind('demo-input', 'click', activateDemo);
bind('open-file', 'click', () => $('audio-file').click());
bind('audio-file', 'change', async () => {
  const file = $('audio-file').files[0];
  if (!file) return;
  const epoch = ++sourceEpoch;
  tell('音源をブラウザ内で読み込んでいます…');
  try {
    const loaded = await audio.loadFile(file);
    if (!loaded || epoch !== sourceEpoch) return;
    tell('音源を読み込みました。「音源を再生」で光に反映します。');
  } finally { $('audio-file').value = ''; }
});
bind('file-play', 'click', async () => {
  if (audio.state.playing) { audio.pauseFile(); tell('音源を一時停止しました。続きから再生できます。'); }
  else {
    // 「再生」を押した操作で音を有効にします。後から出力だけ止めることもできます。
    await audio.enableSound(true);
    if (await audio.playFile()) { setPaused(false, false); tell('音源を再生しています。音を止めても光の分析は続きます。'); }
  }
});
bind('microphone', 'click', async () => {
  ++sourceEpoch;
  if (audio.state.micActive) { audio.stopMicrophone(); tell('マイクを停止しました。'); return; }
  tell('マイクの許可を待っています。デモに切り替えると取り消せます。');
  $('microphone').disabled = true;
  try {
    if (await audio.startMicrophone()) { setPaused(false, false); tell('マイクの音に反応しています。マイクを停止するかページを離れると入力を解放します。'); }
  } finally { $('microphone').disabled = false; }
});
bind('sound-toggle', 'click', async () => {
  const enabled = await audio.enableSound(!audio.state.soundEnabled);
  tell(enabled ? 'なぞる音と音源の再生音を有効にしました。音量は設定で調整できます。' : '音の出力を止めました。光はそのまま楽しめます。');
});
bind('output-volume', 'input', () => {
  $('output-volume-value').value = `${$('output-volume').value}%`;
  audio.setVolume(Number($('output-volume').value) / 100);
});
bind('fullscreen', 'click', async () => {
  if (document.fullscreenElement) await document.exitFullscreen();
  else if ($('experience').requestFullscreen) await $('experience').requestFullscreen();
  else throw Error('この環境では全画面を使えません。ブラウザの表示を広げてお楽しみください。');
});
document.addEventListener('fullscreenchange', () => {
  $('fullscreen').setAttribute('aria-label', document.fullscreenElement ? '全画面を終了' : '全画面');
  resize();
});
bind('save-image', 'click', () => new Promise((resolve, reject) => {
  if (!field.supported) { reject(Error('画像を保存できません。Canvas対応ブラウザでお試しください。')); return; }
  canvas.toBlob(blob => {
    if (!blob) { reject(Error('画像を作成できませんでした。')); return; }
    const link = document.createElement('a'), url = URL.createObjectURL(blob);
    link.href = url; link.download = `lumen-${scene}.png`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    tell('この瞬間の光をPNG画像に保存しました。'); resolve();
  }, 'image/png');
}));

// 学生の「音→色・形・数字」を元の式で再現する、小さな比較実験です。
const tones = [[880, 95, '高い・大きい'], [165, 95, '低い・大きい'], [880, 20, '高い・小さい'], [165, 20, '低い・小さい']];
function shapePoints(target) { return target.shapePoints.map(([x, y]) => `${x},${y}`).join(' '); }
function renderLab() {
  const frequency = Number($('frequency').value), volume = Number($('volume').value);
  const target = computeTargets(frequency, volume, reversed);
  $('frequency-value').value = `${frequency} Hz`; $('volume-value').value = `${volume}%`;
  $('colour-disc').style.background = target.hexColour;
  $('colour-name').textContent = `${target.colourLabel} / ${target.hexColour}`;
  $('shape-polygon').setAttribute('points', shapePoints(target));
  $('shape-name').textContent = target.shapeLabel;
  $('shape-svg').setAttribute('aria-label', target.shapeLabel);
  $('number-result').textContent = target.numberValue;
  $('reverse').setAttribute('aria-pressed', String(reversed));
  if (!$('comparison').hidden) renderComparison();
}
function renderComparison() {
  const container = $('comparison'); container.replaceChildren();
  for (const [frequency, volume, name] of tones) {
    const target = computeTargets(frequency, volume, reversed);
    const card = document.createElement('article'); card.className = 'compare-card';
    const title = document.createElement('h3'); title.textContent = name;
    const note = document.createElement('p'); note.textContent = `${frequency} Hz / ${volume}%`;
    const result = document.createElement('div'); result.className = 'compare-result';
    const disc = document.createElement('span'); disc.className = 'colour-disc'; disc.style.background = target.hexColour; disc.setAttribute('aria-label', target.colourLabel);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '-1 -1 2 2'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', target.shapeLabel);
    const polygon = document.createElementNS(svg.namespaceURI, 'polygon'); polygon.setAttribute('points', shapePoints(target)); polygon.setAttribute('fill', '#839d8a'); svg.append(polygon);
    const number = document.createElement('strong'); number.textContent = target.numberValue;
    result.append(disc, svg, number); card.append(title, note, result); container.append(card);
  }
}
for (const id of ['frequency', 'volume']) bind(id, 'input', renderLab);
for (const button of document.querySelectorAll('[data-tone]')) button.addEventListener('click', () => {
  const [frequency, volume] = button.dataset.tone.split(','); $('frequency').value = frequency; $('volume').value = volume; renderLab();
});
bind('reverse', 'click', () => { reversed = !reversed; renderLab(); });
bind('compare', 'click', () => {
  $('comparison').hidden = !$('comparison').hidden;
  $('compare').setAttribute('aria-expanded', String(!$('comparison').hidden));
  if (!$('comparison').hidden) renderComparison();
});
bind('play-tone', 'click', async () => {
  await audio.enableSound(true);
  audio.playTone(Number($('frequency').value), Number($('volume').value));
  tell('実験室の音を再生しました。音の高さと大きさを変えて聴き比べられます。');
});

document.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey || /^(INPUT|SELECT|TEXTAREA|BUTTON|SUMMARY|A)$/.test(event.target.tagName)) return;
  if (event.code === 'Space') { event.preventDefault(); setPaused(!paused); }
  if (['1', '2', '3'].includes(event.key)) setScene(SCENES[Number(event.key) - 1].id);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    ++sourceEpoch; setPaused(true, false);
    if (audio.state.source !== 'file') audio.stopInput();
    tell('ページを離れたため光と音の入力を停止しました。再開ボタンで戻れます。');
  }
});
window.addEventListener('pagehide', event => {
  ++sourceEpoch; cancelAnimationFrame(raf); raf = 0;
  if (event.persisted) { setPaused(true, false); audio.stopInput(); }
  else { disposed = true; field.dispose(); audio.dispose().catch(() => {}); }
});
reducedMotion.addEventListener('change', event => {
  if (event.matches) { $('motion').value = 0; applyOptions(); setPaused(true); }
});
window.addEventListener('resize', resize);
new ResizeObserver(resize).observe($('experience'));

if (reducedMotion.matches) $('motion').value = 0;
applyOptions(); renderLab(); resize(); setPaused(paused, false);
if (!field.supported) tell('このブラウザでは光の描画に対応していません。音と色の実験室は引き続き使えます。', true);
else if (paused) tell('動きを抑える設定に合わせて静止表示しています。再開ボタンで光を動かせます。');
