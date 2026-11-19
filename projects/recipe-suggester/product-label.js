import {NUTRIENT_KEYS, recipeNutrition} from './nutrition.js';

// A label's reference amount is independent of the quantity the person ate.
export function labelUnits(portion) {
  return ['g', 'ml'].includes(portion.unit) ? [portion.unit] : [portion.unit, 'g', 'ml'];
}

const positive = value => Number.isFinite(value) && value > 0 && value <= 1e7;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function validateProductLabel(source, portion) {
  if (!record(source) || Object.keys(source).some(key => !['name','unit','amount','unitSize','nutrition'].includes(key)) ||
      typeof source.name !== 'string' || source.name.length > 200 || !positive(portion?.amount) ||
      !labelUnits(portion).includes(source.unit) || !positive(source.amount)) {
    throw Error('商品名と栄養表示の基準量を確認してください。');
  }
  if (source.unit === portion.unit ? source.unitSize !== null : !positive(source.unitSize)) {
    throw Error(`1${portion.unit}に入っている量を確認してください。`);
  }
  if (!record(source.nutrition) || Object.keys(source.nutrition).some(key => !NUTRIENT_KEYS.includes(key))) throw Error('商品の栄養表示を確認してください。');
  const nutrition = {};
  for (const key of NUTRIENT_KEYS) {
    const value = source.nutrition[key];
    if (value !== null && !(Number.isFinite(value) && value >= 0 && value <= 1e7)) throw Error('栄養表示は0以上の数値で入力してください。');
    nutrition[key] = value;
  }
  if (NUTRIENT_KEYS.every(key => nutrition[key] === null)) throw Error('商品に表示された栄養値を1項目以上入力してください。');
  return {name:source.name.trim(), unit:source.unit, amount:source.amount, unitSize:source.unitSize, nutrition};
}

export function applyProductLabel(item, source, data) {
  if (item.batchId || item.diningMatch || item.restaurant || item.ingredientEdit?.baseChanged) throw Error('この食事の商品の配合を確認してください。');
  const portion = item.portion ?? {amount:1, unit:'人分'};
  const label = validateProductLabel(source, portion);
  const scale = portion.amount * (label.unitSize ?? 1) / label.amount;
  const nutrition = Object.fromEntries(NUTRIENT_KEYS.map(key => [key, label.nutrition[key] === null ? null : label.nutrition[key] * scale]));
  if (NUTRIENT_KEYS.some(key => nutrition[key] !== null && !(Number.isFinite(nutrition[key]) && nutrition[key] <= 1e7))) throw Error('基準量と1個当たりの内容量を確認してください。');
  const out = {...item, nutrition, nutritionBasis:'manual', productLabel:label};
  if (item.ingredientEdit) {
    const edit = item.ingredientEdit;
    const extra = edit.additions.every(part=>Object.hasOwn(data.ingredients,part.id))
      ? recipeNutrition({servings:1, ingredients:edit.additions}, data) : null;
    out.ingredientEdit = {...edit, base:{...edit.base, nutrition, nutritionBasis:'manual'}};
    out.nutritionBasis = 'mixed';
    out.nutrition = Object.fromEntries(NUTRIENT_KEYS.map(key => {
      // Preserve the contribution recorded for additions when both totals are known.
      const previous = item.nutrition[key], base = edit.base.nutrition[key];
      const addition = previous !== null && base !== null ? Math.max(0,previous-base) : extra?.[key] ?? null;
      return [key, nutrition[key] === null || addition === null ? null : nutrition[key]+addition];
    }));
  }
  return out;
}
