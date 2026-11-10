import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import {
  SETS, buildAlphabet, validatePassword, generatePassword, searchSpace,
  rankPassword, candidateAt, sha256, hashCandidate, dictionaryCandidates,
  patternCandidates, methodCandidates, estimateSeconds,
} from '../engine.js';

const all = buildAlphabet(['digits', 'lower', 'upper', 'symbols']);
const referenceHash = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

test('character groups cover exactly the 94 printable non-space ASCII characters', () => {
  assert.deepEqual(Object.values(SETS).map((set) => set.length), [10, 26, 26, 32]);
  assert.equal(all.length, 94);
  assert.equal(new Set(all).size, 94);
  const sorted = [...all].map((character) => character.charCodeAt(0)).sort((a, b) => a - b);
  assert.deepEqual(sorted, Array.from({ length: 94 }, (_, i) => i + 33));
});

test('selected group order is stable and invalid or empty selections fail', () => {
  assert.equal(buildAlphabet(['upper', 'digits', 'upper']), SETS.digits + SETS.upper);
  assert.equal(buildAlphabet({ lower: false, digits: true, symbols: false }), SETS.digits);
  assert.throws(() => buildAlphabet([]));
  assert.throws(() => buildAlphabet({}));
  assert.throws(() => buildAlphabet(['unknown']));
  assert.throws(() => buildAlphabet({ digits: true, unknown: true }));
});

test('input validation neither trims nor silently changes an unsupported password', () => {
  assert.deepEqual(validatePassword('Password123!', all), { ok: true, error: '', length: 12 });
  assert.equal(validatePassword('0', SETS.digits).ok, true);
  assert.equal(validatePassword('a'.repeat(32), all).ok, true);
  for (const password of ['', 'a'.repeat(33), ' 1234', '1234 ', '123\n', '全角123', '１２３', null]) {
    assert.equal(validatePassword(password, all).ok, false, String(password));
  }
  assert.equal(validatePassword('A123', SETS.digits).ok, false);
  assert.equal(validatePassword('123', '').ok, false);
});

test('generation rejects biased tail bytes before taking modulo', () => {
  let fills = 0;
  const random = {
    getRandomValues(bytes) {
      fills += 1;
      if (fills === 1) bytes.fill(255);
      else bytes.forEach((_, i) => { bytes[i] = i; });
      return bytes;
    },
  };
  assert.equal(generatePassword(10, SETS.digits, random), '0123456789');
  assert.equal(fills, 2, 'all rejected bytes must trigger a new random fill');
});

test('every accepted raw byte has exactly the same digit frequency', () => {
  const counts = Array(10).fill(0);
  for (let byte = 0; byte < 250; byte += 1) {
    const random = { getRandomValues: (bytes) => bytes.fill(byte) };
    const password = generatePassword(1, SETS.digits, random);
    counts[Number(password)] += 1;
  }
  assert.deepEqual(counts, Array(10).fill(25));
});

test('generation uses allowed characters without requiring every permitted group', () => {
  assert.equal(generatePassword(5, all, { getRandomValues: (bytes) => bytes.fill(0) }), '00000');
  const randomPassword = generatePassword(32, all, webcrypto);
  assert.equal(randomPassword.length, 32);
  assert.equal(validatePassword(randomPassword, all).ok, true);
  for (const length of [0, -1, 1.5, 33]) assert.throws(() => generatePassword(length, all, webcrypto));
  assert.throws(() => generatePassword(1, '00', webcrypto));
  assert.throws(() => generatePassword(1, all, {}));
});

test('candidate enumeration preserves padding and exact large ranks', () => {
  assert.equal(searchSpace(SETS.digits, 4), 10000n);
  assert.equal(candidateAt(0n, SETS.digits, 4), '0000');
  assert.equal(candidateAt(17n, SETS.digits, 4), '0017');
  assert.equal(candidateAt(9999n, SETS.digits, 4), '9999');
  assert.equal(rankPassword('0017', SETS.digits), 17n);
  assert.equal(searchSpace(all, 32), 94n ** 32n);
  assert.equal(rankPassword(all.at(-1).repeat(32), all), searchSpace(all, 32) - 1n);
  const highRank = searchSpace(all, 32) - 123456789n;
  assert.equal(rankPassword(candidateAt(highRank, all, 32), all), highRank);
});

test('enumeration agrees with independently listed binary triples', () => {
  const expected = ['aaa', 'aab', 'aba', 'abb', 'baa', 'bab', 'bba', 'bbb'];
  assert.deepEqual([...methodCandidates('brute', 'ab', 3)], expected);
  for (const [index, password] of expected.entries()) assert.equal(rankPassword(password, 'ab'), BigInt(index));
  assert.equal(candidateAt(0n, 'x', 32), 'x'.repeat(32));
});

test('invalid ranks, ranges and alphabets fail explicitly', () => {
  for (const index of [-1n, 100n, 1.1, Number.MAX_SAFE_INTEGER + 1, '1']) {
    assert.throws(() => candidateAt(index, SETS.digits, 2));
  }
  assert.throws(() => rankPassword('123X', SETS.digits));
  assert.throws(() => searchSpace('001', 3));
  assert.throws(() => searchSpace(' a', 3));
  assert.throws(() => searchSpace(SETS.digits, 0));
  assert.throws(() => [...methodCandidates('unknown', SETS.digits, 2)]);
});

test('SHA-256 matches the standard empty and abc vectors', () => {
  assert.equal(sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('SHA-256 matches Node crypto through padding boundaries and UTF-8 input', () => {
  const inputs = ['salt0000Password123!', 'こんにちは🔒', '\ud800', '\0a\0'];
  for (const length of [1, 7, 8, 31, 32, 40, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 5000]) {
    inputs.push('a'.repeat(length));
    inputs.push('é'.repeat(length));
  }
  for (const input of inputs) assert.equal(sha256(input), referenceHash(input), `UTF-8 bytes=${Buffer.byteLength(input)}`);
  assert.throws(() => sha256(undefined));
});

test('salted candidate matching distinguishes the salt and exact candidate', () => {
  const target = referenceHash('abcd12340017');
  assert.equal(hashCandidate('abcd1234', '0017'), target);
  assert.notEqual(hashCandidate('abcd1235', '0017'), target);
  assert.notEqual(hashCandidate('abcd1234', '17'), target);
  assert.throws(() => hashCandidate(null, '0017'));
});

test('finite candidate lists are independent, unique and do not expose mutable state', () => {
  const dictionary = dictionaryCandidates();
  const patterns = patternCandidates();
  assert.equal(dictionary.length, new Set(dictionary).size);
  assert.equal(patterns.length, new Set(patterns).size);
  assert.ok(dictionary.includes('Password123!'));
  assert.ok(dictionary.includes('123456'));
  assert.ok(patterns.includes('Science2026!'));
  assert.ok(patterns.includes('a'.repeat(16)));
  dictionary.splice(0, dictionary.length, 'changed');
  patterns[0] = 'changed';
  assert.ok(dictionaryCandidates().includes('password'));
  assert.notEqual(patternCandidates()[0], 'changed');
});

test('all methods respect the same known length and permitted alphabet', () => {
  for (const method of ['dictionary', 'pattern']) {
    const candidates = [...methodCandidates(method, SETS.digits, 4)];
    assert.ok(candidates.length > 0);
    assert.ok(candidates.every((candidate) => /^\d{4}$/.test(candidate)));
    assert.equal(candidates.length, new Set(candidates).size);
  }
  assert.ok([...methodCandidates('dictionary', all, 12)].includes('Password123!'));
  assert.equal([...methodCandidates('dictionary', SETS.lower, 12)].includes('Password123!'), false);
});

test('actual search finds a hash by testing candidates, separate from rank prediction', () => {
  const salt = 'salt0000';
  const target = referenceHash(salt + '0017');
  let attempts = 0;
  let found = null;
  for (const candidate of methodCandidates('brute', SETS.digits, 4)) {
    attempts += 1;
    if (hashCandidate(salt, candidate) === target) { found = candidate; break; }
  }
  assert.equal(found, '0017');
  assert.equal(attempts, 18);
});

test('time estimation preserves zero and validates its measured speed', () => {
  assert.equal(estimateSeconds(0n, 1000), 0);
  assert.equal(estimateSeconds(10000n, 1000), 10);
  assert.equal(estimateSeconds(94n ** 32n, 1e6), Number(94n ** 32n) / 1e6);
  for (const rate of [0, -1, NaN, Infinity]) assert.throws(() => estimateSeconds(1n, rate));
  assert.throws(() => estimateSeconds(-1n, 1));
  assert.throws(() => estimateSeconds(1, 1));
});
