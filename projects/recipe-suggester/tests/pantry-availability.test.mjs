import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {pantryRecipeOptions} from '../pantry-availability.js';

const byId = id => RECIPES.find(recipe => recipe.id === id);
const egg = byId('classic-boiled-egg'), pancake = byId('daily-snack-plain-pancake');
const data = (...recipes) => ({allergens: ALLERGENS, ingredients: INGREDIENTS, recipes});
const stock = (id, amount) => ({id, amount});

test('recipe quantities scale with diners; a partially stocked item is one shortage in its native unit', () => {
  const pantry = [stock('egg', 1.25), stock('milk', 120), stock('flour', 120)];
  const settings = {servings: 1, shoppingOmittedIds: ['oil', 'sugar'],
    household: {counts: {adult: 3}, useForServings: true}};
  const result = pantryRecipeOptions(data(pancake), settings, pantry);
  const [option] = result;
  assert.equal(option.recipe.id, pancake.id);
  assert.equal(option.ready, false);
  assert.equal(option.coveredCount, 4);
  assert.equal(option.ingredientCount, 5);
  assert.deepEqual(option.missing, [{id: 'egg', name: INGREDIENTS.egg.name, unit: INGREDIENTS.egg.unit,
    required: 1.5, stock: 1.25, missing: .25, alwaysOnHand: false}]);
  assert.ok(option.coverage > .96 && option.coverage < .97);
  assert.equal(option.ingredients.find(part => part.id === 'oil').alwaysOnHand, true);
  const [forTwo] = pantryRecipeOptions(data(pancake), settings, pantry, 2);
  assert.equal(forTwo.ready, true);
  assert.equal(forTwo.coverage, 1);
  assert.deepEqual(pantry, [stock('egg', 1.25), stock('milk', 120), stock('flour', 120)]);
});

test('the shopping settings alone decide which items are assumed to be in stock, after applying restrictions', () => {
  const dashimaki = byId('classic-dashimaki');
  const ingredients = dashimaki.ingredients.filter(part => !['water', 'stock_bonito_strained'].includes(part.id));
  assert.deepEqual(pantryRecipeOptions(data(dashimaki), {}, ingredients), []);
  const settings = {shoppingOmittedIds: ['bonito']};
  const [withWaterMissing] = pantryRecipeOptions(data(dashimaki), settings, ingredients);
  assert.deepEqual(withWaterMissing.missing.map(p => p.id), ['water']);
  const all = {shoppingOmittedIds: ['water', 'stock_bonito_strained']};
  assert.equal(pantryRecipeOptions(data(dashimaki), all, ingredients)[0].ready, true);
  assert.deepEqual(pantryRecipeOptions(data(dashimaki), {...all, excludedIngredients: ['bonito']}, ingredients), []);
  assert.deepEqual(pantryRecipeOptions(data(dashimaki), {...all, dislikedIngredients: ['bonito']}, ingredients), []);
  assert.deepEqual(pantryRecipeOptions(data(dashimaki), {...all, allergens: ['egg']}, ingredients), []);
});

test('strain aliases combine before subtracting stock once and floating-point noise is not a shortage', () => {
  const combined = {...egg, ingredients: [stock('kombu', .1), stock('stock_kombu_strained', .2)]};
  const [option] = pantryRecipeOptions(data(combined), {}, [stock('kombu', .2), stock('stock_kombu_strained', .1)]);
  assert.equal(option.ready, true);
  assert.equal(option.ingredientCount, 1);
  const [rounded] = pantryRecipeOptions(data(combined), {}, [stock('kombu', .3)]);
  assert.equal(rounded.ready, true);
  const [short] = pantryRecipeOptions(data(combined), {}, [stock('kombu', .299)]);
  assert.ok(Math.abs(short.missing[0].missing - .001) < 1e-12);
});

test('candidates independently use the same inventory, sort by coverage, and exclude two-shortage recipes', () => {
  const twin = {...egg, id: 'another-boiled-egg', name: 'もう一つの卵料理', minutes: egg.minutes + 1};
  const onlyEggs = [stock('egg', 2)];
  const results = pantryRecipeOptions(data(twin, pancake, egg, byId('plain-rice')), {}, onlyEggs);
  assert.deepEqual(results.map(x => [x.recipe.id, x.ready]), [
    [egg.id, true], [twin.id, true], ['plain-rice', false],
  ]);
  assert.equal(pantryRecipeOptions(data(egg), {shoppingOmittedIds: ['egg']}, [])[0].ready, true);
});

test('an empty or zero-quantity pantry needs exactly one egg to cook one serving', () => {
  for (const pantry of [[], [stock('egg', 0)]]) {
    const results = pantryRecipeOptions(data(egg, pancake), {}, pantry, 1);
    assert.deepEqual(results.filter(option => option.ready), []);
    assert.deepEqual(results.map(option => option.recipe.id), [egg.id]);
    assert.equal(results[0].coverage, 0);
    assert.deepEqual(results[0].missing.map(({id, unit, missing}) => ({id, unit, missing})),
      [{id: 'egg', unit: '個', missing: 1}]);
  }
});

test('incomplete recipes, prepared purchases, and restaurant dishes are excluded; family rules apply', () => {
  const unknown = {...egg, id: 'unknown', ingredientsKnown: false};
  const custom = {...egg, id: 'custom', nature: 'unspecified', custom: true, ingredientsKnown: true, allergensKnown: true};
  const purchased = {...egg, id: 'bought', nature: 'ready-to-eat'};
  const restaurant = {...egg, id: 'out', restaurant: {name: '店'}};
  const nuts = {...egg, id: 'nuts', ingredients: [stock('almond', 30)]};
  const settings = {household: {counts: {preschool: 1, adult: 1}, useForServings: true}};
  const pantry = [stock('egg', 2), stock('almond', 30)];
  const options = pantryRecipeOptions(data(unknown, custom, purchased, restaurant, nuts), settings, pantry);
  assert.deepEqual(options.map(option => option.recipe.id), ['custom']);
});

test('invalid serving and pantry quantities fail explicitly', () => {
  for (const servings of [0, 9, .5, '2']) {
    assert.throws(() => pantryRecipeOptions(data(egg), {}, [], servings), /人数/);
  }
  for (const rows of [[stock('egg', -1)], [stock('egg', NaN)], [stock('egg', '1')], [stock('nonexistent', 1)], [stock('egg', 1), stock('egg', 2)]]) {
    assert.throws(() => pantryRecipeOptions(data(egg), {}, rows), /手持ち/);
  }
});
