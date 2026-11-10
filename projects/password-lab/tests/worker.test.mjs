import test from 'node:test';
import assert from 'node:assert/strict';
import {pbkdf2Sync} from 'node:crypto';
import {digestCandidate, calibrate, searchCPU} from '../worker.js';
import {hashCandidate, buildAttackPlan} from '../engine.js';

const common = {alphabet:'0123456789', length:2, salt:'testSalt', mode:'sha256', timeLimitMs:1000, maxAttempts:1000};
test('CPU finds the actual last hash match with leading-zero enumeration', async () => {
  const r = await searchCPU({...common, method:'brute', targetHash:hashCandidate(common.salt,'99')});
  assert.equal(r.status,'found'); assert.equal(r.attempts,100);
  assert.ok(r.elapsedMs >= 0);
});
test('CPU budget does not claim discovery from the known order', async () => {
  const r = await searchCPU({...common, method:'brute', targetHash:hashCandidate(common.salt,'99'), maxAttempts:10});
  assert.equal(r.status,'budget'); assert.equal(r.attempts,10);
  assert.equal(r.foundCandidate,undefined);
});
test('finite dictionary miss and exhausted brute space are distinct from a time cutoff', async () => {
  for (const method of ['dictionary','brute']) {
    const r = await searchCPU({...common,method, targetHash:hashCandidate(common.salt,'outside')});
    assert.equal(r.status,'exhausted'); assert.ok(r.attempts <= 100);
  }
});
test('PBKDF2 uses real HMAC-SHA256 with the displayed 10000 iterations', async () => {
  const expected = pbkdf2Sync('test',common.salt,10000,32,'sha256').toString('hex');
  assert.equal(await digestCandidate('test',common.salt,'pbkdf2'),expected);
  const r = await searchCPU({...common,mode:'pbkdf2',alphabet:'01',length:1,method:'brute', targetHash:await digestCandidate('1',common.salt,'pbkdf2')});
  assert.equal(r.status,'found'); assert.equal(r.attempts,2);
});
test('calibration returns a separately measured rate without claiming any target match', async () => {
  const r = await calibrate({...common,alphabet:'01',length:1});
  assert.ok(r.attempts > 0); assert.ok(r.rate > 0); assert.equal(r.status,undefined);
});
test('invalid budgets and unknown methods fail clearly', async () => {
  await assert.rejects(searchCPU({...common,method:'brute',timeLimitMs:NaN}),/上限/);
  await assert.rejects(searchCPU({...common,method:'unknown'}),/探索方法/);
});

test('unknown-length CPU search uses one shared attempt budget across lengths', async () => {
  const plan = buildAttackPlan({knowledge:'charset',groups:['digits'],lengthKnown:false,maxLength:2});
  // Ten one-character candidates precede 00, 01, ... .
  const found = await searchCPU({...common,plan,method:'brute',targetHash:hashCandidate(common.salt,'07')});
  assert.equal(found.status, 'found');
  assert.equal(found.attempts, 18);
  const limited = await searchCPU({...common,plan,method:'brute',maxAttempts:15,targetHash:hashCandidate(common.salt,'07')});
  assert.equal(limited.status, 'budget');
  assert.equal(limited.attempts, 15);
  assert.equal(limited.foundCandidate, undefined);
});

test('false attacker information is actually searched and ends as a miss', async () => {
  const wrongCharacters = buildAttackPlan({knowledge:'charset',groups:['digits'],lengthKnown:true,length:1});
  const wrongStructure = buildAttackPlan({knowledge:'structure',prefix:'x',firstGroup:'digits',firstCount:1});
  for (const [plan, method] of [[wrongCharacters,'brute'],[wrongStructure,'structure']]) {
    const result = await searchCPU({...common,plan,method,targetHash:hashCandidate(common.salt,'a')});
    assert.equal(result.status, 'exhausted');
    assert.equal(result.attempts, 10);
  }
});

test('known parts search and calibration use those parts without target knowledge', async () => {
  const plan = buildAttackPlan({knowledge:'structure',prefix:'x',firstGroup:'digits',firstCount:1,suffix:'!'});
  const found = await searchCPU({...common,plan,method:'structure',targetHash:hashCandidate(common.salt,'x7!')});
  assert.equal(found.status, 'found');
  assert.equal(found.attempts, 8);
  const calibration = await calibrate({...common,plan});
  assert.ok(calibration.rate > 0);
  assert.match(calibration.estimateBasis, /指定した並びの3文字/);
  assert.equal(calibration.estimateBasis.includes('x'), false);
});

test('unknown-information plan does not silently use legacy target alphabet or length', async () => {
  const plan = buildAttackPlan({knowledge:'none',maxLength:1});
  const result = await searchCPU({...common,plan,alphabet:'0123456789',length:2,method:'brute',targetHash:hashCandidate(common.salt,'a')});
  assert.equal(result.status, 'found');
  assert.equal(result.attempts, 11);
  const calibration = await calibrate({...common,plan:buildAttackPlan({knowledge:'none',maxLength:3})});
  assert.match(calibration.estimateBasis, /最大探索長の3文字/);
});
