import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {defaultJournal} from '../journal.js';
import {recipeFamily, recipePortion} from '../catalog.js';
import {mountPlanDishPicker, mountPlanMealEditor} from '../meal-plan-editor-ui.js';

class Element {
  constructor(tag) {this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.listeners = new Map(); this.textContent = ''; this.className = ''; this.value = ''; this.dataset = {}; this.style = {};}
  append(...children) {this.children.push(...children);}
  replaceChildren(...children) {this.children = [...children];}
  setAttribute(key, value) {this.attributes[key] = value;}
  getAttribute(key) {return this.attributes[key] ?? null;}
  addEventListener(type, listener) {if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(listener);}
  dispatchEvent(event) {for (const listener of this.listeners.get(event.type) ?? []) listener(event); return true;}
  emit(type, properties = {}) {this.dispatchEvent({type, target: this, preventDefault() {}, ...properties});}
  set innerHTML(value) {throw Error('Saved names must be text, not HTML.');}
}
const all = root => [root, ...root.children.flatMap(all)];
const byClass = (root, className) => all(root).filter(node => node.className.split(' ').includes(className));
const one = (root, className) => {const result = byClass(root, className)[0]; assert.ok(result, className); return result;};
const field = (root, key) => {const result = all(root).find(node => node.id?.endsWith(`-breakfast-${key}`)); assert.ok(result, key); return result;};
const options = node => all(node).filter(child => child.tagName === 'OPTION');
const withDocument = fn => {const before = globalThis.document; globalThis.document = {createElement: tag => new Element(tag)}; try {return fn();} finally {if (before === undefined) delete globalThis.document; else globalThis.document = before;}};
const data = {allergens: ALLERGENS, ingredients: INGREDIENTS, recipes: RECIPES};
const settings = () => defaultJournal('2026-11-15').settings;
const day = () => ({date: '2026-11-15', meal: 'breakfast', recipeIds: [], quantities: {}});

test('a single breakfast can receive yoghurt or fruit with actual gram quantities, without changing its source', () => withDocument(() => {
  const source = day(), before = structuredClone(source), added = [], root = mountPlanDishPicker({settings: settings(), data, day: source, onAdd: item => added.push(item)});
  const type = one(root, 'plan-dish-type'); type.value = 'yoghurt'; type.emit('change');
  const menu = one(root, 'plan-dish-menu'), recipe = RECIPES.find(recipe => recipe.id === menu.value), portion = recipePortion(recipe, data);
  assert.equal(recipeFamily(recipe), 'yoghurt'); assert.equal(one(root, 'plan-dish-unit').textContent, 'g');
  const amount = one(root, 'plan-dish-amount'); amount.value = '150'; root.emit('submit');
  assert.deepEqual(added, [{recipeId: recipe.id, quantity: 150 / portion.amount}]);
  assert.deepEqual(source, before);
  type.value = 'fruit'; type.emit('change'); assert.ok(options(menu).length > 0);
  assert.ok(options(menu).every(option => recipeFamily(RECIPES.find(recipe => recipe.id === option.value)) === 'fruit'));
}));

test('an explicit addition observes allergens and exclusions but lets the user choose beyond automatic breakfast candidates', () => withDocument(() => {
  const excluded = settings(); excluded.allergens = ['milk'];
  const root = mountPlanDishPicker({settings: excluded, data, day: day(), initialCategory: 'yoghurt'});
  const milkIds = new Set(RECIPES.filter(recipe => recipe.ingredients.some(part => INGREDIENTS[part.id].allergens.includes('milk'))).map(recipe => recipe.id));
  assert.ok(options(one(root, 'plan-dish-menu')).every(option => !milkIds.has(option.value)));
  const type = one(root, 'plan-dish-type'); type.value = 'main'; type.emit('change');
  assert.ok(options(one(root, 'plan-dish-menu')).some(option => option.value === 'shrimp-egg'));
  const noShrimp = settings(); noShrimp.excludedIngredients = ['shrimp'];
  const second = mountPlanDishPicker({settings: noShrimp, data, day: day(), initialCategory: 'main'});
  assert.ok(!options(one(second, 'plan-dish-menu')).some(option => option.value === 'shrimp-egg'));
}));

test('already active dishes are absent while an omitted dish can be restored and searched by name', () => withDocument(() => {
  const yoghurts = RECIPES.filter(recipe => recipeFamily(recipe) === 'yoghurt'), first = yoghurts[0]; assert.ok(first);
  const active = {...day(), recipeIds: [first.id]}, before = structuredClone(active);
  const root = mountPlanDishPicker({settings: settings(), data, day: active, initialCategory: 'yoghurt'});
  assert.ok(!options(one(root, 'plan-dish-menu')).some(option => option.value === first.id)); assert.deepEqual(active, before);
  active.omittedRecipeIds = [first.id];
  const restored = mountPlanDishPicker({settings: settings(), data, day: active, initialCategory: 'yoghurt'});
  assert.ok(options(one(restored, 'plan-dish-menu')).some(option => option.value === first.id));
  const search = one(restored, 'plan-dish-search'); search.value = '絶対に存在しない料理'; search.emit('input');
  assert.equal(options(one(restored, 'plan-dish-menu')).length, 0); assert.equal(one(restored, 'plan-dish-submit').disabled, true);
  search.value = first.name; search.emit('input'); assert.ok(options(one(restored, 'plan-dish-menu')).some(option => option.value === first.id));
}));

test('invalid portions and rejected additions stay visible without changing the supplied day', () => withDocument(() => {
  const source = day(), before = structuredClone(source), errors = [], calls = [], root = mountPlanDishPicker({settings: settings(), data, day: source, onError: message => errors.push(message), onAdd: item => {calls.push(item); throw Error('この料理は追加できません。');}});
  one(root, 'plan-dish-amount').value = '0'; root.emit('submit'); assert.equal(calls.length, 0); assert.equal(one(root, 'plan-editor-error').hidden, false);
  one(root, 'plan-dish-amount').value = '1'; root.emit('submit'); assert.equal(calls.length, 1); assert.equal(errors.at(-1), 'この料理は追加できません。');
  assert.deepEqual(source, before);
}));

test('a one-meal editor changes genre, staple amount and side preferences without touching common settings', () => withDocument(() => {
  const source = settings(), original = structuredClone(source), sourceDay = {...day(), targetGenre: '洋食'}, before = structuredClone(sourceDay), applied = [];
  const root = mountPlanMealEditor({settings: source, data, day: sourceDay, onApply: change => applied.push(change)});
  assert.ok(!all(root).some(node => node.id?.endsWith('-breakfast-enabled')));
  assert.ok(!all(root).some(node => node.id?.endsWith('-lunch-staple')));
  const volume = field(root, 'volume'); volume.value = 'hearty'; volume.emit('change');
  const stapleVolume = field(root, 'stapleVolume'); stapleVolume.value = 'light'; stapleVolume.emit('change');
  const sideCount = field(root, 'sideCount'); sideCount.value = '2'; sideCount.emit('change');
  const sideType = field(root, 'sideType'); sideType.value = 'salad'; sideType.emit('change');
  one(root, 'plan-meal-genre').value = '中華'; root.emit('submit');
  assert.equal(applied.length, 1); assert.equal(applied[0].genre, '中華');
  assert.equal(applied[0].mealPreference.volume, 'hearty'); assert.equal(applied[0].mealPreference.stapleVolume, 'light');
  assert.equal(applied[0].mealPreference.sideCount, 2); assert.equal(applied[0].mealPreference.sideType, 'salad');
  assert.deepEqual(source, original); assert.deepEqual(sourceDay, before);
  applied[0].mealPreference.volume = 'light'; root.emit('submit'); assert.equal(applied[1].mealPreference.volume, 'hearty');
}));

test('individual and explicit profiles take precedence and errors from regeneration stay in the editor', () => withDocument(() => {
  const errors = [], root = mountPlanMealEditor({settings: settings(), data, day: {...day(), mealPreference: {volume: 'light'}}, mealPreference: {volume: 'hearty', staple: 'fixed', stapleId: 'plain-rice', stapleAmount: 172.5}, onApply: () => {throw Error('選んだ条件に合う献立がありません。');}, onError: message => errors.push(message)});
  assert.equal(field(root, 'volume').value, 'hearty'); assert.equal(field(root, 'stapleAmount').value, '172.5');
  root.emit('submit'); assert.equal(errors[0], '選んだ条件に合う献立がありません。'); assert.equal(one(root, 'plan-editor-error').hidden, false);
  one(root, 'plan-meal-genre').value = '不明なジャンル'; root.emit('submit'); assert.equal(errors.at(-1), '料理のジャンルを選んでください。');
}));
