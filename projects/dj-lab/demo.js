/**
 * Original demo loops for LOOP ROOM. No recordings or third-party samples.
 * Every clip is two bars in 4/4, in C minor / A-flat major.
 * House keeps the original 120 BPM sounds; Lo-fi and Techno add distinct arrangements.
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
function synthHouseClip(index, sampleRate = 22050) {
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
export function createDemoBuffer(context, index, packId = 'house') {
  const samples = synthClip(index, context.sampleRate, packId);
  const buffer = context.createBuffer(1, samples.length, context.sampleRate);
  buffer.getChannelData(0).set(samples);
  return buffer;
}


export const DEMO_PACKS = Object.freeze([
  { id: 'house', name: 'NEON HOUSE', bpm: 120, beats: 8, description: '軽快な4つ打ち。まずはここから。' },
  { id: 'lofi', name: 'DUSTY LO-FI', bpm: 90, beats: 8, description: 'ゆったりしたビートと、柔らかな鍵盤。' },
  { id: 'techno', name: 'NIGHT TECHNO', bpm: 132, beats: 8, description: 'タイトなキックと、暗めのシンセ。' },
].map(pack => Object.freeze(pack)));

const styledNames = {
  lofi: ['Lazy Sunday', 'Paper Drums', 'Pocket Swing', 'Rainy Steps',
    'Velvet Sub', 'Roundabout', 'Late Walk', 'Low Tide',
    'Coffee Keys', 'Window Chords', 'Tape Haze', 'Small Hours',
    'Soft Focus', 'Blue Lantern', 'Toy Piano', 'Night Window'],
  techno: ['Warehouse', 'Steel Pulse', 'Concrete', 'After Hours',
    'Rubber Acid', 'Low Engine', 'Tunnel Bass', 'Pulse Drive',
    'Dark Stab', 'Minor Circuit', 'Cold Pad', 'Echo Chord',
    'Signal Run', 'Acid Line', 'Metal Arp', 'Last Train'],
};
const clipsByPack = Object.freeze({
  house: DEMO_CLIPS,
  ...Object.fromEntries(Object.entries(styledNames).map(([packId, names]) => [packId,
    Object.freeze(names.map((name, index) => Object.freeze({
      id: `${packId}-${index + 1}`, name, part: DEMO_CLIPS[index].part,
    }))),
  ])),
});

export function getDemoClips(packId = 'house') {
  const clips = Object.hasOwn(clipsByPack, packId) ? clipsByPack[packId] : null;
  if (!clips) throw new RangeError('Unknown demo pack.');
  return clips;
}

export function findDemoClip(id) {
  for (const pack of DEMO_PACKS) {
    const index = getDemoClips(pack.id).findIndex(clip => clip.id === id);
    if (index >= 0) return { packId: pack.id, index };
  }
  return null;
}

export function synthClip(index, sampleRate = 22050, packId = 'house') {
  getDemoClips(packId);
  if (packId === 'house') return synthHouseClip(index, sampleRate);
  return synthStyledClip(index, sampleRate, packId);
}

function synthStyledClip(index, sampleRate, packId) {
  if (!Number.isInteger(index) || index < 0 || index > 15) throw new RangeError('Demo index must be an integer from 0 to 15.');
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new RangeError('Sample rate must be an integer from 8000 to 192000 Hz.');
  const techno = packId === 'techno';
  const bpm = techno ? 132 : 90, beatSeconds = 60 / bpm;
  const samples = new Float32Array(Math.round(8 * beatSeconds * sampleRate));
  const part = Math.floor(index / 4), variant = index % 4;
  const random = seededNoise((techno ? 0x7a391d1b : 0x37a10f29) ^ ((index + 1) * 0x45d9f3b));

  function add(beat, seconds, gain, synthesise) {
    const start = Math.round(beat * beatSeconds * sampleRate);
    const frames = Math.max(1, Math.round(seconds * sampleRate));
    for (let i = 0; i < frames; i += 1) {
      const position = ((start + i) % samples.length + samples.length) % samples.length;
      samples[position] += gain * synthesise(i / sampleRate, seconds);
    }
  }
  function kick(beat, gain = 1) {
    add(beat, techno ? 0.46 : 0.32, gain, t => {
      const phase = TAU * ((techno ? 44 : 49) * t + (techno ? 3.2 : 1.5) * (1 - Math.exp(-t * 55)));
      const envelope = Math.min(1, t / 0.0018) * Math.exp(-t * (techno ? 10 : 13));
      const wave = Math.sin(phase) + (techno ? Math.sin(phase * 2) * 0.19 : 0);
      return (techno ? Math.tanh(wave * 1.8) : wave) * envelope;
    });
  }
  function snare(beat, gain = 0.5) {
    let low = 0;
    add(beat, techno ? 0.20 : 0.23, gain, t => {
      const noise = random(); low += (noise - low) * (techno ? 0.52 : 0.18);
      const wave = techno ? noise - low * 0.45 : low;
      const body = Math.sin(TAU * (techno ? 205 : 162) * t) * 0.22 * Math.exp(-t * 24);
      return (wave * 0.9 * Math.exp(-t * (techno ? 23 : 17)) + body) * Math.min(1, t / 0.0012);
    });
  }
  function hat(beat, gain = 0.12, open = false) {
    let last = 0;
    add(beat, open ? 0.30 : 0.07, gain, t => {
      const n = random(), high = n - last; last = n;
      const metallic = Math.sin(TAU * 3281 * t) * Math.sin(TAU * 5177 * t);
      return (high * (techno ? 0.75 : 0.32) + metallic * (techno ? 0.3 : 0.08))
        * Math.exp(-t * (open ? 14 : techno ? 52 : 70)) * Math.min(1, t / 0.0008);
    });
  }
  function rim(beat, gain = 0.2) {
    add(beat, 0.09, gain, t => Math.sin(TAU * 680 * t) * Math.sin(TAU * 930 * t)
      * Math.exp(-t * 55) * Math.min(1, t / 0.001));
  }
  function note(beat, midi, length, gain, tone) {
    const seconds = length * beatSeconds, frequency = noteHz(midi);
    const attack = tone === 'pad' ? 0.12 : 0.005;
    const release = Math.min(seconds * 0.35, tone === 'pad' ? 0.22 : 0.07);
    const harmonics = Math.min(9, Math.floor(sampleRate / (2 * frequency)));
    add(beat, seconds, gain, t => {
      const envelope = Math.min(1, t / attack, Math.max(0, (seconds - t) / release));
      const wobble = techno ? 1 : 1 + Math.sin(TAU * 1.1 * t) * 0.0011;
      const phase = TAU * frequency * t * wobble;
      let wave = 0;
      if (tone === 'sub') wave = Math.sin(phase) * 0.86 + Math.sin(phase * 2) * 0.1 + Math.sin(phase * 3) * 0.04;
      else if (tone === 'acid') {
        for (let n = 1; n <= harmonics; n += 1) wave += Math.sin(phase * n) * Math.exp(-t * n * (variant % 2 ? 11 : 5)) / (n ** 1.1);
        wave = Math.tanh(wave * 1.4) * (0.35 + 0.65 * Math.exp(-t * 5));
      } else if (tone === 'pad') wave = (Math.sin(phase * 0.999) + Math.sin(phase * 1.001)) * 0.4 + Math.sin(phase * 2) * 0.09;
      else if (tone === 'metal') wave = (Math.sin(phase) * 0.64 + Math.sin(phase * 2.76) * 0.23 + Math.sin(phase * 4.17) * 0.13) * Math.exp(-t * 7);
      else if (tone === 'rhodes') wave = (Math.sin(phase) * 0.8 + Math.sin(phase * 2) * 0.13 * Math.exp(-t * 5)
        + Math.sin(phase * 3) * 0.07 * Math.exp(-t * 12)) * (0.45 + 0.55 * Math.exp(-t * 3));
      else wave = (Math.sin(phase) * 0.85 + Math.sin(phase * 2.003) * 0.15) * Math.exp(-t * 3.5);
      return wave * envelope;
    });
  }

  if (part === 0) {
    const kicks = techno
      ? [[0,1,2,3,4,5,6,7], [0,1,2,2.75,3,4,5,6,7,7.5], [0,1,2,3,4,5,6,7], [0,1,2.5,3,4,5,6.5,7]][variant]
      : [[0,2.5,4,6.5], [0,1.75,4,5.5,6.75], [0,2.25,3.5,4,6.25], [0,1.5,2.75,4,5.75,7]][variant];
    kicks.forEach((beat, i) => kick(beat, i % 3 === 2 ? 0.85 : 1));
    [1,3,5,7].forEach(beat => snare(beat + (techno ? 0 : 0.055), techno ? 0.55 : 0.6));
    const subdivisions = techno && variant === 1 ? 32 : 16;
    for (let i = 0; i < subdivisions; i += 1) {
      const beat = i * 8 / subdivisions + (!techno && i % 2 ? 0.095 : 0);
      hat(beat, i % 2 ? (techno ? 0.2 : 0.16) : 0.08, techno && i % 4 === 1 && variant !== 2);
    }
    if (techno && variant === 2) for (let i = 0; i < 8; i += 1) rim(i + 0.75, 0.23);
    if (!techno && variant > 0) [1.75,3.25,5.75,7.25].forEach(beat => rim(beat, 0.2));
    if (techno && variant === 3) [6.5,7,7.25,7.5,7.75].forEach(beat => snare(beat,0.28));
  } else if (part === 1) {
    const patterns = techno ? [
      [[0,0,0.35],[0.75,0,0.2],[1.5,12,0.22],[2,0,0.35],[2.75,7,0.2],[3.5,3,0.3]],
      [[0,-12,0.8],[1,0,0.35],[1.75,0,0.2],[2.5,7,0.25],[3,0,0.3]],
      [[0,0,0.45],[1.5,0,0.4],[2.5,3,0.25],[3.25,7,0.45]],
      [[0,0,0.2],[0.5,7,0.2],[1,12,0.2],[1.5,7,0.2],[2,0,0.2],[2.5,3,0.2],[3,10,0.2],[3.5,7,0.2]],
    ][variant] : [
      [[0,0,1.6],[2.5,7,0.65]], [[0,0,0.7],[1.65,3,0.45],[2.5,7,0.5],[3.5,10,0.3]],
      [[0,0,0.75],[1.1,7,0.6],[2.4,10,0.5],[3.25,7,0.6]], [[0,-12,1.7],[2.75,0,0.95]],
    ][variant];
    for(let half=0;half<2;half+=1) patterns.forEach(([beat,interval,length],i)=>
      note(half*4+beat, (half?32:36)+interval,length,i%2?0.8:1,techno&&variant!==1?'acid':'sub'));
  } else if (part === 2) {
    const chords = techno ? [[48,55,58],[44,51,55]] : [[48,55,58,62],[44,51,55,58]];
    const rhythms = techno ? [
      [[0.5,0.3],[2.5,0.3]], [[0,0.35],[1.5,0.35],[3.25,0.3]], [[0,4.15]], [[0.75,0.55],[2.25,0.55],[3.5,0.4]],
    ][variant] : [
      [[0.07,3.7]], [[0.05,1.25],[2.65,1.15]], [[0,4.13]], [[0.1,0.8],[1.7,0.65],[3.15,0.75]],
    ][variant];
    chords.forEach((notes,half)=>rhythms.forEach(([beat,length])=>notes.forEach((midi,n)=>
      note(half*4+beat+(!techno?n*0.018:0),midi,length,0.24,variant===2?'pad':techno?'acid':'rhodes'))));
  } else {
    const melodies = techno ? [
      [72,79,75,82,72,79,75,70,68,75,72,79,68,75,72,67],
      [60,60,67,63,60,72,67,63,56,56,63,60,56,67,63,60],
      [79,82,75,79,75,72,70,67,75,79,72,75,72,68,67,63],
      [72,75,79,82,79,75,72,70],
    ][variant] : [
      [75,79,82,79,72,75,79,75], [72,70,67,70,68,72,75,72],
      [79,75,72,75,75,72,68,72], [72,79,75,70,68,75,72,67],
    ][variant];
    const gap=8/melodies.length;
    melodies.forEach((midi,i)=>{
      const beat=i*gap+(!techno&&i%2?0.085:0);
      const length=techno?(variant===3?0.65:0.28):(variant===2?0.8:0.62);
      note(beat,midi,length,i%4?0.68:0.95,techno?(variant===2?'metal':'acid'):(variant===2?'bell':'rhodes'));
      if(!techno && variant===3)note(beat+0.75,midi,0.3,0.12,'bell');
    });
  }

  // Lo-fi is a distinct sound design: subdued top end and tiny seeded tape texture.
  if (!techno) {
    let low=0;
    const alpha=1-Math.exp(-TAU*(part===0?2800:part===1?1600:3200)/sampleRate);
    for(let i=0;i<samples.length;i+=1){
      low += alpha*(samples[i]-low);
      samples[i]=low+(part===0||part===2?random()*0.0008:0);
    }
  }
  let mean=0;for(const value of samples)mean+=value;mean/=samples.length;
  const fade=Math.max(2,Math.round(sampleRate*0.003));let peak=0;
  for(let i=0;i<samples.length;i+=1){
    samples[i]=(samples[i]-mean)*Math.min(1,i/(fade-1),(samples.length-1-i)/(fade-1));
    peak=Math.max(peak,Math.abs(samples[i]));
  }
  const gain=[0.33,0.25,0.21,0.18][part]/Math.max(peak,0.00001);
  for(let i=0;i<samples.length;i+=1)samples[i]*=gain;
  return samples;
}
