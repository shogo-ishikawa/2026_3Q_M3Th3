/** 登録直前の量と材料を、保存するスナップショットから説明します。 */
import {dateIsValid, validateFrozenItems} from './journal.js';
import {itemNutrition, sumNutrition} from './nutrition.js';

const MEALS = Object.freeze({breakfast:'朝食', lunch:'昼食', dinner:'夕食', snack:'間食'});
const STATUSES = Object.freeze({eaten:'食べた', planned:'これからの予定'});
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function field(entry, key) {
  const descriptor = Object.getOwnPropertyDescriptor(entry, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw Error('登録する内容を確認してください。');
  return descriptor.value;
}

/**
 * 栄養は記録内の値を使い、現在のレシピから再計算しません。
 * 材料の量には quantity を一度だけ掛けます。名称と単位が未登録なら補いません。
 */
export function describeRegistration(entry, data) {
  if (!isRecord(entry) || !isRecord(data?.ingredients) || !Array.isArray(data?.allergens)) {
    throw Error('登録する料理と材料を確認してください。');
  }
  const date = field(entry, 'date'), meal = field(entry, 'meal'), status = field(entry, 'status');
  if (!dateIsValid(date) || typeof meal !== 'string' || typeof status !== 'string' ||
      !Object.hasOwn(MEALS, meal) || !Object.hasOwn(STATUSES, status)) {
    throw Error('登録先の日付・食事・記録の種類を確認してください。');
  }
  const snapshots = validateFrozenItems(field(entry, 'items'), data);
  if (!snapshots.length) throw Error('登録する料理を1品以上選んでください。');
  const materials = new Map();
  let ingredientsComplete = true;
  const items = snapshots.map(item => {
    const portion = item.portion ?? {amount:1, unit:'人分'};
    const amount = item.quantity * portion.amount;
    if (!Number.isFinite(amount)) throw Error('登録する量を確認してください。');
    if (!item.ingredientsKnown || !item.ingredients.length) ingredientsComplete = false;
    for (const part of item.ingredients) {
      const total = (materials.get(part.id)?.amount ?? 0) + part.amount * item.quantity;
      if (!Number.isFinite(total)) throw Error('登録する材料の量を確認してください。');
      const ingredient = Object.hasOwn(data.ingredients, part.id) ? data.ingredients[part.id] : null;
      const nameKnown = isRecord(ingredient) && typeof ingredient.name === 'string' && ingredient.name.trim() !== '';
      const unitKnown = isRecord(ingredient) && typeof ingredient.unit === 'string' && ingredient.unit.trim() !== '';
      const known = nameKnown && unitKnown;
      if (!known) ingredientsComplete = false;
      materials.set(part.id, {id:part.id, name:nameKnown ? ingredient.name : `${part.id}（名称未登録）`,
        amount:total, unit:unitKnown ? ingredient.unit : null, known});
    }
    return {name:item.name, amount, unit:portion.unit, quantity:item.quantity,
      ...(portion.label === undefined ? {} : {portionLabel:portion.label}), nutrition:itemNutrition(item)};
  });
  return {date, meal, mealLabel:MEALS[meal], status, statusLabel:STATUSES[status],
    items, nutrition:sumNutrition(snapshots), ingredients:[...materials.values()], ingredientsComplete};
}
