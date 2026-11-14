/** 料理ごとに買う材料を選び、合算した後で家の在庫を一度だけ差し引きます。 */
import {dateIsValid} from './journal.js';
import {INGREDIENT_GROUPS, ingredientGroup} from './shopping-categories.js';

const MEAL_LABELS = {breakfast: '朝食', lunch: '昼食', dinner: '夕食', snack: '間食'};
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const validServings = value => Number.isInteger(value) && value >= 1 && value <= 8;
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 500;

function checkData(data) {
  if (!data?.ingredients || typeof data.ingredients !== 'object') throw Error('食材の一覧を確認してください。');
}

function menuItem(item) {
  if (!item || typeof item.name !== 'string' || !item.name.trim() ||
      !positive(item.quantity) || !Array.isArray(item.ingredients)) throw Error('買い物に使う料理と分量を確認してください。');
  for (const part of item.ingredients) {
    if (!validId(part.id) || !positive(part.amount)) throw Error('料理の材料と必要量を確認してください。');
  }
}

/** 予定の各料理を独立した選択肢にします。食事・料理IDの組を使い、同名料理も区別します。 */
export function shoppingMenusFromEntries(entries, data, {from, to, servings = 2} = {}) {
  checkData(data);
  if (!Array.isArray(entries) || !dateIsValid(from) || !dateIsValid(to) || from > to || !validServings(servings)) {
    throw Error('買い物の期間と人数を確認してください。');
  }
  const menus = [], seen = new Set();
  for (const entry of entries) {
    if (entry.status !== 'planned' || entry.date < from || entry.date > to) continue;
    if (!dateIsValid(entry.date) || !validId(entry.id) || !Array.isArray(entry.items) || !MEAL_LABELS[entry.meal]) {
      throw Error('予定の献立の形式を確認してください。');
    }
    // メモだけの予定は表示側で注意を出します。架空の食事スナップショットは作りません。
    for (const item of entry.items) {
      menuItem(item);
      if (!validId(item.id)) throw Error('料理の識別子を確認してください。');
      const id = JSON.stringify([entry.id, item.id]);
      if (seen.has(id)) throw Error('買い物に使う料理の識別子が重複しています。');
      seen.add(id);
      menus.push({id, item: structuredClone(item), servings,
        label: `${entry.date} ${MEAL_LABELS[entry.meal]}`});
    }
  }
  return menus;
}

/** 選ばれた材料だけを集計。省く調味料は別に返し、数量の出所を残します。 */
export function buildShoppingChecklist(selections, data, {pantry = [], omittedIds = []} = {}) {
  checkData(data);
  if (!Array.isArray(selections) || !Array.isArray(pantry) || !Array.isArray(omittedIds) ||
      omittedIds.some(id => typeof id !== 'string')) throw Error('買い物の選択内容を確認してください。');
  const omitted = new Set(omittedIds), items = new Map(), missingMenus = [], seen = new Set();
  const stock = new Map();
  for (const part of pantry) {
    if (!Object.hasOwn(data.ingredients, part.id) || !nonnegative(part.amount) || stock.has(part.id)) {
      throw Error('手持ちの食材の量を確認してください。');
    }
    stock.set(part.id, part.amount);
  }
  for (const menu of selections) {
    if (!menu || !validId(menu.id) || seen.has(menu.id) || !validServings(menu.servings) || !Array.isArray(menu.ingredientIds) ||
        menu.ingredientIds.some(id => typeof id !== 'string') || new Set(menu.ingredientIds).size !== menu.ingredientIds.length) {
      throw Error('料理ごとの買い物の選択を確認してください。');
    }
    seen.add(menu.id);
    const item = menu.item;
    menuItem(item);
    const possible = new Set(item.ingredients.map(part => part.id));
    if (menu.ingredientIds.some(id => !possible.has(id))) throw Error('料理に含まれない食材が選ばれています。');
    // 作り置きの取り分けと外食は、原材料を改めて買いません。
    if (item.batchId || item.restaurant) continue;
    const selected = new Set(menu.ingredientIds);
    let missing = !item.ingredients.length || !item.ingredientsKnown;
    // 材料未確認の料理は、買う商品と量を別途確認できた場合に限って集計します。
    const canAggregate = item.ingredientsKnown === true || item.shoppingKnown === true;
    const sourceAmounts = new Map();
    for (const part of item.ingredients) {
      if (!Object.hasOwn(data.ingredients, part.id)) {missing = true; continue;}
      if (!selected.has(part.id) || !canAggregate) continue;
      const ingredient = data.ingredients[part.id];
      if (typeof ingredient.name !== 'string' || typeof ingredient.unit !== 'string' || !ingredient.unit) {
        missing = true; continue;
      }
      const needed = part.amount * item.quantity * menu.servings;
      if (!positive(needed)) throw Error('買い物の必要量が大きすぎます。');
      sourceAmounts.set(part.id, (sourceAmounts.get(part.id) ?? 0) + needed);
    }
    for (const [id, needed] of sourceAmounts) {
      const ingredient = data.ingredients[id];
      if (!items.has(id)) items.set(id, {id, name: ingredient.name, unit: ingredient.unit, required: 0, stock: 0, buy: 0, sources: []});
      const total = items.get(id);
      total.required += needed;
      if (!positive(total.required)) throw Error('買い物の合計量が大きすぎます。');
      total.sources.push({menuId: menu.id, name: item.name, amount: needed, unit: ingredient.unit, servings: menu.servings});
    }
    if (missing) missingMenus.push({menuId: menu.id, name: item.name,
      reason: canAggregate && item.ingredients.length ? '分かる材料・商品だけを集計しています。原材料や商品表示を確認してください。' : '材料が未確認のため、この料理は合計に含めていません。'});
  }
  const rank = new Map(INGREDIENT_GROUPS.map((group, index) => [group.id, index]));
  const rows = [...items.values()];
  for (const item of rows) {item.stock = stock.get(item.id) ?? 0; item.buy = Math.max(0, item.required - item.stock);}
  rows.sort((a, b) => rank.get(ingredientGroup(a.id, data)) - rank.get(ingredientGroup(b.id, data)) || a.name.localeCompare(b.name, 'ja'));
  return {items: rows.filter(item => !omitted.has(item.id)), missingMenus,
    omittedItems: rows.filter(item => omitted.has(item.id))};
}
