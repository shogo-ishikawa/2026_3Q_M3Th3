// 既存の固定ハッシュは公開当時のDBを対象とする。v3.31以降に追加した料理を分離し、
// 確認済みの変更点だけを当時の表現へ戻して、それ以外のすべての項目を比較する。
import {QUICK_FOOD_RECIPES, QUICK_FOOD_INGREDIENTS} from '../../quick-foods.js';
import assert from 'node:assert/strict';
import {RECIPES, INGREDIENTS} from '../../data.js';
import {CELEBRATION_RECIPES, REGIONAL_AND_WORLD_RECIPES} from '../../celebration-recipes.js';
import {FRUIT_RECIPES, FRUIT_INGREDIENTS} from '../../fruit-varieties.js';
import {CONVENIENCE_RECIPES, CONVENIENCE_INGREDIENTS} from '../../convenience-staples.js';
import {KYOTO_RECIPES, KYOTO_INGREDIENTS} from '../../kyoto-foods.js';
import {STRAINED_STOCK_INGREDIENTS, STRAINED_STOCK_RECIPES} from '../../strained-stock.js';

export const recipesAddedSince330 = [...FRUIT_RECIPES, ...CONVENIENCE_RECIPES, ...KYOTO_RECIPES, ...CELEBRATION_RECIPES, ...REGIONAL_AND_WORLD_RECIPES, ...QUICK_FOOD_RECIPES];
const addedRecipeIds = new Set(recipesAddedSince330.map(recipe => recipe.id));
export const added331IngredientIds = new Set(Object.keys({
  ...FRUIT_INGREDIENTS, ...CONVENIENCE_INGREDIENTS, ...KYOTO_INGREDIENTS, ...STRAINED_STOCK_INGREDIENTS, ...QUICK_FOOD_INGREDIENTS,
}));

const oldSourceText = {
  'confectionery-cheeza': [
    ['https://www.glico.com/jp/product/snack_biscuit_cookie/cheeza/47110/', 'https://www.glico.com/jp/product/snack_biscuit/cheeza/24661'],
  ],
  'dessert-apple-pie': [
    ['ごろっと林檎のアップルパイ', 'アップルパイ'],
    ['確認日2026-11-18', '確認日2026-11-13'],
    ['https://www.cozycorner.co.jp/product/cutcake/57899.html', 'https://www.cozycorner.co.jp/product/cutcake/2238.html'],
  ],
};

function previousSource(id, text) {
  for (const [current, previous] of oldSourceText[id]) text = text.replace(current, previous);
  return text;
}

function previousRecipe(recipe) {
  let result = recipe;
  for (const [original, ids] of Object.entries(STRAINED_STOCK_RECIPES)) {
    if (!ids.includes(recipe.id)) continue;
    const ingredients = result.ingredients.map(part => part.id === `stock_${original}_strained`
      ? {...part, id: original} : part);
    result = {...result, ingredients};
  }
  if (oldSourceText[recipe.id]) {
    result = {...result, sourceNote: previousSource(recipe.id, recipe.sourceNote)};
  }
  if (recipe.id === 'dessert-apple-pie') {
    assert.equal(recipe.manualNutrition.kcal, 347);
    assert.equal(recipe.manualNutrition.carbs, 59.5);
    result = {...result, manualNutrition: {...recipe.manualNutrition, kcal:344, carbs:59.1}};
  }
  return result;
}

function previousIngredient([id, ingredient]) {
  const recipeId = id.replaceAll('_', '-');
  if (!Object.hasOwn(oldSourceText, recipeId)) return [id, ingredient];
  const result = {...ingredient};
  for (const field of ['note', 'nutritionSource', 'rawNutritionSource']) {
    result[field] = previousSource(recipeId, result[field]);
  }
  return [id, result];
}

export const pre331Recipes = RECIPES.filter(recipe => !addedRecipeIds.has(recipe.id)).map(previousRecipe);
export const pre331Ingredients = Object.fromEntries(
  Object.entries(INGREDIENTS).filter(([id]) => !added331IngredientIds.has(id)).map(previousIngredient),
);
