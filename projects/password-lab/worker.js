import {hashCandidate, candidateAt, searchSpace, methodCandidates} from './engine.js';

const encoder = new TextEncoder();
export async function digestCandidate(candidate, salt, mode = 'sha256') {
  if (mode === 'sha256') return hashCandidate(salt, candidate);
  if (mode !== 'pbkdf2') throw new Error('照合方式が不正です。');
  const key = await crypto.subtle.importKey('raw', encoder.encode(candidate), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2', hash:'SHA-256', salt:encoder.encode(salt), iterations:10000}, key, 256);
  return Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, '0')).join('');
}

export async function calibrate({alphabet, length, salt, mode}) {
  // 正解と比較しない別の計測です。発見した件数には含めません。
  const total = searchSpace(alphabet, length);
  let attempts = 0;
  const start = performance.now();
  do {
    const candidate = candidateAt(BigInt(attempts) % total, alphabet, length);
    await digestCandidate(candidate, salt, mode);
    attempts++;
  } while (performance.now() - start < 180 && attempts < 100000);
  const elapsedMs = performance.now() - start;
  return {attempts, elapsedMs, rate:attempts / (elapsedMs / 1000)};
}

export async function searchCPU({method, alphabet, length, salt, mode, targetHash, timeLimitMs = 2000, maxAttempts = 1000000}, onProgress = () => {}) {
  if (!['dictionary','pattern','brute'].includes(method)) throw new Error('探索方法が不正です。');
  const limit = Math.max(1, Math.min(5000, Number(timeLimitMs)));
  const cap = Math.max(1, Math.min(1000000, Math.floor(Number(maxAttempts))));
  if (!Number.isFinite(limit) || !Number.isFinite(cap)) throw new Error('上限が不正です。');
  const start = performance.now();
  let attempts = 0;
  let lastUpdate = start;
  for (const candidate of methodCandidates(method, alphabet, length)) {
    if (attempts >= cap || performance.now() - start >= limit) {
      const elapsedMs = performance.now() - start;
      return {method, status:'budget', attempts, elapsedMs, rate:attempts / (elapsedMs / 1000)};
    }
    const actual = await digestCandidate(candidate, salt, mode);
    attempts++;
    if (actual === targetHash) {
      const elapsedMs = performance.now() - start;
      return {method, status:'found', attempts, elapsedMs, rate:attempts / Math.max(0.000001, elapsedMs / 1000)};
    }
    if (performance.now() - lastUpdate > 90) {
      onProgress({method, attempts, elapsedMs:performance.now() - start});
      lastUpdate = performance.now();
    }
  }
  const elapsedMs = performance.now() - start;
  return {method, status:'exhausted', attempts, elapsedMs, rate:attempts / Math.max(0.000001, elapsedMs / 1000)};
}

if (typeof self !== 'undefined' && typeof document === 'undefined') {
  self.onmessage = async ({data}) => {
    const {jobId, options} = data;
    const send = value => self.postMessage({jobId, ...value});
    try {
      send({type:'calibration', result:await calibrate(options)});
      for (const method of ['dictionary','pattern','brute']) {
        send({type:'start', method});
        const result = await searchCPU({...options, method}, progress => send({type:'progress', ...progress}));
        send({type:'result', result});
      }
      send({type:'done'});
    } catch (error) { send({type:'error', message:error.message || '探索を実行できませんでした。'}); }
  };
}
