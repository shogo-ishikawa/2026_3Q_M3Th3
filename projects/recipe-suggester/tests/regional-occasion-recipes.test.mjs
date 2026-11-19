import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {recipeOccasionIds, recipeCollection} from '../celebration-recipes.js';
import {mealOccasionsFor} from '../meal-occasions.js';
import {describeRecipe} from '../planner.js';
import {isAvailableOnDate} from '../planner-personalization.js';
import {REGIONAL_OCCASION_RECIPES} from '../regional-occasion-recipes.js';

const catalogue = {recipes: RECIPES, allergens: ALLERGENS, ingredients: INGREDIENTS};
const lookup = id => RECIPES.find(dish => dish.id === 'celebration-regional-' + id);

test('郷土料理を出典と地域名でたどれ、行事の候補も普段の食卓で選べる', () => {
  for (const original of REGIONAL_OCCASION_RECIPES) {
    const dish = RECIPES.find(entry => entry.id === original.id);
    assert.equal(recipeCollection(dish), 'regional', original.name);
    assert.ok(dish.searchAliases.includes('郷土料理'), dish.name);
    assert.match(dish.sourceNote, /maff\.go\.jp.+\.html/, dish.name);
    assert.deepEqual(mealOccasionsFor(dish), original.mealOccasions);
    assert.ok(isAvailableOnDate(dish, [], '2026-11-19', {}), dish.name);
  }
  assert.deepEqual(mealOccasionsFor(lookup('nara-chagayu')), ['朝食', '昼食']);
  assert.deepEqual(mealOccasionsFor(lookup('gifu-gohei')), ['昼食', '間食']);
  assert.ok(recipeOccasionIds(lookup('ehime-imotaki')).includes('harvest-moon'));
  assert.ok(recipeOccasionIds(lookup('niigata-noppe')).includes('new-year'));
  assert.ok(recipeOccasionIds(lookup('chiba-flower-sushi')).includes('hinamatsuri'));
});

test('家庭向けの分量でくるみ・小麦・刺身用の魚といった食材の区別を保つ', () => {
  const gohei = describeRecipe(lookup('gifu-gohei').id, catalogue);
  assert.ok(gohei.allergens.includes('walnut') && gohei.allergens.includes('sesame'));
  assert.deepEqual(gohei.portion, {amount: 2, unit: '本'});
  assert.ok(describeRecipe(lookup('saitama-tsumikko').id, catalogue).allergens.includes('wheat'));
  for (const [dishId, ingredientId] of [['mie-tekone', 'bonito_sashimi'], ['oita-ryukyu', 'yellowtail_sashimi']]) {
    assert.ok(lookup(dishId).ingredients.some(part => part.id === ingredientId));
    assert.match(lookup(dishId).steps.join(' '), /刺身用/);
  }
});
