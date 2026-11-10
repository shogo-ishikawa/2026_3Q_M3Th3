import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeTone, amplitudeSpectrum, spectralCentroid, preset,
  SAMPLE_RATE, SAMPLE_COUNT, COMMON_SCALE,
} from '../demo_engine.js';

const close = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
};

// Independent, slow DFT to check the FFT, its Hann window, and one-sided scaling.
function referenceDft(samples, sampleRate) {
  const n = samples.length;
  const windowed = Array.from(samples, (value, index) => value * (0.5 - 0.5 * Math.cos(2 * Math.PI * index / (n - 1))));
  const windowSum = Array.from(samples, (_, index) => 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (n - 1))).reduce((a, b) => a + b, 0);
  return Array.from({length:n / 2 + 1}, (_, bin) => {
    let real = 0, imaginary = 0;
    for (let index = 0; index < n; index++) {
      const phase = 2 * Math.PI * bin * index / n;
      real += windowed[index] * Math.cos(phase);
      imaginary -= windowed[index] * Math.sin(phase);
    }
    const scale = bin === 0 || bin === n / 2 ? 1 : 2;
    return {frequency:bin * sampleRate / n, magnitude:Math.hypot(real, imaginary) * scale / windowSum};
  });
}

test('FFT agrees with a separate DFT, including DC and Nyquist bins', () => {
  const samples = Float64Array.from({length:32}, (_, n) => 0.08 + 0.3 * Math.sin(2 * Math.PI * 3 * n / 32) + 0.13 * Math.cos(2 * Math.PI * 16 * n / 32));
  const actual = amplitudeSpectrum(samples, 3200);
  for (const [bin, expected] of referenceDft(samples, 3200).entries()) {
    close(actual.frequencies[bin], expected.frequency);
    close(actual.magnitudes[bin], expected.magnitude, 1e-12);
  }
});

test('demo samples last one second, have faded edges, and remain below clipping', () => {
  const tone = makeTone({frequency:880, amplitude:0.8, harmonics:1});
  assert.equal(tone.samples.length, SAMPLE_COUNT);
  assert.equal(SAMPLE_COUNT / SAMPLE_RATE, 1);
  close(tone.samples[0], 0);
  close(tone.samples.at(-1), 0);
  assert.ok(tone.peak > 0.5 && tone.peak <= 0.8);
  assert.ok(tone.samples.every(value => Number.isFinite(value) && Math.abs(value) < 1));
});

test('a 440 Hz pure tone has its strongest component and centroid at 440 Hz', () => {
  const tone = makeTone(preset('reference'));
  const spectrum = amplitudeSpectrum(tone.samples, tone.sampleRate);
  let strongest = 0;
  for (let bin = 1; bin < spectrum.magnitudes.length; bin++) {
    if (spectrum.magnitudes[bin] > spectrum.magnitudes[strongest]) strongest = bin;
  }
  assert.equal(spectrum.frequencies[strongest], 440);
  close(spectrum.magnitudes[strongest], 0.35 * COMMON_SCALE, 0.00001);
  close(spectralCentroid(spectrum), 440, 0.1);
});

test('doubling the amplitude doubles the samples and spectrum without changing centroid', () => {
  const quiet = makeTone({amplitude:0.35, harmonics:0.6});
  const louder = makeTone({amplitude:0.7, harmonics:0.6});
  for (let n = 0; n < quiet.samples.length; n++) close(louder.samples[n], 2 * quiet.samples[n], 1e-7);
  const quietSpectrum = amplitudeSpectrum(quiet.samples, quiet.sampleRate);
  const louderSpectrum = amplitudeSpectrum(louder.samples, louder.sampleRate);
  for (const frequency of [440, 880, 1320]) close(louderSpectrum.magnitudes[frequency], 2 * quietSpectrum.magnitudes[frequency], 1e-7);
  close(spectralCentroid(quietSpectrum), spectralCentroid(louderSpectrum), 1e-7);
});

test('harmonics have the stated fixed ratios and move centroid while fundamental stays at 440 Hz', () => {
  const tone = makeTone(preset('richer'));
  const spectrum = amplitudeSpectrum(tone.samples, tone.sampleRate);
  close(spectrum.magnitudes[880] / spectrum.magnitudes[440], 0.5, 0.00001);
  close(spectrum.magnitudes[1320] / spectrum.magnitudes[440], 0.25, 0.00001);
  const expected = (440 + 0.5 * 880 + 0.25 * 1320) / 1.75;
  close(spectralCentroid(spectrum), expected, 0.2);
  assert.equal(tone.frequency, 440);
});

test('centroid uses amplitude weights and the displayed frequency range', () => {
  const spectrum = {frequencies:[100, 300, 4000], magnitudes:[1, 3, 100]};
  close(spectralCentroid(spectrum), 250);
  close(spectralCentroid(spectrum, 100), 100);
  assert.ok(Number.isNaN(spectralCentroid({frequencies:[0, 100], magnitudes:[0, 0]})));
  const silent = makeTone({amplitude:0, harmonics:1});
  assert.equal(silent.peak, 0);
  assert.ok(Number.isNaN(spectralCentroid(amplitudeSpectrum(silent.samples, silent.sampleRate))));
});

test('presets return independent settings and invalid inputs are rejected', () => {
  const changed = preset('reference');
  changed.frequency = 900;
  assert.equal(preset('reference').frequency, 440);
  assert.throws(() => preset('unknown'), RangeError);
  for (const settings of [{frequency:NaN}, {frequency:0}, {amplitude:0.9}, {harmonics:-1}]) assert.throws(() => makeTone(settings), RangeError);
  assert.throws(() => amplitudeSpectrum(new Float32Array(30), SAMPLE_RATE), RangeError);
  assert.throws(() => amplitudeSpectrum(new Float32Array(32), 0), RangeError);
  assert.throws(() => amplitudeSpectrum(Float32Array.from({length:32}, () => NaN), SAMPLE_RATE), RangeError);
  assert.throws(() => spectralCentroid({frequencies:[100], magnitudes:[-1]}), RangeError);
});
