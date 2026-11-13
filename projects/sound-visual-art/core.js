/**
 * 音から光へ渡す計算だけをまとめたファイルです。
 * computeTargets は学生提出版の「色・形・数字」の対応を引き継ぎます。
 * 音高の推定は単音向けの YIN 法です。音量 level は機器ごとに異なる相対値です。
 */

export const SCENES = Object.freeze([
  Object.freeze({id: 'garden', label: '光の庭'}),
  Object.freeze({id: 'water', label: '水の記憶'}),
  Object.freeze({id: 'aurora', label: 'オーロラ'}),
]);

export const PALETTES = Object.freeze([
  Object.freeze({id: 'spectral', label: '音の色'}),
  Object.freeze({id: 'lagoon', label: '青と翡翠'}),
  Object.freeze({id: 'dusk', label: '夕映え'}),
]);

export function clamp(value, minimum = 0, maximum = 1) {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum > maximum) {
    throw new RangeError('範囲の下限と上限を確認してください。');
  }
  if (typeof value !== 'number' || Number.isNaN(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}

// Python の round と同じく、ちょうど半分なら偶数側へ丸めます。
function roundHalfEven(value) {
  const lower = Math.floor(value);
  const fraction = value - lower;
  if (fraction < 0.5) return lower;
  if (fraction > 0.5) return lower + 1;
  return lower % 2 === 0 ? lower : lower + 1;
}

function hsvToHex(hue, saturation, brightness) {
  const sector = hue * 6;
  const index = Math.floor(sector);
  const fraction = sector - index;
  const p = brightness * (1 - saturation);
  const q = brightness * (1 - saturation * fraction);
  const t = brightness * (1 - saturation * (1 - fraction));
  const combinations = [
    [brightness, t, p], [q, brightness, p], [p, brightness, t],
    [p, q, brightness], [t, p, brightness], [brightness, p, q],
  ];
  return '#' + combinations[index % 6].map(value => Math.trunc(value * 255).toString(16).padStart(2, '0')).join('');
}

/** 学生版の音高130〜1000Hz・音量10〜100%と同じ写像です。 */
export function computeTargets(freqHz, volumePct, reversed = false) {
  let pitchNorm = clamp((freqHz - 130) / 870);
  let volumeNorm = clamp((volumePct - 10) / 90);
  if (reversed) {
    pitchNorm = 1 - pitchNorm;
    volumeNorm = 1 - volumeNorm;
  }

  const hue = (0.64 - pitchNorm * 0.62) % 1;
  const saturation = 0.28 + volumeNorm * 0.72;
  const brightness = 0.30 + volumeNorm * 0.70;
  const radius = 0.68;
  const vertexCount = roundHalfEven(4 + volumeNorm * 12);
  const shapePoints = [];
  let shapeLabel;

  if (pitchNorm < 0.35) {
    const waveAmplitude = radius * (0.04 + pitchNorm * 0.25);
    for (let i = 0; i < 200; i++) {
      const angle = i * 2 * Math.PI / 199;
      const r = radius - waveAmplitude * 0.5 + waveAmplitude * 0.5 * Math.cos(vertexCount * angle);
      shapePoints.push([r * Math.cos(angle), r * Math.sin(angle)]);
    }
    shapeLabel = `丸形(${vertexCount}波)`;
  } else {
    const innerRadius = radius * (1 - pitchNorm * 0.60);
    for (let i = 0; i < vertexCount * 2; i++) {
      const angle = i * 2 * Math.PI / (vertexCount * 2) - Math.PI / 2;
      const r = i % 2 === 0 ? radius : innerRadius;
      shapePoints.push([r * Math.cos(angle), r * Math.sin(angle)]);
    }
    shapeLabel = `トゲ星型(${vertexCount}角)`;
  }

  return {
    pitchNorm, volumeNorm,
    hexColour: hsvToHex(hue, saturation, brightness),
    colourLabel: pitchNorm >= 0.5 ? '暖色(赤系)' : '寒色(青系)',
    saturation, brightness, shapePoints, shapeLabel, vertexCount,
    numberValue: roundHalfEven(1 + (0.5 * pitchNorm + 0.5 * volumeNorm) * 99),
  };
}

const EMPTY_PITCH = Object.freeze({frequency: null, confidence: 0, rms: 0});

/**
 * 時間波形の繰り返し周期を探し、単音の基本周波数を推定します。
 * 最大スペクトルの位置を音高と見なさず、倍音を含む音も周期で比較します。
 * threshold は YIN の正規化差分の上限で、小さいほど厳しく判定します。
 * 無音・直流だけ・周期性の弱い音・短すぎる波形では frequency を null にします。
 */
export function detectPitch(samples, sampleRate, {minHz = 80, maxHz = 1200, threshold = 0.1} = {}) {
  if (!samples || !Number.isInteger(samples.length) || samples.length < 32 ||
      !Number.isFinite(sampleRate) || sampleRate < 2000 ||
      !Number.isFinite(minHz) || !Number.isFinite(maxHz) || minHz <= 0 || maxHz <= minHz ||
      maxHz >= sampleRate / 2 || !Number.isFinite(threshold) || threshold <= 0 || threshold >= 1) {
    return {...EMPTY_PITCH};
  }

  const count = Math.min(samples.length, 8192);
  let mean = 0;
  for (let i = 0; i < count; i++) {
    if (!Number.isFinite(samples[i])) return {...EMPTY_PITCH};
    mean += samples[i];
  }
  if (!Number.isFinite(mean)) return {...EMPTY_PITCH};
  mean /= count;
  const centred = new Float64Array(count);
  let sumSquares = 0;
  for (let i = 0; i < count; i++) {
    centred[i] = samples[i] - mean;
    sumSquares += centred[i] * centred[i];
  }
  const rms = Math.sqrt(sumSquares / count);
  if (!Number.isFinite(rms)) return {...EMPTY_PITCH};
  const empty = {frequency: null, confidence: 0, rms};
  if (rms < 0.004) return empty;

  const windowSize = Math.floor(count / 2);
  const maximumLag = Math.min(windowSize - 1, Math.ceil(sampleRate / minHz) + 1);
  if (maximumLag < 3 || maximumLag < sampleRate / maxHz) return empty;
  const difference = new Float64Array(maximumLag + 1);
  difference[0] = 1;
  let runningSum = 0;
  for (let lag = 1; lag <= maximumLag; lag++) {
    let squaredDifference = 0;
    for (let i = 0; i < windowSize; i++) {
      const delta = centred[i] - centred[i + lag];
      squaredDifference += delta * delta;
    }
    runningSum += squaredDifference;
    difference[lag] = runningSum > 0 ? squaredDifference * lag / runningSum : 1;
  }

  let chosenLag = -1;
  // 範囲外の高音を、その整数分の1の周波数として拾わないよう短い周期から探します。
  for (let lag = 2; lag <= maximumLag; lag++) {
    if (difference[lag] >= threshold) continue;
    while (lag < maximumLag && difference[lag + 1] < difference[lag]) lag++;
    chosenLag = lag;
    break;
  }
  if (chosenLag < 0) return empty;

  // 隣の2点も使って、サンプル間の周期を放物線補間します。
  let refinedLag = chosenLag;
  if (chosenLag > 1 && chosenLag < maximumLag) {
    const left = difference[chosenLag - 1];
    const middle = difference[chosenLag];
    const right = difference[chosenLag + 1];
    const denominator = left - 2 * middle + right;
    if (Math.abs(denominator) > 1e-12) {
      refinedLag += clamp((left - right) / (2 * denominator), -1, 1);
    }
  }
  const frequency = sampleRate / refinedLag;
  // 境界での補間誤差だけを許容し、表示値は宣言した範囲へ収めます。
  if (frequency < minHz * 0.99 || frequency > maxHz * 1.01) return empty;
  return {frequency: clamp(frequency, minHz, maxHz), confidence: clamp(1 - difference[chosenLag]), rms};
}

/** 時間波形とFFTのdB値を、画面に渡す共通の信号へ変換します。 */
export function analyseFrame(timeSamples, frequencyDb, sampleRate) {
  const pitch = detectPitch(timeSamples, sampleRate);
  // -60〜-12 dBFS を表示用の0〜1へ対応。実際の音圧レベルではありません。
  const level = pitch.rms > 0 ? clamp((20 * Math.log10(pitch.rms) + 60) / 48) : 0;
  let weightedSum = 0;
  let amplitudeSum = 0;
  const bins = frequencyDb?.length ?? 0;
  if (Number.isFinite(sampleRate) && sampleRate > 0 && Number.isInteger(bins) && bins > 0) {
    // FFTサイズは frequencyBinCount の2倍。0番の直流成分は除きます。
    const binWidth = sampleRate / (2 * bins);
    for (let i = 1; i < bins; i++) {
      if (!Number.isFinite(frequencyDb[i])) continue;
      const amplitude = 10 ** (clamp(frequencyDb[i], -160, 40) / 20);
      amplitudeSum += amplitude;
      weightedSum += amplitude * i * binWidth;
    }
  }
  return {
    level, pitchHz: pitch.frequency, hasPitch: pitch.frequency !== null,
    centroidHz: amplitudeSum > 0 ? weightedSum / amplitudeSum : 0,
    rms: pitch.rms, confidence: pitch.confidence,
  };
}

/** 音源やマイクがなくても作品を試せる、時間だけで決まるデモ信号です。 */
export function demoSignal(timeSeconds) {
  const t = Number.isFinite(timeSeconds) ? timeSeconds : 0;
  const pitchHz = 220 * 2 ** ((0.5 + 0.5 * Math.sin(t * 0.19)) * 1.7);
  const level = 0.16 + 0.40 * (0.5 + 0.5 * Math.sin(t * 0.67 + Math.sin(t * 0.13)));
  return {
    level, pitchHz, hasPitch: true,
    centroidHz: pitchHz * (1.5 + 0.35 * Math.sin(t * 0.31)),
    rms: 10 ** ((level * 48 - 60) / 20), confidence: 1,
  };
}
