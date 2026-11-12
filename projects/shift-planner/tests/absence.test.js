import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareAbsence, compareSchedules} from '../absence.js';
import {solve, validateSchedule} from '../solver.js';

function fixture() {
  const staff = ['A', 'B', 'C'].map(id => ({id, name: `スタッフ${id}`, weight: 1, minHours: 0, maxHours: 16, maxDays: 5, skills: ''}));
  const slots = [
    {id: 'morning', date: '2026-11-16', start: '09:00', end: '13:00', required: 2, skill: '', fixed: 'A,B'},
    {id: 'afternoon', date: '2026-11-16', start: '13:00', end: '17:00', required: 1, skill: '', fixed: ''},
    {id: 'tomorrow', date: '2026-11-17', start: '09:00', end: '13:00', required: 1, skill: '', fixed: 'A'},
  ];
  const availability = staff.flatMap(p => slots.map(s => ({staffId: p.id, slotId: s.id, preference: p.id === 'A' ? 2 : 1})));
  const data = {staff, slots, availability, history: [], settings: {includeHistory: true, minRestHours: 0, maxConsecutiveDays: 6, maxDailyHours: 8, timeLimitMs: 5000}};
  const schedule = [{slotId: 'morning', staffIds: ['A', 'B']}, {slotId: 'afternoon', staffIds: ['C']}, {slotId: 'tomorrow', staffIds: ['A']}];
  assert.deepEqual(validateSchedule(data, schedule), []);
  return {data, schedule};
}
function frozen(value) {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) frozen(item); Object.freeze(value); }
  return value;
}

test('a day absence blocks every slot that day including originally unassigned work', () => {
  const {data, schedule} = fixture();
  const prepared = prepareAbsence(data, schedule, [{staffId: 'A', date: '2026-11-16'}]);
  assert.deepEqual(prepared.blocked, [{staffId: 'A', slotId: 'morning'}, {staffId: 'A', slotId: 'afternoon'}]);
  assert.deepEqual(prepared.data.availability.filter(a => a.staffId === 'A').map(a => a.slotId), ['tomorrow']);
  assert.equal(prepared.data.slots[0].fixed, 'B');
  assert.equal(prepared.data.slots[2].fixed, 'A');
  assert.deepEqual(prepared.releasedFixed, [{staffId: 'A', slotId: 'morning'}]);
});

test('an exact-slot absence leaves the same person available in the other slots', () => {
  const {data, schedule} = fixture();
  const prepared = prepareAbsence(data, schedule, [{staffId: 'A', slotId: 'morning'}]);
  assert.deepEqual(prepared.data.availability.filter(a => a.staffId === 'A').map(a => a.slotId), ['afternoon', 'tomorrow']);
  assert.equal(prepared.data.slots[2].fixed, 'A');
});

test('several absences and overlapping day/slot scopes produce unique blocked pairs', () => {
  const {data, schedule} = fixture();
  const absences = [{staffId: 'A', date: '2026-11-16'}, {staffId: 'A', slotId: 'morning'}, {staffId: 'C', slotId: 'tomorrow'}];
  const prepared = prepareAbsence(data, schedule, absences);
  assert.deepEqual(prepared.blocked, [{staffId: 'A', slotId: 'morning'}, {staffId: 'A', slotId: 'afternoon'}, {staffId: 'C', slotId: 'tomorrow'}]);
  assert.equal(prepared.data.availability.length, data.availability.length - 3);
});

test('declining fixed-assignment release preserves the conflict for the solver to report', () => {
  const {data, schedule} = fixture();
  const prepared = prepareAbsence(data, schedule, [{staffId: 'A', slotId: 'morning'}], {releaseAbsentFixed: false});
  assert.equal(prepared.data.slots[0].fixed, 'A,B');
  assert.deepEqual(prepared.releasedFixed, []);
  assert.equal(solve(prepared.data).status, 'infeasible');
});

test('preparing an absence preserves bounds, history, demand, preferences and caller data', () => {
  const {data, schedule} = fixture();
  data.staff[0].minHours = 8;
  data.history.push({staffId: 'B', date: '2026-11-09', start: '09:00', end: '13:00'});
  const before = structuredClone(data), originalSchedule = structuredClone(schedule);
  frozen(data); frozen(schedule);
  const prepared = prepareAbsence(data, schedule, [{staffId: 'A', slotId: 'morning'}]);
  assert.deepEqual(data, before);
  assert.deepEqual(schedule, originalSchedule);
  assert.deepEqual(prepared.data.staff, data.staff);
  assert.deepEqual(prepared.data.history, data.history);
  assert.deepEqual(prepared.data.settings, data.settings);
  assert.deepEqual(prepared.data.slots.map(s => ({...s, fixed: ''})), data.slots.map(s => ({...s, fixed: ''})));
  assert.deepEqual(prepared.data.availability, data.availability.filter(a => !(a.staffId === 'A' && a.slotId === 'morning')));
  assert.deepEqual(prepared.referenceSchedule, schedule);
  assert.notEqual(prepared.referenceSchedule, schedule);
  prepared.referenceSchedule[0].staffIds.push('C');
  assert.deepEqual(schedule, originalSchedule);
});

test('known slots remain blocked even when the person was already unavailable', () => {
  const {data, schedule} = fixture();
  data.availability = data.availability.filter(a => !(a.staffId === 'B' && a.slotId === 'tomorrow'));
  const prepared = prepareAbsence(data, schedule, [{staffId: 'B', slotId: 'tomorrow'}]);
  assert.deepEqual(prepared.blocked, [{staffId: 'B', slotId: 'tomorrow'}]);
  assert.deepEqual(prepared.data.availability, data.availability);
});

test('invalid original schedules cannot become an absence baseline', () => {
  const {data, schedule} = fixture();
  assert.throws(() => prepareAbsence(data, schedule.slice(1), [{staffId: 'A', date: '2026-11-16'}]), /元の勤務表/);
  const stale = structuredClone(data); stale.slots[0].required = 1;
  assert.throws(() => prepareAbsence(stale, schedule, [{staffId: 'A', slotId: 'morning'}]), /元の勤務表/);
});

test('bad absence scopes and non-boolean options fail without changing input', () => {
  const {data, schedule} = fixture(), before = structuredClone(data);
  for (const absences of [null, [], [null], [{staffId: 'missing', date: '2026-11-16'}], [{staffId: 'A'}], [{staffId: 'A', date: '2026-11-16', slotId: 'morning'}], [{staffId: 'A', slotId: 'missing'}], [{staffId: 'A', date: 'not-a-date'}], [{staffId: 'A', date: '2026-11-18'}]]) {
    assert.throws(() => prepareAbsence(data, schedule, absences));
  }
  assert.throws(() => prepareAbsence(data, schedule, [{staffId: 'A', slotId: 'morning'}], {releaseAbsentFixed: 'false'}));
  assert.throws(() => prepareAbsence(data, schedule, [{staffId: 'A', slotId: 'morning'}], {releaseAbsentFixed: null}));
  assert.throws(() => prepareAbsence(data, schedule, [{staffId: 'A', slotId: 'morning'}], null));
  assert.deepEqual(data, before);
});

test('schedule comparison reports actual replacements and ignores display ordering', () => {
  const {schedule} = fixture();
  const after = [{slotId: 'tomorrow', staffIds: ['A']}, {slotId: 'morning', staffIds: ['B', 'C']}, {slotId: 'afternoon', staffIds: ['B']}];
  const before = structuredClone(schedule); frozen(schedule); frozen(after);
  assert.deepEqual(compareSchedules(schedule, after), [
    {slotId: 'morning', removed: ['A'], added: ['C']},
    {slotId: 'afternoon', removed: ['C'], added: ['B']},
  ]);
  assert.deepEqual(compareSchedules(schedule, [...schedule].reverse().map(row => ({slotId: row.slotId, staffIds: [...row.staffIds].reverse()}))), []);
  assert.deepEqual(schedule, before);
});

test('schedule comparison rejects incomplete, duplicated or differently sized plans', () => {
  const {schedule} = fixture();
  const bad = [[], schedule.slice(1), [...schedule, schedule[0]], schedule.map((row, i) => i ? row : {...row, slotId: 'missing'}), schedule.map((row, i) => i ? row : {...row, staffIds: ['A']}), schedule.map((row, i) => i ? row : {...row, staffIds: ['A', 'A']}), [{slotId: 'morning', staffIds: [null]}]];
  for (const after of bad) assert.throws(() => compareSchedules(schedule, after));
  assert.throws(() => compareSchedules(null, schedule));
});
