import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultState, STORAGE_KEY} from '../storage.js';
import {JOURNAL_KEY, PREVIOUS_JOURNAL_KEY, DEFAULT_PROFILE, NUTRIENT_KEYS, DEFAULT_TARGETS, defaultJournal, validateJournal, parseJournal, readJournal, writeJournal, dateKey, dateIsValid, monthIsValid, monthCells, shiftDate, entriesForDay} from '../journal.js';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {deriveReference, AGE_BANDS, SEX_OPTIONS, ACTIVITY_OPTIONS} from '../dietary-reference.js';

const all = (kcal, protein = 0, fat = 0, carbs = 0, fiber = 0, salt = 0) => ({kcal, protein, fat, carbs, fiber, salt});
const unknown = () => Object.fromEntries(NUTRIENT_KEYS.map(key => [key, null]));
const data = {
  allergens: [{id: 'egg'}, {id: 'milk'}, {id: 'soy'}],
  ingredients: {
    carrot: {name: 'にんじん', unit: 'g', allergens: [], groups: ['vegetable'], proteinSources: [], nutritionPerUnit: all(0.4, 0.01, 0, 0.08, 0.02)},
    milk: {name: '牛乳', unit: 'ml', allergens: ['milk'], groups: ['dairy'], proteinSources: [], nutritionPerUnit: all(0.6, 0.03, 0.04, 0.04, 0, 0.001)},
    butter: {name: 'バター', unit: 'g', allergens: [], groups: [], proteinSources: [], derivedFrom: ['milk'], nutritionPerUnit: {...all(7.2, 0.01, 0.8), salt: null}},
    rice: {name: 'ご飯', unit: 'g', allergens: [], groups: ['staple'], proteinSources: []},
  },
  recipes: [
    {id: 'soup', name: 'にんじんスープ', role: 'soup', servings: 2, minutes: 10, staple: false, ingredients: [{id: 'carrot', amount: 100}, {id: 'milk', amount: 200}], steps: ['材料を煮る。']},
    {id: 'buttered', name: 'にんじんのバター蒸し', role: 'side', servings: 2, minutes: 10, staple: false, ingredients: [{id: 'carrot', amount: 100}, {id: 'butter', amount: 10}], steps: ['材料を蒸す。']},
    {id: 'rice', name: 'ご飯', role: 'staple', servings: 1, minutes: 1, staple: true, ingredients: [{id: 'rice', amount: 150}], steps: ['器に盛る。']},
    {id: 'glass-milk', name: '牛乳', role: 'drink', servings: 1, minutes: 1, staple: false, ingredients: [{id: 'milk', amount: 200}], steps: ['グラスに注ぐ。']},
  ],
};
const state = () => defaultJournal('2026-11-12');
const item = (id = 'item-one') => ({id, recipeId: 'deleted-recipe', name: '記録した料理', quantity: 1.5, nutrition: {...all(120, 5, 4, 20, 2, 0.7), fiber: null}, ingredients: [{id: 'carrot', amount: 20}], groups: ['vegetable'], proteinSources: [], allergens: [], allergensKnown: true, ingredientsKnown: true, steps: ['盛り付ける。'], role: 'side'});
const entry = (id = 'entry-one') => ({id, date: '2026-11-12', meal: 'dinner', status: 'eaten', note: '', items: [item(`item-${id}`)]});
const custom = (id = 'custom-one') => ({id, name: 'マイメニュー', role: 'snack'});
const legacyState = () => ({...defaultState('2026-11-12'), history: [{id: 'old-one', date: '2026-11-10', meal: 'lunch', recipeIds: ['soup'], groups: ['protein'], proteinSources: ['soy'], note: 'お弁当にした'}]});
const memoryStorage = (pairs = []) => {
  const memory = new Map(pairs);
  const writes = [];
  return {memory, writes, getItem: key => memory.get(key) ?? null, setItem(key, value) {writes.push(key); memory.set(key, value);}};
};

test('defaults are independent and comparison targets are illustrative editable values', () => {
  const source = state();
  assert.equal(source.version, 3);
  assert.deepEqual(source.targets, DEFAULT_TARGETS);
  assert.equal(source.settings.meal, 'dinner');
  assert.equal(source.settings.stapleId, 'auto');
  assert.equal(source.settings.drinkId, 'none');
  source.targets.kcal = 1800;
  source.settings.allergens.push('milk');
  assert.equal(state().targets.kcal, 2000);
  assert.deepEqual(state().settings.allergens, []);
  assert.deepEqual(validateJournal(state(), data), state());
});

test('v3 round trip preserves multiple foods, quantities, nullable snapshots, pantry and checkboxes', () => {
  const source = state();
  source.entries = [entry()];
  source.entries[0].items.push({...item('item-two'), role: 'drink', quantity: 0.5, recipeId: null});
  source.settings = {...source.settings, meal: 'breakfast', stapleId: 'rice', drinkId: 'glass-milk', allergens: ['egg'], excludedIngredients: ['butter']};
  source.pantry = [{id: 'carrot', amount: 70}, {id: 'milk', amount: 0}];
  source.targets = {...source.targets, kcal: 1800, salt: 0};
  source.shoppingChecks = ['carrot', 'milk'];
  const imported = parseJournal(JSON.stringify(source), data);
  assert.deepEqual(imported, source);
  assert.equal(imported.entries[0].items[0].nutrition.fiber, null);
  imported.entries[0].items[0].nutrition.kcal = 999;
  assert.equal(source.entries[0].items[0].nutrition.kcal, 120);
});

test('snapshots survive deletion of recipe and historical ingredient references', () => {
  const source = state();
  source.entries = [entry()];
  source.entries[0].items[0].ingredients = [{id: 'deleted-ingredient', amount: 3}];
  const loaded = validateJournal(source, data);
  assert.equal(loaded.entries[0].items[0].recipeId, 'deleted-recipe');
  assert.equal(loaded.entries[0].items[0].ingredients[0].id, 'deleted-ingredient');
  assert.equal(loaded.entries[0].items[0].nutrition.kcal, 120);
});

test('manual recipes have nullable nutrition and unverified allergy and ingredient defaults', () => {
  const source = state();
  source.customRecipes = [custom()];
  const recipe = validateJournal(source, data).customRecipes[0];
  assert.deepEqual(recipe.manualNutrition, unknown());
  assert.deepEqual(recipe.ingredients, []);
  assert.deepEqual(recipe.steps, ['調理方法は未登録です。']);
  assert.equal(recipe.allergensKnown, false);
  assert.equal(recipe.ingredientsKnown, false);
  assert.equal(recipe.custom, true);
  assert.equal(recipe.servings, 1);
  assert.equal(recipe.genre, 'その他');
});

test('all six custom roles are supported and incomplete manual nutrient fields stay unknown', () => {
  const source = state();
  source.customRecipes = ['main', 'side', 'soup', 'staple', 'drink', 'snack'].map(role => ({...custom(`custom-${role}`), role, manualNutrition: {kcal: 100, protein: null}}));
  source.settings.stapleId = 'custom-staple';
  source.settings.drinkId = 'custom-drink';
  const loaded = validateJournal(source, data);
  assert.deepEqual(loaded.customRecipes.map(recipe => recipe.role), ['main', 'side', 'soup', 'staple', 'drink', 'snack']);
  assert.equal(loaded.customRecipes[0].manualNutrition.carbs, null);
  assert.equal(loaded.customRecipes[0].manualNutrition.protein, null);
  assert.equal(loaded.customRecipes[0].manualNutrition.kcal, 100);
});

test('known custom materials inherit all ancestor allergens alongside manually selected allergens', () => {
  const source = state();
  source.customRecipes = [{...custom(), ingredients: [{id: 'butter', amount: 5}], ingredientsKnown: true, allergensKnown: true, allergens: ['soy']}];
  const recipe = validateJournal(source, data).customRecipes[0];
  assert.deepEqual(recipe.allergens, ['soy', 'milk']);
  assert.deepEqual(recipe.groups, []); // バターは乳を含みますが乳製品1食分とは数えません。
});

test('custom condiment metadata inherits ancestor allergens without ancestor food-group servings', () => {
  const builtin={allergens:ALLERGENS,ingredients:INGREDIENTS,recipes:RECIPES};
  const source=state();
  source.customRecipes=[{...custom(),ingredients:[{id:'soy_sauce',amount:10},{id:'miso',amount:10},{id:'butter',amount:5}],ingredientsKnown:true,allergensKnown:true}];
  const recipe=validateJournal(source,builtin).customRecipes[0];
  assert.deepEqual(recipe.groups,[]);
  assert.deepEqual(recipe.proteinSources,[]);
  for(const allergen of ['soy','wheat','milk'])assert.ok(recipe.allergens.includes(allergen));
});

test('legacy recipe migration does not turn condiments into a protein-source meal', () => {
  const seasoning={id:'seasoning-only',name:'調味料の確認用',role:'side',servings:1,ingredients:[{id:'soy_sauce',amount:10}],steps:['確認する。']};
  const builtin={allergens:ALLERGENS,ingredients:INGREDIENTS,recipes:[...RECIPES,seasoning]};
  const source=defaultState('2026-11-12');
  source.history=[{id:'old-seasoning',date:'2026-11-11',meal:'dinner',recipeIds:['seasoning-only'],groups:[],proteinSources:[],note:''}];
  const snapshot=validateJournal(source,builtin).entries[0].items[0];
  assert.deepEqual(snapshot.groups,[]);
  assert.deepEqual(snapshot.proteinSources,[]);
  assert.ok(snapshot.allergens.includes('soy'));
});

test('custom IDs cannot duplicate one another or overwrite a built-in record', () => {
  const duplicate = state(); duplicate.customRecipes = [custom(), custom()];
  assert.throws(() => validateJournal(duplicate, data), /識別子/);
  const collision = state(); collision.customRecipes = [custom('custom-builtin')];
  assert.throws(() => validateJournal(collision, {...data, recipes: [...data.recipes, {id: 'custom-builtin'}]}), /識別子/);
  const wrong = state(); wrong.customRecipes = [custom('soup')];
  assert.throws(() => validateJournal(wrong, data), /識別子/);
});

test('v1 migration preserves allergies, exclusions, preferences and recipe notes and metadata', () => {
  const source = legacyState();
  source.settings.allergens = ['milk'];
  source.settings.excludedIngredients = ['butter'];
  source.settings.preferences = {...source.settings.preferences, genreMode: 'single', genre: '和食', preferredIngredients: ['carrot']};
  const migrated = parseJournal(JSON.stringify(source), data);
  assert.deepEqual(migrated.settings, {...source.settings, meal: 'dinner', stapleId: 'auto', drinkId: 'none', stapleAmount: null, drinkAmount: null});
  const record = migrated.entries[0];
  assert.equal(record.status, 'eaten');
  assert.equal(record.note, 'お弁当にした');
  assert.equal(record.items[0].recipeId, 'soup');
  assert.equal(record.items[0].quantity, 1);
  assert.deepEqual(record.items[0].ingredients, [{id: 'carrot', amount: 50}, {id: 'milk', amount: 100}]);
  assert.equal(record.items[0].nutrition.kcal, 80);
  assert.equal(record.items[0].nutrition.protein, 3.5);
  assert.deepEqual(record.items[0].allergens, ['milk']);
  assert.ok(record.items[0].groups.includes('protein'));
  assert.deepEqual(record.items[0].proteinSources, ['soy']);
});

test('v1 without preferences gets old defaults while missing nutrient fields remain null', () => {
  const source = legacyState(); delete source.settings.preferences;
  source.history[0].recipeIds = ['buttered'];
  const record = validateJournal(source, data).entries[0];
  assert.equal(record.items[0].nutrition.kcal, 56);
  assert.equal(record.items[0].nutrition.salt, null);
  assert.equal(record.items[0].allergens.includes('milk'), true);
  assert.equal(validateJournal(source, data).settings.preferences.genreMode, 'any');
});

test('v1 manual notes and deleted recipes become unknown snapshots without invented zero nutrition', () => {
  const source = legacyState();
  source.history = [
    {...source.history[0], recipeIds: [], note: '外で食べたサンドイッチ'},
    {...source.history[0], id: 'old-two', recipeIds: ['gone'], note: '当時の記録'},
    {...source.history[0], id: 'old-three', recipeIds: ['rice'], note: ''},
  ];
  const loaded = validateJournal(source, data);
  assert.equal(loaded.entries[0].items[0].name, '外で食べたサンドイッチ');
  assert.equal(loaded.entries[0].items[0].recipeId, null);
  assert.deepEqual(loaded.entries[0].items[0].nutrition, unknown());
  assert.equal(loaded.entries[0].items[0].allergensKnown, false);
  assert.equal(loaded.entries[0].items[0].ingredientsKnown, false);
  assert.equal(loaded.entries[1].items[0].recipeId, 'gone');
  assert.deepEqual(loaded.entries[1].items[0].nutrition, unknown());
  assert.deepEqual(loaded.entries[2].items[0].nutrition, unknown());
});

test('legacy local storage is read without writing or deleting either original key', () => {
  const raw = JSON.stringify(legacyState());
  const storage = memoryStorage([[STORAGE_KEY, raw]]);
  const loaded = readJournal(storage, data, '2026-11-12');
  assert.equal(loaded.state.version, 3);
  assert.match(loaded.message, /引き継ぎ/);
  assert.deepEqual(storage.writes, []);
  assert.equal(storage.memory.get(STORAGE_KEY), raw);
  assert.equal(storage.memory.has(JOURNAL_KEY), false);
  assert.equal(writeJournal(storage, loaded.state, data), true);
  assert.deepEqual(storage.writes, [JOURNAL_KEY]);
  assert.equal(storage.memory.get(STORAGE_KEY), raw);
  assert.deepEqual(readJournal(storage, data).state, loaded.state);
});

test('invalid current storage warns and preserves raw content without reverting to stale v1 data', () => {
  const storage = memoryStorage([[JOURNAL_KEY, '{broken'], [STORAGE_KEY, JSON.stringify(legacyState())]]);
  const loaded = readJournal(storage, data, '2026-11-12');
  assert.deepEqual(loaded.state, state());
  assert.match(loaded.message, /元の保存データ/);
  assert.match(loaded.message, /アレルギー/);
  assert.equal(storage.memory.get(JOURNAL_KEY), '{broken');
  assert.deepEqual(storage.writes, []);
});

test('unavailable storage remains usable and rejected imports never call storage writes', () => {
  const broken = {getItem() {throw new Error('blocked');}, setItem() {throw new Error('quota');}};
  assert.deepEqual(readJournal(broken, data, '2026-11-12').state, state());
  assert.equal(writeJournal(broken, state(), data), false);
  const storage = memoryStorage();
  const invalid = state(); invalid.settings.allergens = ['unrecognised'];
  assert.throws(() => writeJournal(storage, invalid, data));
  assert.deepEqual(storage.writes, []);
});

test('unknown fields and prototype pollution payloads are rejected at every level', () => {
  for (const mutate of [
    source => {source.extra = true;},
    source => {source.settings.secret = 'bad';},
    source => {source.settings.preferences.secret = 'bad';},
    source => {source.entries = [{...entry(), extra: true}];},
    source => {source.entries = [entry()]; source.entries[0].items[0].nutrition.extra = 3;},
    source => {source.pantry = [{id: 'carrot', amount: 1, unit: 'g'}];},
    source => {source.customRecipes = [{...custom(), url: 'https://example.com'}];},
  ]) {
    const source = state(); mutate(source);
    assert.throws(() => validateJournal(source, data));
  }
  const malicious = JSON.stringify(state()).replace('"version":3', '"version":3,"__proto__":{"polluted":true}');
  assert.throws(() => parseJournal(malicious, data));
  const inherited = Object.assign(Object.create({polluted: true}), state());
  assert.throws(() => validateJournal(inherited, data));
  const accessor = state(); Object.defineProperty(accessor, 'extra', {enumerable: true, get() {throw new Error('accessed');}});
  assert.throws(() => validateJournal(accessor, data), error => !error.message.includes('accessed'));
  assert.equal({}.polluted, undefined);
});

test('invalid dates, roles, states, duplicate identifiers and unsafe numeric values are rejected', () => {
  for (const mutate of [
    source => {source.entries[0].date = '2026-02-30';},
    source => {source.entries[0].meal = 'brunch';},
    source => {source.entries[0].status = 'unknown';},
    source => {source.entries[0].items[0].quantity = '1';},
    source => {source.entries[0].items[0].quantity = 0;},
    source => {source.entries[0].items[0].nutrition.salt = -1;},
    source => {source.entries[0].items[0].nutrition.kcal = Infinity;},
    source => {delete source.entries[0].items[0].nutrition.salt;},
    source => {source.entries.push({...entry(), items: [item('other')]});},
    source => {source.entries[0].items.push({...source.entries[0].items[0]});},
    source => {source.pantry = [{id: 'carrot', amount: -1}];},
    source => {source.pantry = [{id: 'carrot', amount: 1}, {id: 'carrot', amount: 2}];},
    source => {source.settings.drinkId = 'soup';},
    source => {source.targets.fiber = null;},
  ]) {
    const source = state(); source.entries = [entry()]; mutate(source);
    assert.throws(() => validateJournal(source, data));
  }
});

test('invalid custom recipe metadata and ingredient references cannot be imported', () => {
  for (const mutate of [
    recipe => {recipe.servings = 2;},
    recipe => {recipe.ingredients = [{id: 'missing', amount: 2}];},
    recipe => {recipe.ingredientsKnown = true;},
    recipe => {recipe.allergensKnown = 'yes';},
    recipe => {recipe.manualNutrition = {kcal: -1};},
    recipe => {recipe.steps = 'mix';},
    recipe => {recipe.steps = null;},
  ]) {
    const source = state(); const recipe = custom(); mutate(recipe); source.customRecipes = [recipe];
    assert.throws(() => validateJournal(source, data));
  }
});

test('malformed, oversized and excessive array inputs are bounded', () => {
  assert.throws(() => parseJournal('{', data), /JSON/);
  assert.throws(() => parseJournal(' '.repeat(2 * 1024 * 1024 + 1), data), /2 MB/);
  const source = state(); source.customRecipes = Array.from({length: 501}, (_, i) => custom(`custom-${i}`));
  assert.throws(() => validateJournal(source, data), /件数/);
  const sparse = state(); sparse.shoppingChecks = Array(1);
  assert.throws(() => validateJournal(sparse, data));
});

test('calendar date helpers use local fields and UTC-safe calendar arithmetic', () => {
  const fake = {getFullYear: () => 2026, getMonth: () => 10, getDate: () => 2};
  assert.equal(dateKey(fake), '2026-11-02');
  assert.equal(dateIsValid('2024-02-29'), true);
  for (const date of ['2026-02-29', '2026-02-30', '2026-1-01', '1999-12-31', '2101-01-01']) assert.equal(dateIsValid(date), false);
  assert.equal(monthIsValid('2026-11'), true);
  assert.equal(monthIsValid('2026-13'), false);
  assert.equal(shiftDate('2024-02-28', 1), '2024-02-29');
  assert.equal(shiftDate('2026-11-01', -1), '2026-10-31');
  assert.throws(() => shiftDate('2000-01-01', -1));
  assert.throws(() => shiftDate('2026-11-12', 0.5));
  const cells = monthCells('2026-11');
  assert.equal(cells.length, 42);
  assert.deepEqual(cells[0], {date: '2026-10-26', inMonth: false});
  assert.deepEqual(cells[6], {date: '2026-11-01', inMonth: true});
  assert.equal(cells.at(-1).date, '2026-12-06');
  assert.equal(monthCells('2000-01')[0].date, '1999-12-27');
  assert.throws(() => monthCells('2026-13'));
});

test('daily entries retain multiple records and sort in meal order without changing source order', () => {
  const records = ['dinner', 'snack', 'breakfast', 'lunch'].map((meal, i) => ({...entry(`entry-${i}`), meal}));
  records.push({...entry('other-day'), date: '2026-11-13'});
  assert.deepEqual(entriesForDay(records, '2026-11-12').map(record => record.meal), ['breakfast', 'lunch', 'dinner', 'snack']);
  assert.equal(records[0].meal, 'dinner');
  assert.deepEqual(entriesForDay(records, '2026-02-30'), []);
});


test('v2 JSON migration retains snapshots and personal database without inventing a profile or portions', () => {
  const current = state(); current.entries = [entry()]; current.customRecipes = [custom()];
  current.settings.allergens = ['milk']; current.settings.excludedIngredients = ['butter'];
  current.pantry = [{id: 'milk', amount: 50}]; current.shoppingChecks = ['milk'];
  const legacy = structuredClone(current); legacy.version = 2;
  delete legacy.profile; delete legacy.completedDays; delete legacy.settings.stapleAmount; delete legacy.settings.drinkAmount;
  const sourceText = JSON.stringify(legacy);
  const migrated = parseJournal(sourceText, data);
  assert.equal(migrated.version, 3);
  assert.deepEqual(migrated.profile, DEFAULT_PROFILE);
  assert.deepEqual(migrated.completedDays, []);
  assert.deepEqual(migrated.entries, current.entries);
  assert.equal(migrated.customRecipes[0].name, 'マイメニュー');
  assert.deepEqual(migrated.settings.allergens, ['milk']);
  assert.deepEqual(migrated.settings.excludedIngredients, ['butter']);
  assert.equal(migrated.settings.stapleAmount, null);
  assert.equal(migrated.settings.drinkAmount, null);
  assert.equal(JSON.stringify(legacy), sourceText);
  const storage = memoryStorage([[PREVIOUS_JOURNAL_KEY, sourceText], [STORAGE_KEY, JSON.stringify(legacyState())]]);
  const loaded = readJournal(storage, data);
  assert.equal(loaded.state.entries[0].id, 'entry-one');
  assert.match(loaded.message, /引き継ぎ/);
  assert.deepEqual(storage.writes, []);
  writeJournal(storage, loaded.state, data);
  assert.equal(storage.memory.get(PREVIOUS_JOURNAL_KEY), sourceText);
  assert.ok(storage.memory.has(STORAGE_KEY));
  assert.ok(storage.memory.has(JOURNAL_KEY));
});

test('v3 round trip preserves confirmed days, profile, explicit amounts and historical portion units', () => {
  const source = state(); source.entries = [entry()];
  source.profile = {ageBand: '65-74', sex: 'female', activity: 'moderate', mode: 'reference'};
  source.targets = {...deriveReference(source.profile).targets};
  source.completedDays = ['2026-11-12']; source.settings.stapleId = 'rice'; source.settings.stapleAmount = 80;
  source.settings.drinkId = 'glass-milk'; source.settings.drinkAmount = 250;
  source.entries[0].items[0].portion = {amount: 150, unit: 'g', label: '炊いたご飯'};
  source.customRecipes = [{...custom(), family: 'onigiri', variantLabel: '梅', portion: {amount: 1, unit: '個'}, mealBase: false}];
  const clean = parseJournal(JSON.stringify(source), data);
  assert.deepEqual(clean.profile, source.profile);
  assert.deepEqual(clean.completedDays, source.completedDays);
  assert.equal(clean.settings.stapleAmount, 80);
  assert.equal(clean.settings.drinkAmount, 250);
  assert.deepEqual(clean.entries[0].items[0].portion, source.entries[0].items[0].portion);
  assert.equal(clean.customRecipes[0].family, 'onigiri');
  assert.deepEqual(clean.customRecipes[0].portion, {amount: 1, unit: '個'});
  assert.equal(clean.customRecipes[0].mealBase, false);
});

test('invalid v3 profiles, portion metadata and confirmed-day lists fail without modifying stored values', () => {
  for (const mutate of [
    source => {source.profile.sex = 'other';},
    source => {source.profile.ageBand = 'child';},
    source => {source.profile.activity = 'extreme';},
    source => {source.profile.mode = 'automatic';},
    source => {source.profile.privateNote = 'bad';},
    source => {source.completedDays = ['2026-11-12', '2026-11-12'];},
    source => {source.completedDays = ['2026-02-30'];},
    source => {source.settings.stapleAmount = 0;},
    source => {source.settings.drinkAmount = '250';},
    source => {source.entries[0].items[0].portion = {amount: 1, unit: 'kg'};},
    source => {source.entries[0].items[0].portion = {amount: -1, unit: '個'};},
    source => {source.customRecipes = [{...custom(), family: 'unregistered'}];},
    source => {source.customRecipes = [{...custom(), mealBase: 'yes'}];},
  ]) {
    const source = state(); source.entries = [entry()]; mutate(source);
    const storage = memoryStorage(); assert.throws(() => writeJournal(storage, source, data));
    assert.deepEqual(storage.writes, []);
  }
  const invalidV2 = {...state(), version: 2};
  assert.throws(() => validateJournal(invalidV2, data));
  const broken = memoryStorage([[PREVIOUS_JOURNAL_KEY, '{broken'], [STORAGE_KEY, JSON.stringify(legacyState())]]);
  assert.match(readJournal(broken, data).message, /元の保存データ/);
  assert.deepEqual(broken.writes, []);
});


test('reference mode accepts only available profiles and their canonical comparison values', () => {
  let checked = 0;
  for (const age of AGE_BANDS) for (const sex of SEX_OPTIONS) for (const activity of ACTIVITY_OPTIONS) {
    const source = state(); source.profile = {ageBand: age.id, sex: sex.id, activity: activity.id, mode: 'reference'};
    const reference = deriveReference(source.profile);
    if (!reference) {assert.throws(() => validateJournal(source, data), /比較値を使えません/); continue;}
    source.targets = {...reference.targets};
    assert.deepEqual(validateJournal(source, data).targets, reference.targets);
    source.targets.fat += 5e-7;
    assert.deepEqual(validateJournal(source, data).targets, reference.targets); // normalise an insignificant arithmetic round-off
    checked++;
  }
  assert.equal(checked, 28);
});

test('reference mode rejects incomplete profiles and forged targets before any storage write', () => {
  for (const field of ['ageBand', 'sex', 'activity']) {
    const source = state(); source.profile = {ageBand: '18-29', sex: 'male', activity: 'moderate', mode: 'reference'};
    source.targets = {...deriveReference(source.profile).targets}; source.profile[field] = 'unset';
    const storage = memoryStorage();
    assert.throws(() => writeJournal(storage, source, data), /比較値を使えません/);
    assert.deepEqual(storage.writes, []);
  }
  for (const key of NUTRIENT_KEYS) {
    const source = state(); source.profile = {ageBand: '18-29', sex: 'male', activity: 'moderate', mode: 'reference'};
    source.targets = {...deriveReference(source.profile).targets}; source.targets[key] += 0.01;
    const storage = memoryStorage();
    assert.throws(() => writeJournal(storage, source, data), /一致しません/);
    assert.deepEqual(storage.writes, []);
    assert.throws(() => parseJournal(JSON.stringify(source), data), /一致しません/);
  }
  const manual = state(); manual.targets = {kcal: 1750, protein: 55, fat: 42, carbs: 220, fiber: 25, salt: 4};
  assert.deepEqual(validateJournal(manual, data).targets, manual.targets);
});
