import {makeTone, amplitudeSpectrum, spectralCentroid, preset, FREQUENCY_LIMIT} from './demo_engine.js';

const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
let current = null, source = null, gain = null, context = null;

function node(tag, attributes = {}, text = '') {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (text) element.textContent = text;
  return element;
}

function graph(svg, {points, xMaximum, yMinimum, yMaximum, xTicks, yTicks, xLabel, yLabel, title, marker}) {
  const box = {left: 58, top: 28, width: 554, height: 170};
  const x = value => box.left + value / xMaximum * box.width;
  const y = value => box.top + (yMaximum - value) / (yMaximum - yMinimum) * box.height;
  const elements = [node('title', {}, title)];
  for (const value of yTicks) {
    elements.push(node('line', {x1:box.left, x2:box.left+box.width, y1:y(value), y2:y(value), class:'plot-grid'}));
    elements.push(node('text', {x:box.left-10, y:y(value)+4, 'text-anchor':'end', class:'plot-tick'}, String(value)));
  }
  for (const value of xTicks) {
    elements.push(node('line', {x1:x(value), x2:x(value), y1:box.top, y2:box.top+box.height, class:'plot-grid'}));
    elements.push(node('text', {x:x(value), y:box.top+box.height+22, 'text-anchor':'middle', class:'plot-tick'}, String(value)));
  }
  const path = points.map(([a,b], index) => `${index ? 'L' : 'M'}${x(a).toFixed(2)},${y(b).toFixed(2)}`).join(' ');
  elements.push(node('path', {d:path, class:'plot-line', fill:'none'}));
  if (Number.isFinite(marker)) {
    elements.push(node('line', {x1:x(marker), x2:x(marker), y1:box.top, y2:box.top+box.height, class:'centroid-line'}));
    elements.push(node('text', {x:x(marker)+7, y:box.top+14, class:'centroid-label'}, `重心 ${marker.toFixed(0)} Hz`));
  }
  elements.push(node('text', {x:8, y:15, class:'plot-label'}, yLabel));
  elements.push(node('text', {x:box.left+box.width/2, y:249, 'text-anchor':'middle', class:'plot-label'}, xLabel));
  svg.replaceChildren(...elements);
}

function stopPlayback(message = '') {
  if (source) {
    source.onended = null;
    try { source.stop(); } catch { /* The one-second example may already have ended. */ }
    source.disconnect(); source = null;
  }
  gain?.disconnect(); gain = null;
  $('stop-sound').disabled = true;
  $('play-sound').disabled = !current || current.peak < 1e-10;
  if (message) $('play-status').textContent = message;
}

function update() {
  stopPlayback();
  const settings = {frequency:Number($('frequency').value), amplitude:Number($('amplitude').value), harmonics:Number($('harmonics').value)/100};
  current = makeTone(settings);
  $('frequency-value').textContent = `${settings.frequency} Hz`;
  $('amplitude-value').textContent = settings.amplitude.toFixed(2);
  $('harmonics-value').textContent = `${Math.round(settings.harmonics*100)} %`;
  const spectrum = amplitudeSpectrum(current.samples, current.sampleRate);
  const centroid = spectralCentroid(spectrum);
  $('fundamental-value').textContent = `${settings.frequency} Hz`;
  $('centroid-value').textContent = Number.isFinite(centroid) ? `${centroid.toFixed(1)} Hz` : '音がないため計算しません';
  const first = Math.round(0.1*current.sampleRate);
  const count = Math.round(0.02*current.sampleRate);
  const wave = Array.from({length:count},(_,i) => [i/current.sampleRate*1000, current.samples[first+i]]);
  graph($('wave-plot'), {
    points:wave, xMaximum:20, yMinimum:-0.8, yMaximum:0.8,
    xTicks:[0,5,10,15,20], yTicks:[-0.8,-0.4,0,0.4,0.8],
    xLabel:'時間（ミリ秒）', yLabel:'相対振幅', title:'音の途中の20ミリ秒を拡大した波形',
  });
  const frequencyPoints = [];
  for (let i=0;i<spectrum.frequencies.length && spectrum.frequencies[i]<=FREQUENCY_LIMIT;i++) {
    frequencyPoints.push([spectrum.frequencies[i],spectrum.magnitudes[i]]);
  }
  graph($('spectrum-plot'), {
    points:frequencyPoints, xMaximum:FREQUENCY_LIMIT, yMinimum:0, yMaximum:0.5,
    xTicks:[0,500,1000,1500,2000,2500,3000], yTicks:[0,0.1,0.2,0.3,0.4,0.5],
    xLabel:'周波数（Hz）', yLabel:'振幅の強さ', title:'同じデモ音の振幅スペクトル', marker:centroid,
  });
  $('play-sound').disabled = current.peak < 1e-10;
  $('play-status').textContent = current.peak < 1e-10 ? '振幅が0なので音は出ません。つまみを上げてみましょう。' : '設定できました。「この音を1秒聴く」で再生します。';
}

async function play() {
  stopPlayback();
  try {
    const AudioAPI = window.AudioContext || window.webkitAudioContext;
    if (!AudioAPI) throw new Error('このブラウザでは音を再生できません。図はそのまま確認できます。');
    context ??= new AudioAPI();
    await context.resume();
    const buffer = context.createBuffer(1,current.samples.length,current.sampleRate);
    buffer.copyToChannel(current.samples,0);
    source = context.createBufferSource();
    gain = context.createGain();
    // Playback has a common, modest gain. The sound itself is the plotted signal.
    gain.gain.value = 0.22;
    source.buffer = buffer;
    source.connect(gain); gain.connect(context.destination);
    source.onended = () => stopPlayback('再生が終わりました。条件を変えて比べてみましょう。');
    source.start();
    $('play-sound').disabled = true;
    $('stop-sound').disabled = false;
    $('play-status').textContent = '表示している波形と同じデモ音を再生しています。';
  } catch (error) {
    stopPlayback(error.message || '再生できませんでした。ブラウザの音声設定を確認してください。');
  }
}

for (const id of ['frequency','amplitude','harmonics']) $(id).addEventListener('input',update);
for (const button of document.querySelectorAll('[data-preset]')) button.addEventListener('click',() => {
  const settings = preset(button.dataset.preset);
  $('frequency').value = settings.frequency;
  $('amplitude').value = settings.amplitude;
  $('harmonics').value = settings.harmonics*100;
  update();
});
$('play-sound').addEventListener('click',play);
$('stop-sound').addEventListener('click',() => stopPlayback('停止しました。'));
window.addEventListener('pagehide',() => { stopPlayback(); context?.close(); });
update();
