import test from 'node:test';
import assert from 'node:assert/strict';
import {RECIPES} from '../data.js';
import {existingOccasionIds} from '../occasion-classics.js';
import {OCCASION_LABELS} from '../occasion-calendar.js';
import {recipeOccasionIds} from '../celebration-recipes.js';
import {canSuggestAtMeal} from '../meal-suitability.js';
import {browseDishes} from '../dish-hierarchy.js';

test('every event offers alternatives in all three dinner roles and familiar dishes are searchable by occasion', () => {
  const classicRecipes = RECIPES.filter(recipe => existingOccasionIds(recipe).length);
  assert.equal(classicRecipes.length, 82);
  for (const [id, label] of Object.entries(OCCASION_LABELS)) {
    const eligible = RECIPES.filter(recipe => recipeOccasionIds(recipe).includes(id) && canSuggestAtMeal(recipe, 'dinner'));
    for (const role of ['main', 'side', 'soup']) {
      assert.ok(eligible.filter(recipe => recipe.role === role).length >= 3, label + ': ' + role);
    }
    const found = new Set(browseDishes(RECIPES, {query: label}).map(recipe => recipe.id));
    for (const recipe of classicRecipes.filter(recipe => existingOccasionIds(recipe).includes(id))) assert.ok(found.has(recipe.id), recipe.name);
  }
});
