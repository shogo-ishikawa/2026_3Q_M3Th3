import test from 'node:test';
import {recipeOccasionIds} from '../celebration-recipes.js';
import assert from 'node:assert/strict';
import {HOUSEHOLD_AGES, defaultServings, householdSize, validateHousehold, householdAllowsRecipe} from '../household-preferences.js';
import {defaultJournal, parseJournal, validateJournal} from '../journal.js';
import {addPlanDish, eligibleRecipes, generateCalendarPlan} from '../planner.js';
import {capturePlan, restorePlan} from '../saved-plan.js';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {shoppingMenuContext} from '../shopping-workflow.js';
import {createCatalogEntry} from '../record-actions.js';
import {cookingIngredients} from '../cooking-view.js';

const date = '2026-11-19';
const data = {allergens: ALLERGENS, ingredients: INGREDIENTS, recipes: RECIPES};
const household = (counts, useForServings = true) => ({counts, useForServings});

test('年代未入力でも家族人数を登録でき、端末保存・復元後も手動人数と区別する', () => {
  const before = defaultJournal(date);
  before.settings.servings = 2;
  before.settings.household = household({unspecified: 3});
  before.settings.dislikedIngredients = ['egg', 'carrot', 'egg'];
  const restored = parseJournal(JSON.stringify(before), data);
  assert.equal(householdSize(restored.settings.household), 3);
  assert.equal(defaultServings(restored.settings), 3);
  assert.equal(restored.settings.servings, 2);
  assert.deepEqual(restored.settings.dislikedIngredients, ['egg', 'carrot']);
  assert.deepEqual(restored.settings.excludedIngredients, []);
  assert.deepEqual(Object.keys(restored.settings.household.counts), Object.keys(HOUSEHOLD_AGES));
  restored.settings.household.useForServings = false;
  assert.equal(defaultServings(restored.settings), 2);
  delete restored.settings.household;
  restored.settings.dislikedIngredients = [];
  const cleared = validateJournal(restored, data);
  assert.ok(!Object.hasOwn(cleared.settings, 'household'));
  assert.ok(!Object.hasOwn(cleared.settings, 'dislikedIngredients'));
  assert.equal(defaultServings(cleared.settings), 2);
});

test('家族構成がない従来の記録と既存の除外・優先食材は読み込み後も変わらない', () => {
  const source = defaultJournal(date);
  source.settings.servings = 7;
  source.settings.excludedIngredients = ['carrot'];
  source.settings.preferences.preferredIngredients = ['egg'];
  const settings = parseJournal(JSON.stringify(source), data).settings;
  assert.deepEqual(settings, source.settings);
  assert.equal(defaultServings(settings), 7);
});

test('家族が8人を超える場合も総人数を保存し、調理・買い物には手動の人数を使う', () => {
  const value = validateHousehold(household({adult: 4, child: 3, preschool: 2}));
  assert.equal(householdSize(value), 9);
  assert.equal(value.useForServings, false);
  assert.equal(defaultServings({household: value, servings: 6}), 6);
  const eight = validateHousehold(household({senior: 4, teen: 4}));
  assert.equal(defaultServings({household: eight, servings: 1}), 8);
});

test('読み込み時に不正な人数、未知の年代・食材、不要な家族情報を受け付けない', () => {
  for (const value of [
    {}, null, {counts: [], useForServings: true}, household({adult: 0}),
    household({adult: 1, birthday: 1}), household({child: -1}),
    household({adult: '3'}), household({adult: 1.5}), household({adult: 100}),
    household({adult: 1}, 'yes'), {...household({unspecified: 1}), name: 'sample'},
  ]) {
    const state = defaultJournal(date);
    state.settings.household = value;
    assert.throws(() => validateJournal(state, data), /家族|人数/);
  }
  const state = defaultJournal(date);
  state.settings.dislikedIngredients = ['unknown-ingredient'];
  assert.throws(() => validateJournal(state, data), /苦手な食材/);
});

test('献立・調理・買い物は家族人数を使い、個別の買い物人数と1人分の栄養は独立する', () => {
  const state = defaultJournal(date);
  state.settings.household = household({adult: 2, child: 1, senior: 1});
  state.settings.servings = 2;
  const plan = generateCalendarPlan({...state.settings, days: 1, meal: 'dinner', seed: 5}, data);
  assert.ok(plan.ok);
  assert.equal(plan.settings.servings, 4);
  assert.equal(capturePlan(plan, new Map()).settings.household, undefined);
  for (const count of [undefined, 2]) {
    const entry = createCatalogEntry({recipeId: 'plain-rice', date, meal: 'dinner', status: 'planned', amount: 120}, data);
    if (count !== undefined) entry.shoppingServings = count;
    state.entries.push(entry);
  }
  const before = structuredClone(state.entries);
  const {menus} = shoppingMenuContext(state, data, {source: 'calendar', from: date, to: date});
  assert.deepEqual(menus.map(menu => menu.servings).sort(), [2, 4]);
  const items = state.entries[0].items;
  const expected = cookingIngredients(items, 1);
  const full = cookingIngredients(items, defaultServings(state.settings));
  assert.deepEqual(full.map(part => part.amount), expected.map(part => part.amount * 4));
  assert.deepEqual(state.entries, before);
});

test('0〜5歳の家庭では刻んだくるみの誕生日サラダを外し、別のお祝い料理を提案できる', () => {
  const recipe = id => RECIPES.find(item => item.id === id);
  const salad = recipe('celebration-birthday-pear-walnut-salad');
  const potage = recipe('celebration-birthday-carrot-orange-potage');
  const settings = defaultJournal(date).settings;
  settings.household = household({adult: 1, preschool: 1});
  assert.equal(householdAllowsRecipe(salad, settings.household, data), false);
  assert.equal(householdAllowsRecipe(potage, settings.household, data), true);
  const candidates = {...data, recipes: [salad, potage]};
  const automatic = eligibleRecipes(settings, candidates, {forPlan: true});
  assert.deepEqual(automatic.map(item => item.id), [potage.id]);
  assert.ok(eligibleRecipes(settings, candidates).some(item => item.id === salad.id));
  Object.assign(settings, {days: 1, meal: 'dinner', seed: 3});
  settings.mealPreferences.dinner.soup = 'include';
  const plan = generateCalendarPlan(settings, data, {personalization: {birthDate: '1990-11-19'}});
  assert.ok(plan.ok);
  assert.ok(plan.days[0].recipeIds.map(recipe).some(dish => dish.role === 'soup' && recipeOccasionIds(dish).includes('birthday')));
  assert.ok(!plan.days[0].recipeIds.includes(salad.id));
  const persisted = capturePlan(plan, new Map());
  assert.ok(!Object.hasOwn(persisted.settings, 'household'));
  const restored = restorePlan(persisted, settings, data).plan;
  assert.throws(() => addPlanDish(restored, {dayIndex: 0, recipeId: salad.id}, data), /除外条件/);
  settings.household = household({adult: 1, child: 1});
  assert.ok(eligibleRecipes(settings, candidates, {forPlan: true}).some(item => item.id === salad.id));
});

test('硬い豆・ナッツ入り購入品や切り餅を判別し、ゆで大豆・豆腐とは区別する', () => {
  const family = household({preschool: 1});
  const includes = id => ({name: '家庭の料理', ingredients: [{id}]});
  for (const id of ['cashew', 'peanut', 'dish_mochi', 'confectionery_chocoball', 'confectionery_miino']) {
    assert.equal(householdAllowsRecipe(includes(id), family, data), false);
    assert.equal(householdAllowsRecipe(includes(id), undefined, data), true);
  }
  for (const name of ['福豆', '節分の豆', '煎り大豆', '炒り豆', '豆まき用の豆']) {
    const fixture = {ingredients: {bean: {name}}};
    assert.equal(householdAllowsRecipe(includes('bean'), family, fixture), false);
  }
  for (const id of ['soybeans-tomato', 'pork-tofu', 'bread-toast-peanut-butter']) {
    const recipe = RECIPES.find(item => item.id === id);
    assert.equal(householdAllowsRecipe(recipe, family, data), true);
  }
});
