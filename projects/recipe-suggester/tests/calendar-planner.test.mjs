import test from 'node:test';
import assert from 'node:assert/strict';
import {describeRecipe, eligibleRecipes, generateCalendarPlan, generatePlan, replaceRecipe, shoppingList, toggleDish} from '../planner.js';

const nutrients = extra => ({kcal: 200, protein: 10, fat: 5, carbs: 25, fiber: 2, salt: 0.5, ...extra});
const ingredient = (name, groups = [], allergens = [], extra = {}) => ({name, unit: 'g', groups, allergens, proteinSources: [], nutritionPerUnit: nutrients({kcal: 1, protein: 0.1, fat: 0, carbs: 0.1, fiber: 0.01, salt: 0}), ...extra});
const food = (id, role, parts = ['vegetable'], extra = {}) => ({id, name: id, role, genre: '和食', minutes: 10, servings: 1,
  ingredients: parts.map(id => ({id, amount: 100})), steps: ['材料を用意します。'], tags: [], staple: role === 'staple', ...extra});
const manual = (id, role, nutrition, extra = {}) => food(id, role, ['vegetable'], {custom: true,
  manualNutrition: nutrients(nutrition), allergens: [], allergensKnown: true, ingredientsKnown: true, ...extra});
const DATA = {allergens: [{id: 'milk'}, {id: 'soy'}], ingredients: {
  vegetable: ingredient('野菜', ['vegetable']), rice: ingredient('米', ['staple']),
  flour: ingredient('粉', ['staple']), milk: ingredient('牛乳', ['dairy'], ['milk'], {unit: 'ml'}),
  water: ingredient('水', [], [], {unit: 'ml'}), bean: ingredient('大豆', ['protein'], ['soy']),
  sauce: ingredient('たれ', [], [], {derivedFrom: ['bean']}),
}, recipes: [food('main-a', 'main'), food('main-b', 'main'), food('pasta-main', 'main', ['flour'], {staple: true}),
  food('side', 'side'), food('soup', 'soup', ['water']), food('rice', 'staple', ['rice']), food('bread', 'staple', ['flour']),
  food('milk-drink', 'drink', ['milk']), food('water-drink', 'drink', ['water']), food('snack-a', 'snack', ['flour']), food('snack-b', 'snack')]};
const settings = extra => ({startDate: '2026-11-10', days: 1, servings: 2, seed: 7, ...extra});
const snapshot = (nutrition, extra = {}) => ({recipeId: null, name: '過去の食事', quantity: 1, nutrition: nutrients(nutrition), groups: [], proteinSources: [], ...extra});
const entry = (date, meal, status = 'eaten', item = snapshot({}), extra = {}) => ({date, meal, status, items: [item], ...extra});

test('calendar proposals support every meal and snacks do not become a full dinner', () => {
  for (const meal of ['breakfast', 'lunch', 'dinner', 'snack']) {
    const plan = generateCalendarPlan(settings(), DATA, {meal, drinkId: 'water-drink'});
    assert.equal(plan.ok, true);
    assert.equal(plan.days[0].meal, meal);
    const roles = plan.days[0].recipeIds.map(id => describeRecipe(id, DATA).role);
    assert.ok(roles.includes('drink'));
    if (meal === 'snack') {
      assert.deepEqual(roles.sort(), ['drink', 'snack']);
      assert.ok(!plan.days[0].warnings.some(text => /主食の食品群|野菜の食品群|たんぱく源の食品群/.test(text)));
    } else for (const role of ['main', 'side', 'soup']) assert.ok(roles.includes(role));
  }
  assert.throws(() => generatePlan(settings({meal: 'snack'}), DATA), /朝食・昼食・夕食/);
});

test('selected staples choose compatible mains and never double an existing staple', () => {
  const specific = generateCalendarPlan(settings(), DATA, {stapleId: 'bread'});
  assert.equal(specific.ok, true);
  assert.ok(specific.days[0].recipeIds.includes('bread'));
  assert.ok(!specific.days[0].recipeIds.includes('pasta-main'));
  const onlyPasta = {...DATA, recipes: DATA.recipes.filter(recipe => recipe.role !== 'main' || recipe.staple)};
  const auto = generateCalendarPlan(settings(), onlyPasta);
  assert.equal(auto.ok, true);
  assert.equal(auto.days[0].recipeIds.filter(id => describeRecipe(id, DATA).role === 'staple').length, 0);
  const impossible = generateCalendarPlan(settings(), onlyPasta, {stapleId: 'bread'});
  assert.equal(impossible.ok, false);
  assert.match(impossible.warnings.join(''), /重複しない主菜/);
  const none = generateCalendarPlan(settings(), DATA, {stapleId: 'none'});
  assert.ok(!none.days[0].recipeIds.some(id => describeRecipe(id, DATA).role === 'staple'));
});

test('specific beverages respect hard exclusions and enter the shopping amounts', () => {
  assert.equal(generateCalendarPlan(settings({allergens: ['milk']}), DATA, {drinkId: 'milk-drink'}).ok, false);
  assert.equal(generateCalendarPlan(settings({excludedIngredients: ['milk']}), DATA, {drinkId: 'milk-drink'}).ok, false);
  const plan = generateCalendarPlan(settings(), DATA, {stapleId: 'bread', drinkId: 'milk-drink'});
  const list = shoppingList(plan, 3, DATA);
  assert.equal(list.find(item => item.id === 'milk').amount, 300);
  assert.equal(list.find(item => item.id === 'flour').amount, 300);
});

test('manual recipes fail closed for unknown allergens and inherit ingredient ancestry', () => {
  const customs = [manual('custom-unknown', 'main', {}, {allergensKnown: false}),
    manual('custom-no-ingredients', 'main', {protein: null}, {ingredients: [], ingredientsKnown: false}),
    manual('custom-sauce', 'main', {}, {ingredients: [{id: 'sauce', amount: 10}], allergens: ['milk']})];
  const data = {...DATA, recipes: [...DATA.recipes, ...customs]};
  assert.ok(!eligibleRecipes({}, data).some(recipe => recipe.id === 'custom-unknown'));
  assert.ok(eligibleRecipes({}, data).some(recipe => recipe.id === 'custom-no-ingredients'));
  assert.ok(!eligibleRecipes({excludedIngredients: ['rice']}, data).some(recipe => recipe.id === 'custom-no-ingredients'));
  assert.deepEqual(new Set(describeRecipe('custom-sauce', data).allergens), new Set(['soy', 'milk']));
  for (const allergen of ['soy', 'milk']) assert.ok(!eligibleRecipes({allergens: [allergen]}, data).some(recipe => recipe.id === 'custom-sauce'));
  assert.equal(describeRecipe('custom-no-ingredients', data).manualNutrition.protein, null);
});

test('only consumed snapshots in the prior six days and earlier same-day meals affect nutrition', () => {
  const entries = [entry('2026-11-03', 'dinner'), entry('2026-11-04', 'breakfast', 'eaten', snapshot({kcal: 10})),
    entry('2026-11-10', 'breakfast', 'eaten', snapshot({kcal: 30}, {quantity: 2})),
    entry('2026-11-10', 'lunch', 'eaten', snapshot({kcal: null})),
    entry('2026-11-10', 'dinner'), entry('2026-11-10', 'snack'), entry('2026-11-11', 'breakfast'),
    entry('2026-11-09', 'dinner', 'planned')];
  entries[1].recipeIds = ['main-a']; // An entry may contain a legacy field; it is not another portion.
  const before = JSON.stringify(entries);
  const plan = generateCalendarPlan(settings(), DATA, {entries, targets: {kcal: 2000}});
  const basis = plan.days[0].nutritionBasis;
  assert.equal(basis.entryCount, 3);
  assert.equal(basis.itemCount, 3);
  assert.equal(basis.values.kcal, 70);
  assert.equal(basis.knownCounts.kcal, 2);
  assert.equal(basis.complete.kcal, false);
  assert.equal(basis.today.values.kcal, 60);
  assert.equal(basis.from, '2026-11-04');
  assert.equal(JSON.stringify(entries), before);
  assert.match(plan.days[0].reasons.join(''), /3件/);
});

test('nutrition-aware ranking rewards known protein and fibre rather than unknown values', () => {
  const data = {...DATA, recipes: [...DATA.recipes.filter(recipe => recipe.role !== 'main'),
    manual('main-low', 'main', {protein: 1, fiber: 0}), manual('main-high', 'main', {protein: 30, fiber: 8}),
    manual('main-unknown', 'main', {protein: null, fiber: null})]};
  const options = {stapleId: 'none', targets: {protein: 60, fiber: 20}, entries: [entry('2026-11-10', 'breakfast', 'eaten', snapshot({protein: 2, fiber: 0.2}))]};
  const plan = generateCalendarPlan(settings(), data, options);
  assert.ok(plan.days[0].recipeIds.includes('main-high'));
  assert.match(plan.days[0].reasons.join(''), /たんぱく質・食物繊維/);
  const noKnown = generateCalendarPlan(settings(), data, {...options, entries: [entry('2026-11-10', 'breakfast', 'eaten', snapshot({protein: null, fiber: null}))]});
  assert.equal(noKnown.days[0].nutritionBasis.dailyMeans.protein, null);
  assert.ok(!noKnown.days[0].reasons.some(text => /1日平均が比較値より少ない/.test(text)));
});

test('recorded excess energy and salt prefer known lower amounts; zero salt comparison is valid', () => {
  const data = {...DATA, recipes: [...DATA.recipes.filter(recipe => recipe.role !== 'main'),
    manual('main-heavy', 'main', {kcal: 1000, salt: 4}), manual('main-light', 'main', {kcal: 100, salt: 0.1}),
    manual('main-unknown', 'main', {kcal: null, salt: null})]};
  const options = {stapleId: 'none', targets: {kcal: 2000, salt: 6}, entries: [entry('2026-11-10', 'breakfast', 'eaten', snapshot({kcal: 2200, salt: 7}))]};
  const plan = generateCalendarPlan(settings(), data, options);
  assert.ok(plan.days[0].recipeIds.includes('main-light'));
  assert.match(plan.days[0].reasons.join(''), /エネルギー・食塩相当量/);
  assert.equal(generateCalendarPlan(settings(), data, {...options, targets: {salt: 0}}).ok, true);
});

test('calendar swaps and omission preserve meal mode and explicit staple settings', () => {
  const plan = generateCalendarPlan(settings(), DATA, {stapleId: 'bread', drinkId: 'milk-drink'});
  const mainId = plan.days[0].recipeIds.find(id => describeRecipe(id, DATA).role === 'main');
  const swapped = replaceRecipe(plan, {dayIndex: 0, recipeId: mainId}, DATA);
  assert.equal(swapped.mode, 'calendar');
  assert.equal(swapped.settings.stapleId, 'bread');
  assert.ok(swapped.days[0].recipeIds.includes('bread'));
  assert.ok(swapped.days[0].recipeIds.includes('milk-drink'));
  assert.ok(!swapped.days[0].recipeIds.includes('pasta-main'));
  const snack = generateCalendarPlan(settings({meal: 'snack'}), DATA);
  const replaced = replaceRecipe(snack, {dayIndex: 0, recipeId: snack.days[0].recipeIds[0]}, DATA);
  assert.equal(replaced.mode, 'calendar');
  assert.equal(toggleDish(replaced, {dayIndex: 0, recipeId: replaced.days[0].recipeIds[0]}, DATA).days[0].omittedRecipeIds.length, 1);
});

test('future proposals never become consumed nutrition and pantry preferences remain subordinate to exclusions', () => {
  const empty = generateCalendarPlan(settings({days: 3}), DATA, {targets: {protein: 60}});
  assert.ok(empty.days.every(day => day.nutritionBasis.itemCount === 0));
  const data = {...DATA, ingredients: {...DATA.ingredients, tomato: ingredient('トマト', ['vegetable'])},
    recipes: [...DATA.recipes.filter(recipe => recipe.role !== 'main'),
      food('main-plain', 'main'), food('main-stock', 'main', ['tomato'])]};
  const options = {stapleId: 'none', pantry: [{id: 'tomato', amount: 150}]};
  const stocked = generateCalendarPlan(settings(), data, options);
  assert.ok(stocked.days[0].recipeIds.includes('main-stock'));
  assert.match(stocked.days[0].reasons.join(''), /手持ちの食材/);
  const excluded = generateCalendarPlan(settings({excludedIngredients: ['tomato']}), data, options);
  assert.equal(excluded.ok, true);
  assert.ok(!excluded.days[0].recipeIds.includes('main-stock'));
});
