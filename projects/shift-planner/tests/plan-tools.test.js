import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPlanLocks, clearPlanLocks, filterSchedule} from '../plan-tools.js';
import {solve, validateSchedule} from '../solver.js';

function fixture() {
  const staff = ['A', 'B', 'C'].map(id => ({id, name: `スタッフ${id}`, weight: 1, minHours: 0, maxHours: 16, maxDays: 5, skills: ''}));
  const slots = [
    {id: 'morning', date: '2026-11-16', start: '09:00', end: '13:00', required: 2, skill: '', fixed: 'A'},
    {id: 'afternoon', date: '2026-11-16', start: '13:00', end: '17:00', required: 1, skill: '', fixed: ''},
  ];
  const availability = staff.flatMap(p => slots.map(s => ({staffId: p.id, slotId: s.id, preference: 1})));
  const data = {staff, slots, availability, history: [], settings: {includeHistory: true, minRestHours: 0, maxConsecutiveDays: 6, maxDailyHours: 8, timeLimitMs: 5000}};
  const schedule = [{slotId: 'morning', staffIds: ['A', 'B']}, {slotId: 'afternoon', staffIds: ['C']}];
  assert.deepEqual(validateSchedule(data, schedule), []);
  return {data, schedule};
}
function frozen(value) {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) frozen(item); Object.freeze(value); }
  return value;
}

test('locks several selected result rows atomically without changing caller data', () => {
  const {data, schedule} = fixture(), snapshot = structuredClone(data);
  frozen(data); frozen(schedule);
  const next = applyPlanLocks(data, schedule, new Map([['morning', true], ['afternoon', true]]));
  assert.deepEqual(next.slots.map(s => s.fixed), ['A,B', 'C']);
  assert.deepEqual(data, snapshot);
  assert.notEqual(next, data);
  assert.deepEqual(validateSchedule(next, schedule), []);
  const rerun = solve(next);
  assert.ok(['optimal', 'feasible'].includes(rerun.status));
  assert.deepEqual(rerun.schedule.map(s => new Set(s.staffIds)), schedule.map(s => new Set(s.staffIds)));
});

test('untouched partial fixed constraints survive while a different slot is locked', () => {
  const {data, schedule} = fixture();
  const next = applyPlanLocks(data, schedule, new Map([['afternoon', true]]));
  assert.equal(next.slots[0].fixed, 'A');
  assert.equal(next.slots[1].fixed, 'C');
  assert.deepEqual(next.staff, data.staff);
  assert.deepEqual(next.availability, data.availability);
  assert.deepEqual(next.history, data.history);
  assert.deepEqual(next.settings, data.settings);
});

test('explicit unchecked change releases only that slot and preserves other locks', () => {
  const {data, schedule} = fixture(); data.slots[1].fixed = 'C';
  const next = applyPlanLocks(data, schedule, new Map([['morning', false]]));
  assert.deepEqual(next.slots.map(s => s.fixed), ['', 'C']);
  assert.deepEqual(validateSchedule(next, schedule), []);
});

test('a stale or incomplete result cannot be converted into compulsory assignments', () => {
  const {data, schedule} = fixture();
  assert.throws(() => applyPlanLocks(data, schedule.slice(0, 1), new Map([['morning', true]])));
  const staleData = structuredClone(data); staleData.slots[0].required = 1;
  assert.throws(() => applyPlanLocks(staleData, schedule, new Map([['morning', true]])));
  const unavailable = structuredClone(data); unavailable.availability = unavailable.availability.filter(a => !(a.staffId === 'B' && a.slotId === 'morning'));
  assert.throws(() => applyPlanLocks(unavailable, schedule, new Map([['morning', true]])));
  assert.equal(data.slots[0].fixed, 'A');
});

test('bad lock targets and non-boolean states fail before returning any update', () => {
  const {data, schedule} = fixture(), before = structuredClone(data);
  assert.throws(() => applyPlanLocks(data, schedule, new Map([['morning', true], ['missing', true]])));
  assert.throws(() => applyPlanLocks(data, schedule, new Map([['morning', 'true']])));
  assert.throws(() => applyPlanLocks(data, schedule, {morning: true}));
  assert.deepEqual(data, before);
});

test('clearing all fixed assignments is explicit and retains every other constraint', () => {
  const {data} = fixture(); data.slots[1].fixed = 'C'; frozen(data);
  const next = clearPlanLocks(data);
  assert.deepEqual(next.slots.map(s => s.fixed), ['', '']);
  const expected = structuredClone(data); expected.slots.forEach(s => s.fixed = '');
  assert.deepEqual(next, expected);
  assert.deepEqual(data.slots.map(s => s.fixed), ['A', 'C']);
});

test('staff filtering keeps the canonical complete plan and colleagues unchanged', () => {
  const {data, schedule} = fixture(); frozen(schedule);
  assert.deepEqual(filterSchedule(schedule, 'B'), [schedule[0]]);
  assert.deepEqual(filterSchedule(schedule, 'C'), [schedule[1]]);
  assert.deepEqual(filterSchedule(schedule), schedule);
  assert.deepEqual(filterSchedule(schedule, ''), schedule);
  assert.deepEqual(filterSchedule(schedule, 'no-assignment'), []);
  assert.equal(schedule.length, 2);
  assert.deepEqual(schedule[0].staffIds, ['A', 'B']);
  assert.deepEqual(validateSchedule(data, schedule), []);
});

test('filter changes do not discard pending selections for currently hidden slots', () => {
  const {data, schedule} = fixture();
  const pending = new Map([['morning', true]]);
  assert.deepEqual(filterSchedule(schedule, 'C'), [schedule[1]]);
  pending.set('afternoon', true);
  const next = applyPlanLocks(data, schedule, pending);
  assert.deepEqual(next.slots.map(s => s.fixed), ['A,B', 'C']);
  assert.equal(pending.size, 2);
});

test('editing a returned filtered view cannot alter the canonical assignments', () => {
  const {schedule} = fixture();
  const view = filterSchedule(schedule, 'B');
  view[0].staffIds.push('C'); view[0].slotId = 'different';
  assert.deepEqual(schedule[0], {slotId: 'morning', staffIds: ['A', 'B']});
});

test('all-lock removal can repair fixed fields in an unfinished input draft', () => {
  const {data} = fixture(); data.staff[0].minHours = null; data.slots[0].fixed = 'missing';
  const next = clearPlanLocks(data);
  assert.equal(next.slots[0].fixed, '');
  assert.equal(next.staff[0].minHours, null);
  assert.equal(data.slots[0].fixed, 'missing');
});
