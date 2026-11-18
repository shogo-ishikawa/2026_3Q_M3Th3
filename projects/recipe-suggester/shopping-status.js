/** 購入量を料理ごとに割り当て、別の日の買い物へ二重計上しません。 */
import {buildShoppingChecklist} from './shopping-workflow.js';

const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const validId = (value, max = 500) => typeof value === 'string' && value.length > 0 && value.length <= max;
const copy = value => structuredClone(value);
const sum = values => values.reduce((total, value) => total + value, 0);
const remaining = (value, covered) => {
  const result = Math.max(0, value - covered);
  return result <= Number.EPSILON * Math.max(value, covered) * 16 ? 0 : result;
};

function time(value = new Date()) {
  const stamp = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(stamp)) throw Error('購入日時を確認してください。');
  return stamp;
}

function checkedReceipts(receipts = []) {
  if (!Array.isArray(receipts)) throw Error('購入履歴の形式を確認してください。');
  const seen = new Set();
  for (const receipt of receipts) {
    if (!receipt || !validId(receipt.id, 120) || seen.has(receipt.id) || !validId(receipt.ingredientId, 120) ||
        !positive(receipt.amount) || !Array.isArray(receipt.allocations) || !receipt.allocations.length ||
        typeof receipt.purchasedAt !== 'string' || new Date(time(receipt.purchasedAt)).toISOString() !== receipt.purchasedAt) {
      throw Error('購入履歴の内容を確認してください。');
    }
    seen.add(receipt.id);
    const menus = new Set();
    for (const allocation of receipt.allocations) {
      if (!allocation || !validId(allocation.menuId) || menus.has(allocation.menuId) || !positive(allocation.amount)) throw Error('購入量の割り当てを確認してください。');
      menus.add(allocation.menuId);
    }
    const allocated = sum(receipt.allocations.map(item => item.amount));
    if (!Number.isFinite(allocated) || allocated - receipt.amount > Math.max(1, receipt.amount, allocated) * 1e-9) {
      throw Error('料理に割り当てた量が購入量を超えています。');
    }
  }
  return receipts;
}

function receiptCoverage(receipts) {
  const coverage = new Map();
  for (const receipt of checkedReceipts(receipts)) {
    if (!coverage.has(receipt.ingredientId)) coverage.set(receipt.ingredientId, new Map());
    const ingredient = coverage.get(receipt.ingredientId);
    for (const allocation of receipt.allocations) {
      const amount = (ingredient.get(allocation.menuId) ?? 0) + allocation.amount;
      if (!Number.isFinite(amount)) throw Error('購入量の合計が大きすぎます。');
      ingredient.set(allocation.menuId, amount);
    }
  }
  return coverage;
}

const allIngredients = menu => ({...menu, ingredientIds: [...new Set(menu.item.ingredients.map(part => part.id))]});

// 在庫の割り当ては週間の全候補で一度行います。数日分だけインポートしても同じ在庫を再利用しません。
function allocationScope(prepared, catalog) {
  if (catalog === undefined) return prepared;
  if (!Array.isArray(catalog)) throw Error('献立リストを確認してください。');
  const scope = new Map();
  for (const menu of catalog) {
    if (!menu?.item || !validId(menu.id) || scope.has(menu.id)) throw Error('献立リストの識別子を確認してください。');
    scope.set(menu.id, allIngredients(menu));
  }
  for (const menu of prepared) scope.set(menu.id, allIngredients(menu));
  return [...scope.values()];
}

function allocateRow(row, coverage) {
  let stockLeft = row.stock;
  const sources = row.sources.map(source => {
    const purchased = Math.min(source.amount, coverage.get(row.id)?.get(source.menuId) ?? 0);
    const afterPurchase = remaining(source.amount, purchased);
    const stock = Math.min(afterPurchase, stockLeft);
    stockLeft = remaining(stockLeft, stock);
    return {...source, purchased, stock, buy: remaining(afterPurchase, stock)};
  });
  return {...row, purchased: sum(sources.map(source => source.purchased)), stockUsed: sum(sources.map(source => source.stock)),
    buy: sum(sources.map(source => source.buy)), sources};
}

/** 現在の買い物対象だけを返します。catalogには全週の候補を渡して在庫を共用します。 */
export function pendingShopping(prepared = [], data, {pantry = [], omittedIds = [], receipts = [], catalog} = {}) {
  if (prepared === null) prepared = [];
  const base = buildShoppingChecklist(prepared, data, {pantry, omittedIds});
  const coverage = receiptCoverage(receipts);
  const scoped = buildShoppingChecklist(allocationScope(prepared, catalog), data, {pantry, omittedIds});
  const allocations = new Map([...scoped.items, ...scoped.omittedItems].map(row => [row.id, allocateRow(row, coverage)]));
  function project(row) {
    const reference = allocations.get(row.id), sources = row.sources.map(source => {
      const allocation = reference?.sources.find(item => item.menuId === source.menuId);
      // preparedの配合をscopeへ反映済みなので、割り当ては必ず同じ必要量を基準にします。
      return allocation ? {...source, purchased: allocation.purchased, stock: allocation.stock, buy: allocation.buy} :
        {...source, purchased: 0, stock: 0, buy: source.amount};
    });
    return {...row, purchased: sum(sources.map(source => source.purchased)), stockUsed: sum(sources.map(source => source.stock)),
      buy: sum(sources.map(source => source.buy)), sources};
  }
  return {...base, items: base.items.map(project), omittedItems: base.omittedItems.map(project)};
}

/** 表示中の不足量だけ購入し、在庫で足りた量や既に買った量を重ねて記録しません。 */
export function createShoppingReceipt(prepared, ingredientId, data, options = {}) {
  const {now = new Date(), id = globalThis.crypto?.randomUUID?.(), ...settings} = options;
  if (!validId(id, 120)) throw Error('購入履歴の識別子を確認してください。');
  const result = pendingShopping(prepared, data, settings), item = result.items.find(row => row.id === ingredientId);
  if (!item || !positive(item.buy)) throw Error('この食材の未購入分はありません。');
  const allocations = item.sources.filter(source => source.buy > 0).map(source => ({menuId: source.menuId, amount: source.buy}));
  const receipt = {id, ingredientId, amount: sum(allocations.map(source => source.amount)), purchasedAt: new Date(time(now)).toISOString(), allocations};
  checkedReceipts([...(settings.receipts ?? []), receipt]);
  return receipt;
}

/** 取り消した購入の割り当てだけを外し、別の日の購入を保ちます。 */
export function undoReceipt(id, receipts) {
  if (!validId(id, 120)) throw Error('取り消す購入履歴を確認してください。');
  return copy(checkedReceipts(receipts).filter(receipt => receipt.id !== id));
}

/** 7日後は購入済みタブから隠します。購入状況の照合に使う割り当ては削除しません。 */
export function visibleReceipts(receipts, {now = new Date(), days = 7} = {}) {
  if (!positive(days) || days > 3650) throw Error('購入済みの表示期間を確認してください。');
  const until = time(now), since = until - days * 86400000;
  return copy(checkedReceipts(receipts).filter(receipt => time(receipt.purchasedAt) > since))
    .sort((a, b) => time(b.purchasedAt) - time(a.purchasedAt));
}

const LABELS = {purchased: '購入済み', partial: '一部購入済み', unpurchased: '未購入', stock: '手持ちで用意済み', unknown: '材料を要確認', omitted: '購入対象外', ready: '購入・手持ちで用意済み'};

/** 献立全体を渡すと、同じ手持ちを別の料理にも充当することを防げます。 */
export function shoppingMenuStatuses(menus, data, {pantry = [], omittedIds = [], receipts = []} = {}) {
  if (!Array.isArray(menus)) throw Error('献立リストを確認してください。');
  const selections = menus.map(allIngredients), result = pendingShopping(selections, data, {pantry, omittedIds, receipts});
  const missing = new Set(result.missingMenus.map(menu => menu.menuId)), omitted = new Set(omittedIds);
  return menus.map(menu => {
    const totals = {totalIngredients: 0, purchasedIngredients: 0, stockIngredients: 0, omittedIngredients: 0,
      unselectedIngredients: 0, remainingIngredients: 0};
    const ids = [...new Set(menu.item.ingredients.map(part => part.id))];
    let purchased = 0, stock = 0;
    for (const id of ids) {
      totals.totalIngredients++;
      if (omitted.has(id) || menu.item.batchId || menu.item.restaurant || menu.item.diningMatch) { totals.omittedIngredients++; continue; }
      const row = result.items.find(item => item.id === id), source = row?.sources.find(source => source.menuId === menu.id);
      if (!source) continue;
      purchased += source.purchased; stock += source.stock;
      if (source.purchased >= source.amount || remaining(source.amount, source.purchased) === 0) totals.purchasedIngredients++;
      else if (source.buy === 0) totals.stockIngredients++;
      else totals.remainingIngredients++;
    }
    // ingredientIdsは「今回買うもの」の指定です。未選択でも全材料を用意したとは扱いません。
    if (Array.isArray(menu.ingredientIds)) totals.unselectedIngredients = ids.filter(id => !omitted.has(id) && !menu.ingredientIds.includes(id)).length;
    const unknown = missing.has(menu.id) || ids.some(id => !Object.hasOwn(data.ingredients, id));
    let status;
    if (unknown) status = 'unknown';
    else if (totals.totalIngredients === totals.omittedIngredients) status = 'omitted';
    else if (!totals.remainingIngredients) status = stock > 0 ? (purchased > 0 ? 'ready' : 'stock') : 'purchased';
    else status = purchased > 0 || stock > 0 ? 'partial' : 'unpurchased';
    return {menuId: menu.id, status, label: LABELS[status], ...totals, unknown};
  });
}

export function menuShoppingStatus(menu, data, {catalog, ...options} = {}) {
  const scope = catalog === undefined ? [menu] : catalog.some(item => item.id === menu.id) ? catalog : [...catalog, menu];
  return shoppingMenuStatuses(scope, data, options).find(item => item.menuId === menu.id);
}

/** 旧版のチェックは当時の対象料理だけへ引き継ぎます。新しい別の料理へ広げません。 */
export function migrateLegacyReceipts(prepared, checks, data) {
  if (prepared === null || prepared === undefined) return [];
  if (!Array.isArray(checks)) throw Error('旧版の購入チェックを確認してください。');
  const checked = new Set(checks), result = buildShoppingChecklist(prepared, data);
  return result.items.filter(item => checked.has(item.id)).map((item, index) => ({
    id: `legacy-${index}-${encodeURIComponent(item.id).slice(0, 70)}`, ingredientId: item.id, amount: item.required,
    purchasedAt: '1970-01-01T00:00:00.000Z', legacy: true,
    allocations: item.sources.map(source => ({menuId: source.menuId, amount: source.amount})),
  }));
}
