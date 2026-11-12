// 個人の食事記録とマイレシピは、このブラウザー内にだけ保存します。
import {STORAGE_KEY as LEGACY_KEY, defaultState, validateState, GROUP_IDS, PROTEIN_IDS, GENRES} from './storage.js';

export const JOURNAL_KEY = 'kondate-note-v2';
export const NUTRIENT_KEYS = ['kcal', 'protein', 'fat', 'carbs', 'fiber', 'salt'];
export const MEAL_IDS = ['breakfast', 'lunch', 'dinner', 'snack'];
export const ROLE_IDS = ['main', 'side', 'soup', 'staple', 'drink', 'snack'];
export const DEFAULT_TARGETS = Object.freeze({kcal: 2000, protein: 60, fat: 65, carbs: 280, fiber: 20, salt: 6.5});
const MAX_BYTES = 2 * 1024 * 1024;
const LIMITS = {entries: 5000, items: 100, customRecipes: 500, pantry: 1000, shoppingChecks: 2000};
const SETTINGS_KEYS = ['startDate', 'days', 'servings', 'allergens', 'excludedIngredients', 'preferences', 'meal', 'stapleId', 'drinkId'];
const ITEM_KEYS = ['id', 'recipeId', 'name', 'quantity', 'nutrition', 'ingredients', 'groups', 'proteinSources', 'allergens', 'allergensKnown', 'ingredientsKnown', 'steps', 'role'];
const CUSTOM_KEYS = ['id', 'name', 'role', 'genre', 'minutes', 'servings', 'staple', 'ingredients', 'steps', 'manualNutrition', 'allergens', 'allergensKnown', 'ingredientsKnown', 'groups', 'proteinSources', 'custom'];
const INVALID_MESSAGE = '保存内容を読み込めませんでした。元の保存データはそのまま残っています。アレルギーと除外食材を選び直してください。バックアップがあれば「記録を読み込む」から取り込めます。';
const unknownNutrition = () => Object.fromEntries(NUTRIENT_KEYS.map(key => [key, null]));
const unique = values => [...new Set(values)];

export function dateIsValid(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 2000 && year <= 2100 && date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

const formatDate = (year, month, day) => `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const utcKey = date => formatDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());

export function dateKey(date = new Date()) {
  const result = formatDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
  if (!dateIsValid(result)) throw new Error('日付は2000年から2100年までで指定してください。');
  return result;
}

export function monthIsValid(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value) && dateIsValid(`${value}-01`);
}

export function shiftDate(value, count) {
  if (!dateIsValid(value) || !Number.isInteger(count) || Math.abs(count) > 36600) throw new Error('移動する日付と日数を確認してください。');
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  const result = utcKey(date);
  if (!dateIsValid(result)) throw new Error('日付は2000年から2100年までで指定してください。');
  return result;
}

export function monthCells(month) {
  if (!monthIsValid(month)) throw new Error('表示する月を確認してください。');
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCDate(1 - (date.getUTCDay() + 6) % 7);
  return Array.from({length: 42}, () => {
    const value = utcKey(date);
    date.setUTCDate(date.getUTCDate() + 1);
    return {date: value, inMonth: value.startsWith(`${month}-`)};
  });
}

export function entriesForDay(entries, date) {
  if (!Array.isArray(entries) || !dateIsValid(date)) return [];
  return entries.filter(entry => entry.date === date).sort((a, b) => MEAL_IDS.indexOf(a.meal) - MEAL_IDS.indexOf(b.meal));
}

export function defaultJournal(today = dateKey()) {
  if (!dateIsValid(today)) throw new Error('日付を確認してください。');
  return {version: 2, settings: {...defaultState(today).settings, meal: 'dinner', stapleId: 'auto', drinkId: 'none'}, entries: [], customRecipes: [], pantry: [], targets: {...DEFAULT_TARGETS}, shoppingChecks: []};
}

// JSON以外のオブジェクト、アクセサー、危険なキーをデータとして受け付けません。
// 検証前に参照をたどることで、直接のオブジェクト入力にも同じ制限を適用します。
function safeGraph(value, active = new Set(), depth = 0, budget = {nodes: 0}) {
  if (++budget.nodes > 150000 || depth > 16) throw new Error('保存データの構造が大きすぎます。');
  if (value === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof value)) return;
  if (typeof value !== 'object' || active.has(value)) throw new Error('保存データの形式を確認してください。');
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw new Error('保存データの形式を確認してください。');
  if (Array.isArray(value) && value.length > 10000) throw new Error('保存データの件数が多すぎます。');
  active.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('保存データに使用できない項目があります。');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!Object.hasOwn(descriptor, 'value') || (key !== 'length' && !descriptor.enumerable)) throw new Error('保存データの形式を確認してください。');
    if (Array.isArray(value) && key !== 'length' && !/^(0|[1-9]\d*)$/.test(key)) throw new Error('保存データの配列を確認してください。');
    safeGraph(descriptor.value, active, depth + 1, budget);
  }
  active.delete(value);
}

function record(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error(`${label}に、このアプリで扱えない項目があります。`);
  return value;
}

function list(value, maximum, label) {
  if (!Array.isArray(value) || value.length > maximum || Object.keys(value).length !== value.length) throw new Error(`${label}の件数を確認してください。`);
  return value;
}

function text(value, maximum, label, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && !value.trim())) throw new Error(`${label}を確認してください。`);
  return value;
}

function identifier(value, label = '識別子') {
  text(value, 120, label);
  if (['__proto__', 'constructor', 'prototype'].includes(value)) throw new Error(`${label}を確認してください。`);
  return value;
}

function number(value, label, {zero = false, max = 1e7} = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (!zero && value === 0) || value > max) throw new Error(`${label}は${zero ? '0以上' : '0より大きい'}の数値で指定してください。`);
  return value;
}

function bool(value, fallback, label) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${label}を確認してください。`);
  return value;
}

function ids(value, allowed, label, fallback = []) {
  const source = value === undefined ? fallback : value;
  list(source, allowed.size, label);
  if (source.some(id => typeof id !== 'string' || !allowed.has(id))) throw new Error(`${label}に、このアプリで扱えない値があります。`);
  return unique(source);
}

function nutrition(value, optional = false) {
  if (value === undefined && optional) return unknownNutrition();
  record(value, NUTRIENT_KEYS, '栄養成分');
  return Object.fromEntries(NUTRIENT_KEYS.map(key => {
    const amount = value[key];
    if (amount === undefined && optional) return [key, null];
    return [key, amount === null ? null : number(amount, '栄養成分', {zero: true})];
  }));
}

function parts(value, ingredientIds, {historical = false} = {}) {
  const seen = new Set();
  return list(value, 300, '材料').map(part => {
    record(part, ['id', 'amount'], '材料');
    const id = identifier(part.id, '材料の識別子');
    if ((!historical && !ingredientIds.has(id)) || seen.has(id)) throw new Error('材料に不明な値や重複があります。');
    seen.add(id);
    return {id, amount: number(part.amount, '材料の分量')};
  });
}

function steps(value, fallback = []) {
  return list(value === undefined ? fallback : value, 50, '調理手順').map(step => text(step, 2000, '調理手順'));
}

function ingredientMetadata(parts, data) {
  const result = {allergens: [], groups: [], proteinSources: []};
  const visit = (id, trail = []) => {
    if (!Object.hasOwn(data.ingredients, id) || trail.includes(id)) throw new Error('材料の参照を確認してください。');
    const ingredient = data.ingredients[id];
    result.allergens.push(...(ingredient.allergens ?? []));
    for (const parent of ingredient.derivedFrom ?? []) visit(parent, [...trail, id]);
  };
  for (const part of parts) visit(part.id);
  // 食品群と主なたんぱく源は、調味料の原料までさかのぼって数えません。
  for (const part of parts) for (const key of ['groups', 'proteinSources']) result[key].push(...(data.ingredients[part.id][key] ?? []));
  return Object.fromEntries(Object.entries(result).map(([key, values]) => [key, unique(values)]));
}

function customRecipe(source, context) {
  record(source, CUSTOM_KEYS, 'マイレシピ');
  const id = identifier(source.id, 'マイレシピの識別子');
  if (!/^custom-.+/.test(id) || context.recipeIds.has(id) || context.customIds.has(id)) throw new Error('マイレシピの識別子が重複しているか、形式が異なります。');
  context.customIds.add(id);
  if (!ROLE_IDS.includes(source.role)) throw new Error('料理の種類を確認してください。');
  if (source.genre !== undefined && !GENRES.includes(source.genre)) throw new Error('料理のジャンルを確認してください。');
  if (source.servings !== undefined && source.servings !== 1) throw new Error('マイレシピの分量は1人分で登録してください。');
  if (source.custom !== undefined && source.custom !== true) throw new Error('マイレシピの形式を確認してください。');
  const ingredients = parts(source.ingredients ?? [], context.ingredientIds);
  const ingredientsKnown = bool(source.ingredientsKnown, false, '材料の確認状況');
  if (ingredientsKnown && !ingredients.length) throw new Error('材料を確認済みにする場合は、材料を登録してください。');
  const metadata = ingredientsKnown ? ingredientMetadata(ingredients, context.data) : {allergens: [], groups: [], proteinSources: []};
  return {id, name: text(source.name, 200, '料理名'), role: source.role, genre: source.genre ?? 'その他',
    minutes: number(source.minutes ?? 1, '調理時間', {max: 1440}), servings: 1,
    staple: bool(source.staple, source.role === 'staple', '主食の設定'), ingredients,
    steps: steps(source.steps === undefined || (Array.isArray(source.steps) && !source.steps.length) ? undefined : source.steps, ['調理方法は未登録です。']),
    manualNutrition: nutrition(source.manualNutrition, true),
    allergens: unique([...ids(source.allergens, context.allergenIds, 'アレルゲン'), ...metadata.allergens]),
    allergensKnown: bool(source.allergensKnown, false, 'アレルゲンの確認状況'), ingredientsKnown,
    groups: unique([...ids(source.groups, new Set(GROUP_IDS), '食品群'), ...metadata.groups]),
    proteinSources: unique([...ids(source.proteinSources, new Set(PROTEIN_IDS), '主な食材'), ...metadata.proteinSources]), custom: true};
}

function snapshot(source, context, itemIds) {
  record(source, ITEM_KEYS, '食事の内容');
  const id = identifier(source.id, '食事の内容の識別子');
  if (itemIds.has(id)) throw new Error('食事の内容の識別子が重複しています。');
  itemIds.add(id);
  if (source.recipeId !== null) identifier(source.recipeId, 'レシピの識別子');
  if (!ROLE_IDS.includes(source.role)) throw new Error('料理の種類を確認してください。');
  return {id, recipeId: source.recipeId, name: text(source.name, 200, '料理名'), quantity: number(source.quantity, '食べた量', {max: 1000}),
    nutrition: nutrition(source.nutrition), ingredients: parts(source.ingredients, context.ingredientIds, {historical: true}),
    groups: ids(source.groups, new Set(GROUP_IDS), '食品群'), proteinSources: ids(source.proteinSources, new Set(PROTEIN_IDS), '主な食材'),
    allergens: ids(source.allergens, context.allergenIds, 'アレルゲン'), allergensKnown: bool(source.allergensKnown, false, 'アレルゲンの確認状況'),
    ingredientsKnown: bool(source.ingredientsKnown, false, '材料の確認状況'), steps: steps(source.steps), role: source.role};
}

function settings(source, data, recipes) {
  record(source, SETTINGS_KEYS, '献立の設定');
  const legacy = Object.fromEntries(Object.entries(source).filter(([key]) => !['meal', 'stapleId', 'drinkId'].includes(key)));
  const clean = validateState({version: 1, settings: legacy, history: []}, data).settings;
  const meal = source.meal ?? 'dinner';
  const stapleId = source.stapleId ?? 'auto';
  const drinkId = source.drinkId ?? 'none';
  if (!MEAL_IDS.includes(meal) || (!['auto', 'none'].includes(stapleId) && !recipes.some(recipe => recipe.id === stapleId && recipe.role === 'staple')) || (drinkId !== 'none' && !recipes.some(recipe => recipe.id === drinkId && recipe.role === 'drink'))) throw new Error('食事区分・主食・飲み物の設定を確認してください。');
  return {...clean, meal, stapleId, drinkId};
}

function validateV2(value, data) {
  record(value, ['version', 'settings', 'entries', 'customRecipes', 'pantry', 'targets', 'shoppingChecks'], '保存データ');
  const context = {data, ingredientIds: new Set(Object.keys(data.ingredients)), recipeIds: new Set(data.recipes.map(recipe => recipe.id)), allergenIds: new Set(data.allergens.map(allergen => allergen.id)), customIds: new Set()};
  const customRecipes = list(value.customRecipes, LIMITS.customRecipes, 'マイレシピ').map(recipe => customRecipe(recipe, context));
  const recipes = [...data.recipes, ...customRecipes];
  const entryIds = new Set();
  const itemIds = new Set();
  const entries = list(value.entries, LIMITS.entries, '食事の記録').map(source => {
    record(source, ['id', 'date', 'meal', 'status', 'note', 'items'], '食事の記録');
    const id = identifier(source.id, '食事の記録の識別子');
    if (entryIds.has(id) || !dateIsValid(source.date) || !MEAL_IDS.includes(source.meal) || !['planned', 'eaten'].includes(source.status)) throw new Error('食事の記録の日付・食事区分・状態・識別子を確認してください。');
    entryIds.add(id);
    const items = list(source.items, LIMITS.items, '1回の食事の内容').map(item => snapshot(item, context, itemIds));
    const note = text(source.note ?? '', 2000, '食事のメモ', true);
    if (!items.length && !note.trim()) throw new Error('料理かメモを登録してください。');
    return {id, date: source.date, meal: source.meal, status: source.status, note, items};
  });
  const pantryIds = new Set();
  const pantry = list(value.pantry, LIMITS.pantry, '手持ちの食材').map(part => {
    record(part, ['id', 'amount'], '手持ちの食材');
    if (!context.ingredientIds.has(part.id) || pantryIds.has(part.id)) throw new Error('手持ちの食材に不明な値や重複があります。');
    pantryIds.add(part.id);
    return {id: part.id, amount: number(part.amount, '手持ちの量', {zero: true})};
  });
  record(value.targets, NUTRIENT_KEYS, '比較の目安');
  const targets = Object.fromEntries(NUTRIENT_KEYS.map(key => [key, number(value.targets[key], '比較の目安', {zero: key === 'salt', max: key === 'kcal' ? 20000 : 10000})]));
  const shoppingChecks = unique(list(value.shoppingChecks, LIMITS.shoppingChecks, '買い物のチェック').map(id => text(id, 200, '買い物の識別子')));
  return {version: 2, settings: settings(value.settings, data, recipes), entries, customRecipes, pantry, targets, shoppingChecks};
}

function legacyNutrition(recipe, data) {
  if (recipe.manualNutrition) return nutrition(recipe.manualNutrition, true);
  if (!Array.isArray(recipe.ingredients) || !recipe.ingredients.length || !(recipe.servings > 0)) return unknownNutrition();
  return Object.fromEntries(NUTRIENT_KEYS.map(key => {
    let total = 0;
    for (const part of recipe.ingredients) {
      const amount = data.ingredients[part.id]?.nutritionPerUnit?.[key];
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return [key, null];
      total += amount * part.amount / recipe.servings;
    }
    return [key, total];
  }));
}

function migrateV1(value, data) {
  record(value, ['version', 'settings', 'history'], '旧版の保存データ');
  record(value.settings, SETTINGS_KEYS.filter(key => !['meal', 'stapleId', 'drinkId'].includes(key)), '旧版の献立の設定');
  // 現在のDBから消えた料理の識別子も、過去の記録として残します。
  const missing = new Set();
  for (const entry of list(value.history, 1000, '旧版の食事の記録')) {
    record(entry, ['id', 'date', 'meal', 'recipeIds', 'groups', 'proteinSources', 'note'], '旧版の食事の記録');
    for (const id of list(entry.recipeIds, 300, '記録したレシピ')) { identifier(id); missing.add(id); }
  }
  const recipes = [...data.recipes, ...[...missing].filter(id => !data.recipes.some(recipe => recipe.id === id)).map(id => ({id}))];
  const legacy = validateState(value, {...data, recipes});
  const result = defaultJournal(legacy.settings.startDate);
  result.settings = {...legacy.settings, meal: 'dinner', stapleId: 'auto', drinkId: 'none'};
  result.entries = legacy.history.map((entry, entryIndex) => {
    const items = entry.recipeIds.map((id, index) => {
      const recipe = data.recipes.find(candidate => candidate.id === id);
      const ingredients = recipe?.ingredients?.map(part => ({id: part.id, amount: part.amount / recipe.servings})) ?? [];
      const metadata = recipe ? ingredientMetadata(ingredients, data) : {allergens: [], groups: [], proteinSources: []};
      return {id: `legacy-item-${entryIndex}-${index}`, recipeId: id, name: recipe?.name ?? `過去に記録した料理 (${id})`, quantity: 1,
        nutrition: recipe ? legacyNutrition(recipe, data) : unknownNutrition(), ingredients,
        groups: unique([...metadata.groups, ...(index === 0 ? entry.groups : [])]),
        proteinSources: unique([...metadata.proteinSources, ...(index === 0 ? entry.proteinSources : [])]),
        allergens: metadata.allergens, allergensKnown: !!recipe, ingredientsKnown: !!recipe && ingredients.length > 0,
        steps: recipe?.steps ?? [], role: ROLE_IDS.includes(recipe?.role) ? recipe.role : 'main'};
    });
    if (!items.length) items.push({id: `legacy-item-${entryIndex}-manual`, recipeId: null, name: entry.note.trim().slice(0, 200), quantity: 1,
      nutrition: unknownNutrition(), ingredients: [], groups: entry.groups, proteinSources: entry.proteinSources,
      allergens: [], allergensKnown: false, ingredientsKnown: false, steps: [], role: 'main'});
    return {id: entry.id, date: entry.date, meal: entry.meal, status: 'eaten', note: entry.note, items};
  });
  return validateV2(result, data);
}

export function validateJournal(value, data) {
  safeGraph(value);
  if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_BYTES) throw new Error('2 MB以下の保存ファイルを選んでください。');
  if (value?.version === 1) return migrateV1(value, data);
  if (value?.version !== 2) throw new Error('献立ノートの保存ファイルを選んでください。');
  return validateV2(value, data);
}

export function parseJournal(source, data) {
  if (typeof source !== 'string' || new TextEncoder().encode(source).length > MAX_BYTES) throw new Error('2 MB以下の保存ファイルを選んでください。');
  let value;
  try { value = JSON.parse(source); } catch { throw new Error('保存ファイルを読み取れませんでした。JSON形式を確認してください。'); }
  return validateJournal(value, data);
}

export function readJournal(storage, data, today = dateKey()) {
  try {
    const current = storage.getItem(JOURNAL_KEY);
    if (current !== null) return {state: parseJournal(current, data), message: ''};
    const legacy = storage.getItem(LEGACY_KEY);
    if (legacy !== null) return {state: parseJournal(legacy, data), message: '以前の記録をカレンダー形式に引き継ぎました。栄養成分が分からない料理は「未入力」として残しています。'};
    return {state: defaultJournal(today), message: ''};
  } catch {
    return {state: defaultJournal(today), message: INVALID_MESSAGE};
  }
}

export function writeJournal(storage, state, data) {
  const clean = validateJournal(state, data);
  try { storage.setItem(JOURNAL_KEY, JSON.stringify(clean)); return true; }
  catch { return false; }
}
