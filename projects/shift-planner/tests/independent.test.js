import test from 'node:test';
import assert from 'node:assert/strict';
import { solve, validateSchedule } from '../solver.js';

// Independent oracle: enumerate complete assignments, then filter complete
// calendars. It deliberately does not use the solver's validation/pruning.
const minute = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
const day = value => Math.round(Date.parse(`${value}T00:00:00Z`) / 86400000);
const week = value => Math.floor((day(value) + 3) / 7);
const split = value => String(value || '').split(',').map(x => x.trim()).filter(Boolean);
const event = value => ({
  date: value.date, day: day(value.date),
  start: day(value.date) * 1440 + minute(value.start),
  end: day(value.date) * 1440 + minute(value.end),
  hours: (minute(value.end) - minute(value.start)) / 60,
});

function combinations(list, size) {
  if (size === 0) return [[]];
  if (list.length < size) return [];
  return list.flatMap((item, i) => combinations(list.slice(i + 1), size - 1).map(rest => [item, ...rest]));
}

function oracle(data) {
  const eligible = data.slots.map(slot => data.staff.filter(person =>
    data.availability.some(a => a.slotId === slot.id && a.staffId === person.id)
    && (!slot.skill || split(person.skills).includes(slot.skill))
  ).map(p => p.id));
  const choices = data.slots.map((slot, i) => combinations(eligible[i], slot.required)
    .filter(ids => split(slot.fixed).every(id => ids.includes(id))));
  const valid = [];
  function visit(assignments) {
    if (assignments.length < choices.length) {
      for (const ids of choices[assignments.length]) visit([...assignments, ids]);
      return;
    }
    const summary = [];
    for (const person of data.staff) {
      const fresh = data.slots.flatMap((s, i) => assignments[i].includes(person.id) ? [event(s)] : []);
      const history = data.history.filter(h => h.staffId === person.id).map(event);
      const all = [...fresh, ...history].sort((a, b) => a.start - b.start);
      const hours = fresh.reduce((sum, x) => sum + x.hours, 0);
      if (hours < person.minHours - 1e-9 || hours > person.maxHours + 1e-9) return;
      for (let i = 1; i < all.length; i++) {
        if (all[i].start < all[i - 1].end + data.settings.minRestHours * 60) return;
      }
      const dates = [...new Set(all.map(e => e.day))].sort((a, b) => a - b);
      let streak = 0, previous = -Infinity;
      for (const date of dates) {
        streak = date === previous + 1 ? streak + 1 : 1;
        if (streak > data.settings.maxConsecutiveDays) return;
        previous = date;
      }
      for (const date of dates) {
        if (all.filter(e => e.day === date).reduce((sum, e) => sum + e.hours, 0) > data.settings.maxDailyHours + 1e-9) return;
      }
      const weekly = new Map();
      for (const date of new Set(all.map(e => e.date))) {
        const key = week(date); weekly.set(key, (weekly.get(key) || 0) + 1);
      }
      if ([...weekly.values()].some(days => days > person.maxDays)) return;
      summary.push({ hours, historyHours: history.reduce((sum, x) => sum + x.hours, 0), weight: person.weight });
    }
    valid.push({ assignments, summary });
  }
  visit([]);
  return valid;
}

const base = () => ({
  staff: ['A', 'B', 'C'].map(id => ({ id, name: `スタッフ${id}`, weight: 1, minHours: 0, maxHours: 16, maxDays: 5, skills: '' })),
  slots: [
    { id: 'S1', date: '2026-11-16', start: '09:00', end: '13:00', required: 1, skill: '', fixed: '' },
    { id: 'S2', date: '2026-11-16', start: '13:00', end: '17:00', required: 1, skill: '', fixed: '' },
    { id: 'S3', date: '2026-11-17', start: '09:00', end: '13:00', required: 1, skill: '', fixed: '' },
  ],
  availability: ['A', 'B', 'C'].flatMap(staffId => ['S1', 'S2', 'S3'].map(slotId => ({ staffId, slotId, preference: 1 }))),
  history: [],
  settings: { includeHistory: true, minRestHours: 0, maxConsecutiveDays: 6, maxDailyHours: 8, timeLimitMs: 5000 },
});

let seed = 0x5017;
const random = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };

test('independent exhaustive oracle agrees on feasibility for 90 small calendars', () => {
  for (let caseNo = 0; caseNo < 90; caseNo++) {
    const data = base();
    data.staff.forEach((p, i) => {
      p.minHours = random(3) === 0 ? 4 : 0;
      p.maxHours = [4, 8, 12][random(3)];
      p.maxDays = 1 + random(2);
      p.weight = [0.5, 1, 2][random(3)];
      p.skills = i === 0 ? 'cashier' : '';
    });
    data.slots[0].required = 1 + random(2);
    if (random(3) === 0) data.slots[1].skill = 'cashier';
    if (random(4) === 0) data.slots[2].fixed = 'A';
    data.availability = data.availability.filter(() => random(5) > 0).map(a => ({ ...a, preference: 1 + random(2) }));
    data.settings.minRestHours = random(2) ? 0 : 12;
    data.settings.maxDailyHours = random(2) ? 8 : 4;
    data.settings.maxConsecutiveDays = 1 + random(2);
    const expected = oracle(data);
    const actual = solve(data, { timeLimitMs: 5000, maxNodes: 1000000 });
    assert.equal(actual.status, expected.length ? 'optimal' : 'infeasible', `case ${caseNo}: ${JSON.stringify(data)} => ${JSON.stringify(actual)}`);
    if (expected.length) {
      const assignments = data.slots.map(s => actual.schedule.find(row => row.slotId === s.id)?.staffIds.slice().sort());
      assert.ok(expected.some(e => e.assignments.every((ids, i) => JSON.stringify(ids.slice().sort()) === JSON.stringify(assignments[i]))), `case ${caseNo}: returned plan is absent from independent feasible set`);
      assert.deepEqual(validateSchedule(data, actual.schedule), []);
      const cost = entry => {
        const total = entry.summary.reduce((sum, p) => sum + p.hours + (data.settings.includeHistory ? p.historyHours : 0), 0);
        const weight = entry.summary.reduce((sum, p) => sum + p.weight, 0);
        return entry.summary.reduce((sum, p) => sum + (p.hours + (data.settings.includeHistory ? p.historyHours : 0) - total * p.weight / weight) ** 2 / p.weight, 0);
      };
      const bestCost = Math.min(...expected.map(cost));
      assert.ok(Math.abs(actual.objective - bestCost) < 1e-7, `case ${caseNo}: objective differs from exhaustive oracle`);
      const preferredCount = values => values.reduce((sum, ids, i) => sum + ids.filter(staffId => data.availability.some(a => a.staffId === staffId && a.slotId === data.slots[i].id && a.preference === 2)).length, 0);
      const bestPreference = Math.max(...expected.filter(e => Math.abs(cost(e) - bestCost) < 1e-7).map(e => preferredCount(e.assignments)));
      assert.equal(preferredCount(assignments), bestPreference, `case ${caseNo}: tie-break differs from exhaustive oracle`);
    } else assert.deepEqual(actual.schedule, []);
  }
});

test('history participates in weekly day, rest and consecutive-day boundary constraints', () => {
  for (const kind of ['weekly', 'rest', 'consecutive', 'daily']) {
    const data = base();
    data.staff = data.staff.slice(0, 1);
    data.slots = [data.slots[0]];
    data.availability = [{ staffId: 'A', slotId: 'S1', preference: 1 }];
    if (kind === 'weekly') {
      data.slots[0].date = '2026-11-18';
      data.staff[0].maxDays = 1;
      data.history = [{ staffId: 'A', date: '2026-11-17', start: '09:00', end: '13:00' }];
    } else if (kind === 'rest') {
      data.settings.minRestHours = 12;
      data.history = [{ staffId: 'A', date: '2026-11-15', start: '18:00', end: '23:00' }];
    } else if (kind === 'consecutive') {
      data.settings.maxConsecutiveDays = 2;
      data.history = [14, 15].map(date => ({ staffId: 'A', date: `2026-11-${date}`, start: '09:00', end: '13:00' }));
    } else {
      data.settings.maxDailyHours = 6;
      data.history = [{ staffId: 'A', date: '2026-11-16', start: '04:00', end: '08:00' }];
    }
    assert.equal(oracle(data).length, 0, kind);
    const result = solve(data);
    assert.equal(result.status, 'infeasible', `${kind}: ${JSON.stringify(result)}`);
    assert.deepEqual(result.schedule, []);
  }
});

test('historical workload optionality cannot disable hard boundary constraints', () => {
  const data = base();
  data.staff = data.staff.slice(0, 1);
  data.slots = [data.slots[0]];
  data.availability = [{ staffId: 'A', slotId: 'S1', preference: 1 }];
  data.settings.includeHistory = false;
  data.settings.minRestHours = 12;
  data.history = [{ staffId: 'A', date: '2026-11-15', start: '18:00', end: '23:00' }];
  assert.equal(solve(data).status, 'infeasible');
});

test('weighted historical fairness matches exhaustive enumeration with unequal slot lengths', () => {
  for (const includeHistory of [true, false]) {
    const data = base();
    data.staff[1].weight = 2;
    data.slots[0].end = '10:30';
    data.slots[1].start = '10:30';
    data.slots[1].end = '12:00';
    data.slots.push({ id: 'S4', date: '2026-11-18', start: '09:00', end: '11:30', required: 1, skill: '', fixed: '' });
    data.availability.push(...data.staff.map(p => ({ staffId: p.id, slotId: 'S4', preference: 1 })));
    data.history = [{ staffId: 'A', date: '2026-11-12', start: '09:00', end: '17:00' }];
    data.settings.includeHistory = includeHistory;
    const all = oracle(data);
    const objective = entry => {
      const total = entry.summary.reduce((sum, p) => sum + p.hours + (includeHistory ? p.historyHours : 0), 0);
      const sumWeight = entry.summary.reduce((sum, p) => sum + p.weight, 0);
      return entry.summary.reduce((sum, p) => sum + (p.hours + (includeHistory ? p.historyHours : 0) - total * p.weight / sumWeight) ** 2 / p.weight, 0);
    };
    const result = solve(data);
    assert.equal(result.status, 'optimal');
    assert.ok(Math.abs(result.objective - Math.min(...all.map(objective))) < 1e-7, `includeHistory=${includeHistory}`);
    const a = result.stats.find(p => p.staffId === 'A');
    assert.equal(a.historyHours, 8);
    assert.equal(a.totalHours, a.hours + 8);
  }
});

test('120 heterogeneous time grids and fractional bounds match complete enumeration', () => {
  const fmt = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  for (let caseNo = 0; caseNo < 120; caseNo++) {
    const data = base();
    data.staff.forEach(p => {
      p.weight = [0.3, 1.25, 3][random(3)];
      p.minHours = [0, 0.25, 0.8][random(3)];
      p.maxHours = [1.1, 1.75, 4][random(3)];
    });
    data.slots.forEach((s, i) => {
      const start = [540, 660, 780][i];
      s.start = fmt(start);
      s.end = fmt(start + [30, 45, 60, 90, 135][random(5)]);
    });
    data.availability = data.availability.filter(() => random(5) > 0);
    data.history = [{ staffId: 'A', date: '2026-11-13', start: '09:00', end: '10:15' }];
    data.settings.includeHistory = Boolean(random(2));
    const all = oracle(data);
    const result = solve(data, { timeLimitMs: 5000, maxNodes: 1000000 });
    assert.equal(result.status, all.length ? 'optimal' : 'infeasible', `heterogeneous ${caseNo}: ${JSON.stringify(data)} => ${JSON.stringify(result)}`);
    if (!all.length) continue;
    const cost = entry => {
      const total = entry.summary.reduce((sum, p) => sum + p.hours + (data.settings.includeHistory ? p.historyHours : 0), 0);
      const weight = entry.summary.reduce((sum, p) => sum + p.weight, 0);
      return entry.summary.reduce((sum, p) => sum + (p.hours + (data.settings.includeHistory ? p.historyHours : 0) - total * p.weight / weight) ** 2 / p.weight, 0);
    };
    assert.ok(Math.abs(result.objective - Math.min(...all.map(cost))) < 1e-7, `heterogeneous ${caseNo}: incorrect fairness optimum`);
  }
});
