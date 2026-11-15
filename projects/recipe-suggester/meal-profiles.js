import {recipeFamily} from './catalog.js';
import {dishClassification} from './dish-hierarchy.js';
import {mealCandidateRecipes, breakfastRole} from './meal-suitability.js';

export const MEAL_PREFERENCE_IDS = Object.freeze(['breakfast', 'lunch', 'dinner']);
export const MEAL_VOLUME_IDS = Object.freeze(['light', 'normal', 'hearty']);
export const MEAL_MOOD_IDS = Object.freeze(['all', 'さっぱり', 'ガッツリ', '時短', '定番']);
export const MEAL_STAPLE_IDS = Object.freeze(['auto', 'rice', 'bread', 'rice-or-bread', 'cereal', 'none', 'rice-meal', 'noodle', 'handheld', 'fixed']);
export function defaultMealPreference() {return {volume: 'normal', mood: 'all', enabled: true, staple: 'auto', stapleId: 'auto', stapleAmount: null, drinkId: 'none', drinkAmount: null, yogurt: false, fruit: false, stapleVolume: 'auto', sideCount: 'auto', sideType: 'auto', soup: 'auto'};}
export const DEFAULT_MEAL_PREFERENCES = Object.freeze(Object.fromEntries(MEAL_PREFERENCE_IDS.map(meal => [meal, Object.freeze(defaultMealPreference())])));
const PROFILE_KEYS = Object.keys(defaultMealPreference());
const selectedId = value => typeof value === 'string' && value.trim() && value.length <= 120 && !['__proto__', 'constructor', 'prototype'].includes(value);
const amount = value => value === null || typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 100000;

export function normaliseMealPreferences(value, legacyMood = 'all', legacySettings = {}) {
  if (!MEAL_MOOD_IDS.includes(legacyMood)) throw Error('食事ごとの気分を確認してください。');
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 3 || Object.keys(value).some(key => !MEAL_PREFERENCE_IDS.includes(key)))) throw Error('朝・昼・夕の献立設定を確認してください。');
  return Object.fromEntries(MEAL_PREFERENCE_IDS.map(meal => {
    const item = value === undefined ? {volume: 'normal', mood: legacyMood} : value[meal];
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !PROFILE_KEYS.includes(key)) || !MEAL_VOLUME_IDS.includes(item.volume) || !MEAL_MOOD_IDS.includes(item.mood)) throw Error('食事ごとの量と気分を確認してください。');
    const old = !Object.hasOwn(item, 'staple');
    const priorStaple = legacySettings.stapleId ?? 'auto';
    const legacyStaple = legacySettings.stapleMode === 'adaptive' ? (priorStaple === 'none' ? 'none' : 'auto') : priorStaple;
    const defaults = defaultMealPreference();
    if (old) {
      defaults.staple = legacyStaple === 'none' ? 'none' : legacyStaple === 'auto' ? 'auto' : 'fixed';
      defaults.stapleId = legacyStaple;
      defaults.stapleAmount = defaults.staple === 'fixed' ? legacySettings.stapleAmount ?? null : null;
      if (meal === 'breakfast') {defaults.drinkId = legacySettings.drinkId ?? 'none'; defaults.drinkAmount = legacySettings.drinkAmount ?? null;}
    }
    const result = {...defaults, ...item};
    if (typeof result.enabled !== 'boolean' || typeof result.yogurt !== 'boolean' || typeof result.fruit !== 'boolean' || !MEAL_STAPLE_IDS.includes(result.staple) || !selectedId(result.stapleId) || !selectedId(result.drinkId) || !amount(result.stapleAmount) || !amount(result.drinkAmount)) throw Error('食事ごとの主食・飲み物・追加食品を確認してください。');
    if (!['auto', ...MEAL_VOLUME_IDS].includes(result.stapleVolume) || !(result.sideCount === 'auto' || Number.isInteger(result.sideCount) && result.sideCount >= 0 && result.sideCount <= 3) || !['auto', 'salad', 'vegetable', 'protein'].includes(result.sideType) || !['auto', 'none', 'include'].includes(result.soup)) throw Error('主食の量・副菜・汁物の設定を確認してください。');
    if (result.staple === 'fixed' && ['auto', 'none'].includes(result.stapleId)) throw Error('固定する主食を選んでください。');
    return [meal, result];
  }));
}

export function mealProfile(settings, meal = settings.meal) {
  if (meal === 'snack') return {...defaultMealPreference(), mood: settings.preferences?.mood ?? 'all', share: 0.1, scale: 1};
  const preferences = normaliseMealPreferences(settings.mealPreferences, settings.preferences?.mood ?? 'all', settings);
  const chosen = preferences[meal];if (!chosen) throw Error('朝食・昼食・夕食の設定を確認してください。');
  return {...chosen, share: {breakfast: 0.25, lunch: 0.35, dinner: 0.4}[meal], scale: {light: 0.5, normal: 1, hearty: 1.5}[chosen.volume]};
}

export function resolveMealSettings(settings, meal) {
  const profile = mealProfile(settings, meal);
  return {...settings, meal, profile, preferences: {...settings.preferences, mood: profile.mood},
    stapleId: profile.staple === 'fixed' ? profile.stapleId : profile.staple === 'none' ? 'none' : 'auto',
    stapleMode: profile.staple === 'fixed' ? 'fixed' : 'adaptive', stapleAmount: profile.staple === 'fixed' ? profile.stapleAmount : null,
    drinkId: profile.drinkId, drinkAmount: profile.drinkAmount};
}

export function mealAppropriateCandidates(candidates, meal) {return mealCandidateRecipes(candidates, meal);}
export function mealRecipeScore(recipe, meal) {
  if (meal === 'breakfast') return ['main', 'complete'].includes(breakfastRole(recipe)) ? 5 : 0;
  if (meal === 'lunch') return Math.max(0, 35 - recipe.minutes) / 5 + (recipe.staple ? 2 : 0);
  return 0;
}
export function mealQuantityMultiplier(recipe, settings) {
  if (settings.meal === 'snack' || ['drink', 'soup', 'snack'].includes(recipe.role)) return 1;
  return mealProfile(settings).scale;
}
export function mainIncludesBroth(recipe) {
  if (!recipe) return false;
  if (recipe.staple && ['udon', 'soba', 'ramen', 'somen'].includes(recipeFamily(recipe))) return true;
  return recipe.role === 'main' && recipe.custom !== true && ['hotpot', 'stew'].includes(dishClassification(recipe).method);
}
export function mealCourses(settings, main) {
  const profile = mealProfile(settings), meal = settings.meal;
  if (meal === 'snack') return {side: false, sideCount: 0, soup: false};
  let automatic;
  if (meal === 'breakfast') {
    if (profile.staple === 'cereal' || profile.yogurt || profile.fruit) automatic = {side: false, soup: false};
    else if (profile.volume === 'light') automatic = {side: true, soup: false};
    else automatic = profile.staple === 'bread' || main?.genre === '洋食' ? {side: true, soup: false} : {side: false, soup: true};
  } else if (mainIncludesBroth(main)) automatic = {side: true, soup: false};
  else automatic = {side: true, soup: profile.volume === 'hearty' || meal === 'dinner' && profile.volume !== 'light'};
  const count = profile.sideCount === 'auto' ? (automatic.side || profile.sideType !== 'auto' ? 1 : 0) : profile.sideCount;
  return {side: count > 0, sideCount: count, soup: profile.soup === 'include' || profile.soup === 'auto' && automatic.soup};
}
