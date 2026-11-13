/**
 * 自分のキャンバスだけを短い動画へ保存します。
 * マイクや画面共有は使わず、音声トラックも含めません。
 */
export const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
const TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];

function recordingType(RecorderClass) {
  if (typeof RecorderClass !== 'function') return null;
  // 古い実装では形式の照会がありません。その場合だけブラウザの既定値を使います。
  if (typeof RecorderClass.isTypeSupported !== 'function') return '';
  for (const type of TYPES) {
    try { if (RecorderClass.isTypeSupported(type)) return type; } catch {}
  }
  return null;
}

function numberInRange(value, minimum, maximum, fallback) {
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
}

export class CanvasRecorder {
  constructor({onState = () => {}, onError = () => {}, onReady = () => {},
    RecorderClass = globalThis.MediaRecorder,
    setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimer = handle => globalThis.clearTimeout(handle)} = {}) {
    this._onState = onState;
    this._onError = onError;
    this._onReady = onReady;
    this._RecorderClass = RecorderClass;
    // WindowのメソッドへCanvasRecorderをthisとして渡さないよう、境界で包みます。
    // 注入されたテスト用関数も、特定のreceiverに依存しない呼び方へそろえます。
    this._setTimer = (callback, delay) => setTimer(callback, delay);
    this._clearTimer = handle => clearTimer(handle);
    this._session = null;
    this._disposed = false;
  }

  static supports(canvas, RecorderClass = globalThis.MediaRecorder) {
    return typeof canvas?.captureStream === 'function' && recordingType(RecorderClass) !== null;
  }

  get supported() { return recordingType(this._RecorderClass) !== null; }
  supports(canvas) { return CanvasRecorder.supports(canvas, this._RecorderClass); }
  get recording() { return !!this._session && !this._session.stopping && !this._session.settled; }

  _state(recording, duration, processing = false) {
    try { this._onState({recording, duration, processing}); } catch {}
  }

  _error(error) {
    try { this._onError(error); } catch {}
  }

  start(canvas, {duration = 12, fps = 24} = {}) {
    if (this._session) return false;
    if (this._disposed) {
      this._error(new Error('動画の保存は終了しています。ページを開き直してください。'));
      return false;
    }
    if (!this.supports(canvas)) {
      this._error(new Error('このブラウザでは動画を保存できません。画像の保存をお試しください。'));
      return false;
    }
    const seconds = numberInRange(duration, 1, 15, 12);
    const frameRate = numberInRange(fps, 1, 30, 24);
    let stream, session;
    try {
      stream = canvas.captureStream(frameRate);
      // Canvas由来のストリームには通常音声がありません。存在する場合も含めません。
      for (const track of stream.getAudioTracks?.() ?? []) {
        stream.removeTrack?.(track);
        track.stop();
      }
      const mimeType = recordingType(this._RecorderClass);
      const options = {videoBitsPerSecond: 2500000};
      if (mimeType) options.mimeType = mimeType;
      const recorder = new this._RecorderClass(stream, options);
      let resolve;
      const done = new Promise(finish => { resolve = finish; });
      session = {recorder, stream, duration: seconds, chunks: [], bytes: 0, discard: false,
        stopping: false, settled: false, errorReported: false, timer: null, watchdog: null,
        done, resolve, trackListeners: []};
      this._session = session;
      recorder.ondataavailable = event => this._data(session, event?.data);
      recorder.onerror = event => this._abort(session, '動画を作成できませんでした。画像の保存をお試しください。', event?.error);
      recorder.onstop = () => this._finish(session);
      for (const track of stream.getVideoTracks?.() ?? []) {
        const ended = () => this._stopSession(session);
        if (typeof track.addEventListener === 'function') {
          track.addEventListener('ended', ended);
          session.trackListeners.push({track, ended, eventListener: true});
        } else {
          track.onended = ended;
          session.trackListeners.push({track, ended, eventListener: false});
        }
      }
      recorder.start(250);
      if (!session.settled && !session.stopping) {
        session.timer = this._setTimer(() => this._stopSession(session), seconds * 1000);
        this._state(true, seconds);
      }
      return !session.settled && !session.stopping;
    } catch (error) {
      if (session) {
        session.discard = true;
        try { session.recorder.stop(); } catch {}
        this._finish(session);
      } else {
        for (const track of stream?.getTracks?.() ?? []) try { track.stop(); } catch {}
      }
      this._error(new Error('動画の保存を開始できませんでした。画像の保存をお試しください。', {cause: error}));
      return false;
    }
  }

  _data(session, blob) {
    if (session.settled || session.discard || !blob || !Number.isFinite(blob.size) || blob.size <= 0) return;
    if (session.bytes + blob.size > MAX_VIDEO_BYTES) {
      this._abort(session, '動画の容量が大きくなったため保存を止めました。短く撮るか軽量表示をお試しください。');
      return;
    }
    session.bytes += blob.size;
    session.chunks.push(blob);
  }

  _abort(session, message, cause) {
    if (session.settled) return;
    session.discard = true;
    session.chunks.length = 0;
    if (!session.errorReported) {
      session.errorReported = true;
      this._error(new Error(message, {cause}));
    }
    this._stopSession(session);
  }

  stop({discard = false} = {}) {
    const session = this._session;
    if (!session) return Promise.resolve(null);
    if (discard) { session.discard = true; session.chunks.length = 0; }
    this._stopSession(session);
    return session.done;
  }

  _stopSession(session) {
    if (session.settled || session.stopping) return session.done;
    session.stopping = true;
    if (session.timer !== null) this._clearTimer(session.timer);
    session.timer = null;
    this._state(false, session.duration, true);
    try {
      if (session.recorder.state === 'inactive') this._finish(session);
      else {
        // ondataavailableの後にonstopが届くため、最後のデータを待ってから解放します。
        session.recorder.stop();
        if (!session.settled) {
          session.watchdog = this._setTimer(() => {
            if (session.settled) return;
            session.discard = true;
            if (!session.errorReported) {
              session.errorReported = true;
              this._error(new Error('動画の作成を終了できませんでした。もう一度お試しください。'));
            }
            this._finish(session);
          }, 2500);
        }
      }
    } catch (error) {
      session.discard = true;
      if (!session.errorReported) {
        session.errorReported = true;
        this._error(new Error('動画を終了できませんでした。もう一度お試しください。', {cause: error}));
      }
      this._finish(session);
    }
    return session.done;
  }

  _release(session) {
    for (const timer of [session.timer, session.watchdog]) if (timer !== null) this._clearTimer(timer);
    session.timer = null; session.watchdog = null;
    for (const {track, ended, eventListener} of session.trackListeners) {
      if (eventListener) track.removeEventListener?.('ended', ended);
      else if (track.onended === ended) track.onended = null;
    }
    session.trackListeners.length = 0;
    for (const track of session.stream.getTracks?.() ?? []) try { track.stop(); } catch {}
    session.recorder.ondataavailable = null;
    session.recorder.onerror = null;
    session.recorder.onstop = null;
  }

  _finish(session) {
    if (session.settled) return;
    session.settled = true;
    let result = null;
    if (!session.discard && !this._disposed) {
      if (session.bytes > 0) {
        const mimeType = session.recorder.mimeType || session.chunks[0]?.type || 'video/webm';
        const blob = new Blob(session.chunks, {type: mimeType});
        result = {blob, mimeType, extension: mimeType.toLowerCase().startsWith('video/mp4') ? 'mp4' : 'webm'};
      } else if (!session.errorReported) {
        session.errorReported = true;
        this._error(new Error('動画に光景を保存できませんでした。動かした状態でもう一度お試しください。'));
      }
    }
    this._release(session);
    session.chunks.length = 0;
    if (this._session === session) this._session = null;
    this._state(false, session.duration);
    if (result) try { this._onReady(result); } catch {}
    session.resolve(result);
  }

  async dispose() {
    if (this._disposed) return;
    this._disposed = true;
    const session = this._session;
    if (session) {
      session.discard = true;
      this._stopSession(session);
      // ページを離れる場合は、エンコーダーの応答を待たず撮影トラックを解放します。
      this._finish(session);
    }
  }
}
