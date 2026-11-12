import { KEYS, QUANTISE, finiteRange, groupOf, clipRate, beatAt, nextBoundary, clipProgress } from './core.js';

const FADE = 0.008;
const slotState = index => ({
  index, name: '', buffer: null, raw: null, kind: 'demo', demoId: null,
  volume: 0.75, pan: 0, beats: 8, loop: true, sync: true, muted: false,
  playing: false, pending: null, voice: null, gain: null, panner: null,
});

// 元作品の16音源・8拍予約・終了音の解放を、AudioContext時刻で拡張。
export class DJEngine {
  constructor() {
    this.context = null;
    this.slots = KEYS.map((_, index) => slotState(index));
    this.running = false;
    this.bpm = 120;
    this.quantise = 8;
    this.exclusive = true;
    this.origin = 0;
    this.voices = new Set();
    this.master = { volume: 0.75, filter: 1, echo: 0, low: 0, high: 0 };
    this.analyser = null;
    this.recordDestination = null;
  }

  async initialise() {
    if (!this.context) {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Context) throw new Error('このブラウザはWeb Audioに対応していません。');
      this.context = new Context({ latencyHint: 'interactive' });
      this._buildGraph();
    }
    if (this.context.state !== 'running') await this.context.resume();
    if (this.context.state !== 'running') throw new Error('音声を開始できません。もう一度、再生ボタンを押してください。');
    return this;
  }

  _requireContext() {
    if (!this.context || this.context.state === 'closed') throw new Error('先に音声を有効にしてください。');
  }

  _slot(index) { groupOf(index); return this.slots[index]; }

  _smooth(param, value) {
    const time = this.context.currentTime;
    param.cancelScheduledValues(time);
    param.setTargetAtTime(value, time, 0.015);
  }

  _buildGraph() {
    const c = this.context;
    this.mix = c.createGain();
    this.low = c.createBiquadFilter(); this.low.type = 'lowshelf'; this.low.frequency.value = 220;
    this.high = c.createBiquadFilter(); this.high.type = 'highshelf'; this.high.frequency.value = 4500;
    this.filter = c.createBiquadFilter(); this.filter.type = 'allpass'; this.filter.Q.value = 0.7;
    this.returnBus = c.createGain();
    this.masterVolume = c.createGain();
    this.compressor = c.createDynamicsCompressor();
    this.compressor.threshold.value = -12; this.compressor.knee.value = 18;
    this.compressor.ratio.value = 8; this.compressor.attack.value = 0.003; this.compressor.release.value = 0.15;
    this.guard = c.createWaveShaper();
    const curve = new Float32Array(4097);
    for (let i = 0; i < curve.length; i += 1) {
      const x = i * 2 / (curve.length - 1) - 1;
      const a = Math.abs(x);
      curve[i] = a <= 0.8 ? x : Math.sign(x) * (0.8 + 0.18 * Math.tanh((a - 0.8) / 0.18));
    }
    this.guard.curve = curve; this.guard.oversample = 'none';
    this.output = c.createGain(); this.output.gain.value = 0;
    this.analyser = c.createAnalyser(); this.analyser.fftSize = 2048; this.analyser.smoothingTimeConstant = 0.75;
    this.recordDestination = c.createMediaStreamDestination();
    this.mix.connect(this.low); this.low.connect(this.high); this.high.connect(this.filter);
    this.filter.connect(this.returnBus); this.returnBus.connect(this.masterVolume);
    this.masterVolume.connect(this.compressor); this.compressor.connect(this.guard);
    this.guard.connect(this.output); this.output.connect(this.analyser);
    this.analyser.connect(c.destination); this.analyser.connect(this.recordDestination);
    for (const slot of this.slots) {
      slot.gain = c.createGain(); slot.panner = c.createStereoPanner();
      slot.gain.connect(slot.panner); slot.panner.connect(this.mix);
      this._applySlot(slot);
    }
    this._resetEcho(); this.setMaster(this.master);
  }

  _resetEcho() {
    if (this.delay) {
      this.filter.disconnect(this.delay);
      this.delay.disconnect(); this.echoFeedback.disconnect(); this.echoReturn.disconnect();
    }
    const c = this.context;
    this.delay = c.createDelay(2); this.delay.delayTime.value = 60 / this.bpm * 0.75;
    this.echoFeedback = c.createGain(); this.echoFeedback.gain.value = 0.28;
    this.echoReturn = c.createGain(); this.echoReturn.gain.value = this.master.echo;
    this.filter.connect(this.delay); this.delay.connect(this.echoFeedback); this.echoFeedback.connect(this.delay);
    this.delay.connect(this.echoReturn); this.echoReturn.connect(this.returnBus);
  }

  _applySlot(slot) {
    if (!slot.gain) return;
    this._smooth(slot.gain.gain, slot.muted ? 0 : slot.volume);
    this._smooth(slot.panner.pan, slot.pan);
  }

  load(index, options) {
    const slot = this._slot(index);
    if (!options?.buffer || !Number.isFinite(options.buffer.duration) || options.buffer.duration <= 0) throw new Error('有効な音源を読み込んでください。');
    const beats = finiteRange(options.beats ?? 8, 1, 64, '拍数');
    this._flush(); this._cancelPending(slot); this._stopVoice(slot);
    slot.buffer = options.buffer; slot.name = String(options.name ?? `音源 ${index + 1}`);
    slot.kind = options.kind === 'file' ? 'file' : 'demo'; slot.demoId = options.demoId ?? null;
    slot.raw = options.raw ?? null; slot.beats = beats;
    slot.loop = options.loop ?? true; slot.sync = options.sync ?? (slot.kind !== 'file');
    this._applySlot(slot);
  }

  clear(index) {
    const slot = this._slot(index);
    this._flush(); this._cancelPending(slot); this._stopVoice(slot);
    slot.buffer = null; slot.raw = null; slot.name = ''; slot.demoId = null;
  }

  _newVoice(slot, at) {
    const c = this.context;
    const source = c.createBufferSource(); const gain = c.createGain();
    const rate = clipRate(this.bpm, slot.buffer.duration, slot.beats, slot.sync);
    source.buffer = slot.buffer; source.loop = slot.loop; source.playbackRate.setValueAtTime(rate, at);
    source.connect(gain); gain.connect(slot.gain);
    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(1, at + FADE);
    const voice = { source, gain, startedAt: at, rate, slot, released: false };
    this.voices.add(voice);
    source.onended = () => {
      this._release(voice);
      if (slot.voice === voice) { slot.voice = null; slot.playing = false; slot.pending = null; }
    };
    source.start(at, 0);
    slot.voice = voice;
    return voice;
  }

  _release(voice) {
    if (voice.released) return;
    voice.released = true; voice.source.disconnect(); voice.gain.disconnect(); this.voices.delete(voice);
  }

  _stopVoice(slot, when = this.context?.currentTime ?? 0, scheduledFade = false) {
    const voice = slot.voice;
    slot.voice = null; slot.playing = false;
    if (!voice) return;
    if (!scheduledFade) {
      const param = voice.gain.gain;
      const now = this.context.currentTime;
      if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
      else { const value = param.value; param.cancelScheduledValues(now); param.setValueAtTime(value, now); }
      param.linearRampToValueAtTime(0, when + FADE);
    }
    voice.source.stop(when + FADE);
  }

  _cancelPending(slot, undoExclusive = true) {
    const pending = slot.pending;
    if (!pending) return;
    slot.pending = null;
    if (pending.type === 'start') {
      if (slot.voice) this._stopVoice(slot);
      if (undoExclusive) for (const other of this.slots) {
        if (other.pending?.owner === slot.index) this._cancelPending(other, false);
      }
    } else if (slot.voice) {
      const now = this.context.currentTime; const gain = slot.voice.gain.gain;
      gain.cancelScheduledValues(now); gain.setValueAtTime(1, now);
    }
  }

  _queueStop(slot, at, owner = null) {
    if (!slot.voice) return;
    // 停止はgainで予約。実source.stopは境界通過後なので予約を取り消せる。
    this._cancelPending(slot, false);
    const gain = slot.voice.gain.gain;
    gain.setValueAtTime(1, at); gain.linearRampToValueAtTime(0, at + FADE);
    slot.pending = { type: 'stop', at, owner };
  }

  _queueStart(slot, at) {
    if (this.exclusive) {
      // 先に古い切替予約を全解除。解除に伴って復活する他音源も次の停止対象へ含める。
      for (const other of this.slots) {
        if (other === slot || groupOf(other.index) !== groupOf(slot.index)) continue;
        if (other.pending?.type === 'start') this._cancelPending(other);
      }
      for (const other of this.slots) {
        if (other === slot || groupOf(other.index) !== groupOf(slot.index)) continue;
        // 行の最新の切替操作を優先。古い量子化幅の停止予約が後ろに残ると二重再生する。
        if (other.playing) this._queueStop(other, at, slot.index);
      }
    }
    slot.pending = { type: 'start', at };
    if (at !== null) this._newVoice(slot, at);
  }

  _flush() {
    if (!this.context || !this.running) return;
    const now = this.context.currentTime;
    for (const slot of this.slots) {
      const pending = slot.pending;
      if (!pending || pending.at === null || now + 1e-7 < pending.at) continue;
      slot.pending = null;
      if (pending.type === 'start') slot.playing = Boolean(slot.voice);
      else this._stopVoice(slot, pending.at, true);
    }
  }

  toggle(index) {
    const slot = this._slot(index);
    if (!slot.buffer) return false;
    this._flush();
    if (slot.pending) {
      const owner = slot.pending.owner;
      if (owner !== null && owner !== undefined && this.slots[owner].pending?.type === 'start') this._cancelPending(this.slots[owner]);
      else this._cancelPending(slot);
      return false;
    }
    if (!this.running) { this._queueStart(slot, null); return true; }
    this._requireContext();
    const at = nextBoundary(this.context.currentTime, this.origin, this.bpm, this.quantise);
    if (slot.playing) this._queueStop(slot, at);
    else this._queueStart(slot, at);
    return true;
  }

  start() {
    this._requireContext();
    if (this.running) return;
    this._resetEcho();
    this.origin = this.context.currentTime + 0.04;
    this.running = true;
    this.output.gain.cancelScheduledValues(this.context.currentTime);
    this.output.gain.setValueAtTime(0, this.context.currentTime);
    this.output.gain.linearRampToValueAtTime(1, this.origin + FADE);
    for (const slot of this.slots) if (slot.pending?.type === 'start') {
      slot.pending.at = this.origin; this._newVoice(slot, this.origin);
    }
  }

  // シーンはtoggleの列ではなく目標集合。旧予約を全解除し、同一境界へ一括予約する。
  setScene(indices) {
    if (!Array.isArray(indices)) throw new TypeError('シーンには音源番号の配列を指定してください。');
    const wanted = new Set();
    const groups = new Set();
    for (const index of indices) {
      const slot = this._slot(index);
      if (!slot.buffer) throw new Error('シーンで使う音源を先に読み込んでください。');
      if (wanted.has(index)) continue;
      const group = groupOf(index);
      if (this.exclusive && groups.has(group)) throw new Error('同じパートでは1つの音源を選んでください。');
      wanted.add(index); groups.add(group);
    }
    this._flush();
    // startの取消しは、そのstartに連動した他音源のstopも取り消す。
    for (const slot of this.slots) if (slot.pending?.type === 'start') this._cancelPending(slot);
    for (const slot of this.slots) if (slot.pending) this._cancelPending(slot);
    const at = this.running ? nextBoundary(this.context.currentTime, this.origin, this.bpm, this.quantise) : null;
    for (const slot of this.slots) {
      if (slot.playing && !wanted.has(slot.index)) this._queueStop(slot, at);
    }
    for (const index of wanted) {
      const slot = this.slots[index];
      if (!slot.playing) this._queueStart(slot, at);
    }
  }

  stop() {
    this.running = false;
    for (const slot of this.slots) { slot.pending = null; this._stopVoice(slot); }
    if (this.context) {
      const now = this.context.currentTime;
      this.output.gain.cancelScheduledValues(now);
      this.output.gain.setValueAtTime(0, now);
      this._resetEcho();
    }
  }

  setBpm(value) {
    const number = finiteRange(value, 40, 200, 'BPM');
    if (this.running) throw new Error('BPMは停止してから変更してください。');
    this.bpm = number;
    if (this.context) this._resetEcho();
  }

  setQuantise(value) {
    const number = Number(value);
    if (!QUANTISE.includes(number)) throw new RangeError('量子化は0、1、4、8拍で指定してください。');
    this.quantise = number;
  }

  setExclusive(value) {
    this._flush(); this.exclusive = Boolean(value);
    if (!this.exclusive) return;
    const retained = new Set();
    for (const slot of this.slots) {
      if (!slot.playing && slot.pending?.type !== 'start') continue;
      const group = groupOf(slot.index);
      if (retained.has(group)) { this._cancelPending(slot); this._stopVoice(slot); }
      else retained.add(group);
    }
  }

  updateSlot(index, values) {
    const slot = this._slot(index);
    this._flush();
    const next = { ...values };
    if ('volume' in next) next.volume = finiteRange(next.volume, 0, 1.5, '音量');
    if ('pan' in next) next.pan = finiteRange(next.pan, -1, 1, 'パン');
    if ('beats' in next) next.beats = finiteRange(next.beats, 1, 64, '拍数');
    for (const key of ['loop', 'sync', 'muted']) if (key in next) next[key] = Boolean(next[key]);
    // 再生中にloop長・同期率を変えると拍が飛ぶため、音量/pan/mute以外は停止して編集。
    if (slot.voice && ['beats', 'sync', 'loop'].some(key => key in next && next[key] !== slot[key])) {
      throw new Error('ループ・拍数・BPM同期は、その音源を停止してから変更してください。');
    }
    for (const key of ['volume', 'pan', 'beats', 'loop', 'sync', 'muted']) if (key in next) slot[key] = next[key];
    this._applySlot(slot);
  }

  setMaster(values) {
    const bounds = { volume: [0, 1.5], filter: [0, 1], echo: [0, 0.4], low: [-12, 12], high: [-12, 12] };
    const next = {};
    for (const [key, range] of Object.entries(bounds)) if (key in values) next[key] = finiteRange(values[key], ...range, key);
    Object.assign(this.master, next);
    if (!this.context) return;
    this._smooth(this.masterVolume.gain, this.master.volume);
    this._smooth(this.low.gain, this.master.low); this._smooth(this.high.gain, this.master.high);
    this.filter.type = this.master.filter >= 0.999 ? 'allpass' : 'lowpass';
    this._smooth(this.filter.frequency, Math.min(this.context.sampleRate * 0.45, 20 * Math.pow(1000, this.master.filter)));
    this._smooth(this.echoReturn.gain, this.master.echo);
  }

  getSnapshot() {
    this._flush();
    const now = this.context?.currentTime ?? 0;
    const beat = this.running ? beatAt(now, this.origin, this.bpm) : 0;
    return {
      running: this.running, bpm: this.bpm, beat: Math.floor(beat) % 8 + 1,
      phase: beat % 1, elapsed: this.running ? Math.max(0, now - this.origin) : 0,
      playingCount: this.slots.filter(slot => slot.playing).length,
      queuedCount: this.slots.filter(slot => slot.pending).length,
      slots: this.slots.map(slot => ({
        index: slot.index, name: slot.name, loaded: Boolean(slot.buffer), playing: slot.playing,
        pending: slot.pending?.type ?? null,
        progress: slot.playing && slot.voice ? clipProgress(now, slot.voice.startedAt, slot.voice.rate, slot.buffer.duration, slot.loop) : 0,
        volume: slot.volume, pan: slot.pan, beats: slot.beats, loop: slot.loop, sync: slot.sync,
        muted: slot.muted, kind: slot.kind, demoId: slot.demoId, duration: slot.buffer?.duration ?? 0,
      })),
    };
  }
}
