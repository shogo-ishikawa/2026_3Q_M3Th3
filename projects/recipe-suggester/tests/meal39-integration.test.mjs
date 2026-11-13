import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {buildFoodSelection} from '../food-composer.js';
import {buildRecipeArrangement} from '../recipe-arrangement.js';
import {MEAT_CHOICES, buildMeatSelection, eligibleMeatSelections} from '../meat-choices.js';
import {createCatalogEntry} from '../record-actions.js';
import {defaultJournal, parseJournal, validateJournal} from '../journal.js';
import {NUTRIENT_KEYS, itemNutrition, recipeNutrition} from '../nutrition.js';
import {shoppingForEntries} from '../shopping.js';
import {eligibleRecipes} from '../planner.js';

const data = {allergens: ALLERGENS, ingredients: INGREDIENTS, recipes: RECIPES};
const contract = JSON.parse(readFileSync(new URL('./fixtures/meal38-data-contract.json', import.meta.url), 'utf8'));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const near = (actual, expected, label = '') => assert.ok(typeof actual === 'number' && Number.isFinite(actual) &&
  Math.abs(actual - expected) < 1e-7, `${label}: expected ${expected}, got ${actual}`);
const date = '2026-11-13';
const amounts = recipe => Object.fromEntries(recipe.ingredients.map(part => [part.id, part.amount]));
const entry = (recipe, amount = 1) => createCatalogEntry({recipeId: recipe.id, date, meal: 'dinner', status: 'planned', amount},
  {...data, recipes: [...RECIPES, recipe]});
const shopping = (entries, servings = 1, pantry = []) => shoppingForEntries(entries, data, {from: date, to: date, servings, pantry});

function roundTrip(recipe, recorded, {save = true} = {}) {
  const state = defaultJournal(date);
  if (save) state.customRecipes = [recipe];
  else recorded.items[0].recipeId = null;
  state.entries = [recorded];
  validateJournal(state, data);
  return parseJournal(JSON.stringify(state), data);
}

test('v3.8で公開済みの883レシピと396食材を保持し、重量換算の追加だけを許す', () => {
  const oldRecipes = new Set(contract.recipeIds);
  const recipes = RECIPES.filter(recipe => oldRecipes.has(recipe.id));
  assert.deepEqual(recipes.map(recipe => recipe.id), contract.recipeIds);
  assert.equal(hash(recipes), contract.recipeHash, '元料理の分量・栄養・手順を置換しない');
  const ingredients = Object.fromEntries(contract.ingredientIds.map(id => {
    assert.ok(Object.hasOwn(INGREDIENTS, id), `元食材を保持: ${id}`);
    return [id, Object.fromEntries(Object.entries(INGREDIENTS[id]).filter(([key]) => key !== 'gramsPerUnit'))];
  }));
  assert.equal(hash(ingredients), contract.ingredientHash, '新しい重量換算で既存の成分値を変えない');
});

test('刺身の切数を魚ごとのgへ確定し、皿倍率・人数・在庫を別々に扱う', () => {
  const recipe = buildFoodSelection({kind: 'sashimi', id: 'custom-meal39-sashimi', components: [
    {id: 'tuna', amount: 3}, {id: 'salmon', amount: 2}, {id: 'scallop', amount: 1},
  ]}, data);
  const parts = amounts(recipe);
  near(parts.tuna_lean_sashimi, 45); near(parts.salmon_sashimi, 30); near(parts.scallop_sashimi, 10);
  near(parts.soy_sauce, 5.1); near(parts.shiso, .85);
  assert.match(recipe.sourceNote, /3切れ/);
  const recorded = entry(recipe, .5), loaded = roundTrip(recipe, recorded);
  assert.deepEqual(loaded.entries[0], recorded);
  const result = shopping(loaded.entries, 4, [{id: 'tuna_lean_sashimi', amount: 20}]);
  const tuna = result.items.find(row => row.id === 'tuna_lean_sashimi');
  assert.equal(tuna.unit, 'g'); near(tuna.required, 90); near(tuna.buy, 70);
  near(result.items.find(row => row.id === 'salmon_sashimi').required, 60);
  for (const key of NUTRIENT_KEYS) near(itemNutrition(recorded.items[0])[key], recipeNutrition(recipe, data)[key] / 2, key);
});

test('切身やチーズの1個の重さを変えても、記録済みの換算重量と栄養は変わらない', () => {
  const make = gramsPerUnit => buildFoodSelection({kind: 'sashimi', components: [{id: 'tuna', amount: 3, gramsPerUnit}]}, data);
  const recipe = make(20), recorded = entry(recipe), saved = JSON.stringify(recorded);
  near(amounts(recipe).tuna_lean_sashimi, 60);
  const changed = make(8); near(amounts(changed).tuna_lean_sashimi, 24);
  assert.equal(JSON.stringify(recorded), saved);
  const cheese = buildFoodSelection({kind: 'cheese', components: [{id: 'processed-cheese', amount: 2, gramsPerUnit: 15}]}, data);
  near(amounts(cheese).palette_processed_cheese, 30);
  near(recipeNutrition(cheese, data).fat, 7.8); near(recipeNutrition(cheese, data).kcal, 93.9);
  const result = shopping(roundTrip(cheese, entry(cheese), {save: false}).entries, 3);
  assert.equal(result.items.find(row => row.id === 'palette_processed_cheese').unit, 'g');
  near(result.items.find(row => row.id === 'palette_processed_cheese').required, 90);
});

test('イングリッシュマフィンは主食として具を足せ、お菓子のマフィンも独立して残る', () => {
  const originalSweet = RECIPES.find(recipe => recipe.id === 'palette-muffin');
  const originalBread = RECIPES.find(recipe => recipe.id === 'palette-english-muffin');
  assert.equal(originalSweet.role, 'snack'); assert.equal(originalSweet.family, 'cake');
  assert.equal(originalBread.role, 'staple'); assert.equal(originalBread.family, 'bread');
  const plain = buildFoodSelection({kind: 'english-muffin', components: [{id: 'base', amount: 1}]}, data);
  const filled = buildFoodSelection({kind: 'english-muffin', components: [{id: 'base', amount: 1}, {id: 'boiled-egg', amount: 1}]}, data);
  near(recipeNutrition(plain, data).kcal, 134.4);
  near(recipeNutrition(filled, data).kcal - recipeNutrition(plain, data).kcal, 71);
  near(recipeNutrition(filled, data).fat - recipeNutrition(plain, data).fat, 5.1);
  const recipe = buildRecipeArrangement({baseRecipe: filled, additions: [{id: 'carrot', amount: 10, unit: 'g'}]}, data);
  near(recipeNutrition(recipe, data).kcal, 208.6);
  const result = shopping(roundTrip(recipe, entry(recipe, 2), {save: false}).entries, 2);
  near(result.items.find(row => row.id === 'palette_english_muffin').required, 240);
  near(result.items.find(row => row.id === 'egg').required, 4);
  near(result.items.find(row => row.id === 'carrot').required, 40);
  assert.ok(!result.items.some(row => ['palette_muffin_base', 'flour', 'sugar'].includes(row.id)));
});

test('元のラベル栄養を維持して食材だけを足し、同じ材料IDは買い物で一度だけ合算する', () => {
  const base = {id: 'custom-meal39-manual-base', name: '市販の昼食', role: 'main', genre: 'その他', servings: 2,
    custom: true, nature: 'ready-to-eat', ingredients: [{id: 'rice', amount: 200}], steps: ['商品表示に従って温める。'],
    manualNutrition: {kcal: 345, protein: 12, fat: 8, carbs: 55, fiber: null, salt: 2},
    allergens: [], groups: [], proteinSources: [], ingredientsKnown: false, allergensKnown: false, shoppingKnown: true};
  const before = JSON.stringify(base);
  const recipe = buildRecipeArrangement({baseRecipe: base, additions: [
    {id: 'rice', amount: 50, unit: 'g'}, {id: 'rice', amount: 25, unit: 'g'}, {id: 'carrot', amount: 50, unit: 'g'},
  ]}, data);
  assert.equal(JSON.stringify(base), before);
  assert.equal(recipe.servings, 1); assert.equal(recipe.ingredients.filter(part => part.id === 'rice').length, 1);
  near(amounts(recipe).rice, 175); near(amounts(recipe).carrot, 50);
  near(recipeNutrition(recipe, data).kcal, 478); near(recipeNutrition(recipe, data).fat, 8.325);
  assert.equal(recipeNutrition(recipe, data).fiber, null);
  assert.equal(recipe.ingredientsKnown, false); assert.equal(recipe.allergensKnown, false);
  assert.equal(recipe.shoppingKnown, true);
  assert.deepEqual(eligibleRecipes({}, {...data, recipes: [recipe]}), []);
  const loaded = roundTrip(recipe, entry(recipe, 2));
  near(loaded.customRecipes[0].manualNutrition.kcal, 478);
  const result = shopping(loaded.entries, 2);
  near(result.items.find(row => row.id === 'rice').required, 700);
  near(result.items.find(row => row.id === 'carrot').required, 200);
  assert.equal(result.missingMenus.length, 1, '原材料の未確認を隠さない');
});

test('g入力した卵と牛乳をDBの個数・mlへ戻し、材料からオリジナル料理を保存できる', () => {
  const recipe = buildRecipeArrangement({baseRecipe: null, name: 'にんじん入り卵料理', role: 'main', additions: [
    {id: 'carrot', amount: 50, unit: 'g'}, {id: 'milk', amount: 103, unit: 'g'}, {id: 'egg', amount: 25, unit: 'g'},
  ], steps: ['材料を合わせて十分に加熱する。']}, data);
  const parts = amounts(recipe);
  near(parts.carrot, 50); near(parts.milk, 100); near(parts.egg, .5);
  const expected = {kcal: 114.33, protein: 6.799, fat: 6.564, carbs: 9.444, fiber: 1.4, salt: .253};
  for (const key of NUTRIENT_KEYS) near(recipeNutrition(recipe, data)[key], expected[key], key);
  const loaded = roundTrip(recipe, entry(recipe, .5));
  const result = shopping(loaded.entries, 2, [{id: 'carrot', amount: 10}, {id: 'milk', amount: 20}, {id: 'egg', amount: .25}]);
  near(result.items.find(row => row.id === 'carrot').buy, 40);
  near(result.items.find(row => row.id === 'milk').buy, 80);
  near(result.items.find(row => row.id === 'egg').buy, .25);
  assert.deepEqual(loaded.customRecipes[0].steps, ['材料を合わせて十分に加熱する。']);
});

test('肉の置換は同じ重量を保ち、元の牛肉ハンバーグを変更せず豚・鶏の成分へ切り替える', () => {
  const source = RECIPES.find(recipe => recipe.id === 'beef-hamburg'), before = JSON.stringify(source);
  const beef = buildMeatSelection({recipeId: source.id, meatId: 'beef'}, data);
  const pork = buildMeatSelection({recipeId: source.id, meatId: 'pork'}, data);
  const chicken = buildMeatSelection({recipeId: source.id, meatId: 'chicken'}, data);
  near(amounts(pork).pork_minced, 150); assert.equal(amounts(pork).beef_minced, undefined);
  near(recipeNutrition(pork, data).fat - recipeNutrition(beef, data).fat, -5.85);
  near(recipeNutrition(chicken, data).fat - recipeNutrition(beef, data).fat, -13.65);
  assert.ok(!pork.allergens.includes('beef')); assert.ok(pork.allergens.includes('pork'));
  assert.equal(JSON.stringify(source), before);
  const allowed = eligibleMeatSelections(source.id, {allergens: ['beef']}, data);
  assert.ok(allowed.some(choice => choice.config.meatId === 'pork'));
  assert.ok(!allowed.some(choice => ['beef', 'mixed'].includes(choice.config.meatId)));
  const result = shopping(roundTrip(pork, entry(pork, 2)).entries, 3);
  near(result.items.find(row => row.id === 'pork_minced').required, 900);
  assert.ok(!result.items.some(row => row.id === 'beef_minced'));
});

test('全料理の肉選択肢を保存・再読込でき、独自の表示用キーを保存データへ混ぜない', () => {
  let count = 0;
  for (const definition of MEAT_CHOICES) for (const option of definition.options) {
    const recipe = buildMeatSelection({recipeId: definition.recipeId, meatId: option.id}, data);
    const loaded = roundTrip(recipe, entry(recipe));
    assert.deepEqual(loaded.entries[0].items[0].nutrition, recipe.manualNutrition, `${definition.recipeId}/${option.id}`);
    assert.deepEqual(loaded.customRecipes[0].ingredients, recipe.ingredients);
    count++;
  }
  assert.ok(count >= 20);
});
