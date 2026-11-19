import {RECIPE_TAG_LABELS} from './occasion-calendar.js';

const recipeTags = new Map();

/** 行事、季節、家庭向けの料理に共通する2人分の配合を台帳の形式にする。 */
export function occasionDish(tags, {
  id, name, role, family, genre = '和食', category, method, minutes, ingredients, steps,
  aliases = [], mealOccasions = ['昼食', '夕食'], staple = false, mealBase = false,
  portion = {amount: 1, unit: role === 'soup' ? '杯' : '皿'},
}) {
  const tagIds = Array.isArray(tags) ? tags : [tags];
  const labels = tagIds.map(tag => {
    if (!Object.hasOwn(RECIPE_TAG_LABELS, tag)) throw new Error('不明な料理の分類：' + tag);
    return RECIPE_TAG_LABELS[tag];
  });
  const recipeId = 'celebration-' + id;
  if (recipeTags.has(recipeId)) throw new Error('料理IDが重複しています：' + recipeId);
  recipeTags.set(recipeId, Object.freeze([...tagIds]));
  return {
    id: recipeId, name, role, family, genre, minutes, servings: 2, staple, mealBase,
    nature: 'home-cooked', portion, mealOccasions, tags: minutes <= 20 ? ['時短'] : [],
    searchAliases: [...new Set([...labels, ...aliases])],
    ...(category ? {displayCategory: category, displayMethod: method, displaySecondaryCategories: []} : {}),
    ingredients: ingredients.map(([id, amount]) => ({id, amount})), steps,
    ingredientsKnown: true, allergensKnown: true, shoppingKnown: true,
    sourceNote: '家庭で作る2人分の配合です。1人分の栄養は食材台帳の可食部・調味料と記載の分量から計算した概算です。',
  };
}

export function compiledRecipeTags(id) {
  return recipeTags.get(id);
}
