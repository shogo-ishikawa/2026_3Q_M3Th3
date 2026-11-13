/** 家庭料理の肉だけを選び直し、元レシピを変更せず1人分の配合にします。 */
import {isCompleteMeal, recipeFamily, recipePortion} from './catalog.js';
import {itemFromRecipe, recipeConfirmation, recipeNutrition} from './nutrition.js';
import {eligibleRecipes} from './planner.js';

const freeze = value => {
  if (value && typeof value === 'object') {Object.values(value).forEach(freeze); Object.freeze(value);}
  return value;
};
const mince = [
  {id:'beef', label:'牛ひき肉', ingredients:[['beef_minced', 1]]},
  {id:'pork', label:'豚ひき肉', ingredients:[['pork_minced', 1]]},
  {id:'mixed', label:'合いびき（牛・豚を半分ずつ）', ingredients:[['beef_minced', .5], ['pork_minced', .5]]},
  {id:'chicken', label:'鶏ひき肉', ingredients:[['chicken_minced', 1]]},
];
const sliced = [
  {id:'beef', label:'牛肉', ingredients:[['beef', 1]]},
  {id:'pork', label:'豚肉', ingredients:[['pork', 1]]},
];
const offal = [
  {id:'pork', label:'豚白もつ（小腸・ゆで）', ingredients:[['pork_small_intestine_boiled', 1]],
    note:'下ゆで後に水気を切った重さです。'},
  {id:'beef', label:'牛もつ（小腸・生）', ingredients:[['meat_beef_small_intestine_raw', 1]],
    note:'下ゆで前の生の重さです。ゆでて流れ出る脂は栄養から差し引きません。'},
  {id:'beef-rumen', label:'牛もつ（ミノ・ゆで）', ingredients:[['meat_beef_rumen_boiled', 1]],
    note:'下ゆで後に水気を切った第一胃（ミノ）の重さです。小腸とは区別します。'},
];
const definition = (recipeId, kind, label, defaultMeatId, name) => ({recipeId, kind, label, defaultMeatId, name,
  options:kind === 'offal' ? offal : kind === 'sliced' ? sliced : mince});
export const MEAT_CHOICES = freeze([
  definition('comfort-nikudofu-pork', 'sliced', '肉豆腐', 'pork', '肉豆腐'),
  definition('comfort-motsu-stew', 'offal', 'もつ煮込み', 'pork', 'もつ煮込み'),
  definition('beef-hamburg', 'mince', 'ハンバーグ', 'beef', '卵を使わないハンバーグ'),
  definition('tofu-burger', 'mince', '豆腐ハンバーグ', 'chicken', '豆腐ハンバーグ'),
  definition('classic-hamburg', 'mince', 'ハンバーグ', 'mixed', 'ハンバーグ'),
  definition('familiar-hamburg-oroshi', 'mince', '和風おろしハンバーグ', 'mixed', '和風おろしハンバーグ'),
  definition('familiar-hamburg-stew', 'mince', '煮込みハンバーグ', 'mixed', '煮込みハンバーグ'),
  definition('familiar-hamburg-cheese', 'mince', 'チーズハンバーグ', 'mixed', 'チーズハンバーグ'),
  definition('familiar-loco-moco', 'mince', 'ロコモコ', 'mixed', 'ロコモコ'),
  definition('tofu-mapo', 'mince', '麻婆豆腐', 'pork', '辛くない麻婆豆腐'),
  definition('daily-donburi-mapo', 'mince', '麻婆豆腐丼', 'pork', '麻婆豆腐丼'),
  definition('familiar-mapo-aubergine', 'mince', '麻婆なす', 'pork', '麻婆なす'),
]);
const byRecipe = new Map(MEAT_CHOICES.map(row => [row.recipeId, row]));
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1e6;
const uid = () => `custom-meat-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

export function meatChoiceFor(recipeId) {return byRecipe.get(recipeId) ?? null;}
export function defaultMeatSelection(recipeId) {
  const choice = meatChoiceFor(recipeId);
  if (!choice) throw Error('肉を選ぶ料理が見つかりません。');
  return {recipeId, meatId:choice.defaultMeatId};
}
function ingredientMetadata(ingredients, data) {
  const found = new Map(), active = new Set();
  function visit(id) {
    if (!record(data?.ingredients) || !Object.hasOwn(data.ingredients, id) || !record(data.ingredients[id])) throw Error('選んだ肉や材料のデータが見つかりません。');
    if (active.has(id)) throw Error('材料の派生元が循環しています。');
    if (found.has(id)) return;
    const food = data.ingredients[id];
    if (!Array.isArray(food.derivedFrom ?? [])) throw Error('材料の派生元を確認してください。');
    active.add(id); for (const parent of food.derivedFrom ?? []) visit(parent); active.delete(id);
    found.set(id, food);
  }
  ingredients.forEach(part => visit(part.id));
  return [...found.values()];
}

export function buildMeatSelection(config, data) {
  if (!record(config) || Object.keys(config).some(key => !['id', 'recipeId', 'meatId'].includes(key))) throw Error('肉の選択内容を確認してください。');
  const definition = meatChoiceFor(config.recipeId), option = definition?.options.find(row => row.id === config.meatId);
  if (!definition || !option) throw Error('料理と肉の組み合わせを選び直してください。');
  const source = data?.recipes?.find(row => row.id === config.recipeId);
  if (!source || !positive(source.servings) || !Array.isArray(source.ingredients) || source.manualNutrition !== undefined) throw Error('基準の材料が分かる手作りレシピが必要です。');
  const replacements = definition.kind === 'sliced' ? ['pork', 'beef'] : definition.kind === 'offal'
    ? ['pork_small_intestine_boiled', 'meat_beef_small_intestine_raw', 'meat_beef_rumen_boiled'] : ['beef_minced', 'pork_minced', 'chicken_minced'];
  if (source.ingredients.some(part => !record(part) || !positive(part.amount))) throw Error('元レシピの材料と量を確認してください。');
  const meatAmount = source.ingredients.filter(part => replacements.includes(part.id)).reduce((sum, part) => sum + part.amount / source.servings, 0);
  if (!positive(meatAmount)) throw Error('置き換える肉の量が見つかりません。');
  const amounts = new Map();
  const add = (id, amount) => amounts.set(id, (amounts.get(id) ?? 0) + amount);
  let inserted = false;
  for (const part of source.ingredients) {
    if (replacements.includes(part.id)) {
      if (!inserted) {option.ingredients.forEach(([id, ratio]) => add(id, meatAmount * ratio)); inserted = true;}
    } else add(part.id, part.amount / source.servings);
  }
  const ingredients = [...amounts].map(([id, amount]) => ({id, amount}));
  const metadata = ingredientMetadata(ingredients, data);
  for (const [id] of option.ingredients) if (data.ingredients[id].unit !== 'g') throw Error('肉は可食部のg数で登録してください。');
  const id = config.id ?? uid();
  if (typeof id !== 'string' || !/^custom-.+/.test(id) || id.length > 120) throw Error('料理の識別子を確認してください。');
  const amountLabel = Number(meatAmount.toFixed(3)).toLocaleString('ja-JP');
  let steps = [...(source.steps ?? [])];
  if (definition.kind === 'offal') {
    steps[0] = option.id === 'beef'
      ? `味付けのない生の牛小腸を${amountLabel}g、下ゆで前に計量する。下処理方法は商品の表示に従う。別鍋のたっぷりの湯で下ゆでし、湯を捨てて水気を切ってから、食べやすく切る。下ゆで用の湯は煮汁に使わない。`
      : `味付けのない下ゆで済みの${option.id === 'pork' ? '豚小腸' : '牛ミノ（第一胃）'}を、水気を切ってから${amountLabel}g計量し、食べやすく切る。生もつや別の部位の重さと混同しないよう、商品表示で部位と下処理の状態を確認する。`;
  } else if (definition.kind === 'sliced') steps = steps.map(step => step.replace(/豚肉|牛肉/g, option.label));
  else steps.unshift(`${option.label}を合計${amountLabel}g用意する。${option.id === 'mixed' ? '牛ひき肉と豚ひき肉を半分ずつ量る。' : ''}選んだ肉を以下のひき肉として使う。`);
  const confirmed = recipeConfirmation(source);
  const sourceNote = definition.kind === 'offal'
    ? `家庭用のみそ仕立てのもつ煮込みを1人分にした概算です。${option.label}を${amountLabel}g使います。${option.note} 牛の筋肉や混合もつの成分値ではありません。下ゆでや煮込みで流れ出す脂・成分は差し引かず、追加の吸油も仮定しません。味付け済み製品の表示とは異なります。`
    : `${source.sourceNote ?? '家庭で作る配合の一例です。'} 肉を${option.label}に選び直した1人分です。肉の合計は${amountLabel}gを保ち、他の材料も元レシピの1人分から変えません。牛と豚の合いびきは1:1で概算します。調理による脂の流出は差し引いていません。`;
  const result = {id, name:`${definition.name}（${option.label}）`, role:source.role, genre:source.genre,
    minutes:source.minutes + (definition.kind === 'offal' && option.id === 'beef' ? 20 : 0), staple:source.staple === true,
    family:recipeFamily(source), mealBase:isCompleteMeal(source), variantLabel:source.variantLabel ?? source.name,
    servings:1, custom:true, ingredients, steps, sourceNote,
    portion:recipePortion(source, data), allergens:[], groups:[], proteinSources:[], nature:'home-cooked',
    ingredientsKnown:confirmed.ingredientsKnown && metadata.every(food => food.ingredientsKnown !== false),
    allergensKnown:confirmed.allergensKnown && metadata.every(food => food.allergensKnown !== false), shoppingKnown:source.shoppingKnown !== false,
    manualNutrition:recipeNutrition({servings:1, ingredients}, data)};
  const item = itemFromRecipe(result, data);
  return {...result, allergens:item.allergens, groups:item.groups, proteinSources:item.proteinSources};
}

/** 除外条件を満たす選択肢だけを返します。表示名から安全性を推測しません。 */
export function eligibleMeatSelections(recipeId, settings, data) {
  eligibleRecipes(settings, {...data, recipes:[]});
  const definition = meatChoiceFor(recipeId);
  if (!definition) throw Error('肉を選ぶ料理が見つかりません。');
  return definition.options.flatMap(option => {
    const config = {recipeId, meatId:option.id}, recipe = buildMeatSelection(config, data);
    return eligibleRecipes(settings, {...data, recipes:[recipe]}).length ? [{config, recipe}] : [];
  });
}
