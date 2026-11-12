import test from 'node:test';
import assert from 'node:assert/strict';
import {solve} from '../solver.js';

// Independent repair oracle. It enumerates whole calendars first, then checks
// their constraints. It does not call the scheduler's validation or bounds.
const minutes = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const dateDay = d => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86400000);
const week = d => Math.floor((dateDay(d) + 3) / 7);
const ids = value => value.split(',').map(x => x.trim()).filter(Boolean);
const interval = row => ({date: row.date, day: dateDay(row.date),
  start: dateDay(row.date) * 1440 + minutes(row.start),
  end: dateDay(row.date) * 1440 + minutes(row.end),
  hours: (minutes(row.end) - minutes(row.start)) / 60});

function choose(values, n) {
  if (!n) return [[]];
  return values.flatMap((v, i) => choose(values.slice(i + 1), n - 1).map(tail => [v, ...tail]));
}

function calendars(data) {
  const choices = data.slots.map(slot => choose(data.staff.filter(p =>
    data.availability.some(a => a.staffId === p.id && a.slotId === slot.id)
    && (!slot.skill || ids(p.skills).includes(slot.skill))).map(p => p.id), slot.required)
    .filter(team => ids(slot.fixed).every(id => team.includes(id))));
  let rows = [[]];
  for (const choicesForSlot of choices) rows = rows.flatMap(row => choicesForSlot.map(team => [...row, team]));
  return rows.filter(teams => data.staff.every(p => {
    const fresh = data.slots.flatMap((s, i) => teams[i].includes(p.id) ? [interval(s)] : []);
    const history = data.history.filter(h => h.staffId === p.id).map(interval);
    const all = [...history, ...fresh].sort((a, b) => a.start - b.start);
    const hours = fresh.reduce((sum, e) => sum + e.hours, 0);
    if (hours < p.minHours - 1e-8 || hours > p.maxHours + 1e-8) return false;
    for (let i = 1; i < all.length; i++) {
      if (all[i].start < all[i - 1].end + data.settings.minRestHours * 60 - 1e-8) return false;
    }
    const dates = [...new Set(all.map(e => e.day))].sort((a, b) => a - b);
    let last = -Infinity, streak = 0;
    for (const date of dates) {
      streak = date === last + 1 ? streak + 1 : 1;
      if (streak > data.settings.maxConsecutiveDays) return false;
      last = date;
      if (all.filter(e => e.day === date).reduce((sum, e) => sum + e.hours, 0) > data.settings.maxDailyHours + 1e-8) return false;
    }
    const weeks = new Map();
    for (const date of new Set(all.map(e => e.date))) weeks.set(week(date), (weeks.get(week(date)) || 0) + 1);
    return [...weeks.values()].every(n => n <= p.maxDays);
  }));
}

function tuple(data, teams, reference) {
  let changed = 0, replacements = 0, preferred = 0;
  const original = new Map(reference.map(row => [row.slotId, new Set(row.staffIds)]));
  data.slots.forEach((slot, i) => {
    const inserted = teams[i].filter(id => !original.get(slot.id).has(id)).length;
    if (inserted) changed++;
    replacements += inserted;
    preferred += teams[i].filter(id => data.availability.some(a => a.slotId === slot.id && a.staffId === id && a.preference === 2)).length;
  });
  const values = data.staff.map(p => ({weight: p.weight,
    hours: data.slots.reduce((sum, slot, i) => sum + (teams[i].includes(p.id) ? interval(slot).hours : 0), 0)
      + (data.settings.includeHistory ? data.history.filter(h => h.staffId === p.id).reduce((sum, h) => sum + interval(h).hours, 0) : 0)}));
  const total = values.reduce((sum, p) => sum + p.hours, 0), weights = values.reduce((sum, p) => sum + p.weight, 0);
  const fairness = values.reduce((sum, p) => sum + (p.hours - total * p.weight / weights) ** 2 / p.weight, 0);
  return [changed, replacements, fairness, -preferred];
}

function compare(a, b) {
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-7) return a[i] - b[i];
  return 0;
}

function base() {
  const staff = ['A', 'B', 'C'].map(id => ({id, name: `スタッフ${id}`, weight: 1, minHours: 0, maxHours: 16, maxDays: 5, skills: ''}));
  const slots = [
    {id: 'S1', date: '2026-11-16', start: '09:00', end: '13:00', required: 1, skill: '', fixed: ''},
    {id: 'S2', date: '2026-11-16', start: '13:00', end: '17:00', required: 1, skill: '', fixed: ''},
    {id: 'S3', date: '2026-11-17', start: '09:00', end: '13:00', required: 1, skill: '', fixed: ''},
    {id: 'S4', date: '2026-11-18', start: '09:00', end: '13:00', required: 1, skill: '', fixed: ''},
  ];
  return {staff, slots, availability: staff.flatMap(p => slots.map(s => ({staffId: p.id, slotId: s.id, preference: 1}))), history: [],
    settings: {includeHistory: true, minRestHours: 0, maxConsecutiveDays: 6, maxDailyHours: 8, timeLimitMs: 5000}};
}
function referenceOf(data, teams) {return data.slots.map((s, i) => ({slotId: s.id, staffIds: [...teams[i]]}));}
function teamsOf(data, schedule) {return data.slots.map(s => schedule.find(r => r.slotId === s.id).staffIds);}

let seed = 0x129cab;
function random(n) {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n;}

test('repair agrees with independent whole-calendar enumeration on 180 absence cases', () => {
  let completed = 0;
  for (let attempt = 0; completed < 180 && attempt < 1500; attempt++) {
    const data = base();
    data.staff.forEach((p, i) => {
      p.maxHours = [4, 6, 8, 12, 16][random(5)]; p.maxDays = 1 + random(3);
      p.minHours = random(4) === 0 ? 2 : 0; p.weight = [0.5, 1, 1.5, 2][random(4)];
      p.skills = i === 0 ? 'leader' : '';
    });
    data.slots.forEach(s => {s.end = `${String(+s.start.slice(0, 2) + [1, 2, 4][random(3)]).padStart(2, '0')}:00`;});
    data.slots[0].required = 1 + random(2);
    if (random(4) === 0) data.slots[2].skill = 'leader';
    data.availability = data.availability.filter(() => random(5) > 0).map(a => ({...a, preference: 1 + random(2)}));
    data.settings.minRestHours = random(4) === 0 ? 12 : 0;
    data.settings.maxDailyHours = random(3) === 0 ? 4 : 8;
    data.settings.maxConsecutiveDays = 1 + random(3);
    if (random(2)) data.history = [{staffId: 'A', date: '2026-11-15', start: '18:00', end: '20:00'}];
    data.settings.includeHistory = Boolean(random(2));
    const originals = calendars(data);
    if (!originals.length) continue;
    const reference = referenceOf(data, originals[random(originals.length)]);
    const slot = data.slots[random(data.slots.length)];
    const absent = reference.find(r => r.slotId === slot.id).staffIds[0];
    data.availability = data.availability.filter(a => a.staffId !== absent || a.slotId !== slot.id);
    if (random(4) === 0) {
      // Keep a formerly fixed absent person to verify that repair does not relax it.
      slot.fixed = absent;
    } else if (random(3) === 0) {
      const kept = reference.find(r => r.slotId !== slot.id);
      data.slots.find(s => s.id === kept.slotId).fixed = kept.staffIds[0];
    }
    const expected = calendars(data);
    const actual = solve(data, {referenceSchedule: reference, timeLimitMs: 5000, maxNodes: 1000000});
    const prefix = `absence case ${completed}: ${JSON.stringify({data, reference})}`;
    assert.equal(actual.status, expected.length ? 'optimal' : 'infeasible', `${prefix} => ${JSON.stringify(actual)}`);
    if (!expected.length) {assert.deepEqual(actual.schedule, [], prefix); completed++; continue;}
    const best = expected.map(teams => tuple(data, teams, reference)).sort(compare)[0];
    const returnedTeams = teamsOf(data, actual.schedule);
    assert.ok(expected.some(teams => teams.every((ids, i) => JSON.stringify(ids.slice().sort()) === JSON.stringify(returnedTeams[i].slice().sort()))), prefix);
    const cost = tuple(data, returnedTeams, reference);
    assert.equal(compare(cost, best), 0, `${prefix}: ${JSON.stringify(cost)} versus ${JSON.stringify(best)}`);
    assert.equal(actual.repair.changedSlots, best[0], prefix);
    assert.equal(actual.repair.replacements, best[1], prefix);
    assert.equal(actual.repair.optimal, true, prefix);
    assert.ok(Math.abs(actual.objective - best[2]) < 1e-7, prefix);
    completed++;
  }
  assert.equal(completed, 180, 'enough independently feasible original calendars were generated');
});

test('repair may sacrifice fairness to preserve all unaffected slots', () => {
  const data = base();
  data.slots.pop(); data.availability = data.availability.filter(a => a.slotId !== 'S4');
  const reference = data.slots.map(s => ({slotId: s.id, staffIds: ['A']}));
  data.availability = data.availability.filter(a => a.staffId !== 'A' || a.slotId !== 'S1');
  const repaired = solve(data, {referenceSchedule: reference});
  const ordinary = solve(data);
  assert.equal(repaired.status, 'optimal');
  assert.equal(repaired.repair.changedSlots, 1);
  assert.equal(repaired.repair.replacements, 1);
  assert.ok(repaired.objective > ordinary.objective, 'minimum disruption comes before the fairness objective');
  assert.deepEqual(repaired.schedule.find(r => r.slotId === 'S2').staffIds, ['A']);
  assert.deepEqual(repaired.schedule.find(r => r.slotId === 'S3').staffIds, ['A']);
});

test('a replacement can require a chain of changes while keeping compulsory limits', () => {
  const data = base();
  data.slots = [data.slots[0], {...data.slots[2], id: 'S2'}];
  data.staff.forEach(p => {p.maxHours = 4; p.maxDays = 1;});
  data.availability = [{staffId: 'B', slotId: 'S1', preference: 1}, {staffId: 'B', slotId: 'S2', preference: 1}, {staffId: 'C', slotId: 'S2', preference: 1}];
  const reference = [{slotId: 'S1', staffIds: ['A']}, {slotId: 'S2', staffIds: ['B']}];
  const result = solve(data, {referenceSchedule: reference});
  assert.equal(result.status, 'optimal');
  assert.deepEqual(result.schedule, [{slotId: 'S1', staffIds: ['B']}, {slotId: 'S2', staffIds: ['C']}]);
  assert.deepEqual(result.repair, {changedSlots: 2, replacements: 2, optimal: true});
});

test('among equal changed-slot counts fewer replacements precede better fairness', () => {
  const data = base();
  data.staff.push({...data.staff[0], id: 'D', name: 'スタッフD'});
  data.slots = data.slots.slice(0, 2);
  data.slots.forEach(s => {s.required = 2;});
  data.availability = data.staff.flatMap(p => data.slots.map(s => ({staffId: p.id, slotId: s.id, preference: 1})))
    .filter(a => a.staffId !== 'A' || a.slotId !== 'S1');
  const reference = data.slots.map(s => ({slotId: s.id, staffIds: ['A', 'B']}));
  const expected = calendars(data).map(teams => tuple(data, teams, reference)).sort(compare)[0];
  const repaired = solve(data, {referenceSchedule: reference});
  assert.equal(repaired.status, 'optimal');
  assert.equal(repaired.repair.changedSlots, 1);
  assert.equal(repaired.repair.replacements, 1);
  assert.ok(repaired.schedule.find(r => r.slotId === 'S1').staffIds.includes('B'));
  assert.equal(compare(tuple(data, teamsOf(data, repaired.schedule), reference), expected), 0);
  const aFairerOneSlotChange = [['C', 'D'], ['A', 'B']];
  const fairerCost = tuple(data, aFairerOneSlotChange, reference);
  assert.equal(fairerCost[0], 1);
  assert.equal(fairerCost[1], 2);
  assert.ok(fairerCost[2] < repaired.objective);
});

test('reference ordering does not count as a change and no search budget remains unknown', () => {
  const data = base();
  data.slots = [data.slots[0]]; data.slots[0].required = 2;
  data.availability = data.availability.filter(a => a.slotId === 'S1');
  const reference = [{slotId: 'S1', staffIds: ['B', 'A']}];
  const result = solve(data, {referenceSchedule: reference});
  assert.equal(result.status, 'optimal');
  assert.equal(result.repair.changedSlots, 0);
  assert.equal(result.repair.replacements, 0);
  const exhausted = solve(data, {referenceSchedule: reference, maxNodes: 0});
  assert.equal(exhausted.status, 'unknown');
  assert.deepEqual(exhausted.schedule, []);
  assert.notEqual(exhausted.repair?.optimal, true);
});

test('a limited repair may return a feasible incumbent without claiming minimality', () => {
  const data = base();
  const reference = data.slots.map(s => ({slotId: s.id, staffIds: ['A']}));
  data.availability = data.availability.filter(a => a.staffId !== 'A' || a.slotId !== 'S1');
  const result = solve(data, {referenceSchedule: reference, maxNodes: 5});
  assert.equal(result.status, 'feasible');
  assert.equal(result.repair.optimal, false);
  const returned = teamsOf(data, result.schedule);
  assert.ok(calendars(data).some(teams => teams.every((team, i) => JSON.stringify(team.slice().sort()) === JSON.stringify(returned[i].slice().sort()))));
  const cost = tuple(data, returned, reference);
  assert.equal(result.repair.changedSlots, cost[0]);
  assert.equal(result.repair.replacements, cost[1]);
});
