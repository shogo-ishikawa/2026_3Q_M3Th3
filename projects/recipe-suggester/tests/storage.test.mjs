import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultState, validateState, parseState, readState, writeState, localDate, STORAGE_KEY} from '../storage.js';

const data = {recipes: [{id: 'soup'}], ingredients: {carrot: {}}, allergens: [{id: 'egg'}]};
const state = () => ({...defaultState('2026-11-10'), history: [{id: 'one', date: '2026-11-09', meal: 'dinner', recipeIds: ['soup'], groups: [], proteinSources: [], note: ''}]});

test('record round trip preserves exclusions and notes as text', () => {
  const source = state();
  source.settings.allergens = ['egg'];
  source.settings.excludedIngredients = ['carrot'];
  source.history[0].note = '<img src=x onerror=alert(1)>';
  assert.deepEqual(parseState(JSON.stringify(source), data), source);
});

test('unknown allergen or ingredient cannot silently disappear on import', () => {
  for (const [key, values] of [['allergens', ['unknown']], ['excludedIngredients', ['unknown']]]) {
    const source = state(); source.settings[key] = values;
    assert.throws(() => validateState(source, data), /扱えない値/);
  }
});

test('invalid dates, duplicate ids and unknown historical recipes are rejected', () => {
  const wrongDate = state(); wrongDate.history[0].date = '2026-02-30';
  assert.throws(() => validateState(wrongDate, data));
  const duplicate = state(); duplicate.history.push({...duplicate.history[0]});
  assert.throws(() => validateState(duplicate, data));
  const unknown = state(); unknown.history[0].recipeIds = ['missing'];
  assert.throws(() => validateState(unknown, data));
});

test('malformed and oversized JSON is rejected', () => {
  assert.throws(() => parseState('{', data), /JSON/);
  assert.throws(() => parseState(' '.repeat(2 * 1024 * 1024 + 1), data), /2 MB/);
});

test('storage failure falls back to defaults without losing usability', () => {
  const broken = {getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); }};
  assert.deepEqual(readState(broken, data, '2026-11-10').state, defaultState('2026-11-10'));
  assert.equal(writeState(broken, state(), data), false);
  const memory = new Map();
  const storage = {getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value)};
  assert.equal(writeState(storage, state(), data), true);
  assert.ok(memory.has(STORAGE_KEY));
  assert.deepEqual(readState(storage, data).state, state());
});

test('local date uses calendar fields, and manual records need a name', () => {
  const fake = {getFullYear: () => 2026, getMonth: () => 10, getDate: () => 2};
  assert.equal(localDate(fake), '2026-11-02');
  const source = state(); source.history[0].recipeIds = [];
  assert.throws(() => validateState(source, data), /料理名/);
});
