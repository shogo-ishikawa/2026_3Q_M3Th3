import test from 'node:test';
import assert from 'node:assert/strict';
import {RECIPES, INGREDIENTS, ALLERGENS} from '../data.js';
import {MEAL_OCCASIONS, hasReviewedMealOccasions, mealOccasionsFor} from '../meal-occasions.js';
import {canSuggestAtMeal} from '../meal-suitability.js';
import {generateCalendarPlan, generatePlan, replaceRecipe} from '../planner.js';

const get = id => RECIPES.find(recipe => recipe.id === id);
const dataWith = (...ids) => ({recipes: ids.map(get), ingredients: INGREDIENTS, allergens: ALLERGENS});

test('every catalogued dish carries one or more explicitly reviewed occasions', () => {
  for (const recipe of RECIPES) {
    assert.ok(hasReviewedMealOccasions(recipe), recipe.id);
    const occasions = mealOccasionsFor(recipe);
    assert.ok(occasions.length, recipe.id);
    assert.deepEqual(occasions, MEAL_OCCASIONS.filter(label => occasions.includes(label)), recipe.id);
  }
});

test('recording occasions include overlapping uses and keep alcohol out of automatic meals', () => {
  assert.deepEqual(mealOccasionsFor(get('classic-sashimi-tuna')), ['昼食', '夕食', '晩酌']);
  assert.deepEqual(mealOccasionsFor(get('snack-banana')), ['朝食', '間食']);
  assert.deepEqual(mealOccasionsFor(get('daily-snack-chocolate')), ['間食']);
  assert.deepEqual(mealOccasionsFor(get('performance-beer')), ['晩酌']);
  assert.equal(canSuggestAtMeal(get('performance-beer'), 'dinner', {banshaku:true}), false);
  assert.equal(canSuggestAtMeal(get('performance-energy'), 'breakfast'), false);
  const example = {...get('snack-banana'), id:'added-fruit', mealOccasions:['間食', '朝食']};
  assert.deepEqual(mealOccasionsFor(example), ['朝食', '間食']);
  assert.equal(hasReviewedMealOccasions({...example, mealOccasions:['夜食']}), false);
});

test('both automatic planners respect ordinary dinner-only dishes and all morning drinks are filtered', () => {
  const limited = dataWith('familiar-kimchi-nabe', 'classic-side-spinach-ohitashi', 'soup-001', 'plain-rice');
  for (const generate of [generateCalendarPlan, generatePlan]) {
    assert.ok(generate({meal:'dinner', days:1}, limited).ok);
    assert.equal(generate({meal:'lunch', days:1}, limited).ok, false);
  }
  const breakfast = dataWith('classic-fried-egg', 'plain-rice', 'soup-001', 'daily-drink-cola');
  assert.equal(generateCalendarPlan({meal:'breakfast',days:1}, breakfast, {drinkId:'auto'}).ok, false);
  assert.ok(generateCalendarPlan({meal:'breakfast',days:1}, breakfast, {drinkId:'none'}).ok);
});


test('rice balls can be proposed or swapped as a one-item snack', () => {
  const data = dataWith('daily-onigiri-salmon', 'daily-onigiri-plum');
  const plan = generateCalendarPlan({meal:'snack', days:1}, data);
  assert.ok(plan.ok);
  const [id] = plan.days[0].recipeIds;
  const replaced = replaceRecipe(plan, {dayIndex:0, recipeId:id}, data);
  assert.ok(replaced.ok);
  assert.equal(replaced.days[0].recipeIds.length, 1);
  assert.notEqual(replaced.days[0].recipeIds[0], id);
});
