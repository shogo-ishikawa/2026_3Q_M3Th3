import {recipeNutrition} from './nutrition.js';

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
  if (!recipe || typeof recipe.id !== 'string' || !recipe.id || typeof recipe.name !== 'string' || !recipe.name.trim() ||
      !ROLES.includes(recipe.role) || !finitePositive(recipe.servings) || !finitePositive(recipe.minutes) ||
      !Array.isArray(recipe.steps) || (!custom && !recipe.steps.length) || recipe.steps.some(step => typeof step !== 'string' || !step.trim()) ||
      !Array.isArray(recipe.ingredients) || (!custom && !recipe.ingredients.length) || typeof recipe.staple !== 'boolean') {
    throw new Error('料理の基本情報が不足しています。');
  }
  if (custom && ((recipe.allergensKnown !== undefined && typeof recipe.allergensKnown !== 'boolean') ||
      (recipe.ingredientsKnown !== undefined && typeof recipe.ingredientsKnown !== 'boolean') ||
      !Array.isArray(recipe.allergens ?? []) || (recipe.allergens ?? []).some(id => !knownAllergens.has(id)) ||
      !Array.isArray(recipe.groups ?? []) || (recipe.groups ?? []).some(group => !FOOD_GROUPS.includes(group)) ||
      !Array.isArray(recipe.proteinSources ?? []) || (recipe.proteinSources ?? []).some(source => !PROTEIN_SOURCES.includes(source)))) {
    throw new Error('手入力した料理の確認情報を確認してください。');
  }
  if (custom && recipe.manualNutrition !== undefined &&
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
    steps: recipe.steps.length ? [...recipe.steps] : ['調理方法は未登録です。'],
    allergensKnown: custom ? recipe.allergensKnown === true : true,
    ingredientsKnown: custom ? recipe.ingredientsKnown === true && ingredients.length > 0 : true,
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
  return recipe.allergensKnown !== false &&
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
  if (!(allowSnack ? MEALS : MEALS.slice(0, 3)).includes(meal)) throw new Error(allowSnack ? '朝食・昼食・夕食・間食から選んでください。' : '朝食・昼食・夕食から選んでください。');
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

function genreSchedule(settings) {
  const preferences = settings.preferences;
  if (preferences.genreMode === 'any') return Array(settings.days).fill(null);
  if (preferences.genreMode === 'single') return Array(settings.days).fill(preferences.genre);
  const targets = allocateGenreCounts(settings.days, preferences.genreRatios);
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
      if (recipe.role !== 'main') continue;
      if (!active.has(id)) omittedMainCount++;
      else if (GENRES.includes(recipe.genre)) actual[recipe.genre]++;
    }
  }
  const mode = settings.preferences.genreMode;
  const targets = mode === 'ratio' ? allocateGenreCounts(settings.days, settings.preferences.genreRatios) : emptyCounts(GENRES);
  if (mode === 'single') targets[settings.preferences.genre] = settings.days;
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
  return [...pool].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0];
}

function incomplete(settings, roles, warnings = []) {
  const missingRoles = unique(roles);
  return {ok: false, days: [], settings, missingRoles,
    warnings: [...warnings, `除外条件を保ったまま${missingRoles.map(role => ROLE_LABELS[role]).join('・')}を用意できませんでした。条件外の料理で埋めていません。`],
  };
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

function dayNotes(selected, history, settings, {recordedHistory = history.hasTaggedData, earlierPlans = false, targetGenre = null} = {}) {
  const reasons = [];
  const warnings = [];
  const groups = unique(selected.flatMap(recipe => recipe.groups));
  const main = selected.find(recipe => recipe.role === 'main');
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
  if (targetGenre && main?.genre !== targetGenre) {
    warnings.push(`希望ジャンル以外の主菜を選びました。目標の「${targetGenre}」に選べる候補がないため「${main?.genre ?? 'その他'}」にしています。アレルゲンと除外食材の条件は維持しています。`);
  }
  const mood = settings.preferences.mood;
  if (mood !== 'all') {
    if (selected.some(recipe => recipe.role !== 'staple' && (recipe.tags ?? []).includes(mood))) {
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
  const safe = catalog.recipes.filter(recipe => allowed(recipe, normalised));
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
function calendarEvidence(entries, date, meal, data) {
  const from = nextDate(date, -6);
  const filtered = entries.filter(entry => entry && entry.status === 'eaten' && validDate(entry.date) &&
    MEALS.includes(entry.meal) && entry.date >= from && entry.date <= date &&
    (entry.date !== date || MEALS.indexOf(entry.meal) < MEALS.indexOf(meal)));
  const meals = new Map();
  const values = Object.fromEntries(NUTRIENTS.map(key => [key, null]));
  const knownCounts = emptyCounts(NUTRIENTS);
  const knownDates = Object.fromEntries(NUTRIENTS.map(key => [key, new Set()]));
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
    for (const item of items) {
      if (!item || !finitePositive(item.quantity)) continue;
      itemCount++;
      if (entry.date === date) todayItemCount++;
      (item.groups ?? []).filter(group => FOOD_GROUPS.includes(group)).forEach(group => tags.groups.add(group));
      (item.proteinSources ?? []).filter(source => PROTEIN_SOURCES.includes(source)).forEach(source => tags.sources.add(source));
      if (typeof item.recipeId === 'string') tags.recipes.add(item.recipeId);
      for (const key of NUTRIENTS) {
        const amount = item.nutrition?.[key];
        if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) continue;
        const total = amount * item.quantity;
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
  const basis = {from, untilDate: date, beforeMeal: meal, entryCount: filtered.length, itemCount,
    values, knownCounts,
    complete: Object.fromEntries(NUTRIENTS.map(key => [key, itemCount > 0 && knownCounts[key] === itemCount])),
    dailyMeans: Object.fromEntries(NUTRIENTS.map(key => [key, knownDates[key].size ? values[key] / knownDates[key].size : null])),
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

function calendarNutrientScore(recipe, basis, targets, selected, data, meal) {
  const nutrition = recipeNutrition(recipe, data);
  const share = {breakfast: 0.25, lunch: 0.35, dinner: 0.35, snack: 0.1}[meal];
  let score = 0;
  for (const key of ['kcal', 'salt', 'protein', 'fiber']) {
    const target = targets[key];
    if (target === undefined || basis.dailyMeans[key] === null) continue;
    const amount = nutrition[key];
    // 不明な栄養量を0とみなして「少ない料理」として優先しません。
    if (amount === null || amount === undefined) { score -= 20; continue; }
    if (key === 'kcal' || key === 'salt') {
      const selectedValues = selected.map(item => recipeNutrition(item, data)[key]);
      const already = (basis.today.values[key] ?? 0) + selectedValues.filter(value => value !== null && value !== undefined).reduce((sum, value) => sum + value, 0);
      const available = Math.max(0, target - already);
      const denominator = Math.max(target, 1);
      const excess = Math.max(0, amount - available) / denominator;
      const previousExcess = target === 0 ? (basis.dailyMeans[key] > 0 ? 1 : 0) : Math.max(0, basis.dailyMeans[key] / target - 1);
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
  const notes = dayNotes(selected, history, settings, {recordedHistory: history.hasTaggedData, targetGenre});
  if (meal === 'snack') {
    notes.reasons = notes.reasons.filter(message => !message.includes('野菜を使う料理'));
    notes.warnings = notes.warnings.filter(message => !/野菜の食品群|たんぱく源の食品群|主食の食品群|希望ジャンル/.test(message));
    notes.reasons.push('間食として食べる量を調整しやすい1品を選んでいます。');
  }
  const nutrientLabels = {kcal: 'エネルギー', salt: '食塩相当量', protein: 'たんぱく質', fiber: '食物繊維'};
  if (!basis.itemCount) {
    notes.reasons.push('この食事より前の7日間に食べた記録がないため、栄養量による比較は行っていません。');
  } else {
    notes.reasons.push(`${basis.from}からこの食事の直前までに「食べた」と記録した${basis.entryCount}件を比較しました。予定の食事は摂取量に含めていません。`);
    const lower = ['kcal', 'salt'].filter(key => targets[key] !== undefined && basis.dailyMeans[key] !== null &&
      (basis.dailyMeans[key] > targets[key] || (basis.today.values[key] ?? 0) >= targets[key]));
    const higher = ['protein', 'fiber'].filter(key => targets[key] && basis.dailyMeans[key] !== null &&
      basis.dailyMeans[key] < targets[key] && selected.some(recipe => (recipeNutrition(recipe, data)[key] ?? 0) > 0));
    if (lower.length) notes.reasons.push(`登録された${lower.map(key => nutrientLabels[key]).join('・')}が比較値を上回るため、量が分かる候補の中で控えめな組合せを優先しました。`);
    if (higher.length) notes.reasons.push(`記録された範囲で${higher.map(key => nutrientLabels[key]).join('・')}の1日平均が比較値より少ないため、これらを含む候補を優先しました。`);
    if (NUTRIENTS.some(key => !basis.complete[key])) notes.warnings.push('記録の一部に未登録の栄養量があります。比較は分かる範囲の参考値です。');
  }
  if (selected.some(recipe => NUTRIENTS.some(key => recipeNutrition(recipe, data)[key] == null))) {
    notes.warnings.push('この献立には栄養量が未登録の項目があります。0として計算していません。');
  }
  if (selected.some(recipe => recipe.ingredientsKnown === false)) notes.warnings.push('材料が未登録の料理があります。買い物リストだけでは必要な材料を確認できません。');
  return {reasons: unique(notes.reasons), warnings: unique(notes.warnings)};
}

export function generateCalendarPlan(settings = {}, data, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('カレンダーの提案条件を確認してください。');
  const meal = options.meal ?? settings.meal ?? 'dinner';
  const stapleId = options.stapleId ?? settings.stapleId ?? 'auto';
  const drinkId = options.drinkId ?? settings.drinkId ?? 'none';
  const normalised = {...normaliseSettings({...settings, meal}, data, {allowSnack: true}), stapleId, drinkId};
  if (typeof stapleId !== 'string' || typeof drinkId !== 'string') throw new Error('主食と飲み物の選択を確認してください。');
  const entries = options.entries ?? [];
  if (!Array.isArray(entries)) throw new Error('カレンダーの食事記録を確認してください。');
  const targets = comparisonTargets(options.targets);
  const pantry = options.pantry ?? [];
  if (!Array.isArray(pantry) || pantry.some(part => !part || typeof part.id !== 'string' ||
      !Object.hasOwn(data.ingredients, part.id) || typeof part.amount !== 'number' || !Number.isFinite(part.amount) || part.amount < 0)) {
    throw new Error('手持ち食材の分量を確認してください。');
  }
  const catalog = catalogue(data);
  const safe = catalog.recipes.filter(recipe => allowed(recipe, normalised));
  const byRole = Object.fromEntries(ROLES.map(role => [role, safe.filter(recipe => recipe.role === role)]));
  const warnings = [...preferenceWarnings(normalised, data),
    ...(catalog.invalidIds.length ? [`材料・手順・確認情報が不足する${catalog.invalidIds.length}品は提案から除外しました。`] : [])];
  const unavailableSelection = (id, role) => !['none', 'auto'].includes(id) && !byRole[role].some(recipe => recipe.id === id);
  if ((meal !== 'snack' && unavailableSelection(stapleId, 'staple')) || unavailableSelection(drinkId, 'drink')) {
    return {...incomplete(normalised, [meal !== 'snack' && unavailableSelection(stapleId, 'staple') ? 'staple' : 'drink'], warnings), mode: 'calendar',
      warnings: [...warnings, '指定した主食または飲み物を用意できません。登録内容と除外条件を確認してください。']};
  }
  let mains = byRole.main;
  if (!['none', 'auto'].includes(stapleId)) mains = mains.filter(recipe => !recipe.staple);
  else if (stapleId === 'auto') mains = mains.filter(recipe => recipe.staple || byRole.staple.length);
  const missing = meal === 'snack' ? (byRole.snack.length ? [] : ['snack']) : ['side', 'soup'].filter(role => !byRole[role].length);
  if (meal !== 'snack' && !mains.length) missing.push(byRole.main.length && stapleId === 'auto' ? 'staple' : 'main');
  if (drinkId === 'auto' && !byRole.drink.length) missing.push('drink');
  if (missing.length) {
    const failed = {...incomplete(normalised, missing, warnings), mode: 'calendar'};
    if (meal !== 'snack' && !['auto', 'none'].includes(stapleId) && byRole.main.length && !mains.length) {
      failed.warnings.push('指定した主食と重複しない主菜がありません。主食を含まない主菜を追加するか、主食の指定を変更してください。');
    }
    return failed;
  }
  const days = [];
  const used = new Set();
  const genres = genreSchedule(normalised);
  let lastSources = [];
  for (let index = 0; index < normalised.days; index++) {
    const date = nextDate(normalised.startDate, index);
    const evidence = calendarEvidence(entries, date, meal, data);
    const selected = [];
    const context = {used, groups: new Set(), lastSources, targetGenre: genres[index], scoreRecipe: recipe =>
      calendarNutrientScore(recipe, evidence.basis, targets, selected, data, meal) +
      recipe.ingredients.filter(part => pantry.some(stock => stock.id === part.id && stock.amount > 0)).length * 3};
    const add = recipe => {
      if (!recipe || selected.some(item => item.id === recipe.id)) return;
      selected.push(recipe); used.add(recipe.id); recipe.groups.forEach(group => context.groups.add(group));
    };
    if (meal === 'snack') add(pick(byRole.snack, normalised, evidence.history, context, date, 'snack'));
    else {
      const main = pick(mains, normalised, evidence.history, context, date, 'main');
      add(main);
      add(pick(byRole.side, normalised, evidence.history, context, date, 'side'));
      add(pick(byRole.soup, normalised, evidence.history, context, date, 'soup'));
      if (!main.staple && stapleId !== 'none') add(stapleId === 'auto' ?
        pick(byRole.staple, normalised, evidence.history, context, date, 'staple') : byRole.staple.find(recipe => recipe.id === stapleId));
      lastSources = main.proteinSources;
    }
    if (drinkId !== 'none') add(drinkId === 'auto' ? pick(byRole.drink, normalised, evidence.history, context, date, 'drink') :
      byRole.drink.find(recipe => recipe.id === drinkId));
    const notes = calendarNotes(selected, evidence, normalised, targets, genres[index], meal, data);
    if (stapleId === 'none' && meal !== 'snack' && !selected.some(recipe => recipe.staple)) {
      notes.warnings = notes.warnings.filter(message => !message.includes('主食の食品群'));
      notes.reasons.push('主食を別に付けない設定で提案しています。');
    }
    if (selected.some(recipe => recipe.ingredients.some(part => pantry.some(stock => stock.id === part.id && stock.amount > 0)))) {
      notes.reasons.push('手持ちの食材を使う候補に優先度を付けています。');
    }
    days.push({date, meal, targetGenre: genres[index], recipeIds: selected.map(recipe => recipe.id), omittedRecipeIds: [],
      ...notes, proposedReasons: [...notes.reasons], proposedWarnings: [...notes.warnings], nutritionBasis: evidence.basis});
  }
  return {ok: true, mode: 'calendar', settings: normalised, days, missingRoles: [], warnings,
    genreSummary: summariseGenres(normalised, days, data)};
}

export function replaceRecipe(plan, options = {}, data) {
  if (!plan?.ok || !Array.isArray(plan.days) || !plan.settings) throw new Error('先に献立を作成してください。');
  const dayIndex = options.dayIndex;
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= plan.days.length) throw new Error('差し替える日を選んでください。');
  const settings = {...normaliseSettings({...plan.settings, ...options}, data, {allowSnack: plan.mode === 'calendar'}),
    ...(plan.mode === 'calendar' ? {stapleId: plan.settings.stapleId ?? 'auto', drinkId: plan.settings.drinkId ?? 'none'} : {})};
  const {recipes, invalidIds} = catalogue(data);
  const safe = recipes.filter(recipe => allowed(recipe, settings));
  const safeById = new Map(safe.map(recipe => [recipe.id, recipe]));
  // 設定変更後に古い献立へ差し替えを行っても、危険な古い料理を残しません。
  if (plan.days.some(day => !Array.isArray(day.recipeIds) || day.recipeIds.some(id => !safeById.has(id)))) {
    return {ok: false, days: [], settings, missingRoles: [], warnings: ['現在の除外条件に合わない料理が献立に含まれます。新しい条件で献立全体を作り直してください。']};
  }
  const currentDay = plan.days[dayIndex];
  activeRecipeIds(currentDay);
  if (!currentDay.recipeIds.includes(options.recipeId)) throw new Error('差し替える料理が見つかりません。');
  if ((currentDay.omittedRecipeIds ?? []).includes(options.recipeId)) throw new Error('今回は作らない料理は、戻してから差し替えてください。');
  const previous = safeById.get(options.recipeId);
  const main = currentDay.recipeIds.map(id => safeById.get(id)).find(recipe => recipe.role === 'main');
  const otherDays = plan.days.filter((_, index) => index !== dayIndex)
    .map(day => ({date: day.date, meal: day.meal, recipeIds: activeRecipeIds(day)}));
  const evidence = plan.mode === 'calendar' ? calendarEvidence(options.entries ?? [], currentDay.date, currentDay.meal, data) : null;
  const history = evidence?.history ?? analyseHistory([...(options.history ?? []), ...otherDays],
    {beforeDate: currentDay.date, days: 7, beforeMeal: currentDay.meal}, data);
  const used = new Set(plan.days.flatMap(day => activeRecipeIds(day)));
  const others = activeRecipeIds(currentDay).filter(id => id !== previous.id).map(id => safeById.get(id));
  const targetGenre = currentDay.targetGenre ?? genreSchedule(settings)[dayIndex];
  let pool = safe.filter(recipe => recipe.role === previous.role && recipe.id !== previous.id);
  if (previous.role === 'main') {
    const hasStaple = safe.some(recipe => recipe.role === 'staple');
    pool = pool.filter(recipe => plan.mode === 'calendar' && settings.stapleId === 'none' ? true :
      plan.mode === 'calendar' && !['auto', 'none'].includes(settings.stapleId) ? !recipe.staple : recipe.staple || hasStaple);
  }
  if (previous.role === 'staple' && main?.staple) pool = [];
  if (!pool.length) {
    return {...plan, settings, genreSummary: summariseGenres(settings, plan.days, data),
      warnings: unique([...(plan.warnings ?? []), ...preferenceWarnings(settings, data), '除外条件に合う別の料理がないため、現在の料理を維持しました。条件外の料理には差し替えていません。'])};
  }
  const context = {used, groups: new Set(others.flatMap(recipe => recipe.groups)), lastSources: [], targetGenre,
    ...(evidence ? {scoreRecipe: recipe => calendarNutrientScore(recipe, evidence.basis, comparisonTargets(options.targets), others, data, currentDay.meal)} : {})};
  const selected = pick(pool, settings, history, context, currentDay.date, previous.role);
  let newRecipes = currentDay.recipeIds.map(id => id === previous.id ? selected : safeById.get(id));
  if (previous.role === 'main') {
    newRecipes = newRecipes.filter(recipe => recipe.role !== 'staple');
    if (!selected.staple && !(plan.mode === 'calendar' && settings.stapleId === 'none')) {
      const desired = plan.mode === 'calendar' && !['auto', 'none'].includes(settings.stapleId) ? settings.stapleId : 'plain-rice';
      const rice = safe.find(recipe => recipe.role === 'staple' && recipe.id === desired) ??
        (desired === 'plain-rice' ? safe.find(recipe => recipe.role === 'staple') : null);
      if (!rice) return incomplete(settings, ['staple']);
      newRecipes.push(rice);
    }
  }
  if (plan.mode === 'calendar' && previous.role === 'staple') settings.stapleId = selected.id;
  if (plan.mode === 'calendar' && previous.role === 'drink') settings.drinkId = selected.id;
  const recorded = analyseHistory(options.history ?? [], {beforeDate: currentDay.date, days: 7, beforeMeal: currentDay.meal}, data);
  const earlierPlans = otherDays.some(day => day.date < currentDay.date);
  const notes = plan.mode === 'calendar' ? calendarNotes(newRecipes,
    evidence, settings, comparisonTargets(options.targets), targetGenre, currentDay.meal, data) :
    dayNotes(newRecipes, history, settings, {recordedHistory: recorded.hasTaggedData, earlierPlans, targetGenre});
  const recipeIds = newRecipes.map(recipe => recipe.id);
  const newDay = omissionNotes({...currentDay, targetGenre, recipeIds, ...(evidence ? {nutritionBasis: evidence.basis} : {}),
    omittedRecipeIds: (currentDay.omittedRecipeIds ?? []).filter(id => recipeIds.includes(id)),
    ...notes, proposedReasons: [...notes.reasons], proposedWarnings: [...notes.warnings]}, data);
  const days = plan.days.map((day, index) => index === dayIndex ? newDay : {...day, recipeIds: [...day.recipeIds], omittedRecipeIds: [...(day.omittedRecipeIds ?? [])]});
  return {ok: true, ...(plan.mode ? {mode: plan.mode} : {}), settings, missingRoles: [],
    warnings: [...preferenceWarnings(settings, data), ...(invalidIds.length ? [`確認情報が不足する${invalidIds.length}品は候補に含めていません。`] : [])],
    days, genreSummary: summariseGenres(settings, days, data)};
}

export function toggleDish(plan, {dayIndex, recipeId} = {}, data) {
  if (!plan?.ok || !Array.isArray(plan.days) || !plan.settings) throw new Error('先に献立を作成してください。');
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= plan.days.length) throw new Error('変更する日を選んでください。');
  const settings = {...normaliseSettings(plan.settings, data, {allowSnack: plan.mode === 'calendar'}),
    ...(plan.mode === 'calendar' ? {stapleId: plan.settings.stapleId ?? 'auto', drinkId: plan.settings.drinkId ?? 'none'} : {})};
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
        items.get(key).amount += part.amount * servings / recipe.servings;
      }
    }
  }
  return [...items.values()].map(item => ({...item, amount: Math.round(item.amount * 1000) / 1000}))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}
