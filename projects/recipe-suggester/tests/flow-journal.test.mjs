import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultState} from '../storage.js';
import {defaultJournal, validateJournal, parseJournal, readJournal, writeJournal, JOURNAL_KEY} from '../journal.js';
import {itemFromRecipe} from '../nutrition.js';

const nutrition = {kcal: 1.56, protein: 0.025, fat: 0.003, carbs: 0.371, fiber: 0.015, salt: 0};
const data = {allergens: [], ingredients: {
  rice: {name: 'ご飯', unit: 'g', allergens: [], groups: ['staple'], proteinSources: [], nutritionPerUnit: nutrition},
}, recipes: [{id: 'rice', name: 'ご飯', role: 'staple', servings: 1, minutes: 1, staple: true, ingredients: [{id: 'rice', amount: 150}], steps: ['器に盛る。']}]};
const state = () => defaultJournal('2026-11-13');
const entry = (meal, index) => ({id: `entry-${index}`, date: '2026-11-13', meal, status: 'planned', note: '', items: [
  {...itemFromRecipe(data.recipes[0], data), id: `item-${index}`},
]});

test('3食の一括指定は設定だけに保存し、各食事の記録は朝・昼・晩に分ける', () => {
  const source = state();
  source.settings.meal = 'all';
  source.settings.stapleMode = 'adaptive';
  source.entries = ['breakfast', 'lunch', 'dinner'].map(entry);
  assert.deepEqual(parseJournal(JSON.stringify(source), data), source);
  assert.equal(source.version, 3);
  assert.equal(JOURNAL_KEY, 'kondate-note-v3');
  source.entries[1].meal = 'all';
  assert.throws(() => validateJournal(source, data), /食事区分/);
  source.entries[1].meal = 'snack';
  assert.equal(validateJournal(source, data).entries[1].meal, 'snack');
});

test('モード未指定の旧v3は主食の指定と量を含めて同じJSONの形で読み込める', () => {
  for (const stapleId of ['auto', 'none', 'rice']) {
    const source = state();
    source.settings.stapleId = stapleId;
    source.settings.stapleAmount = stapleId === 'rice' ? 200 : null;
    source.entries = [entry('dinner', 1)];
    const loaded = parseJournal(JSON.stringify(source), data);
    assert.deepEqual(loaded, source);
    assert.ok(!Object.hasOwn(loaded.settings, 'stapleMode'));
  }
  assert.equal(state().settings.meal, 'dinner');
});

test('献立に合わせる指定へ切り替えると固定IDと量を解除し、付けない指定も保つ', () => {
  const source = state();
  source.settings = {...source.settings, stapleMode: 'adaptive', stapleId: 'rice', stapleAmount: 200};
  const before = structuredClone(source);
  const loaded = validateJournal(source, data);
  assert.equal(loaded.settings.stapleMode, 'adaptive');
  assert.equal(loaded.settings.stapleId, 'auto');
  assert.equal(loaded.settings.stapleAmount, null);
  assert.deepEqual(source, before);
  source.settings.stapleId = 'none';
  const omitted = validateJournal(source, data);
  assert.equal(omitted.settings.stapleId, 'none');
  assert.equal(omitted.settings.stapleAmount, null);
});

test('固定主食は指定量を保持し、不明なモードや矛盾した固定指定を保存しない', () => {
  const source = state();
  source.settings = {...source.settings, stapleMode: 'fixed', stapleId: 'rice', stapleAmount: 225};
  assert.deepEqual(parseJournal(JSON.stringify(source), data), source);
  for (const stapleMode of ['', null, 1, true, 'none']) {
    assert.throws(() => validateJournal({...source, settings: {...source.settings, stapleMode}}, data), /主食/);
  }
  for (const stapleId of ['auto', 'none', 'missing']) {
    assert.throws(() => validateJournal({...source, settings: {...source.settings, stapleId}}, data), /主食/);
  }
  for (const stapleAmount of [0, -1, NaN, Infinity, '100']) {
    assert.throws(() => validateJournal({...source, settings: {...source.settings, stapleAmount}}, data), /主食/);
  }
});

test('旧v1とv2を読み込んでも食事区分と主食設定を引き継ぎ、保存形式はv3のままにする', () => {
  const version1 = defaultState('2026-11-13');
  const migrated1 = validateJournal(version1, data);
  assert.equal(migrated1.version, 3);
  assert.equal(migrated1.settings.meal, 'dinner');
  assert.equal(migrated1.settings.stapleId, 'auto');
  assert.ok(!Object.hasOwn(migrated1.settings, 'stapleMode'));
  const version2 = state();
  version2.version = 2;
  delete version2.mealSets;
  delete version2.purchaseSettings;
  delete version2.batches;
  delete version2.favourites;
  delete version2.profile;
  delete version2.completedDays;
  delete version2.settings.stapleAmount;
  delete version2.settings.drinkAmount;
  delete version2.settings.hideRecipeIllustrations;
  version2.settings.meal = 'lunch';
  version2.settings.stapleId = 'rice';
  const migrated2 = validateJournal(version2, data);
  assert.equal(migrated2.version, 3);
  assert.equal(migrated2.settings.meal, 'lunch');
  assert.equal(migrated2.settings.stapleId, 'rice');
  assert.equal(migrated2.settings.stapleAmount, null);
  assert.ok(!Object.hasOwn(migrated2.settings, 'stapleMode'));
});

test('3食設定と各食事の記録を従来の保存キーで書き出して読み戻せる', () => {
  const source = state();
  source.settings = {...source.settings, meal: 'all', stapleMode: 'fixed', stapleId: 'rice', stapleAmount: 120};
  source.entries = ['breakfast', 'lunch', 'dinner', 'snack'].map(entry);
  const memory = new Map();
  const storage = {getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value)};
  assert.equal(writeJournal(storage, source, data), true);
  assert.deepEqual([...memory.keys()], ['kondate-note-v3']);
  assert.deepEqual(readJournal(storage, data).state, source);
});

test('巻き寿司の切れ数と本数をマイメニュー・食事の基準量として保持する', () => {
  const source = state();
  source.customRecipes = ['切れ', '本'].map((unit, index) => ({id: `custom-roll-${index}`, name: `巻き寿司（${unit}）`, role: 'staple',
    ingredients: [{id: 'rice', amount: 150}], ingredientsKnown: true, allergensKnown: true, portion: {amount: unit === '切れ' ? 8 : 1, unit}}));
  const clean = validateJournal(source, data);
  clean.entries = clean.customRecipes.map((recipe, index) => ({id: `roll-${index}`, date: '2026-11-13', meal: 'lunch', status: 'eaten', note: '', items: [
    {...itemFromRecipe(recipe, data, 0.5), portion: recipe.portion},
  ]}));
  const loaded = parseJournal(JSON.stringify(clean), data);
  assert.deepEqual(loaded, clean);
  assert.deepEqual(loaded.entries.map(entry => entry.items[0].portion.unit), ['切れ', '本']);
  assert.deepEqual(loaded.entries.map(entry => entry.items[0].quantity), [0.5, 0.5]);
});
