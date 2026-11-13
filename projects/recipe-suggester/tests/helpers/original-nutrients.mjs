// 補完前の原表プロフィールで、過去版の固定ハッシュを引き続き照合します。
// 今回の概算値は nutrition-estimates.test.mjs で独立に確認します。
export function originalNutrients(ingredient) {
  // v3.9で追加した重量換算メタデータは、旧版の栄養・分量の固定契約に含めません。
  const {rawNutritionPerUnit, rawNutritionSource, estimatedNutrients, gramsPerUnit, ...original} = ingredient;
  return {...original, nutritionPerUnit:rawNutritionPerUnit, nutritionSource:rawNutritionSource};
}

// prepared-foods.jsは明示した1食分配合からmanualNutritionを読み込み時に合成します。
// 新しい材料プロフィールにより埋まる、旧版でnullだった成分だけを投影で戻します。
// 既知の成分、材料・量・工程などは引き続き同じ固定ハッシュで検査します。
const formerlyUnknown = new Map([
  ['prepared-retort-keema-curry', ['fiber']],
  ['prepared-retort-gyudon', ['fat', 'fiber']],
  ['prepared-retort-chukadon', ['fiber']],
  ['prepared-burger-teriyaki', ['fat', 'fiber']],
  ['prepared-burger-chicken', ['fiber']],
  ['prepared-burger-fish', ['fiber']],
]);
export function originalRecipe(recipe) {
  const keys = formerlyUnknown.get(recipe.id);
  return keys ? {...recipe, manualNutrition: {...recipe.manualNutrition,
    ...Object.fromEntries(keys.map(key => [key, null]))}} : recipe;
}
