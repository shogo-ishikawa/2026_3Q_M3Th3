import {recipeNature} from './catalog.js';
import {defaultServings, MAX_PLAN_SERVINGS} from './household-preferences.js';
import {eligibleRecipes} from './planner.js';
import {stockPurchaseId} from './strained-stock.js';

function stockByIngredient(pantry, data) {
  if (!Array.isArray(pantry)) throw Error('手持ち食材の一覧を確認してください。');
  const stock = new Map(), seen = new Set();
  for (const row of pantry) {
    if (!row || !Object.hasOwn(data.ingredients, row.id) || !Number.isFinite(row.amount) ||
        row.amount < 0 || seen.has(row.id)) {
      throw Error('手持ち食材の種類と量を確認してください。');
    }
    seen.add(row.id);
    const id = stockPurchaseId(row.id);
    if (row.amount > 0) stock.set(id, (stock.get(id) ?? 0) + row.amount);
  }
  return stock;
}

/** 購入単位の食材ごとに必要量を合算。候補ごとに同じ手持ちを独立して比較する。 */
function recipeOption(recipe, servings, stock, staples, data) {
  const amounts = new Map();
  for (const part of recipe.ingredients) {
    const id = stockPurchaseId(part.id);
    const amount = part.amount / recipe.servings * servings;
    amounts.set(id, (amounts.get(id) ?? 0) + amount);
  }
  const ingredients = [];
  for (const [id, required] of amounts) {
    const available = stock.get(id) ?? 0, alwaysOnHand = staples.has(id);
    const difference = required - available;
    // 0.1 + 0.2 と 0.3 のような表現誤差だけを無視する。分量自体は丸めない。
    const missing = alwaysOnHand || difference <= Number.EPSILON * required * 8 ? 0 : difference;
    const {name, unit} = data.ingredients[id];
    ingredients.push({id, name, unit, required, stock: available, alwaysOnHand, missing});
  }
  const missing = ingredients.filter(part => part.missing > 0);
  const ingredientCount = ingredients.length;
  // g・ml・個を加算せず、各食材の充足率を等しい重みで比較する。
  const coverage = ingredients.reduce((sum, part) => sum + (1 - part.missing / part.required), 0) / ingredientCount;
  return {recipe, ready: missing.length === 0, ingredientCount, coveredCount: ingredientCount - missing.length,
    coverage, ingredients, missing};
}

/** 家庭で作る料理のうち、不足食材が0種類または1種類のものを返す。 */
export function pantryRecipeOptions(data, settings = {}, pantry = [], servings = defaultServings(settings)) {
  if (!Number.isInteger(servings) || servings < 1 || servings > MAX_PLAN_SERVINGS) {
    throw Error('調理する人数は1〜8人の整数で指定してください。');
  }
  const omitted = settings.shoppingOmittedIds ?? [];
  if (!Array.isArray(omitted) || omitted.some(id => !Object.hasOwn(data.ingredients, id))) {
    throw Error('買い物で省く食材を確認してください。');
  }
  const staples = new Set(omitted.map(stockPurchaseId));
  const stock = stockByIngredient(pantry, data);

  const options = [];
  for (const recipe of eligibleRecipes(settings, data, {forPlan: true})) {
    const nature = recipeNature(recipe);
    if (!recipe.ingredientsKnown || recipe.restaurant || recipe.diningMatch || recipe.batchId ||
        (nature !== 'home-cooked' && nature !== 'unspecified')) continue;
    const option = recipeOption(recipe, servings, stock, staples, data);
    if (option.missing.length <= 1) options.push(option);
  }
  return options.sort((a, b) => a.missing.length - b.missing.length || b.coverage - a.coverage ||
    a.recipe.minutes - b.recipe.minutes || a.recipe.name.localeCompare(b.recipe.name, 'ja'));
}
