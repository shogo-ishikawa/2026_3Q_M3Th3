// 食事記録と設定を検証し、渡されたアカウントの保存先で読み書きします。
import {CATALOG_CATEGORIES, FOOD_NATURES} from './catalog.js';
import {deriveReference} from './dietary-reference.js';
import {removeStaleBirthdayReasons} from './planner-personalization.js';
import {ageOnDate, derivePersonalNutrition, jstDateKey, validPersonalMeasurements} from './personal-nutrition.js';
import {recipeConfirmation} from './nutrition.js';
import {validateHousehold} from './household-preferences.js';
import {validateMealSets} from './meal-sets.js';
import {validatePurchaseSettings} from './purchase-conversion.js';
import {validateBatches, assertBatchUsage} from './batch-cooking.js';
import {validateRestaurantMetadata} from './restaurant-menu.js';
import {validateFavourites} from './favourites.js';
import {validateNutritionBasis} from './nutrition-basis.js';
import {normaliseMealPreferences} from './meal-profiles.js';
import {STORAGE_KEY as LEGACY_KEY, defaultState, validateState, GROUP_IDS, PROTEIN_IDS, GENRES} from './storage.js';

export const JOURNAL_KEY = 'kondate-note-v3';
export const PREVIOUS_JOURNAL_KEY = 'kondate-note-v2';
export const JOURNAL_BACKUP_KEY = 'meal-palette-raw-backups-v1';
export const JOURNAL_EXPORT_KEY = 'meal-palette-last-export';
export const DEFAULT_PROFILE = Object.freeze({ageBand: 'unset', sex: 'unset', activity: 'unset', mode: 'manual'});
export const NUTRIENT_KEYS = ['kcal', 'protein', 'fat', 'carbs', 'fiber', 'salt'];
export const MEAL_IDS = ['breakfast', 'lunch', 'dinner', 'snack'];
export const ROLE_IDS = ['main', 'side', 'soup', 'staple', 'drink', 'snack'];
export const DEFAULT_TARGETS = Object.freeze({kcal: 2000, protein: 60, fat: 65, carbs: 280, fiber: 20, salt: 6.5});
const MAX_BYTES = 2 * 1024 * 1024;
// 旧版が書き出した整形済みJSONは改行と字下げの分だけ大きくなります。
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
const LIMITS = {entries: 5000, items: 100, customRecipes: 500, pantry: 1000, shoppingChecks: 2000, shoppingExtras: 200, shoppingList: 500, shoppingCatalog: 500, shoppingReceipts: 2000};
const SETTINGS_KEYS = ['startDate', 'days', 'servings', 'allergens', 'excludedIngredients', 'preferences', 'meal', 'stapleId', 'drinkId', 'stapleAmount', 'drinkAmount', 'stapleMode', 'hideRecipeIllustrations', 'textSize', 'recordView', 'startTab', 'mealPreferences', 'shoppingOmittedIds'];
const TEXT_SIZE_IDS = ['standard', 'large', 'larger', 'largest'];
const ITEM_KEYS = ['id', 'recipeId', 'name', 'quantity', 'nutrition', 'ingredients', 'groups', 'proteinSources', 'allergens', 'allergensKnown', 'ingredientsKnown', 'steps', 'role', 'portion', 'nature', 'sourceNote', 'shoppingKnown', 'batchId', 'restaurant', 'nutritionBasis', 'diningMatch', 'ingredientEdit'];
const CUSTOM_KEYS = ['id', 'name', 'role', 'genre', 'minutes', 'servings', 'staple', 'ingredients', 'steps', 'manualNutrition', 'allergens', 'allergensKnown', 'ingredientsKnown', 'groups', 'proteinSources', 'custom', 'portion', 'family', 'variantLabel', 'mealBase', 'nature', 'sourceNote', 'shoppingKnown', 'restaurant', 'nutritionBasis'];
const INVALID_MESSAGE = '保存内容を読み込めませんでした。元の保存データはそのまま残っています。復旧方法を選ぶまで設定や記録の変更は保存できません。復旧画面から元のデータを書き出すか、バックアップを読み込んでください。復旧後はアレルギーと除外食材も確認してください。';
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
  return {version: 3, settings: {...defaultState(today).settings, meal: 'dinner', stapleId: 'auto', drinkId: 'none', stapleAmount: null, drinkAmount: null, hideRecipeIllustrations: false, textSize: 'standard', recordView: 'detailed', startTab: 'planner', mealPreferences: normaliseMealPreferences(), shoppingOmittedIds: []}, entries: [], customRecipes: [], pantry: [], targets: {...DEFAULT_TARGETS}, completedDays: [], profile: {...DEFAULT_PROFILE}, shoppingChecks: [], mealSets: [], purchaseSettings: [], batches: [], favourites: [], shoppingExtras: [], shoppingList: null, shoppingCatalog: [], shoppingReceipts: []};
}

// JSON以外のオブジェクト、アクセサー、危険なキーをデータとして受け付けません。
// 検証前に参照をたどることで、直接のオブジェクト入力にも同じ制限を適用します。
function safeGraph(value, active = new Set(), depth = 0, budget = {nodes: 0}) {
  if (++budget.nodes > 150000 || depth > 16) throw new Error('保存データの構造が大きすぎます。');
  if (value === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof value)) return;
  if (typeof value !== 'object' || active.has(value)) throw new Error('保存データの形式を確認してください。');
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw new Error('保存データの形式を確認してください。');
  if (Array.isArray(value) && value.length > 36600) throw new Error('保存データの件数が多すぎます。');
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

function portion(value) {
  record(value, ['amount', 'unit', 'label'], '料理の基準量');
  if (!['g', 'ml', '個', '皿', '杯', '枚', '袋', '人分', '貫', '食', '切れ', '本'].includes(value.unit)) throw new Error('料理の量の単位を確認してください。');
  return {amount: number(value.amount, '料理の基準量', {max: 100000}), unit: value.unit,
    ...(value.label === undefined ? {} : {label: text(value.label, 120, '基準量の説明')})};
}

const NATURE_IDS = new Set(FOOD_NATURES.map(nature => nature.id));
function sourceMetadata(source) {
  const result = {};
  if (source.nutritionBasis !== undefined) result.nutritionBasis = validateNutritionBasis(source.nutritionBasis);
  if (source.nature !== undefined) {
    if (!NATURE_IDS.has(source.nature)) throw new Error('メニューの性質を確認してください。');
    result.nature = source.nature;
  }
  if (source.shoppingKnown !== undefined) result.shoppingKnown = bool(source.shoppingKnown, false, '買い物に使う商品の確認状況');
  if (source.sourceNote !== undefined) result.sourceNote = text(source.sourceNote, 2000, '栄養と原材料の説明', true);
  return result;
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
  if (source.shoppingKnown === true && !ingredients.length) throw new Error('買い物に使う商品を確認済みにする場合は、商品を登録してください。');
  const extra = sourceMetadata(source);
  if (source.restaurant !== undefined) extra.restaurant = validateRestaurantMetadata(source.restaurant, context.data, {historical: true});
  if (source.portion !== undefined) extra.portion = portion(source.portion);
  if (source.family !== undefined) {
    if (!CATALOG_CATEGORIES.some(category => category.id === source.family)) throw new Error('メニューの大分類が登録されていません。');
    extra.family = source.family;
  }
  if (source.variantLabel !== undefined) extra.variantLabel = text(source.variantLabel, 200, 'メニューの小分類');
  if (source.mealBase !== undefined) extra.mealBase = bool(source.mealBase, false, '一品の食事の設定');
  const metadata = ingredientsKnown ? ingredientMetadata(ingredients, context.data) : {allergens: [], groups: [], proteinSources: []};
  return {id, name: text(source.name, 200, '料理名'), role: source.role, genre: source.genre ?? 'その他',
    minutes: number(source.minutes ?? 1, '調理時間', {max: 1440}), servings: 1,
    staple: bool(source.staple, source.role === 'staple', '主食の設定'), ingredients,
    steps: steps(source.steps === undefined || (Array.isArray(source.steps) && !source.steps.length) ? undefined : source.steps, ['調理方法は未登録です。']),
    manualNutrition: nutrition(source.manualNutrition, true),
    allergens: unique([...ids(source.allergens, context.allergenIds, 'アレルゲン'), ...metadata.allergens]),
    allergensKnown: bool(source.allergensKnown, false, 'アレルゲンの確認状況'), ingredientsKnown,
    groups: unique([...ids(source.groups, new Set(GROUP_IDS), '食品群'), ...metadata.groups]),
    proteinSources: unique([...ids(source.proteinSources, new Set(PROTEIN_IDS), '主な食材'), ...metadata.proteinSources]), custom: true, ...extra};
}

function diningMatch(item) {
  const source = item.diningMatch;
  record(source, ['mode', 'referenceName', 'actualName', 'storeName', 'referenceBasis'], '外食の照合情報');
  if (!['menu', 'similar'].includes(source.mode)) throw Error('外食で選んだ料理との対応を確認してください。');
  if (item.shoppingKnown === true || item.batchId !== undefined || item.name !== source.actualName) throw Error('外食記録の料理名と材料を確認してください。');
  if (source.mode === 'similar') {
    if (item.allergensKnown === true || item.ingredientsKnown === true || !['estimate','unknown'].includes(item.nutritionBasis)) throw Error('似た料理を使った外食の原材料と栄養の根拠を確認してください。');
  } else if (item.nutritionBasis !== source.referenceBasis) throw Error('外食の栄養表示の根拠を確認してください。');
  return {mode: source.mode, actualName: text(source.actualName, 200, '食べた料理の名前'),
    referenceName: text(source.referenceName, 200, '栄養の参考にした料理名'),
    storeName: text(source.storeName, 80, '外食の店名', true),
    referenceBasis: validateNutritionBasis(source.referenceBasis)};
}

// 編集した料理は、追加食材を外したときに商品表示や不明だった成分を復元できるようにします。
function ingredientEdit(item, context) {
  const source=record(item.ingredientEdit,['base','baseChanged','additions'],'食事の材料編集');
  if (item.batchId!==undefined) throw Error('作り置きの材料は調理時の記録を使います。');
  const original=record(source.base,['nutrition','ingredients','groups','proteinSources','allergens','allergensKnown',
    'ingredientsKnown','nutritionBasis','shoppingKnown','diningMode'],'材料を追加する前の料理');
  const base={nutrition:nutrition(original.nutrition),ingredients:parts(original.ingredients,context.ingredientIds,{historical:true}),
    groups:ids(original.groups,new Set(GROUP_IDS),'食品群'),proteinSources:ids(original.proteinSources,new Set(PROTEIN_IDS),'主な食材'),
    allergens:ids(original.allergens,context.allergenIds,'アレルゲン'),ingredientsKnown:bool(original.ingredientsKnown,false,'材料の確認状況'),
    allergensKnown:bool(original.allergensKnown,false,'アレルゲンの確認状況'),...sourceMetadata(original)};
  if (original.diningMode!==undefined) {
    if (!item.diningMatch || !['similar','menu'].includes(original.diningMode)) throw Error('元の外食の照合方法を確認してください。');
    base.diningMode=original.diningMode;
  }
  const additions=parts(list(source.additions,100,'追加した食材'),context.ingredientIds,{historical:true});
  const baseChanged=bool(source.baseChanged,false,'元の材料の編集');
  if (!baseChanged && !additions.length) throw Error('変更した材料を確認してください。');
  const amounts=new Map(base.ingredients.map(part=>[part.id,part.amount]));
  for (const part of additions) amounts.set(part.id,(amounts.get(part.id)??0)+part.amount);
  if (!Array.isArray(item.ingredients) || amounts.size!==item.ingredients.length || item.ingredients.some(part=>{
    const total=amounts.get(part.id);
    return total===undefined || Math.abs(total-part.amount)>1e-9*Math.max(total,part.amount);
  })) throw Error('料理の材料と編集した内訳が一致しません。');
  return {base,baseChanged,additions};
}

function snapshot(source, context, itemIds) {
  record(source, ITEM_KEYS, '食事の内容');
  const id = identifier(source.id, '食事の内容の識別子');
  if (itemIds.has(id)) throw new Error('食事の内容の識別子が重複しています。');
  itemIds.add(id);
  if (source.recipeId !== null) identifier(source.recipeId, 'レシピの識別子');
  if (!ROLE_IDS.includes(source.role)) throw new Error('料理の種類を確認してください。');
  if (source.shoppingKnown === true && !source.ingredients?.length) throw new Error('買い物に使う商品の構成を登録してください。');
  return {id, recipeId: source.recipeId, name: text(source.name, 200, '料理名'), quantity: number(source.quantity, '食べた量', {max: 1000}),
    nutrition: nutrition(source.nutrition), ingredients: parts(source.ingredients, context.ingredientIds, {historical: true}),
    groups: ids(source.groups, new Set(GROUP_IDS), '食品群'), proteinSources: ids(source.proteinSources, new Set(PROTEIN_IDS), '主な食材'),
    allergens: ids(source.allergens, context.allergenIds, 'アレルゲン'), allergensKnown: bool(source.allergensKnown, false, 'アレルゲンの確認状況'),
    ingredientsKnown: bool(source.ingredientsKnown, false, '材料の確認状況'), steps: steps(source.steps), role: source.role,
    ...(source.portion === undefined ? {} : {portion: portion(source.portion)}),
    ...(source.batchId === undefined ? {} : {batchId: identifier(source.batchId, '作り置きの識別子')}),
    ...(source.diningMatch === undefined ? {} : {diningMatch: diningMatch(source)}),
    ...(source.ingredientEdit === undefined ? {} : {ingredientEdit: ingredientEdit(source,context)}),
    ...(source.restaurant === undefined ? {} : {restaurant: validateRestaurantMetadata(source.restaurant, context.data, {historical: true})}), ...sourceMetadata(source)};
}

/** 記録・定番セット・作り置きで共通の保存用スナップショット検証。 */
export function validateFrozenItems(items, data) {
  safeGraph(items);
  const context = {data, ingredientIds: new Set(Object.keys(data.ingredients)), allergenIds: new Set(data.allergens.map(a => a.id))};
  const itemIds = new Set();
  return list(items, LIMITS.items, '食事の内容').map(item => snapshot(item, context, itemIds));
}

function settings(source, data, recipes) {
  const familyKeys = ['household', 'dislikedIngredients', 'occasionMenus'];
  record(source, [...SETTINGS_KEYS, ...familyKeys], '献立の設定');
  const legacy = Object.fromEntries(Object.entries(source).filter(([key]) => ![...familyKeys, 'meal', 'stapleId', 'drinkId', 'stapleAmount', 'drinkAmount', 'stapleMode', 'hideRecipeIllustrations', 'textSize', 'recordView', 'startTab', 'mealPreferences', 'shoppingOmittedIds'].includes(key)));
  const clean = validateState({version: 1, settings: legacy, history: []}, data).settings;
  const meal = source.meal ?? 'dinner';
  let stapleId = source.stapleId ?? 'auto';
  const drinkId = source.drinkId ?? 'none';
  if (![...MEAL_IDS, 'all'].includes(meal) || (!['auto', 'none'].includes(stapleId) && !recipes.some(recipe => recipe.id === stapleId && (recipe.role === 'staple' || (recipe.role === 'main' && recipe.staple === true)))) || (drinkId !== 'none' && !recipes.some(recipe => recipe.id === drinkId && recipe.role === 'drink'))) throw new Error('食事区分・主食・飲み物の設定を確認してください。');
  const amount = (value, label) => value === null || value === undefined ? null : number(value, label, {max: 100000});
  let stapleAmount = amount(source.stapleAmount, '主食の量');
  const mode = source.stapleMode;
  if (mode !== undefined) {
    if (!['adaptive', 'fixed'].includes(mode) || mode === 'fixed' && ['auto', 'none'].includes(stapleId)) throw new Error('主食の選び方を確認してください。');
    if (mode === 'adaptive') {
      stapleId = stapleId === 'none' ? 'none' : 'auto';
      stapleAmount = null;
    }
  }
  const textSize = source.textSize === undefined ? 'standard' : source.textSize;
  if (!TEXT_SIZE_IDS.includes(textSize)) throw new Error('文字の大きさを確認してください。');
  const startTab = source.startTab === undefined ? 'planner' : source.startTab;
  if (!['planner', 'catalog', 'record', 'nutrition', 'kitchen'].includes(startTab)) throw new Error('最初に開く画面を確認してください。');
  const recordView = source.recordView === undefined ? 'detailed' : source.recordView;
  if (!['simple', 'detailed'].includes(recordView)) throw new Error('記録の表示方法を確認してください。');
  const mealPreferences = mealPreferencesSetting(source.mealPreferences, clean.preferences.mood, {stapleId, stapleMode: mode, stapleAmount, drinkId, drinkAmount: amount(source.drinkAmount, '飲み物の量')}, recipes);
  const shoppingOmittedIds = ids(source.shoppingOmittedIds, new Set(Object.keys(data.ingredients)), '買い物で省く食材');
  if (source.household !== undefined) clean.household = validateHousehold(source.household);
  if (!bool(source.occasionMenus, true, '行事の献立設定')) clean.occasionMenus = false;
  if (source.dislikedIngredients !== undefined) {
    const disliked = ids(source.dislikedIngredients, new Set(Object.keys(data.ingredients)), '苦手な食材');
    if (disliked.length) clean.dislikedIngredients = disliked;
  }
  // 旧v3の形はそのまま保ち、未指定時のモードは提案側で主食IDから判断します。
  return {...clean, meal, stapleId, drinkId, stapleAmount, drinkAmount: amount(source.drinkAmount, '飲み物の量'), ...(mode === undefined ? {} : {stapleMode: mode}), hideRecipeIllustrations: bool(source.hideRecipeIllustrations, false, '料理イラストの表示設定'), textSize, recordView, startTab, mealPreferences, shoppingOmittedIds};
}


// 旧版の共通の気分は朝・昼・夕へ引き継ぎ、新しく選んだ条件を勝手に変えません。
function mealPreferencesSetting(value, legacyMood = 'all', legacySettings = {}, recipes = []) {
  const meals = ['breakfast', 'lunch', 'dinner'];
  if (value !== undefined) {
    record(value, meals, '朝昼夕の食事設定');
    if (meals.some(meal => !Object.hasOwn(value, meal))) throw new Error('朝昼夕の食事設定を確認してください。');
    for (const meal of meals) {
      record(value[meal], ['volume', 'mood', 'enabled', 'staple', 'stapleId', 'stapleAmount', 'drinkId', 'drinkAmount', 'yogurt', 'fruit', 'stapleVolume', 'sideCount', 'sideType', 'soup', 'banshaku'], '食事ごとの設定');
      if (!Object.hasOwn(value[meal], 'volume') || !Object.hasOwn(value[meal], 'mood')) throw new Error('食事の量と気分を確認してください。');
    }
  }
  const clean = normaliseMealPreferences(value, legacyMood, legacySettings);
  for (const choice of Object.values(clean)) {
    if (choice.stapleId !== 'auto' && !recipes.some(recipe => recipe.id === choice.stapleId && (recipe.role === 'staple' || recipe.role === 'main' && recipe.staple === true))) throw new Error('食事ごとの主食を確認してください。');
    if (choice.staple === 'fixed' && choice.stapleId === 'auto') throw new Error('固定する主食を選んでください。');
    if (choice.drinkId !== 'none' && !recipes.some(recipe => recipe.id === choice.drinkId && recipe.role === 'drink')) throw new Error('食事ごとの飲み物を確認してください。');
  }
  return clean;
}

function shoppingMenuDetails(source) {
  if (source.date !== undefined && !dateIsValid(source.date)) throw new Error('買い物の献立の日付を確認してください。');
  if (source.meal !== undefined && !MEAL_IDS.includes(source.meal)) throw new Error('買い物の献立の食事区分を確認してください。');
  if (source.origin !== undefined && !['plan', 'calendar', 'menu'].includes(source.origin)) throw new Error('買い物の献立の出所を確認してください。');
  return {
    ...(source.label === undefined ? {} : {label: text(source.label, 300, '買い物の献立の表示名', true)}),
    ...(source.date === undefined ? {} : {date: source.date}), ...(source.meal === undefined ? {} : {meal: source.meal}),
    ...(source.origin === undefined ? {} : {origin: source.origin})
  };
}

// 買い物の候補と確定リストも、登録時点の配合・数量をそのまま保存します。
function shoppingMenus(value, data, {prepared = false} = {}) {
  if (prepared && value === null) return null;
  const seen = new Set(), maximum = prepared ? LIMITS.shoppingList : LIMITS.shoppingExtras;
  return list(value === undefined ? [] : value, maximum, '買い物のメニュー').map(source => {
    record(source, prepared ? ['id', 'item', 'servings', 'ingredientIds', 'label', 'date', 'meal', 'origin'] : ['id', 'item', 'servings'], '買い物のメニュー');
    const id = text(source.id, prepared ? 500 : 120, '買い物のメニューの識別子');
    if (['__proto__', 'constructor', 'prototype'].includes(id) || seen.has(id)) throw new Error('買い物のメニューの識別子が重複または不正です。');
    seen.add(id);
    if (!Number.isInteger(source.servings) || source.servings < 1 || source.servings > 8) throw new Error('買い物の人数は1〜8人で指定してください。');
    const item = validateFrozenItems([source.item], data)[0];
    if (!prepared) return {id, item, servings: source.servings};
    // DBから削除された材料も、過去のスナップショットにある場合は残して注意へ回します。
    const ingredientIds = ids(source.ingredientIds, new Set(item.ingredients.map(part => part.id)), '買い物で選んだ食材');
    if (source.ingredientIds === undefined) throw new Error('買い物で選んだ食材を確認してください。');
    return {id, item, servings: source.servings, ingredientIds, ...shoppingMenuDetails(source)};
  });
}

function shoppingCatalog(value, data) {
  const seen = new Set();
  return list(value === undefined ? [] : value, LIMITS.shoppingCatalog, '買い物の献立一覧').map(source => {
    record(source, ['id', 'item', 'servings', 'label', 'date', 'meal', 'origin'], '買い物の献立');
    const id = text(source.id, 500, '買い物の献立の識別子');
    if (['__proto__', 'constructor', 'prototype'].includes(id) || seen.has(id)) throw new Error('買い物の献立の識別子を確認してください。');
    seen.add(id);
    if (!Number.isInteger(source.servings) || source.servings < 1 || source.servings > 8) throw new Error('買い物の人数は1〜8人で指定してください。');
    return {id, item: validateFrozenItems([source.item], data)[0], servings: source.servings, ...shoppingMenuDetails(source)};
  });
}

function shoppingReceipts(value) {
  const seen = new Set();
  return list(value === undefined ? [] : value, LIMITS.shoppingReceipts, '買い物の購入履歴').map(source => {
    record(source, ['id', 'ingredientId', 'amount', 'purchasedAt', 'allocations', 'legacy', 'stocked'], '買い物の購入履歴');
    const id = identifier(source.id, '購入履歴の識別子');
    if (seen.has(id)) throw new Error('購入履歴の識別子が重複しています。');
    seen.add(id);
    const ingredientId = identifier(source.ingredientId, '購入した食材の識別子');
    const amount = number(source.amount, '購入した材料の量', {max: 1e12});
    const purchasedAt = text(source.purchasedAt, 40, '購入日時');
    const timestamp = new Date(purchasedAt);
    if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== purchasedAt) throw new Error('購入日時を確認してください。');
    const menus = new Set();
    const allocations = list(source.allocations, LIMITS.shoppingCatalog, '料理ごとの購入量').map(part => {
      record(part, ['menuId', 'amount'], '料理ごとの購入量');
      const menuId = text(part.menuId, 500, '料理の識別子');
      if (['__proto__', 'constructor', 'prototype'].includes(menuId) || menus.has(menuId)) throw new Error('購入先の料理の識別子を確認してください。');
      menus.add(menuId);
      return {menuId, amount: number(part.amount, '料理ごとの購入量', {max: 1e12})};
    });
    if (!allocations.length) throw new Error('購入した量を使う料理を確認してください。');
    const allocated = allocations.reduce((sum, part) => sum + part.amount, 0);
    if (allocated > amount + Math.max(1, amount, allocated) * 1e-9) throw new Error('料理ごとの購入量が購入した量を超えています。');
    return {id, ingredientId, amount, purchasedAt, allocations, ...(source.stocked === undefined ? {} : {stocked: bool(source.stocked, false, '手持ちへの追加状態')}), ...(source.legacy === undefined ? {} : {legacy: bool(source.legacy, false, '旧版の購入チェック')})};
  });
}

function profile(value) {
  record(value, ['ageBand', 'sex', 'activity', 'mode', 'previousMode'], '比較用プロフィール');
  const allowed = {ageBand: ['unset', '18-29', '30-49', '50-64', '65-74', '75-plus'], sex: ['unset', 'male', 'female'], activity: ['unset', 'low', 'moderate', 'high'], mode: ['manual', 'reference', 'personal']};
  for (const [key, values] of Object.entries(allowed)) if (!values.includes(value[key])) throw new Error('年代・性別・活動量・比較方法を確認してください。');
  if (value.mode === 'personal') {
    if (!['manual', 'reference'].includes(value.previousMode) || (value.previousMode === 'reference' && !deriveReference(value))) throw Error('詳細プロフィールを削除した後に使う比較方法を確認してください。');
  } else if (value.previousMode !== undefined) throw Error('比較方法の設定を確認してください。');
  return {...value};
}

function validatePersonalProfile(value) {
  const byBirthDate = value?.ageSource === 'birthDate';
  record(value, [byBirthDate ? 'ageSource' : 'age', 'heightCm', 'weightKg', 'sex', 'activity'], '詳細プロフィール');
  if (!(byBirthDate ? validPersonalMeasurements(value) : derivePersonalNutrition(value))) throw Error('入力した年齢・身長・体重・性別区分・活動量の組み合わせでは、個人の目安を計算できません。');
  return {...value};
}

function personalReference(state, today) {
  const details = state.personalProfile;
  if (details?.ageSource !== 'birthDate') return derivePersonalNutrition(details);
  return derivePersonalNutrition({...details, age: ageOnDate(state.birthDate, today)});
}

export function activeNutritionReference(state, today = jstDateKey()) {
  if (state.profile.mode === 'personal') return personalReference(state, today);
  if (state.profile.mode === 'reference') return deriveReference(state.profile);
  return null;
}

/** 手入力の目安と年代設定は、ほかの比較方法を使っている間も保つ。 */
export function setNutritionMode(state, selection, details = state.personalProfile, today = jstDateKey()) {
  const previous = state.profile;
  let chosen = selection;
  if (selection.mode === 'personal') {
    details = validatePersonalProfile(details);
    const previousMode = previous.mode === 'personal' ? previous.previousMode : previous.mode;
    chosen = {...previous, mode: 'personal', previousMode};
  }
  const next = profile(chosen);
  const reference = activeNutritionReference({profile: next, personalProfile: details, birthDate: state.birthDate}, today);
  if (next.mode === 'personal' && !reference) throw Error('現在の年齢と身体情報では個人の目安を計算できません。18〜79歳が対象で、75歳以上の「高い」活動量には参照値がありません。');
  if (next.mode === 'reference' && !reference) throw Error('年代・基準表の性別・活動量を選んでください。75歳以上の「高い」活動量には参照値がありません。');
  if (next.mode === 'manual') {
    state.targets = {...(state.manualTargets ?? (previous.mode === 'personal' ? DEFAULT_TARGETS : state.targets))};
    delete state.manualTargets;
  } else {
    if (previous.mode === 'manual') state.manualTargets = {...state.targets};
    state.targets = {...reference.targets};
  }
  if (next.mode === 'personal') state.personalProfile = details;
  state.profile = next;
}

function restorePreviousNutritionMode(state) {
  const {previousMode, ...previous} = state.profile;
  const reference = previousMode === 'reference' && deriveReference(previous);
  state.profile = {...previous, mode: reference ? 'reference' : 'manual'};
  state.targets = {...(reference ? reference.targets : state.manualTargets ?? DEFAULT_TARGETS)};
  if (!reference) delete state.manualTargets;
}

export function clearPersonalProfile(state) {
  if (state.profile?.mode === 'personal') restorePreviousNutritionMode(state);
  delete state.personalProfile;
}

export function refreshBirthdayNutrition(state, today = jstDateKey()) {
  if (state.profile.mode !== 'personal' || state.personalProfile?.ageSource !== 'birthDate') return;
  const reference = personalReference(state, today);
  if (reference) state.targets = {...reference.targets};
  else restorePreviousNutritionMode(state);
}

export function setBirthDate(state, birthDate, today = jstDateKey()) {
  if (ageOnDate(birthDate, today) === null) throw Error('生年月日には1900年1月1日から今日までの日付を入力してください。');
  state.birthDate = birthDate;
  if (state.personalProfile) {
    delete state.personalProfile.age;
    state.personalProfile.ageSource = 'birthDate';
    refreshBirthdayNutrition(state, today);
  }
  removeStaleBirthdayReasons(state.draftPlan, state.birthDate);
}

export function clearBirthDate(state) {
  delete state.birthDate;
  if (state.personalProfile?.ageSource === 'birthDate' && state.profile.mode === 'personal') restorePreviousNutritionMode(state);
  removeStaleBirthdayReasons(state.draftPlan, state.birthDate);
}

function nutritionTargets(value) {
  record(value, NUTRIENT_KEYS, '比較の目安');
  return Object.fromEntries(NUTRIENT_KEYS.map(key => [key, number(value[key], '比較の目安', {zero: key === 'salt', max: key === 'kcal' ? 20000 : 10000})]));
}

export function shoppingServingsFor(entry, fallback) {
  if (!Object.hasOwn(entry, 'shoppingServings')) return fallback;
  const count = entry.shoppingServings;
  if (!Number.isInteger(count) || count < 1 || count > 8) throw Error('買い物の人数は1～8人で選んでください。');
  return count;
}

// 編集用の下書き。食べた実績やカレンダーの予定とは独立しています。
function validateDraft(source, data, recipes) {
  record(source, ['settings', 'warnings', 'days'], '献立の下書き');
  const {seed, ...sourceSettings} = source.settings;
  if (!(Number.isFinite(seed) || typeof seed === 'string' && seed.length <= 1000)) throw Error('下書きの提案条件を確認してください。');
  const base = settings(sourceSettings, data, recipes);
  const labels = values => list(values, 100, '下書きの説明').map(value => text(value, 2000, '下書きの説明'));
  const amount = value => value === null ? null : number(value, '下書きの分量', {max: 100000});
  const end = shiftDate(base.startDate, base.days - 1);
  const slots = new Set(), items = new Set();
  const days = list(source.days, 28, '下書きの食事').map(day => {
    record(day, ['date', 'meal', 'mainId', 'targetGenre', 'recipeIds', 'quantities', 'omittedRecipeIds', 'dishReasons',
      'stapleId', 'stapleMode', 'stapleAmount', 'drinkId', 'drinkAmount', 'mealPreference', 'reasons',
      'warnings', 'proposedReasons', 'proposedWarnings', 'itemIds'], '下書きの食事');
    const slot = day.date + '/' + day.meal;
    if (!dateIsValid(day.date) || day.date < base.startDate || day.date > end ||
        !MEAL_IDS.includes(day.meal) || slots.has(slot)) throw Error('下書きの日付と食事区分を確認してください。');
    slots.add(slot);
    const recipeIds = list(day.recipeIds, 50, '下書きの料理').map(id => identifier(id));
    const known = new Set(recipeIds);
    if (!known.size || recipeIds.length !== known.size || (day.mainId !== null && !known.has(day.mainId)) ||
        (day.targetGenre !== null && !GENRES.includes(day.targetGenre))) throw Error('下書きの主菜と料理の組み合わせを確認してください。');
    const checkMap = (map, validate) => Object.fromEntries(Object.entries(record(map, recipeIds, '料理ごとの設定'))
      .map(([id, value]) => [id, validate(value)]));
    const quantities = checkMap(day.quantities, value => number(value, '料理の量', {max: 1000}));
    const itemIds = checkMap(day.itemIds, value => {
      identifier(value, '買い物の識別子');
      if (items.has(value)) throw Error('下書きの買い物の識別子が重複しています。');
      items.add(value);
      return value;
    });
    if (!['adaptive', 'fixed'].includes(day.stapleMode)) throw Error('下書きの主食を確認してください。');
    const result = {date: day.date, meal: day.meal, mainId: day.mainId, targetGenre: day.targetGenre,
      recipeIds, quantities, itemIds, omittedRecipeIds: ids(day.omittedRecipeIds, known, '除いた料理'),
      stapleId: identifier(day.stapleId), stapleMode: day.stapleMode, stapleAmount: amount(day.stapleAmount),
      drinkId: identifier(day.drinkId), drinkAmount: amount(day.drinkAmount), dishReasons: checkMap(day.dishReasons, labels),
      reasons: labels(day.reasons), warnings: labels(day.warnings),
      proposedReasons: labels(day.proposedReasons), proposedWarnings: labels(day.proposedWarnings)};
    if (day.mealPreference !== undefined) {
      if (day.meal === 'snack') throw Error('間食の設定を確認してください。');
      result.mealPreference = mealPreferencesSetting({...base.mealPreferences, [day.meal]: day.mealPreference},
        base.preferences.mood, base, recipes)[day.meal];
    }
    return result;
  });
  if (!days.length) throw Error('下書きに食事がありません。');
  return {settings: {...base, seed}, days, warnings: labels(source.warnings)};
}

function validateV3(value, data) {
  record(value, ['version', 'settings', 'entries', 'customRecipes', 'pantry', 'targets', 'manualTargets', 'profile', 'personalProfile', 'birthDate', 'completedDays', 'shoppingChecks', 'mealSets', 'purchaseSettings', 'batches', 'favourites', 'shoppingExtras', 'shoppingList', 'shoppingCatalog', 'shoppingReceipts', 'draftPlan'], '保存データ');
  const context = {data, ingredientIds: new Set(Object.keys(data.ingredients)), recipeIds: new Set(data.recipes.map(recipe => recipe.id)), allergenIds: new Set(data.allergens.map(allergen => allergen.id)), customIds: new Set()};
  const customRecipes = list(value.customRecipes, LIMITS.customRecipes, 'マイレシピ').map(recipe => customRecipe(recipe, context));
  const recipes = [...data.recipes, ...customRecipes];
  const entryIds = new Set();
  const itemIds = new Set();
  const entries = list(value.entries, LIMITS.entries, '食事の記録').map(source => {
    record(source, ['id', 'date', 'meal', 'status', 'note', 'items', 'shoppingServings', 'pantryUse'], '食事の記録');
    const id = identifier(source.id, '食事の記録の識別子');
    if (entryIds.has(id) || !dateIsValid(source.date) || !MEAL_IDS.includes(source.meal) || !['planned', 'eaten'].includes(source.status)) throw new Error('食事の記録の日付・食事区分・状態・識別子を確認してください。');
    entryIds.add(id);
    const items = list(source.items, LIMITS.items, '1回の食事の内容').map(item => snapshot(item, context, itemIds));
    const note = text(source.note ?? '', 2000, '食事のメモ', true);
    if (!items.length && !note.trim()) throw new Error('料理かメモを登録してください。');
    const shoppingServings = shoppingServingsFor(source);
    let pantryUse;
    if (source.pantryUse !== undefined) {
      const seen = new Set();
      pantryUse = list(source.pantryUse, LIMITS.pantry, '使用した手持ちの食材').map(part => {
        record(part, ['id', 'amount'], '使用した手持ちの食材');
        if (!context.ingredientIds.has(part.id) || seen.has(part.id)) throw Error('使用した手持ちの食材を確認してください。');
        seen.add(part.id);
        return {id:part.id, amount:number(part.amount, '使用した手持ちの量')};
      });
      if (!pantryUse.length || source.status !== 'eaten') throw Error('手持ちの使用量は食べた記録に保存してください。');
    }
    return {id, date: source.date, meal: source.meal, status: source.status, note, items, ...(pantryUse ? {pantryUse} : {}), ...(shoppingServings ? {shoppingServings} : {})};
  });
  const pantryIds = new Set();
  const pantry = list(value.pantry, LIMITS.pantry, '手持ちの食材').map(part => {
    record(part, ['id', 'amount'], '手持ちの食材');
    if (!context.ingredientIds.has(part.id) || pantryIds.has(part.id)) throw new Error('手持ちの食材に不明な値や重複があります。');
    pantryIds.add(part.id);
    return {id: part.id, amount: number(part.amount, '手持ちの量', {zero: true})};
  });
  const selectedProfile = profile(value.profile);
  const personalProfile = value.personalProfile === undefined ? undefined : validatePersonalProfile(value.personalProfile);
  const birthDate = value.birthDate;
  const today = jstDateKey();
  if (birthDate !== undefined && ageOnDate(birthDate, today) === null) throw Error('生年月日を確認してください。');
  const nutrition = {
    targets: nutritionTargets(value.targets), profile: selectedProfile,
    ...(value.manualTargets === undefined ? {} : {manualTargets: nutritionTargets(value.manualTargets)}),
    ...(personalProfile ? {personalProfile} : {}), ...(birthDate === undefined ? {} : {birthDate}),
  };
  if (selectedProfile.mode === 'personal' && personalProfile?.ageSource === 'birthDate') {
    // 別の日・別端末で保存した計算値を、現在の日本の日付で計算し直す。
    refreshBirthdayNutrition(nutrition, today);
  } else if (selectedProfile.mode !== 'manual') {
    const reference = activeNutritionReference(nutrition, today);
    if (!reference) throw new Error('このプロフィールでは食事摂取基準の比較値を使えません。年代・性別・活動量を選ぶか、手動の比較値へ切り替えてください。');
    if (NUTRIENT_KEYS.some(key => Math.abs(nutrition.targets[key] - reference.targets[key]) > 1e-6)) throw new Error('プロフィールと食事摂取基準の比較値が一致しません。手動の値を使う場合は比較方法を手動にしてください。');
    nutrition.targets = {...reference.targets};
  }
  if (nutrition.profile.mode === 'manual') delete nutrition.manualTargets;
  const completedDays = list(value.completedDays, 36600, '記録を完了した日').map(date => { if (!dateIsValid(date)) throw new Error('記録を完了した日付を確認してください。'); return date; });
  if (new Set(completedDays).size !== completedDays.length) throw new Error('記録を完了した日付が重複しています。');
  const shoppingChecks = unique(list(value.shoppingChecks, LIMITS.shoppingChecks, '買い物のチェック').map(id => text(id, 200, '買い物の識別子')));
  const mealSets = validateMealSets(value.mealSets === undefined ? [] : value.mealSets, data);
  const purchaseSettings = validatePurchaseSettings(value.purchaseSettings === undefined ? [] : value.purchaseSettings, data);
  const batches = validateBatches(value.batches === undefined ? [] : value.batches, data, {validateItem: item => validateFrozenItems([item], data)[0]});
  assertBatchUsage(batches, entries);
  const favourites = validateFavourites(value.favourites === undefined ? [] : value.favourites, data);
  const shoppingExtras = shoppingMenus(value.shoppingExtras, data);
  const shoppingList = value.shoppingList === undefined ? null : shoppingMenus(value.shoppingList, data, {prepared: true});
  const catalog = shoppingCatalog(value.shoppingCatalog, data), receipts = shoppingReceipts(value.shoppingReceipts);
  const draftPlan = value.draftPlan === undefined ? undefined : validateDraft(value.draftPlan, data, recipes);
  removeStaleBirthdayReasons(draftPlan, birthDate);
  return {version: 3, settings: settings(value.settings, data, recipes), entries, customRecipes, pantry, ...nutrition, completedDays, shoppingChecks, mealSets, purchaseSettings, batches, favourites, shoppingExtras, shoppingList, shoppingCatalog: catalog, shoppingReceipts: receipts,
    ...(draftPlan === undefined ? {} : {draftPlan})};
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
  record(value.settings, SETTINGS_KEYS.filter(key => !['meal', 'stapleId', 'drinkId', 'stapleAmount', 'drinkAmount', 'stapleMode', 'hideRecipeIllustrations', 'textSize', 'recordView', 'startTab', 'mealPreferences', 'shoppingOmittedIds'].includes(key)), '旧版の献立の設定');
  // 現在のDBから消えた料理の識別子も、過去の記録として残します。
  const missing = new Set();
  for (const entry of list(value.history, 1000, '旧版の食事の記録')) {
    record(entry, ['id', 'date', 'meal', 'recipeIds', 'groups', 'proteinSources', 'note'], '旧版の食事の記録');
    for (const id of list(entry.recipeIds, 300, '記録したレシピ')) { identifier(id); missing.add(id); }
  }
  const recipes = [...data.recipes, ...[...missing].filter(id => !data.recipes.some(recipe => recipe.id === id)).map(id => ({id}))];
  const legacy = validateState(value, {...data, recipes});
  const result = defaultJournal(legacy.settings.startDate);
  result.settings = {...legacy.settings, meal: 'dinner', stapleId: 'auto', drinkId: 'none', stapleAmount: null, drinkAmount: null};
  result.entries = legacy.history.map((entry, entryIndex) => {
    const items = entry.recipeIds.map((id, index) => {
      const recipe = data.recipes.find(candidate => candidate.id === id);
      const ingredients = recipe?.ingredients?.map(part => ({id: part.id, amount: part.amount / recipe.servings})) ?? [];
      const metadata = recipe ? ingredientMetadata(ingredients, data) : {allergens: [], groups: [], proteinSources: []};
      return {id: `legacy-item-${entryIndex}-${index}`, recipeId: id, name: recipe?.name ?? `過去に記録した料理 (${id})`, quantity: 1,
        nutrition: recipe ? legacyNutrition(recipe, data) : unknownNutrition(), ingredients,
        groups: unique([...metadata.groups, ...(index === 0 ? entry.groups : [])]),
        proteinSources: unique([...metadata.proteinSources, ...(index === 0 ? entry.proteinSources : [])]),
        allergens: metadata.allergens, allergensKnown: recipe ? recipeConfirmation(recipe).allergensKnown : false, ingredientsKnown: recipe ? recipeConfirmation(recipe).ingredientsKnown : false,
        steps: recipe?.steps ?? [], role: ROLE_IDS.includes(recipe?.role) ? recipe.role : 'main', ...(recipe ? sourceMetadata(recipe) : {})};
    });
    if (!items.length) items.push({id: `legacy-item-${entryIndex}-manual`, recipeId: null, name: entry.note.trim().slice(0, 200), quantity: 1,
      nutrition: unknownNutrition(), ingredients: [], groups: entry.groups, proteinSources: entry.proteinSources,
      allergens: [], allergensKnown: false, ingredientsKnown: false, steps: [], role: 'main'});
    return {id: entry.id, date: entry.date, meal: entry.meal, status: 'eaten', note: entry.note, items};
  });
  return validateV3(result, data);
}

export function validateJournal(value, data) {
  safeGraph(value);
  if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_BYTES) throw new Error('2 MB以下の保存ファイルを選んでください。');
  if (value?.version === 1) return migrateV1(value, data);
  if (value?.version === 2) {
    record(value, ['version', 'settings', 'entries', 'customRecipes', 'pantry', 'targets', 'shoppingChecks'], '旧版の保存データ');
    record(value.settings, SETTINGS_KEYS.filter(key => !['stapleAmount', 'drinkAmount', 'stapleMode', 'hideRecipeIllustrations', 'textSize', 'recordView', 'startTab', 'mealPreferences', 'shoppingOmittedIds'].includes(key)), '旧版の献立の設定');
    return validateV3({...value, version: 3, profile: {...DEFAULT_PROFILE}, completedDays: [], settings: {...value.settings, stapleAmount: null, drinkAmount: null}}, data);
  }
  if (value?.version !== 3) throw new Error('Meal Paletteか献立ノートの保存ファイルを選んでください。');
  return validateV3(value, data);
}

export function parseJournal(source, data) {
  if (typeof source !== 'string') throw new Error('JSON形式の保存ファイルを選んでください。');
  const bytes = new TextEncoder().encode(source).length;
  if (bytes > MAX_IMPORT_BYTES) throw new Error('保存ファイルが大きすぎます。記録本体の上限は2 MBです。');
  let value;
  try { value = JSON.parse(source); } catch {
    if (bytes > MAX_BYTES) throw new Error('保存ファイルを読み取れませんでした。記録本体の上限は2 MBです。');
    throw new Error('保存ファイルを読み取れませんでした。JSON形式を確認してください。');
  }
  return validateJournal(value, data);
}

const JOURNAL_KEYS = [JOURNAL_KEY, PREVIOUS_JOURNAL_KEY, LEGACY_KEY];
function storedJournal(storage) {
  for (const key of JOURNAL_KEYS) {
    const raw = storage.getItem(key);
    if (raw !== null) return {key, raw};
  }
  return null;
}

export function readJournal(storage, data, today = dateKey()) {
  let source;
  try {
    source = storedJournal(storage);
    if (!source) return {state: defaultJournal(today), message: '', recovery: null, source};
    const state = parseJournal(source.raw, data);
    const message = source.key === JOURNAL_KEY ? '' : source.key === PREVIOUS_JOURNAL_KEY
      ? '献立ノートの記録と設定を引き継ぎました。プロフィールは未選択のままです。'
      : '以前の記録をカレンダー形式に引き継ぎました。栄養成分が分からない料理は「未入力」として残しています。';
    return {state, message, recovery: null, source};
  } catch {
    return {state: defaultJournal(today), message: INVALID_MESSAGE, recovery: source ?? null, source};
  }
}

// Compare the stored bytes, including the original key for pre-migration journals.
function sameJournalSource(before, current) {
  return before?.key === current?.key && before?.raw === current?.raw;
}

export function journalSourceChanged(storage, session) {
  try { return !sameJournalSource(session.source, storedJournal(storage)); }
  catch { return false; } // Storage access errors keep the in-memory editing/export path available.
}

function storeJournal(storage, clean, session) {
  const raw = JSON.stringify(clean);
  storage.setItem(JOURNAL_KEY, raw);
  if (session) session.source = {key: JOURNAL_KEY, raw};
}

/** Ordinary saves cannot replace an unreadable current or legacy source. */
export function writeJournal(storage, state, data, session) {
  const clean = validateJournal(state, data);
  try {
    const source = storedJournal(storage);
    if (session && !sameJournalSource(session.source, source)) return false;
    if (source) parseJournal(source.raw, data);
    storeJournal(storage, clean, session);
    return true;
  } catch { return false; }
}

function validTimestamp(value) {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function rawBackups(storage) {
  const raw = storage.getItem(JOURNAL_BACKUP_KEY);
  if (raw === null) return [];
  const backups = JSON.parse(raw);
  if (!Array.isArray(backups) || backups.some(backup => !backup || Array.isArray(backup)
    || Object.keys(backup).some(key => !['key', 'raw', 'savedAt'].includes(key))
    || !JOURNAL_KEYS.includes(backup.key) || typeof backup.raw !== 'string'
    || !validTimestamp(backup.savedAt))) throw Error('退避したデータを読み込めません。');
  return backups;
}

/** Explicit import/restart: archive the original before writing the new journal. */
export function replaceJournal(storage, state, data, session) {
  const clean = validateJournal(state, data);
  try {
    const source = storedJournal(storage);
    if (session && !sameJournalSource(session.source, source)) return false;
    if (source) {
      const backups = rawBackups(storage).map(archive => ({...archive, raw: withoutArchivedPersonalProfile(archive.raw)}));
      // プロフィールをクラウドで削除した後、別の端末の自動退避から再登録されるのを防ぐ。
      const raw = withoutArchivedPersonalProfile(source.raw);
      const previous = backups.find(backup => backup.key === source.key && backup.raw === raw);
      const backup = previous ?? {...source, raw, savedAt: new Date().toISOString()};
      const history = backups.filter(item => item !== previous);
      history.push(backup);
      // Retain all distinct originals. A quota failure leaves the current source untouched.
      storage.setItem(JOURNAL_BACKUP_KEY, JSON.stringify(history));
    }
    storeJournal(storage, clean, session);
    return true;
  } catch { return false; }
}

function availableBackups(storage) {
  try { return rawBackups(storage); } catch { return []; }
}

export function readJournalBackups(storage) {
  return availableBackups(storage).map(archive => ({...archive, raw: withoutArchivedPersonalProfile(archive.raw, {body: false})}));
}

export function readJournalBackup(storage) {
  const latest = availableBackups(storage).at(-1);
  return latest ? {...latest, raw: withoutArchivedPersonalProfile(latest.raw, {body: false})} : null;
}

function parseArchivedState(raw) {
  try { return JSON.parse(raw); }
  catch { return null; }
}

function withoutArchivedPersonalProfile(raw, {body = true, birthday = true} = {}) {
  const saved = parseArchivedState(raw);
  if (!saved || typeof saved !== 'object') return raw;
  const stripBody = body && Object.hasOwn(saved, 'personalProfile');
  const stripDate = birthday && Object.hasOwn(saved, 'birthDate');
  const removedReasons = birthday && removeStaleBirthdayReasons(saved.draftPlan);
  if (!stripBody && !stripDate && !removedReasons) return raw;
  const restoreTargets = saved.profile?.mode === 'personal' && (stripBody || saved.personalProfile?.ageSource === 'birthDate');
  if (stripBody) delete saved.personalProfile;
  if (stripDate) delete saved.birthDate;
  if (restoreTargets) {
    // 壊れた設定の復旧用コピーでは、判断できない比較値や未知の項目を変更しない。
    try { profile(saved.profile); }
    catch { return JSON.stringify(saved); }
    restorePreviousNutritionMode(saved);
  }
  return JSON.stringify(saved);
}

function hasArchivedField(storage, key) {
  return availableBackups(storage).some(backup => Object.hasOwn(parseArchivedState(backup.raw) ?? {}, key));
}

export function hasArchivedPersonalProfile(storage) { return hasArchivedField(storage, 'personalProfile'); }
export function hasArchivedBirthDate(storage) {
  return availableBackups(storage).some(archive => {
    const saved = parseArchivedState(archive.raw);
    return saved && (Object.hasOwn(saved, 'birthDate') || removeStaleBirthdayReasons(saved.draftPlan));
  });
}

/** 書き出したファイルには触れず、このアカウントの端末内の各退避データを更新する。 */
function redactArchiveFields(storage, options) {
  const archives = rawBackups(storage);
  let changed = false;
  for (const archive of archives) {
    const raw = withoutArchivedPersonalProfile(archive.raw, options);
    if (raw === archive.raw) continue;
    archive.raw = raw;
    changed = true;
  }
  if (changed) storage.setItem(JOURNAL_BACKUP_KEY, JSON.stringify(archives));
}

export function clearArchivedPersonalProfiles(storage) { redactArchiveFields(storage, {birthday: false}); }
export function clearArchivedBirthDates(storage) { redactArchiveFields(storage, {body: false}); }

/** This records an export operation, not proof that a download reached a device. */
export function markJournalExport(storage, at = new Date().toISOString()) {
  if (!validTimestamp(at)) return false;
  try { storage.setItem(JOURNAL_EXPORT_KEY, at); return true; } catch { return false; }
}

export function readJournalExportTime(storage) {
  try {
    const value = storage.getItem(JOURNAL_EXPORT_KEY);
    return validTimestamp(value) ? value : null;
  } catch { return null; }
}
