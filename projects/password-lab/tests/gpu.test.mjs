import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { detectGPU, runGPU } from '../gpu.js';

const hash = text => createHash('sha256').update(text).digest('hex');
const input = (password = '07') => ({
  alphabet: '0123456789', length: 2, salt: 'lab-salt',
  targetHash: hash(`lab-salt${password}`), maxAttempts: 100, timeLimitMs: 1000,
});

async function withNavigator(value, action) {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value });
  try { return await action(); }
  finally {
    if (before) Object.defineProperty(globalThis, 'navigator', before);
    else delete globalThis.navigator;
  }
}

// A deterministic fake device tests host orchestration and byte layouts. It
// deliberately does not claim to execute or validate WGSL on actual hardware.
function fakeGPU({ compilationError = false, badSelfTest = false, scopeError = false } = {}) {
  const state = { configWrites: [], destroyed: 0, bufferDestroyed: 0, scopes: [] };
  const usageBefore = Object.getOwnPropertyDescriptor(globalThis, 'GPUBufferUsage');
  const mapBefore = Object.getOwnPropertyDescriptor(globalThis, 'GPUMapMode');
  globalThis.GPUBufferUsage = { STORAGE: 1, COPY_DST: 2, COPY_SRC: 4, MAP_READ: 8 };
  globalThis.GPUMapMode = { READ: 1 };
  const device = {
    lost: new Promise(() => {}),
    pushErrorScope(type) { state.scopes.push(type); },
    async popErrorScope() { state.scopes.pop(); return scopeError ? { message: 'test validation error' } : null; },
    destroy() { state.destroyed++; },
    createShaderModule({ code }) {
      state.shader = code;
      return { async getCompilationInfo() { return { messages: compilationError ? [{ type: 'error' }] : [] }; } };
    },
    async createComputePipelineAsync() { return { getBindGroupLayout() { return {}; } }; },
    createBuffer({ size }) {
      const raw = new ArrayBuffer(size);
      return { raw, async mapAsync() {}, getMappedRange() { return raw; }, unmap() {}, destroy() { state.bufferDestroyed++; } };
    },
    createBindGroup({ entries }) { return entries.map(entry => entry.resource.buffer); },
    createCommandEncoder() {
      let group;
      const operations = [];
      return {
        beginComputePass() {
          return { setPipeline() {}, setBindGroup(_index, value) { group = value; }, dispatchWorkgroups() {
            operations.push(() => {
              const config = new Uint32Array(group[0].raw);
              const alphabet = String.fromCharCode(...config.slice(20, 20 + config[2]));
              const salt = String.fromCharCode(...config.slice(4, 12));
              const target = [...config.slice(12, 20)].map(n => n.toString(16).padStart(8, '0')).join('');
              state.configWrites.push({ start: config[0], count: config[1], length: config[3], alphabet, salt, target });
              let match = 0xffffffff;
              if (!badSelfTest) for (let i = config[0]; i < config[0] + config[1]; i++) {
                let value = BigInt(i);
                const chars = Array(config[3]);
                for (let j = config[3] - 1; j >= 0; j--) {
                  chars[j] = alphabet[Number(value % BigInt(alphabet.length))];
                  value /= BigInt(alphabet.length);
                }
                if (hash(salt + chars.join('')) === target) { match = i; break; }
              }
              new Uint32Array(group[1].raw)[0] = match;
            });
          }, end() {} };
        },
        copyBufferToBuffer(source, _sourceOffset, destination) {
          operations.push(() => new Uint8Array(destination.raw).set(new Uint8Array(source.raw)));
        },
        finish() { return operations; },
      };
    },
    queue: {
      writeBuffer(buffer, offset, data) {
        new Uint8Array(buffer.raw, offset, data.byteLength).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      },
      submit(commandLists) { for (const commands of commandLists) for (const operation of commands) operation(); },
    },
  };
  return {
    state,
    navigator: { gpu: { async requestAdapter() { return { info: { description: 'Test adapter', isFallbackAdapter: true }, async requestDevice() { return device; } }; } } },
    restore() {
      if (usageBefore) Object.defineProperty(globalThis, 'GPUBufferUsage', usageBefore); else delete globalThis.GPUBufferUsage;
      if (mapBefore) Object.defineProperty(globalThis, 'GPUMapMode', mapBefore); else delete globalThis.GPUMapMode;
    },
  };
}

test('unsupported GPU returns no invented throughput and leaves CPU usable', async () => {
  await withNavigator({}, async () => {
    assert.equal((await detectGPU()).available, false);
    const result = await runGPU(input());
    assert.equal(result.status, 'unavailable');
    assert.equal(result.attempts, 0);
    assert.equal(result.rate, 0);
  });
});

test('null adapter and requestDevice rejection are supported unavailability outcomes', async () => {
  for (const gpu of [
    { async requestAdapter() { return null; } },
    { async requestAdapter() { return { async requestDevice() { throw Error('no device'); } }; } },
  ]) await withNavigator({ gpu }, async () => {
    assert.equal((await detectGPU()).available, false);
    assert.equal((await runGPU(input())).status, 'unavailable');
  });
});

test('fallback adapter label does not claim physical GPU hardware', async () => {
  const fake = fakeGPU();
  try {
    await withNavigator(fake.navigator, async () => {
      const detected = await detectGPU();
      assert.equal(detected.available, true);
      assert.match(detected.label, /フォールバック実装/);
      assert.equal(fake.state.destroyed, 1);
    });
  } finally { fake.restore(); }
});

test('GPU host layout and warm-ups find exact salted candidate and count the whole completed batch', async () => {
  const fake = fakeGPU();
  try {
    await withNavigator(fake.navigator, async () => {
      const progress = [];
      const result = await runGPU({ ...input(), onProgress: value => progress.push(value) });
      assert.equal(result.status, 'found');
      assert.equal(result.foundCandidate, '07');
      assert.equal(result.foundIndex, 7);
      assert.equal(result.rankAttempts, 8);
      assert.equal(result.attempts, 100);
      assert.ok(result.setupMs >= 0);
      assert.equal(progress.length, 1);
      assert.equal(fake.state.configWrites.length, 4); // Three on-device known-answer checks.
      assert.equal(fake.state.configWrites.at(-1).target, input().targetHash);
      assert.equal(fake.state.configWrites.at(-1).salt, 'lab-salt');
      assert.equal(fake.state.bufferDestroyed, 3);
      assert.equal(fake.state.destroyed, 1);
      assert.equal(fake.state.scopes.length, 0);
    });
  } finally { fake.restore(); }
});

test('attempt budget and exhaustion are distinct and include no target plaintext', async () => {
  for (const [budget, expected] of [[10, 'budget'], [100, 'found']]) {
    const fake = fakeGPU();
    try {
      await withNavigator(fake.navigator, async () => {
        const result = await runGPU({ ...input('99'), maxAttempts: budget });
        assert.equal(result.status, expected);
        assert.equal(result.attempts, budget);
      });
    } finally { fake.restore(); }
  }
  const fake = fakeGPU();
  try {
    await withNavigator(fake.navigator, async () => {
      const result = await runGPU({ ...input(), targetHash: hash('a different input'), maxAttempts: 100 });
      assert.equal(result.status, 'exhausted');
      assert.equal(result.attempts, 100);
    });
  } finally { fake.restore(); }
});

test('failed compilation, error scopes and failed known-answer tests never expose GPU throughput', async () => {
  for (const options of [{ compilationError: true }, { badSelfTest: true }, { scopeError: true }]) {
    const fake = fakeGPU(options);
    try {
      await withNavigator(fake.navigator, async () => {
        const result = await runGPU(input());
        assert.equal(result.status, 'unavailable');
        assert.equal(result.attempts, 0);
        assert.equal(result.rate, 0);
        assert.equal(fake.state.destroyed, 1);
      });
    } finally { fake.restore(); }
  }
});

test('cancelled signal does not initialise GPU', async () => {
  await withNavigator({ gpu: { requestAdapter() { throw Error('must not initialise'); } } }, async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runGPU({ ...input(), signal: controller.signal });
    assert.equal(result.status, 'cancelled');
    assert.equal(result.attempts, 0);
  });
});

test('rejects unsupported message lengths, duplicate or non-ASCII alphabets and malformed digests', async () => {
  for (const invalid of [{ length: 0 }, { length: 33 }, { alphabet: '001' }, { alphabet: 'あ' }, { salt: 'short' }, { targetHash: 'abc' }, { maxAttempts: 0 }]) {
    await assert.rejects(runGPU({ ...input(), ...invalid }));
  }
});
