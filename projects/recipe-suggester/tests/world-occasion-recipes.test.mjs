import test from 'node:test';
import assert from 'node:assert/strict';
import {INGREDIENTS, RECIPES} from '../data.js';
import {recipeOccasionIds} from '../celebration-recipes.js';
import {recipePortion} from '../catalog.js';
import {mealOccasionsFor} from '../meal-occasions.js';
import {recipeNutrition} from '../nutrition.js';
import {WORLD_OCCASION_RECIPES} from '../world-occasion-recipes.js';

const compiled = id => RECIPES.find(recipe => recipe.id === `celebration-${id}`);

test('世界の料理は国名、食事区分、季節や行事を持ち、材料台帳から栄養を計算できる', () => {
  for (const original of WORLD_OCCASION_RECIPES) {
    const recipe = RECIPES.find(dish => dish.id === original.id);
    assert.ok(recipe, original.id);
    assert.ok(recipe.searchAliases.includes('世界の料理'), recipe.name);
    assert.ok(recipe.searchAliases.some(alias => alias !== '世界の料理' && alias.endsWith('料理')), recipe.name);
    assert.deepEqual(mealOccasionsFor(recipe), original.mealOccasions);
    assert.ok(recipeOccasionIds(recipe).length, recipe.name);
    assert.ok(recipeNutrition(recipe, {ingredients: INGREDIENTS}).kcal > 0, recipe.name);
    assert.ok(recipePortion(recipe, {ingredients: INGREDIENTS}).amount > 0, recipe.name);
  }
  assert.deepEqual(mealOccasionsFor(compiled('menemen')), ['朝食', '昼食']);
  assert.deepEqual(mealOccasionsFor(compiled('pear-belle-helene')), ['間食']);
});

test('生魚のタルタルと加熱する二枚貝をそれぞれ対応する食材・調理手順で案内する', () => {
  for (const id of ['salmon-tartare-avocado', 'salmon-tartare-apple']) {
    const recipe = compiled(id);
    assert.ok(recipe.ingredients.some(part => part.id === 'salmon_sashimi'));
    assert.match(recipe.steps.join(' '), /生食用サーモン/);
    assert.ok(recipeOccasionIds(recipe).includes('anniversary'));
  }
  for (const [id, shellfish] of [['midye-dolma', 'bistro_mussel_raw'], ['provencal-bouillabaisse', 'clam']]) {
    const recipe = compiled(id);
    assert.ok(recipe.ingredients.some(part => part.id === shellfish));
    assert.match(recipe.steps.join(' '), /85～90℃で90秒以上/);
  }
  assert.ok(compiled('midye-dolma').ingredients.some(part => part.id === 'rice'));
  assert.ok(compiled('risotto-funghi').ingredients.some(part => part.id === 'uncooked_rice'));
});
