/** 料理ごとに買う材料を選び、合算した後で家の在庫を一度だけ差し引きます。 */
import {defaultServings} from './household-preferences.js';
import {stockPurchaseId} from './strained-stock.js';
import {favouriteKey} from './favourites.js';
import {dateIsValid, shoppingServingsFor} from './journal.js';
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

/** メニューから追加した同じ配合・人数は、確認欄とチェックリストで同じ購入履歴を使う。 */
export function matchingMenuShopping(state, item, servings) {
  const key = favouriteKey(item);
  const matches = menu => menu.servings === servings && menu.item.quantity === item.quantity &&
    favouriteKey(menu.item) === key;
  return (state.shoppingList ?? []).find(menu => menu.origin === 'menu' && menu.ingredientIds.length && matches(menu)) ??
    state.shoppingExtras.find(matches);
}

export function mergeShoppingSelections(prepared, selections, {single = false} = {}) {
  const merged = new Map((prepared ?? []).map(menu => [menu.id, menu]));
  for (const menu of selections) {
    const previous = merged.get(menu.id);
    const {stockScope, ...fields} = menu;
    const selectedOnly = single && (!previous || previous.stockScope === 'selected');
    merged.set(menu.id, {...fields, ...(selectedOnly ? {stockScope:'selected'} : {}),
      ingredientIds: [...new Set([...(previous?.ingredientIds ?? []), ...menu.ingredientIds])]});
  }
  return [...merged.values()];
}

/** 不足食材の種類だけを選ぶ。分量は元レシピのまま保存し、チェックリストで手持ちを一度引く。 */
export function missingShoppingSelection(state, item, servings, missingIds, {newOrder = false} = {}) {
  const ids = new Set(missingIds);
  const ingredientIds = [...new Set(item.ingredients.map(part => part.id).filter(id => ids.has(stockPurchaseId(id))))];
  if (!ingredientIds.length) return null;
  const matched = !newOrder && matchingMenuShopping(state, item, servings);
  const prepared = matched && state.shoppingList?.find(menu => menu.id === matched.id);
  if (prepared && ingredientIds.every(id => prepared.ingredientIds.includes(id))) return null;
  return {id: matched?.id ?? item.id, item: matched?.item ?? item, servings,
    label: 'メニューから追加', origin: 'menu', ingredientIds};
}

/** 旧明細と購入履歴の紐付けを残し、完了した料理へ現在の手持ちを割り当てない。 */
export function retireMenuShopping(state, menuId) {
  const previous = state.shoppingList.find(menu => menu.id === menuId);
  previous.origin = 'menu';
  previous.ingredientIds = [];
  state.shoppingExtras = state.shoppingExtras.filter(menu => menu.id !== menuId);
}

export function shoppingMealSlot(date, meal) {
  return {date, meal, label: `${date} ${MEAL_LABELS[meal]}`};
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
    const menuServings = shoppingServingsFor(entry, servings);
    // メモだけの予定は表示側で注意を出します。架空の食事スナップショットは作りません。
    for (const item of entry.items) {
      menuItem(item);
      if (!validId(item.id)) throw Error('料理の識別子を確認してください。');
      const id = JSON.stringify([entry.id, item.id]);
      if (seen.has(id)) throw Error('買い物に使う料理の識別子が重複しています。');
      seen.add(id);
      menus.push({id, item: structuredClone(item), servings: menuServings, ...shoppingMealSlot(entry.date, entry.meal)});
    }
  }
  return menus;
}

function orderedMenus(...collections) {
  const byId = new Map();
  for (const menus of collections) for (const menu of menus) byId.set(menu.id, menu);
  const meals = Object.keys(MEAL_LABELS);
  return [...byId.values()].sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') ||
    meals.indexOf(a.meal) - meals.indexOf(b.meal) || a.id.localeCompare(b.id));
}

/** 食事や料理を削除した後に、調理済みの古い買い物が再び現れるのを防ぐ。 */
export function discardRemovedCookedMenus(before, next) {
  const cooked = before.entries.filter(entry => entry.pantryUse);
  if (!cooked.length) return;
  const removed = new Set(cooked.flatMap(entry => entry.items.map(item => item.id)));
  for (const entry of next.entries) for (const item of entry.items) removed.delete(item.id);
  if (!removed.size) return;
  const keep = menu => !menu.id.startsWith('[') || !removed.has(menu.item.id);
  if (next.shoppingList) next.shoppingList = next.shoppingList.filter(keep);
  next.shoppingCatalog = next.shoppingCatalog.filter(keep);
}

/** 候補の絞り込みと、確定した買い物の在庫計算を別々に行います。 */
export function shoppingMenuContext(state, data, {source, from, to}) {
  if (!dateIsValid(from) || !dateIsValid(to) || from > to) throw Error('買い物の期間を確認してください。');
  // 調理して手持ちを減らした料理を、残りの献立の在庫割り当てに含めない。
  const usedItems = new Set(state.entries.filter(entry => entry.pantryUse).flatMap(entry => entry.items.map(item => item.id)));
  const outstanding = menu => !menu.id.startsWith('[') || !usedItems.has(menu.item.id);
  const activeList = state.shoppingList?.filter(menu => outstanding(menu) &&
    !(menu.origin === 'menu' && !menu.ingredientIds.length)) ?? null;
  const prepared = activeList ?? [], draft = state.shoppingCatalog.filter(outstanding);
  const extras = state.shoppingExtras.map(menu => ({...menu, origin: 'menu', label: 'メニューから追加', extra: true}));
  const knownId = new Map();
  for (const menu of [...draft, ...prepared]) if (menu.id.startsWith('[')) knownId.set(menu.item.id, menu.id);
  const bulk = prepared.filter(menu => menu.stockScope !== 'selected');
  const preparedIds = new Set(bulk.map(menu => menu.id));
  const includesDraft = draft.some(menu => preparedIds.has(menu.id));
  const includesExtras = extras.some(menu => preparedIds.has(menu.id));

  // カレンダーの在庫は献立の開始日を基準に7日単位で割り当てます。
  const start = Date.parse(state.settings.startDate);
  const weekOf = date => Math.floor((Date.parse(date) - start) / (7 * 86400000));
  const preparedWeeks = new Set(bulk.filter(menu => menu.origin === 'calendar' && menu.date).map(menu => weekOf(menu.date)));
  const planned = state.entries.filter(entry => entry.status === 'planned');
  for (const entry of planned) {
    if (entry.items.some(item => preparedIds.has(knownId.get(item.id)))) preparedWeeks.add(weekOf(entry.date));
  }

  const reviewWeeks = new Set(preparedWeeks);
  if (source === 'calendar') for (let week = weekOf(from); week <= weekOf(to); week++) reviewWeeks.add(week);
  const entries = planned.filter(entry => reviewWeeks.has(weekOf(entry.date)));
  const calendar = shoppingMenusFromEntries(entries, data, {
    from: '2000-01-01', to: '2100-12-31', servings: defaultServings(state.settings),
  }).map(menu => ({...menu, id: knownId.get(menu.item.id) ?? menu.id, origin: 'calendar'}));
  const committedCalendar = calendar.filter(menu => preparedWeeks.has(weekOf(menu.date)));
  const single = prepared.filter(menu => menu.stockScope === 'selected');
  const singleIds = new Set(single.map(menu => menu.id));
  const catalog = orderedMenus(bulk, includesDraft ? draft : [], committedCalendar,
    includesExtras ? extras.filter(menu => !singleIds.has(menu.id)) : []);
  const reserved = new Set(catalog.map(menu => menu.id));
  // 新たな一品が確定済みの料理から在庫を奪わないよう、登録順で末尾に加える。
  catalog.push(...single.filter(menu => !reserved.has(menu.id)));
  const reviewCatalog = orderedMenus(catalog, source === 'draft' ? draft : [], source === 'calendar' ? calendar : [],
    source === 'menu' ? extras : []);
  const dated = source === 'draft' ? draft : calendar;
  const menus = source === 'menu' ? extras : orderedMenus(dated.filter(menu => !menu.date || (menu.date >= from && menu.date <= to)));
  return {menus, catalog, reviewCatalog, prepared:activeList};
}

/** 一品選ぶときは、すでに確定している在庫割当と対象料理だけを照合する。 */
export function draftDishShoppingContext(state, data, date, meal, recipeId) {
  const context = shoppingMenuContext(state, data, {source: 'draft', from: date, to: date});
  const menu = context.menus.find(menu => menu.meal === meal && menu.item.recipeId === recipeId);
  return {menu, catalog: context.catalog, prepared: context.prepared};
}

/** 今回のチェックリストから外します。購入済みの献立は履歴を照合できるように残します。 */
export function removeShoppingIngredient(prepared, ingredientId, menuIds, receipts = []) {
  const pendingMenus = new Set(menuIds);
  const purchasedMenus = new Set(receipts.flatMap(receipt => receipt.allocations.map(part => part.menuId)));
  const remaining = [];
  for (const menu of prepared ?? []) {
    if (!pendingMenus.has(menu.id) || !menu.ingredientIds.some(id => stockPurchaseId(id) === ingredientId)) {
      remaining.push(menu);
      continue;
    }
    const ingredientIds = menu.ingredientIds.filter(id => stockPurchaseId(id) !== ingredientId);
    if (ingredientIds.length || purchasedMenus.has(menu.id)) remaining.push({...menu, ingredientIds});
  }
  return remaining.length ? remaining : null;
}

/** 選ばれた材料だけを集計。省く調味料は別に返し、数量の出所を残します。 */
export function buildShoppingChecklist(selections, data, {pantry = [], omittedIds = []} = {}) {
  checkData(data);
  if (!Array.isArray(selections) || !Array.isArray(pantry) || !Array.isArray(omittedIds) ||
      omittedIds.some(id => typeof id !== 'string')) throw Error('買い物の選択内容を確認してください。');
  const omitted = new Set(omittedIds.map(stockPurchaseId)), items = new Map(), missingMenus = [], seen = new Set();
  const stock = new Map(), pantryIds = new Set();
  for (const part of pantry) {
    if (!Object.hasOwn(data.ingredients, part.id) || !nonnegative(part.amount) || pantryIds.has(part.id)) {
      throw Error('手持ちの食材の量を確認してください。');
    }
    pantryIds.add(part.id);
    const id = stockPurchaseId(part.id);
    stock.set(id, (stock.get(id) ?? 0) + part.amount);
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
    if (item.batchId || item.restaurant || item.diningMatch) continue;
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
      const id = stockPurchaseId(part.id);
      sourceAmounts.set(id, (sourceAmounts.get(id) ?? 0) + needed);
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
