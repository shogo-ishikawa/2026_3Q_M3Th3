import {COOKING_METHODS, FOOD_CATEGORIES, dishClassification} from './dish-hierarchy.js';
import {GENRES, localDate} from './storage.js';

const meals = ['breakfast', 'lunch', 'dinner', 'snack'];
const methodLabels = new Map(COOKING_METHODS.map(({id, label}) => [id, label]));
const categoryLabels = new Map(FOOD_CATEGORIES.map(({id, label}) => [id, label]));
const dayInMilliseconds = 86400000;
const historyDays = 90;

function utcDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const timestamp = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp / dayInMilliseconds : NaN;
}

// 外食で参照した「似た料理」や材料を置き換えた料理は元レシピの実食にしない。
export function eatenRecipeId(item) {
  if (typeof item?.recipeId !== 'string' || !item.recipeId ||
      (item.quantity !== undefined && !(Number.isFinite(item.quantity) && item.quantity > 0)) ||
      item.diningMatch?.mode === 'similar' || item.ingredientEdit?.baseChanged) return null;
  return item.recipeId;
}

// 同じ日・食事枠を分けて記録した場合も、各料理を食べたのは1食として扱う。
export function pastEatenRecipeMeals(entries, {date = localDate(), meal, days = Infinity}) {
  const targetDay = utcDay(date), targetMeal = meals.indexOf(meal), slots = new Map();
  if (!Number.isFinite(targetDay) || targetMeal < 0 || !Array.isArray(entries)) return slots.values();
  for (const entry of entries) {
    if (entry?.status !== 'eaten') continue;
    const day = utcDay(entry.date), order = meals.indexOf(entry.meal);
    if (!Number.isFinite(day) || order < 0 || day < targetDay - days || day > targetDay ||
        (day === targetDay && order >= targetMeal)) continue;
    let ids = [];
    if (Array.isArray(entry.items)) {
      ids = entry.items.map(eatenRecipeId);
    } else if (Array.isArray(entry.recipeIds)) {
      ids = entry.recipeIds;
    }
    const slot = day + '/' + order;
    for (const id of ids) {
      if (typeof id !== 'string' || !id || id.startsWith('custom-')) continue;
      if (!slots.has(slot)) slots.set(slot, new Set());
      slots.get(slot).add(id);
    }
  }
  return slots.values();
}

// 主材料と調理法は、メニュー一覧で確認できる既存の分類だけを使う。
// 重みの単位は0.1点で、調理法・主材料・ジャンルの合計は最大3点。
function features(recipe) {
  if (!recipe || recipe.custom || (recipe.nature ?? 'home-cooked') !== 'home-cooked' ||
      !(['main', 'side', 'soup'].includes(recipe.role) || recipe.mealBase === true)) return [];
  let classification;
  try {
    classification = dishClassification(recipe);
  } catch {
    return [];
  }
  const {method, category} = classification;
  const result = [];
  if (method !== 'other' && method !== 'reheat') {
    result.push({key:'method:' + method, label:methodLabels.get(method), weight:12});
  }
  if (category !== 'other' && category !== 'product-dependent') {
    result.push({key:'category:' + category, label:categoryLabels.get(category) + 'が主材料の料理', weight:10});
  }
  if (recipe.genre !== 'その他' && GENRES.includes(recipe.genre)) {
    result.push({key:'genre:' + recipe.genre, label:recipe.genre, weight:8});
  }
  return result;
}

// IDの取り違えを避けるため、重複したIDから分類を引かない。
export function uniqueRecipesById(recipes) {
  const byId = new Map();
  for (const recipe of recipes) {
    if (recipe?.id) byId.set(recipe.id, byId.has(recipe.id) ? null : recipe);
  }
  return byId;
}

export function buildTasteHistory(entries, data, {date, meal}) {
  const history = {counts:new Map(), mealCount:0, byId:new Map()};
  const slots = [...pastEatenRecipeMeals(entries, {date, meal, days:historyDays})];
  if (!slots.length) return history;
  history.byId = uniqueRecipesById(data.recipes);
  for (const ids of slots) {
    const seen = new Set();
    for (const id of ids) {
      for (const feature of features(history.byId.get(id))) seen.add(feature.key);
    }
    if (!seen.size) continue;
    history.mealCount++;
    for (const key of seen) history.counts.set(key, (history.counts.get(key) ?? 0) + 1);
  }
  return history;
}

// 各食の割合を使い、同じ部分量を何品に分けても点数を増やさない。最大3点。
export function tasteHistoryScore(recipe, history, reasons) {
  if (!history || history.mealCount < 2 || recipe?.custom) return 0;
  let score = 0, strongest = null;
  for (const {key, label, weight} of features(history.byId.get(recipe?.id))) {
    const count = history.counts.get(key) ?? 0;
    if (count < 2) continue;
    const points = weight * count;
    score += points;
    if (!strongest || points > strongest.points) strongest = {points, label, count};
  }
  if (strongest && reasons) reasons.push(`直近${historyDays}日の食事記録で「${strongest.label}」が${strongest.count}食ありました。`);
  return score / (10 * history.mealCount);
}
