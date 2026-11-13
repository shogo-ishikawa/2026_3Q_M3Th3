import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {MEAT_CHOICE_INGREDIENTS, MEAT_CHOICE_NUTRITION} from '../meat-choice-foods.js';
import {MEAT_CHOICES, buildMeatSelection, defaultMeatSelection, eligibleMeatSelections, meatChoiceFor} from '../meat-choices.js';
import {itemFromRecipe, recipeNutrition} from '../nutrition.js';
import {createCatalogEntry} from '../record-actions.js';
import {defaultJournal, parseJournal} from '../journal.js';
import {shoppingForEntries} from '../shopping.js';
import {isCompleteMeal} from '../catalog.js';

const ingredients = {...INGREDIENTS, ...Object.fromEntries(Object.entries(MEAT_CHOICE_INGREDIENTS).map(([id, food]) => [id, {...food, ...MEAT_CHOICE_NUTRITION[id]}]))};
const data = {recipes:RECIPES, ingredients, allergens:ALLERGENS};
const source = id => RECIPES.find(recipe => recipe.id === id);
const build = (recipeId, meatId) => buildMeatSelection(meatId === undefined ? defaultMeatSelection(recipeId) : {recipeId, meatId}, data);
const parts = recipe => Object.fromEntries(recipe.ingredients.map(part => [part.id, part.amount]));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const withRecipe = recipe => ({...data, recipes:[...RECIPES, recipe]});

test('対象13料理の初期肉は既存の1人分の材料・栄養を保ち、元データを変更しない', () => {
  assert.equal(MEAT_CHOICES.length, 13);
  const before = JSON.stringify(data);
  for (const definition of MEAT_CHOICES) {
    const base = source(definition.recipeId), made = build(definition.recipeId);
    assert.deepEqual(parts(made), Object.fromEntries(base.ingredients.map(part => [part.id, part.amount / base.servings])));
    for (const [key, value] of Object.entries(recipeNutrition(base, data))) value === null ? assert.equal(made.manualNutrition[key], null) : close(made.manualNutrition[key], value);
    assert.equal(made.servings, 1); assert.equal(made.role, base.role); assert.equal(isCompleteMeal(made), isCompleteMeal(base));
    assert.equal(made.custom, true); assert.equal(made.ingredientsKnown, true); assert.equal(made.allergensKnown, true);
  }
  assert.equal(JSON.stringify(data), before);
  assert.equal(meatChoiceFor('prepared-retort-mapodon'), null, '完成品の肉を変更しない');
  assert.equal(meatChoiceFor(), null);
  assert.equal(meatChoiceFor(null), null);
});

test('ハンバーグの肉総量を保ち、合いびきは牛と豚を1:1で計算する', () => {
  const beef = build('classic-hamburg', 'beef'), pork = build('classic-hamburg', 'pork'), mixed = build('classic-hamburg', 'mixed'), chicken = build('classic-hamburg', 'chicken');
  assert.equal(parts(beef).beef_minced, 150); assert.equal(parts(pork).pork_minced, 150);
  assert.equal(parts(mixed).beef_minced, 75); assert.equal(parts(mixed).pork_minced, 75); assert.equal(parts(chicken).chicken_minced, 150);
  for (const recipe of [beef, pork, mixed, chicken]) {
    assert.equal(parts(recipe).onion, 50); assert.equal(parts(recipe).egg, .5); assert.equal(parts(recipe).breadcrumbs, 10); assert.equal(parts(recipe).milk, 15);
  }
  for (const key of ['kcal', 'protein', 'fat', 'carbs', 'fiber', 'salt']) close(mixed.manualNutrition[key], (beef.manualNutrition[key] + pork.manualNutrition[key]) / 2);
  assert.ok(beef.allergens.includes('beef') && !beef.allergens.includes('pork'));
  assert.ok(pork.allergens.includes('pork') && !pork.allergens.includes('beef'));
  assert.ok(chicken.allergens.includes('chicken') && !chicken.allergens.includes('pork') && !chicken.allergens.includes('beef'));
  assert.match(chicken.steps[0], /鶏ひき肉/); assert.match(mixed.steps[0], /半分ずつ/);
});

test('肉豆腐は牛・豚の材料、アレルゲン、作り方を切り替え、他の材料を保つ', () => {
  const pork = build('comfort-nikudofu-pork', 'pork'), beef = build('comfort-nikudofu-pork', 'beef');
  const nonmeat = recipe => recipe.ingredients.filter(part => !['pork', 'beef'].includes(part.id));
  assert.deepEqual(nonmeat(beef), nonmeat(pork)); assert.equal(parts(beef).beef, 110); assert.equal(parts(pork).pork, 110);
  close(beef.manualNutrition.fat - pork.manualNutrition.fat, 110 * (ingredients.beef.nutritionPerUnit.fat - ingredients.pork.nutritionPerUnit.fat));
  assert.match(beef.steps.join(' '), /牛肉/); assert.doesNotMatch(beef.steps.join(' '), /豚肉/);
  assert.ok(!beef.allergens.includes('pork')); assert.ok(!pork.allergens.includes('beef'));
});

test('もつの部位と生・ゆでを区別し、牛小腸を筋肉や調理済みの重量で計算しない', () => {
  const pork = build('comfort-motsu-stew', 'pork'), small = build('comfort-motsu-stew', 'beef'), rumen = build('comfort-motsu-stew', 'beef-rumen');
  assert.equal(parts(pork).pork_small_intestine_boiled, 130); assert.equal(parts(small).meat_beef_small_intestine_raw, 130); assert.equal(parts(rumen).meat_beef_rumen_boiled, 130);
  assert.ok(!Object.hasOwn(parts(small), 'beef')); assert.ok(!Object.hasOwn(parts(rumen), 'beef'));
  close(small.manualNutrition.fat - rumen.manualNutrition.fat, 130 * (.261 - .084));
  assert.match(small.steps[0], /下ゆで前/); assert.match(small.steps[0], /湯を捨て/); assert.match(rumen.steps[0], /第一胃/);
  assert.match(small.sourceNote, /流れ出す脂/); assert.doesNotMatch(small.sourceNote, /豚の小腸のみ/);
  assert.equal(MEAT_CHOICE_NUTRITION.meat_beef_small_intestine_raw.rawNutritionPerUnit.kcal, 2.68);
  assert.equal(MEAT_CHOICE_NUTRITION.meat_beef_rumen_boiled.rawNutritionPerUnit.protein, .245);
});

test('麻婆豆腐・麻婆丼・麻婆なすのひき肉を同じ機能で選べる', () => {
  for (const id of ['tofu-mapo', 'daily-donburi-mapo', 'familiar-mapo-aubergine']) {
    const original = build(id), chicken = build(id, 'chicken');
    const expected = parts(original); const grams = expected.pork_minced; delete expected.pork_minced; expected.chicken_minced = grams;
    assert.deepEqual(parts(chicken), expected); assert.ok(!chicken.allergens.includes('pork')); assert.match(chicken.name, /鶏ひき肉/);
  }
});

test('全49配合をマイメニュー保存・記録・書き出し読込みでき、過去の配合を保持する', () => {
  let checked = 0;
  for (const definition of MEAT_CHOICES) for (const option of definition.options) {
    const recipe = build(definition.recipeId, option.id), state = defaultJournal('2026-11-13');
    state.customRecipes.push(recipe);
    state.entries.push(createCatalogEntry({recipeId:recipe.id, date:'2026-11-13', meal:'dinner', status:'planned', amount:1.5}, withRecipe(recipe)));
    const clean = parseJournal(JSON.stringify(state), data);
    assert.deepEqual(clean.customRecipes[0].manualNutrition, recipe.manualNutrition);
    assert.deepEqual(clean.entries[0].items[0].ingredients, recipe.ingredients);
    assert.equal(clean.entries[0].items[0].quantity, 1.5);
    const before = JSON.stringify(clean.entries[0]);
    build(definition.recipeId, definition.options.at(-1).id);
    assert.equal(JSON.stringify(clean.entries[0]), before);
    checked++;
  }
  assert.equal(checked, 49);
});

test('選んだ肉のg数を予定の皿数と買い物人数で一度だけ拡大する', () => {
  const recipe = build('comfort-motsu-stew', 'beef');
  const entry = createCatalogEntry({recipeId:recipe.id, date:'2026-11-13', meal:'dinner', status:'planned', amount:1.5}, withRecipe(recipe));
  const list = shoppingForEntries([entry], data, {from:'2026-11-13', to:'2026-11-13', servings:2});
  const meat = list.items.find(part => part.id === 'meat_beef_small_intestine_raw');
  assert.equal(meat.required, 390); assert.equal(meat.unit, 'g'); assert.match(meat.name, /生/);
  assert.ok(!list.items.some(part => part.id === 'pork_small_intestine_boiled'));
});

test('肉の除外・アレルギーは実際の材料と派生元に適用し、無効な選択は受け付けない', () => {
  const options = (id, settings) => eligibleMeatSelections(id, settings, data).map(row => row.config.meatId);
  assert.deepEqual(options('classic-hamburg', {allergens:['beef'], excludedIngredients:[]}), ['pork', 'chicken']);
  assert.deepEqual(options('classic-hamburg', {allergens:[], excludedIngredients:['pork', 'beef', 'chicken']}), []);
  assert.deepEqual(options('comfort-motsu-stew', {allergens:[], excludedIngredients:['beef']}), ['pork']);
  assert.deepEqual(options('comfort-nikudofu-pork', {allergens:['soy'], excludedIngredients:[]}), []);
  for (const input of [null, [], {}, {recipeId:'comfort-motsu-stew', meatId:'chicken'}, {recipeId:'classic-hamburg', meatId:'__proto__'}, {recipeId:'classic-hamburg', meatId:'beef', extra:true}, {recipeId:'classic-hamburg', meatId:'beef', id:'builtin'}]) assert.throws(() => buildMeatSelection(input, data));
  assert.throws(() => defaultMeatSelection('unknown'));
});

test('材料の未測定値と確認状況は選択後も不明のまま保持する', () => {
  const customData = {...data, ingredients:{...ingredients, chicken_minced:{...ingredients.chicken_minced, nutritionPerUnit:{...ingredients.chicken_minced.nutritionPerUnit, fat:null}, allergensKnown:false}}};
  const recipe = buildMeatSelection({recipeId:'classic-hamburg', meatId:'chicken'}, customData);
  assert.equal(recipe.manualNutrition.fat, null); assert.equal(recipe.allergensKnown, false);
  assert.equal(itemFromRecipe(recipe, customData).nutrition.fat, null);
  assert.deepEqual(eligibleMeatSelections('classic-hamburg', {allergens:[], excludedIngredients:[]}, customData).map(row => row.config.meatId), ['beef', 'pork', 'mixed']);
});
