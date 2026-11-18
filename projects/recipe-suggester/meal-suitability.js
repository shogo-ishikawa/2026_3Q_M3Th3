import {recipeFamily, isCompleteMeal} from './catalog.js';
import {mealOccasionsFor} from './meal-occasions.js';

const BREAKFAST_PROTEINS = new Set(`
classic-boiled-egg classic-natto-plain classic-natto-grated-daikon
classic-side-hiyayakko classic-side-shirasu-tofu classic-side-okra-tofu classic-side-ume-tofu
acmp-egg-raw acmp-onsen-egg acmp-seasoned-nori acmp-tarako acmp-salmon-flakes
palette-wiener palette-ham breakfast-natto-okra
`.trim().split(/\s+/));
const RICE_FAMILIES = new Set(['rice', 'onigiri']);
const NOODLE_FAMILIES = new Set(['pasta', 'udon', 'soba', 'somen', 'yakisoba', 'ramen']);
const RICE_MEAL_FAMILIES = new Set(['rice', 'onigiri', 'donburi', 'fried-rice', 'curry', 'omelette-rice', 'sushi']);
const HANDHELD_FAMILIES = new Set(['bread', 'sweet-bread', 'burger']);

const LABELS = {breakfast: '朝食', lunch: '昼食', dinner: '夕食', snack: '間食'};

export function isBanshakuDish(recipe) {
  return ['main', 'side'].includes(recipe.role) && mealOccasionsFor(recipe).includes('晩酌');
}

export function breakfastRole(recipe) {
  if (!mealOccasionsFor(recipe).includes('朝食')) return null;
  const family = recipeFamily(recipe);
  if (BREAKFAST_PROTEINS.has(recipe.id)) return 'protein';
  if (recipe.role === 'side') return 'vegetable';
  if (family === 'fruit') return 'fruit';
  if (family === 'yoghurt') return 'yoghurt';
  return isCompleteMeal(recipe) ? 'complete' : recipe.role;
}

export function recipeMealSuitability(recipe) {
  const occasions = mealOccasionsFor(recipe);
  const meals = Object.keys(LABELS).filter(meal => occasions.includes(LABELS[meal]));
  const morning = breakfastRole(recipe);
  if (recipeFamily(recipe) === 'alcohol') return {meals, breakfastRole: null, category: 'record-only', reason: '飲んだ量を記録する酒類'};
  if (!meals.length && occasions.includes('晩酌')) return {meals, breakfastRole: null, category: 'banshaku-only', reason: '晩酌向けのおかずを希望した夕食で選ぶ'};
  return {meals, breakfastRole: morning, category: morning ?? (recipe.staple ? 'complete-or-staple' : recipe.role),
    reason: `食事の分類：${occasions.join('・')}`};
}

export function canSuggestAtMeal(recipe, meal, profile = {}) {
  const occasions = mealOccasionsFor(recipe);
  return occasions.includes(LABELS[meal]) || (meal === 'dinner' && profile.banshaku === true
    && ['main', 'side'].includes(recipe.role) && occasions.includes('晩酌'));
}

export function mealCandidateRecipes(recipes, meal, profile) {
  return recipes.filter(recipe => canSuggestAtMeal(recipe, meal, profile));
}

export function matchesStaplePreference(recipe, mode) {
  const family = recipeFamily(recipe);
  if (mode === 'rice') return RICE_FAMILIES.has(family) && !isCompleteMeal(recipe);
  if (mode === 'bread') return ['bread', 'sweet-bread'].includes(family);
  if (mode === 'rice-or-bread') return RICE_FAMILIES.has(family) && !isCompleteMeal(recipe) || ['bread', 'sweet-bread'].includes(family);
  if (mode === 'cereal') return family === 'oatmeal';
  if (mode === 'rice-meal') return RICE_MEAL_FAMILIES.has(family);
  if (mode === 'noodle') return NOODLE_FAMILIES.has(family);
  if (mode === 'handheld') return HANDHELD_FAMILIES.has(family);
  if (mode === 'none') return false;
  return true;
}

export function mealSuitabilityAudit(recipes) {
  return recipes.map(recipe => {
    const {meals, breakfastRole, category} = recipeMealSuitability(recipe);
    return {recipeId: recipe.id, name: recipe.name, family: recipeFamily(recipe),
      occasions: mealOccasionsFor(recipe), meals, breakfastRole, category};
  });
}
