import {recipeNutrition, recipeConfirmation} from './nutrition.js';
import {quantityFromAmount, isCompleteMeal, recipeFamily} from './catalog.js';
import {normaliseMealPreferences, mealProfile, mealAppropriateCandidates, mealRecipeScore, mealQuantityMultiplier, mealCourses, mainIncludesBroth, resolveMealSettings} from './meal-profiles.js';
import {breakfastRole, matchesStaplePreference, isBanshakuDish, canSuggestAtMeal} from './meal-suitability.js';
import {plannedQuantity} from './portion-guide.js';
import {dishClassification} from './dish-hierarchy.js';

// 材料の確認 → 食べられる候補 → 履歴との比較、の順に処理します。
// 食品群の回数は献立の組合せを考える目安です。栄養量の計算ではありません。
export const FOOD_GROUPS = ['staple', 'vegetable', 'protein', 'dairy', 'fruit'];
export const PROTEIN_SOURCES = ['meat', 'fish', 'egg', 'soy'];
export const GENRES = ['和食', '洋食', '中華', 'エスニック', 'その他'];
export const MOODS = ['all', 'さっぱり', 'ガッツリ', '時短', '定番'];
const DEFAULT_RATIOS = {和食: 40, 洋食: 30, 中華: 20, エスニック: 10, その他: 0};
const ROLES = ['main', 'side', 'soup', 'staple', 'drink', 'snack'];
const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
const SOURCE_LABELS = {meat: '肉', fish: '魚', egg: '卵', soy: '大豆'};
const ROLE_LABELS = {main: '主菜', side: '副菜', soup: '汁物', staple: '主食', drink: '飲み物', snack: '間食'};
const NUTRIENTS = ['kcal', 'protein', 'fat', 'carbs', 'fiber', 'salt'];

const unique = values => [...new Set(values)];
const emptyCounts = keys => Object.fromEntries(keys.map(key => [key, 0]));
const finitePositive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;

function localToday() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function nextDate(value, offset) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function stringList(value, label) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`${label}は文字列のリストで指定してください。`);
  }
  return unique(value.map(item => item.trim()).filter(Boolean));
}

function checkData(data) {
  if (!data || !Array.isArray(data.recipes) || !data.ingredients || !Array.isArray(data.allergens)) {
    throw new Error('レシピ・材料・アレルゲンのデータが必要です。');
  }
  return new Set(data.allergens.map(item => item.id));
}

function ingredientIds(values, data, label) {
  return stringList(values, label).map(value => {
    if (Object.hasOwn(data.ingredients, value)) return value;
    const matches = Object.entries(data.ingredients).filter(([, item]) => item.name === value);
    if (matches.length === 1) return matches[0][0];
    throw new Error(`${label}の「${value}」が材料一覧にありません。一覧から選んでください。`);
  });
}

function constraints(settings, data) {
  const knownAllergens = checkData(data);
  const allergens = stringList(settings?.allergens ?? [], 'アレルゲン');
  for (const id of allergens) {
    if (!knownAllergens.has(id)) throw new Error(`登録されていないアレルゲン「${id}」です。選択内容を確認してください。`);
  }
  return {
    allergens,
    excludedIngredients: unique(ingredientIds(settings?.excludedIngredients ?? [], data, '除外食材')),
  };
}

function checkedIngredient(id, data, knownAllergens) {
  if (typeof id !== 'string' || !Object.hasOwn(data.ingredients, id)) {
    throw new Error('材料・アレルゲンの確認情報が不足しています。');
  }
  const ingredient = data.ingredients[id];
  if (!ingredient || typeof ingredient.name !== 'string' || !ingredient.name ||
      typeof ingredient.unit !== 'string' || !ingredient.unit ||
      !Array.isArray(ingredient.allergens) || !Array.isArray(ingredient.groups) ||
      ingredient.allergens.some(allergen => !knownAllergens.has(allergen)) ||
      ingredient.groups.some(group => !FOOD_GROUPS.includes(group)) ||
      (ingredient.proteinSources !== undefined && !Array.isArray(ingredient.proteinSources)) ||
      (ingredient.proteinSources ?? []).some(source => !PROTEIN_SOURCES.includes(source))) {
    throw new Error('材料・アレルゲン・食品群の確認情報が不足しています。');
  }
  return ingredient;
}

function ingredientAncestors(id, data, knownAllergens, trail = []) {
  if (typeof id !== 'string' || !Object.hasOwn(data.ingredients, id)) {
    throw new Error('材料の派生元に不明な参照があります。');
  }
  if (trail.includes(id)) throw new Error('材料の派生元が循環しています。');
  const ingredient = checkedIngredient(id, data, knownAllergens);
  const parents = Object.hasOwn(ingredient, 'derivedFrom') ? ingredient.derivedFrom : [];
  if (!Array.isArray(parents) || parents.some(parent => typeof parent !== 'string' || !parent)) {
    throw new Error('材料の派生元の確認情報が不足しています。');
  }
  return unique(parents.flatMap(parent => [parent, ...ingredientAncestors(parent, data, knownAllergens, [...trail, id])]));
}

function describeRawRecipe(recipe, data, knownAllergens) {
  const custom = recipe?.custom === true;
  // 完成品や即席品は、架空の調理手順を足さずに記録できます。
  // 家庭料理の手順不足と、商品の原材料・アレルギー確認は別に検査します。
  const noCookingRequired = ['ready-to-eat', 'instant', 'retort', 'fast-food'].includes(recipe?.nature);
  const confirmed = recipeConfirmation(recipe);
  if (!recipe || typeof recipe.id !== 'string' || !recipe.id || typeof recipe.name !== 'string' || !recipe.name.trim() ||
      !ROLES.includes(recipe.role) || !finitePositive(recipe.servings) || !finitePositive(recipe.minutes) ||
      !Array.isArray(recipe.steps) || (!custom && !noCookingRequired && !recipe.steps.length) || recipe.steps.some(step => typeof step !== 'string' || !step.trim()) ||
      !Array.isArray(recipe.ingredients) || (!custom && !recipe.ingredients.length) || typeof recipe.staple !== 'boolean') {
    throw new Error('料理の基本情報が不足しています。');
  }
  recipeFamily(recipe);
  if (custom && (!Array.isArray(recipe.allergens ?? []) || (recipe.allergens ?? []).some(id => !knownAllergens.has(id)) ||
      !Array.isArray(recipe.groups ?? []) || (recipe.groups ?? []).some(group => !FOOD_GROUPS.includes(group)) ||
      !Array.isArray(recipe.proteinSources ?? []) || (recipe.proteinSources ?? []).some(source => !PROTEIN_SOURCES.includes(source)))) {
    throw new Error('手入力した料理の確認情報を確認してください。');
  }
  if (recipe.manualNutrition !== undefined &&
      (!recipe.manualNutrition || typeof recipe.manualNutrition !== 'object' || Array.isArray(recipe.manualNutrition) ||
       NUTRIENTS.some(key => recipe.manualNutrition[key] != null &&
         (typeof recipe.manualNutrition[key] !== 'number' || !Number.isFinite(recipe.manualNutrition[key]) || recipe.manualNutrition[key] < 0)))) {
    throw new Error('栄養量は0以上の数値か未登録で指定してください。');
  }
  const ingredients = recipe.ingredients.map(part => {
    const ingredient = checkedIngredient(part.id, data, knownAllergens);
    if (!finitePositive(part.amount)) throw new Error('材料の分量が不明です。');
    const ancestorIds = ingredientAncestors(part.id, data, knownAllergens);
    // 子の記載が漏れていても、登録された原料のアレルゲンを引き継ぎます。
    const allergens = unique([ingredient, ...ancestorIds.map(id => checkedIngredient(id, data, knownAllergens))]
      .flatMap(item => item.allergens));
    return {...ingredient, id: part.id, amount: part.amount, allergens,
      proteinSources: ingredient.proteinSources ?? [], ancestorIds};
  });
  return {...recipe, ingredients,
    steps: recipe.steps.length || noCookingRequired ? [...recipe.steps] : ['調理方法は未登録です。'],
    allergensKnown: confirmed.allergensKnown,
    ingredientsKnown: confirmed.ingredientsKnown,
    allergens: unique([...ingredients.flatMap(item => item.allergens), ...(custom ? recipe.allergens ?? [] : [])]),
    groups: unique([...ingredients.flatMap(item => item.groups), ...(custom ? recipe.groups ?? [] : [])]),
    proteinSources: unique([...ingredients.flatMap(item => item.proteinSources), ...(custom ? recipe.proteinSources ?? [] : [])]),
  };
}

function catalogue(data) {
  const knownAllergens = checkData(data);
  const counts = new Map();
  for (const recipe of data.recipes) counts.set(recipe.id, (counts.get(recipe.id) ?? 0) + 1);
  const recipes = [];
  const invalidIds = [];
  for (const recipe of data.recipes) {
    try {
      if (counts.get(recipe.id) !== 1) throw new Error('料理IDの重複');
      recipes.push(describeRawRecipe(recipe, data, knownAllergens));
    } catch {
      invalidIds.push(String(recipe?.id ?? '不明'));
    }
  }
  return {recipes, invalidIds};
}

export function describeRecipe(id, data) {
  const matches = data?.recipes?.filter(recipe => recipe.id === id) ?? [];
  if (matches.length !== 1) throw new Error('料理が見つからないか、料理IDが重複しています。');
  return describeRawRecipe(matches[0], data, checkData(data));
}

function allowed(recipe, selected) {
  // ここで除外した料理を、候補不足や「気分」のために戻す処理は置きません。
  return recipeFamily(recipe) !== 'alcohol' && recipe.allergensKnown !== false &&
    !(recipe.ingredientsKnown === false && selected.excludedIngredients.length) &&
    !recipe.allergens.some(id => selected.allergens.includes(id)) &&
    !recipe.ingredients.some(item => [item.id, ...item.ancestorIds].some(id => selected.excludedIngredients.includes(id)));
}

export function eligibleRecipes(settings, data, {role = null} = {}) {
  const selected = constraints(settings, data);
  if (role !== null && !ROLES.includes(role)) throw new Error('料理の種類を確認してください。');
  return catalogue(data).recipes.filter(recipe => (!role || recipe.role === role) && allowed(recipe, selected));
}

function normaliseSettings(settings, data, {allowSnack = false} = {}) {
  const selected = constraints(settings, data);
  const startDate = settings.startDate ?? localToday();
  const days = settings.days ?? 3;
  const servings = settings.servings ?? 2;
  const meal = settings.meal ?? 'dinner';
  if (!validDate(startDate)) throw new Error('開始日は有効な年月日で指定してください。');
  if (!Number.isInteger(days) || days < 1 || days > 7) throw new Error('日数は1〜7日の整数で指定してください。');
  if (!Number.isInteger(servings) || servings < 1 || servings > 8) throw new Error('人数は1〜8人の整数で指定してください。');
  if (!(allowSnack ? [...MEALS, 'all'] : MEALS.slice(0, 3)).includes(meal)) throw new Error(allowSnack ? '朝食・昼食・夕食・3食すべて・間食から選んでください。' : '朝食・昼食・夕食から選んでください。');
  if (!Array.isArray(settings.history ?? [])) throw new Error('食事履歴を確認してください。');
  const preferences = settings.preferences ?? {};
  if (typeof preferences !== 'object' || preferences === null || Array.isArray(preferences)) throw new Error('好みの設定を確認してください。');
  const genre = preferences.genre ?? 'all';
  if (typeof genre !== 'string') throw new Error('料理ジャンルを確認してください。');
  let genreMode = preferences.genreMode ?? (['all', 'any', 'おまかせ', '指定なし', ''].includes(genre) ? 'any' : 'single');
  if (!['any', 'single', 'ratio'].includes(genreMode)) throw new Error('ジャンルの選び方を確認してください。');
  if (genreMode === 'single' && !GENRES.includes(genre)) throw new Error('優先するジャンルを一覧から選んでください。');
  const mood = preferences.mood === '指定なし' ? 'all' : (preferences.mood ?? 'all');
  if (!MOODS.includes(mood)) throw new Error('気分を一覧から選んでください。');
  const genreRatios = normaliseRatios(preferences.genreRatios ?? DEFAULT_RATIOS);
  if (preferences.maxMinutes != null && (!finitePositive(preferences.maxMinutes) || preferences.maxMinutes > 240)) {
    throw new Error('所要時間の目安は1〜240分の範囲にしてください。');
  }
  const preferredIngredients = ingredientIds(preferences.preferredIngredients ?? [], data, '優先食材');
  const seed = settings.seed ?? 1;
  if (!['number', 'string'].includes(typeof seed) || (typeof seed === 'number' && !Number.isFinite(seed))) throw new Error('乱数の設定を確認してください。');
  return {...selected, startDate, days, servings, meal, seed,
    mealPreferences: normaliseMealPreferences(settings.mealPreferences, mood, settings),
    preferences: {genreMode, genre, mood, genreRatios, maxMinutes: preferences.maxMinutes ?? null, preferredIngredients},
  };
}

function normaliseRatios(ratios) {
  if (!ratios || typeof ratios !== 'object' || Array.isArray(ratios) || Object.keys(ratios).some(genre => !GENRES.includes(genre))) {
    throw new Error('ジャンルの比率を確認してください。');
  }
  const result = Object.fromEntries(GENRES.map(genre => [genre, ratios[genre] ?? 0]));
  if (Object.values(result).some(value => !Number.isInteger(value) || value < 0 || value > 100) ||
      Object.values(result).reduce((sum, value) => sum + value, 0) !== 100) {
    throw new Error('ジャンルの比率は0〜100の整数で、合計100%にしてください。');
  }
  return result;
}

export function allocateGenreCounts(days, genreRatios) {
  if (!Number.isInteger(days) || days < 1 || days > 7) throw new Error('日数は1〜7日の整数で指定してください。');
  return allocateMealGenres(days, genreRatios);
}

function allocateMealGenres(days, genreRatios) {
  const ratios = normaliseRatios(genreRatios);
  const targets = Object.fromEntries(GENRES.map(genre => [genre, Math.floor(days * ratios[genre] / 100)]));
  let remaining = days - Object.values(targets).reduce((sum, count) => sum + count, 0);
  // 小数部分が大きいジャンルから1食ずつ配分。同じときはGENRESの順です。
  const order = [...GENRES].sort((a, b) => (days * ratios[b] % 100) - (days * ratios[a] % 100));
  for (const genre of order) {
    if (!remaining) break;
    targets[genre]++;
    remaining--;
  }
  return targets;
}

function genreSchedule(settings, count = settings.meal === 'all' ? settings.days * 3 : settings.days) {
  settings = {...settings, days: count};
  const preferences = settings.preferences;
  if (preferences.genreMode === 'any') return Array(settings.days).fill(null);
  if (preferences.genreMode === 'single') return Array(settings.days).fill(preferences.genre);
  const targets = allocateMealGenres(settings.days, preferences.genreRatios);
  const used = emptyCounts(GENRES);
  const sequence = [];
  for (let index = 0; index < settings.days; index++) {
    const candidates = GENRES.filter(genre => used[genre] < targets[genre]);
    candidates.sort((a, b) => {
      const deficitA = targets[a] * (index + 1) / settings.days - used[a];
      const deficitB = targets[b] * (index + 1) / settings.days - used[b];
      return deficitB - deficitA || tieBreak(settings.seed, `${index}:${b}`) - tieBreak(settings.seed, `${index}:${a}`);
    });
    sequence.push(candidates[0]);
    used[candidates[0]]++;
  }
  return sequence;
}

export function activeRecipeIds(day) {
  if (!day || !Array.isArray(day.recipeIds) || day.recipeIds.some(id => typeof id !== 'string')) {
    throw new Error('献立の料理一覧を確認してください。');
  }
  const omitted = day.omittedRecipeIds ?? [];
  if (!Array.isArray(omitted) || omitted.some(id => typeof id !== 'string' || !day.recipeIds.includes(id))) {
    throw new Error('今回は作らない料理の設定を確認してください。');
  }
  return day.recipeIds.filter(id => !omitted.includes(id));
}

function summariseGenres(settings, days, data) {
  const actual = emptyCounts(GENRES);
  let omittedMainCount = 0;
  for (const day of days) {
    const active = new Set(activeRecipeIds(day));
    for (const id of day.recipeIds) {
      const recipe = describeRecipe(id, data);
      if (recipe.role !== 'main' && recipe.id !== day.mainId && !(day.meal && recipe.id === (day.stapleId ?? settings.stapleId) && isCompleteMeal(recipe))) continue;
      if (!active.has(id)) omittedMainCount++;
      else if (GENRES.includes(recipe.genre)) actual[recipe.genre]++;
    }
  }
  const mode = settings.preferences.genreMode;
  const count = days.length;
  const targets = mode === 'ratio' ? allocateMealGenres(count, settings.preferences.genreRatios) : emptyCounts(GENRES);
  if (mode === 'single') targets[settings.preferences.genre] = count;
  return {mode, ratios: {...settings.preferences.genreRatios}, targets, actual, omittedMainCount,
    activeMainCount: Object.values(actual).reduce((sum, count) => sum + count, 0),
    note: mode === 'ratio' ? '比率は主菜の希望配分です。候補がない場合は0%のジャンルも含め、食材の除外条件に合う料理を選びます。今回は作らない主菜は実績の件数に含めません。' : '件数は今回は作る主菜だけを数えています。',
  };
}

export function analyseHistory(history, {beforeDate = localToday(), days = 7, beforeMeal = 'dinner'} = {}, data) {
  if (!Array.isArray(history) || !validDate(beforeDate) || !Number.isInteger(days) || days < 1 || days > 365 || !MEALS.includes(beforeMeal)) {
    throw new Error('履歴を調べる日付と期間を確認してください。');
  }
  const {recipes} = catalogue(data);
  const byId = new Map(recipes.map(recipe => [recipe.id, recipe]));
  const from = nextDate(beforeDate, -days);
  const meals = new Map();
  let entryCount = 0;
  let ignoredCount = 0;
  for (const entry of history) {
    if (!entry || !validDate(entry.date) || !MEALS.includes(entry.meal) ||
        !Array.isArray(entry.recipeIds ?? []) || !Array.isArray(entry.groups ?? []) || !Array.isArray(entry.proteinSources ?? [])) {
      ignoredCount++;
      continue;
    }
    // 未来の記録と、同日のこれから食べる食事は提案に使いません。
    if (entry.date < from || entry.date > beforeDate ||
        (entry.date === beforeDate && MEALS.indexOf(entry.meal) >= MEALS.indexOf(beforeMeal))) continue;
    const key = `${entry.date}:${entry.meal}`;
    if (!meals.has(key)) meals.set(key, {groups: new Set(), sources: new Set(), recipes: new Set()});
    const target = meals.get(key);
    for (const id of entry.recipeIds ?? []) {
      const recipe = byId.get(id);
      if (!recipe) continue;
      target.recipes.add(id);
      recipe.groups.forEach(group => target.groups.add(group));
      recipe.proteinSources.forEach(source => target.sources.add(source));
    }
    (entry.groups ?? []).filter(group => FOOD_GROUPS.includes(group)).forEach(group => target.groups.add(group));
    (entry.proteinSources ?? []).filter(source => PROTEIN_SOURCES.includes(source)).forEach(source => target.sources.add(source));
    // 自由記述のnoteを材料や栄養の情報に変換しません。
    entryCount++;
  }
  const groups = emptyCounts(FOOD_GROUPS);
  const proteinSources = emptyCounts(PROTEIN_SOURCES);
  const recipeCounts = Object.create(null);
  let taggedMealCount = 0;
  for (const meal of meals.values()) {
    meal.groups.forEach(group => groups[group]++);
    meal.sources.forEach(source => proteinSources[source]++);
    meal.recipes.forEach(id => { recipeCounts[id] = (recipeCounts[id] ?? 0) + 1; });
    if (meal.groups.size || meal.sources.size || meal.recipes.size) taggedMealCount++;
  }
  return {entryCount, mealCount: meals.size, taggedMealCount,
    hasHistory: meals.size > 0, hasTaggedData: taggedMealCount > 0,
    groups, proteinSources, recipeCounts, recentRecipeIds: Object.keys(recipeCounts), ignoredCount,
    window: {from, untilDate: beforeDate, beforeMeal},
  };
}

function tieBreak(seed, value) {
  let hash = 2166136261;
  for (const char of `${seed}:${value}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

function pick(candidates, settings, history, context, date, role) {
  if (!candidates.length) return null;
  let preferred = candidates;
  if (role === 'main' && context.targetGenre) {
    const matching = preferred.filter(recipe => recipe.genre === context.targetGenre);
    if (matching.length) preferred = matching;
  }
  if (settings.preferences.mood !== 'all') {
    const matching = preferred.filter(recipe => (recipe.tags ?? []).includes(settings.preferences.mood));
    if (matching.length) preferred = matching;
  }
  const profile = settings.mealPreferences?.[settings.meal];
  if (settings.meal === 'dinner' && profile?.banshaku && ['main', 'side'].includes(role)) {
    const evening = preferred.filter(isBanshakuDish);
    if (evening.length) preferred = evening;
  }
  const fresh = preferred.filter(recipe => !history.recipeCounts[recipe.id] && !context.used.has(recipe.id));
  const pool = fresh.length ? fresh : preferred;
  const score = recipe => {
    let value = tieBreak(settings.seed, `${date}:${role}:${recipe.id}`);
    value -= (history.recipeCounts[recipe.id] ?? 0) * 25;
    value -= context.used.has(recipe.id) ? 60 : 0;
    if (settings.preferences.maxMinutes && recipe.minutes <= settings.preferences.maxMinutes) value += 5;
    value += recipe.ingredients.filter(item => [item.id, ...item.ancestorIds]
      .some(id => settings.preferences.preferredIngredients.includes(id))).length * 4;
    if (!context.groups.has('vegetable') && recipe.groups.includes('vegetable')) value += 10;
    if (!context.groups.has('protein') && recipe.groups.includes('protein')) value += 8;
    if (history.hasTaggedData) {
      for (const group of recipe.groups) {
        // 含むと記録された食事の割合だけを使います。量や栄養不足には換算しません。
        // 主食は主菜または別添えのご飯で用意するため、単品の加点には使いません。
        if (group !== 'staple' && !context.groups.has(group)) {
          value += 6 * Math.max(0, history.taggedMealCount - history.groups[group]) / history.taggedMealCount;
        }
      }
    }
    if (role === 'main') {
      for (const source of recipe.proteinSources) {
        value -= history.proteinSources[source] * 3;
        if (context.lastSources.includes(source)) value -= 8;
      }
    }
    if (typeof context.scoreRecipe === 'function') value += context.scoreRecipe(recipe);
    return value;
  };
  if (pool.length === 1) return pool[0];
  let best = pool[0], bestScore = score(best);
  for (let index = 1; index < pool.length; index++) {
    const candidate = pool[index], value = score(candidate);
    if (value > bestScore || (value === bestScore && candidate.id.localeCompare(best.id) < 0)) {
      best = candidate;
      bestScore = value;
    }
  }
  return best;
}

function incomplete(settings, roles, warnings = []) {
  const missingRoles = unique(roles);
  const messages = [...warnings];
  if (missingRoles.length) messages.push(`除外条件を保ったまま${missingRoles.map(role => ROLE_LABELS[role]).join('・')}を用意できませんでした。条件外の料理で埋めていません。`);
  return {ok: false, days: [], settings, missingRoles, warnings: messages};
}

function preferenceWarnings(settings, data) {
  const warnings = [];
  const knownAllergens = checkData(data);
  for (const id of settings.preferences.preferredIngredients) {
    try {
      const family = [id, ...ingredientAncestors(id, data, knownAllergens)];
      const allergens = unique(family.flatMap(item => checkedIngredient(item, data, knownAllergens).allergens));
      if (family.some(item => settings.excludedIngredients.includes(item)) || allergens.some(item => settings.allergens.includes(item))) {
        warnings.push(`優先食材「${data.ingredients[id].name}」は除外条件と重なるため、除外を優先しました。`);
      }
    } catch {
      warnings.push(`優先食材「${data.ingredients[id]?.name ?? id}」は確認情報が不足するため優先できません。`);
    }
  }
  return warnings;
}

function dayNotes(selected, history, settings, {recordedHistory = history.hasTaggedData, earlierPlans = false, targetGenre = null, main = selected.find(recipe => recipe.role === 'main')} = {}) {
  const reasons = [];
  const warnings = [];
  const groups = unique(selected.flatMap(recipe => recipe.groups));
  const basis = recordedHistory ? (earlierPlans ? '食事の記録と先に提案した献立' : '直近7日の食事記録') : '先に提案した献立';
  if (!recordedHistory && !earlierPlans) {
    reasons.push('比較できる料理・食品群の履歴がないため、今回の献立内の組合せと重複を目安に選びました。');
  } else if (selected.filter(recipe => recipe.role !== 'staple').every(recipe => !history.recipeCounts[recipe.id])) {
    reasons.push(`${basis}と同じ料理をできるだけ避けました。`);
  }
  if (history.hasTaggedData && main?.proteinSources.length) {
    const source = [...main.proteinSources].sort((a, b) => history.proteinSources[a] - history.proteinSources[b])[0];
    const minimum = Math.min(...Object.values(history.proteinSources));
    if (history.proteinSources[source] === minimum) reasons.push(`${basis}で登場回数が少なかった${SOURCE_LABELS[source]}を主菜に含めています。`);
  }
  if (groups.includes('vegetable')) reasons.push('野菜を使う料理を組み合わせています。');
  if (!groups.includes('vegetable')) warnings.push('この組合せには野菜の食品群がありません。レシピの差し替えを検討してください。');
  if (!groups.includes('protein')) warnings.push('この組合せには主なたんぱく源の食品群がありません。');
  if (!groups.includes('staple')) warnings.push('この組合せには主食の食品群がありません。');
  if (selected.some(recipe => history.recipeCounts[recipe.id] && recipe.role !== 'staple')) {
    warnings.push(`食べられる候補の範囲で、${basis}と同じ料理を含めています。`);
  }
  if (targetGenre && main && main.genre !== targetGenre) {
    warnings.push(`希望ジャンル以外の主菜を選びました。今回の条件に合わせて「${targetGenre}」の代わりに「${main.genre ?? 'その他'}」を組み合わせています。`);
  }
  const mood = settings.preferences.mood;
  if (mood !== 'all') {
    if (selected.some(recipe => (recipe.role !== 'staple' || recipe === main) && (recipe.tags ?? []).includes(mood))) {
      reasons.push(`「${mood}」のタグが付いた料理を含めています。`);
    } else {
      warnings.push(`気分「${mood}」に合う候補を組み合わせられなかったため、食材の除外条件を保った別の料理を選びました。`);
    }
  }
  if (settings.preferences.maxMinutes && selected.some(recipe => recipe.minutes > settings.preferences.maxMinutes)) {
    warnings.push('希望した所要時間を超える料理を含みます。');
  }
  return {reasons: unique(reasons), warnings: unique(warnings)};
}

function omissionNotes(day, data) {
  const active = new Set(activeRecipeIds(day));
  const omittedRecipeIds = unique(day.omittedRecipeIds ?? []);
  const proposedReasons = [...(day.proposedReasons ?? day.reasons ?? [])];
  const proposedWarnings = [...(day.proposedWarnings ?? day.warnings ?? [])];
  if (!omittedRecipeIds.length) {
    return {...day, omittedRecipeIds, proposedReasons, proposedWarnings,
      reasons: [...proposedReasons], warnings: [...proposedWarnings]};
  }
  const recipes = [...active].map(id => describeRecipe(id, data));
  const groups = unique(recipes.flatMap(recipe => recipe.groups));
  const warnings = proposedWarnings.map(message => `提案時の条件確認：${message}`);
  const omittedNames = omittedRecipeIds.map(id => {
    const recipe = describeRecipe(id, data);
    return `${ROLE_LABELS[recipe.role]}「${recipe.name}」`;
  });
  warnings.push(`今回は${omittedNames.join('・')}を作らない設定です。買い物リストと食事の記録から外します。`);
  if (active.size && day.meal !== 'snack') {
    if (!groups.includes('vegetable')) warnings.push('今回作る料理には野菜の食品群がありません。');
    if (!groups.includes('protein')) warnings.push('今回作る料理には主なたんぱく源の食品群がありません。');
    if (!groups.includes('staple')) warnings.push('今回作る料理には主食の食品群がありません。');
  }
  return {...day, omittedRecipeIds, proposedReasons, proposedWarnings,
    reasons: [active.size ? (day.meal === 'snack' ? '今回食べる間食と飲み物だけで集計しています。' : '今回作る料理だけで集計しています。自動提案時の主菜・副菜・汁物の構成から、一部を外した状態です。') : 'この日の料理はすべて「今回は作らない」設定です。'],
    warnings: unique(warnings)};
}

export function generatePlan(settings = {}, data) {
  const normalised = normaliseSettings(settings, data);
  const catalog = catalogue(data);
  const profile = normalised.mealPreferences[normalised.meal];
  const safe = catalog.recipes.filter(recipe => allowed(recipe, normalised) &&
    (!isBanshakuDish(recipe) || canSuggestAtMeal(recipe, normalised.meal, profile)));
  const byRole = Object.fromEntries(ROLES.map(role => [role, safe.filter(recipe => recipe.role === role)]));
  // 主食を添えられない場合は、もともと主食を含む主菜だけから選びます。
  const possibleMains = byRole.main.filter(recipe => recipe.staple || byRole.staple.length);
  const missing = ['side', 'soup'].filter(role => !byRole[role].length);
  if (!byRole.main.length) missing.push('main');
  else if (!possibleMains.length) missing.push('staple');
  const warnings = [...preferenceWarnings(normalised, data),
    ...(catalog.invalidIds.length ? [`材料・手順・確認情報が不足する${catalog.invalidIds.length}品は提案から除外しました。`] : [])];
  if (missing.length) return incomplete(normalised, missing, warnings);
  const result = [];
  const historyEntries = [...(settings.history ?? [])];
  const used = new Set();
  const targets = genreSchedule(normalised);
  let lastSources = [];
  for (let index = 0; index < normalised.days; index++) {
    const date = nextDate(normalised.startDate, index);
    const history = analyseHistory(historyEntries, {beforeDate: date, days: 7, beforeMeal: normalised.meal}, data);
    const context = {used, groups: new Set(), lastSources, targetGenre: targets[index]};
    const selected = [];
    const add = recipe => {
      selected.push(recipe);
      recipe.groups.forEach(group => context.groups.add(group));
      used.add(recipe.id);
    };
    const main = pick(possibleMains, normalised, history, context, date, 'main');
    add(main);
    add(pick(byRole.side, normalised, history, context, date, 'side'));
    add(pick(byRole.soup, normalised, history, context, date, 'soup'));
    if (!main.staple) add(pick(byRole.staple, normalised, history, context, date, 'staple'));
    const recorded = analyseHistory(settings.history ?? [], {beforeDate: date, days: 7, beforeMeal: normalised.meal}, data);
    const notes = dayNotes(selected, history, normalised, {recordedHistory: recorded.hasTaggedData, earlierPlans: index > 0, targetGenre: targets[index]});
    result.push({date, meal: normalised.meal, targetGenre: targets[index],
      recipeIds: selected.map(recipe => recipe.id), omittedRecipeIds: [],
      ...notes, proposedReasons: [...notes.reasons], proposedWarnings: [...notes.warnings]});
    lastSources = main.proteinSources;
    historyEntries.push({date, meal: normalised.meal, recipeIds: selected.map(recipe => recipe.id)});
  }
  return {ok: true, days: result, settings: normalised, missingRoles: [], warnings,
    genreSummary: summariseGenres(normalised, result, data)};
}

// カレンダーは「食べた」記録のスナップショットだけを比較に使います。
// 献立の予定や現在のDBで過去の食事を置き換えることはしません。
function calendarEvidence(entries, date, meal, data, completedDays) {
  const from = nextDate(date, -6);
  const filtered = entries.filter(entry => entry && entry.status === 'eaten' && validDate(entry.date) &&
    MEALS.includes(entry.meal) && entry.date >= from && entry.date <= date &&
    (entry.date !== date || MEALS.indexOf(entry.meal) < MEALS.indexOf(meal)));
  const meals = new Map();
  const values = Object.fromEntries(NUTRIENTS.map(key => [key, null]));
  const knownCounts = emptyCounts(NUTRIENTS);
  const knownDates = Object.fromEntries(NUTRIENTS.map(key => [key, new Set()]));
  const completed = completedDays === undefined ? null : new Set(completedDays);
  // 完了を明示した空の日も、飲食量0の日として平均の分母へ含めます。
  // 未完了の空の日はここに作らず、0と推測しません。
  const daily = new Map([...(completed ?? [])].filter(key => key >= from && key < date)
    .map(key => [key, {count: 0, values: emptyCounts(NUTRIENTS), known: emptyCounts(NUTRIENTS)}]));
  const todayValues = Object.fromEntries(NUTRIENTS.map(key => [key, null]));
  const todayKnownCounts = emptyCounts(NUTRIENTS);
  let itemCount = 0;
  let todayItemCount = 0;
  for (const entry of filtered) {
    const mealKey = `${entry.date}:${entry.meal}`;
    if (!meals.has(mealKey)) meals.set(mealKey, {groups: new Set(), sources: new Set(), recipes: new Set()});
    const tags = meals.get(mealKey);
    let items = entry.items;
    // 旧形式を明示的に渡した場合に限る補助。itemsとrecipeIdsは重ねて数えません。
    if (!Array.isArray(items)) items = (entry.recipeIds ?? []).flatMap(id => {
      try {
        const recipe = describeRecipe(id, data);
        return [{recipeId: id, quantity: 1, nutrition: recipeNutrition(recipe, data),
          groups: recipe.groups, proteinSources: recipe.proteinSources}];
      } catch { return []; }
    });
    // メモだけの実食は未知の飲食1品です。既知の朝食などと同じ日に
    // 並んでも、その日全体を既知の少量として確定させません。
    if (!items.length) items = [{quantity: 1, nutrition: {}}];
    for (const item of items) {
      if (!item || !finitePositive(item.quantity)) continue;
      itemCount++;
      if (!daily.has(entry.date)) daily.set(entry.date, {count: 0, values: emptyCounts(NUTRIENTS), known: emptyCounts(NUTRIENTS)});
      const day = daily.get(entry.date); day.count++;
      if (entry.date === date) todayItemCount++;
      (item.groups ?? []).filter(group => FOOD_GROUPS.includes(group)).forEach(group => tags.groups.add(group));
      (item.proteinSources ?? []).filter(source => PROTEIN_SOURCES.includes(source)).forEach(source => tags.sources.add(source));
      if (typeof item.recipeId === 'string') tags.recipes.add(item.recipeId);
      for (const key of NUTRIENTS) {
        const amount = item.nutrition?.[key];
        if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) continue;
        const total = amount * item.quantity;
        day.values[key] += total; day.known[key]++;
        values[key] = (values[key] ?? 0) + total;
        knownCounts[key]++;
        knownDates[key].add(entry.date);
        if (entry.date === date) {
          todayValues[key] = (todayValues[key] ?? 0) + total;
          todayKnownCounts[key]++;
        }
      }
    }
  }
  const groups = emptyCounts(FOOD_GROUPS);
  const proteinSources = emptyCounts(PROTEIN_SOURCES);
  const recipeCounts = Object.create(null);
  let taggedMealCount = 0;
  for (const entry of meals.values()) {
    entry.groups.forEach(group => groups[group]++);
    entry.sources.forEach(source => proteinSources[source]++);
    entry.recipes.forEach(id => { recipeCounts[id] = (recipeCounts[id] ?? 0) + 1; });
    if (entry.groups.size || entry.sources.size || entry.recipes.size) taggedMealCount++;
  }
  const completePriorDays = [...daily.entries()].filter(([key]) => key < date && completed?.has(key));
  const dailyMeans = Object.fromEntries(NUTRIENTS.map(key => {
    if (!completed) return [key, knownDates[key].size ? values[key] / knownDates[key].size : null];
    const knownDays = completePriorDays.filter(([, day]) => day.known[key] === day.count);
    return [key, knownDays.length ? knownDays.reduce((sum, [, day]) => sum + day.values[key], 0) / knownDays.length : null];
  }));
  const basis = {from, untilDate: date, beforeMeal: meal, entryCount: filtered.length, itemCount,
    values, knownCounts,
    complete: Object.fromEntries(NUTRIENTS.map(key => [key, itemCount > 0 && knownCounts[key] === itemCount])),
    dailyMeans, usesCompletedDays: completed !== null, completedDayCount: completePriorDays.length,
    today: {values: todayValues, knownCounts: todayKnownCounts,
      complete: Object.fromEntries(NUTRIENTS.map(key => [key, todayItemCount > 0 && todayKnownCounts[key] === todayItemCount]))}};
  return {basis, history: {groups, proteinSources, recipeCounts, taggedMealCount,
    hasHistory: meals.size > 0, hasTaggedData: taggedMealCount > 0, mealCount: meals.size,
    recentRecipeIds: Object.keys(recipeCounts)}};
}

function comparisonTargets(targets) {
  if (targets === undefined) return {};
  if (!targets || typeof targets !== 'object' || Array.isArray(targets) ||
      NUTRIENTS.some(key => targets[key] != null && !(finitePositive(targets[key]) || key === 'salt' && targets[key] === 0))) {
    throw new Error('栄養の比較値は正の数値で指定してください。食塩相当量は0も指定できます。');
  }
  return Object.fromEntries(NUTRIENTS.filter(key => finitePositive(targets[key]) || key === 'salt' && targets[key] === 0).map(key => [key, targets[key]]));
}

function calendarNutrientScore(recipe, basis, targets, selected, data, meal, settings) {
  const nutrition = recipeNutrition(recipe, data);
  const profile = mealProfile(settings, meal), share = profile.share * profile.scale;
  let score = 0;
  // 量が分かる候補では、食事区分ごとの配分から大きくはみ出す組合せを控えます。
  // 一日の比較値へ合わせ切る最適化や、未登録の成分の推定は行いません。
  if (targets.kcal && nutrition.kcal != null) {
    const current = selected.map(item => recipeNutrition(item, data).kcal).filter(value => value != null).reduce((sum, value) => sum + value, 0);
    score -= 12 * Math.max(0, (current + nutrition.kcal) / (targets.kcal * share) - 1);
  }
  for (const key of ['kcal', 'salt', 'protein', 'fiber']) {
    const target = targets[key];
    if (target === undefined || (basis.dailyMeans[key] === null && (!['kcal', 'salt'].includes(key) || basis.today.values[key] === null))) continue;
    const amount = nutrition[key];
    // 不明な栄養量を0とみなして「少ない料理」として優先しません。
    if (amount === null || amount === undefined) { score -= 20; continue; }
    if (key === 'kcal' || key === 'salt') {
      const selectedValues = selected.map(item => recipeNutrition(item, data)[key]);
      const already = (basis.today.values[key] ?? 0) + selectedValues.filter(value => value !== null && value !== undefined).reduce((sum, value) => sum + value, 0);
      const available = Math.max(0, target - already);
      const denominator = Math.max(target, 1);
      const excess = Math.max(0, amount - available) / denominator;
      const previousExcess = target === 0 ? ((basis.dailyMeans[key] ?? 0) > 0 ? 1 : 0) : Math.max(0, (basis.dailyMeans[key] ?? 0) / target - 1);
      score -= 16 * Math.min(1, excess + Math.min(previousExcess, 1) * amount / (denominator * share));
    } else {
      const difference = Math.max(0, 1 - basis.dailyMeans[key] / target);
      score += 14 * difference * Math.min(1, amount / (target * share));
    }
  }
  return score;
}

function calendarNotes(selected, evidence, settings, targets, targetGenre, meal, data) {
  const {basis, history} = evidence;
  const main = selected.find(recipe => recipe.role === 'main') ?? selected.find(recipe => recipe.staple);
  const notes = dayNotes(selected, history, settings, {recordedHistory: history.hasTaggedData, targetGenre, main});
  if (meal === 'snack') {
    notes.reasons = notes.reasons.filter(message => !message.includes('野菜を使う料理'));
    notes.warnings = notes.warnings.filter(message => !/野菜の食品群|たんぱく源の食品群|主食の食品群|希望ジャンル/.test(message));
    notes.reasons.push('間食として食べる量を調整しやすい1品を選んでいます。');
  } else {
    const profile = mealProfile(settings, meal);
    const names = {breakfast: '朝食', lunch: '昼食', dinner: '夕食'};
    const amounts = {light: '軽め', normal: 'ふつう', hearty: 'しっかり'};
    notes.reasons.push(`${names[meal]}の「${amounts[profile.volume]}」に合わせて、料理の構成と自動で選ぶ量を調整しています。必要な摂取量の指定ではありません。`);
    if (meal === 'breakfast') notes.reasons.push('朝食向けの卵・焼き魚などと短時間の料理を優先し、通常は主食におかずと副菜または汁物を合わせます。');
    if (meal === 'lunch') notes.reasons.push('昼食は準備しやすい主菜や一品料理を優先し、野菜を使う副菜を組み合わせます。');
    if (meal === 'dinner') notes.reasons.push('夕食は主菜・副菜・汁物を基本に、主食を含む料理との重複を避けます。');
    if (meal === 'dinner' && profile.banshaku && selected.some(isBanshakuDish)) notes.reasons.push('晩酌向けのおかずを選びました。');
    if (selected.some(mainIncludesBroth) && !selected.some(recipe => recipe.role === 'soup')) notes.reasons.push('汁のある麺・鍋・シチューには、別の汁物を重ねていません。');
  }
  const nutrientLabels = {kcal: 'エネルギー', salt: '食塩相当量', protein: 'たんぱく質', fiber: '食物繊維'};
  if (!basis.itemCount && !basis.completedDayCount) {
    notes.reasons.push('この食事より前の7日間に食べた記録がないため、栄養量による比較は行っていません。');
  } else {
    notes.reasons.push(`${basis.from}からこの食事の直前までに「食べた」と記録した${basis.entryCount}件を比較しました。予定の食事は摂取量に含めていません。`);
    if (basis.usesCompletedDays) notes.reasons.push(`過去の栄養の平均は、飲食の記録を完了した${basis.completedDayCount}日だけを対象にします。栄養が不明な日はその成分の平均から除きます。`);
    const lower = ['kcal', 'salt'].filter(key => targets[key] !== undefined && basis.dailyMeans[key] !== null &&
      (basis.dailyMeans[key] > targets[key] || (basis.today.values[key] ?? 0) >= targets[key]));
    const higher = ['protein', 'fiber'].filter(key => targets[key] && basis.dailyMeans[key] !== null &&
      basis.dailyMeans[key] < targets[key] && selected.some(recipe => (recipeNutrition(recipe, data)[key] ?? 0) > 0));
    if (lower.length) notes.reasons.push(`登録された${lower.map(key => nutrientLabels[key]).join('・')}が比較値を上回るため、量が分かる候補の中で控えめな組合せを優先しました。`);
    if (higher.length) notes.reasons.push(`記録された範囲で${higher.map(key => nutrientLabels[key]).join('・')}の1日平均が比較値より少ないため、これらを含む候補を優先しました。`);
    if (basis.itemCount > 0 && NUTRIENTS.some(key => !basis.complete[key])) notes.warnings.push('記録の一部に未登録の栄養量があります。比較は分かる範囲の参考値です。');
  }
  if (selected.some(recipe => NUTRIENTS.some(key => recipeNutrition(recipe, data)[key] == null))) {
    notes.warnings.push('この献立には栄養量が未登録の項目があります。0として計算していません。');
  }
  if (selected.some(recipe => recipe.ingredientsKnown === false)) notes.warnings.push('材料が未登録の料理があります。買い物リストだけでは必要な材料を確認できません。');
  return {reasons: unique(notes.reasons), warnings: unique(notes.warnings)};
}

function calendarAmount(value, label) {
  if (value === undefined || value === null) return null;
  if (!finitePositive(value) || value > 100000) throw new Error(`${label}は0より大きい数値で指定してください。`);
  return value;
}

function calendarQuantity(recipe, settings, data) {
  const amount = recipe.id === settings.stapleId ? settings.stapleAmount : recipe.id === settings.drinkId ? settings.drinkAmount : null;
  const fixed = recipe.id === settings.stapleId || recipe.id === settings.drinkId;
  const quantity = amount === null || amount === undefined ? (fixed ? 1 : plannedQuantity(recipe, settings, data)) : quantityFromAmount(recipe, data, amount);
  if (!finitePositive(quantity) || quantity > 1000) throw new Error('主食または飲み物の量が大きすぎます。基準量の1000倍以内で指定してください。');
  return quantity;
}

function calendarScaled(recipe, settings, data, quantity = calendarQuantity(recipe, settings, data)) {
  if (quantity === 1) return recipe;
  return {...recipe, ingredients: recipe.ingredients.map(part => ({...part, amount: part.amount * quantity})),
    ...(recipe.manualNutrition ? {manualNutrition: Object.fromEntries(NUTRIENTS.map(key => [key, recipe.manualNutrition[key] == null ? null : recipe.manualNutrition[key] * quantity]))} : {})};
}

function checkedCompletedDays(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 36600 || value.some(date => !validDate(date) || date < '2000-01-01' || date > '2100-12-31') || new Set(value).size !== value.length) throw new Error('飲食の記録を完了した日付を確認してください。');
  return value;
}

function calendarStapleSettings(settings, options = {}) {
  let stapleId = options.stapleId ?? settings.stapleId ?? 'auto';
  const stapleMode = options.stapleMode ?? settings.stapleMode ?? (['auto', 'none'].includes(stapleId) ? 'adaptive' : 'fixed');
  if (!['adaptive', 'fixed'].includes(stapleMode) || typeof stapleId !== 'string') throw new Error('主食の選び方を確認してください。');
  let stapleAmount = calendarAmount(Object.hasOwn(options, 'stapleAmount') ? options.stapleAmount : settings.stapleAmount, '主食の量');
  if (stapleMode === 'adaptive') {
    stapleId = stapleId === 'none' ? 'none' : 'auto';
    stapleAmount = null;
  } else if (['auto', 'none'].includes(stapleId)) throw new Error('指定する主食を選んでください。');
  return {stapleId, stapleMode, stapleAmount};
}

function adaptiveStaple(pool, main, meal, settings, history, context, date) {
  const mode = mealProfile(settings, meal).staple;
  let available = pool.filter(recipe => !isCompleteMeal(recipe));
  if (meal === 'breakfast') available = mealAppropriateCandidates(available, meal);
  const explicit = mode !== 'auto' && mode !== 'fixed';
  if (explicit) available = available.filter(recipe => matchesStaplePreference(recipe, mode));
  if (!available.length) return null;
  const families = main?.genre === '洋食' ? (meal === 'breakfast' ? ['bread'] : ['bread', 'rice']) : ['rice'];
  const matching = available.filter(recipe => families.includes(recipeFamily(recipe)));
  const preferred = explicit && mode !== 'rice-or-bread' ? available : matching.length ? matching : available;
  const plain = preferred.filter(recipe => recipe.id === 'plain-rice' || /^(白米|白ご飯|ご飯)$/.test(recipe.name));
  return pick(plain.length && !preferred.some(recipe => recipeFamily(recipe) === 'bread') ? plain : preferred, settings, history, context, date, 'staple');
}

function calendarAccompaniments(candidates, main, settings = {}, sideType = 'auto') {
  let available = settings.meal ? mealAppropriateCandidates(candidates, settings.meal, settings.profile) : candidates;
  if (settings.meal === 'breakfast') available = available.filter(recipe => (sideType === 'protein' ? ['protein', 'vegetable', 'soup'] : ['vegetable', 'soup']).includes(breakfastRole(recipe)));
  if (sideType === 'salad') available = available.filter(recipe => dishClassification(recipe).method === 'salad');
  if (sideType === 'vegetable') available = available.filter(recipe => recipe.groups.includes('vegetable'));
  if (sideType === 'protein') available = available.filter(recipe => recipe.groups.includes('protein'));
  const vegetables = available.filter(recipe => recipe.groups.includes('vegetable'));
  const pool = sideType !== 'protein' && vegetables.length ? vegetables : available;
  const matching = pool.filter(recipe => recipe.genre === main.genre);
  return matching.length ? matching : pool;
}

function mealMainCandidates(safe, settings) {
  const profile = mealProfile(settings), mode = profile.staple;
  let mains = mealAppropriateCandidates(safe.filter(recipe => recipe.role === 'main' || settings.meal === 'breakfast' && ['bread', 'rice-or-bread'].includes(mode) && isCompleteMeal(recipe)), settings.meal, profile);
  if (mode === 'none' || mode === 'rice' || mode === 'fixed') mains = mains.filter(recipe => !recipe.staple);
  else if (['bread', 'rice-or-bread'].includes(mode)) {mains = mains.filter(recipe => !recipe.staple || matchesStaplePreference(recipe, mode));if (settings.meal === 'breakfast' && mode === 'bread') mains = mains.filter(recipe => recipe.genre === '洋食' || recipe.staple);}
  else if (settings.meal === 'breakfast') mains = mains.filter(recipe => !recipe.staple || matchesStaplePreference(recipe, 'rice-or-bread'));
  return mains;
}

const brothMeal = mainIncludesBroth;

function calendarDaySettings(settings, day) {
  const localSettings = day.mealPreference && day.meal !== 'snack' ? {...settings, mealPreferences: {...settings.mealPreferences, [day.meal]: {...settings.mealPreferences[day.meal], ...day.mealPreference}}} : settings;
  return {...resolveMealSettings(localSettings, day.meal),
    ...(day.stapleId === undefined ? {} : {stapleId: day.stapleId,
      stapleMode: day.stapleMode ?? (['auto', 'none'].includes(day.stapleId) ? 'adaptive' : 'fixed'), stapleAmount: day.stapleAmount ?? null}),
    ...(day.drinkId === undefined ? {} : {drinkId: day.drinkId, drinkAmount: day.drinkAmount ?? null})};
}

export function generateCalendarPlan(settings = {}, data, options = {}) {
  return buildCalendarPlan(settings, data, options, []);
}

function buildCalendarPlan(settings, data, options, otherDishIds) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('カレンダーの提案条件を確認してください。');
  const meal = options.meal ?? settings.meal ?? 'dinner';
  const legacyStaple = calendarStapleSettings(settings, options);
  const legacyDrinkId = options.drinkId ?? settings.drinkId ?? 'none';
  const legacyDrinkAmount = calendarAmount(Object.hasOwn(options, 'drinkAmount') ? options.drinkAmount : settings.drinkAmount, '飲み物の量');
  const merged = {...settings, ...legacyStaple, drinkId: legacyDrinkId, drinkAmount: legacyDrinkAmount, meal};
  const normalised = {...normaliseSettings(merged, data, {allowSnack: true}), ...legacyStaple, drinkId: legacyDrinkId, drinkAmount: legacyDrinkAmount};
  // 旧APIで明示した共通の飲み物だけは、旧式プロフィールへの指定として受け入れます。
  if (Object.hasOwn(options, 'drinkId') || Object.hasOwn(settings, 'drinkId')) for (const id of MEALS.slice(0, 3)) {
    if (!Object.hasOwn(settings.mealPreferences?.[id] ?? {}, 'drinkId')) Object.assign(normalised.mealPreferences[id], {drinkId: legacyDrinkId, drinkAmount: legacyDrinkAmount});
  }
  const entries = options.entries ?? [];
  if (!Array.isArray(entries)) throw new Error('カレンダーの食事記録を確認してください。');
  const completedDays = checkedCompletedDays(options.completedDays), targets = comparisonTargets(options.targets), pantry = options.pantry ?? [];
  if (!Array.isArray(pantry) || pantry.some(part => !part || typeof part.id !== 'string' || !Object.hasOwn(data.ingredients, part.id) || typeof part.amount !== 'number' || !Number.isFinite(part.amount) || part.amount < 0)) throw new Error('手持ち食材の分量を確認してください。');
  const catalog = catalogue(data), safe = catalog.recipes.filter(recipe => allowed(recipe, normalised));
  if (!['auto','none'].includes(legacyDrinkId) && !safe.some(recipe => recipe.id === legacyDrinkId && recipe.role === 'drink')) return {...incomplete(normalised, ['drink'], ['指定した飲み物を用意できません。登録内容と除外条件を確認してください。']), mode:'calendar'};
  const warnings = [...preferenceWarnings(normalised, data), ...(catalog.invalidIds.length ? [`材料・手順・確認情報が不足する${catalog.invalidIds.length}品は提案から除外しました。`] : [])];
  const meals = (meal === 'all' ? MEALS.slice(0, 3) : [meal]).filter(id => id === 'snack' || mealProfile(normalised, id).enabled);
  if (!meals.length) return {...incomplete(normalised, [], [...warnings, '提案する食事が選ばれていません。食事ごとの「提案する」を確認してください。']), mode: 'calendar'};
  const days = [], used = new Set(otherDishIds), genres = genreSchedule(normalised, normalised.days * meals.length);let lastSources = [];
  for (let index = 0; index < normalised.days * meals.length; index++) {
    const date = nextDate(normalised.startDate, Math.floor(index / meals.length)), currentMeal = meals[index % meals.length];
    const mealSettings = currentMeal === 'snack' ? {...normalised, meal: currentMeal} : resolveMealSettings(normalised, currentMeal), profile = mealProfile(mealSettings, currentMeal);
    const byRole = Object.fromEntries(ROLES.map(role => [role, safe.filter(recipe => recipe.role === role)]));
    const fixedStaple = !['auto', 'none'].includes(mealSettings.stapleId) ? safe.find(recipe => recipe.id === mealSettings.stapleId && recipe.staple) : null;
    const fixedDrink = !['auto', 'none'].includes(mealSettings.drinkId) ? byRole.drink.find(recipe => recipe.id === mealSettings.drinkId) : null;
    const fail = (roles, reason) => ({...incomplete(normalised, roles, [...warnings, `${date}の${{breakfast:'朝食', lunch:'昼食', dinner:'夕食', snack:'間食'}[currentMeal]}：${reason}`]), mode: 'calendar'});
    if (!['auto', 'none'].includes(mealSettings.stapleId) && !fixedStaple) return fail(['staple'], '指定した主食が除外条件に合いません。');
    if (!['auto', 'none'].includes(mealSettings.drinkId) && !fixedDrink) return fail(['drink'], '指定した飲み物が除外条件に合いません。');
    const evidence = calendarEvidence(entries, date, currentMeal, data, completedDays), selected = [], quantities = {};
    const context = {used, groups: new Set(), lastSources, targetGenre: genres[index], scoreRecipe: recipe => calendarNutrientScore(calendarScaled(recipe, mealSettings, data), evidence.basis, targets, selected, data, currentMeal, mealSettings) + mealRecipeScore(recipe, currentMeal) + recipe.ingredients.filter(part => pantry.some(stock => stock.id === part.id && stock.amount > 0)).length * 3};
    const add = recipe => {
      if (!recipe || selected.some(item => item.id === recipe.id)) return;
      quantities[recipe.id] = calendarQuantity(recipe, mealSettings, data);selected.push(calendarScaled(recipe, mealSettings, data, quantities[recipe.id]));used.add(recipe.id);recipe.groups.forEach(group => context.groups.add(group));
    };
    let main = null, cerealBase = false, completeBase = false;
    if (currentMeal === 'snack') {
      const snack = pick(byRole.snack, mealSettings, evidence.history, context, date, 'snack');if (!snack) return fail(['snack'], '間食の候補がありません。');add(snack);
    } else {
      const forceComplete = ['rice-meal', 'noodle', 'handheld', 'cereal'].includes(profile.staple);
      if (fixedStaple && isCompleteMeal(fixedStaple)) {main = fixedStaple;completeBase = true;}
      else if (forceComplete) {
        const candidates = mealAppropriateCandidates(safe.filter(recipe => recipe.staple && matchesStaplePreference(recipe, profile.staple) && (profile.staple === 'cereal' ? recipe.role === 'staple' : isCompleteMeal(recipe))), currentMeal, profile);
        main = pick(candidates, mealSettings, evidence.history, context, date, 'main');completeBase = true;cerealBase = profile.staple === 'cereal';
      } else {
        let candidates = mealMainCandidates(safe, mealSettings);
        if (!byRole.soup.length) candidates = candidates.filter(recipe => !mealCourses(mealSettings, recipe).soup || brothMeal(recipe));
        main = pick(candidates, mealSettings, evidence.history, context, date, 'main');
      }
      if (!main) return fail(!byRole.soup.length ? ['soup'] : ['main'], fixedStaple ? '指定した主食と重複しない主菜がありません。' : currentMeal === 'breakfast' ? '朝食向けの候補がありません。主食や避ける食材の設定を確認してください。' : '希望した主食や料理の候補がありません。');
      add(main);
      if (!main.staple && mealSettings.stapleId !== 'none') {
        const staple = fixedStaple ?? adaptiveStaple(byRole.staple, main, currentMeal, mealSettings, evidence.history, context, date);
        if (!staple) return fail(['staple'], '希望した種類の主食がありません。');add(staple);
      }
      const courses = mealCourses(mealSettings, main);
      for (let sideIndex = 0; sideIndex < courses.sideCount; sideIndex++) {
        const side = pick(calendarAccompaniments(byRole.side.filter(recipe => !selected.some(item => item.id === recipe.id)), main, mealSettings, sideIndex === 0 ? profile.sideType : 'auto'), mealSettings, evidence.history, context, date, 'side');
        if (!side) return fail(['side'], currentMeal === 'breakfast' ? '朝食に合う副菜の候補がありません。' : '副菜の候補がありません。');add(side);
      }
      if (courses.soup && (!brothMeal(main) || profile.soup === 'include')) {
        const soup = pick(calendarAccompaniments(byRole.soup, main, mealSettings), mealSettings, evidence.history, context, date, 'soup');
        if (!soup) return fail(['soup'], currentMeal === 'breakfast' ? '朝食に合う汁物の候補がありません。' : '汁物の候補がありません。');add(soup);
      }
      if (profile.yogurt) {
        const yoghurt = pick(safe.filter(recipe => recipe.id === 'snack-plain-yogurt'), mealSettings, evidence.history, context, date, 'yoghurt');
        if (!yoghurt) return fail(['snack'], 'ヨーグルトが除外条件に合いません。追加指定を確認してください。');add(yoghurt);
      }
      if (profile.fruit) {
        const fruit = pick(safe.filter(recipe => recipe.role === 'snack' && recipeFamily(recipe) === 'fruit'), mealSettings, evidence.history, context, date, 'fruit');
        if (!fruit) return fail(['snack'], '果物の候補がありません。追加指定を確認してください。');add(fruit);
      }
      lastSources = main.proteinSources;
    }
    if (mealSettings.drinkId !== 'none') {
      const drink = mealSettings.drinkId === 'auto' ? pick(byRole.drink, mealSettings, evidence.history, context, date, 'drink') : fixedDrink;
      if (!drink) return fail(['drink'], '飲み物の候補がありません。');add(drink);
    }
    const notes = calendarNotes(selected, evidence, mealSettings, targets, genres[index], currentMeal, data);
    if (completeBase || main?.staple) {notes.reasons.push(cerealBase ? 'オートミールを朝食の主食にし、追加指定の食品を組み合わせています。' : '主食を含む料理を中心にし、別の主食や主菜を重ねていません。');}
    if (mealSettings.stapleId === 'none') {notes.warnings = notes.warnings.filter(message => !message.includes('主食の食品群'));notes.reasons.push('この食事には主食を付けない設定です。');}
    if (profile.yogurt || profile.fruit) notes.reasons.push('追加指定したヨーグルトや果物を含めています。');
    if (selected.some(recipe => recipe.ingredients.some(part => pantry.some(stock => stock.id === part.id && stock.amount > 0)))) notes.reasons.push('手持ちの食材を使う候補に優先度を付けています。');
    if (mealSettings.stapleAmount !== null || mealSettings.drinkAmount !== null) notes.reasons.push('固定した主食と飲み物は、指定した量をそのまま使っています。');
    days.push({date, meal: currentMeal, mainId: main?.id ?? null, targetGenre: genres[index], recipeIds: selected.map(recipe => recipe.id), quantities, omittedRecipeIds: [],
      stapleId: mealSettings.stapleId, stapleMode: mealSettings.stapleMode, stapleAmount: mealSettings.stapleAmount, drinkId: mealSettings.drinkId, drinkAmount: mealSettings.drinkAmount,
      ...notes, proposedReasons: [...notes.reasons], proposedWarnings: [...notes.warnings], nutritionBasis: evidence.basis});
  }
  return {ok: true, mode: 'calendar', settings: normalised, days, missingRoles: [], warnings, genreSummary: summariseGenres(normalised, days, data)};
}

export function replaceRecipe(plan, options = {}, data) {
  if (!plan?.ok || !Array.isArray(plan.days) || !plan.settings) throw new Error('先に献立を作成してください。');
  const dayIndex = options.dayIndex;
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= plan.days.length) throw new Error('差し替える日を選んでください。');
  if (plan.mode === 'calendar' && (options.mealPreference !== undefined || options.genre !== undefined)) return regeneratePlanMeal(plan, options, data);
  const settings = {...normaliseSettings({...plan.settings, ...options}, data, {allowSnack: plan.mode === 'calendar'}),
    ...(plan.mode === 'calendar' ? {...calendarStapleSettings(plan.settings), drinkId: plan.settings.drinkId ?? 'none', drinkAmount: plan.settings.drinkAmount ?? null} : {})};
  const {recipes, invalidIds} = catalogue(data);
  const safe = recipes.filter(recipe => allowed(recipe, settings));
  const safeById = new Map(safe.map(recipe => [recipe.id, recipe]));
  // 設定変更後に古い献立へ差し替えを行っても、危険な古い料理を残しません。
  if (plan.days.some(day => !Array.isArray(day.recipeIds) || day.recipeIds.some(id => !safeById.has(id)))) {
    return {ok: false, days: [], settings, missingRoles: [], warnings: ['現在の除外条件に合わない料理が献立に含まれます。新しい条件で献立全体を作り直してください。']};
  }
  const currentDay = plan.days[dayIndex];
  const local = plan.mode === 'calendar' ? calendarDaySettings(settings, currentDay) : settings;
  activeRecipeIds(currentDay);
  if (!currentDay.recipeIds.includes(options.recipeId)) throw new Error('差し替える料理が見つかりません。');
  if ((currentDay.omittedRecipeIds ?? []).includes(options.recipeId)) throw new Error('今回は作らない料理は、戻してから差し替えてください。');
  const previous = safeById.get(options.recipeId);
  if (plan.mode === 'calendar' && currentDay.meal === 'breakfast' && currentDay.mainId === previous.id && recipeFamily(previous) === 'bread') return regeneratePlanMeal(plan, {...options, mealPreference: {}}, data);
  if (plan.mode === 'calendar' && (previous.id === local.stapleId || previous.id === local.drinkId)) return {...plan, warnings: unique([...(plan.warnings ?? []), '指定した主食や飲み物を替える場合は、条件の選択を変更して献立を作り直してください。'])};
  const main = currentDay.recipeIds.map(id => safeById.get(id)).find(recipe => recipe.role === 'main');
  const otherDays = plan.days.filter((_, index) => index !== dayIndex)
    .map(day => ({date: day.date, meal: day.meal, recipeIds: activeRecipeIds(day)}));
  const evidence = plan.mode === 'calendar' ? calendarEvidence(options.entries ?? [], currentDay.date, currentDay.meal, data, checkedCompletedDays(options.completedDays)) : null;
  const history = evidence?.history ?? analyseHistory([...(options.history ?? []), ...otherDays],
    {beforeDate: currentDay.date, days: 7, beforeMeal: currentDay.meal}, data);
  const used = new Set(plan.days.flatMap(day => activeRecipeIds(day)));
  const others = activeRecipeIds(currentDay).filter(id => id !== previous.id).map(id => plan.mode === 'calendar' ? calendarScaled(safeById.get(id), local, data, currentDay.quantities?.[id] ?? 1) : safeById.get(id));
  const targetGenre = currentDay.targetGenre ?? genreSchedule(settings)[dayIndex];
  let pool = safe.filter(recipe => recipe.role === previous.role && !currentDay.recipeIds.includes(recipe.id));
  if (plan.mode !== 'calendar') pool = pool.filter(recipe => !isBanshakuDish(recipe) || canSuggestAtMeal(recipe, local.meal, local.mealPreferences[local.meal]));
  if (plan.mode === 'calendar' && previous.role === 'staple' && !isCompleteMeal(previous)) pool = pool.filter(recipe => !isCompleteMeal(recipe));
  if (previous.role === 'main') {
    const hasStaple = safe.some(recipe => recipe.role === 'staple' && (plan.mode !== 'calendar' || !isCompleteMeal(recipe)));
    pool = pool.filter(recipe => plan.mode === 'calendar' && local.stapleId === 'none' ? true :
      plan.mode === 'calendar' && !['auto', 'none'].includes(local.stapleId) ? !recipe.staple : recipe.staple || hasStaple);
    if (plan.mode === 'calendar') pool = mealMainCandidates(pool, local);
  }
  if (plan.mode === 'calendar' && previous.role !== 'main') {
    pool = mealAppropriateCandidates(pool, currentDay.meal, local.profile);
    if (previous.role === 'side' && local.profile.sideType !== 'auto' && currentDay.recipeIds.find(id => safeById.get(id)?.role === 'side') === previous.id) {
      pool = calendarAccompaniments(pool, main ?? previous, local, local.profile.sideType);
    }
  }
  if (plan.mode === 'calendar') {const profile=mealProfile(local);if (['rice-meal','noodle','handheld','cereal'].includes(profile.staple) && (previous.role === 'main' || previous.staple)) pool=pool.filter(recipe=>recipe.staple&&matchesStaplePreference(recipe,profile.staple));if (recipeFamily(previous)==='fruit') pool=pool.filter(recipe=>recipeFamily(recipe)==='fruit');if (recipeFamily(previous)==='yoghurt') pool=pool.filter(recipe=>recipeFamily(recipe)==='yoghurt');}
  if (previous.role === 'staple' && main?.staple) pool = [];
  if (!pool.length) {
    return {...plan, settings, genreSummary: summariseGenres(settings, plan.days, data),
      warnings: unique([...(plan.warnings ?? []), ...preferenceWarnings(settings, data), '除外条件に合う別の料理がないため、現在の料理を維持しました。条件外の料理には差し替えていません。'])};
  }
  const context = {used, groups: new Set(others.flatMap(recipe => recipe.groups)), lastSources: [], targetGenre,
    ...(evidence ? {scoreRecipe: recipe => calendarNutrientScore(calendarScaled(recipe, local, data), evidence.basis, comparisonTargets(options.targets), others, data, currentDay.meal, local) + mealRecipeScore(recipe, currentDay.meal)} : {})};
  const selected = pick(pool, local, history, context, currentDay.date, previous.role);
  let newRecipes = currentDay.recipeIds.map(id => id === previous.id ? selected : safeById.get(id));
  if (previous.role === 'main') {
    newRecipes = newRecipes.filter(recipe => recipe.role !== 'staple');
    if (!selected.staple && !(plan.mode === 'calendar' && local.stapleId === 'none')) {
      const fixed = plan.mode === 'calendar' && !['auto', 'none'].includes(local.stapleId);
      const desired = fixed ? local.stapleId : 'plain-rice';
      const rice = plan.mode === 'calendar' && !fixed ? adaptiveStaple(safe.filter(recipe => recipe.role === 'staple'), selected, currentDay.meal, local, history, context, currentDay.date) :
        safe.find(recipe => recipe.role === 'staple' && recipe.id === desired) ?? (desired === 'plain-rice' ? safe.find(recipe => recipe.role === 'staple') : null);
      if (!rice) return incomplete(settings, ['staple']);
      newRecipes.push(rice);
    }
    if (plan.mode === 'calendar') {
      const courses = mealCourses(local, selected);
      const profile = mealProfile(local), retainedSides = newRecipes.filter(recipe => recipe.role === 'side');
      newRecipes = newRecipes.filter(recipe => recipe.role !== 'side');
      for (let sideIndex = 0; sideIndex < courses.sideCount; sideIndex++) {
        const candidates = calendarAccompaniments(safe.filter(recipe => recipe.role === 'side' && !newRecipes.some(item => item.id === recipe.id)), selected, local, sideIndex === 0 ? profile.sideType : 'auto');
        const side = retainedSides.find(recipe => candidates.some(candidate => candidate.id === recipe.id)) ?? pick(candidates, local, history, context, currentDay.date, 'side');
        if (!side) return incomplete(settings, ['side']);
        newRecipes.push(side);
      }
      if (brothMeal(selected) && profile.soup !== 'include' || !courses.soup) newRecipes = newRecipes.filter(recipe => recipe.role !== 'soup');
      else if (!newRecipes.some(recipe => recipe.role === 'soup')) {
        const soup = pick(calendarAccompaniments(safe.filter(recipe => recipe.role === 'soup'), selected, local), local, history, context, currentDay.date, 'soup');
        if (!soup) return incomplete(settings, ['soup']);
        newRecipes.push(soup);
      }
    }
  }
  if (plan.mode === 'calendar' && previous.role === 'staple') Object.assign(local, {stapleId: selected.id, stapleMode: 'fixed', stapleAmount: null});
  if (plan.mode === 'calendar' && previous.role === 'drink') Object.assign(local, {drinkId: selected.id, drinkAmount: null});
  const recorded = analyseHistory(options.history ?? [], {beforeDate: currentDay.date, days: 7, beforeMeal: currentDay.meal}, data);
  const earlierPlans = otherDays.some(day => day.date < currentDay.date);
  const quantities = Object.fromEntries(newRecipes.map(recipe => [recipe.id, plan.mode === 'calendar' ?
    (currentDay.quantities?.[recipe.id] ?? calendarQuantity(recipe, local, data)) : 1]));
  const notes = plan.mode === 'calendar' ? calendarNotes(newRecipes.map(recipe => calendarScaled(recipe, local, data, quantities[recipe.id])),
    evidence, local, comparisonTargets(options.targets), targetGenre, currentDay.meal, data) :
    dayNotes(newRecipes, history, settings, {recordedHistory: recorded.hasTaggedData, earlierPlans, targetGenre});
  const recipeIds = newRecipes.map(recipe => recipe.id);
  const dayOverride = plan.mode === 'calendar' && previous.role === 'staple' ? {stapleId: local.stapleId, stapleMode: local.stapleMode, stapleAmount: local.stapleAmount} :
    plan.mode === 'calendar' && previous.role === 'drink' ? {drinkId: local.drinkId, drinkAmount: local.drinkAmount} : {};
  const newDay = omissionNotes({...currentDay, ...dayOverride, ...(currentDay.mainId === previous.id ? {mainId: selected.id} : {}), targetGenre, recipeIds, ...(plan.mode === 'calendar' ? {quantities} : {}), ...(evidence ? {nutritionBasis: evidence.basis} : {}),
    omittedRecipeIds: (currentDay.omittedRecipeIds ?? []).filter(id => recipeIds.includes(id)),
    ...notes, proposedReasons: [...notes.reasons], proposedWarnings: [...notes.warnings]}, data);
  const days = plan.days.map((day, index) => index === dayIndex ? newDay : {...day, recipeIds: [...day.recipeIds], omittedRecipeIds: [...(day.omittedRecipeIds ?? [])]});
  return {ok: true, ...(plan.mode ? {mode: plan.mode} : {}), settings, missingRoles: [],
    warnings: [...preferenceWarnings(settings, data), ...(invalidIds.length ? [`確認情報が不足する${invalidIds.length}品は候補に含めていません。`] : [])],
    days, genreSummary: summariseGenres(settings, days, data)};
}

/** この食事に保存された個別設定を、編集画面向けに返します。 */
export function planMealPreference(plan, dayIndex) {
  if (!plan?.ok || !Number.isInteger(dayIndex) || !plan.days?.[dayIndex]) throw Error('編集する食事を選んでください。');
  const day = plan.days[dayIndex], base = normaliseMealPreferences(plan.settings.mealPreferences, plan.settings.preferences?.mood ?? 'all', plan.settings);
  if (day.meal === 'snack') throw Error('間食には朝・昼・夕の設定を使いません。');
  const profile = {...base[day.meal], ...(day.mealPreference ?? {})};
  if (day.stapleId !== undefined) {
    if (day.stapleMode === 'fixed' || !['auto', 'none'].includes(day.stapleId)) Object.assign(profile, {staple: 'fixed', stapleId: day.stapleId, stapleAmount: day.stapleAmount ?? null});
    else if (day.stapleId === 'none') Object.assign(profile, {staple: 'none', stapleId: 'none', stapleAmount: null});
  }
  if (day.drinkId !== undefined) Object.assign(profile, {drinkId: day.drinkId, drinkAmount: day.drinkAmount ?? null});
  return {...normaliseMealPreferences({...base, [day.meal]: profile})[day.meal]};
}

/** 共通設定を変えず、選んだ1食だけを新しい条件で組み直します。 */
export function regeneratePlanMeal(plan, options = {}, data) {
  const {dayIndex} = options;
  if (!plan?.ok || plan.mode !== 'calendar' || !Number.isInteger(dayIndex) || !plan.days?.[dayIndex]) throw Error('編集する献立を選んでください。');
  const current = plan.days[dayIndex];
  if (current.meal === 'snack') throw Error('間食には朝・昼・夕の設定を使いません。');
  const safeIds = new Set(eligibleRecipes(plan.settings, data).map(recipe => recipe.id));
  if (plan.days.some(day => activeRecipeIds(day).some(id => !safeIds.has(id)))) throw Error('現在の除外条件に合わない料理が含まれます。献立を作り直してください。');
  const mealPreference = {...planMealPreference(plan, dayIndex), ...(options.mealPreference ?? {})};
  if (!options.mealPreference || typeof options.mealPreference !== 'object' || Array.isArray(options.mealPreference)) {
    if (options.mealPreference !== undefined) throw Error('この食事の設定を確認してください。');
  }
  const genre = options.genre ?? current.targetGenre ?? 'all';
  if (genre !== 'all' && !GENRES.includes(genre)) throw Error('この食事のジャンルを確認してください。');
  const mealPreferences = normaliseMealPreferences({...plan.settings.mealPreferences, [current.meal]: mealPreference});
  mealPreferences[current.meal].enabled = true;
  const preferences = {...plan.settings.preferences, genreMode: genre === 'all' ? 'any' : 'single', genre};
  const settings = {...plan.settings, startDate: current.date, days: 1, meal: current.meal, mealPreferences, preferences,
    seed: options.seed ?? `${plan.settings.seed}:${current.date}:${current.recipeIds.join(',')}`};
  const generateOptions = {meal: current.meal, entries: options.entries ?? [], targets: options.targets,
    completedDays: options.completedDays, pantry: options.pantry ?? []};
  // 同じ料理しか作れない場合に限り、元の候補を戻します。条件外へは広げません。
  const otherDishIds = plan.days.flatMap((day, index) => index === dayIndex ? [] : activeRecipeIds(day));
  let rebuilt = buildCalendarPlan(settings, {...data, recipes: data.recipes.filter(recipe => recipe.id !== current.mainId)}, generateOptions, otherDishIds);
  const preferencePenalty = candidate => {
    if (!candidate.ok) return Infinity;
    const centre = data.recipes.find(recipe => recipe.id === candidate.days[0].mainId);
    const genrePenalty = genre !== 'all' && centre?.genre !== genre ? 4 : 0;
    const moodPenalty = mealPreference.mood !== 'all' && !(centre?.tags ?? []).includes(mealPreference.mood) ? 2 : 0;
    const eveningPenalty = mealPreference.banshaku && centre && !isBanshakuDish(centre) ? 1 : 0;
    return genrePenalty + moodPenalty + eveningPenalty;
  };
  // 種類を変えるために、指定したジャンルや傾向を満たす元の候補を捨てません。
  if (!rebuilt.ok || preferencePenalty(rebuilt) > 0) {
    const fallback = buildCalendarPlan(settings, data, generateOptions, otherDishIds);
    if (!rebuilt.ok || preferencePenalty(fallback) < preferencePenalty(rebuilt)) rebuilt = fallback;
  }
  if (!rebuilt.ok) throw Error(rebuilt.warnings.join(' ') || 'この条件で献立を作れません。');
  const next = {...rebuilt.days[0], mealPreference: structuredClone(mealPreferences[current.meal])};
  next.reasons = unique([...next.reasons, 'この食事だけの条件で献立を組み直しています。']);
  next.proposedReasons = [...next.reasons];
  const days = plan.days.map((day, index) => index === dayIndex ? next : structuredClone(day));
  return {...plan, days, genreSummary: summariseGenres(plan.settings, days, data)};
}

/** 既存の料理は残し、選んだ1食に副菜・果物などを追加します。 */
export function addPlanDish(plan, options = {}, data) {
  const {dayIndex, recipeId} = options;
  if (!plan?.ok || plan.mode !== 'calendar' || !Number.isInteger(dayIndex) || !plan.days?.[dayIndex]) throw Error('追加する献立を選んでください。');
  const safe = eligibleRecipes(plan.settings, data), byId = new Map(safe.map(recipe => [recipe.id, recipe]));
  if (plan.days.some(day => day.recipeIds.some(id => !byId.has(id)))) throw Error('現在の除外条件に合わない料理が含まれます。献立を作り直してください。');
  const recipe = byId.get(recipeId);
  if (!recipe) throw Error('除外条件に合う料理を選んでください。');
  const current = plan.days[dayIndex], local = calendarDaySettings(plan.settings, current);
  if (activeRecipeIds(current).includes(recipeId)) throw Error('この料理はすでに献立に入っています。');
  if (current.recipeIds.length >= 50 && !current.recipeIds.includes(recipeId)) throw Error('1食に追加できる料理は50品までです。');
  const quantity = options.quantity ?? current.quantities?.[recipeId] ?? calendarQuantity(recipe, local, data);
  if (!finitePositive(quantity) || quantity > 1000) throw Error('料理の量は基準量の1000倍以内で指定してください。');
  const recipeIds = current.recipeIds.includes(recipeId) ? [...current.recipeIds] : [...current.recipeIds, recipeId];
  const reasons = unique([...(current.proposedReasons ?? current.reasons ?? []), 'この食事に選んだ料理を追加しています。']);
  const day = omissionNotes({...current, recipeIds, quantities: {...current.quantities, [recipeId]: quantity},
    omittedRecipeIds: (current.omittedRecipeIds ?? []).filter(id => id !== recipeId), reasons, proposedReasons: reasons}, data);
  const days = plan.days.map((entry, index) => index === dayIndex ? day : structuredClone(entry));
  return {...plan, days, genreSummary: summariseGenres(plan.settings, days, data)};
}

/** 一度に作った献立のうち、選んだ1食の添える主食と量だけを変更します。 */
export function updatePlanStaple(plan, {dayIndex, stapleId, amount = null} = {}, data) {
  if (!plan?.ok || plan.mode !== 'calendar' || !Array.isArray(plan.days) || !plan.settings) throw new Error('先にカレンダー用の献立を作成してください。');
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= plan.days.length) throw new Error('主食を調整する食事を選んでください。');
  if (typeof stapleId !== 'string' || stapleId === 'auto') throw new Error('変更する主食か「付けない」を選んでください。');
  const selectedAmount = calendarAmount(amount, '主食の量');
  const settings = {...normaliseSettings(plan.settings, data, {allowSnack: true}), ...calendarStapleSettings(plan.settings),
    drinkId: plan.settings.drinkId ?? 'none', drinkAmount: plan.settings.drinkAmount ?? null};
  const safe = eligibleRecipes(settings, data), byId = new Map(safe.map(recipe => [recipe.id, recipe]));
  for (const day of plan.days) {
    activeRecipeIds(day);
    if (day.recipeIds.some(id => !byId.has(id))) throw new Error('現在の除外条件に合わない料理が献立に含まれます。献立全体を作り直してください。');
    if (day.recipeIds.some(id => day.quantities?.[id] !== undefined && (!finitePositive(day.quantities[id]) || day.quantities[id] > 1000))) throw new Error('献立の量を確認してください。');
  }
  const current = plan.days[dayIndex], recipes = current.recipeIds.map(id => byId.get(id));
  if (current.meal === 'snack' || recipes.some(recipe => recipe.staple && isCompleteMeal(recipe)) || !recipes.some(recipe => recipe.role === 'main' && !recipe.staple)) {
    throw new Error('主食を含む一品料理や間食では、別の主食を追加しません。量は記録した食事から調整できます。');
  }
  const chosen = stapleId === 'none' ? null : byId.get(stapleId);
  if (stapleId !== 'none' && (!chosen || chosen.role !== 'staple' || isCompleteMeal(chosen))) {
    throw new Error('除外条件に合う、添える主食を選んでください。麺や丼などの一品料理は重ねて追加できません。');
  }
  const local = {...calendarDaySettings(settings, current), stapleId, stapleMode: chosen ? 'fixed' : 'adaptive', stapleAmount: chosen ? selectedAmount : null};
  const quantity = chosen ? calendarQuantity(chosen, local, data) : null;
  const retained = recipes.filter(recipe => recipe.role !== 'staple');
  const recipeIds = [...retained.map(recipe => recipe.id), ...(chosen ? [chosen.id] : [])];
  const quantities = Object.fromEntries(retained.map(recipe => [recipe.id, current.quantities?.[recipe.id] ?? calendarQuantity(recipe, local, data)]));
  if (chosen) quantities[chosen.id] = quantity;
  const reasons = (current.proposedReasons ?? current.reasons ?? []).filter(message => !message.includes('主食の種類は食事区分'));
  reasons.push(chosen ? 'この食事の主食と量を個別に指定しています。' : 'この食事には主食を別に付けない設定です。');
  const changed = omissionNotes({...current, stapleId, stapleMode: local.stapleMode, stapleAmount: local.stapleAmount, recipeIds, quantities,
    omittedRecipeIds: (current.omittedRecipeIds ?? []).filter(id => retained.some(recipe => recipe.id === id)),
    proposedReasons: unique(reasons), reasons: unique(reasons)}, data);
  const days = plan.days.map((day, index) => index === dayIndex ? changed : structuredClone(day));
  return {...plan, days, genreSummary: summariseGenres(settings, days, data)};
}

export function toggleDish(plan, {dayIndex, recipeId} = {}, data) {
  if (!plan?.ok || !Array.isArray(plan.days) || !plan.settings) throw new Error('先に献立を作成してください。');
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= plan.days.length) throw new Error('変更する日を選んでください。');
  const settings = {...normaliseSettings(plan.settings, data, {allowSnack: plan.mode === 'calendar'}),
    ...(plan.mode === 'calendar' ? {...calendarStapleSettings(plan.settings), drinkId: plan.settings.drinkId ?? 'none', drinkAmount: plan.settings.drinkAmount ?? null} : {})};
  for (const day of plan.days) {
    activeRecipeIds(day);
    for (const id of day.recipeIds) {
      if (!allowed(describeRecipe(id, data), settings)) {
        return {ok: false, days: [], settings, missingRoles: [], warnings: ['現在の除外条件に合わない料理が献立に含まれます。新しい条件で献立全体を作り直してください。']};
      }
    }
  }
  const currentDay = plan.days[dayIndex];
  if (!currentDay.recipeIds.includes(recipeId)) throw new Error('変更する料理が見つかりません。');
  const omitted = new Set(currentDay.omittedRecipeIds ?? []);
  if (omitted.has(recipeId)) omitted.delete(recipeId);
  else omitted.add(recipeId);
  const days = plan.days.map((day, index) => index === dayIndex ? omissionNotes({...day, omittedRecipeIds: [...omitted]}, data) : {...day, recipeIds: [...day.recipeIds], omittedRecipeIds: [...(day.omittedRecipeIds ?? [])]});
  return {...plan, settings, days, genreSummary: summariseGenres(settings, days, data)};
}

export function shoppingList(plan, servings = plan?.settings?.servings ?? 2, data) {
  if (!plan?.ok || !Array.isArray(plan.days)) throw new Error('保存できる献立がありません。');
  if (!Number.isInteger(servings) || servings < 1 || servings > 8) throw new Error('人数は1〜8人の整数で指定してください。');
  const selected = constraints(plan.settings ?? {}, data);
  const items = new Map();
  for (const day of plan.days) {
    for (const id of activeRecipeIds(day)) {
      const recipe = describeRecipe(id, data);
      if (!allowed(recipe, selected)) throw new Error('除外条件に合わない料理を買い物リストに含めることはできません。献立を作り直してください。');
      for (const part of recipe.ingredients) {
        const key = `${part.id}:${part.unit}`;
        if (!items.has(key)) items.set(key, {id: part.id, name: part.name, unit: part.unit, amount: 0, allergens: [...part.allergens]});
        const quantity = day.quantities?.[id] ?? 1;
        if (!finitePositive(quantity) || quantity > 1000) throw new Error('献立の量を確認してください。');
        items.get(key).amount += part.amount * quantity * servings / recipe.servings;
      }
    }
  }
  return [...items.values()].map(item => ({...item, amount: Math.round(item.amount * 1000) / 1000}))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}
