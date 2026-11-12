import test from 'node:test';
import assert from 'node:assert/strict';
import {eligibleRecipes, generateCalendarPlan, updatePlanStaple, replaceRecipe, toggleDish, shoppingList} from '../planner.js';
import {itemFromRecipe} from '../nutrition.js';

const unitNutrition = {kcal: 1, protein: 0.1, fat: 0.02, carbs: 0.15, fiber: 0.01, salt: 0.001};
const ingredient = (name, groups = [], allergens = [], unit = 'g') => ({name, groups, allergens, unit, proteinSources: [], nutritionPerUnit: unitNutrition});
const food = (id, role, parts, extra = {}) => ({id, name: id, role, genre: '和食', minutes: 10, servings: 1, staple: role === 'staple',
  ingredients: parts.map(([id, amount]) => ({id, amount})), steps: ['材料を用意して人数分に盛る。'], tags: [], ...extra});
const DATA = {allergens: [{id: 'wheat'}], ingredients: {
  vegetable: ingredient('野菜', ['vegetable']), meat: ingredient('肉', ['protein']), fish: ingredient('魚', ['protein']),
  rice: ingredient('ご飯', ['staple']), flour: ingredient('小麦粉', ['staple'], ['wheat']),
  water: ingredient('水', [], [], 'ml'), beer: ingredient('ビール', [], [], 'ml'),
}, recipes: [
  food('western-a', 'main', [['meat', 100]], {genre: '洋食'}), food('western-b', 'main', [['meat', 120]], {genre: '洋食'}),
  food('japanese-a', 'main', [['fish', 100]]), food('japanese-b', 'main', [['fish', 120]]),
  food('side', 'side', [['vegetable', 80]]), food('soup', 'soup', [['vegetable', 20], ['water', 150]]),
  food('plain-rice', 'staple', [['rice', 150]], {family: 'rice', mealBase: false, portion: {amount: 150, unit: 'g'}}),
  food('bread', 'staple', [['flour', 50]], {genre: '洋食', family: 'bread', mealBase: false, portion: {amount: 1, unit: '枚'}}),
  food('pasta', 'staple', [['flour', 100]], {genre: '洋食', family: 'pasta', mealBase: true, portion: {amount: 1, unit: '皿'}}),
  food('curry', 'staple', [['rice', 150], ['vegetable', 50]], {genre: '洋食', family: 'curry', mealBase: true, portion: {amount: 1, unit: '皿'}}),
  food('water-drink', 'drink', [['water', 200]], {family: 'water'}),
  food('beer-drink', 'drink', [['beer', 350]], {name: 'ビール', family: 'alcohol', nature: 'ready-to-eat'}),
  food('snack', 'snack', [['flour', 20]]),
]};
const settings = extra => ({startDate: '2026-11-13', days: 1, servings: 2, seed: 17, ...extra});
const westernOnly = () => ({...DATA, recipes: DATA.recipes.filter(recipe => recipe.role !== 'main' || recipe.genre === '洋食')});
const japaneseOnly = () => ({...DATA, recipes: DATA.recipes.filter(recipe => recipe.role !== 'main' || recipe.genre === '和食')});
const sum = values => Object.values(values).reduce((total, value) => total + value, 0);

test('3食指定は日付ごとに朝昼晩の順で全件を返し、日数とジャンルの目標数を区別する', () => {
  const options = settings({meal: 'all', days: 7, preferences: {genreMode: 'ratio', genreRatios: {和食: 50, 洋食: 50, 中華: 0, エスニック: 0, その他: 0}}});
  const before = structuredClone({options, DATA});
  const plan = generateCalendarPlan(options, DATA);
  assert.equal(plan.ok, true);
  assert.equal(plan.settings.days, 7);
  assert.equal(plan.settings.meal, 'all');
  assert.deepEqual(plan.days.map(day => [day.date, day.meal]),
    ['2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19']
      .flatMap(date => ['breakfast', 'lunch', 'dinner'].map(meal => [date, meal])));
  assert.equal(sum(plan.genreSummary.targets), 21);
  assert.equal(sum(plan.genreSummary.actual), 21);
  assert.deepEqual(generateCalendarPlan(options, DATA), plan);
  assert.deepEqual({options, DATA}, before);
});

test('3食の候補不足は部分的な成功にせず、固定した記録専用飲料も無理に提案しない', () => {
  const noSoup = {...DATA, recipes: DATA.recipes.filter(recipe => recipe.role !== 'soup')};
  const missing = generateCalendarPlan(settings({meal: 'all', days: 2}), noSoup);
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.days, []);
  assert.ok(missing.missingRoles.includes('soup'));
  const alcohol = generateCalendarPlan(settings({meal: 'all', days: 2, drinkId: 'beer-drink'}), DATA);
  assert.equal(alcohol.ok, false);
  assert.deepEqual(alcohol.days, []);
});

test('適応主食は洋食の朝食にパン、和食にご飯を合わせ、一品料理を追加の主食にしない', () => {
  const western = generateCalendarPlan(settings({meal: 'breakfast', stapleMode: 'adaptive'}), westernOnly());
  assert.equal(western.ok, true);
  assert.ok(western.days[0].recipeIds.includes('bread'));
  assert.ok(!western.days[0].recipeIds.some(id => ['pasta', 'curry'].includes(id)));
  assert.equal(western.days[0].quantities.bread, 1);
  const japanese = generateCalendarPlan(settings({meal: 'breakfast', stapleMode: 'adaptive'}), japaneseOnly());
  assert.ok(japanese.days[0].recipeIds.includes('plain-rice'));
  assert.equal(japanese.days[0].quantities['plain-rice'], 1);
  const changedMode = generateCalendarPlan(settings({meal: 'breakfast', stapleMode: 'adaptive', stapleId: 'plain-rice', stapleAmount: 300}), westernOnly());
  assert.equal(changedMode.settings.stapleId, 'auto');
  assert.equal(changedMode.settings.stapleAmount, null);
  assert.ok(changedMode.days[0].recipeIds.includes('bread'));
  const swappedBread = replaceRecipe(western, {dayIndex: 0, recipeId: 'bread'}, westernOnly());
  assert.equal(swappedBread.ok, true);
  assert.ok(!swappedBread.days[0].recipeIds.some(id => ['pasta', 'curry'].includes(id)), '添える主食の差し替えでも一品料理を重ねない');
});

test('固定主食と追加なしを保ち、単独の食事や間食は従来どおり提案する', () => {
  const fixed = generateCalendarPlan(settings({meal: 'all', stapleMode: 'fixed', stapleId: 'bread', stapleAmount: 2}), DATA);
  assert.equal(fixed.ok, true);
  assert.equal(fixed.days.length, 3);
  assert.ok(fixed.days.every(day => day.recipeIds.includes('bread') && day.quantities.bread === 2));
  const omitted = generateCalendarPlan(settings({meal: 'lunch', stapleMode: 'adaptive', stapleId: 'none'}), DATA);
  assert.equal(omitted.days.length, 1);
  assert.ok(!omitted.days[0].recipeIds.some(id => DATA.recipes.find(recipe => recipe.id === id).role === 'staple'));
  const snack = generateCalendarPlan(settings({meal: 'snack', days: 2, drinkId: 'water-drink'}), DATA);
  assert.equal(snack.ok, true);
  assert.equal(snack.days.length, 2);
  assert.ok(snack.days.every(day => day.meal === 'snack' && day.recipeIds.length === 2 && day.recipeIds.includes('snack') && day.recipeIds.includes('water-drink')));
});

test('主食の個別変更は対象の食事だけに適用し、量は差し替え・除外切替・買物でも保持する', () => {
  const data = westernOnly(), original = generateCalendarPlan(settings({meal: 'breakfast', days: 2, stapleMode: 'adaptive'}), data);
  const before = structuredClone(original);
  const updated = updatePlanStaple(original, {dayIndex: 0, stapleId: 'plain-rice', amount: 225}, data);
  assert.equal(updated.ok, true);
  assert.deepEqual(original, before);
  assert.deepEqual(updated.settings, original.settings);
  assert.deepEqual(updated.days[1], original.days[1]);
  assert.equal(updated.days[0].stapleId, 'plain-rice');
  assert.equal(updated.days[0].stapleMode, 'fixed');
  assert.equal(updated.days[0].stapleAmount, 225);
  assert.equal(updated.days[0].quantities['plain-rice'], 1.5);
  assert.ok(!updated.days[0].recipeIds.includes('bread'));
  const main = updated.days[0].recipeIds.find(id => data.recipes.find(recipe => recipe.id === id).role === 'main');
  const swapped = replaceRecipe(updated, {dayIndex: 0, recipeId: main}, data);
  assert.equal(swapped.ok, true);
  assert.equal(swapped.days[0].stapleId, 'plain-rice');
  assert.equal(swapped.days[0].quantities['plain-rice'], 1.5);
  const omitted = toggleDish(swapped, {dayIndex: 0, recipeId: 'side'}, data);
  const restored = toggleDish(omitted, {dayIndex: 0, recipeId: 'side'}, data);
  assert.equal(restored.days[0].quantities['plain-rice'], 1.5);
  assert.equal(shoppingList(restored, 3, data).find(item => item.id === 'rice').amount, 675);
  const none = updatePlanStaple(updated, {dayIndex: 0, stapleId: 'none'}, data);
  assert.ok(!none.days[0].recipeIds.some(id => data.recipes.find(recipe => recipe.id === id).role === 'staple'));
  assert.deepEqual(none.days[1], original.days[1]);
});

test('重複する主食や除外条件外の主食、不正な量を個別変更として受け付けない', () => {
  const data = westernOnly(), plan = generateCalendarPlan(settings({meal: 'breakfast'}), data);
  for (const options of [
    {dayIndex: -1, stapleId: 'plain-rice', amount: 100}, {dayIndex: 2, stapleId: 'plain-rice', amount: 100},
    {dayIndex: 0, stapleId: 'missing', amount: 100}, {dayIndex: 0, stapleId: 'beer-drink', amount: 100},
    {dayIndex: 0, stapleId: 'pasta', amount: 1}, {dayIndex: 0, stapleId: 'curry', amount: 1},
    ...[0, -1, NaN, Infinity].map(amount => ({dayIndex: 0, stapleId: 'plain-rice', amount})),
  ]) assert.throws(() => updatePlanStaple(plan, options, data));
  const excluded = generateCalendarPlan(settings({meal: 'breakfast', allergens: ['wheat']}), data);
  assert.equal(excluded.ok, true);
  assert.throws(() => updatePlanStaple(excluded, {dayIndex: 0, stapleId: 'bread', amount: 1}, data));
  const starched = food('pasta-main', 'main', [['flour', 100]], {genre: '洋食', staple: true, family: 'pasta', mealBase: true});
  const onlyStarched = {...data, recipes: [...data.recipes.filter(recipe => recipe.role !== 'main'), starched]};
  const starchPlan = generateCalendarPlan(settings(), onlyStarched);
  assert.equal(starchPlan.ok, true);
  assert.throws(() => updatePlanStaple(starchPlan, {dayIndex: 0, stapleId: 'plain-rice', amount: 100}, onlyStarched));
  const complete = generateCalendarPlan(settings({stapleMode: 'fixed', stapleId: 'pasta'}), data);
  assert.equal(complete.ok, true);
  assert.throws(() => updatePlanStaple(complete, {dayIndex: 0, stapleId: 'plain-rice', amount: 100}, data));
});

test('3食プランの一食を変更しても別の食事の主食や数量を書き換えない', () => {
  const data = japaneseOnly(), plan = generateCalendarPlan(settings({meal: 'all', days: 2}), data);
  const updated = updatePlanStaple(plan, {dayIndex: 1, stapleId: 'plain-rice', amount: 90}, data);
  assert.deepEqual(updated.settings, plan.settings);
  for (const [index, day] of plan.days.entries()) if (index !== 1) assert.deepEqual(updated.days[index], day);
  assert.equal(updated.days[1].meal, 'lunch');
  assert.equal(updated.days[1].quantities['plain-rice'], 0.6);
  const main = updated.days[1].recipeIds.find(id => data.recipes.find(recipe => recipe.id === id).role === 'main');
  const replaced = replaceRecipe(updated, {dayIndex: 1, recipeId: main}, data);
  assert.equal(replaced.ok, true);
  assert.equal(replaced.days[1].quantities['plain-rice'], 0.6);
});

test('お酒は組み込み・手入力の推測分類とも記録できるが、自動・固定の飲み物候補にしない', () => {
  const wine = food('custom-wine', 'drink', [['beer', 150]], {name: '赤ワイン', custom: true, allergensKnown: true, ingredientsKnown: true, allergens: []});
  const data = {...DATA, recipes: [...DATA.recipes, wine]};
  const allowed = new Set(eligibleRecipes({}, data).map(recipe => recipe.id));
  assert.ok(!allowed.has('beer-drink'));
  assert.ok(!allowed.has(wine.id));
  assert.equal(itemFromRecipe(wine, data).nutrition.kcal, 150);
  for (const drinkId of ['beer-drink', wine.id]) assert.equal(generateCalendarPlan(settings({drinkId}), data).ok, false);
  const onlyAlcohol = {...data, recipes: data.recipes.filter(recipe => recipe.role !== 'drink' || ['beer-drink', wine.id].includes(recipe.id))};
  const impossible = generateCalendarPlan(settings({meal: 'all', drinkId: 'auto'}), onlyAlcohol);
  assert.equal(impossible.ok, false);
  assert.deepEqual(impossible.days, []);
});

test('主菜を汁麺へ替えると追加の主食と汁物を外し、戻すと必要な構成を戻す', () => {
  const originalData = {...DATA, recipes: DATA.recipes.filter(recipe => recipe.role !== 'main' || recipe.id === 'western-a')};
  const original = generateCalendarPlan(settings({meal: 'breakfast'}), originalData);
  const broth = food('udon-main', 'main', [['flour', 100]], {staple: true, family: 'udon', mealBase: true});
  const data = {...originalData, recipes: [...originalData.recipes, broth]};
  const changed = replaceRecipe(original, {dayIndex: 0, recipeId: 'western-a'}, data);
  assert.equal(changed.ok, true);
  assert.deepEqual(changed.days[0].recipeIds.sort(), ['udon-main', 'side'].sort());
  const restored = replaceRecipe(changed, {dayIndex: 0, recipeId: 'udon-main'}, data);
  assert.equal(restored.ok, true);
  assert.ok(restored.days[0].recipeIds.includes('bread'));
  assert.ok(restored.days[0].recipeIds.includes('soup'));
  assert.ok(original.days[0].recipeIds.includes('bread'));
  assert.ok(original.days[0].recipeIds.includes('soup'));
});
