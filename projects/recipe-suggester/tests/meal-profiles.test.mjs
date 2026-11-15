import test from 'node:test';
import assert from 'node:assert/strict';
import {generateCalendarPlan, replaceRecipe, describeRecipe, shoppingList} from '../planner.js';
import {normaliseMealPreferences, DEFAULT_MEAL_PREFERENCES, defaultMealPreference} from '../meal-profiles.js';
import {recipeNutrition} from '../nutrition.js';
import {recipeFamily} from '../catalog.js';
import {RECIPES, INGREDIENTS, ALLERGENS} from '../data.js';

const nutrition = {kcal: 1, protein: 0.1, fat: 0.02, carbs: 0.15, fiber: 0.01, salt: 0.001};
const ingredient = (name, groups, allergens = []) => ({name, unit: 'g', groups, allergens, proteinSources: [], nutritionPerUnit: nutrition});
const food = (id, role, parts, extra = {}) => ({id, name: id, role, genre: '和食', minutes: 15, servings: 1,
  ingredients: parts.map(([id, amount]) => ({id, amount})), steps: ['食材を用意して盛り付けます。'],
  staple: role === 'staple', tags: [], ...extra});
const DATA = {allergens: [{id: 'egg'}], ingredients: {
  egg: ingredient('卵', ['protein'], ['egg']), vegetable: ingredient('野菜', ['vegetable']),
  grain: ingredient('ご飯', ['staple']), water: ingredient('水', []),
}, recipes: [
  food('egg-a', 'main', [['egg', 200]], {family: 'egg-main', tags: ['時短']}),
  food('egg-b', 'main', [['egg', 250]], {family: 'egg-main', tags: ['ガッツリ']}),
  food('egg-c', 'main', [['egg', 180]], {family: 'egg-main', tags: ['さっぱり']}),
  food('side', 'side', [['vegetable', 80]]), food('soup', 'soup', [['vegetable', 50], ['water', 100]]),
  food('plain-rice', 'staple', [['grain', 150]], {family: 'rice', mealBase: false, portion: {amount: 150, unit: 'g'}}),
  food('water-drink', 'drink', [['water', 200]], {family: 'water', portion: {amount: 200, unit: 'ml'}}),
]};
const settings = extra => ({startDate: '2026-11-15', days: 1, seed: 5, meal: 'all', ...extra});
const preferences = changes => Object.fromEntries(['breakfast', 'lunch', 'dinner'].map(meal =>
  [meal, {...defaultMealPreference(), ...(changes?.[meal] ?? {})}]));
const energy = (day, data = DATA) => day.recipeIds.reduce((sum, id) => sum + recipeNutrition(describeRecipe(id, data), data).kcal * day.quantities[id], 0);

test('meal settings migrate legacy mood, reject malformed supplied profiles and remain independent copies', () => {
  const legacy = normaliseMealPreferences(undefined, '時短');
  assert.deepEqual(legacy, preferences(Object.fromEntries(['breakfast', 'lunch', 'dinner'].map(meal => [meal, {mood: '時短'}]))));
  const first = normaliseMealPreferences(DEFAULT_MEAL_PREFERENCES);
  first.breakfast.volume = 'light';
  assert.equal(DEFAULT_MEAL_PREFERENCES.breakfast.volume, 'normal');
  assert.equal(normaliseMealPreferences().breakfast.volume, 'normal');
  for (const bad of [null, [], {}, {breakfast: {volume: 'normal', mood: 'all'}},
    {...preferences(), snack: {volume: 'light', mood: 'all'}}, preferences({lunch: {volume: 'huge'}}),
    preferences({dinner: {mood: 'unknown'}}), {...preferences(), breakfast: {volume: 'normal', mood: 'all', extra: true}}]) {
    assert.throws(() => normaliseMealPreferences(bad));
    assert.throws(() => generateCalendarPlan(settings({mealPreferences: bad}), DATA));
  }
});

test('normal breakfast, lunch and dinner use different course counts and quantities', () => {
  const options = settings({mealPreferences: preferences()});
  const before = structuredClone({options, DATA});
  const plan = generateCalendarPlan(options, DATA);
  assert.equal(plan.ok, true);
  const [breakfast, lunch, dinner] = plan.days;
  assert.deepEqual(breakfast.recipeIds.map(id => describeRecipe(id, DATA).role).sort(), ['main', 'soup', 'staple']);
  assert.deepEqual(lunch.recipeIds.map(id => describeRecipe(id, DATA).role).sort(), ['main', 'side', 'staple']);
  assert.deepEqual(dinner.recipeIds.map(id => describeRecipe(id, DATA).role).sort(), ['main', 'side', 'soup', 'staple']);
  assert.ok(energy(breakfast) < energy(dinner));
  assert.ok(energy(lunch) < energy(dinner));
  assert.deepEqual({options, DATA}, before);
  assert.deepEqual(generateCalendarPlan(options, DATA), plan);
});

test('light and hearty act independently for each meal and leave explicit staple/drink quantities exact', () => {
  const opts = settings({mealPreferences: Object.fromEntries(Object.entries(preferences({breakfast: {volume: 'light'}, lunch: {volume: 'hearty'}})).map(([meal,p])=>[meal,{volume:p.volume,mood:p.mood}]))});
  const plan = generateCalendarPlan(opts, DATA, {stapleId: 'plain-rice', stapleMode: 'fixed', stapleAmount: 250, drinkId: 'water-drink', drinkAmount: 300});
  assert.equal(plan.ok, true);
  for (const day of plan.days) {
    assert.equal(day.quantities['plain-rice'], 250 / 150);
    assert.equal(day.quantities['water-drink'], 300 / 200);
  }
  assert.ok(!plan.days[0].recipeIds.includes('soup'));
  assert.ok(plan.days[1].recipeIds.includes('soup'));
  const normal = generateCalendarPlan(settings({mealPreferences: preferences()}), DATA);
  for (const meal of ['breakfast', 'lunch', 'dinner']) {
    const lighter = generateCalendarPlan(settings({meal, mealPreferences: preferences({[meal]: {volume: 'light'}})}), DATA);
    const heartier = generateCalendarPlan(settings({meal, mealPreferences: preferences({[meal]: {volume: 'hearty'}})}), DATA);
    assert.ok(energy(lighter.days[0]) < energy(normal.days.find(day => day.meal === meal)), meal);
    assert.ok(energy(heartier.days[0]) > energy(normal.days.find(day => day.meal === meal)), meal);
  }
});

test('per-meal mood chooses its own safe main and survives replacement', () => {
  const mealPreferences = preferences({breakfast: {mood: '時短', volume: 'light'}, lunch: {mood: 'ガッツリ'}, dinner: {mood: 'さっぱり'}});
  const extra = food('egg-a-next', 'main', [['egg', 200]], {family: 'egg-main', tags: ['時短']});
  const data = {...DATA, recipes: [...DATA.recipes, extra]};
  const plan = generateCalendarPlan(settings({mealPreferences}), data);
  const main = day => day.recipeIds.find(id => describeRecipe(id, data).role === 'main');
  assert.ok(['egg-a', 'egg-a-next'].includes(main(plan.days[0])));
  assert.equal(main(plan.days[1]), 'egg-b');
  assert.equal(main(plan.days[2]), 'egg-c');
  const changed = replaceRecipe(plan, {dayIndex: 0, recipeId: main(plan.days[0])}, data);
  assert.equal(changed.ok, true);
  assert.notEqual(main(changed.days[0]), main(plan.days[0]));
  assert.ok(!changed.days[0].recipeIds.includes('soup'));
  assert.ok(changed.days[0].quantities[main(changed.days[0])] < 1);
  assert.deepEqual(changed.settings.mealPreferences, normaliseMealPreferences(mealPreferences));
  assert.equal(generateCalendarPlan(settings({mealPreferences, allergens: ['egg']}), data).ok, false);
});

test('catalogue breakfasts across seeds avoid heavy meal candidates when breakfast recipes are safe', () => {
  const data = {recipes: RECIPES, ingredients: INGREDIENTS, allergens: ALLERGENS};
  const heavy = /唐揚|揚げ|カツ|天ぷら|麻婆|焼肉|ステーキ|鍋|すき焼|餃子|ハンバーグ/;
  for (const seed of [1, 2, 3, 7, 13, 29]) {
    const plan = generateCalendarPlan(settings({meal: 'breakfast', days: 3, seed}), data, {targets: {kcal: 2000}});
    assert.equal(plan.ok, true);
    for (const day of plan.days) {
      const main = describeRecipe(day.recipeIds.find(id => describeRecipe(id, data).role === 'main'), data);
      assert.ok(!heavy.test(main.name), main.name);
      assert.ok(main.minutes <= 35, main.name);
      assert.ok(!['curry', 'ramen', 'pizza', 'fried-rice', 'donburi'].includes(recipeFamily(main)), main.name);
      assert.ok(day.recipeIds.some(id => describeRecipe(id, data).groups.includes('vegetable')));
      assert.ok(day.recipeIds.length <= 3);
    }
  }
  const restricted = generateCalendarPlan(settings({meal: 'breakfast', allergens: ['egg', 'milk']}), data);
  assert.equal(restricted.ok, true);
  for (const id of restricted.days[0].recipeIds) assert.ok(!describeRecipe(id, data).allergens.some(id => ['egg', 'milk'].includes(id)));
});

test('scaled shopping uses the proposed amount once and never rewrites recipe nutrition', () => {
  const before = structuredClone(DATA);
  const plan = generateCalendarPlan(settings({meal: 'breakfast', mealPreferences: preferences({breakfast: {volume: 'light'}})}), DATA);
  const mainId = plan.days[0].recipeIds.find(id => describeRecipe(id, DATA).role === 'main');
  const main = describeRecipe(mainId, DATA);
  const required = shoppingList(plan, 3, DATA).find(part => part.id === 'egg').amount;
  assert.ok(Math.abs(required - main.ingredients[0].amount * plan.days[0].quantities[mainId] * 3) < 1e-8);
  assert.deepEqual(DATA, before);
});

test('stew and hotpot mains supply the broth course even for hearty dinner, including swaps', () => {
  const data = {recipes: RECIPES, ingredients: INGREDIENTS, allergens: ALLERGENS};
  const hearty = preferences({dinner: {volume: 'hearty'}});
  for (const mainId of ['familiar-chicken-cream-stew', 'familiar-beef-stew', 'simmered-ishikari-nabe']) {
    const onlyMain = {...data, recipes: RECIPES.filter(recipe => recipe.role !== 'main' || recipe.id === mainId)};
    const plan = generateCalendarPlan(settings({meal: 'dinner', mealPreferences: hearty}), onlyMain);
    assert.equal(plan.ok, true, mainId);
    assert.ok(plan.days[0].recipeIds.includes(mainId));
    assert.ok(plan.days[0].recipeIds.some(id => describeRecipe(id, data).role === 'side'));
    assert.ok(!plan.days[0].recipeIds.some(id => describeRecipe(id, data).role === 'soup'), mainId);
    const noSoup = {...onlyMain, recipes: onlyMain.recipes.filter(recipe => recipe.role !== 'soup')};
    assert.equal(generateCalendarPlan(settings({meal: 'dinner', mealPreferences: hearty}), noSoup).ok, true, mainId);
  }
  const stew = food('clear-stew-id', 'main', [['egg', 200]], {displayCategory: 'egg', displayMethod: 'stew'});
  const ordinary = food('ordinary-main', 'main', [['egg', 200]], {name: '鍋という語を名前に含む炒め物', displayCategory: 'egg', displayMethod: 'stir-fry'});
  const originalData = {...DATA, recipes: [...DATA.recipes.filter(recipe => recipe.role !== 'main'), ordinary]};
  const original = generateCalendarPlan(settings({meal: 'dinner', mealPreferences: hearty}), originalData);
  assert.ok(original.days[0].recipeIds.includes('soup'), '名称に鍋を含むだけでは汁物を省かない');
  const swapData = {...originalData, recipes: [...originalData.recipes, stew]};
  const changed = replaceRecipe(original, {dayIndex: 0, recipeId: ordinary.id}, swapData);
  assert.ok(changed.days[0].recipeIds.includes(stew.id));
  assert.ok(!changed.days[0].recipeIds.includes('soup'));
  const restored = replaceRecipe(changed, {dayIndex: 0, recipeId: stew.id}, swapData);
  assert.ok(restored.days[0].recipeIds.includes('soup'));
});
