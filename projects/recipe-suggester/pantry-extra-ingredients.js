/** 手持ち食材で選び分けるために追加した、既存食材とは別IDの生肉2品。 */
const KEYS = Object.freeze(['kcal', 'protein', 'fat', 'carbs', 'fiber', 'salt']);
const freeze = value => Object.freeze(value);
const perGram = values => freeze(Object.fromEntries(KEYS.map((key, index) => [key, values[index] / 100])));
const beefSource = '日本食品標準成分表（八訂）増補2023年・食品番号11076。輸入牛もも・皮下脂肪なし・生の可食部100g当たり133kcal、たんぱく質20.0g、脂質6.7g、炭水化物0.4g、食物繊維(0)g、食塩相当量0.1g。食物繊維の(0)は原表の推定値。 https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=11_11076_7';
const beefProfile = perGram([133, 20, 6.7, .4, 0, .1]);

/** 旧456食材の装飾後に呼び、新規2品だけを返します。元の食材は変更しません。 */
export function createPantryExtraIngredients(ingredients) {
  const beef = ingredients?.beef_minced, pork = ingredients?.pork_minced;
  if (!beef || !pork || typeof beef.nutritionSource !== 'string' || !beef.nutritionSource ||
      typeof pork.nutritionSource !== 'string' || !pork.nutritionSource || KEYS.some(key => typeof beef.nutritionPerUnit?.[key] !== 'number' || !Number.isFinite(beef.nutritionPerUnit[key]) || beef.nutritionPerUnit[key] < 0 ||
      typeof pork.nutritionPerUnit?.[key] !== 'number' || !Number.isFinite(pork.nutritionPerUnit[key]) || pork.nutritionPerUnit[key] < 0)) {
    throw Error('合い挽き肉の概算に使う牛・豚ひき肉の栄養値を確認してください。');
  }
  const mixedProfile = freeze(Object.fromEntries(KEYS.map(key => [key,
    Number(((beef.nutritionPerUnit[key] + pork.nutritionPerUnit[key]) / 2).toFixed(8))])));
  const mixedSource = `牛ひき肉50％・豚ひき肉50％（生肉の重量比）とする参考配合。公的な合い挽き肉の成分値ではなく、登録済みの牛ひき肉と豚ひき肉の各1g当たり栄養値を同じ重さで平均した概算。牛：${beef.nutritionSource} 豚：${pork.nutritionSource}`;
  return freeze({
    beef_round_raw: freeze({
      name: '輸入牛もも肉（皮下脂肪なし・生）', unit: 'g',
      allergens: freeze(['beef']), groups: freeze(['protein']), proteinSources: freeze(['meat']), derivedFrom: freeze(['beef']),
      gramsPerUnit: 1, nutritionPerUnit: beefProfile, rawNutritionPerUnit: beefProfile,
      nutritionSource: beefSource, rawNutritionSource: beefSource, estimatedNutrients: freeze([]),
      note: '皮下脂肪を除いた輸入牛ももの生の可食重量です。和牛・脂身付き・加熱後の重量とは区別します。',
    }),
    beef_pork_mince_raw: freeze({
      name: '牛豚合い挽き肉（牛50％・豚50％・生の参考配合）', unit: 'g',
      allergens: freeze(['beef', 'pork']), groups: freeze(['protein']), proteinSources: freeze(['meat']), derivedFrom: freeze(['beef_minced', 'pork_minced']),
      gramsPerUnit: 1, nutritionPerUnit: mixedProfile,
      rawNutritionPerUnit: freeze(Object.fromEntries(KEYS.map(key => [key, null]))),
      rawNutritionSource: 'この参考配合を分析した栄養値は未登録です。市販品の牛・豚の割合や脂肪量は製品で異なります。',
      nutritionSource: mixedSource, estimatedNutrients: KEYS,
      note: '牛と豚を同じ重量で混ぜる計算用の例です。購入品の配合や栄養表示が分かる場合は、その値を優先してください。',
    }),
  });
}
