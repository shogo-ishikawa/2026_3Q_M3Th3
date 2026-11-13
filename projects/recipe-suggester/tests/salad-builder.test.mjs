import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {SALAD_COMPONENTS, SALAD_DRESSINGS, SALAD_INGREDIENTS, buildSaladRecipe} from '../salad-builder.js';
import {recipeNutrition, itemNutrition} from '../nutrition.js';
import {createCatalogEntry} from '../record-actions.js';
import {defaultJournal, parseJournal, validateJournal} from '../journal.js';
import {eligibleRecipes} from '../planner.js';
import {shoppingForEntries} from '../shopping.js';

const data = {allergens: ALLERGENS, ingredients: INGREDIENTS, recipes: RECIPES};
const base = {components: [{id: 'lettuce', amount: 50}, {id: 'tomato', amount: 80}], dressingId: 'none', dressingAmount: 0};
const make = changes => buildSaladRecipe({...structuredClone(base), ...changes}, data);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const byIngredient = recipe => Object.fromEntries(recipe.ingredients.map(part => [part.id, part.amount]));
const withRecipe = recipe => ({...data, recipes: [...RECIPES, recipe]});
const entryFor = (recipe, options = {}) => createCatalogEntry({recipeId: recipe.id, date: '2026-11-13', meal: 'dinner', status: 'planned', amount: 1, ...options}, withRecipe(recipe));
const freeze = value => {if (value && typeof value === 'object') {Object.values(value).forEach(freeze); Object.freeze(value);} return value;};

test('サラダは選択した野菜だけを1皿の材料と栄養へ反映し、入力と共通DBを変えない', () => {
  const config = freeze(structuredClone(base)), before = JSON.stringify(data);
  const recipe = buildSaladRecipe(config, data);
  assert.deepEqual(byIngredient(recipe), {lettuce: 50, tomato: 80});
  assert.equal(recipe.role, 'side'); assert.equal(recipe.family, 'side'); assert.equal(recipe.servings, 1);
  assert.equal(recipe.custom, true); assert.equal(recipe.staple, false); assert.equal(recipe.mealBase, false);
  assert.deepEqual(recipe.portion, {amount: 1, unit: '皿'});
  assert.match(recipe.id, /^custom-salad-/); assert.match(recipe.name, /レタス・トマト/); assert.match(recipe.name, /ドレッシングなし/);
  assert.deepEqual(recipe.manualNutrition, recipeNutrition({servings: 1, ingredients: [{id: 'lettuce', amount: 50}, {id: 'tomato', amount: 80}]}, data));
  assert.deepEqual(recipe.allergens, []); assert.deepEqual(recipe.groups, ['vegetable']); assert.deepEqual(recipe.proteinSources, []);
  assert.ok(recipe.ingredientsKnown && recipe.allergensKnown && recipe.shoppingKnown);
  assert.equal(JSON.stringify(data), before); assert.deepEqual(config, base);
});

test('ドレッシングのg指定を調味料のml・gへ換算し、倍量でも野菜を二重に増やさない', () => {
  const first = make({dressingId: 'wafu', dressingAmount: 15}), doubled = make({dressingId: 'wafu', dressingAmount: 30});
  const one = byIngredient(first), two = byIngredient(doubled);
  const batch = 5 * 1.181 + 5 + 3 * 0.913 + 1;
  close(one.soy_sauce, 5 * 15 / batch); close(one.vinegar, 5 * 15 / batch); close(one.oil, 3 * 15 / batch); close(one.sugar, 15 / batch);
  close(one.soy_sauce * 1.181 + one.vinegar + one.oil * 0.913 + one.sugar, 15);
  for (const id of ['soy_sauce', 'vinegar', 'oil', 'sugar']) close(two[id], one[id] * 2);
  assert.equal(one.lettuce, two.lettuce); assert.equal(one.tomato, two.tomato);
  assert.ok(doubled.manualNutrition.kcal > first.manualNutrition.kcal);
  close(doubled.manualNutrition.kcal - first.manualNutrition.kcal, first.manualNutrition.kcal - make().manualNutrition.kcal);
  assert.match(first.sourceNote, /家庭用の配合を15g/); assert.match(first.sourceNote, /市販ドレッシング/);
});

test('ブロッコリーは生の材料を転用せず、ゆでた花序の100g値と計量状態を使う', () => {
  const recipe = make({components: [{id: 'broccoli', amount: 100}]}), profile = data.ingredients.salad_broccoli_boiled;
  assert.ok(profile); assert.equal(profile.unit, 'g'); assert.deepEqual(profile.derivedFrom, ['broccoli']);
  assert.equal(SALAD_INGREDIENTS.salad_broccoli_boiled.name, 'ブロッコリー（花序・ゆで）');
  assert.deepEqual(byIngredient(recipe), {salad_broccoli_boiled: 100});
  for (const [key, value] of Object.entries({kcal: 30, protein: 3.9, fat: 0.4, carbs: 5.2, fiber: 4.3, salt: 0})) close(recipe.manualNutrition[key], value);
  assert.notDeepEqual(profile.nutritionPerUnit, data.ingredients.broccoli.nutritionPerUnit);
  assert.match(recipe.sourceNote, /湯切りした後/); assert.ok(recipe.steps.some(step => /ゆでた花序/.test(step)));
});

test('選んだドレッシングの原料アレルゲンを引き継ぎ、原料大豆だけでたんぱく源を増やさない', () => {
  const wafu = make({dressingId: 'wafu', dressingAmount: 15}), sesame = make({dressingId: 'sesame', dressingAmount: 20});
  assert.ok(wafu.allergens.includes('soy') && wafu.allergens.includes('wheat'));
  assert.deepEqual(wafu.proteinSources, []);
  for (const allergen of ['sesame', 'egg', 'soy', 'milk', 'wheat']) assert.ok(sesame.allergens.includes(allergen), allergen);
  assert.equal(eligibleRecipes({allergens: [], excludedIngredients: []}, withRecipe(sesame)).some(r => r.id === sesame.id), true);
  assert.equal(eligibleRecipes({allergens: ['sesame'], excludedIngredients: []}, withRecipe(sesame)).some(r => r.id === sesame.id), false);
  assert.equal(eligibleRecipes({allergens: [], excludedIngredients: ['tomato']}, withRecipe(sesame)).some(r => r.id === sesame.id), false);
  const broccoli = make({components: [{id: 'broccoli', amount: 60}]});
  assert.equal(eligibleRecipes({allergens: [], excludedIngredients: ['broccoli']}, withRecipe(broccoli)).some(r => r.id === broccoli.id), false);
});

test('すべての材料・ドレッシングを選べ、不明な栄養を0に補わない', () => {
  assert.equal(SALAD_COMPONENTS.length, 7); assert.equal(SALAD_DRESSINGS.length, 6);
  for (const dressing of SALAD_DRESSINGS) {
    const recipe = buildSaladRecipe({components: SALAD_COMPONENTS.map(c => ({id: c.id, amount: c.defaultAmount})), dressingId: dressing.id, dressingAmount: dressing.defaultAmount}, data);
    assert.equal(new Set(recipe.ingredients.map(p => p.id)).size, recipe.ingredients.length);
    assert.ok(recipe.name.length <= 200 && recipe.sourceNote.length <= 2000);
    for (const value of Object.values(recipe.manualNutrition)) assert.ok(value === null || Number.isFinite(value) && value >= 0);
  }
  const changed = {...data, ingredients: {...INGREDIENTS, lettuce: {...INGREDIENTS.lettuce, nutritionPerUnit: {...INGREDIENTS.lettuce.nutritionPerUnit, fiber: null}}}};
  const recipe = buildSaladRecipe(base, changed);
  assert.equal(recipe.manualNutrition.fiber, null); assert.equal(recipe.manualNutrition.kcal, make().manualNutrition.kcal);
});

test('0・負数・NaN・無限・空・重複・不明な種類と過大な分量を保存前に拒否する', () => {
  const bad = [null, [], {}, {...base, extra: true}, {...base, components: []}, {...base, components: Array(1)},
    ...[0, -1, NaN, Infinity, null, '50', 1001].map(amount => ({...base, components: [{id: 'lettuce', amount}]})),
    {...base, components: [{id: 'lettuce', amount: 50}, {id: 'lettuce', amount: 1}]},
    {...base, components: [{id: 'unknown', amount: 50}]}, {...base, components: [{id: '__proto__', amount: 50}]},
    {...base, components: [{id: 'lettuce', amount: 50, hidden: 1}]},
    {...base, components: [{id: 'lettuce', amount: 1000}, {id: 'cabbage', amount: 1000}, {id: 'carrot', amount: 1}]},
    {...base, dressingId: 'unknown'}, {...base, dressingId: null}, {...base, dressingAmount: 1},
    ...[0, -1, NaN, Infinity, null, '15', 301].map(dressingAmount => ({...base, dressingId: 'wafu', dressingAmount})),
    ...[null, '', 'builtin-salad', 3, 'custom-' + 'x'.repeat(120)].map(id => ({...base, id})),
  ];
  for (const config of bad) assert.throws(() => buildSaladRecipe(config, data));
  for (const wrong of [{}, {...data, ingredients: {...INGREDIENTS, lettuce: {...INGREDIENTS.lettuce, unit: 'ml'}}},
    {...data, ingredients: {...INGREDIENTS, lettuce: {...INGREDIENTS.lettuce, allergensKnown: false}}},
    {...data, ingredients: {...INGREDIENTS, lettuce: {...INGREDIENTS.lettuce, derivedFrom: ['lettuce']}}}]) {
    assert.throws(() => buildSaladRecipe(base, wrong));
  }
  assert.throws(() => buildSaladRecipe(Object.assign(Object.create({hidden: true}), base), data));
});

test('マイメニュー保存と保存しない記録の両方で、JSON往復後も材料・栄養・単位を保持する', () => {
  const recipe = make({id: 'custom-salad-saved', dressingId: 'wafu', dressingAmount: 15});
  const journal = defaultJournal('2026-11-13'); journal.customRecipes.push(recipe);
  journal.entries.push(entryFor(recipe, {status: 'eaten', amount: 0.5}));
  const clean = validateJournal(journal, data), restored = parseJournal(JSON.stringify(clean), data);
  assert.deepEqual(restored, clean); assert.deepEqual(restored.customRecipes[0].manualNutrition, recipe.manualNutrition);
  const item = restored.entries[0].items[0]; assert.equal(item.quantity, 0.5); assert.equal(item.portion.amount, 1); assert.equal(item.portion.unit, '皿');
  close(itemNutrition(item).kcal, recipe.manualNutrition.kcal / 2);
  const recorded = defaultJournal('2026-11-13'), entry = entryFor(recipe, {status: 'eaten'});
  entry.items[0].recipeId = null; recorded.entries.push(entry);
  const standalone = parseJournal(JSON.stringify(recorded), data);
  assert.equal(standalone.customRecipes.length, 0); assert.equal(standalone.entries[0].items[0].recipeId, null);
  assert.deepEqual(standalone.entries[0].items[0].ingredients, recipe.ingredients);
});

test('予定の半皿を3人分の買い物へ一度だけ換算し、在庫差し引きと食べた記録の除外を保つ', () => {
  const recipe = make({dressingId: 'mayonnaise', dressingAmount: 10}), planned = entryFor(recipe, {amount: 0.5}), eaten = entryFor(recipe, {status: 'eaten', amount: 2});
  const shopping = shoppingForEntries([planned, eaten], data, {from: '2026-11-13', to: '2026-11-13', servings: 3, pantry: [{id: 'lettuce', amount: 20}]});
  assert.equal(shopping.entryCount, 1); assert.deepEqual(shopping.missingMenus, []);
  const item = id => shopping.items.find(part => part.id === id);
  close(item('lettuce').required, 75); close(item('lettuce').buy, 55); close(item('tomato').required, 120); close(item('mayonnaise').required, 15);
});

test('繰り返し作るサラダの保存IDと返却配列を共有しない', () => {
  const one = make(), two = make(); assert.notEqual(one.id, two.id);
  one.ingredients[0].amount = 1; one.allergens.push('egg');
  assert.equal(two.ingredients[0].amount, 50); assert.deepEqual(two.allergens, []);
  assert.ok(Object.isFrozen(SALAD_COMPONENTS) && Object.isFrozen(SALAD_COMPONENTS[0]));
  assert.ok(Object.isFrozen(SALAD_DRESSINGS[1].ingredients[0]));
});
