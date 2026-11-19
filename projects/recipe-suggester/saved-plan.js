import {eligibleRecipes, planDayRecipesAllowed} from './planner.js';

// 栄養の集計は食事の記録から計算します。提案の下書きは編集に使う情報だけを保存します。
export const draftDishKey = (date, meal, recipeId) => JSON.stringify([date, meal, recipeId]);

export function capturePlan(plan, shoppingIds) {
  const {household, dislikedIngredients, ...settings} = plan.settings;
  return {
    settings,
    warnings: plan.warnings,
    days: plan.days.map(({nutritionBasis, ...day}) => ({
      ...day,
      itemIds: Object.fromEntries(day.recipeIds.map(id => [id, shoppingIds.get(draftDishKey(day.date, day.meal, id))])
        .filter(([, itemId]) => itemId !== undefined)),
    })),
  };
}

export function restorePlan(draft, settings, data) {
  if (!draft) return {plan: null, shoppingIds: new Map()};
  // 旧版のデータで料理が削除・変更されていても、食事記録本体は開けます。
  const selected = new Set(draft.days.flatMap(day => day.recipeIds));
  const candidates = {...data, recipes: data.recipes.filter(recipe => selected.has(recipe.id))};
  const allowed = new Set(eligibleRecipes(settings, candidates, {forPlan:true}).map(recipe => recipe.id));
  const proposalSettings = {...settings, mealPreferences:draft.settings.mealPreferences};
  if (draft.days.some(day => !planDayRecipesAllowed(day, proposalSettings, candidates, allowed))) {
    return {plan: {ok: false, days: [], warnings: ['保存した下書きに現在の条件で選べない料理があります。献立を作り直してください。']}, shoppingIds: new Map()};
  }
  const shoppingIds = new Map();
  const days = draft.days.map(({itemIds, ...day}) => {
    for (const [id, itemId] of Object.entries(itemIds)) {
      shoppingIds.set(draftDishKey(day.date, day.meal, id), itemId);
    }
    return day;
  });
  const restored = {...draft.settings, allergens: settings.allergens, excludedIngredients: settings.excludedIngredients};
  if (settings.dislikedIngredients?.length) restored.dislikedIngredients = [...settings.dislikedIngredients];
  else delete restored.dislikedIngredients;
  if (settings.household) restored.household = {...settings.household, useForServings:false};
  else delete restored.household;
  return {plan: {ok: true, mode: 'calendar', settings: restored, warnings: draft.warnings, days, missingRoles: []}, shoppingIds};
}
