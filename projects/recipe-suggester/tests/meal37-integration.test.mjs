import {PALETTE_INGREDIENTS, PALETTE_RECIPES} from '../palette-foods.js';
import {originalNutrients, originalRecipe} from './helpers/original-nutrients.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {DISH_CUSTOM_INGREDIENTS, DISH_CUSTOMISERS, defaultDishSelection, buildCustomDish, eligibleDishSelections} from '../dish-customisation.js';
import {MENU_VARIATION_GROUPS, groupMenuRecipes, getVariationGroup} from '../menu-variations.js';
import {recipePortion, recipeNature, isCompleteMeal} from '../catalog.js';
import {browseDishes} from '../dish-hierarchy.js';
import {describeRecipe, eligibleRecipes} from '../planner.js';
import {defaultJournal, parseJournal, JOURNAL_KEY} from '../journal.js';
import {createCatalogEntry} from '../record-actions.js';
import {NUTRIENT_KEYS, itemNutrition, recipeNutrition, summariseEntries} from '../nutrition.js';
import {shoppingForEntries} from '../shopping.js';

const data = {allergens: ALLERGENS, ingredients: INGREDIENTS, recipes: RECIPES};
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const near = (actual, expected, label = '') => assert.ok(Math.abs(actual - expected) < 1e-8, `${label}: ${actual} != ${expected}`);
const date = '2026-11-13';
const recipeById = id => {const recipe = RECIPES.find(recipe => recipe.id === id); assert.ok(recipe, id); return recipe;};
const customData = recipe => ({...data, recipes: [...RECIPES, recipe]});
const record = (recipe, amount = 1, status = 'planned') => createCatalogEntry({recipeId: recipe.id, date, meal: 'dinner', status, amount}, customData(recipe));
const independentNutrition = ingredients => Object.fromEntries(NUTRIENT_KEYS.map(key => {
  const values = ingredients.map(part => INGREDIENTS[part.id].nutritionPerUnit[key] === null ? null : INGREDIENTS[part.id].nutritionPerUnit[key] * part.amount);
  return [key, values.some(value => value === null) ? null : values.reduce((sum, value) => sum + value, 0)];
}));

// 固定値はv3.6.0の独立した旧版worktreeと /tmp/meal37-baseline.json（855品・370食材）から計算。
// 画面のグループ化と具材選択は、旧レシピの材料・量・栄養・手順・ID・出典を書き換えません。
test('表示の集約とカスタム調理を加えても旧855品と370食材の全内容を維持する', () => {
  const legacy=RECIPES.filter(recipe=>!PALETTE_RECIPES.some(added=>added.id===recipe.id));
  assert.equal(legacy.length, 855);
  assert.equal(hash(legacy.map(originalRecipe)), '21f7782f30165e8fba48cfaffc3b5c7c47c23500e037e32e249cee79e53dad23');
  const newIds = new Set(Object.keys(DISH_CUSTOM_INGREDIENTS));
  const originals = Object.fromEntries(Object.entries(INGREDIENTS).filter(([id]) => !newIds.has(id)&&!Object.hasOwn(PALETTE_INGREDIENTS,id)).map(([id,item])=>[id,originalNutrients(item)]));
  assert.equal(Object.keys(originals).length, 370);
  assert.equal(hash(originals), '6525de4ed92e28ebcff68c94c070ec83dbdf3a9ad73243a63087ac2d641469cd');
  assert.equal(hash(Object.fromEntries(Object.entries(originals).map(([id, value]) => [id,
    {nutritionPerUnit: value.nutritionPerUnit, nutritionSource: value.nutritionSource}]))),
  '7a6f282b2376b75cec4aee4aa0f4dd71f706c3f3997a32f87e10773ae8dac298');
  assert.equal(JOURNAL_KEY, 'kondate-note-v3');
  assert.ok(DISH_CUSTOMISERS.some(definition => definition.kind === 'nikujaga'));
  assert.ok(DISH_CUSTOMISERS.some(definition => definition.kind === 'okonomiyaki'));
});

test('肉じゃがの肉を切り替えた分だけ材料・栄養・手順・アレルゲンと人数分の買い物が変わる', () => {
  const source = recipeById('beef-potato');
  const before = JSON.stringify(data);
  const beef = buildCustomDish({id: 'custom-audit-nikujaga-beef', kind: 'nikujaga', meat: 'beef'}, data);
  const pork = buildCustomDish({id: 'custom-audit-nikujaga-pork', kind: 'nikujaga', meat: 'pork'}, data);
  const baseParts = source.ingredients.map(part => ({id: part.id, amount: part.amount / source.servings}));
  assert.deepEqual(beef.ingredients, baseParts);
  const expectedPork = baseParts.map(part => part.id === 'beef' ? {...part, id: 'pork'} : part);
  assert.deepEqual(pork.ingredients, expectedPork);
  assert.equal(isCompleteMeal(pork), false);
  for (const [recipe, expected] of [[beef, independentNutrition(baseParts)], [pork, independentNutrition(expectedPork)]]) {
    assert.equal(recipe.servings, 1);
    assert.equal(recipe.portion.amount, 1);
    assert.equal(recipe.portion.unit, '皿');
    for (const key of NUTRIENT_KEYS) expected[key] === null ? assert.equal(recipe.manualNutrition[key], null, key) : near(recipe.manualNutrition[key], expected[key], key);
  }
  assert.match(pork.name, /豚/); assert.match(beef.name, /牛/);
  assert.ok(pork.steps.some(step => /豚肉/.test(step)));
  assert.ok(!pork.steps.some(step => /牛肉/.test(step)));
  assert.ok(pork.allergens.includes('pork')); assert.ok(!pork.allergens.includes('beef'));
  assert.equal(eligibleRecipes({allergens: ['beef']}, {...data, recipes: [pork]}).length, 1);
  assert.deepEqual(eligibleRecipes({allergens: ['pork']}, {...data, recipes: [pork]}), []);
  const entry = record(pork, 0.5);
  const shopping = shoppingForEntries([entry], data, {from: date, to: date, servings: 3});
  const porkAmount = expectedPork.filter(part => part.id === 'pork').reduce((sum, part) => sum + part.amount, 0);
  near(shopping.items.find(item => item.id === 'pork').required, porkAmount * 0.5 * 3);
  assert.ok(!shopping.items.some(item => item.id === 'beef'));
  assert.equal(JSON.stringify(data), before, '選択しても原本DBを変更しない');
});

test('お好み焼きの豚玉・海鮮・モダンで選択した具材・麺・ソースだけが記録と買い物に入る', () => {
  const pork = buildCustomDish({...defaultDishSelection('okonomiyaki', 'pork'), id: 'custom-audit-okono-pork'}, data);
  const seafood = buildCustomDish({...defaultDishSelection('okonomiyaki', 'sea-food'), id: 'custom-audit-okono-seafood'}, data);
  const modern = buildCustomDish({...defaultDishSelection('okonomiyaki', 'modern'), id: 'custom-audit-okono-modern'}, data);
  const mochi = buildCustomDish({...defaultDishSelection('okonomiyaki', 'mochi-negi'), id: 'custom-audit-okono-mochi'}, data);
  near(mochi.ingredients.find(part => part.id === 'dish_mochi').amount, 30);
  near(INGREDIENTS.dish_mochi.nutritionPerUnit.kcal * 100, 223);
  assert.ok(mochi.steps.some(step => /餅.*薄い小片/.test(step)));
  assert.ok(mochi.steps.some(step => /餅.*やわらか/.test(step)));
  assert.ok(pork.ingredients.some(part => part.id === 'dish_pork_belly_sliced'));
  assert.ok(!pork.ingredients.some(part => ['squid', 'shrimp', 'yakisoba_noodles'].includes(part.id)));
  assert.ok(seafood.ingredients.some(part => part.id === 'squid'));
  assert.ok(seafood.ingredients.some(part => part.id === 'shrimp'));
  assert.ok(!seafood.ingredients.some(part => part.id === 'dish_pork_belly_sliced'));
  assert.ok(modern.ingredients.some(part => part.id === 'yakisoba_noodles'));
  near(modern.ingredients.find(part => part.id === 'yakisoba_noodles').amount, 100);
  near(pork.ingredients.find(part => part.id === 'dish_pork_belly_sliced').amount, 50);
  near(pork.ingredients.find(part => part.id === 'worcestershire_sauce').amount * 1.195, 15, 'ソースgを既存mlの密度で換算する');
  near(pork.ingredients.find(part => part.id === 'mayonnaise').amount, 5);
  near(seafood.ingredients.find(part => part.id === 'soy_sauce').amount, 5);
  near(seafood.ingredients.find(part => part.id === 'vinegar').amount, 5);
  near(seafood.ingredients.find(part => part.id === 'soy_sauce').amount * 1.181 + seafood.ingredients.find(part => part.id === 'vinegar').amount, 10.905);
  assert.ok(modern.steps.some(step => /麺をほぐして温める/.test(step)));
  assert.ok(!pork.steps.some(step => /麺をほぐして温める/.test(step)));
  assert.ok(seafood.allergens.includes('shrimp')); assert.ok(!pork.allergens.includes('shrimp'));
  assert.deepEqual(eligibleRecipes({allergens: ['shrimp']}, {...data, recipes: [seafood]}), []);
  assert.equal(eligibleRecipes({allergens: ['shrimp']}, {...data, recipes: [pork]}).length, 1);
  assert.deepEqual(eligibleRecipes({excludedIngredients: ['pork']}, {...data, recipes: [pork]}), [], '豚バラの原料まで除外を引き継ぐ');
  for (const recipe of [pork, seafood, modern, mochi]) {
    assert.equal(isCompleteMeal(recipe), true, 'お好み焼きへ別の主食を重ねない');
    const expected = independentNutrition(recipe.ingredients);
    for (const key of NUTRIENT_KEYS) expected[key] === null ? assert.equal(recipe.manualNutrition[key], null, key) : near(recipe.manualNutrition[key], expected[key], key);
    const entry = record(recipe, 0.75);
    const shopping = shoppingForEntries([entry], data, {from: date, to: date, servings: 2});
    for (const part of recipe.ingredients) near(shopping.items.find(item => item.id === part.id).required, part.amount * 0.75 * 2, part.id);
  }
  const without = {...defaultDishSelection('okonomiyaki', 'modern'), id: 'custom-audit-okono-plain', sauceId: 'none', sauceAmount: 0, mayonnaiseAmount: 0};
  const plain = buildCustomDish(without, data);
  assert.ok(!plain.ingredients.some(part => ['mayonnaise', 'worcestershire_sauce', 'soy_sauce', 'vinegar'].includes(part.id)));
});

test('カスタム料理を保存してもしなくても確定した量・栄養・工程をv3記録へ保持する', () => {
  const dish = buildCustomDish({...defaultDishSelection('okonomiyaki', 'modern'), id: 'custom-audit-saved'}, data);
  const saved = defaultJournal(date); saved.customRecipes = [dish]; saved.entries = [record(dish, 0.5, 'eaten')];
  const loaded = parseJournal(JSON.stringify(saved), data);
  assert.deepEqual(loaded.entries, saved.entries);
  assert.equal(loaded.customRecipes.length, 1);
  const historical = structuredClone(loaded); historical.customRecipes = [];
  assert.deepEqual(parseJournal(JSON.stringify(historical), data).entries, loaded.entries, 'マイメニュー削除後も記録の内訳は保持');
  historical.entries[0].items[0].recipeId = null;
  assert.deepEqual(parseJournal(JSON.stringify(historical), data).entries, historical.entries, '保存しない単発記録でも内訳を保持');
  const past = defaultJournal(date);
  past.entries = ['beef-potato', 'seafood-okonomiyaki'].map((id, index) => {
    const entry = createCatalogEntry({recipeId: id, date, meal: 'lunch', status: 'eaten', amount: recipePortion(recipeById(id), data).amount}, data);
    entry.id = `past-customisable-${index}`; return entry;
  });
  assert.deepEqual(parseJournal(JSON.stringify(past), data).entries, past.entries, '既存料理の過去の工程と分量も置換しない');
  const planned = {...loaded.entries[0], status: 'planned'};
  assert.equal(summariseEntries([planned], {from: date, to: date}).entryCount, 0, '予定を摂取済みへ数えない');
});

test('既存バリエーションを表示だけで集約し、検索・食事区分・提供形態の候補を再混入させない', () => {
  const before = JSON.stringify(RECIPES);
  assert.ok(MENU_VARIATION_GROUPS.length >= 8);
  const full = groupMenuRecipes(RECIPES, {allRecipes: RECIPES});
  assert.ok(full.length < RECIPES.length);
  assert.equal(full.reduce((sum, group) => sum + group.recipes.length, 0), RECIPES.length);
  const ids = full.flatMap(group => group.recipes.map(recipe => recipe.id));
  assert.equal(new Set(ids).size, RECIPES.length);
  const pasta = getVariationGroup('daily-pasta-carbonara', RECIPES);
  assert.ok(pasta?.isGroup);
  assert.ok(pasta.recipes.some(recipe => recipe.id === 'daily-pasta-bolognese'));
  for (const group of full.filter(group => group.isGroup)) {
    assert.equal(new Set(group.recipes.map(recipe => recipe.role)).size, 1, group.key);
    assert.equal(new Set(group.recipes.map(recipe => recipeNature(recipe))).size, 1, group.key);
  }
  const candidates = browseDishes(RECIPES, {section: 'staple', nature: 'home-cooked', query: 'カルボナーラ'});
  assert.ok(candidates.length > 0);
  const filtered = groupMenuRecipes(candidates, {allRecipes: RECIPES, query: 'カルボナーラ'});
  assert.deepEqual(filtered.flatMap(group => group.recipes.map(recipe => recipe.id)), candidates.map(recipe => recipe.id));
  assert.ok(filtered.some(group => group.selectedRecipeId === 'daily-pasta-carbonara'));
  for (const group of filtered) for (const recipe of group.recipes) {
    assert.equal(recipeNature(recipe), 'home-cooked');
    assert.equal(recipe.role, 'staple');
  }
  const selected = recipeById('daily-pasta-carbonara');
  const entry = createCatalogEntry({recipeId: selected.id, date, meal: 'lunch', status: 'planned', amount: recipePortion(selected, data).amount / 2}, data);
  const nutrition = itemNutrition(entry.items[0]);
  const original = recipeNutrition(selected, data);
  for (const key of NUTRIENT_KEYS) original[key] === null ? assert.equal(nutrition[key], null, key) : near(nutrition[key], original[key] * 0.5, key);
  assert.equal(entry.items[0].recipeId, selected.id);
  assert.equal(JSON.stringify(RECIPES), before);
});


test('基準の料理を除外しても条件に合う具材設定を見つけ、選択後の原料除外を緩めない', () => {
  const before = JSON.stringify(data);
  const beefExcluded = eligibleDishSelections('nikujaga', {allergens: ['beef']}, data);
  assert.ok(beefExcluded.length > 0);
  assert.ok(beefExcluded.every(option => option.config.meat === 'pork'));
  assert.ok(!eligibleRecipes({allergens: ['beef']}, data).some(recipe => recipe.id === 'beef-potato'));
  const allMeatExcluded = eligibleDishSelections('nikujaga', {allergens: ['beef', 'pork']}, data);
  assert.deepEqual(allMeatExcluded, []);
  const seafoodExcluded = eligibleDishSelections('okonomiyaki', {allergens: ['shrimp', 'squid']}, data);
  assert.ok(seafoodExcluded.length > 0);
  for (const {config, recipe} of seafoodExcluded) {
    assert.ok(!config.components.some(part => ['shrimp', 'squid'].includes(part.id)));
    assert.ok(!recipe.allergens.includes('shrimp'));
    assert.ok(!recipe.allergens.includes('squid'));
    assert.equal(eligibleRecipes({allergens: ['shrimp', 'squid']}, {...data, recipes: [recipe]}).length, 1);
  }
  const dairyExcluded = eligibleDishSelections('okonomiyaki', {allergens: ['milk']}, data);
  assert.ok(dairyExcluded.length > 0);
  assert.ok(dairyExcluded.every(option => option.config.mayonnaiseAmount === 0));
  assert.deepEqual(eligibleDishSelections('okonomiyaki', {allergens: ['wheat']}, data), []);
  assert.deepEqual(eligibleDishSelections('okonomiyaki', {allergens: ['egg']}, data), []);
  const porkAncestorExcluded = eligibleDishSelections('okonomiyaki', {excludedIngredients: ['pork']}, data);
  assert.ok(porkAncestorExcluded.length > 0);
  assert.ok(porkAncestorExcluded.every(option => !option.config.components.some(part => part.id === 'pork-belly')));
  assert.equal(JSON.stringify(data), before);
});
