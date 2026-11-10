// Optional WebGPU backend for the classroom's local, bounded SHA-256 experiment.
// Only printable ASCII, an eight-byte salt and one SHA-256 block are supported.
// This is deliberately not an interface for accounts, remote services or hash files.
const BATCH_SIZE = 4096;
const MAX_ATTEMPTS = 1_000_000;
const NOT_FOUND = 0xffffffff;

const SHADER = /* wgsl */ `
@group(0) @binding(0) var<storage, read> config: array<u32>;
@group(0) @binding(1) var<storage, read_write> result: atomic<u32>;

const K = array<u32, 64>(
  0x428a2f98u,0x71374491u,0xb5c0fbcfu,0xe9b5dba5u,0x3956c25bu,0x59f111f1u,0x923f82a4u,0xab1c5ed5u,
  0xd807aa98u,0x12835b01u,0x243185beu,0x550c7dc3u,0x72be5d74u,0x80deb1feu,0x9bdc06a7u,0xc19bf174u,
  0xe49b69c1u,0xefbe4786u,0x0fc19dc6u,0x240ca1ccu,0x2de92c6fu,0x4a7484aau,0x5cb0a9dcu,0x76f988dau,
  0x983e5152u,0xa831c66du,0xb00327c8u,0xbf597fc7u,0xc6e00bf3u,0xd5a79147u,0x06ca6351u,0x14292967u,
  0x27b70a85u,0x2e1b2138u,0x4d2c6dfcu,0x53380d13u,0x650a7354u,0x766a0abbu,0x81c2c92eu,0x92722c85u,
  0xa2bfe8a1u,0xa81a664bu,0xc24b8b70u,0xc76c51a3u,0xd192e819u,0xd6990624u,0xf40e3585u,0x106aa070u,
  0x19a4c116u,0x1e376c08u,0x2748774cu,0x34b0bcb5u,0x391c0cb3u,0x4ed8aa4au,0x5b9cca4fu,0x682e6ff3u,
  0x748f82eeu,0x78a5636fu,0x84c87814u,0x8cc70208u,0x90befffau,0xa4506cebu,0xbef9a3f7u,0xc67178f2u
);
fn rotr(x: u32, n: u32) -> u32 { return (x >> n) | (x << (32u - n)); }

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= config[1]) { return; }
  let candidateIndex = config[0] + gid.x;
  let alphabetSize = config[2];
  let passwordLength = config[3];
  var w: array<u32, 64>;
  for (var i = 0u; i < 64u; i += 1u) { w[i] = 0u; }
  for (var i = 0u; i < 8u; i += 1u) {
    w[i / 4u] |= config[4u + i] << (24u - 8u * (i % 4u));
  }
  var remainder = candidateIndex;
  for (var i = 0u; i < passwordLength; i += 1u) {
    let position = 8u + passwordLength - 1u - i;
    let character = config[20u + remainder % alphabetSize];
    remainder /= alphabetSize;
    w[position / 4u] |= character << (24u - 8u * (position % 4u));
  }
  let messageLength = 8u + passwordLength;
  w[messageLength / 4u] |= 0x80u << (24u - 8u * (messageLength % 4u));
  w[15] = messageLength * 8u;
  for (var i = 16u; i < 64u; i += 1u) {
    let s0 = rotr(w[i - 15u], 7u) ^ rotr(w[i - 15u], 18u) ^ (w[i - 15u] >> 3u);
    let s1 = rotr(w[i - 2u], 17u) ^ rotr(w[i - 2u], 19u) ^ (w[i - 2u] >> 10u);
    w[i] = w[i - 16u] + s0 + w[i - 7u] + s1;
  }
  var a = 0x6a09e667u; var b = 0xbb67ae85u; var c = 0x3c6ef372u; var d = 0xa54ff53au;
  var e = 0x510e527fu; var f = 0x9b05688cu; var g = 0x1f83d9abu; var h = 0x5be0cd19u;
  for (var i = 0u; i < 64u; i += 1u) {
    let s1 = rotr(e, 6u) ^ rotr(e, 11u) ^ rotr(e, 25u);
    let choice = (e & f) ^ (~e & g);
    let t1 = h + s1 + choice + K[i] + w[i];
    let s0 = rotr(a, 2u) ^ rotr(a, 13u) ^ rotr(a, 22u);
    let majority = (a & b) ^ (a & c) ^ (b & c);
    let t2 = s0 + majority;
    h = g; g = f; f = e; e = d + t1;
    d = c; c = b; b = a; a = t1 + t2;
  }
  if (a + 0x6a09e667u != config[12] || b + 0xbb67ae85u != config[13] ||
      c + 0x3c6ef372u != config[14] || d + 0xa54ff53au != config[15] ||
      e + 0x510e527fu != config[16] || f + 0x9b05688cu != config[17] ||
      g + 0x1f83d9abu != config[18] || h + 0x5be0cd19u != config[19]) { return; }
  atomicMin(&result, candidateIndex);
}
`;

function gpuAPI() {
  return typeof navigator !== 'undefined' ? navigator.gpu : undefined;
}

function unavailable(reason) {
  return { available: false, label: 'WebGPU', reason };
}

function deviceLabel(adapter) {
  const info = adapter.info;
  // Adapter details vary by browser; do not claim a device model when omitted.
  const name = info?.description || info?.device || 'WebGPU';
  const fallback = info?.isFallbackAdapter ?? adapter.isFallbackAdapter;
  return fallback === true ? `${name}（フォールバック実装）` : name;
}

export async function detectGPU() {
  if (!gpuAPI()) return unavailable('このブラウザではWebGPUを利用できません。CPUで実行できます。');
  let device;
  try {
    const adapter = await gpuAPI().requestAdapter();
    if (!adapter) return unavailable('利用できるGPUが見つかりません。CPUで実行できます。');
    device = await adapter.requestDevice();
    return { available: true, label: deviceLabel(adapter), reason: '' };
  } catch {
    return unavailable('GPUの準備ができませんでした。CPUで実行できます。');
  } finally {
    device?.destroy();
  }
}

function validate({ alphabet, length, salt, targetHash }) {
  if (typeof alphabet !== 'string' || !/^[\x21-\x7e]+$/.test(alphabet) ||
      new Set(alphabet).size !== alphabet.length) {
    throw new TypeError('alphabet must contain unique printable ASCII characters.');
  }
  if (!Number.isInteger(length) || length < 1 || length > 32) {
    throw new RangeError('length must be an integer from 1 to 32.');
  }
  if (typeof salt !== 'string' || !/^[\x20-\x7e]{8}$/.test(salt)) {
    throw new TypeError('salt must contain exactly eight printable ASCII characters.');
  }
  if (typeof targetHash !== 'string' || !/^[a-fA-F0-9]{64}$/.test(targetHash)) {
    throw new TypeError('targetHash must be a SHA-256 hexadecimal digest.');
  }
}

function configFor(alphabet, length, salt, targetHash) {
  const config = new Uint32Array(20 + alphabet.length);
  config[2] = alphabet.length;
  config[3] = length;
  for (let i = 0; i < 8; i++) {
    config[4 + i] = salt.charCodeAt(i);
    config[12 + i] = Number.parseInt(targetHash.slice(i * 8, i * 8 + 8), 16);
  }
  for (let i = 0; i < alphabet.length; i++) config[20 + i] = alphabet.charCodeAt(i);
  return config;
}

function candidateAt(index, alphabet, length) {
  let n = BigInt(index);
  const base = BigInt(alphabet.length);
  const characters = Array(length);
  for (let i = length - 1; i >= 0; i--) {
    characters[i] = alphabet[Number(n % base)];
    n /= base;
  }
  return characters.join('');
}

// A bounded, complete batch is measured: attempts includes every invocation in
// the matching batch, rather than pretending later GPU invocations were skipped.
export async function runGPU({
  alphabet, length, salt, targetHash, maxAttempts = MAX_ATTEMPTS,
  timeLimitMs = 1500, onProgress, signal,
}) {
  validate({ alphabet, length, salt, targetHash });
  if (!Number.isFinite(maxAttempts) || maxAttempts < 1 || !Number.isFinite(timeLimitMs) || timeLimitMs <= 0) {
    throw new RangeError('A positive finite attempt and time budget is required.');
  }
  const limit = Math.min(MAX_ATTEMPTS, Math.floor(maxAttempts));
  const timeBudget = Math.min(5000, timeLimitMs);
  const total = BigInt(alphabet.length) ** BigInt(length);
  const toCheck = Number(total < BigInt(limit) ? total : BigInt(limit));
  let attempts = 0;
  let searchStarted;
  const preparationStarted = performance.now();
  let label = 'WebGPU';
  let device;
  const buffers = [];
  const stats = () => {
    const elapsedMs = searchStarted === undefined ? 0 : performance.now() - searchStarted;
    return { attempts, elapsedMs, rate: elapsedMs > 0 ? attempts * 1000 / elapsedMs : 0, label };
  };
  if (signal?.aborted) return { status: 'cancelled', ...stats(), setupMs: 0 };
  if (!gpuAPI()) return { status: 'unavailable', ...stats(), error: 'WebGPUを利用できません。CPUで実行できます。' };
  try {
    const adapter = await gpuAPI().requestAdapter();
    if (!adapter) throw new Error('No usable GPU adapter.');
    label = deviceLabel(adapter);
    device = await adapter.requestDevice();
    let lost = false;
    device.lost.then(() => { lost = true; });
    const checked = async action => {
      device.pushErrorScope('validation');
      device.pushErrorScope('out-of-memory');
      try {
        const value = await action();
        if (lost) throw new Error('GPU device was lost.');
        return value;
      } finally {
        const memoryError = await device.popErrorScope();
        const validationError = await device.popErrorScope();
        if (memoryError || validationError) throw new Error('GPU validation or memory error.');
      }
    };
    const { pipeline, configBuffer, resultBuffer, readback, group } = await checked(async () => {
      const shader = device.createShaderModule({ code: SHADER });
      if (shader.getCompilationInfo) {
        const compilation = await shader.getCompilationInfo();
        if (compilation.messages.some(message => message.type === 'error')) {
          throw new Error('The SHA-256 shader could not be compiled.');
        }
      }
      const pipeline = await device.createComputePipelineAsync({
        layout: 'auto', compute: { module: shader, entryPoint: 'main' },
      });
      const configBuffer = device.createBuffer({
        size: 4 * (20 + 94), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      buffers.push(configBuffer);
      const resultBuffer = device.createBuffer({
        size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      });
      buffers.push(resultBuffer);
      const readback = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      buffers.push(readback);
      const group = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: configBuffer } }, { binding: 1, resource: { buffer: resultBuffer } }],
      });
      return { pipeline, configBuffer, resultBuffer, readback, group };
    });
    const dispatch = async (config, start, count) => {
      config[0] = start;
      config[1] = count;
      device.queue.writeBuffer(configBuffer, 0, config);
      device.queue.writeBuffer(resultBuffer, 0, new Uint32Array([NOT_FOUND]));
      const commands = device.createCommandEncoder();
      const pass = commands.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(Math.ceil(count / 64));
      pass.end();
      commands.copyBufferToBuffer(resultBuffer, 0, readback, 0, 4);
      device.queue.submit([commands.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const found = new Uint32Array(readback.getMappedRange())[0];
      readback.unmap();
      return found;
    };

    // Small independent known-answer tests run on the actual device. Compilation
    // and these warm-ups are excluded from the displayed search throughput.
    const checks = [
      ['0123456789', 2, 'd65bef6c21cec1279a38471483f374030b0eee7a92550f08514cf06b429dfa09', 0, 10, 7],
      ['0123456789', 2, 'dbadfd6e29d4bff2266cf92f53fafcfd851ea126b0d78a2e467e5a521a05ca68', 0, 10, NOT_FOUND],
      ['az', 32, '34b1be596c0eb467b58ebbd930b8e3db65752d60336ff7893d6d8c3b68db5681', 0, 2, 1],
    ];
    for (const [characters, size, target, start, count, expected] of checks) {
      if (signal?.aborted) return { status: 'cancelled', ...stats(), setupMs: performance.now() - preparationStarted };
      const found = await checked(() => dispatch(configFor(characters, size, 'lab-salt', target), start, count));
      if (found !== expected) throw new Error('GPU SHA-256 self-test failed.');
    }
    const setupMs = performance.now() - preparationStarted;
    const config = configFor(alphabet, length, salt, targetHash);
    searchStarted = performance.now();
    while (attempts < toCheck && performance.now() - searchStarted < timeBudget) {
      if (signal?.aborted) return { status: 'cancelled', ...stats(), setupMs };
      const start = attempts;
      const count = Math.min(BATCH_SIZE, toCheck - start);
      const found = await checked(() => dispatch(config, start, count));
      attempts += count;
      onProgress?.({ ...stats(), total: total.toString(), limit: toCheck });
      if (found !== NOT_FOUND) {
        return { status: 'found', ...stats(), setupMs, foundCandidate: candidateAt(found, alphabet, length), foundIndex: found, rankAttempts: found + 1 };
      }
    }
    return { status: signal?.aborted ? 'cancelled' : BigInt(attempts) === total ? 'exhausted' : 'budget', ...stats(), setupMs };
  } catch {
    return { status: 'unavailable', ...stats(), error: 'GPUでの計算を完了できませんでした。CPUの結果をご覧ください。' };
  } finally {
    for (const buffer of buffers) buffer.destroy();
    device?.destroy();
  }
}
