import test from 'node:test';
import assert from 'node:assert/strict';
import {solve, validateSchedule} from '../solver.js';

function example(staffIds = ['A', 'B', 'C'], required = [1, 1, 1]) {
  const staff = staffIds.map(id => ({id, name: `スタッフ${id}`, weight: 1, minHours: 0, maxHours: 40, maxDays: 7, skills: ''}));
  const slots = required.map((n, i) => ({id: `S${i + 1}`, date: `2026-11-${16 + i}`, start: '09:00', end: '13:00', required: n, skill: '', fixed: ''}));
  return {staff, slots, availability: staff.flatMap(p => slots.map(s => ({staffId: p.id, slotId: s.id, preference: 1}))), history: [], settings: {includeHistory: true, minRestHours: 0, maxConsecutiveDays: 7, maxDailyHours: 8, timeLimitMs: 1000}};
}
const row = (slotId, ...staffIds) => ({slotId, staffIds});
const assignments = result => Object.fromEntries(result.schedule.map(r => [r.slotId, [...r.staffIds].sort()]));
function removePair(data, staffId, slotId) {
  data.availability = data.availability.filter(a => a.staffId !== staffId || a.slotId !== slotId);
}

test('one absence is replaced while all other slots retain their original staff', () => {
  const data = example(['A', 'B', 'C'], [1, 1]);
  const reference = [row('S1', 'A'), row('S2', 'B')];
  removePair(data, 'A', 'S1');
  const result = solve(data, {referenceSchedule: reference});
  assert.equal(result.status, 'optimal');
  assert.deepEqual(assignments(result), {S1: ['C'], S2: ['B']});
  assert.deepEqual(result.repair, {changedSlots: 1, replacements: 1, optimal: true});
  assert.deepEqual(validateSchedule(data, result.schedule), []);
});

test('a chain of two replacements can repair a plan that a direct substitution cannot', () => {
  const data = example();
  data.staff.forEach(p => { p.maxHours = 4; });
  data.slots[2].fixed = 'C';
  data.availability = [
    {staffId: 'B', slotId: 'S1', preference: 1},
    {staffId: 'A', slotId: 'S2', preference: 1},
    {staffId: 'B', slotId: 'S2', preference: 1},
    {staffId: 'C', slotId: 'S3', preference: 1},
  ];
  const result = solve(data, {referenceSchedule: [row('S1', 'A'), row('S2', 'B'), row('S3', 'C')]});
  assert.equal(result.status, 'optimal');
  assert.deepEqual(assignments(result), {S1: ['B'], S2: ['A'], S3: ['C']});
  assert.deepEqual(result.repair, {changedSlots: 2, replacements: 2, optimal: true});
});

test('minimum changed slots takes precedence over a much more even redistribution', () => {
  const data = example();
  removePair(data, 'A', 'S1');
  const result = solve(data, {referenceSchedule: [row('S1', 'A'), row('S2', 'A'), row('S3', 'A')]});
  const rebalanced = solve(data);
  assert.equal(result.status, 'optimal');
  assert.deepEqual(result.repair, {changedSlots: 1, replacements: 1, optimal: true});
  assert.deepEqual(assignments(result).S2, ['A']);
  assert.deepEqual(assignments(result).S3, ['A']);
  assert.ok(rebalanced.objective < result.objective);
});

test('among the same number of changed slots, retaining more original staff precedes fairness', () => {
  const data = example(['A', 'B', 'C', 'D'], [2]);
  data.history = [9, 10, 11].map(day => ({staffId: 'B', date: `2026-11-${String(day).padStart(2, '0')}`, start: '09:00', end: '17:00'}));
  removePair(data, 'A', 'S1');
  const result = solve(data, {referenceSchedule: [row('S1', 'A', 'B')]});
  assert.equal(result.status, 'optimal');
  assert.deepEqual(result.repair, {changedSlots: 1, replacements: 1, optimal: true});
  assert.ok(result.schedule[0].staffIds.includes('B'));
  assert.ok(solve(data).objective < result.objective);
});

test('reference row order and staff order do not create false changes', () => {
  const data = example(['A', 'B', 'C'], [2, 1]);
  const result = solve(data, {referenceSchedule: [row('S2', 'C'), row('S1', 'B', 'A')]});
  assert.equal(result.status, 'optimal');
  assert.deepEqual(result.repair, {changedSlots: 0, replacements: 0, optimal: true});
  assert.deepEqual(assignments(result), {S1: ['A', 'B'], S2: ['C']});
});

test('the repair solver never removes fixed assignments or relaxes a minimum-hours requirement', () => {
  const fixed = example(['A', 'B'], [1]);
  fixed.slots[0].fixed = 'A';
  removePair(fixed, 'A', 'S1');
  const fixedResult = solve(fixed, {referenceSchedule: [row('S1', 'A')]});
  assert.equal(fixedResult.status, 'infeasible');
  assert.deepEqual(fixedResult.schedule, []);
  assert.equal(fixedResult.repair, undefined);
  const minimum = example(['A', 'B'], [1]);
  minimum.staff[0].minHours = 4;
  removePair(minimum, 'A', 'S1');
  const minimumResult = solve(minimum, {referenceSchedule: [row('S1', 'A')]});
  assert.equal(minimumResult.status, 'infeasible');
  assert.deepEqual(minimumResult.schedule, []);
});

test('an exhausted budget is unknown without an incumbent and feasible without a proof', () => {
  const data = example();
  removePair(data, 'A', 'S1');
  const referenceSchedule = [row('S1', 'A'), row('S2', 'A'), row('S3', 'A')];
  const unknown = solve(data, {referenceSchedule, maxNodes: 0});
  assert.equal(unknown.status, 'unknown');
  assert.deepEqual(unknown.schedule, []);
  assert.equal(unknown.repair, undefined);
  const limited = solve(data, {referenceSchedule, maxNodes: 4});
  assert.equal(limited.status, 'feasible');
  assert.deepEqual(limited.repair, {changedSlots: 1, replacements: 1, optimal: false});
  assert.deepEqual(validateSchedule(data, limited.schedule), []);
});

test('malformed references fail rather than comparing against an incomplete or invented baseline', () => {
  const data = example(['A', 'B'], [1, 1]);
  const bad = [
    null, {}, [], [row('S1', 'A')],
    [row('S1', 'A'), row('S1', 'B')],
    [row('S1', 'A'), row('missing', 'B')],
    [row('S1', 'A'), row('S2', 'unknown')],
    [row('S1', 'A'), row('S2', 'A', 'A')],
    [row('S1', 'A'), {slotId: 'S2', staffIds: null}],
  ];
  for (const referenceSchedule of bad) {
    const result = solve(data, {referenceSchedule});
    assert.equal(result.status, 'invalid');
    assert.deepEqual(result.schedule, []);
  }
});

test('repair leaves caller input and reference untouched', () => {
  const data = example();
  removePair(data, 'A', 'S1');
  const referenceSchedule = [row('S1', 'A'), row('S2', 'B'), row('S3', 'C')];
  const before = structuredClone({data, referenceSchedule});
  solve(data, {referenceSchedule});
  assert.deepEqual({data, referenceSchedule}, before);
});
