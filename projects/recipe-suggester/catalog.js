/** メニューの大分類と1人分の表示量。記録する栄養はquantity倍率で扱います。 */
export const CATALOG_CATEGORIES = Object.freeze([
  ['rice', 'ご飯', 'staple'], ['onigiri', 'おにぎり', 'staple'],
  ['bread', 'パン・トースト', 'staple'], ['udon', 'うどん', 'staple'],
  ['soba', 'そば', 'staple'], ['yakisoba', '焼きそば', 'staple'],
  ['pasta', 'パスタ', 'staple'], ['curry', 'カレーライス', 'staple'],
  ['pizza', 'ピザ', 'staple'], ['fried-rice', 'チャーハン・炒めご飯', 'staple'],
  ['donburi', '丼', 'staple'], ['ramen', 'ラーメン', 'staple'],
  ['somen', 'そうめん', 'staple'], ['oatmeal', 'オートミール', 'staple'],
  ['other-staple', 'その他の主食', 'staple'],
  ['main', '主菜', 'main'], ['side', '副菜', 'side'],
  ['miso-soup', 'みそ汁', 'soup'], ['soup', 'スープ・汁物', 'soup'],
  ['water', '水・炭酸水', 'drink'], ['tea', 'お茶・紅茶', 'drink'],
  ['coffee', 'コーヒー', 'drink'], ['milk', '牛乳・豆乳', 'drink'],
  ['juice', 'ジュース', 'drink'], ['soft-drink', 'その他の飲み物', 'drink'],
  ['snack', 'スナック', 'snack'], ['sweets', 'お菓子', 'snack'],
  ['dessert', 'スイーツ', 'snack'], ['cheese', 'チーズ', 'snack'],
  ['hot-snack', 'ホットスナック', 'snack'], ['fruit', '果物', 'snack'],
  ['nuts', 'ナッツ', 'snack'], ['yoghurt', 'ヨーグルト', 'snack'],
].map(([id, label, role]) => Object.freeze({id, label, role})));

const categories = new Map(CATALOG_CATEGORIES.map(category => [category.id, category]));
const portionUnits = new Set(['g', 'ml', '個', '皿', '杯', '枚', '袋', '人分']);
const completeFamilies = new Set(['pasta', 'curry', 'fried-rice', 'udon', 'soba', 'yakisoba', 'donburi', 'ramen', 'pizza', 'somen']);
const riceIngredients = new Set(['rice', 'brown_rice', 'cooked_barley']);
const drinkFlavourings = new Set(['sugar', 'salt', 'ginger', 'lemon_slice']);
const fruitIds = new Set(['snack-apple', 'snack-orange', 'snack-kiwi', 'snack-banana', 'snack-peach', 'snack-grape', 'snack-strawberry', 'snack-blueberry', 'snack-fruit-plate']);
const legacyFamily = new Map([
  ['plain-rice', 'rice'], ['salmon-fried-rice', 'rice'],
  ['rice-egg-omelette', 'fried-rice'], ['chicken-pilaf', 'fried-rice'],
  ['soy-milk-risotto', 'rice'], ['egg-tofu-porridge', 'rice'],
]);
const normalise = text => String(text ?? '').normalize('NFKC').toLocaleLowerCase('ja-JP').trim();
const validAmount = value => typeof value === 'number' && Number.isFinite(value) && value > 0;

function checkRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) throw new Error('メニューの情報を確認してください。');
}

/** 古いIDを保ったまま、従来の主菜扱いの麺や丼も主食の一覧へまとめます。 */
export function recipeFamily(recipe) {
  checkRecipe(recipe);
  if (recipe.family !== undefined) {
    if (!categories.has(recipe.family)) throw new Error('メニューの大分類が登録されていません。');
    return recipe.family;
  }
  const id = String(recipe.id ?? ''), name = String(recipe.name ?? ''), text = normalise(`${id} ${name}`);
  if (recipe.role === 'soup') return /みそ汁|味噌汁|豚汁|miso-soup/.test(text) ? 'miso-soup' : 'soup';
  if (recipe.role === 'drink') {
    if (/water|レモン水|炭酸水/.test(text) || name === '水') return 'water';
    if (/coffee|latte|cafe-au-lait|コーヒー|カフェオレ|ラテ/.test(text)) return 'coffee';
    if (/tea|紅茶|緑茶|ほうじ茶|麦茶|ウーロン茶|烏龍茶/.test(text)) return 'tea';
    if (/juice|ジュース/.test(text)) return 'juice';
    if (/milk|soy-milk|牛乳|豆乳/.test(text) && !/cocoa|ココア|yogurt|yoghurt|ヨーグルト/.test(text)) return 'milk';
    return 'soft-drink';
  }
  if (recipe.role === 'snack') {
    if (/hot-snack|chicken|karaage|takoyaki|fries|nikuman|唐揚|から揚|チキン|たこ焼|フライドポテト|肉まん/.test(text)) return 'hot-snack';
    if (/yogurt|yoghurt|ヨーグルト/.test(text)) return 'yoghurt';
    if (/cheese|チーズ/.test(text)) return 'cheese';
    if (/nuts|almond|walnut|cashew|peanut|ナッツ|アーモンド|くるみ|カシューナッツ|落花生/.test(text)) return 'nuts';
    if (fruitIds.has(id) || /フルーツ皿|カットフルーツ/.test(name)) return 'fruit';
    if (/pudding|cake|ice-cream|デザート|プリン|ケーキ|アイス|スイーツ|パフェ|ゼリー|焼きバナナ|レモン蒸し/.test(text)) return 'dessert';
    if (/cookie|biscuit|chocolate|candy|クッキー|ビスケット|チョコ|飴|キャンディ|ボール/.test(text)) return 'sweets';
    return 'snack';
  }
  if (recipe.role === 'side') return 'side';
  if (legacyFamily.has(id)) return legacyFamily.get(id);
  if (/onigiri|omusubi|おにぎり|むすび/.test(text)) return 'onigiri';
  if (/udon|うどん/.test(text)) return 'udon';
  if (/yakisoba|焼きそば/.test(text)) return 'yakisoba';
  if (/ramen|ラーメン|らーめん|中華そば/.test(text)) return 'ramen';
  if (/soba|そば|蕎麦/.test(text)) return 'soba';
  if (/somen|そうめん|素麺/.test(text)) return 'somen';
  if (/pasta|spaghetti|パスタ|スパゲティ|ペペロンチーノ|カルボナーラ|ジェノベーゼ|ボロネーゼ|アラビアータ|ペスカトーレ/.test(text)) return 'pasta';
  if (/pizza|ピザ/.test(text)) return 'pizza';
  if (/fried-rice|炒飯|チャーハン|ピラフ|オムライス/.test(text)) return 'fried-rice';
  if (/rice-bowl|donburi|taco-rice|丼|タコライス/.test(text)) return 'donburi';
  if ((recipe.staple || recipe.role === 'staple') && /curry|カレー/.test(text)) return 'curry';
  if (/oatmeal|oat-|オートミール/.test(text)) return 'oatmeal';
  if (/bread|toast|sandwich|パン(?!ケーキ)|トースト|サンド/.test(text)) return 'bread';
  if ((recipe.staple || recipe.role === 'staple') && /rice|porridge|ご飯|白米|玄米|おかゆ|がゆ|雑炊|リゾット/.test(text)) return 'rice';
  if (recipe.role === 'staple' || recipe.staple) return 'other-staple';
  return 'main';
}

/** 一品で主食を含む料理なら、別の主菜を重ねないための目印にします。 */
export function isCompleteMeal(recipe) {
  checkRecipe(recipe);
  if (recipe.mealBase !== undefined) {
    if (typeof recipe.mealBase !== 'boolean') throw new Error('一品料理の設定を確認してください。');
    return recipe.mealBase;
  }
  return completeFamilies.has(recipeFamily(recipe)) || (recipe.role === 'main' && recipe.staple === true);
}

function portion(amount, unit, label) {
  if (!validAmount(amount) || !portionUnits.has(unit)) throw new Error('1人分の分量と単位を確認してください。');
  return {amount, unit, label: typeof label === 'string' && label.trim() ? label.trim() : `1人分＝${amount.toLocaleString('ja-JP', {maximumFractionDigits: 3})} ${unit}`};
}

/** amountは基準レシピの1人分の量。実際の記録は表示量/amount倍に換算します。 */
export function recipePortion(recipe, data) {
  checkRecipe(recipe);
  if (recipe.portion !== undefined) {
    if (!recipe.portion || typeof recipe.portion !== 'object' || Array.isArray(recipe.portion)) throw new Error('1人分の分量を確認してください。');
    return portion(recipe.portion.amount, recipe.portion.unit, recipe.portion.label);
  }
  const family = recipeFamily(recipe), parts = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  const servings = validAmount(recipe.servings) ? recipe.servings : 1;
  if (family === 'onigiri') return portion(1, '個');
  if (family === 'rice') {
    // 粥・雑炊・リゾットは水分を多く含み、米の重さを完成重量にはできません。
    if (/porridge|risotto|おかゆ|がゆ|雑炊|リゾット/.test(`${recipe.id ?? ''} ${recipe.name ?? ''}`)) return portion(1, '杯');
    const grams = parts.filter(part => riceIngredients.has(part.id) && validAmount(part.amount)).reduce((sum, part) => sum + part.amount / servings, 0);
    // 旧データには完成重量がないため、炊飯済み穀類の量を基準にします。
    return portion(grams || 150, 'g', grams ? `1人分の炊飯済み穀類 ${grams.toLocaleString('ja-JP', {maximumFractionDigits: 1})} gを基準` : undefined);
  }
  if (family === 'bread') return portion(1, isCompleteMeal(recipe) ? '皿' : '枚');
  if (categories.get(family).role === 'drink') {
    const ml = parts.filter(part => data?.ingredients?.[part.id]?.unit === 'ml' && validAmount(part.amount)).reduce((sum, part) => sum + part.amount / servings, 0);
    // ミキサーで混ぜる果物、ヨーグルト、ココア等のgを容量へ換算しません。
    // 完成容量が明示されていなければ1杯として扱います。少量の風味付け
    // （液体量の5%以下の砂糖・塩・しょうが等）は液体mlを基準にします。
    const extras = parts.filter(part => validAmount(part.amount) && data?.ingredients?.[part.id]?.unit !== 'ml');
    const flavouringGrams = extras.reduce((sum, part) => sum + part.amount / servings, 0);
    const unknownVolume = extras.some(part => data?.ingredients?.[part.id]?.unit !== 'g' ||
      !drinkFlavourings.has(part.id)) || flavouringGrams > ml * 0.05;
    return ml > 0 && !unknownVolume ? portion(ml, 'ml') : portion(1, '杯');
  }

  if (['miso-soup', 'soup'].includes(family)) return portion(1, '杯');
  if (['fruit', 'nuts', 'yoghurt', 'cheese'].includes(family) && parts.length && parts.every(part => data?.ingredients?.[part.id]?.unit === 'g' && validAmount(part.amount))) {
    return portion(parts.reduce((sum, part) => sum + part.amount / servings, 0), 'g');
  }
  return portion(1, '皿');
}

export function quantityFromAmount(recipe, data, amount) {
  if (!validAmount(amount)) throw new Error('食べる量は0より大きい数値で入力してください。');
  const quantity = amount / recipePortion(recipe, data).amount;
  if (!validAmount(quantity)) throw new Error('食べる量を確認してください。');
  return quantity;
}

function matchesQuery(recipe, query, familyId = recipeFamily(recipe)) {
  if (!query) return true;
  const family = categories.get(familyId);
  return normalise([recipe.name, recipe.variantLabel, family.label, ...(recipe.tags ?? []), ...(recipe.ingredients ?? []).map(part => part.name ?? part.id)].join(' ')).includes(query);
}

function recipeList(recipes) {
  if (!Array.isArray(recipes)) throw new Error('メニューの一覧を確認してください。');
  recipes.forEach(checkRecipe);
  return recipes;
}

export function catalogFamilies(recipes, {role = 'all', query = ''} = {}) {
  const list = recipeList(recipes), text = normalise(query), counts = new Map();
  for (const recipe of list) {
    const family = recipeFamily(recipe);
    if ((role === 'all' || categories.get(family).role === role) && matchesQuery(recipe, text, family)) counts.set(family, (counts.get(family) ?? 0) + 1);
  }
  return CATALOG_CATEGORIES.filter(category => counts.has(category.id)).map(category => ({id: category.id, label: category.label, count: counts.get(category.id)}));
}

const variantOrder = {
  rice: ['白米', '白ご飯', 'ご飯', '玄米', '炊き込み', 'わかめ', '豆ご飯', '押し麦', 'おかゆ', 'がゆ', '混ぜ'],
  onigiri: ['塩', '鮭', 'さけ', '梅', 'ツナマヨ', '昆布', 'おかか', '明太子', '焼き'],
  udon: ['かけ', 'きつね', 'たぬき', 'わかめ', '肉', '天ぷら', 'カレー'],
  soba: ['かけ', 'きつね', 'たぬき', 'わかめ', '肉', '天ぷら', 'カレー'],
  pasta: ['ペペロンチーノ', 'カルボナーラ', 'ジェノベーゼ', 'ボロネーゼ', 'アラビアータ', 'ペスカトーレ', 'ナポリタン', 'ミートソース', '和風', 'クリーム', 'トマト'],
  water: ['水', 'レモン水', '炭酸水'],
};

function variantRank(recipe, family) {
  const label = recipe.variantLabel ?? recipe.name ?? '';
  const options = variantOrder[family] ?? [];
  const exact = options.findIndex(term => label === term);
  if (exact >= 0) return exact * 10;
  const partial = options.findIndex(term => !['ご飯', '水'].includes(term) && label.includes(term));
  return partial >= 0 ? partial * 10 + 1 : 1000;
}

export function catalogVariants(recipes, family, {query = ''} = {}) {
  if (!categories.has(family)) return [];
  const text = normalise(query);
  return recipeList(recipes).map((recipe, index) => ({recipe, index})).filter(({recipe}) => recipeFamily(recipe) === family && matchesQuery(recipe, text))
    .sort((a, b) => variantRank(a.recipe, family) - variantRank(b.recipe, family) || a.index - b.index).map(({recipe}) => recipe);
}
