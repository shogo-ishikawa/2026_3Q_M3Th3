/** Small, deterministic sound examples shared by playback and the figures. */
export const SAMPLE_RATE = 32768;
export const SAMPLE_COUNT = 32768;
export const FREQUENCY_LIMIT = 3000;
export const COMMON_SCALE = 1 / 1.75;

function finiteRange(value, minimum, maximum, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name}は${minimum}〜${maximum}の範囲で指定してください。`);
  }
}

/** One second, including short edge fades. The scale never depends on the input. */
export function makeTone({frequency = 440, amplitude = 0.35, harmonics = 0} = {}) {
  finiteRange(frequency, 100, 1000, '基本周波数');
  finiteRange(amplitude, 0, 0.8, '振幅の倍率');
  finiteRange(harmonics, 0, 1, '倍音の量');
  const samples = new Float32Array(SAMPLE_COUNT);
  const fadeSamples = Math.round(0.008 * SAMPLE_RATE);
  let peak = 0;
  for (let index = 0; index < samples.length; index++) {
    const phase = 2 * Math.PI * frequency * index / SAMPLE_RATE;
    const shape = Math.sin(phase) + harmonics * (0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase));
    const fade = Math.min(1, index / fadeSamples, (samples.length - 1 - index) / fadeSamples);
    samples[index] = amplitude * COMMON_SCALE * shape * Math.max(0, fade);
    peak = Math.max(peak, Math.abs(samples[index]));
  }
  return {samples, sampleRate: SAMPLE_RATE, frequency, amplitude, harmonics, peak};
}

/** Radix-two FFT with a Hann window; amplitudes use the window's coherent gain. */
export function amplitudeSpectrum(samples, sampleRate) {
  const length = samples?.length;
  if (!Number.isInteger(length) || length < 16 || (length & (length - 1)) !== 0) {
    throw new RangeError('FFTに使うサンプル数は16以上の2の累乗にしてください。');
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('サンプリング周波数を確認してください。');
  const real = new Float64Array(length);
  const imaginary = new Float64Array(length);
  let windowSum = 0;
  for (let index = 0; index < length; index++) {
    if (!Number.isFinite(samples[index])) throw new RangeError('音声の値を確認してください。');
    const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (length - 1));
    real[index] = samples[index] * window;
    windowSum += window;
  }
  for (let index = 1, reversed = 0; index < length; index++) {
    let bit = length >> 1;
    while (reversed & bit) { reversed ^= bit; bit >>= 1; }
    reversed ^= bit;
    if (index < reversed) [real[index], real[reversed]] = [real[reversed], real[index]];
  }
  for (let width = 2; width <= length; width *= 2) {
    const angle = -2 * Math.PI / width;
    const rotationReal = Math.cos(angle), rotationImaginary = Math.sin(angle);
    for (let start = 0; start < length; start += width) {
      let wr = 1, wi = 0;
      for (let offset = 0; offset < width / 2; offset++) {
        const left = start + offset, right = left + width / 2;
        const tr = wr * real[right] - wi * imaginary[right];
        const ti = wr * imaginary[right] + wi * real[right];
        real[right] = real[left] - tr;
        imaginary[right] = imaginary[left] - ti;
        real[left] += tr;
        imaginary[left] += ti;
        const nextWr = wr * rotationReal - wi * rotationImaginary;
        wi = wr * rotationImaginary + wi * rotationReal;
        wr = nextWr;
      }
    }
  }
  const frequencies = new Float64Array(length / 2 + 1);
  const magnitudes = new Float64Array(frequencies.length);
  for (let index = 0; index < frequencies.length; index++) {
    frequencies[index] = index * sampleRate / length;
    const oneSided = index === 0 || index === length / 2 ? 1 : 2;
    magnitudes[index] = Math.hypot(real[index], imaginary[index]) * oneSided / windowSum;
  }
  return {frequencies, magnitudes};
}

/** A magnitude-weighted mean, restricted to the same frequency range as the plot. */
export function spectralCentroid({frequencies, magnitudes}, maxFrequency = FREQUENCY_LIMIT) {
  if (frequencies.length !== magnitudes.length) throw new RangeError('周波数と振幅の数をそろえてください。');
  let weight = 0, total = 0;
  for (let index = 0; index < frequencies.length; index++) {
    const frequency = frequencies[index], magnitude = magnitudes[index];
    if (!Number.isFinite(frequency) || !Number.isFinite(magnitude) || magnitude < 0) throw new RangeError('スペクトルの値を確認してください。');
    if (frequency <= maxFrequency) { weight += magnitude; total += frequency * magnitude; }
  }
  return weight > 1e-12 ? total / weight : NaN;
}

export function preset(name) {
  const choices = {
    reference: {frequency: 440, amplitude: 0.35, harmonics: 0},
    higher: {frequency: 880, amplitude: 0.35, harmonics: 0},
    louder: {frequency: 440, amplitude: 0.7, harmonics: 0},
    richer: {frequency: 440, amplitude: 0.35, harmonics: 1},
  };
  if (!Object.hasOwn(choices, name)) throw new RangeError('音の例を選んでください。');
  return {...choices[name]};
}
