/**
 * Original demo loops for LOOP ROOM. No recordings or third-party samples.
 * Every clip is two bars in 4/4, in C minor / A-flat major, at 120 BPM.
 * Synthesis is deterministic so saved demo IDs always reconstruct the same audio.
 */
export const DEMO_BPM = 120;
export const DEMO_BEATS = 8;
export const DEMO_CLIPS = Object.freeze([
  ['neon-four', 'Neon Four', 'drums'],
  ['broken-steps', 'Broken Steps', 'drums'],
  ['dusty-pocket', 'Dusty Pocket', 'drums'],
  ['late-night', 'Late Night', 'drums'],
  ['deep-current', 'Deep Current', 'bass'],
  ['rubber-line', 'Rubber Line', 'bass'],
  ['sub-motion', 'Sub Motion', 'bass'],
  ['walking-home', 'Walking Home', 'bass'],
  ['warm-keys', 'Warm Keys', 'chords'],
  ['glass-stabs', 'Glass Stabs', 'chords'],
  ['velvet-pad', 'Velvet Pad', 'chords'],
  ['side-street', 'Side Street', 'chords'],
  ['afterglow', 'Afterglow', 'lead'],
  ['night-arp', 'Night Arp', 'lead'],
  ['tape-bells', 'Tape Bells', 'lead'],
  ['acid-sparks', 'Acid Sparks', 'lead'],
].map(([id, name, part]) => Object.freeze({ id, name, part })));

const TAU = 2 * Math.PI;
const BEAT_SECONDS = 60 / DEMO_BPM;
const DURATION = DEMO_BEATS * BEAT_SECONDS;
const LEVELS = [0.36, 0.27, 0.23, 0.20];
const noteHz = midi => 440 * 2 ** ((midi - 69) / 12);
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

function seededNoise(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 2147483648 - 1;
  };
}

/** Return one mono loop. The sample-rate argument also makes CPU-only tests possible. */
export function synthClip(index, sampleRate = 22050) {
  if (!Number.isInteger(index) || index < 0 || index >= DEMO_CLIPS.length) {
    throw new RangeError('Demo index must be an integer from 0 to 15.');
  }
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
    throw new RangeError('Sample rate must be an integer from 8000 to 192000 Hz.');
  }
  const samples = new Float32Array(Math.round(DURATION * sampleRate));
  const random = seededNoise(0x6f8a4d31 ^ ((index + 1) * 0x45d9f3b));
  const variant = index % 4;
  const part = Math.floor(index / 4);

  // Tails wrap into the next loop instead of being abruptly truncated at bar two.
  function add(atBeat, seconds, gain, synthesise) {
    const start = Math.round(atBeat * BEAT_SECONDS * sampleRate);
    const length = Math.max(1, Math.round(seconds * sampleRate));
    for (let i = 0; i < length; i += 1) {
      const at = ((start + i) % samples.length + samples.length) % samples.length;
      samples[at] += gain * synthesise(i / sampleRate, i, seconds);
    }
  }

  function kick(beat, gain = 1) {
    add(beat, 0.40, gain, t => {
      const phase = TAU * (48 * t + 92 * 0.025 * (1 - Math.exp(-t / 0.025)));
      const attack = Math.min(1, t / 0.0015);
      return attack * Math.sin(phase) * Math.exp(-t * 11)
        + random() * 0.035 * Math.exp(-t * 140);
    });
  }

  function snare(beat, gain = 0.55, clap = false) {
    let lastNoise = 0;
    add(beat, 0.19, gain, t => {
      const noise = random();
      const high = noise - lastNoise * 0.6;
      lastNoise = noise;
      const envelope = clap
        ? [0, 0.012, 0.024].reduce((sum, delay) => sum + (t >= delay ? Math.exp(-(t - delay) * 47) : 0), 0) / 2.1
        : Math.exp(-t * 25);
      return high * 0.62 * envelope * Math.min(1, t / 0.001)
        + Math.sin(TAU * 185 * t) * 0.22 * Math.exp(-t * 28);
    });
  }

  function hat(beat, gain = 0.14, open = false) {
    let lastNoise = 0;
    add(beat, open ? 0.24 : 0.085, gain, t => {
      const noise = random();
      const high = noise - lastNoise * 0.9;
      lastNoise = noise;
      return high * Math.exp(-t * (open ? 19 : 65)) * Math.min(1, t / 0.0006);
    });
  }

  function rim(beat, gain = 0.18) {
    add(beat, 0.10, gain, t => (Math.sin(TAU * 820 * t) + 0.5 * Math.sin(TAU * 1210 * t))
      * Math.exp(-t * 60) * Math.min(1, t / 0.001));
  }

  function melodic(beat, midi, beats, gain = 1, tone = 'bass') {
    const frequency = noteHz(midi);
    const seconds = beats * BEAT_SECONDS;
    const attack = tone === 'pad' ? 0.085 : tone === 'keys' ? 0.007 : 0.004;
    const release = Math.min(seconds * 0.4, tone === 'pad' ? 0.18 : 0.065);
    add(beat, seconds, gain, t => {
      const envelope = clamp(t / attack, 0, 1) * clamp((seconds - t) / release, 0, 1);
      const phase = TAU * frequency * t;
      let wave;
      if (tone === 'bass') {
        wave = Math.sin(phase) * 0.78 + Math.sin(phase * 2) * 0.15 + Math.sin(phase * 3) * 0.07;
        wave *= 0.65 + 0.35 * Math.exp(-t * 11);
      } else if (tone === 'rubber') {
        wave = Math.sin(phase) * 0.65 + Math.sin(phase * 2) * 0.2 * Math.exp(-t * 15)
          + Math.sin(phase * 3) * 0.15 * Math.exp(-t * 22);
      } else if (tone === 'pad') {
        wave = (Math.sin(phase * 0.998) + Math.sin(phase * 1.002)) * 0.38
          + Math.sin(phase * 2) * 0.1 + Math.sin(phase * 3) * 0.035;
      } else if (tone === 'bell') {
        wave = (Math.sin(phase) * 0.72 + Math.sin(phase * 2.003) * 0.2
          + Math.sin(phase * 3.97) * 0.08) * Math.exp(-t * 4.8);
      } else if (tone === 'acid') {
        wave = 0;
        const harmonics = Math.min(7, Math.floor(sampleRate / (2 * frequency)));
        for (let n = 1; n <= harmonics; n += 1) {
          wave += Math.sin(n * phase) * Math.exp(-t * n * 7) / (n ** 1.35);
        }
        wave *= 0.65;
      } else {
        wave = (Math.sin(phase) * 0.75 + Math.sin(phase * 2) * 0.18
          + Math.sin(phase * 3) * 0.07) * (0.25 + 0.75 * Math.exp(-t * 5));
      }
      return wave * envelope;
    });
  }

  if (part === 0) {
    const kicks = [
      [0, 1, 2, 3, 4, 5, 6, 7],
      [0, 1.75, 2.5, 4, 5.5, 6.75],
      [0, 2.5, 4, 6],
      [0, 2, 3.5, 4, 5.75, 6.5],
    ][variant];
    kicks.forEach((beat, i) => kick(beat, i % 3 === 2 ? 0.83 : 1));
    [1, 3, 5, 7].forEach(beat => snare(beat + (variant === 2 ? 0.035 : 0), 0.56, variant !== 2));
    const subdivisions = variant === 1 ? 32 : 16;
    for (let i = 0; i < subdivisions; i += 1) {
      const beat = i * 8 / subdivisions;
      if (variant === 3 && i % 4 === 0) continue;
      const swing = variant === 2 && i % 2 === 1 ? 0.055 : 0;
      hat(beat + swing, i % 2 ? 0.19 : 0.10, variant === 0 && i % 4 === 3);
    }
    if (variant === 1) [2.25, 6.25].forEach(beat => rim(beat));
    if (variant === 3) [0.75, 2.75, 4.75, 7.25].forEach(beat => rim(beat, 0.24));
  } else if (part === 1) {
    const patterns = [
      [[0, 0, 0.8], [1.5, 7, 0.35], [2, 0, 0.7], [3.25, 3, 0.45]],
      [[0, 0, 0.4], [0.75, 12, 0.25], [1.5, 7, 0.4], [2.5, 0, 0.3], [3.25, 10, 0.4]],
      [[0, -12, 1.75], [2, 0, 1.2], [3.5, 7, 0.35]],
      [[0, 0, 0.65], [1, 3, 0.65], [2, 7, 0.65], [3, 10, 0.65]],
    ][variant];
    for (let half = 0; half < 2; half += 1) {
      const root = half === 0 ? 36 : 32;
      patterns.forEach(([beat, note, length], i) => melodic(beat + half * 4, root + note, length,
        i % 2 === 0 ? 1 : 0.82, variant === 1 ? 'rubber' : 'bass'));
    }
  } else if (part === 2) {
    const chords = [[48, 55, 58, 63], [44, 51, 55, 60]];
    const rhythm = variant === 0 ? [[0, 3.8]]
      : variant === 1 ? [[0.5, 0.42], [1.5, 0.42], [2.5, 0.42], [3.5, 0.42]]
        : variant === 2 ? [[0, 4.12]] : [[0, 0.55], [0.75, 0.4], [1.5, 0.65], [2.75, 0.75]];
    chords.forEach((notes, half) => {
      rhythm.forEach(([beat, length]) => {
        notes.forEach((note, n) => melodic(half * 4 + beat + (variant === 0 ? n * 0.012 : 0),
          note, length, 0.24, variant === 2 ? 'pad' : variant === 1 ? 'bell' : 'keys'));
      });
    });
  } else {
    const melodies = [
      [72, 75, 79, 82, 79, 75, 72, 70, 68, 72, 75, 79, 75, 72, 70, 67],
      [72, 79, 82, 87, 82, 79, 75, 79, 68, 75, 79, 84, 79, 75, 72, 75],
      [79, 75, 72, 82, 80, 79, 75, 72],
      [72, 72, 79, 75, 72, 82, 79, 75, 68, 68, 75, 72, 68, 79, 75, 72],
    ][variant];
    const beats = variant === 2 ? [0, 0.75, 2, 3.25, 4, 5, 6.25, 7.5]
      : melodies.map((_, i) => i * 0.5);
    melodies.forEach((note, i) => melodic(beats[i], note, variant === 2 ? 0.82 : variant === 1 ? 0.3 : 0.40,
      i % 4 === 0 ? 0.9 : 0.67, variant === 2 ? 'bell' : variant === 3 ? 'acid' : 'keys'));
    if (variant === 0 || variant === 2) {
      // A very quiet eighth-note echo is baked into these original melodic clips.
      melodies.forEach((note, i) => melodic(beats[i] + 0.75, note, 0.32, 0.13, 'bell'));
    }
  }

  // Remove DC; a 3 ms edge taper prevents discontinuities when replacing loops.
  let sum = 0;
  for (const sample of samples) sum += sample;
  const mean = sum / samples.length;
  const fade = Math.max(2, Math.round(0.003 * sampleRate));
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const envelope = Math.min(1, i / (fade - 1), (samples.length - 1 - i) / (fade - 1));
    samples[i] = (samples[i] - mean) * envelope;
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  if (peak > 0) {
    const gain = LEVELS[part] / peak;
    for (let i = 0; i < samples.length; i += 1) samples[i] *= gain;
  }
  return samples;
}

/** Build an AudioBuffer lazily after the user's audio-start gesture. */
export function createDemoBuffer(context, index) {
  const samples = synthClip(index, context.sampleRate);
  const buffer = context.createBuffer(1, samples.length, context.sampleRate);
  buffer.getChannelData(0).set(samples);
  return buffer;
}
