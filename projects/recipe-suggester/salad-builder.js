/** 選んだ材料だけから作る1人分のサラダ。組み合わせを共通DBへ列挙しません。 */
import {itemFromRecipe, recipeNutrition} from './nutrition.js';

const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

export const SALAD_INGREDIENTS = freeze({
  salad_broccoli_boiled: {
    name: 'ブロッコリー（花序・ゆで）', unit: 'g', allergens: [], groups: ['vegetable'], proteinSources: [],
    derivedFrom: ['broccoli'],
    note: '食塩を加えずにゆで、湯切りした花序の重量です。生の重量や茎葉の値とは区別します。',
  },
});

export const SALAD_COMPONENTS = freeze([
  {id: 'lettuce', label: 'レタス', ingredientId: 'lettuce', defaultAmount: 50, preparation: '生・水気を切った可食部'},
  {id: 'cabbage', label: 'キャベツ', ingredientId: 'cabbage', defaultAmount: 50, preparation: '生・水気を切った可食部'},
  {id: 'cucumber', label: 'きゅうり', ingredientId: 'cucumber', defaultAmount: 30, preparation: '生・水気を切った可食部'},
  {id: 'tomato', label: 'トマト', ingredientId: 'tomato', defaultAmount: 50, preparation: '生・水気を切った可食部'},
  {id: 'carrot', label: 'にんじん', ingredientId: 'carrot', defaultAmount: 15, preparation: '生・皮を除いた可食部'},
  {id: 'red-cabbage', label: '紫キャベツ', ingredientId: 'red_cabbage', defaultAmount: 30, preparation: '生・水気を切った可食部'},
  {id: 'broccoli', label: 'ブロッコリー（ゆで）', ingredientId: 'salad_broccoli_boiled', defaultAmount: 50, preparation: 'ゆでて湯切りした後の花序'},
]);

// 調味料のamountはDBと同じ単位（mlまたはg）です。g指定の完成ドレッシングへ換算します。
export const SALAD_DRESSINGS = freeze([
  {id: 'none', label: 'ドレッシングなし', ingredients: [], defaultAmount: 0},
  {id: 'wafu', label: '和風ドレッシング', ingredients: [
    {id: 'soy_sauce', amount: 5}, {id: 'vinegar', amount: 5}, {id: 'oil', amount: 3}, {id: 'sugar', amount: 1},
  ], defaultAmount: 15},
  {id: 'french', label: 'フレンチドレッシング', ingredients: [
    {id: 'olive_oil', amount: 10}, {id: 'vinegar', amount: 10}, {id: 'sugar', amount: 1},
    {id: 'salt', amount: 0.5}, {id: 'black_pepper', amount: 0.05},
  ], defaultAmount: 15},
  {id: 'lemon-oil', label: 'レモンオイル', ingredients: [
    {id: 'olive_oil', amount: 6}, {id: 'lemon', amount: 6}, {id: 'salt', amount: 0.3}, {id: 'black_pepper', amount: 0.05},
  ], defaultAmount: 12},
  {id: 'sesame', label: 'ごまドレッシング', ingredients: [
    {id: 'ground_sesame', amount: 4}, {id: 'mayonnaise', amount: 5}, {id: 'soy_sauce', amount: 3},
    {id: 'vinegar', amount: 4}, {id: 'sugar', amount: 1}, {id: 'water', amount: 2},
  ], defaultAmount: 20},
  {id: 'mayonnaise', label: 'マヨネーズ', ingredients: [{id: 'mayonnaise', amount: 10}], defaultAmount: 10},
]);

// ingredient-nutrients.jsと同じ重量換算。レモン汁は同DBの1ml=1g近似を引き継ぎます。
const ML_GRAMS = freeze({oil: 0.913, olive_oil: 0.91, soy_sauce: 1.181, vinegar: 1, lemon: 1, water: 1});
const componentById = new Map(SALAD_COMPONENTS.map(component => [component.id, component]));
const dressingById = new Map(SALAD_DRESSINGS.map(dressing => [dressing.id, dressing]));
const unique = values => [...new Set(values)];
const own = (value, key) => Object.hasOwn(value, key);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const finiteAmount = (value, maximum) => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= maximum;

function checkedRecord(value, keys, message) {
  if (!isRecord(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error(message);
}

function checkedIngredient(id, data, unit) {
  if (!isRecord(data?.ingredients) || !own(data.ingredients, id) || !isRecord(data.ingredients[id]) || data.ingredients[id].unit !== unit) {
    throw new Error('サラダの材料と単位がDBに見つかりません。');
  }
  if (data.ingredients[id].allergensKnown === false || data.ingredients[id].ingredientsKnown === false) {
    throw new Error('材料の原材料とアレルギー情報を確認してください。');
  }
  return data.ingredients[id];
}

function newId() {
  return `custom-salad-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

/**
 * componentsのamountとdressingAmountは、1皿で食べる可食部のg数。
 * 戻り値は既存v3のマイメニュー形式です。保存先や記録の日時は呼び出し元が決めます。
 */
export function buildSaladRecipe(config, data) {
  checkedRecord(config, ['id', 'components', 'dressingId', 'dressingAmount'], 'サラダの内容を確認してください。');
  const id = own(config, 'id') ? config.id : newId();
  if (typeof id !== 'string' || !/^custom-.+/.test(id) || id.length > 120 || !id.trim()) {
    throw new Error('サラダの識別子を確認してください。');
  }
  const selected = config.components;
  if (!Array.isArray(selected) || !selected.length || selected.length > SALAD_COMPONENTS.length ||
      Object.keys(selected).length !== selected.length) {
    throw new Error('野菜を1種類以上選んでください。');
  }
  const seen = new Set();
  const components = selected.map(part => {
    checkedRecord(part, ['id', 'amount'], '野菜の種類と量を確認してください。');
    const component = componentById.get(part.id);
    if (!component || seen.has(part.id)) throw new Error('野菜の種類が不明か、重複しています。');
    seen.add(part.id);
    if (!finiteAmount(part.amount, 1000)) throw new Error('野菜の量は1種類につき0より大きく1000g以下で入力してください。');
    checkedIngredient(component.ingredientId, data, 'g');
    return {...component, amount: part.amount};
  });
  if (components.reduce((sum, part) => sum + part.amount, 0) > 2000) throw new Error('野菜の合計は1皿2000g以下にしてください。');
  const dressing = dressingById.get(own(config, 'dressingId') ? config.dressingId : 'none');
  if (!dressing) throw new Error('ドレッシングを選んでください。');
  const dressingAmount = own(config, 'dressingAmount') ? config.dressingAmount : dressing.defaultAmount;
  if (dressing.id === 'none' ? dressingAmount !== 0 : !finiteAmount(dressingAmount, 300)) {
    throw new Error(dressing.id === 'none' ? 'ドレッシングなしの場合は量を0gにしてください。' : 'ドレッシングの量は0より大きく300g以下で入力してください。');
  }
  const parts = new Map(components.map(component => [component.ingredientId, component.amount]));
  if (dressing.ingredients.length) {
    const batchWeight = dressing.ingredients.reduce((sum, part) => {
      const unit = own(ML_GRAMS, part.id) ? 'ml' : 'g';
      checkedIngredient(part.id, data, unit);
      return sum + part.amount * (ML_GRAMS[part.id] ?? 1);
    }, 0);
    const scale = dressingAmount / batchWeight;
    for (const part of dressing.ingredients) parts.set(part.id, (parts.get(part.id) ?? 0) + part.amount * scale);
  }
  const ingredients = [...parts].map(([ingredientId, amount]) => ({id: ingredientId, amount}));
  const hasBroccoli = seen.has('broccoli');
  const labels = components.map(component => component.label);
  const sourceNote = `野菜の可食部を選んだ量で記録する1皿です。${hasBroccoli ? 'ブロッコリーは塩を加えずにゆで、湯切りした後の花序の重量です。' : ''}` +
    `ドレッシングは${dressing.id === 'none' ? '加えていません' : `家庭用の配合を${dressingAmount}g使用する概算です`}。` +
    '市販ドレッシングの一律の栄養値ではありません。実際に使う商品の原材料を確認してください。材料と分量、栄養は記録時点の内容で保存します。';
  const steps = [
    '生で使う野菜を洗い、食べない部分を取り除く。水気を切り、表示した可食部の量を用意する。',
    ...(hasBroccoli ? ['ブロッコリーは小房に分けて塩を加えずにゆで、やわらかさを確かめる。湯切りして冷まし、ゆでた花序を表示量に計る。'] : []),
    '野菜を食べやすく切るかちぎり、器に盛る。',
    ...(dressing.ingredients.length ? [dressing.id === 'mayonnaise' ? '表示量のマヨネーズを添える。' : '表示した調味料を混ぜ、選んだ量のドレッシングとして野菜にかける。'] : []),
  ];
  const recipe = {
    id, name: `野菜サラダ（${labels.join('・')}／${dressing.label}）`, role: 'side', family: 'side',
    variantLabel: labels.join('・'), genre: 'その他', minutes: hasBroccoli ? 15 : 10, servings: 1,
    staple: false, mealBase: false, ingredients, steps, custom: true, nature: 'home-cooked',
    portion: {amount: 1, unit: '皿'}, allergensKnown: true, ingredientsKnown: true, shoppingKnown: true,
    manualNutrition: recipeNutrition({servings: 1, ingredients}, data), sourceNote,
  };
  // 共通の原料参照でアレルゲンを引き継ぎ、選んだ材料だけから食品群を計算します。
  const metadata = itemFromRecipe(recipe, data);
  return {...recipe, allergens: unique(metadata.allergens), groups: unique(metadata.groups), proteinSources: unique(metadata.proteinSources)};
}
