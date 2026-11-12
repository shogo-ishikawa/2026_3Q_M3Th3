import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {INGREDIENT_NUTRITION} from '../ingredient-nutrients.js';
import {PREPARED_INGREDIENTS, PREPARED_RECIPES} from '../prepared-foods.js';
import {describeRecipe, eligibleRecipes} from '../planner.js';
import {itemFromRecipe, itemNutrition, recipeNutrition, NUTRIENT_KEYS} from '../nutrition.js';
import {shoppingForEntries} from '../shopping.js';

const ownIds = new Set(PREPARED_RECIPES.map(recipe => recipe.id));
const ingredients = Object.fromEntries(Object.entries({...INGREDIENTS, ...PREPARED_INGREDIENTS})
  .map(([id, item]) => [id, {...item, ...INGREDIENT_NUTRITION[id]}]));
const data = {allergens: ALLERGENS, ingredients,
  recipes: [...RECIPES.filter(recipe => !ownIds.has(recipe.id)), ...PREPARED_RECIPES]};
const get = slug => PREPARED_RECIPES.find(recipe => recipe.id === `prepared-${slug}`);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} != ${expected}`);

test('即席・レトルト・ファストフード35品を料理の種類で追加する', () => {
  assert.equal(Object.keys(PREPARED_INGREDIENTS).length, 32);
  assert.equal(PREPARED_RECIPES.length, 35);
  assert.equal(new Set(data.recipes.map(recipe => recipe.id)).size, data.recipes.length);
  assert.equal(new Set(data.recipes.map(recipe => recipe.name)).size, data.recipes.length);
  assert.deepEqual(Object.fromEntries(['instant', 'retort', 'fast-food', 'ready-to-eat']
    .map(nature => [nature, PREPARED_RECIPES.filter(recipe => recipe.nature === nature).length])),
    {instant: 16, retort: 9, 'fast-food': 6, 'ready-to-eat': 4});
  assert.equal(get('cup-udon-kitsune').family, 'udon');
  assert.equal(get('cup-soba-tempura').family, 'soba');
  assert.equal(get('retort-beef-curry').family, 'curry');
  assert.equal(get('retort-gyudon').family, 'donburi');
  assert.equal(get('burger-fish').family, 'burger');
  assert.equal(get('sandwich-egg').family, 'bread');
});

test('基準は1食で材料は2人分とし、正の材料量と商品表示に従う手順を持つ', () => {
  for (const recipe of PREPARED_RECIPES) {
    assert.equal(recipe.servings, 2, recipe.id);
    assert.equal(recipe.role, 'staple', recipe.id);
    assert.deepEqual(recipe.tags, [], recipe.id);
    assert.equal(recipe.staple, true, recipe.id);
    assert.equal(recipe.mealBase, true, recipe.id);
    assert.equal(recipe.portion.amount, 1, recipe.id);
    assert.ok(['食', '袋', '皿', '個'].includes(recipe.portion.unit), recipe.id);
    assert.equal(recipe.steps.length, 3, recipe.id);
    assert.ok(recipe.steps.every(step => step.length >= 10), recipe.id);
    assert.equal(new Set(recipe.ingredients.map(part => part.id)).size, recipe.ingredients.length, recipe.id);
    for (const part of recipe.ingredients) {
      assert.ok(data.ingredients[part.id], `${recipe.id}/${part.id}`);
      assert.ok(Number.isFinite(part.amount) && part.amount > 0, recipe.id);
    }
    assert.doesNotThrow(() => describeRecipe(recipe.id, data), recipe.id);
    assert.match(recipe.sourceNote, /商品表示を優先/, recipe.id);
    assert.doesNotMatch(recipe.sourceNote, /hamburger_bun|burger_meat_patty|soy_sauce/, recipe.id);
  }
});

test('商品未特定の代表例をアレルギー確認済みと扱わず、自動提案には使わない', () => {
  for (const recipe of PREPARED_RECIPES) {
    const described = describeRecipe(recipe.id, data);
    const recorded = itemFromRecipe(described, data);
    for (const value of [recipe, described, recorded]) {
      assert.equal(value.allergensKnown, false, recipe.id);
      assert.equal(value.ingredientsKnown, false, recipe.id);
      assert.equal(value.shoppingKnown, true, recipe.id);
    }
  }
  const allowed = new Set(eligibleRecipes({}, data).map(recipe => recipe.id));
  for (const id of ownIds) assert.ok(!allowed.has(id), id);
  const soyFree = new Set(eligibleRecipes({allergens: ['soy']}, data).map(recipe => recipe.id));
  for (const id of ownIds) assert.ok(!soyFree.has(id), id);
  assert.ok(describeRecipe(get('burger-fish').id, data).proteinSources.includes('fish'));
  assert.ok(describeRecipe(get('sandwich-egg').id, data).proteinSources.includes('egg'));
  assert.ok(describeRecipe(get('retort-beef-curry').id, data).proteinSources.includes('meat'));
  assert.ok(describeRecipe(get('retort-mapodon').id, data).proteinSources.includes('soy'));
  assert.ok(describeRecipe(get('retort-vegetable-curry').id, data).groups.includes('vegetable'));
});

test('カップ麺は乾燥製品の量で計算し、湯で栄養を薄めたり湯切り量を重ねたりしない', () => {
  const soy = get('cup-ramen-soy');
  assert.deepEqual(soy.ingredients, [{id: 'cup_ramen_soy_dry', amount: 150}, {id: 'water', amount: 600}]);
  const value = recipeNutrition(soy, data);
  close(value.kcal, 312.75); // 食品番号01191: 417kcal/100g × 乾燥75g
  close(value.salt, 4.725);
  assert.match(soy.portion.label, /乾燥.*75g.*300ml/);
  assert.match(soy.sourceNote, /スープを残した割合を自動で補正しません/);
  assert.match(get('cup-soba-tempura').sourceNote, /そば専用の栄養値ではありません/);
  for (const slug of ['cup-yakisoba-sauce', 'cup-yakisoba-salt']) {
    const recipe = get(slug);
    assert.ok(!recipe.ingredients.some(part => part.id === 'water'));
    assert.doesNotMatch(recipe.portion.label, /湯0/);
    assert.match(recipe.sourceNote, /湯切り/);
  }
});

test('レトルト丼とカレーは具とご飯を分けた購入構成で完成1皿を記録する', () => {
  const meals = PREPARED_RECIPES.filter(recipe => recipe.nature === 'retort');
  for (const recipe of meals) {
    assert.equal(recipe.ingredients.length, 2, recipe.id);
    assert.deepEqual(recipe.ingredients.find(part => part.id === 'rice'), {id: 'rice', amount: 360}, recipe.id);
    assert.equal(recipe.ingredients.find(part => part.id !== 'rice').amount, 400, recipe.id);
    assert.match(recipe.name, /ご飯込み/, recipe.id);
    assert.match(recipe.variantLabel, /ご飯込み/, recipe.id);
    assert.match(recipe.sourceNote, /二重/, recipe.id);
    assert.match(recipe.portion.label, /ご飯180g.*具200g/, recipe.id);
  }
  close(recipeNutrition(get('retort-beef-curry'), data).kcal, 518.8); // 具200g＋ご飯180g
  assert.equal(get('retort-chukadon').genre, '中華');
  assert.equal(get('retort-mapodon').genre, '中華');
  assert.match(get('retort-mapodon').sourceNote, /豆腐入り.*素/);
});

test('完成品の栄養は1個分の参考配合とし、未測定の食物繊維を0にしない', () => {
  const burger = get('burger-plain');
  assert.deepEqual(burger.ingredients, [{id: 'prepared_item_burger_plain', amount: 2}]);
  assert.deepEqual(data.ingredients.prepared_item_burger_plain.nutritionPerUnit,
    Object.fromEntries(NUTRIENT_KEYS.map(key => [key, null])));
  close(recipeNutrition(burger, data).kcal, 322.82);
  close(itemNutrition(itemFromRecipe(burger, data, 1.5)).kcal, 484.23);
  assert.equal(get('burger-chicken').manualNutrition.fiber, null);
  assert.equal(get('burger-fish').manualNutrition.fiber, null);
  for (const recipe of PREPARED_RECIPES.filter(recipe => recipe.manualNutrition)) {
    assert.deepEqual(Object.keys(recipe.manualNutrition), NUTRIENT_KEYS, recipe.id);
    assert.ok(recipe.manualNutrition.kcal > 0, recipe.id);
    assert.ok(recipe.manualNutrition.protein > 0, recipe.id);
    for (const key of NUTRIENT_KEYS) assert.ok(recipe.manualNutrition[key] === null || recipe.manualNutrition[key] >= 0, `${recipe.id}/${key}`);
  }
});

test('買い物は完成バーガーの個数とレトルトの具・ご飯を合算し、表示確認の注意も残す', () => {
  const entries = [{id: 'prepared-plan', date: '2026-11-12', meal: 'dinner', status: 'planned', note: '',
    items: [itemFromRecipe(get('burger-plain'), data), itemFromRecipe(get('retort-beef-curry'), data)]}];
  const result = shoppingForEntries(entries, data, {from: '2026-11-12', to: '2026-11-12', servings: 2, pantry: []});
  assert.equal(result.items.find(part => part.id === 'prepared_item_burger_plain').required, 2);
  assert.equal(result.items.find(part => part.id === 'prepared_item_burger_plain').unit, '個');
  assert.equal(result.items.find(part => part.id === 'retort_beef_curry').required, 400);
  assert.equal(result.items.find(part => part.id === 'rice').required, 360);
  assert.ok(!result.items.some(part => ['hamburger_bun', 'burger_meat_patty'].includes(part.id)));
  assert.equal(result.missingMenus.length, 2);
});
