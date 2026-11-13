/** ご飯だけを選び直し、カレーの配合を変えずに1人分の記録を作ります。 */
import {recipeFamily, recipeNature} from './catalog.js';
import {NUTRIENT_KEYS, itemFromRecipe, recipeConfirmation, recipeNutrition} from './nutrition.js';
import {eligibleRecipes} from './planner.js';

export const DEFAULT_CURRY_RICE_GRAMS = 150;
export const MAX_CURRY_RICE_GRAMS = 1000;
const knownIds = new Set([
  'tomato-chicken-curry', 'minced-dry-curry', 'rice-baked-cheese',
  'daily-curry-chicken', 'daily-curry-pork', 'daily-curry-beef', 'daily-curry-vegetable', 'daily-curry-keema',
  'prepared-retort-beef-curry', 'prepared-retort-pork-curry', 'prepared-retort-chicken-curry',
  'prepared-retort-vegetable-curry', 'prepared-retort-keema-curry',
  'varied-green-curry-rice', 'varied-butter-chicken-rice',
  'world-massaman-chicken', 'world-mutton-curry', 'world-saag-chicken', 'world-saag-paneer',
]);
// この2品の完成1食の値は、ご飯180gとルーの明示された配合から求めたものです。
// 商品全体の表示しか分からない手入力値には、この差分計算を適用しません。
const manualModels = new Map([
  ['prepared-retort-vegetable-curry', 'retort_vegetable_curry_model'],
  ['prepared-retort-keema-curry', 'retort_keema_curry_model'],
]);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1e6;
const uid = () => `custom-curry-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const labelGrams = value => Number(value.toFixed(3)).toLocaleString('ja-JP');

function supportedManual(source) {
  const model = manualModels.get(source.id);
  return !!model && source.custom !== true && source.servings === 2 && source.ingredients.length === 2
    && source.ingredients.some(part => part.id === 'rice' && part.amount === 360)
    && source.ingredients.some(part => part.id === model && part.amount === 400);
}

/** dataを渡すと、新しいカレーも材料の構成から判定します。 */
export function curryRiceFor(recipeId, data) {
  if (typeof recipeId !== 'string') return null;
  let source;
  if (data !== undefined) {
    source = data?.recipes?.find(recipe => recipe.id === recipeId);
    if (!source || recipeFamily(source) !== 'curry' || !positive(source.servings) || !Array.isArray(source.ingredients)
      || !source.ingredients.some(part => part.id !== 'rice')
      || (source.manualNutrition !== undefined && !supportedManual(source))) return null;
  } else if (!knownIds.has(recipeId)) return null;
  return {recipeId, label:source?.name ?? 'カレー', defaultRiceGrams:DEFAULT_CURRY_RICE_GRAMS, minRiceGrams:0, maxRiceGrams:MAX_CURRY_RICE_GRAMS};
}

export function defaultCurryRiceSelection(recipeId, data) {
  if (!curryRiceFor(recipeId, data)) throw Error('ご飯の量を変更できるカレーが見つかりません。');
  return {recipeId, riceGrams:DEFAULT_CURRY_RICE_GRAMS};
}

function ingredientMetadata(parts, data) {
  const found = new Map(), active = new Set();
  function visit(id) {
    if (typeof id !== 'string' || !record(data?.ingredients) || !Object.hasOwn(data.ingredients, id) || !record(data.ingredients[id])) throw Error('カレーやご飯の材料データが見つかりません。');
    if (active.has(id)) throw Error('材料の派生元が循環しています。');
    if (found.has(id)) return;
    const food = data.ingredients[id];
    if (!Array.isArray(food.derivedFrom ?? [])) throw Error('材料の派生元を確認してください。');
    active.add(id); for (const parent of food.derivedFrom ?? []) visit(parent); active.delete(id);
    found.set(id, food);
  }
  parts.forEach(part => visit(part.id));
  return [...found.values()];
}

function riceNutrition(source, ingredients, riceGrams, oldRiceGrams, data) {
  if (source.manualNutrition === undefined) return recipeNutrition({servings:1, ingredients}, data);
  const original = recipeNutrition(source, data);
  if (riceGrams === oldRiceGrams) return original;
  const rice = recipeNutrition({servings:1, ingredients:[{id:'rice', amount:1}]}, data);
  return Object.fromEntries(NUTRIENT_KEYS.map(key => {
    if (original[key] === null || rice[key] === null) return [key, null];
    const value = original[key] + (riceGrams - oldRiceGrams) * rice[key];
    if (value < -1e-8) throw Error('元の栄養値とご飯の量が一致しません。');
    return [key, Math.max(0, value)];
  }));
}

function servingSteps(source, riceGrams) {
  const amount = labelGrams(riceGrams);
  const steps = [...(source.steps ?? [])];
  if (steps.some(step => typeof step !== 'string') || steps.length > 49) throw Error('元レシピの作り方を確認してください。');
  if (riceGrams > 0) {
    steps.unshift(`1人分の炊飯済みのご飯を${amount}g用意する。以下のご飯はこの量を使い、カレーの具・ルーは元の配合の1人分を使う。`);
  } else {
    for (let i = 0; i < steps.length; i++) steps[i] = steps[i]
      .replace(/炊飯済みのご飯を十分に温める。/g, '')
      .replace(/温かいご飯と具を入れ/g, 'カレーの具を入れ')
      .replace(/温かいご飯にかける/g, 'カレーの具だけを器に盛る')
      .replace(/ご飯とともに/g, 'カレーの具を')
      .replace(/ご飯に盛る/g, '器に盛る')
      .replace(/十分に温めたご飯と一緒に/g, '')
      .replace(/ご飯を十分に温め、カレーと一緒に/g, 'カレーを')
      .replace(/ご飯を添えて/g, '');
    steps.unshift('ご飯は0g（ルーのみ）。ご飯を用意せず、カレーの具・ルーだけを元の配合の1人分で作る。ナンなどは別のメニューとして登録する。');
  }
  if (steps.length === 1 && source.nature !== 'home-cooked') steps.push('カレーは商品の表示に従って十分に温め、器に盛る。');
  return steps.filter(step => step.trim());
}

export function buildCurryRiceSelection(config, data) {
  if (!record(config) || Object.keys(config).some(key => !['id', 'recipeId', 'riceGrams'].includes(key))) throw Error('ご飯の選択内容を確認してください。');
  if (typeof config.riceGrams !== 'number' || !Number.isFinite(config.riceGrams) || config.riceGrams < 0 || config.riceGrams > MAX_CURRY_RICE_GRAMS) throw Error(`ご飯は0〜${MAX_CURRY_RICE_GRAMS}gで入力してください。`);
  if (!curryRiceFor(config.recipeId, data)) throw Error('ご飯とカレーの材料が分かるレシピが必要です。完成品全体の栄養値だけではご飯を分離できません。');
  const source = data.recipes.find(recipe => recipe.id === config.recipeId);
  if (source.ingredients.some(part => !record(part) || !positive(part.amount)) || source.ingredients.length > 300) throw Error('元レシピの材料と量を確認してください。');
  if (data.ingredients?.rice?.unit !== 'g') throw Error('炊飯済みのご飯をg単位で登録してください。');
  const id = config.id ?? uid();
  if (typeof id !== 'string' || !/^custom-.+/.test(id) || id.length > 120) throw Error('料理の識別子を確認してください。');
  const amounts = new Map();
  let oldRiceGrams = 0;
  for (const part of source.ingredients) {
    if (part.id === 'rice') oldRiceGrams += part.amount / source.servings;
    else amounts.set(part.id, (amounts.get(part.id) ?? 0) + part.amount / source.servings);
  }
  if (config.riceGrams > 0) amounts.set('rice', config.riceGrams);
  const ingredients = [...amounts].map(([id, amount]) => ({id, amount}));
  if (ingredients.length > 300) throw Error('材料は300種類以内にしてください。');
  const metadata = ingredientMetadata(ingredients, data), confirmed = recipeConfirmation(source);
  const riceLabel = config.riceGrams === 0 ? 'ご飯0g・ルーのみ' : `ご飯${labelGrams(config.riceGrams)}g`;
  const baseName = source.name.replace(/（ご飯込み）/g, '').replace(/カレーライス/g, 'カレー');
  const sourceNote = `ご飯は1人分${labelGrams(config.riceGrams)}g（炊飯済み）。${config.riceGrams === 0 ? 'ご飯なし・ルーのみです。ナンなどは別に登録してください。' : 'カレーの具・ルーの量は元レシピの1人分を保ちます。'}元レシピのご飯${labelGrams(oldRiceGrams)}gを選んだ量に置き換えて概算しています。${source.sourceNote ? `変更前の参考説明：${source.sourceNote}` : ''}`;
  const result = {
    id, name:`${baseName.slice(0, 165)}（${riceLabel}）`, role:config.riceGrams === 0 ? 'main' : source.role,
    genre:source.genre, minutes:source.minutes, servings:1, custom:true,
    staple:config.riceGrams > 0 && source.staple === true, family:'curry', mealBase:config.riceGrams > 0,
    variantLabel:source.variantLabel ?? source.name, nature:recipeNature(source), portion:{amount:1, unit:'皿', label:'カレー1人分と指定した量のご飯'},
    ingredients, steps:servingSteps(source, config.riceGrams), sourceNote:sourceNote.slice(0, 2000),
    manualNutrition:riceNutrition(source, ingredients, config.riceGrams, oldRiceGrams, data),
    allergens:[...(source.allergens ?? [])], groups:[...(source.groups ?? [])].filter(group => config.riceGrams > 0 || group !== 'staple'), proteinSources:[...(source.proteinSources ?? [])],
    ingredientsKnown:confirmed.ingredientsKnown && metadata.every(food => food.ingredientsKnown !== false),
    allergensKnown:confirmed.allergensKnown && metadata.every(food => food.allergensKnown !== false),
    shoppingKnown:source.shoppingKnown ?? confirmed.ingredientsKnown,
  };
  const item = itemFromRecipe(result, data);
  return {...result, allergens:item.allergens, groups:item.groups, proteinSources:item.proteinSources};
}

/** 除外条件に合う初期値を選ぶため、ご飯150gと0gを実際の材料で判定します。 */
export function eligibleCurryRiceSelections(recipeId, settings, data) {
  eligibleRecipes(settings, {...data, recipes:[]});
  if (!curryRiceFor(recipeId, data)) throw Error('ご飯の量を変更できるカレーが見つかりません。');
  return [DEFAULT_CURRY_RICE_GRAMS, 0].flatMap(riceGrams => {
    const config = {recipeId, riceGrams}, recipe = buildCurryRiceSelection(config, data);
    return eligibleRecipes(settings, {...data, recipes:[recipe]}).length ? [{config, recipe}] : [];
  });
}
