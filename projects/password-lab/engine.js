/**
 * Password Lab: small, local, offline-search teaching model.
 *
 * SHA-256 here is a real hash, but one SHA-256 operation is deliberately cheap.
 * It is not an appropriate password-storage scheme. Real services also differ
 * in hashing costs, authentication limits and other protections.
 */

export const SETS = Object.freeze({
  digits: '0123456789',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  symbols: '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~',
});

const GROUPS = Object.keys(SETS);
const MAX_LENGTH = 32;

function assertLength(length) {
  if (!Number.isInteger(length) || length < 1 || length > MAX_LENGTH) {
    throw new RangeError('文字数は1〜32の整数にしてください。');
  }
}

function assertAlphabet(alphabet) {
  if (typeof alphabet !== 'string' || alphabet.length === 0) {
    throw new TypeError('使える文字を1種類以上選んでください。');
  }
  if (!/^[!-~]+$/.test(alphabet)) {
    throw new TypeError('この教材では空白を除く半角英数字・記号を使います。');
  }
  if (new Set(alphabet).size !== alphabet.length) {
    throw new TypeError('文字集合に同じ文字を重複させないでください。');
  }
}

/** Selected groups always use the documented digits/lower/upper/symbols order. */
export function buildAlphabet(groups) {
  let selected;
  if (Array.isArray(groups)) {
    if (groups.some((key) => !GROUPS.includes(key))) {
      throw new TypeError('不明な文字の種類が指定されています。');
    }
    selected = new Set(groups);
  } else if (groups && typeof groups === 'object') {
    if (Object.keys(groups).some((key) => !GROUPS.includes(key))) {
      throw new TypeError('不明な文字の種類が指定されています。');
    }
    selected = new Set(GROUPS.filter((key) => Boolean(groups[key])));
  } else {
    throw new TypeError('使える文字の種類を指定してください。');
  }
  const alphabet = GROUPS.filter((key) => selected.has(key)).map((key) => SETS[key]).join('');
  assertAlphabet(alphabet);
  return alphabet;
}

const ALL_CHARACTERS = buildAlphabet(GROUPS);
const STRUCTURE_GROUPS = Object.freeze({
  ...SETS,
  letters: SETS.lower + SETS.upper,
  alnum: SETS.digits + SETS.lower + SETS.upper,
  all: ALL_CHARACTERS,
  none: '',
});
const GROUP_LABELS = Object.freeze({
  digits: '数字', lower: '英小文字', upper: '英大文字',
  letters: '英字', alnum: '英数字', symbols: '記号', all: '半角英数字・記号',
});

function assertFixedText(text) {
  if (typeof text !== 'string' || (text.length > 0 && !/^[!-~]+$/.test(text))) {
    throw new TypeError('決まっている部分は空白を除く半角英数字・記号で入力してください。');
  }
}

function lengthSpace(alphabet, minimum, maximum) {
  let total = 0n;
  for (let length = minimum; length <= maximum; length += 1) {
    total += BigInt(alphabet.length) ** BigInt(length);
  }
  return total;
}

/** Build assumptions from attacker input only, never from the target password. */
export function buildAttackPlan(config = {}) {
  const knowledge = config.knowledge ?? 'none';
  if (!['none', 'charset', 'structure'].includes(knowledge)) {
    throw new TypeError('探索側が知っている情報を選んでください。');
  }
  if (knowledge === 'structure') {
    const prefix = config.prefix ?? '';
    const suffix = config.suffix ?? '';
    assertFixedText(prefix);
    assertFixedText(suffix);
    const positions = [...prefix];
    const descriptions = prefix ? [prefix] : [];
    for (const part of ['first', 'second']) {
      const group = config[`${part}Group`] ?? 'none';
      if (!Object.hasOwn(STRUCTURE_GROUPS, group)) {
        throw new TypeError('不明な文字の種類が指定されています。');
      }
      // An unused part contributes no characters, even if an inactive UI field
      // retains its previous count.
      if (group === 'none') continue;
      const count = config[`${part}Count`] ?? 0;
      if (!Number.isInteger(count) || count < 0 || count > MAX_LENGTH) {
        throw new RangeError('各部分の文字数は0〜32の整数にしてください。');
      }
      for (let index = 0; index < count; index += 1) positions.push(STRUCTURE_GROUPS[group]);
      if (count) descriptions.push(`${GROUP_LABELS[group]}${count}文字`);
    }
    positions.push(...suffix);
    assertLength(positions.length);
    if (suffix) descriptions.push(suffix);
    const alphabet = [...ALL_CHARACTERS].filter(character => positions.some(set => set.includes(character))).join('');
    return {
      kind: knowledge, alphabet, minLength: positions.length, maxLength: positions.length,
      positions, summary: descriptions.join(' ＋ '),
      candidateCount: positions.reduce((total, set) => total * BigInt(set.length), 1n),
    };
  }
  // Unknown information stays unknown: hidden character/length fields are not
  // consulted in the `none` branch.
  const alphabet = knowledge === 'none' ? ALL_CHARACTERS : buildAlphabet(config.groups ?? []);
  const fixedLength = knowledge === 'charset' && config.lengthKnown === true;
  const maximum = fixedLength ? config.length : (config.maxLength ?? 8);
  assertLength(maximum);
  const minimum = fixedLength ? maximum : 1;
  const characterSummary = knowledge === 'none' ? '文字の種類は不明' : GROUPS.filter(key => alphabet.includes(SETS[key])).map(key => GROUP_LABELS[key]).join('・');
  return {
    kind: knowledge, alphabet, minLength: minimum, maxLength: maximum, positions: null,
    summary: `${characterSummary}、${fixedLength ? maximum : `1〜${maximum}`}文字を探索`,
    candidateCount: lengthSpace(alphabet, minimum, maximum),
  };
}

function assertAttackPlan(plan) {
  if (!plan || !['none', 'charset', 'structure'].includes(plan.kind)) {
    throw new TypeError('探索条件を指定してください。');
  }
  assertAlphabet(plan.alphabet);
  assertLength(plan.minLength);
  assertLength(plan.maxLength);
  if (plan.minLength > plan.maxLength) throw new RangeError('探索する文字数の範囲が不正です。');
  if (plan.kind === 'structure') {
    if (!Array.isArray(plan.positions) || plan.positions.length !== plan.maxLength || plan.minLength !== plan.maxLength) {
      throw new TypeError('決まっている部分の探索条件が不正です。');
    }
    for (const set of plan.positions) assertAlphabet(set);
  } else if (plan.positions !== null) {
    throw new TypeError('文字集合による探索条件が不正です。');
  }
}

export function planSearchSpace(plan) {
  assertAttackPlan(plan);
  return plan.kind === 'structure'
    ? plan.positions.reduce((total, set) => total * BigInt(set.length), 1n)
    : lengthSpace(plan.alphabet, plan.minLength, plan.maxLength);
}

/** Mixed-radix candidate generation also handles fixed prefix/suffix positions. */
export function candidateFromPositions(index, positions) {
  if (!Array.isArray(positions)) throw new TypeError('位置ごとの文字集合を指定してください。');
  assertLength(positions.length);
  for (const set of positions) assertAlphabet(set);
  const total = positions.reduce((count, set) => count * BigInt(set.length), 1n);
  if (typeof index === 'number') {
    if (!Number.isSafeInteger(index)) throw new TypeError('候補番号は正確な整数で指定してください。');
    index = BigInt(index);
  }
  if (typeof index !== 'bigint' || index < 0n || index >= total) throw new RangeError('候補番号が探索範囲の外です。');
  const characters = Array(positions.length);
  for (let position = positions.length - 1; position >= 0; position -= 1) {
    const set = positions[position];
    characters[position] = set[Number(index % BigInt(set.length))];
    index /= BigInt(set.length);
  }
  return characters.join('');
}

function candidateFitsPlan(candidate, plan) {
  if (candidate.length < plan.minLength || candidate.length > plan.maxLength) return false;
  if (plan.kind === 'structure') return [...candidate].every((character, index) => plan.positions[index].includes(character));
  return [...candidate].every(character => plan.alphabet.includes(character));
}

/** Shorter unknown lengths are enumerated first, without consulting a target. */
export function* attackCandidates(method, plan) {
  assertAttackPlan(plan);
  if (method === 'brute' || method === 'structure') {
    if (method === 'structure' && plan.kind !== 'structure') throw new TypeError('決まっている部分の探索条件を指定してください。');
    if (plan.kind === 'structure') {
      const total = planSearchSpace(plan);
      for (let index = 0n; index < total; index += 1n) yield candidateFromPositions(index, plan.positions);
    } else {
      for (let length = plan.minLength; length <= plan.maxLength; length += 1) {
        const total = searchSpace(plan.alphabet, length);
        for (let index = 0n; index < total; index += 1n) yield candidateAt(index, plan.alphabet, length);
      }
    }
    return;
  }
  const candidates = method === 'dictionary' ? DICTIONARY : method === 'pattern' ? PATTERNS : null;
  if (candidates === null) throw new TypeError('不明な探索方法です。');
  for (const candidate of candidates) if (candidateFitsPlan(candidate, plan)) yield candidate;
}

/** The input is never trimmed, normalised or silently shortened. */
export function validatePassword(password, alphabet) {
  try {
    assertAlphabet(alphabet);
    if (typeof password !== 'string') throw new TypeError('練習用パスワードを入力してください。');
    assertLength(password.length);
    if ([...password].some((character) => !alphabet.includes(character))) {
      throw new TypeError('入力に、選んだ文字集合に含まれない文字があります。');
    }
    return { ok: true, error: '', length: password.length };
  } catch (error) {
    return { ok: false, error: error.message, length: typeof password === 'string' ? password.length : 0 };
  }
}

/**
 * Uniform sampling from allowed characters, with rejection to avoid modulo bias.
 * Selecting a character group permits it; it does not require an occurrence.
 */
export function generatePassword(length, alphabet, random = globalThis.crypto) {
  assertLength(length);
  assertAlphabet(alphabet);
  if (!random || typeof random.getRandomValues !== 'function') {
    throw new Error('安全な乱数を利用できません。HTTPSでページを開いてください。');
  }
  const limit = 256 - (256 % alphabet.length);
  const bytes = new Uint8Array(Math.max(32, length * 2));
  let password = '';
  // A broken injected random source must not freeze the teaching interface.
  for (let batches = 0; password.length < length && batches < 10000; batches += 1) {
    random.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte < limit) password += alphabet[byte % alphabet.length];
      if (password.length === length) break;
    }
  }
  if (password.length !== length) throw new Error('乱数の生成を完了できませんでした。');
  return password;
}

export function searchSpace(alphabet, length) {
  assertAlphabet(alphabet);
  assertLength(length);
  return BigInt(alphabet.length) ** BigInt(length);
}

/** Zero-based position in fixed-length, left-to-right enumeration. */
export function rankPassword(password, alphabet) {
  const validation = validatePassword(password, alphabet);
  if (!validation.ok) throw new TypeError(validation.error);
  const base = BigInt(alphabet.length);
  let rank = 0n;
  for (const character of password) rank = rank * base + BigInt(alphabet.indexOf(character));
  return rank;
}

/** Exact inverse of rankPassword, including leading zero-like characters. */
export function candidateAt(index, alphabet, length) {
  const total = searchSpace(alphabet, length);
  if (typeof index === 'number') {
    if (!Number.isSafeInteger(index)) throw new TypeError('候補番号は正確な整数で指定してください。');
    index = BigInt(index);
  }
  if (typeof index !== 'bigint' || index < 0n || index >= total) {
    throw new RangeError('候補番号が探索範囲の外です。');
  }
  const base = BigInt(alphabet.length);
  const characters = Array(length);
  for (let position = length - 1; position >= 0; position -= 1) {
    characters[position] = alphabet[Number(index % base)];
    index /= base;
  }
  return characters.join('');
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const SHA256_INITIAL = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const encoder = new TextEncoder();
const rotateRight = (word, bits) => (word >>> bits) | (word << (32 - bits));

/** FIPS SHA-256 over UTF-8, returned as 64 lower-case hexadecimal characters. */
export function sha256(text) {
  if (typeof text !== 'string') throw new TypeError('照合する文字列を指定してください。');
  const input = encoder.encode(text);
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(input);
  bytes[input.length] = 0x80;
  const view = new DataView(bytes.buffer);
  const bitLength = BigInt(input.length) * 8n;
  view.setUint32(paddedLength - 8, Number(bitLength >> 32n), false);
  view.setUint32(paddedLength - 4, Number(bitLength & 0xffffffffn), false);
  const state = SHA256_INITIAL.slice();
  const words = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) words[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const x = words[i - 15];
      const y = words[i - 2];
      const sigma0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      const sigma1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
      words[i] = (words[i - 16] + sigma0 + words[i - 7] + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let i = 0; i < 64; i += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choose + SHA256_K[i] + words[i]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    for (const [i, value] of [a, b, c, d, e, f, g, h].entries()) state[i] = (state[i] + value) >>> 0;
  }
  return state.map((word) => word.toString(16).padStart(8, '0')).join('');
}

export function hashCandidate(salt, candidate) {
  if (typeof salt !== 'string' || typeof candidate !== 'string') throw new TypeError('saltと候補は文字列で指定してください。');
  return sha256(salt + candidate);
}

// Intentionally small teaching examples, not a leaked-password database.
const DICTIONARY = Object.freeze([
  '123456', 'password', '123456789', '12345678', '12345', 'qwerty', 'abc123', '111111',
  '123123', 'admin', 'letmein', 'welcome', 'iloveyou', 'monkey', 'dragon', 'football',
  'baseball', 'sunshine', 'princess', 'master', 'hello', 'computer', 'secret', 'login',
  'guest', 'test', 'pass', 'love', 'password1', 'Password1', 'Password123!', 'Qwerty123!',
  '000000', '654321', '0000', '1111', '1234', '4321', '2026', '1212', '7777', '9999',
  'asdfgh', 'zxcvbn', 'qwertyuiop', '1qaz2wsx', '1q2w3e4r', 'p@ssword', 'P@ssw0rd',
  'P@ssw0rd!', 'changeme', 'welcome1', 'Welcome1!', 'student', 'science', 'japan', 'tokyo',
  'sakura', 'summer', 'winter', 'music', 'coffee', 'orange', 'banana', 'apple', 'superman',
]);

export function dictionaryCandidates() {
  return [...DICTIONARY];
}

function createPatterns() {
  const candidates = [];
  // Repeated characters and number/keyboard runs of several lengths.
  for (let length = 1; length <= 16; length += 1) {
    for (const character of '0123456789abcdefghijklmnopqrstuvwxyz') candidates.push(character.repeat(length));
    for (const row of ['01234567890123456789', '12345678901234567890', '98765432109876543210', 'qwertyuiopasdfghjklzxcvbnm', 'abcdefghijklmnopqrstuvwxyz']) {
      candidates.push(row.slice(0, length));
    }
  }
  // Common constructions: word + short number, year, or punctuation.
  const suffixes = ['', '!', '?', '123', '123!', '1234', '12345', '01', '12', '99'];
  for (let year = 2000; year <= 2030; year += 1) suffixes.push(String(year), `${year}!`);
  for (let number = 0; number <= 99; number += 1) suffixes.push(String(number));
  for (const word of ['password', 'welcome', 'student', 'science', 'sakura', 'coffee', 'summer', 'winter', 'music', 'hello', 'admin', 'qwerty']) {
    const variants = [word, word[0].toUpperCase() + word.slice(1), word.toUpperCase()];
    for (const variant of variants) for (const suffix of suffixes) candidates.push(variant + suffix);
  }
  return Object.freeze([...new Set(candidates)]);
}

const PATTERNS = createPatterns();

export function patternCandidates() {
  return [...PATTERNS];
}

/**
 * All methods use the same attacker assumptions: known fixed length + alphabet.
 * A finite dictionary/rule list can be exhausted without exhausting the space.
 */
export function* methodCandidates(method, alphabet, length) {
  const total = searchSpace(alphabet, length);
  if (method === 'brute') {
    for (let index = 0n; index < total; index += 1n) yield candidateAt(index, alphabet, length);
    return;
  }
  const candidates = method === 'dictionary' ? DICTIONARY : method === 'pattern' ? PATTERNS : null;
  if (candidates === null) throw new TypeError('不明な探索方法です。');
  for (const candidate of candidates) {
    if (candidate.length === length && [...candidate].every((character) => alphabet.includes(character))) yield candidate;
  }
}

/** count is explicit: average, whole space, rank+1 or remaining attempts. */
export function estimateSeconds(count, rate) {
  if (typeof count !== 'bigint' || count < 0n) throw new TypeError('試行数は0以上のBigIntで指定してください。');
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) throw new TypeError('処理速度は正の有限値で指定してください。');
  return Number(count) / rate;
}
