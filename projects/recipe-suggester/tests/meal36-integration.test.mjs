import {MAPO_INGREDIENTS} from '../mapo-nutrition.js';
import {MAPO_RECIPES} from '../mapo-foods.js';
import {MEAT_CHOICE_INGREDIENTS} from '../meat-choice-foods.js';
import {PALETTE_INGREDIENTS, PALETTE_RECIPES} from '../palette-foods.js';
import {originalNutrients, originalRecipe} from './helpers/original-nutrients.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {ACCOMPANIMENT_INGREDIENTS, ACCOMPANIMENT_RECIPES} from '../accompaniment-foods.js';
import {SALAD_INGREDIENTS, buildSaladRecipe} from '../salad-builder.js';
import {DISH_CUSTOM_INGREDIENTS} from '../dish-customisation.js';
import {browseDishes} from '../dish-hierarchy.js';
import {describeRecipe, eligibleRecipes} from '../planner.js';
import {defaultJournal, parseJournal, JOURNAL_KEY} from '../journal.js';
import {createCatalogEntry} from '../record-actions.js';
import {itemFromRecipe, itemNutrition, recipeNutrition, summariseEntries} from '../nutrition.js';
import {recipePortion} from '../catalog.js';
import {shoppingForEntries} from '../shopping.js';

const data = {allergens: ALLERGENS, ingredients: INGREDIENTS, recipes: RECIPES};
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const near = (actual, expected, message = '') => assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} != ${expected}`);
const movedIds = ['classic-boiled-egg', 'classic-natto-plain', 'classic-natto-grated-daikon'];
const newIds = new Set([...ACCOMPANIMENT_RECIPES,...PALETTE_RECIPES,...MAPO_RECIPES].map(recipe => recipe.id));
const newIngredientIds = new Set([...Object.keys(ACCOMPANIMENT_INGREDIENTS), ...Object.keys(SALAD_INGREDIENTS), ...Object.keys(DISH_CUSTOM_INGREDIENTS),...Object.keys(PALETTE_INGREDIENTS),...Object.keys(MEAT_CHOICE_INGREDIENTS),...Object.keys(MAPO_INGREDIENTS)]);
const date = '2026-11-13';
const recordInput = (recipeId, amount = 1, status = 'planned') => ({recipeId, date, meal: 'dinner', status, amount});

// 固定値は変更前の v3.5.0（e6eb306）の独立 worktree 847品・363食材から計算。
// 分類変更した3品だけ role/family を除き、残る844品では分類も含めてすべて照合します。
test('旧847品と363食材は、指定3品の主菜から副菜への移動以外の全内容を保持する', () => {
  const originals = RECIPES.filter(recipe => !newIds.has(recipe.id)).map(originalRecipe);
  assert.equal(originals.length, 847);
  const projected = originals.map(recipe => {
    if (!movedIds.includes(recipe.id)) return recipe;
    const {role, family, ...rest} = recipe;
    assert.equal(role, 'side', recipe.id);
    assert.equal(family, 'small-dish', recipe.id);
    assert.equal(recipe.mealBase, false, recipe.id);
    assert.equal(recipe.staple, false, recipe.id);
    return rest;
  });
  assert.equal(hash(projected), '9109f818df0caebd831eb24565efcb68edc1831479a2777217ccc8995c60361b');
  const ingredients = Object.fromEntries(Object.entries(INGREDIENTS).filter(([id]) => !newIngredientIds.has(id)).map(([id,item])=>[id,originalNutrients(item)]));
  assert.equal(Object.keys(ingredients).length, 363);
  assert.equal(hash(ingredients), '19f36fa2fef787890372a301497c7b6efec60f8ab430c25b6d50f0cf606b89bf');
  const profiles = Object.fromEntries(Object.entries(ingredients).map(([id, ingredient]) => [id,
    {nutritionPerUnit: ingredient.nutritionPerUnit, nutritionSource: ingredient.nutritionSource}]));
  assert.equal(hash(profiles), '8c69992448fb2b0cbf560075a8cfee5879756b3963e90f4b4509cf2f621eeecc');
  for (const section of ['main', 'side']) {
    const choices = new Set(browseDishes(RECIPES, {section}).map(recipe => recipe.id));
    for (const id of movedIds) assert.equal(choices.has(id), section === 'side', `${section}/${id}`);
  }
});

test('以前に主菜として記録した納豆とゆで卵は、分類を更新しても当時の役割・量・栄養を保持する', () => {
  const state = defaultJournal(date);
  state.entries = movedIds.map((id, index) => {
    const recipe = describeRecipe(id, data);
    const item = {...itemFromRecipe(recipe, data, 1.5), role: 'main', portion: recipePortion(recipe, data)};
    return {id: `historical-side-${index}`, date, meal: 'dinner', status: 'eaten', note: '', items: [item]};
  });
  const loaded = parseJournal(JSON.stringify(state), data);
  assert.equal(JOURNAL_KEY, 'kondate-note-v3');
  assert.equal(loaded.version, 3);
  assert.deepEqual(loaded.entries, state.entries);
  assert.ok(loaded.entries.every(entry => entry.items[0].role === 'main'));
  for (const entry of loaded.entries) {
    const item = entry.items[0];
    const base = recipeNutrition(RECIPES.find(recipe => recipe.id === item.recipeId), data);
    for (const [key, value] of Object.entries(itemNutrition(item))) {
      if (base[key] === null) assert.equal(value, null, key);
      else near(value, base[key] * 1.5, key);
    }
  }
});

test('ご飯のお供8品を単品の副菜として記録し、生卵と牛丼のご飯を二重計上しない', () => {
  assert.equal(ACCOMPANIMENT_RECIPES.length, 8);
  assert.equal(RECIPES.length, 855+PALETTE_RECIPES.length+MAPO_RECIPES.length);
  for (const source of ACCOMPANIMENT_RECIPES) {
    const recipe = RECIPES.find(candidate => candidate.id === source.id);
    assert.ok(recipe, source.id);
    assert.equal(recipe.role, 'side', source.id);
    assert.equal(recipe.staple, false, source.id);
    assert.equal(recipe.mealBase, false, source.id);
    assert.ok(recipe.ingredients.every(part => part.id !== 'rice'), source.id);
  }
  const egg = createCatalogEntry(recordInput('acmp-egg-raw'), data);
  const beef = createCatalogEntry(recordInput('beef-rice-bowl'), data);
  assert.deepEqual(egg.items[0].ingredients, [{id: 'egg', amount: 1}]);
  assert.equal(egg.items[0].portion.amount, 1);
  assert.equal(egg.items[0].portion.unit, '個');
  assert.match(egg.items[0].portion.label, /50g/);
  near(itemNutrition(egg.items[0]).kcal, 71);
  const planned = [egg, beef];
  const shopping = shoppingForEntries(planned, data, {from: date, to: date, servings: 2});
  assert.equal(shopping.items.find(item => item.id === 'egg').required, 2);
  const expectedRice = beef.items[0].ingredients.filter(part => part.id === 'rice').reduce((sum, part) => sum + part.amount * beef.items[0].quantity * 2, 0);
  near(shopping.items.find(item => item.id === 'rice').required, expectedRice);
  const state = defaultJournal(date); state.entries = planned;
  assert.deepEqual(parseJournal(JSON.stringify(state), data).entries, planned);
});

test('サラダの材料とドレッシングを1品へまとめ、半皿の栄養・保存・3人分の買い物へ反映する', () => {
  const recipe = buildSaladRecipe({id: 'custom-salad-integration',
    components: [{id: 'lettuce', amount: 60}, {id: 'tomato', amount: 80}, {id: 'broccoli', amount: 30}],
    dressingId: 'mayonnaise', dressingAmount: 10}, data);
  const customData = {...data, recipes: [...RECIPES, recipe]};
  const item = createCatalogEntry(recordInput(recipe.id, 0.5), customData);
  const state = defaultJournal(date); state.customRecipes = [recipe]; state.entries = [item];
  const loaded = parseJournal(JSON.stringify(state), data);
  assert.equal(loaded.customRecipes.length, 1);
  assert.equal(loaded.entries.length, 1);
  assert.equal(loaded.entries[0].items.length, 1, '野菜を独立した複数メニューへ分裂させない');
  assert.deepEqual(loaded.entries[0].items[0].ingredients, [
    {id: 'lettuce', amount: 60}, {id: 'tomato', amount: 80},
    {id: 'salad_broccoli_boiled', amount: 30}, {id: 'mayonnaise', amount: 10},
  ]);
  const expected = {kcal: 49.2, protein: 1.115, fat: 3.93, carbs: 3.68, fiber: 1.375, salt: 0.095};
  const consumed = {...loaded.entries[0], status: 'eaten'};
  const summary = summariseEntries([consumed], {from: date, to: date});
  for (const [key, value] of Object.entries(expected)) {
    near(summary.values[key], value, key);
    assert.equal(summary.complete[key], true, key);
  }
  const shopping = shoppingForEntries(loaded.entries, data, {from: date, to: date, servings: 3, pantry: [{id: 'lettuce', amount: 20}]});
  const byId = new Map(shopping.items.map(item => [item.id, item]));
  for (const [id, expected] of [['lettuce', 90], ['tomato', 120], ['salad_broccoli_boiled', 45], ['mayonnaise', 15]]) near(byId.get(id).required, expected, id);
  near(byId.get('lettuce').buy, 70);
  assert.deepEqual(shopping.missingMenus, []);
  const recipeOnly = {...data, recipes: [recipe]};
  assert.deepEqual(eligibleRecipes({allergens: ['egg']}, recipeOnly), []);
  assert.deepEqual(eligibleRecipes({excludedIngredients: ['broccoli']}, recipeOnly), [], 'ゆでブロッコリーも元の食材の除外を引き継ぐ');
  assert.deepEqual(eligibleRecipes({excludedIngredients: ['tomato']}, recipeOnly), []);
  const historical = structuredClone(loaded); historical.customRecipes = [];
  assert.deepEqual(parseJournal(JSON.stringify(historical), data).entries, loaded.entries, 'マイメニューを消しても当時の内訳を保存する');
  historical.entries[0].items[0].recipeId = null;
  assert.deepEqual(parseJournal(JSON.stringify(historical), data).entries, historical.entries, 'マイメニューを作らない記録でも内訳と栄養を保持する');
});
