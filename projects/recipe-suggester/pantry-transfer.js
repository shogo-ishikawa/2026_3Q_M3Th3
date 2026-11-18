/** 手持ちの量はレシピの材料単位。包装数や購入時の重さとは区別します。 */
import {stockPurchaseId} from './strained-stock.js';

function addStock(pantry, id, amount) {
  const row = pantry.find(part => part.id === id);
  if (row) row.amount += amount;
  else pantry.push({id, amount});
}

/** カレンダーと下書きは同じ料理スナップショットIDを引き継ぐ。 */
export function eatenShoppingIds(state) {
  const eaten = state.entries.filter(entry => entry.status === 'eaten');
  const itemIds = new Set(eaten.flatMap(entry => entry.items.map(item => item.id)));
  const ids = new Set(eaten.flatMap(entry => entry.items.map(item => JSON.stringify([entry.id, item.id]))));
  for (const menu of [...state.shoppingCatalog, ...(state.shoppingList ?? [])]) {
    if (menu.id.startsWith('[') && itemIds.has(menu.item.id)) ids.add(menu.id);
  }
  return ids;
}

/** チェック時に確定した材料量だけを移す。同じ購入は再び転記できません。 */
export function stockReceipt(state, receiptId, data) {
  const receipt = state.shoppingReceipts.find(row => row.id === receiptId);
  if (!receipt || receipt.stocked || !Object.hasOwn(data.ingredients, receipt.ingredientId)) {
    throw Error('手持ちに追加できる購入記録を確認してください。');
  }
  const eaten = eatenShoppingIds(state);
  if (receipt.allocations.some(part => eaten.has(part.menuId))) throw Error('食べた料理を含む購入です。残っている量を手持ち食材から登録してください。');
  addStock(state.pantry, receipt.ingredientId, receipt.amount);
  receipt.stocked = true;
}

export function cancelReceipt(state, receiptId) {
  const receipt = state.shoppingReceipts.find(row => row.id === receiptId);
  if (!receipt) throw Error('この購入チェックはすでに取り消されています。');
  if (receipt.stocked) {
    const row = state.pantry.find(part => part.id === receipt.ingredientId);
    if (!row || row.amount + Number.EPSILON * receipt.amount * 8 < receipt.amount) {
      throw Error('追加した分が手持ちに残っていません。使用を取り消す場合は、先に食事の記録を予定に戻してください。');
    }
    row.amount = Math.max(0, row.amount - receipt.amount);
  }
  state.shoppingReceipts = state.shoppingReceipts.filter(row => row.id !== receiptId);
}

/** 料理の買い物に割当済みで手持ちに入れていない購入分を先に使う。 */
export function mealPantryUse(state, entry, servings) {
  if (entry.status !== 'planned' || entry.pantryUse || entry.note === '外食') return [];
  if (!Number.isInteger(servings) || servings < 1 || servings > 8) throw Error('調理する人数は1〜8人で選んでください。');
  const needed = new Map();
  const menuIds = new Map();
  for (const menu of [...state.shoppingCatalog, ...(state.shoppingList ?? [])]) {
    if (menu.id.startsWith('[')) menuIds.set(menu.item.id, menu.id);
  }
  const purchased = new Map();
  for (const receipt of state.shoppingReceipts) {
    if (receipt.stocked) continue;
    for (const part of receipt.allocations) {
      if (!purchased.has(part.menuId)) purchased.set(part.menuId, new Map());
      const amounts = purchased.get(part.menuId);
      amounts.set(receipt.ingredientId, (amounts.get(receipt.ingredientId) ?? 0) + part.amount);
    }
  }
  for (const item of entry.items) {
    if (item.batchId || item.restaurant || item.diningMatch || !(item.ingredientsKnown || item.shoppingKnown)) continue;
    const menuId = menuIds.get(item.id) ?? JSON.stringify([entry.id, item.id]);
    const amounts = new Map();
    for (const part of item.ingredients) {
      const id = stockPurchaseId(part.id);
      amounts.set(id, (amounts.get(id) ?? 0) + part.amount * item.quantity * servings);
    }
    for (const [id, amount] of amounts) {
      const unstockedPurchase = purchased.get(menuId)?.get(id) ?? 0;
      needed.set(id, (needed.get(id) ?? 0) + Math.max(0, amount - unstockedPurchase));
    }
  }
  const debits = [];
  for (const part of state.pantry) {
    const id = stockPurchaseId(part.id);
    const remaining = needed.get(id) ?? 0;
    const amount = Math.min(part.amount, remaining);
    if (amount > 0) {
      debits.push({id:part.id, amount});
      needed.set(id, remaining - amount);
    }
  }
  return debits;
}

/** 減らした実量を食事と同時に保存し、予定へ戻すときはその量だけ戻します。 */
export function changeMealStatus(state, entryId, expected, {usePantry = false, servings = 1} = {}) {
  const entry = state.entries.find(item => item.id === entryId);
  if (!entry || entry.status !== expected) throw Error('食事の状態が変わりました。記録を開き直してください。');
  if (entry.status === 'planned') {
    if (usePantry) {
      const used = mealPantryUse(state, entry, servings);
      if (!used.length) throw Error('差し引ける手持ちの食材がありません。');
      for (const part of used) state.pantry.find(row => row.id === part.id).amount -= part.amount;
      entry.pantryUse = used;
    }
    entry.status = 'eaten';
  } else {
    for (const part of entry.pantryUse ?? []) addStock(state.pantry, part.id, part.amount);
    delete entry.pantryUse;
    entry.status = 'planned';
  }
}
