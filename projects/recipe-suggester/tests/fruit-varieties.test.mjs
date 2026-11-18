import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogVariants, recipePortion} from '../catalog.js';
import {RECIPES, INGREDIENTS} from '../data.js';
import {FRUIT_RECIPES} from '../fruit-varieties.js';
import {pantryClassification} from '../pantry-catalog.js';
import {breakfastRole} from '../meal-suitability.js';
import {itemFromRecipe, recipeNutrition} from '../nutrition.js';

const data = {recipes: RECIPES, ingredients: INGREDIENTS};

test('生果を朝の果物枠と間食に使え、食べた可食部の重量で記録できる', () => {
  assert.equal(FRUIT_RECIPES.length, 22);
  for (const {id} of FRUIT_RECIPES) {
    const recipe = RECIPES.find(row => row.id === id);
    assert.ok(recipe, id);
    assert.equal(breakfastRole(recipe), 'fruit', id);
    assert.deepEqual(recipe.mealOccasions, ['朝食', '間食']);
    const part = recipe.ingredients[0];
    assert.equal(recipe.servings, 2);
    assert.equal(recipe.ingredients.length, 1);
    assert.deepEqual(recipePortion(recipe, data), {
      amount: part.amount / recipe.servings, unit: 'g', label: recipe.portion.label,
    });
    assert.match(recipe.portion.label, /可食部約\d+g/);
    const pantry = pantryClassification(part.id, data);
    assert.equal(pantry.group, 'fruit', part.id);
    assert.equal(pantry.subgroup, 'fresh', part.id);
    const ingredient = INGREDIENTS[part.id];
    assert.equal(ingredient.gramsPerUnit, 1);
    assert.match(ingredient.nutritionSource, /ITEM_NO=7_07\d{3}_7/);
    assert.deepEqual(ingredient.estimatedNutrients, []);
    assert.deepEqual(ingredient.rawNutritionPerUnit, ingredient.nutritionPerUnit);
    assert.ok(Object.values(recipeNutrition(recipe, data)).every(Number.isFinite), id);
  }
});

test('和梨・洋梨や緑・黄のキウイを区別し、品種名で検索できる', () => {
  const find = query => catalogVariants(RECIPES, 'fruit', {query}).map(row => row.id);
  assert.ok(find('ラフランス').includes('fruit-european-pear'));
  assert.ok(find('幸水').includes('fruit-japanese-pear'));
  assert.ok(find('カットパイン').includes('fruit-pineapple'));
  assert.ok(find('キウイ').includes('snack-kiwi'));
  assert.ok(find('キウイ').includes('fruit-gold-kiwi'));
  const recipe = id => RECIPES.find(row => row.id === id);
  const pear = recipeNutrition(recipe('fruit-japanese-pear'), data);
  for (const [key, value] of Object.entries({kcal:38, protein:0.3, fat:0.1, carbs:11.3, fiber:0.9, salt:0})) {
    assert.ok(Math.abs(pear[key] - value) < 1e-10, key);
  }
  assert.equal(recipeNutrition(recipe('fruit-european-pear'), data).kcal, 48);
  assert.equal(itemFromRecipe(recipe('fruit-gold-kiwi'), data).allergens.includes('kiwi'), true);
  assert.equal(itemFromRecipe(recipe('fruit-satsuma'), data).allergens.includes('orange'), false);
});
