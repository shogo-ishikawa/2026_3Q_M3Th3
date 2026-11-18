import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {generateCalendarPlan, generatePlan, regeneratePlanMeal, replaceRecipe} from '../planner.js';
import {defaultJournal, validateJournal} from '../journal.js';
import {normaliseMealPreferences} from '../meal-profiles.js';
import {canSuggestAtMeal, isBanshakuDish, recipeMealSuitability} from '../meal-suitability.js';
import {recipeFamily} from '../catalog.js';

const data = {allergens: ALLERGENS, ingredients: INGREDIENTS, recipes: RECIPES};
const recipe = id => RECIPES.find(item => item.id === id);
const skewer = 'evening-main-pork-onion-kushikatsu';
const kimchi = 'evening-side-octopus-kimchi';
const soup = 'soup-001';
const plain = 'plain-rice';
const options = (overrides = {}) => {
  const mealPreferences = normaliseMealPreferences();
  Object.assign(mealPreferences.dinner, overrides);
  return {meal: 'dinner', days: 1, startDate: '2026-11-18', seed: 3, mealPreferences};
};
const subset = ids => ({...data, recipes: ids.map(recipe)});

test('all new dishes have an explicit meal policy and alcohol remains for recording', () => {
  const additions = RECIPES.filter(item => item.id.startsWith('evening-'));
  assert.equal(additions.length, 24);
  for (const dish of additions) {
    assert.ok(isBanshakuDish(dish));
    for (const meal of ['breakfast', 'lunch', 'dinner', 'snack']) {
      assert.equal(canSuggestAtMeal(dish, meal), dish.mealSuitability.includes(meal), dish.id);
      assert.equal(canSuggestAtMeal(dish, meal, {banshaku: true}), meal === 'dinner' || dish.mealSuitability.includes(meal), dish.id);
    }
  }
  assert.equal(recipeMealSuitability(recipe(skewer)).category, 'banshaku-only');
  assert.deepEqual(recipeMealSuitability(recipe('evening-main-tuna-negi-nabe')).meals, ['dinner']);
  for (const id of ['classic-side-hiyayakko', 'varied-yakitori-thigh-salt', 'snack-edamame', 'classic-sashimi-assorted']) {
    assert.ok(isBanshakuDish(recipe(id)), id);
  }
  const drinks = RECIPES.filter(item => recipeFamily(item) === 'alcohol');
  assert.ok(drinks.length);
  assert.ok(drinks.every(drink => !isBanshakuDish(drink) && !canSuggestAtMeal(drink, 'dinner', {banshaku: true})));
});

test('automatic and legacy planners respect opt-in and ingredient exclusions', () => {
  const limited = subset([skewer, kimchi, soup, plain]);
  for (const generate of [generateCalendarPlan, generatePlan]) {
    assert.equal(generate(options(), limited).ok, false);
    const chosen = generate(options({banshaku: true}), limited);
    assert.ok(chosen.ok, chosen.warnings.join(' '));
    assert.ok(chosen.days[0].recipeIds.includes(skewer));
    assert.ok(chosen.days[0].recipeIds.includes(kimchi));
    const exclude = recipe(skewer).ingredients[0].id;
    assert.equal(generate({...options({banshaku: true}), excludedIngredients: [exclude]}, limited).ok, false);
    assert.equal(generate({...options({banshaku: true}), meal: 'lunch'}, limited).ok, false);
  }
});

test('changing one dinner retains other days, courses and portions; replacements inherit the evening preference', () => {
  const limited = subset([skewer, kimchi, 'tavern-chicken-mentaiko-mayo', 'evening-side-tarako-potato', 'side-001', 'chicken-teriyaki', plain, soup]);
  const setting = options({staple: 'rice', stapleVolume: 'light', volume: 'hearty', sideCount: 1, sideType: 'salad', soup: 'none'});
  const original = generateCalendarPlan({...setting, days: 2}, limited);
  assert.ok(original.ok, original.warnings.join(' '));
  const edited = regeneratePlanMeal(original, {dayIndex: 1, mealPreference: {banshaku: true}}, limited);
  assert.deepEqual(edited.days[0], original.days[0]);
  assert.equal(edited.settings.mealPreferences.dinner.banshaku, false);
  assert.equal(edited.days[1].mealPreference.banshaku, true);
  const next = replaceRecipe(edited, {dayIndex: 1, recipeId: edited.days[1].mainId}, limited);
  assert.ok(next.ok, next.warnings.join(' '));
  assert.notEqual(next.days[1].mainId, edited.days[1].mainId);
  for (const day of [edited.days[1], next.days[1]]) {
    assert.ok(isBanshakuDish(recipe(day.mainId)));
    assert.equal(day.quantities[plain], 100 / 150);
    assert.equal(day.quantities[day.mainId], 1.5);
    assert.ok(day.recipeIds.includes('evening-side-tarako-potato'));
    assert.ok(!day.recipeIds.includes(soup));
  }
});

test('older settings default to ordinary dinner and exported journals preserve the user choice', () => {
  const old = defaultJournal('2026-11-18');
  for (const profile of Object.values(old.settings.mealPreferences)) delete profile.banshaku;
  assert.equal(validateJournal(old, data).settings.mealPreferences.dinner.banshaku, false);
  old.settings.mealPreferences.dinner.banshaku = true;
  assert.equal(validateJournal(JSON.parse(JSON.stringify(old)), data).settings.mealPreferences.dinner.banshaku, true);
  old.settings.mealPreferences.lunch.banshaku = true;
  assert.throws(() => validateJournal(old, data), /晩酌/);
});
