/** 肉の選択用。牛もつを牛の筋肉と取り違えず、計量する状態ごとに登録します。 */
const freeze = value => {
  if (value && typeof value === 'object') {Object.values(value).forEach(freeze); Object.freeze(value);}
  return value;
};
const keys = ['kcal', 'protein', 'fat', 'carbs', 'fiber', 'salt'];
const details = {
  meat_beef_small_intestine_raw: {
    name:'牛もつ（小腸・生・味付けなし）', code:'11098', values:[268, 9.9, 26.1, 0, 0, 0.2],
    note:'下ゆで前の生の可食部重量です。ゆでた後の重さとは区別します。下ゆでで流れ出る脂や水分の変化は差し引かない概算です。',
  },
  meat_beef_rumen_boiled: {
    name:'牛もつ（ミノ・第一胃・ゆで・味付けなし）', code:'11094', values:[166, 24.5, 8.4, 0, 0, 0.1],
    note:'下ゆで後に水気を切った第一胃（ミノ）の可食部重量です。牛小腸や混合もつ、味付け済み製品とは栄養が異なります。',
  },
};
export const MEAT_CHOICE_INGREDIENTS = freeze(Object.fromEntries(Object.entries(details).map(([id, food]) => [id, {
  name:food.name, unit:'g', allergens:['beef'], groups:['protein'], proteinSources:['meat'], derivedFrom:['beef'], note:food.note,
}])));
export const MEAT_CHOICE_NUTRITION = freeze(Object.fromEntries(Object.entries(details).map(([id, food]) => {
  const values = Object.fromEntries(keys.map((key, index) => [key, food.values[index] / 100]));
  const source = `日本食品標準成分表（八訂）増補2023年（2026-03-27正誤対応）食品番号${food.code}の可食部100g値を1gへ換算。食物繊維(0)は0として登録。確認日2026-11-13。https://fooddb.mext.go.jp/details/details.pl?ITEM_NO=11_${food.code}_7 ${food.note}`;
  return [id, {gramsPerUnit:1, nutritionPerUnit:values, rawNutritionPerUnit:{...values}, nutritionSource:source, rawNutritionSource:source, estimatedNutrients:[]}];
})));
