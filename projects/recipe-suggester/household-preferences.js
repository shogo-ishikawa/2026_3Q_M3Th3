/** 人数は調理と買い物の分量にだけ使い、栄養の記録は1人分のままにする。 */
export const HOUSEHOLD_AGES = Object.freeze({
  adult: '18〜64歳', senior: '65歳以上', teen: '13〜17歳',
  child: '6〜12歳', preschool: '0〜5歳', unspecified: '年代を指定しない',
});
export const MAX_PLAN_SERVINGS = 8;

export function householdSize(household) {
  return Object.values(household?.counts ?? {}).reduce((sum, count) => sum + count, 0);
}

export function validateHousehold(value) {
  const record = object => object && typeof object === 'object' && !Array.isArray(object);
  if (!record(value) || Object.keys(value).some(key => !['counts', 'useForServings'].includes(key)) ||
      typeof value.useForServings !== 'boolean' || !record(value.counts) ||
      Object.keys(value.counts).some(key => !Object.hasOwn(HOUSEHOLD_AGES, key))) {
    throw Error('家族構成の年代と人数を確認してください。');
  }
  const counts = {};
  for (const key of Object.keys(HOUSEHOLD_AGES)) {
    const count = Object.hasOwn(value.counts, key) ? value.counts[key] : 0;
    if (!Number.isSafeInteger(count) || count < 0 || count > 99) {
      throw Error('年代ごとの人数は0〜99の整数で入力してください。');
    }
    counts[key] = count;
  }
  const size = householdSize({counts});
  if (!size) throw Error('家族の人数を1人以上入力してください。');
  return {counts, useForServings: value.useForServings && size <= MAX_PLAN_SERVINGS};
}

export function defaultServings(settings, fallback = settings.servings ?? 2) {
  const household = settings.household;
  const size = householdSize(household);
  return household?.useForServings && size >= 1 && size <= MAX_PLAN_SERVINGS ? size : fallback;
}

// 消費者庁「硬い豆やナッツ類は5歳以下の子どもには食べさせないで！」と、
// こども家庭庁の誤嚥事故防止のための食材整理表を参考に、粒と切り餅の材料を照合する。
// 原料の系統まで展開すると、ペーストや豆腐にも同じ食感があると誤認してしまう。
const PRESCHOOL_EXCLUDED_PARTS = new Set([
  'almond', 'walnut', 'cashew', 'peanut', 'pine_nuts', 'palette_pistachio', 'palette_macadamia',
  'confectionery_almond_chocolate', 'confectionery_chocoball', 'confectionery_kakinotane',
  'confectionery_miino', 'dish_mochi',
]);
const ROASTED_BEANS = /(?:福豆(?!腐)|(?:豆まき|節分)(?:用の?|の)?豆|(?:いり|炒り|煎り)(?:大豆|黒豆|豆(?!腐))|(?:大豆|黒豆)の(?:乾煎り|乾炒り))/u;

export function householdAllowsRecipe(recipe, household, data) {
  if (!(household?.counts?.preschool > 0)) return true;
  if (ROASTED_BEANS.test(recipe.name)) return false;
  return !(recipe.ingredients ?? []).some(({id, name}) =>
    PRESCHOOL_EXCLUDED_PARTS.has(id) || ROASTED_BEANS.test(name ?? data?.ingredients?.[id]?.name ?? ''));
}
