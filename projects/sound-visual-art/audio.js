import {analyseFrame, clamp} from './core.js';

export const MAX_FILE_BYTES = 60 * 1024 * 1024;
export const MAX_FILE_SECONDS = 20 * 60;
const quietSignal = () => ({level: 0, pitchHz: null, hasPitch: false, centroidHz: 0, rms: 0, confidence: 0});

/** 音の入出力だけを担当します。マイクをスピーカーへ接続しません。 */
export class AudioEngine {
  constructor({onState = () => {}, onError = () => {}, contextFactory, getUserMedia} = {}) {
    this._onState = onState;
    this._onError = onError;
    this._contextFactory = contextFactory ?? (() => {
      const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!Context) throw new Error('このブラウザは音声処理に対応していません。');
      return new Context();
    });
    this._getUserMedia = getUserMedia ?? (constraints => {
      if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
        throw new Error('この環境ではマイクを使えません。HTTPSで開き、対応ブラウザでお試しください。');
      }
      return globalThis.navigator.mediaDevices.getUserMedia(constraints);
    });
    this._context = null;
    this._master = null;
    this._limiter = null;
    this._analyser = null;
    this._samples = null;
    this._frequencyDb = null;
    this._stream = null;
    this._inputNode = null;
    this._buffer = null;
    this._fileName = '';
    this._source = 'none';
    this._pendingInput = null;
    this._playing = false;
    this._soundEnabled = false;
    this._volume = 0.25;
    this._offset = 0;
    this._startedAt = 0;
    this._inputEpoch = 0;
    this._playEpoch = 0;
    this._soundEpoch = 0;
    this._voices = new Set();
    this._lastTouchAt = -Infinity;
    this._disposed = false;
  }

  get state() {
    return {source: this._source, micActive: this._stream !== null, fileName: this._fileName,
      playing: this._playing, soundEnabled: this._soundEnabled, volume: this._volume};
  }

  _emit() { try { this._onState(this.state); } catch {} }
  _fail(error) { try { this._onError(error); } catch {} return error; }
  _assertLive() { if (this._disposed) throw new Error('音声処理は終了しています。ページを開き直してください。'); }

  async _ready() {
    this._assertLive();
    if (!this._context) {
      const context = this._contextFactory();
      let master, limiter, analyser;
      try {
        master = context.createGain();
        master.gain.value = 0;
        limiter = context.createDynamicsCompressor();
        limiter.threshold.value = -5;
        limiter.knee.value = 0;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.15;
        master.connect(limiter);
        limiter.connect(context.destination);
        analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.65;
      } catch (error) {
        // 初期化途中の失敗でも接続を残さず、次の操作で作り直せる状態に戻します。
        for (const node of [master, limiter, analyser]) try { node?.disconnect(); } catch {}
        try { Promise.resolve(context.close()).catch(() => {}); } catch {}
        throw error;
      }
      this._context = context;
      this._master = master;
      this._limiter = limiter;
      this._analyser = analyser;
      this._samples = new Float32Array(analyser.fftSize);
      this._frequencyDb = new Float32Array(analyser.frequencyBinCount);
    }
    if (this._context.state === 'suspended') await this._context.resume();
    this._assertLive();
    return this._context;
  }

  _applyGain() {
    if (!this._master) return;
    const target = this._soundEnabled ? this._volume : 0;
    const now = this._context.currentTime;
    const gain = this._master.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(target, now + 0.035);
  }

  async enableSound(enabled = true) {
    const epoch = ++this._soundEpoch;
    this._assertLive();
    if (!enabled) {
      this._soundEnabled = false;
      this._applyGain();
      this._emit();
      return false;
    }
    try {
      await this._ready();
      if (epoch !== this._soundEpoch || this._disposed) return false;
      this._soundEnabled = true;
      this._applyGain();
      this._emit();
      return true;
    } catch (error) {
      if (epoch !== this._soundEpoch || this._disposed) return false;
      this._soundEnabled = false;
      this._emit();
      throw this._fail(error);
    }
  }

  setVolume(value) {
    this._assertLive();
    this._volume = clamp(Number(value), 0, 1);
    this._applyGain();
    this._emit();
  }

  _stopNode() {
    if (!this._inputNode) return;
    const node = this._inputNode;
    this._inputNode = null;
    node.onended = null;
    try { node.stop?.(); } catch {}
    try { node.disconnect(); } catch {}
  }

  _clearInput() {
    ++this._playEpoch;
    this._stopNode();
    if (this._stream) for (const track of this._stream.getTracks()) track.stop();
    this._stream = null;
    this._buffer = null;
    this._fileName = '';
    this._source = 'none';
    this._playing = false;
    this._offset = 0;
    this._pendingInput = null;
  }

  async startMicrophone() {
    this._assertLive();
    const epoch = ++this._inputEpoch;
    this._clearInput();
    this._pendingInput = 'microphone';
    this._emit();
    let stream = null;
    try {
      const context = await this._ready();
      if (epoch !== this._inputEpoch || this._disposed) return false;
      stream = await this._getUserMedia({audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: false}, video: false});
      // 許可ダイアログを待つ間に入力が切り替わった場合も、取得済みの機器を解放します。
      if (epoch !== this._inputEpoch || this._disposed) {
        for (const track of stream.getTracks()) track.stop();
        return false;
      }
      const input = context.createMediaStreamSource(stream);
      input.connect(this._analyser);
      this._stream = stream;
      this._inputNode = input;
      this._source = 'microphone';
      this._pendingInput = null;
      this._emit();
      return true;
    } catch (error) {
      if (stream) for (const track of stream.getTracks()) track.stop();
      if (epoch !== this._inputEpoch || this._disposed) return false;
      this._clearInput();
      this._emit();
      const message = error?.name === 'NotAllowedError'
        ? 'マイクの許可が得られませんでした。デモや音源ファイルでも楽しめます。'
        : error?.name === 'NotFoundError' ? 'マイクが見つかりません。接続を確認してください。'
        : error?.message || 'マイクを開始できませんでした。';
      throw this._fail(new Error(message));
    }
  }

  stopMicrophone() {
    if (this._source !== 'microphone' && this._pendingInput !== 'microphone') return;
    ++this._inputEpoch;
    this._clearInput();
    this._emit();
  }

  async loadFile(file) {
    this._assertLive();
    if (!file || typeof file.arrayBuffer !== 'function' || !Number.isFinite(file.size) || file.size <= 0) {
      throw this._fail(new Error('音源ファイルを選んでください。'));
    }
    if (file.size > MAX_FILE_BYTES) throw this._fail(new Error('音源は60MB以下のファイルを選んでください。'));
    const epoch = ++this._inputEpoch;
    this._clearInput();
    this._pendingInput = 'file';
    this._emit();
    try {
      const context = await this._ready();
      if (epoch !== this._inputEpoch || this._disposed) return false;
      const bytes = await file.arrayBuffer();
      if (epoch !== this._inputEpoch || this._disposed) return false;
      const buffer = await context.decodeAudioData(bytes);
      if (epoch !== this._inputEpoch || this._disposed) return false;
      if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) throw new Error('再生できる音声が含まれていません。');
      if (buffer.duration > MAX_FILE_SECONDS) throw new Error('音源は20分以内のファイルを選んでください。');
      this._buffer = buffer;
      this._fileName = String(file.name || '音源ファイル').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180);
      this._source = 'file';
      this._pendingInput = null;
      this._emit();
      return true;
    } catch (error) {
      if (epoch !== this._inputEpoch || this._disposed) return false;
      this._clearInput();
      this._emit();
      throw this._fail(new Error(`音源を読み込めませんでした。${error?.message || '対応形式の音源を選んでください。'}`));
    }
  }

  async playFile() {
    this._assertLive();
    if (this._source !== 'file' || !this._buffer) throw this._fail(new Error('先に音源ファイルを選んでください。'));
    if (this._playing) return true;
    const epoch = ++this._playEpoch, inputEpoch = this._inputEpoch;
    try {
      const context = await this._ready();
      if (epoch !== this._playEpoch || inputEpoch !== this._inputEpoch || this._disposed) return false;
      const node = context.createBufferSource();
      node.buffer = this._buffer;
      node.connect(this._analyser);
      node.connect(this._master);
      this._inputNode = node;
      this._offset = clamp(this._offset, 0, Math.max(0, this._buffer.duration - 1 / context.sampleRate));
      this._startedAt = context.currentTime;
      node.onended = () => {
        if (this._inputNode !== node) return;
        this._inputNode = null;
        this._playing = false;
        this._offset = 0;
        try { node.disconnect(); } catch {}
        this._emit();
      };
      node.start(0, this._offset);
      this._playing = true;
      this._emit();
      return true;
    } catch (error) {
      if (epoch !== this._playEpoch || inputEpoch !== this._inputEpoch || this._disposed) return false;
      this._stopNode();
      this._playing = false;
      this._emit();
      throw this._fail(new Error(`音源を再生できませんでした。${error?.message || ''}`));
    }
  }

  pauseFile() {
    ++this._playEpoch;
    if (!this._playing || this._source !== 'file') return;
    this._offset += Math.max(0, this._context.currentTime - this._startedAt);
    if (this._offset >= this._buffer.duration) this._offset = 0;
    this._stopNode();
    this._playing = false;
    this._emit();
  }

  async stopInput() {
    ++this._inputEpoch;
    this._clearInput();
    this._emit();
  }

  sample() {
    if (!this._analyser || (this._source !== 'microphone' && !this._playing)) return quietSignal();
    try {
      this._analyser.getFloatTimeDomainData(this._samples);
      this._analyser.getFloatFrequencyData(this._frequencyDb);
      return analyseFrame(this._samples, this._frequencyDb, this._context.sampleRate);
    } catch (error) {
      // エラーを毎フレーム繰り返さず、入力を閉じてデモへ戻れる状態にします。
      this.stopInput();
      this._fail(new Error(`音の解析を停止しました。${error?.message || ''}`));
      return quietSignal();
    }
  }

  playTouch(normY, strength) {
    if (!this._context || !this._soundEnabled || this._context.currentTime - this._lastTouchAt < 0.055) return false;
    this._lastTouchAt = this._context.currentTime;
    return this.playTone(130 + (1 - clamp(normY, 0, 1)) * 1100, clamp(strength, 0, 1) * 60, 0.4);
  }

  playTone(frequency, volumePct, duration = 0.6) {
    if (this._disposed || !this._soundEnabled || this._volume === 0 || !this._context || this._context.state !== 'running') return false;
    const context = this._context;
    const freq = clamp(Number(frequency), 40, Math.min(4000, context.sampleRate / 4));
    const seconds = clamp(Number(duration), 0.08, 2);
    const strength = clamp(Number(volumePct) / 100, 0, 1);
    if (!strength) return false;
    // 同時発音数と個別ゲインを制限し、連続操作でも音量が積み上がりすぎないようにします。
    if (this._voices.size >= 8) this._finishVoice(this._voices.values().next().value);
    const oscillator = context.createOscillator(), gain = context.createGain();
    const voice = {oscillator, gain};
    this._voices.add(voice);
    oscillator.type = freq > 700 ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(freq, context.currentTime);
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(strength * 0.12, context.currentTime + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + seconds);
    oscillator.connect(gain);
    gain.connect(this._master);
    oscillator.onended = () => this._finishVoice(voice, false);
    oscillator.start();
    oscillator.stop(context.currentTime + seconds + 0.02);
    return true;
  }

  _finishVoice(voice, stop = true) {
    if (!voice || !this._voices.delete(voice)) return;
    voice.oscillator.onended = null;
    if (stop) try { voice.oscillator.stop(); } catch {}
    try { voice.oscillator.disconnect(); voice.gain.disconnect(); } catch {}
  }

  async dispose() {
    if (this._disposed) return;
    this._disposed = true;
    ++this._inputEpoch; ++this._playEpoch; ++this._soundEpoch;
    this._clearInput();
    for (const voice of [...this._voices]) this._finishVoice(voice);
    this._soundEnabled = false;
    try { this._master?.disconnect(); this._limiter?.disconnect(); this._analyser?.disconnect(); } catch {}
    this._emit();
    if (this._context && this._context.state !== 'closed') await this._context.close();
  }
}
