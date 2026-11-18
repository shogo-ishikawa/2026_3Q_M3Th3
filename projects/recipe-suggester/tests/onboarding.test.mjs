import test from 'node:test';
import assert from 'node:assert/strict';
import {RECIPES, INGREDIENTS, ALLERGENS} from '../data.js';
import {defaultJournal, readJournal, validateJournal, writeJournal, JOURNAL_KEY, PREVIOUS_JOURNAL_KEY} from '../journal.js';
import {STORAGE_KEY} from '../storage.js';
import {commonPantryIds} from '../shopping-categories.js';
import {buildShoppingChecklist} from '../shopping-workflow.js';
import {applyQuickSetup, demoStorage, showFirstVisit} from '../onboarding.js';

const data = {recipes: RECIPES, ingredients: INGREDIENTS, allergens: ALLERGENS};
const day = '2026-01-03';

test('sample week crosses year boundaries and has a usable plan, checklist and pantry', () => {
  const storage = demoStorage(data, day);
  const {state, message} = readJournal(storage, data, day);
  assert.equal(message, '');
  assert.equal(state.completedDays[0], '2025-12-28');
  assert.equal(state.completedDays[6], day);
  assert.equal(state.entries.filter(entry => entry.status === 'eaten').length, 21);
  assert.equal(state.entries.find(entry => entry.status === 'planned').date, '2026-01-04');
  assert.ok(state.pantry.length);
  const checklist = buildShoppingChecklist(state.shoppingList, data, {pantry: state.pantry, omittedIds: state.settings.shoppingOmittedIds});
  assert.ok(checklist.items.length > 0);
  state.entries = [];
  assert.equal(writeJournal(storage, state, data), true);
  assert.equal(readJournal(storage, data).state.entries.length, 0);
  assert.equal(readJournal(demoStorage(data, day), data).state.entries.length, 22);
});

test('fresh visit hint respects existing journals including old or corrupt bytes and unavailable storage', () => {
  assert.equal(showFirstVisit({getItem: () => null}), true);
  for (const existing of [JOURNAL_KEY, PREVIOUS_JOURNAL_KEY, STORAGE_KEY, 'meal-palette-welcome-v4']) {
    assert.equal(showFirstVisit({getItem: key => key === existing ? '' : null}), false);
  }
  assert.equal(showFirstVisit({getItem() { throw Error('blocked'); }}), false);
});

test('quick setup retains untouched profile and partial pantry selections, and removes conflicting preferences', () => {
  const state = defaultJournal(day);
  state.settings.shoppingOmittedIds = ['egg', 'salt'];
  state.settings.preferences.preferredIngredients = ['onion', 'egg'];
  const draft = {allergens: new Set(['milk']), excluded: new Set(['egg']), omitCommon: null, profile: null};
  applyQuickSetup(state, draft, data);
  assert.deepEqual(state.settings.shoppingOmittedIds, ['egg', 'salt']);
  assert.deepEqual(state.settings.excludedIngredients, ['egg']);
  assert.deepEqual(state.settings.preferences.preferredIngredients, ['onion']);
  assert.deepEqual(state.profile, defaultJournal(day).profile);
  draft.omitCommon = true;
  draft.profile = {ageBand:'30-49', sex:'female', activity:'moderate', mode:'reference'};
  applyQuickSetup(state, draft, data);
  for (const id of commonPantryIds(data)) assert.ok(state.settings.shoppingOmittedIds.includes(id));
  assert.equal(validateJournal(state, data).profile.mode, 'reference');
  draft.omitCommon = false;
  applyQuickSetup(state, draft, data);
  assert.deepEqual(state.settings.shoppingOmittedIds, ['egg']);
});
