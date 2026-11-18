/** 外で食べた料理の量と照合元を一緒に保存し、後日の献立で参照できるようにします。 */
import {createCatalogItem} from './record-actions.js';
import {dateIsValid, MEAL_IDS, validateFrozenItems} from './journal.js';
import {itemFromRecipe} from './nutrition.js';

const newId = () => globalThis.crypto?.randomUUID?.() ?? `dining-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function asName(value, limit, label) {
  if (typeof value !== 'string' || value.length > limit) throw Error(`${label}は${limit}文字以内で入力してください。`);
  return value.trim();
}

/** 実際の店が別の名前なら、その店舗が公表した表示値とは扱いません。 */
export function diningMatchMode(choice, requested, storeName) {
  const source = choice?.item ?? choice?.recipe;
  const mode = requested ?? source?.diningMatch?.mode ?? (source?.restaurant ? 'menu' : 'similar');
  if (!['menu', 'similar'].includes(mode)) throw Error('食べた料理と参考にする料理の関係を選んでください。');
  const referenceStore = source?.restaurant?.storeName;
  const actualStore = storeName ?? source?.diningMatch?.storeName;
  if (referenceStore && actualStore && referenceStore.normalize('NFKC').trim() !== actualStore.normalize('NFKC').trim()) return 'similar';
  return mode;
}

/** 検索した料理または過去の記録の基準量から、実際に食べた量へ換算します。 */
export function createDiningItem(choice, {amount, mode, actualName, storeName} = {}, data) {
  if (!choice || Boolean(choice.recipe) === Boolean(choice.item)) throw Error('参考にする料理を選んでください。');
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) throw Error('食べた量は0より大きい100000以下の数値で入力してください。');
  let item;
  if (choice.recipe) {
    item = createCatalogItem(choice.recipe.id, amount, data);
    // 店舗の栄養表示には食品群が載りません。利用者が紐付けた一般料理を献立の重複判定に使います。
    const genericId = item.restaurant?.genericRecipeId;
    if (genericId) {
      const reference = data.recipes.find(recipe => recipe.id === genericId);
      if (reference) {
        const groups = itemFromRecipe(reference, data);
        item.groups = [...new Set([...item.groups, ...groups.groups])];
        item.proteinSources = [...new Set([...item.proteinSources, ...groups.proteinSources])];
      }
    }
  } else {
    item = structuredClone(choice.item);
    item.id = newId();
    delete item.batchId;
    item.quantity = amount / (item.portion?.amount ?? 1);
    if (!Number.isFinite(item.quantity) || item.quantity <= 0 || item.quantity > 1000) throw Error('記録する量は基準量の1000倍以下にしてください。');
  }
  const prior = item.diningMatch;
  const referenceName = prior?.referenceName ?? item.name;
  // 省略は履歴の複写、明示した空欄は利用者が消した名前です。
  const actual = actualName === undefined ? prior?.actualName ?? item.name : asName(actualName, 200, '食べた料理名') || referenceName;
  const store = storeName === undefined ? prior?.storeName ?? item.restaurant?.storeName ?? '' : asName(storeName, 80, '店名');
  const matchMode = diningMatchMode(choice, mode, store);
  const referenceBasis = prior?.referenceBasis ?? item.nutritionBasis ?? 'unknown';
  item.diningMatch = {mode: matchMode, referenceName,
    actualName: actual, storeName: store, referenceBasis};
  item.name = actual;
  item.shoppingKnown = false;
  // 同名の家庭料理を選んでも、店で使われた原材料は特定できません。
  if (matchMode === 'similar' || referenceBasis !== 'official') {
    item.allergensKnown = false;
    item.ingredientsKnown = false;
  }
  if (matchMode === 'similar') {
    item.nutritionBasis = Object.values(item.nutrition).some(value => value != null) ? 'estimate' : 'unknown';
  } else item.nutritionBasis = referenceBasis;
  return item;
}

/** 主食・おかず・汁物を一つの実食として保存します。呼び出し元の編集用配列とは独立です。 */
export function createDiningEntry({date, meal, items}, data) {
  if (!dateIsValid(date) || !MEAL_IDS.includes(meal)) throw Error('記録する日付と食事を確認してください。');
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) throw Error('食べた料理を1〜100品選んでください。');
  return {id:newId(), date, meal, status:'eaten', note:'外食', items:validateFrozenItems(items, data)};
}
