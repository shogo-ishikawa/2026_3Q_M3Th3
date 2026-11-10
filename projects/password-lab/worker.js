import {hashCandidate, candidateAt, candidateFromPositions, searchSpace, planSearchSpace, attackCandidates} from './engine.js';

const encoder = new TextEncoder();
export async function digestCandidate(candidate, salt, mode = 'sha256') {
  if (mode === 'sha256') return hashCandidate(salt, candidate);
  if (mode !== 'pbkdf2') throw new Error('照合方式が不正です。');
  const key = await crypto.subtle.importKey('raw', encoder.encode(candidate), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2', hash:'SHA-256', salt:encoder.encode(salt), iterations:10000}, key, 256);
  return Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, '0')).join('');
}

function resolvePlan({plan, alphabet, length}) {
  const resolved = plan ?? {
    kind:'charset', alphabet, minLength:length, maxLength:length, positions:null,
    candidateCount:searchSpace(alphabet, length),
  };
  // Recompute and validate rather than trusting a supplied candidateCount.
  planSearchSpace(resolved);
  return resolved;
}

function estimateBasis(plan) {
  return plan.kind === 'structure'
    ? `指定した並びの${plan.maxLength}文字で測った速度`
    : `${plan.minLength === plan.maxLength ? '探索する' : '最大探索長の'}${plan.maxLength}文字で測った速度`;
}

export async function calibrate(options) {
  const {salt, mode} = options;
  const plan = resolvePlan(options);
  // 正解と比較しない別の計測です。発見した件数には含めません。
  const total = plan.kind === 'structure' ? planSearchSpace(plan) : searchSpace(plan.alphabet, plan.maxLength);
  let attempts = 0;
  const start = performance.now();
  do {
    const index = BigInt(attempts) % total;
    const candidate = plan.kind === 'structure'
      ? candidateFromPositions(index, plan.positions)
      : candidateAt(index, plan.alphabet, plan.maxLength);
    await digestCandidate(candidate, salt, mode);
    attempts++;
  } while (performance.now() - start < 180 && attempts < 100000);
  const elapsedMs = performance.now() - start;
  return {attempts, elapsedMs, rate:attempts / (elapsedMs / 1000), estimateBasis:estimateBasis(plan)};
}

export async function searchCPU(options, onProgress = () => {}) {
  const {method, salt, mode, targetHash, timeLimitMs = 2000, maxAttempts = 1000000} = options;
  if (!['dictionary','pattern','brute','structure'].includes(method)) throw new Error('探索方法が不正です。');
  const limit = Math.max(1, Math.min(5000, Number(timeLimitMs)));
  const cap = Math.max(1, Math.min(1000000, Math.floor(Number(maxAttempts))));
  if (!Number.isFinite(limit) || !Number.isFinite(cap)) throw new Error('上限が不正です。');
  const plan = resolvePlan(options);
  const start = performance.now();
  let attempts = 0;
  let lastUpdate = start;
  const measured = elapsedMs => ({method, attempts, elapsedMs,
    rate:attempts / Math.max(0.000001, elapsedMs / 1000),
    estimateBasis:'探索中に照合した候補全体の実測速度'});
  // A single budget covers the method's whole sequence, including every length.
  for (const candidate of attackCandidates(method, plan)) {
    if (attempts >= cap || performance.now() - start >= limit) {
      const elapsedMs = performance.now() - start;
      return {status:'budget', ...measured(elapsedMs)};
    }
    const actual = await digestCandidate(candidate, salt, mode);
    attempts++;
    if (actual === targetHash) {
      const elapsedMs = performance.now() - start;
      return {status:'found', ...measured(elapsedMs)};
    }
    if (performance.now() - lastUpdate > 90) {
      onProgress({method, attempts, elapsedMs:performance.now() - start});
      lastUpdate = performance.now();
    }
  }
  const elapsedMs = performance.now() - start;
  return {status:'exhausted', ...measured(elapsedMs)};
}

if (typeof self !== 'undefined' && typeof document === 'undefined') {
  self.onmessage = async ({data}) => {
    const {jobId, options} = data;
    const send = value => self.postMessage({jobId, ...value});
    try {
      send({type:'calibration', result:await calibrate(options)});
      const plan = resolvePlan(options);
      const methods = ['dictionary','pattern',plan.kind === 'structure' ? 'structure' : 'brute'];
      for (const method of methods) {
        send({type:'start', method});
        const result = await searchCPU({...options, method}, progress => send({type:'progress', ...progress}));
        send({type:'result', result});
      }
      send({type:'done'});
    } catch (error) { send({type:'error', message:error.message || '探索を実行できませんでした。'}); }
  };
}
