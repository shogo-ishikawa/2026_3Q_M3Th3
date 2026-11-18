import test from 'node:test';
import assert from 'node:assert/strict';
import {EVENING_SIDES} from '../evening-sides.js';
import {INGREDIENTS, ALLERGENS} from '../data.js';
import {eligibleRecipes} from '../planner.js';
import {itemFromRecipe, recipeNutrition, NUTRIENT_KEYS} from '../nutrition.js';
import {recipePortion} from '../catalog.js';
import {shoppingForEntries} from '../shopping.js';

const data = {ingredients: INGREDIENTS, allergens: ALLERGENS, recipes: EVENING_SIDES};
const find = id => EVENING_SIDES.find(recipe => recipe.id === 'evening-side-' + id);

test('副菜12品に出典と調理手順があり、通常の食事に使う9品と晩酌時の3品を判別できる', () => {
  const eveningOnly = ['octopus-kimchi', 'okaka-cream-cheese', 'garlic-edamame'].map(find);
  assert.equal(EVENING_SIDES.length, 12);
  assert.deepEqual(EVENING_SIDES.filter(recipe => !recipe.mealSuitability.length), eveningOnly);
  const candidates = new Set(eligibleRecipes({}, data).map(recipe => recipe.id));
  for (const recipe of EVENING_SIDES) {
    assert.ok(candidates.has(recipe.id), recipe.id);
    assert.ok(recipe.tags.includes('晩酌'), recipe.id);
    if (!eveningOnly.includes(recipe)) assert.deepEqual(recipe.mealSuitability, ['lunch', 'dinner']);
    assert.match(recipe.sourceNote, /https:\/\//);
    assert.equal(recipe.servings, 2);
    assert.ok(recipe.steps.length >= 4);
    assert.ok(recipe.steps.every(step => step.length >= 10));
    assert.match(recipePortion(recipe, data).label, /1皿/);
    const values = recipeNutrition(recipe, data);
    assert.ok(NUTRIENT_KEYS.every(key => Number.isFinite(values[key])), recipe.name);
    assert.ok(values.kcal > 0);
  }
});

test('調味料や乳製品のアレルゲンも候補から除き、予定の小鉢は人数分だけ買い物に反映する', () => {
  const idsWithout = allergen => eligibleRecipes({allergens: [allergen]}, data).map(recipe => recipe.id);
  const octopus = find('octopus-kimchi');
  assert.ok(!idsWithout('shrimp').includes(octopus.id), 'キムチの想定原材料にえびが入る');
  assert.ok(!idsWithout('milk').includes(find('okaka-cream-cheese').id));
  assert.ok(!idsWithout('sesame').includes(find('tuna-peppers').id));

  const date = '2026-11-18';
  const item = itemFromRecipe(octopus, data);
  const entry = {id: 'sides-dinner', meal: 'dinner', status: 'planned', date, items: [item]};
  assert.equal(item.ingredients.find(part => part.id === 'octopus').amount, 40);
  const list = shoppingForEntries([entry], data, {from: date, to: date, servings: 3});
  assert.equal(list.items.find(part => part.id === 'octopus').required, 120);
  assert.equal(list.items.find(part => part.id === 'kimchi').required, 75);
  assert.deepEqual(list.missingMenus, []);
});
