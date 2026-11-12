// 学生版の16ディスクとキー配列を引き継ぐ、音声APIに依存しない計算。
export const KEYS = Object.freeze(['1', '3', '5', '7', 'q', 'e', 't', 'u', 'a', 'd', 'g', 'j', 'z', 'c', 'b', 'm']);
export const GROUPS = Object.freeze([0, 1, 2, 3]);
export const QUANTISE = Object.freeze([0, 1, 4, 8]);

export function finiteRange(value, min, max, label = '値') {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new RangeError(`${label}は${min}〜${max}で指定してください。`);
  }
  return number;
}

export function groupOf(index) {
  if (!Number.isInteger(index) || index < 0 || index >= KEYS.length) throw new RangeError('音源番号が不正です。');
  return Math.floor(index / 4);
}

export function clipRate(bpm, duration, beats, sync) {
  if (!sync) return 1;
  finiteRange(bpm, 40, 200, 'BPM');
  if (!Number.isFinite(duration) || duration <= 0) throw new RangeError('音源の長さが不正です。');
  finiteRange(beats, 1, 64, '拍数');
  // 音源の元BPM = 60 × 拍数 / 秒数。元BPMとの比率が再生速度。
  return bpm * duration / (60 * beats);
}

export function beatAt(time, origin, bpm) {
  return Math.max(0, (time - origin) * bpm / 60);
}

export function nextBoundary(now, origin, bpm, quantise, lead = 0.025) {
  if (!QUANTISE.includes(quantise)) throw new RangeError('量子化は0、1、4、8拍で指定してください。');
  if (quantise === 0) return Math.max(origin, now + 0.008);
  const nextBeat = Math.ceil(beatAt(now + lead, origin, bpm) / quantise) * quantise;
  return Math.max(origin, origin + nextBeat * 60 / bpm);
}

export function clipProgress(now, startedAt, rate, duration, loop) {
  if (!duration || now <= startedAt) return 0;
  const progress = (now - startedAt) * rate / duration;
  return loop ? progress - Math.floor(progress) : Math.min(1, Math.max(0, progress));
}

