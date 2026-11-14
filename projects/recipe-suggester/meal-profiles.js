import {recipeFamily} from './catalog.js';
import {dishClassification} from './dish-hierarchy.js';

// 食事の構成を変えるための目安です。個人に必要な摂取量の処方ではありません。
export const MEAL_PREFERENCE_IDS = Object.freeze(['breakfast', 'lunch', 'dinner']);
export const MEAL_VOLUME_IDS = Object.freeze(['light', 'normal', 'hearty']);
export const MEAL_MOOD_IDS = Object.freeze(['all', 'さっぱり', 'ガッツリ', '時短', '定番']);
export const DEFAULT_MEAL_PREFERENCES = Object.freeze(Object.fromEntries(
  MEAL_PREFERENCE_IDS.map(meal => [meal, Object.freeze({volume: 'normal', mood: 'all'})])));

export function normaliseMealPreferences(value, legacyMood = 'all') {
  if (!MEAL_MOOD_IDS.includes(legacyMood)) throw Error('食事ごとの気分を確認してください。');
  if (value === undefined) return Object.fromEntries(MEAL_PREFERENCE_IDS.map(meal => [meal, {volume: 'normal', mood: legacyMood}]));
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== 3 || Object.keys(value).some(key => !MEAL_PREFERENCE_IDS.includes(key))) {
    throw Error('朝・昼・夕の献立設定を確認してください。');
  }
  return Object.fromEntries(MEAL_PREFERENCE_IDS.map(meal => {
    const item = value[meal];
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).length !== 2 ||
        Object.keys(item).some(key => !['volume', 'mood'].includes(key)) ||
        !MEAL_VOLUME_IDS.includes(item.volume) || !MEAL_MOOD_IDS.includes(item.mood)) {
      throw Error('食事ごとの量と気分を確認してください。');
    }
    return [meal, {volume: item.volume, mood: item.mood}];
  }));
}

export function mealProfile(settings, meal = settings.meal) {
  if (meal === 'snack') return {volume: 'normal', mood: settings.preferences?.mood ?? 'all', share: 0.1, scale: 1};
  const preferences = normaliseMealPreferences(settings.mealPreferences, settings.preferences?.mood ?? 'all');
  const chosen = preferences[meal];
  if (!chosen) throw Error('朝食・昼食・夕食の設定を確認してください。');
  return {...chosen, share: {breakfast: 0.25, lunch: 0.35, dinner: 0.4}[meal],
    scale: {light: 0.75, normal: 1, hearty: 1.25}[chosen.volume]};
}

function breakfastRank(recipe) {
  const family = recipeFamily(recipe), name = recipe.name ?? '';
  // 朝食用として登録された料理と、短時間の卵・焼き魚を優先します。
  if (recipe.id.startsWith('breakfast-')) return 3;
  if (/唐揚|揚げ|カツ|フライ|天ぷら|麻婆|焼肉|ステーキ|鍋|すき焼|餃子|焼売|ハンバーグ/.test(name) ||
      ['karaage', 'cutlet', 'curry', 'ramen', 'pizza', 'fried-rice', 'donburi'].includes(family)) return 0;
  if ((family === 'egg-main' || family === 'grilled-fish') && recipe.minutes <= 25) return 2;
  if (recipe.minutes <= 20 && ['bread', 'oatmeal', 'bean-main'].includes(family)) return 2;
  return recipe.minutes <= 25 ? 1 : 0;
}

/** 安全条件で絞った後に使用し、朝食候補がないときだけ元の安全な候補へ戻します。 */
export function mealAppropriateCandidates(candidates, meal) {
  if (meal !== 'breakfast') return candidates;
  const breakfast = candidates.filter(recipe => breakfastRank(recipe) >= 2);
  if (breakfast.length) return breakfast;
  const simple = candidates.filter(recipe => breakfastRank(recipe) >= 1);
  return simple.length ? simple : candidates;
}

export function mealRecipeScore(recipe, meal) {
  if (meal === 'breakfast') return breakfastRank(recipe) * 4 + Math.max(0, 25 - recipe.minutes) / 5;
  if (meal === 'lunch') return Math.max(0, 35 - recipe.minutes) / 5 + (recipe.staple ? 2 : 0) - (recipe.id.startsWith('breakfast-') ? 4 : 0);
  return 0;
}

export function mealQuantityMultiplier(recipe, settings) {
  if (settings.meal === 'snack' || recipe.role === 'drink') return 1;
  const profile = mealProfile(settings), base = settings.meal === 'breakfast' && recipe.role === 'main' ? 0.8 :
    settings.meal === 'breakfast' && recipe.role === 'side' ? 0.75 : 1;
  // 汁の量を「がっつり」と一緒に増やさず、主食・主菜・副菜で量を調整します。
  return recipe.role === 'soup' ? 1 : base * profile.scale;
}

/** 麺の汁、鍋、シチュー自体を汁物の役割として扱います。名称の部分一致では判定しません。 */
export function mainIncludesBroth(recipe) {
  if (!recipe) return false;
  if (recipe.staple && ['udon', 'soba', 'ramen', 'somen'].includes(recipeFamily(recipe))) return true;
  return recipe.role === 'main' && recipe.custom !== true && ['hotpot', 'stew'].includes(dishClassification(recipe).method);
}

export function mealCourses(settings, main) {
  const profile = mealProfile(settings), meal = settings.meal;
  if (meal === 'snack') return {side: false, soup: false};
  if (mainIncludesBroth(main)) return {side: true, soup: false};
  if (profile.volume === 'hearty') return {side: true, soup: true};
  if (profile.volume === 'light') return {side: true, soup: false};
  if (meal === 'breakfast') return main?.genre === '洋食' ? {side: true, soup: false} : {side: false, soup: true};
  return {side: true, soup: meal === 'dinner'};
}
