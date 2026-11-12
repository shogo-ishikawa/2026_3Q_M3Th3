import test from 'node:test';
import assert from 'node:assert/strict';
import { solve, validateInput, validateSchedule, timeToMin, fmtTime } from '../solver.js';

const person = (id, extra = {}) => ({ id, name: `スタッフ${id}`, weight: 1, minHours: 0, maxHours: 40, maxDays: 5, skills: '', ...extra });
const slot = (id, date, extra = {}) => ({ id, date, start: '09:00', end: '13:00', required: 1, skill: '', fixed: '', ...extra });
const make = (staff, slots, extra = {}) => ({ staff, slots, availability: staff.flatMap(p => slots.map(s => ({ staffId: p.id, slotId: s.id, preference: 1 }))), history: [], settings: { includeHistory: true, minRestHours: 0, maxConsecutiveDays: 6, maxDailyHours: 8, timeLimitMs: 1000 }, ...extra });
const valid = r => ['optimal', 'feasible'].includes(r.status);
const assignment = (r, id) => r.schedule.find(s => s.slotId === id).staffIds;

test('student time helpers preserve valid inputs and reject invalid times', () => {
  assert.equal(timeToMin('09:05'), 545);
  assert.equal(fmtTime(545), '09:05');
  for (const bad of ['24:00', '9:00', '23:60', '', null]) assert.equal(timeToMin(bad), null);
});

test('backtracks over the submitted greedy algorithm false shortage', () => {
  const d = make([person('A', { maxDays: 1 }), person('B', { maxDays: 1 })], [slot('Mon', '2026-11-16'), slot('Tue', '2026-11-17')]);
  d.availability = d.availability.filter(a => !(a.staffId === 'B' && a.slotId === 'Tue'));
  const r = solve(d);
  assert.equal(r.status, 'optimal');
  assert.deepEqual(assignment(r, 'Mon'), ['B']);
  assert.deepEqual(assignment(r, 'Tue'), ['A']);
  assert.deepEqual(validateSchedule(d, r.schedule), []);
});

test('different slot lengths balance hours rather than assignment counts', () => {
  const d = make([person('A'), person('B')], [slot('long', '2026-11-16', { end: '17:00' }), slot('short1', '2026-11-17'), slot('short2', '2026-11-18')]);
  const r = solve(d);
  assert.equal(r.status, 'optimal');
  assert.deepEqual(r.stats.map(s => s.hours), [8, 8]);
  assert.equal(r.objective, 0);
});

test('proportional weights control target workload without relaxing caps', () => {
  const d = make([person('A', { weight: 2 }), person('B')], [slot('1', '2026-11-16'), slot('2', '2026-11-17'), slot('3', '2026-11-18')]);
  const r = solve(d);
  assert.equal(r.status, 'optimal');
  assert.deepEqual(r.stats.map(s => s.hours), [8, 4]);
  assert.deepEqual(r.stats.map(s => s.targetHours), [8, 4]);
  d.staff[0].maxHours = 4;
  const capped = solve(d);
  assert.equal(capped.status, 'optimal');
  assert.deepEqual(capped.stats.map(s => s.hours), [4, 8]);
});

test('history shifts fairness and disabling it changes only the fairness baseline', () => {
  const d = make([person('A'), person('B')], [slot('1', '2026-11-16'), slot('2', '2026-11-17')]);
  d.history = [{ staffId: 'A', date: '2026-11-09', start: '09:00', end: '17:00' }];
  let r = solve(d);
  assert.equal(r.status, 'optimal');
  assert.deepEqual(r.stats.map(s => s.hours), [0, 8]);
  assert.deepEqual(r.stats.map(s => s.totalHours), [8, 8]);
  d.settings.includeHistory = false;
  r = solve(d);
  assert.equal(r.status, 'optimal');
  assert.deepEqual(r.stats.map(s => s.hours), [4, 4]);
  assert.deepEqual(r.stats.map(s => s.historyHours), [8, 0]);
});

test('prefers requested slots among equal workload solutions', () => {
  const d = make([person('A'), person('B')], [slot('1', '2026-11-16'), slot('2', '2026-11-17')]);
  d.availability.find(a => a.staffId === 'A' && a.slotId === '2').preference = 2;
  const r = solve(d);
  assert.equal(r.status, 'optimal');
  assert.deepEqual(assignment(r, '2'), ['A']);
});

test('global infeasibility has no partial schedule or stats', () => {
  const d = make([person('A', { maxDays: 1 }), person('B', { maxDays: 1 })], [slot('1', '2026-11-16'), slot('2', '2026-11-17'), slot('3', '2026-11-18')]);
  const r = solve(d);
  assert.equal(r.status, 'infeasible');
  assert.deepEqual(r.schedule, []);
  assert.deepEqual(r.stats, []);
  assert.equal(r.objective, null);
});

test('known per-slot shortage gives specific diagnostics', () => {
  const d = make([person('A')], [slot('rush', '2026-11-16', { required: 2 })]);
  const r = solve(d);
  assert.equal(r.status, 'infeasible');
  assert.match(r.diagnostics.join(''), /rush.*必要2人.*1人/);
});

test('zero search budget is unknown, never infeasible', () => {
  const d = make([person('A'), person('B')], [slot('1', '2026-11-16')]);
  for (const options of [{ maxNodes: 0 }, { timeLimitMs: 0 }]) {
    const r = solve(d, options);
    assert.equal(r.status, 'unknown');
    assert.deepEqual(r.schedule, []);
    assert.deepEqual(r.stats, []);
  }
});

test('a limited search returns a fully validated incumbent and no optimality claim', () => {
  const d = make([person('A'), person('B'), person('C')], [slot('1', '2026-11-16'), slot('2', '2026-11-17'), slot('3', '2026-11-18'), slot('4', '2026-11-19')]);
  // Independent preferred upper bound cannot be reached with fair workload.
  d.availability.forEach(a => { if (a.staffId === 'A') a.preference = 2; });
  const r = solve(d, { maxNodes: 7 });
  assert.equal(r.status, 'feasible');
  assert.deepEqual(validateSchedule(d, r.schedule), []);
  assert.ok(r.nodes <= 7);
});

test('fixed assignments and skills are compulsory', () => {
  const d = make([person('A', { skills: 'leader,cashier' }), person('B')], [slot('1', '2026-11-16', { skill: 'cashier', fixed: 'A' })]);
  let r = solve(d);
  assert.equal(r.status, 'optimal');
  assert.deepEqual(assignment(r, '1'), ['A']);
  d.slots[0].fixed = 'B';
  r = solve(d);
  assert.equal(r.status, 'infeasible');
  assert.deepEqual(r.schedule, []);
});

test('overlapping assignments cannot go to one person; touching slots permitted with zero rest', () => {
  const d = make([person('A')], [slot('1', '2026-11-16'), slot('2', '2026-11-16', { start: '12:00', end: '16:00' })]);
  assert.equal(solve(d).status, 'infeasible');
  d.slots[1].start = '13:00'; d.slots[1].end = '17:00';
  assert.equal(solve(d).status, 'optimal');
  d.settings.minRestHours = 1;
  assert.equal(solve(d).status, 'infeasible');
});

test('minimum hours are compulsory even for otherwise well covered slots', () => {
  const d = make([person('A', { minHours: 4 }), person('B', { minHours: 4 })], [slot('1', '2026-11-16'), slot('2', '2026-11-17')]);
  const r = solve(d);
  assert.equal(r.status, 'optimal');
  assert.deepEqual(r.stats.map(s => s.hours), [4, 4]);
  d.staff[1].minHours = 8;
  assert.equal(solve(d).status, 'infeasible');
});

test('weekly day limit resets on Monday and uses prior history in the same week', () => {
  const d = make([person('A', { maxDays: 1 })], [slot('sun', '2026-11-22'), slot('mon', '2026-11-23')]);
  assert.equal(solve(d).status, 'optimal');
  d.history = [{ staffId: 'A', date: '2026-11-20', start: '09:00', end: '13:00' }];
  assert.equal(solve(d).status, 'infeasible');
  d.slots = [d.slots[1]]; d.availability = [{ staffId: 'A', slotId: 'mon', preference: 1 }];
  assert.equal(solve(d).status, 'optimal');
});

test('history constrains rest and consecutive days even when excluded from fairness', () => {
  const d = make([person('A')], [slot('1', '2026-11-16')]);
  d.settings.includeHistory = false;
  d.settings.minRestHours = 12;
  d.history = [{ staffId: 'A', date: '2026-11-15', start: '19:00', end: '23:00' }];
  assert.equal(solve(d).status, 'infeasible');
  d.settings.minRestHours = 0;
  d.settings.maxConsecutiveDays = 2;
  d.history.push({ staffId: 'A', date: '2026-11-14', start: '09:00', end: '13:00' });
  assert.equal(solve(d).status, 'infeasible');
});

test('same-day prior history counts toward daily hours and historical-only old violations do not block future', () => {
  const d = make([person('A')], [slot('1', '2026-11-16', { start: '13:00', end: '17:00' })]);
  d.history = [{ staffId: 'A', date: '2026-11-16', start: '06:00', end: '11:00' }];
  assert.equal(solve(d).status, 'infeasible');
  d.history = [{ staffId: 'A', date: '2026-11-01', start: '06:00', end: '18:00' }];
  assert.equal(solve(d).status, 'optimal');
});

test('invalid input is rejected before any schedule is produced', () => {
  for (const mutate of [
    d => d.staff.push({ ...d.staff[0] }),
    d => { d.slots[0].date = '2026-02-30'; },
    d => { d.slots[0].end = '08:00'; },
    d => { d.staff[0].weight = 0; },
    d => { d.staff[0].maxDays = 1.5; },
    d => { d.slots[0].fixed = 'missing'; },
    d => d.availability.push({ ...d.availability[0] }),
    d => { d.history = [{ staffId: 'A', date: '2026-11-17', start: '09:00', end: '13:00' }]; },
    d => { d.history = [{ staffId: 'A', date: '2026-11-09', start: '09:00', end: '13:00' }, { staffId: 'A', date: '2026-11-09', start: '12:00', end: '15:00' }]; }
  ]) {
    const d = make([person('A')], [slot('1', '2026-11-16')]); mutate(d);
    assert.ok(validateInput(d).length);
    const r = solve(d);
    assert.equal(r.status, 'invalid');
    assert.deepEqual(r.schedule, []);
  }
});

test('whole-plan verifier rejects omitted/duplicate/unknown/overstaffed rows', () => {
  const d = make([person('A'), person('B')], [slot('1', '2026-11-16')]);
  for (const schedule of [[], [{ slotId: '1', staffIds: ['A', 'A'] }], [{ slotId: '1', staffIds: ['A', 'B'] }], [{ slotId: '1', staffIds: ['missing'] }], [{ slotId: '1', staffIds: ['A'] }, { slotId: '1', staffIds: ['A'] }]]) {
    assert.ok(validateSchedule(d, schedule).length);
  }
});

test('caller data remains unchanged after search', () => {
  const d = make([person('A'), person('B')], [slot('1', '2026-11-16')]);
  const before = JSON.stringify(d);
  assert.ok(valid(solve(d)));
  assert.equal(JSON.stringify(d), before);
});

test('validator handles JSON object scalars without throwing', () => {
  for (const [collection, field] of [['staff', 'minHours'], ['staff', 'maxHours'], ['staff', 'weight'], ['staff', 'skills'], ['slots', 'fixed'], ['slots', 'required'], ['availability', 'staffId'], ['availability', 'slotId'], ['history', 'staffId']]) {
    const d = make([person('A')], [slot('1', '2026-11-16')]);
    d.history = [{ staffId: 'A', date: '2026-11-09', start: '09:00', end: '13:00' }];
    d[collection][0][field] = { toString: null, valueOf: null };
    assert.doesNotThrow(() => validateInput(d));
    assert.ok(validateInput(d).length);
    assert.equal(solve(d).status, 'invalid');
  }
});

test('IDs with surrounding whitespace are rejected instead of silently changing identity', () => {
  const d = make([person('A')], [slot('1', '2026-11-16')]);
  d.staff[0].id = ' A ';
  assert.ok(validateInput(d).length);
  d.staff[0].id = 'A'; d.slots[0].id = ' 1 ';
  assert.ok(validateInput(d).length);
});

test('24:00 represents only an end-of-day boundary, never a start', () => {
  assert.equal(timeToMin('24:00', true), 1440);
  assert.equal(timeToMin('24:00'), null);
  assert.equal(timeToMin('24:01', true), null);
  assert.equal(fmtTime(1440), '24:00');
  const d = make([person('A')], [slot('late', '2026-11-16', { start: '20:00', end: '24:00' })]);
  assert.deepEqual(validateInput(d), []);
  assert.equal(solve(d).status, 'optimal');
  d.slots[0].start = '24:00';
  assert.ok(validateInput(d).length);
});

test('split overnight slots cover midnight exactly and retain separate rest/daily/day constraints', () => {
  const d = make([person('A')], [
    slot('night1', '2026-11-16', { start: '20:00', end: '24:00' }),
    slot('night2', '2026-11-17', { start: '00:00', end: '04:00' })
  ]);
  let r = solve(d);
  assert.equal(r.status, 'optimal');
  assert.deepEqual(validateSchedule(d, r.schedule), []);
  assert.equal(r.stats[0].hours, 8);
  assert.equal(r.stats[0].days, 2);
  d.settings.minRestHours = 1;
  assert.equal(solve(d).status, 'infeasible');
  d.settings.minRestHours = 0;
  d.settings.maxDailyHours = 3;
  assert.equal(solve(d).status, 'infeasible');
  d.settings.maxDailyHours = 8;
  d.staff[0].maxDays = 1;
  assert.equal(solve(d).status, 'infeasible');
});

test('history can end at24:00 and remains relevant across the midnight boundary', () => {
  const d = make([person('A')], [slot('early', '2026-11-17', { start: '00:00', end: '04:00' })]);
  d.history = [{ staffId: 'A', date: '2026-11-16', start: '20:00', end: '24:00' }];
  let r = solve(d);
  assert.equal(r.status, 'optimal');
  assert.equal(r.stats[0].historyHours, 4);
  d.settings.minRestHours = 1;
  assert.equal(solve(d).status, 'infeasible');
  d.settings.minRestHours = 0;
  d.settings.maxConsecutiveDays = 1;
  assert.equal(solve(d).status, 'infeasible');
  d.history[0].start = '24:00';
  assert.ok(validateInput(d).length);
});
