// 材料の確認 → 食べられる候補 → 履歴との比較、の順に処理します。
// 食品群の回数は献立の組合せを考える目安です。栄養量の計算ではありません。
export const FOOD_GROUPS = ['staple', 'vegetable', 'protein', 'dairy', 'fruit'];
export const PROTEIN_SOURCES = ['meat', 'fish', 'egg', 'soy'];
const ROLES = ['main', 'side', 'soup', 'staple'];
const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
const SOURCE_LABELS = {meat: '肉', fish: '魚', egg: '卵', soy: '大豆'};
const ROLE_LABELS = {main: '主菜', side: '副菜', soup: '汁物', staple: '主食'};

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
  if (!recipe || typeof recipe.id !== 'string' || !recipe.id || typeof recipe.name !== 'string' || !recipe.name ||
      !ROLES.includes(recipe.role) || !finitePositive(recipe.servings) || !finitePositive(recipe.minutes) ||
      !Array.isArray(recipe.steps) || !recipe.steps.length || recipe.steps.some(step => typeof step !== 'string' || !step.trim()) ||
      !Array.isArray(recipe.ingredients) || !recipe.ingredients.length || typeof recipe.staple !== 'boolean') {
    throw new Error('料理の基本情報が不足しています。');
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
    allergens: unique(ingredients.flatMap(item => item.allergens)),
    groups: unique(ingredients.flatMap(item => item.groups)),
    proteinSources: unique(ingredients.flatMap(item => item.proteinSources)),
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
  return !recipe.allergens.some(id => selected.allergens.includes(id)) &&
    !recipe.ingredients.some(item => [item.id, ...item.ancestorIds].some(id => selected.excludedIngredients.includes(id)));
}

export function eligibleRecipes(settings, data, {role = null} = {}) {
  const selected = constraints(settings, data);
  if (role !== null && !ROLES.includes(role)) throw new Error('料理の種類を確認してください。');
  return catalogue(data).recipes.filter(recipe => (!role || recipe.role === role) && allowed(recipe, selected));
}

function normaliseSettings(settings, data) {
  const selected = constraints(settings, data);
  const startDate = settings.startDate ?? localToday();
  const days = settings.days ?? 3;
  const servings = settings.servings ?? 2;
  const meal = settings.meal ?? 'dinner';
  if (!validDate(startDate)) throw new Error('開始日は有効な年月日で指定してください。');
  if (!Number.isInteger(days) || days < 1 || days > 7) throw new Error('日数は1〜7日の整数で指定してください。');
  if (!Number.isInteger(servings) || servings < 1 || servings > 8) throw new Error('人数は1〜8人の整数で指定してください。');
  if (!MEALS.slice(0, 3).includes(meal)) throw new Error('朝食・昼食・夕食から選んでください。');
  if (!Array.isArray(settings.history ?? [])) throw new Error('食事履歴を確認してください。');
  const preferences = settings.preferences ?? {};
  if (typeof preferences !== 'object' || preferences === null || Array.isArray(preferences)) throw new Error('好みの設定を確認してください。');
  const genre = preferences.genre ?? 'all';
  if (typeof genre !== 'string') throw new Error('料理ジャンルを確認してください。');
  if (preferences.maxMinutes != null && (!finitePositive(preferences.maxMinutes) || preferences.maxMinutes > 240)) {
    throw new Error('所要時間の目安は1〜240分の範囲にしてください。');
  }
  const preferredIngredients = ingredientIds(preferences.preferredIngredients ?? [], data, '優先食材');
  const seed = settings.seed ?? 1;
  if (!['number', 'string'].includes(typeof seed) || (typeof seed === 'number' && !Number.isFinite(seed))) throw new Error('乱数の設定を確認してください。');
  return {...selected, startDate, days, servings, meal, seed,
    preferences: {genre, maxMinutes: preferences.maxMinutes ?? null, preferredIngredients},
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
  const fresh = candidates.filter(recipe => !history.recipeCounts[recipe.id] && !context.used.has(recipe.id));
  const pool = fresh.length ? fresh : candidates;
  const genreSpecified = !['all', 'any', 'おまかせ', '指定なし', ''].includes(settings.preferences.genre);
  const score = recipe => {
    let value = tieBreak(settings.seed, `${date}:${role}:${recipe.id}`);
    value -= (history.recipeCounts[recipe.id] ?? 0) * 25;
    value -= context.used.has(recipe.id) ? 60 : 0;
    if (genreSpecified && recipe.genre === settings.preferences.genre) value += 8;
    if (settings.preferences.maxMinutes && recipe.minutes <= settings.preferences.maxMinutes) value += 5;
    value += recipe.ingredients.filter(item => settings.preferences.preferredIngredients.includes(item.id)).length * 4;
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

function dayNotes(selected, history, settings, {recordedHistory = history.hasTaggedData, earlierPlans = false} = {}) {
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
  const genre = settings.preferences.genre;
  if (!['all', 'any', 'おまかせ', '指定なし', ''].includes(genre) && main?.genre !== genre) {
    warnings.push('希望ジャンル以外の主菜を選びました。アレルゲンと除外食材の条件は維持しています。');
  }
  if (settings.preferences.maxMinutes && selected.some(recipe => recipe.minutes > settings.preferences.maxMinutes)) {
    warnings.push('希望した所要時間を超える料理を含みます。');
  }
  return {reasons: unique(reasons), warnings: unique(warnings)};
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
  const warnings = catalog.invalidIds.length ? [`材料・手順・確認情報が不足する${catalog.invalidIds.length}品は提案から除外しました。`] : [];
  if (missing.length) return incomplete(normalised, missing, warnings);
  const result = [];
  const historyEntries = [...(settings.history ?? [])];
  const used = new Set();
  let lastSources = [];
  for (let index = 0; index < normalised.days; index++) {
    const date = nextDate(normalised.startDate, index);
    const history = analyseHistory(historyEntries, {beforeDate: date, days: 7, beforeMeal: normalised.meal}, data);
    const context = {used, groups: new Set(), lastSources};
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
    const notes = dayNotes(selected, history, normalised, {recordedHistory: recorded.hasTaggedData, earlierPlans: index > 0});
    result.push({date, meal: normalised.meal, recipeIds: selected.map(recipe => recipe.id), ...notes});
    lastSources = main.proteinSources;
    historyEntries.push({date, meal: normalised.meal, recipeIds: selected.map(recipe => recipe.id)});
  }
  return {ok: true, days: result, settings: normalised, missingRoles: [], warnings};
}

export function replaceRecipe(plan, options = {}, data) {
  if (!plan?.ok || !Array.isArray(plan.days) || !plan.settings) throw new Error('先に献立を作成してください。');
  const dayIndex = options.dayIndex;
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= plan.days.length) throw new Error('差し替える日を選んでください。');
  const settings = normaliseSettings({...plan.settings, ...options}, data);
  const {recipes, invalidIds} = catalogue(data);
  const safe = recipes.filter(recipe => allowed(recipe, settings));
  const safeById = new Map(safe.map(recipe => [recipe.id, recipe]));
  // 設定変更後に古い献立へ差し替えを行っても、危険な古い料理を残しません。
  if (plan.days.some(day => !Array.isArray(day.recipeIds) || day.recipeIds.some(id => !safeById.has(id)))) {
    return {ok: false, days: [], settings, missingRoles: [], warnings: ['現在の除外条件に合わない料理が献立に含まれます。新しい条件で献立全体を作り直してください。']};
  }
  const currentDay = plan.days[dayIndex];
  if (!currentDay.recipeIds.includes(options.recipeId)) throw new Error('差し替える料理が見つかりません。');
  const previous = safeById.get(options.recipeId);
  const main = currentDay.recipeIds.map(id => safeById.get(id)).find(recipe => recipe.role === 'main');
  const otherDays = plan.days.filter((_, index) => index !== dayIndex)
    .map(day => ({date: day.date, meal: day.meal, recipeIds: day.recipeIds}));
  const history = analyseHistory([...(options.history ?? []), ...otherDays],
    {beforeDate: currentDay.date, days: 7, beforeMeal: currentDay.meal}, data);
  const used = new Set(plan.days.flatMap(day => day.recipeIds));
  const others = currentDay.recipeIds.filter(id => id !== previous.id).map(id => safeById.get(id));
  let pool = safe.filter(recipe => recipe.role === previous.role && recipe.id !== previous.id);
  if (previous.role === 'main') {
    const hasStaple = safe.some(recipe => recipe.role === 'staple');
    pool = pool.filter(recipe => recipe.staple || hasStaple);
  }
  if (previous.role === 'staple' && main?.staple) pool = [];
  if (!pool.length) {
    return {...plan, settings, warnings: unique([...(plan.warnings ?? []), '除外条件に合う別の料理がないため、現在の料理を維持しました。条件外の料理には差し替えていません。'])};
  }
  const selected = pick(pool, settings, history, {used, groups: new Set(others.flatMap(recipe => recipe.groups)), lastSources: []}, currentDay.date, previous.role);
  let newRecipes = currentDay.recipeIds.map(id => id === previous.id ? selected : safeById.get(id));
  if (previous.role === 'main') {
    newRecipes = newRecipes.filter(recipe => recipe.role !== 'staple');
    if (!selected.staple) {
      const rice = safe.find(recipe => recipe.role === 'staple' && recipe.id === 'plain-rice') ?? safe.find(recipe => recipe.role === 'staple');
      if (!rice) return incomplete(settings, ['staple']);
      newRecipes.push(rice);
    }
  }
  const recorded = analyseHistory(options.history ?? [], {beforeDate: currentDay.date, days: 7, beforeMeal: currentDay.meal}, data);
  const earlierPlans = otherDays.some(day => day.date < currentDay.date);
  const newDay = {...currentDay, recipeIds: newRecipes.map(recipe => recipe.id),
    ...dayNotes(newRecipes, history, settings, {recordedHistory: recorded.hasTaggedData, earlierPlans})};
  return {ok: true, settings, missingRoles: [], warnings: invalidIds.length ? [`確認情報が不足する${invalidIds.length}品は候補に含めていません。`] : [],
    days: plan.days.map((day, index) => index === dayIndex ? newDay : {...day, recipeIds: [...day.recipeIds]}),
  };
}

export function shoppingList(plan, servings = plan?.settings?.servings ?? 2, data) {
  if (!plan?.ok || !Array.isArray(plan.days)) throw new Error('保存できる献立がありません。');
  if (!Number.isInteger(servings) || servings < 1 || servings > 8) throw new Error('人数は1〜8人の整数で指定してください。');
  const selected = constraints(plan.settings ?? {}, data);
  const items = new Map();
  for (const day of plan.days) {
    for (const id of day.recipeIds) {
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
