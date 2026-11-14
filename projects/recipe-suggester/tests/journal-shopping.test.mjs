import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {defaultState, STORAGE_KEY} from '../storage.js';
import {itemFromRecipe} from '../nutrition.js';
import {defaultJournal, validateJournal, parseJournal, readJournal, writeJournal, JOURNAL_KEY} from '../journal.js';

const data = {allergens: ALLERGENS, ingredients: INGREDIENTS, recipes: RECIPES};
const day = '2026-11-15';
const state = () => defaultJournal(day);
const item = () => itemFromRecipe(RECIPES.find(recipe => recipe.id === 'plain-rice'), data, 1.25);
const extra = (id = 'extra-1') => ({id, item: item(), servings: 3});
const prepared = () => ({...extra(JSON.stringify(['entry-1', 'item-1'])), ingredientIds: ['rice']});
const memoryStorage = (raw) => {
  const memory = new Map(raw === undefined ? [] : [[JOURNAL_KEY, raw]]), writes = [];
  return {memory, writes, getItem: key => memory.get(key) ?? null, setItem(key, value) {writes.push(key); memory.set(key, value);}};
};

test('new shopping and meal settings start independently and distinguish no list from an empty list', () => {
  const first = state(), second = state();
  assert.deepEqual(first.shoppingExtras, []);
  assert.equal(first.shoppingList, null);
  assert.deepEqual(first.settings.shoppingOmittedIds, []);
  for (const meal of ['breakfast', 'lunch', 'dinner']) assert.deepEqual(first.settings.mealPreferences[meal], {volume:'normal', mood:'all'});
  first.settings.mealPreferences.breakfast.volume = 'light';
  first.settings.shoppingOmittedIds.push('water');
  first.shoppingExtras.push(extra());
  assert.equal(second.settings.mealPreferences.breakfast.volume, 'normal');
  assert.deepEqual(second.settings.shoppingOmittedIds, []);
  assert.deepEqual(second.shoppingExtras, []);
  second.shoppingList = [];
  assert.deepEqual(parseJournal(JSON.stringify(second), data).shoppingList, []);
});

test('meal preferences, omission settings and prepared shopping source snapshots round trip without recalculation', () => {
  const source = state();
  source.settings.mealPreferences = {
    breakfast:{volume:'light', mood:'時短'}, lunch:{volume:'hearty', mood:'ガッツリ'}, dinner:{volume:'normal', mood:'さっぱり'},
  };
  source.settings.shoppingOmittedIds = ['water', 'salt'];
  const saved = item();
  saved.nutrition = {...saved.nutrition, kcal:123.456789, salt:null};
  saved.ingredients[0].amount = 155.6789;
  source.shoppingExtras = [{id:'menu-extra', item:saved, servings:4}];
  source.shoppingList = [{id:'selected-extra', item:structuredClone(saved), servings:2, ingredientIds:['rice']}];
  const before = structuredClone(source), storage = memoryStorage();
  assert.equal(writeJournal(storage, source, data), true);
  assert.deepEqual(readJournal(storage, data, day).state, source);
  const loaded = parseJournal(JSON.stringify(source), data);
  assert.deepEqual(loaded, before);
  loaded.shoppingList[0].item.nutrition.kcal = 999;
  assert.deepEqual(source, before);
});

test('old v3 data gains safe shopping defaults and copies previous global mood into all three meals', () => {
  const source = state();
  delete source.shoppingExtras;
  delete source.shoppingList;
  delete source.settings.shoppingOmittedIds;
  delete source.settings.mealPreferences;
  source.settings.preferences.mood = '時短';
  const before = structuredClone(source), storage = memoryStorage(JSON.stringify(source));
  const loaded = readJournal(storage, data, day);
  assert.equal(loaded.recovery, null);
  assert.deepEqual(loaded.state.shoppingExtras, []);
  assert.equal(loaded.state.shoppingList, null);
  assert.deepEqual(loaded.state.settings.shoppingOmittedIds, []);
  for (const meal of ['breakfast', 'lunch', 'dinner']) assert.deepEqual(loaded.state.settings.mealPreferences[meal], {volume:'normal', mood:'時短'});
  assert.deepEqual(source, before);
  assert.deepEqual(storage.writes, []);
});

test('v1 and v2 migration add shopping defaults and preserve their old mood', () => {
  const old = defaultState(day);
  old.settings.preferences.mood = 'さっぱり';
  const legacy = validateJournal(old, data);
  assert.equal(legacy.shoppingList, null);
  assert.deepEqual(legacy.shoppingExtras, []);
  assert.equal(legacy.settings.mealPreferences.breakfast.mood, 'さっぱり');
  const v2 = {version:2, settings:{...old.settings, meal:'lunch',stapleId:'auto',drinkId:'none'}, entries:[],customRecipes:[],pantry:[],targets:state().targets,shoppingChecks:[]};
  const migrated = validateJournal(v2, data);
  assert.equal(migrated.shoppingList, null);
  assert.deepEqual(migrated.shoppingExtras, []);
  assert.equal(migrated.settings.mealPreferences.dinner.mood, 'さっぱり');
});

test('shopping source snapshots keep historical unknown ingredients and recipe IDs for explicit warnings', () => {
  const source = state(), saved = item();
  saved.recipeId = 'recipe-removed-from-db';
  saved.ingredients = [{id:'historical-ingredient', amount:23.4567}];
  source.shoppingExtras = [{id:'old-menu',item:saved,servings:1}];
  source.shoppingList = [{id:'old-menu',item:structuredClone(saved),servings:2,ingredientIds:['historical-ingredient']}];
  assert.deepEqual(parseJournal(JSON.stringify(source), data), source);
});

test('malformed meal profiles, omissions or shopping data cannot overwrite a saved original', () => {
  const mutations = [
    value => {value.settings.mealPreferences = null;},
    value => {delete value.settings.mealPreferences.breakfast;},
    value => {value.settings.mealPreferences.breakfast.volume = 'unlimited';},
    value => {value.settings.mealPreferences.lunch.mood = 'unknown';},
    value => {value.settings.mealPreferences.dinner.extra = true;},
    value => {value.settings.shoppingOmittedIds = ['missing-ingredient'];},
    value => {value.settings.shoppingOmittedIds = null;},
    value => {value.shoppingExtras = [extra(), extra()];},
    value => {value.shoppingExtras = [{...extra(), servings:1.5}];},
    value => {value.shoppingExtras = [{...extra(), servings:0}];},
    value => {value.shoppingExtras = [{...extra(), servings:9}];},
    value => {value.shoppingExtras = [{...extra(), other:true}];},
    value => {value.shoppingExtras = Array.from({length:201}, (_,i) => extra('menu-'+i));},
    value => {value.shoppingList = [{...prepared(), ingredientIds:['salt']}];},
    value => {value.shoppingList = [{...prepared(), ingredientIds:undefined}];},
    value => {value.shoppingList = [prepared(), prepared()];},
    value => {value.shoppingList = [{...prepared(), id:'x'.repeat(501)}];},
    value => {value.shoppingList = [{...prepared(), item:{...item(),quantity:0}}];},
  ];
  for (const mutate of mutations) {
    const source = state(); mutate(source);
    const raw = JSON.stringify(source), storage = memoryStorage(raw);
    assert.throws(() => parseJournal(raw, data));
    const loaded = readJournal(storage, data, day);
    assert.deepEqual(loaded.recovery, {key:JOURNAL_KEY, raw});
    assert.equal(writeJournal(storage, state(), data), false);
    assert.equal(storage.memory.get(JOURNAL_KEY), raw);
    assert.deepEqual(storage.writes, []);
  }
});

test('shopping selection identifiers support compound entry/item keys without altering item identity', () => {
  const source = state(), saved = item();
  const id = JSON.stringify(['e'.repeat(120), 'i'.repeat(120)]);
  source.shoppingList = [{id, item:saved, servings:1, ingredientIds:['rice']}];
  const loaded = validateJournal(source, data);
  assert.equal(loaded.shoppingList[0].id, id);
  assert.equal(loaded.shoppingList[0].item.id, saved.id);
});
