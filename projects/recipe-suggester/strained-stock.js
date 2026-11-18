/** だしがらを除く料理だけで、乾物1gから汁へ移る成分を見積もる。 */
const keys = ['kcal', 'protein', 'fat', 'carbs', 'fiber', 'salt'];
const fields = values => Object.fromEntries(keys.map((key, index) => [key, values[index]]));
const source = 'https://www.mext.go.jp/content/20260327-mxt_kagsei-mext-000029402_0001.pdf';

// 1000gの水に乾物30gを用いた成分表の試験。出来た汁の重量を乾物重量で割る。
// 昆布を沸騰前に取り出す短時間の調理は、水出しを近似値として使用。
function extract(code, yieldGrams, raw, estimates, note) {
  const factor = yieldGrams / 30 / 100;
  const values = raw.map((value, index) => (value ?? estimates[index]) * factor);
  const rawValues = raw.map(value => value === null ? null : value * factor);
  const db = 'https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=17_' + code + '_7';
  return {
    gramsPerUnit: 1,
    nutritionPerUnit: fields(values),
    rawNutritionPerUnit: fields(rawValues),
    estimatedNutrients: keys.filter((_, index) => raw[index] === null),
    rawNutritionSource: '日本食品標準成分表（八訂）増補2023年 食品番号' + code + '。だし汁の可食部100g値を乾物30gから得た汁' + yieldGrams + 'gで換算。' + db,
    nutritionSource: '乾物をこして残った汁の概算。乾物1gにつき、文部科学省の食品番号' + code + 'のだし汁' + (yieldGrams / 30).toFixed(1) + 'g分を計上する。' + note + ' ' + db + ' ' + source,
  };
}

export const STRAINED_STOCK_INGREDIENTS = {
  stock_kombu_strained: {name:'だし用昆布（取り出す分）', unit:'g', allergens:[], groups:[], proteinSources:[], derivedFrom:['kombu'],
    note:'分量は乾燥昆布の重さ。汁に移った栄養だけを概算します。'},
  stock_bonito_strained: {name:'かつお節（だしをこす分）', unit:'g', allergens:[], groups:[], proteinSources:[], derivedFrom:['bonito'],
    note:'分量は削り節の重さ。こしたあとのだしがらは含めません。'},
};

export const STRAINED_STOCK_NUTRITION = {
  stock_kombu_strained: extract('17020', 880, [4, 0.1, null, 0.9, null, 0.2], {2:0.03, 4:0.1},
    '脂質Trは0.03g/100gで概算。水出しの食物繊維は未測定のため、昆布だし・煮出し（17132）の0.1g/100gを参考値とする。温度や時間で抽出量は変わる。'),
  stock_bonito_strained: extract('17019', 860, [2, 0.4, null, 0, 0, null], {2:0.03, 5:1.2 * 30 / 860},
    '荒節だしを使用。脂質Trは0.03g/100gで概算。だし汁の食塩相当量0.1g/100gは粗く丸められ、乾物に引き直すと元の削り節の総量を超える。だし汁のNa21mg/100gからの換算でも上回るため、削り節（10092）に含まれる食塩1.2g/100gを抽出の上限として見積もる。'),
};

// 手順に従い、こす料理と、細切り・おかかなど乾物も食べる料理を個別に区別する。
export const STRAINED_STOCK_RECIPES = {
  kombu: ['udon-egg','soba-chicken','chicken-tofu-pot','tofu-dried-simmer','egg-tofu-porridge',
    'side-037','soup-001','soup-003','soup-018','soup-027','soup-028','soup-030','side-051','side-060',
    'soup-033','soup-039','soup-040','staple-plain-udon','staple-somen','staple-warm-soba',
    'calendar-soup-cabbage-egg','familiar-mizutaki','familiar-pork-shabu','familiar-yudofu','familiar-side-agedashi-tofu'],
  bonito: ['chicken-oyako','udon-egg','soba-chicken','classic-dashimaki','classic-koya-egg-simmer'],
};
const purchaseIds = {stock_kombu_strained:'kombu', stock_bonito_strained:'bonito'};
export const stockPurchaseId = id => Object.hasOwn(purchaseIds, id) ? purchaseIds[id] : id;
const replacements = new Map();
for (const [filtered, raw] of Object.entries(purchaseIds)) {
  for (const id of STRAINED_STOCK_RECIPES[raw]) {
    if (!replacements.has(id)) replacements.set(id, new Map());
    replacements.get(id).set(raw, filtered);
  }
}
export function applyStrainedStock(recipe) {
  const ids = replacements.get(recipe.id);
  if (!ids) return recipe;
  return {...recipe, ingredients: recipe.ingredients.map(part => ids.has(part.id) ? {...part,id:ids.get(part.id)} : part)};
}
