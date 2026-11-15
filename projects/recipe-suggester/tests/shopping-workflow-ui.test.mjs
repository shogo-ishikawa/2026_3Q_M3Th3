import test from 'node:test';
import assert from 'node:assert/strict';
import {mountShoppingWorkflow, shoppingChecklistText} from '../shopping-workflow-ui.js';
import {createShoppingReceipt} from '../shopping-status.js';

class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.listeners = new Map(); this.className = ''; this.textContent = ''; this.dataset = {}; this.hidden = false; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key]; }
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(listener); }
  dispatchEvent(event) { for (const listener of this.listeners.get(event.type) ?? []) listener(event); return true; }
  emit(type) { this.dispatchEvent({type, target: this, preventDefault() {}}); }
  set innerHTML(value) { throw Error(`HTML must not be interpolated: ${value}`); }
}
const all = root => [root, ...root.children.flatMap(all)];
const byClass = (root, name) => all(root).filter(element => element.className.split(' ').includes(name));
const one = (root, name) => { const element = byClass(root, name)[0]; assert.ok(element, name); return element; };
const text = root => all(root).map(element => element.textContent).join(' ');
const labelled = (root, label) => { const element = all(root).find(element => element.attributes['aria-label'] === label); assert.ok(element, label); return element; };
const withDocument = fn => {
  const prior = globalThis.document; globalThis.document = {createElement: tag => new Element(tag)};
  try { return fn(); } finally { if (prior === undefined) delete globalThis.document; else globalThis.document = prior; }
};
const data = {ingredients: {carrot: {name: 'にんじん', unit: 'g', groups: ['vegetable']}, salt: {name: '塩', unit: 'g'}, water: {name: '水', unit: 'ml'}}};
const now = '2026-11-15T00:00:00.000Z';
const menus = () => [
  {id: 'a', label: '2026-11-15 夕食', servings: 2, item: {name: '肉じゃが', quantity: 2, ingredientsKnown: true, ingredients: [{id: 'carrot', amount: 25}, {id: 'salt', amount: 1}]}},
  {id: 'b', label: '2026-11-17 昼食', servings: 1, extra: true, item: {name: '野菜スープ', quantity: 1, ingredientsKnown: true, ingredients: [{id: 'carrot', amount: 20}, {id: 'water', amount: 100}]}},
];
const prepared = () => menus().map(menu => ({id: menu.id, item: structuredClone(menu.item), servings: menu.servings, ingredientIds: menu.item.ingredients.map(part => part.id)}));
const receipt = (selections = prepared(), ingredientId = 'carrot', options = {}) => createShoppingReceipt(selections, ingredientId, data, {now, id: `receipt-${ingredientId}`, ...options});

test('献立画面は材料の選択とインポートだけを表示し、チェックリストを混ぜない', () => withDocument(() => {
  const source = menus(), before = structuredClone(source), changed = [], saved = [];
  const root = mountShoppingWorkflow({view: 'review', menus: source, data, omittedIds: ['water', 'salt'], onSelectionChange: value => changed.push(value), onPrepare: value => saved.push(value)});
  assert.equal(byClass(root, 'shopping-final').length, 0);
  assert.match(text(one(root, 'shopping-menu-card')), /2026-11-15 夕食.*未購入|未購入.*2026-11-15 夕食/);
  assert.equal(labelled(root, '肉じゃがの塩を買う').disabled, true);
  assert.equal(labelled(root, '野菜スープの水を買う').checked, false);
  const carrot = labelled(root, '肉じゃがのにんじんを買う'); carrot.checked = false; carrot.emit('change');
  assert.deepEqual(changed, [{a: []}]);
  one(root, 'shopping-prepare').emit('click');
  assert.deepEqual(saved[0].map(menu => [menu.id, menu.ingredientIds]), [['b', ['carrot']]]);
  saved[0][0].item.ingredients[0].amount = 999;
  assert.deepEqual(source, before);
}));

test('献立単位と全候補を選択・解除でき、明示的な空配列は全選択へ戻さない', () => withDocument(() => {
  const selection = {a: []}, changed = [], root = mountShoppingWorkflow({view: 'review', menus: menus(), data, selection, omittedIds: ['water'], onSelectionChange: value => changed.push(value)});
  assert.equal(labelled(root, '肉じゃがのにんじんを買う').checked, false);
  const menuCheck = labelled(root, '肉じゃがの残りの材料をまとめて選ぶ'); menuCheck.checked = true; menuCheck.emit('change');
  assert.deepEqual(changed.at(-1).a, ['carrot', 'salt']);
  one(root, 'shopping-select-none').emit('click'); assert.deepEqual(changed.at(-1), {a: [], b: []}); assert.equal(one(root, 'shopping-prepare').disabled, true);
  one(root, 'shopping-select-all').emit('click'); assert.deepEqual(changed.at(-1), {a: ['carrot', 'salt'], b: ['carrot']});
  assert.deepEqual(selection, {a: []});
}));

test('チェックリストは購入する行だけに絞り、説明や献立選択を表示しない', () => withDocument(() => {
  const source = prepared(), root = mountShoppingWorkflow({view: 'checklist', menus: [], catalog: menus(), data, prepared: source, pantry: [{id: 'carrot', amount: 20}], omittedIds: ['salt', 'water']});
  assert.equal(byClass(root, 'shopping-review').length, 0); assert.equal(byClass(root, 'shopping-final-note').length, 0);
  assert.doesNotMatch(text(root), /料理ごとに必要|リストに使う献立|水・調味料などを/);
  const row = one(root, 'shopping-check-row'); assert.equal(row.dataset.ingredientId, 'carrot');
  assert.match(text(one(row, 'shopping-ingredient-sources')), /肉じゃが（2人分）.*野菜スープ（1人分）/);
  const details = one(row, 'shopping-ingredient-sources');
  assert.equal(details.open, undefined); // 使う献立と包装設定は最初は閉じる
  assert.equal(row.children.filter(child => child.tagName === 'DETAILS').length, 1);
  assert.equal(row.children.some(child => child.className.split(' ').includes('purchase-editor')), false);
  assert.ok(details.children.some(child => child.className.split(' ').includes('purchase-editor')));

  assert.match(text(one(root, 'shopping-check-group')), /野菜・いも・きのこ/);
  assert.match(text(one(row, 'shopping-check-description')), /約115g/);
  assert.equal(one(root, 'shopping-check-progress').textContent, '残り 1品目');
  assert.deepEqual(source, prepared());
}));

test('週全体で使う在庫を数日分のチェックリストやコピーで二重に引かない', () => withDocument(() => {
  const catalog = menus(), source = [prepared()[1]], pantry = [{id: 'carrot', amount: 100}];
  const root = mountShoppingWorkflow({view: 'checklist', data, catalog, prepared: source, pantry, omittedIds: ['water', 'salt']});
  assert.match(text(one(root, 'shopping-check-description')), /約25g/); // 次の食事20g分は、初日の100g在庫と別に購入する
  const copied = shoppingChecklistText(source, data, {catalog, pantry, omittedIds: ['water', 'salt']});
  assert.match(copied, /約25g/);
  const review = mountShoppingWorkflow({view: 'review', data, catalog, menus: [catalog[1]], pantry, omittedIds: ['water', 'salt']});
  assert.equal(labelled(review, '野菜スープのにんじんを買う').checked, true);
  assert.match(text(one(review, 'shopping-menu-status')), /未購入/);
}));

test('購入チェックはその行を購入済みへ移し、別の未購入行を残す', () => withDocument(() => {
  const purchases = [], root = mountShoppingWorkflow({view: 'checklist', data, prepared: prepared(), omittedIds: ['water'], onPurchase: id => purchases.push(id)});
  const rows = byClass(root, 'shopping-check-row'); assert.equal(rows.length, 2);
  const check = labelled(root, 'にんじんを購入済みにする'); check.checked = true; check.emit('change');
  assert.deepEqual(purchases, ['carrot']); assert.equal(rows.find(row => row.dataset.ingredientId === 'carrot').hidden, true);
  assert.equal(rows.find(row => row.dataset.ingredientId === 'salt').hidden, false);
  assert.equal(one(root, 'shopping-check-progress').textContent, '残り 1品目');
}));

test('購入保存の拒否や失敗では行とチェックを戻す', () => withDocument(() => {
  for (const callback of [() => false, () => { throw Error('保存できません'); }]) {
    const root = mountShoppingWorkflow({view: 'checklist', data, prepared: prepared(), omittedIds: ['water', 'salt'], onPurchase: callback});
    const check = labelled(root, 'にんじんを購入済みにする'); check.checked = true; check.emit('change');
    assert.equal(check.checked, false); assert.equal(one(root, 'shopping-check-row').hidden, false);
    assert.equal(one(root, 'shopping-check-progress').textContent, '残り 1品目');
  }
}));

test('購入履歴は7日以内だけ表示し、元の献立と数量を開いて確認できる', () => withDocument(() => {
  const fresh = receipt(), expired = {...receipt(), id: 'old', purchasedAt: '2026-11-01T00:00:00.000Z'};
  const root = mountShoppingWorkflow({view: 'purchased', catalog: menus(), prepared: prepared(), data, receipts: [expired, fresh], now});
  assert.equal(byClass(root, 'shopping-review').length, 0); assert.equal(byClass(root, 'shopping-final').length, 0);
  assert.equal(byClass(root, 'shopping-receipt-row').length, 1); assert.equal(one(root, 'shopping-receipt-row').dataset.receiptId, fresh.id);
  assert.match(text(one(root, 'shopping-ingredient-sources')), /2026-11-15 夕食.*肉じゃが.*2026-11-17 昼食.*野菜スープ/);
  assert.match(text(one(root, 'shopping-receipt-heading')), /にんじん.*約135g/);
}));

test('購入済みタブの取り消しを受け付け、拒否されたときは履歴を消さない', () => withDocument(() => {
  const restored = [], props = {view: 'purchased', catalog: menus(), data, receipts: [receipt()], now};
  const root = mountShoppingWorkflow({...props, onUndoPurchase: id => restored.push(id)});
  one(root, 'shopping-undo-purchase').emit('click'); assert.deepEqual(restored, ['receipt-carrot']);
  assert.equal(one(root, 'shopping-receipt-row').hidden, true); assert.equal(one(root, 'shopping-purchased-count').textContent, '0件');
  const rejected = mountShoppingWorkflow({...props, onUndoPurchase: () => false});
  one(rejected, 'shopping-undo-purchase').emit('click'); assert.equal(one(rejected, 'shopping-receipt-row').hidden, false);
}));

test('購入済み表示から消えた履歴も献立の購入状況と再インポートに反映する', () => withDocument(() => {
  const old = receipt([prepared()[0]], 'carrot'), saved = [];
  const root = mountShoppingWorkflow({view: 'review', data, menus: menus(), receipts: [old], omittedIds: ['water', 'salt'], now: '2026-11-23T00:00:00.000Z', onPrepare: values => saved.push(values)});
  const cards = byClass(root, 'shopping-menu-card');
  assert.equal(one(cards[0], 'shopping-menu-status').textContent, '購入済み');
  assert.equal(one(cards[1], 'shopping-menu-status').textContent, '未購入');
  assert.equal(labelled(root, '肉じゃがのにんじんを買う').disabled, true);
  one(root, 'shopping-prepare').emit('click'); assert.deepEqual(saved[0].map(menu => menu.id), ['b']);
  const purchased = mountShoppingWorkflow({view: 'purchased', data, receipts: [old], now: '2026-11-23T00:00:00.000Z'});
  assert.equal(byClass(purchased, 'shopping-receipt-row').length, 0);
}));

test('未選択の材料や材料不明を購入済みとせず、購入対象外の食事も区別する', () => withDocument(() => {
  const candidates = menus(); candidates[0].item.ingredientsKnown = false; candidates[0].item.ingredients = [];
  candidates[1].item.batchId = 'held';
  const review = mountShoppingWorkflow({view: 'review', menus: candidates, data});
  assert.equal(one(byClass(review, 'shopping-menu-card')[0], 'shopping-menu-status').textContent, '材料を要確認');
  assert.match(text(byClass(review, 'shopping-menu-card')[1]), /作り置き済み/);
  const source = candidates.map(menu => ({id: menu.id, item: menu.item, servings: menu.servings, ingredientIds: []}));
  const root = mountShoppingWorkflow({view: 'checklist', data, prepared: source});
  assert.match(one(root, 'shopping-check-progress').textContent, /未確認の材料/); assert.match(text(one(root, 'shopping-missing-note')), /肉じゃが/);
  assert.equal(byClass(root, 'shopping-check-row').length, 0);
}));

test('レシピを開くコールバックに独立したコピーを渡し、名称をHTMLにしない', () => withDocument(() => {
  const source = menus(); source[0].item.name = '<script>menu()</script>'; const original = structuredClone(source), opened = [];
  const root = mountShoppingWorkflow({view: 'review', menus: source, data, onOpenMenu: menu => opened.push(menu)});
  one(root, 'shopping-open-menu').emit('click'); opened[0].item.ingredients[0].amount = 999;
  assert.deepEqual(source, original); assert.match(text(root), /<script>menu\(\)<\/script>/);
  assert.equal(all(root).filter(element => element.tagName === 'SCRIPT').length, 0);
}));

test('コピーする一覧も購入済みを除き、材料不明を短く注意する', () => {
  const source = prepared(), receipts = [receipt(source, 'carrot')];
  const copied = shoppingChecklistText(source, data, {omittedIds: ['water'], receipts});
  assert.match(copied, /□ 塩/); assert.doesNotMatch(copied, /にんじん/);
  const unknown = [{id: 'c', servings: 1, ingredientIds: [], item: {name: '材料不明の食事', quantity: 1, ingredientsKnown: false, ingredients: []}}];
  assert.match(shoppingChecklistText(unknown, data), /未確認の材料[\s\S]*材料未確認：材料不明の食事/);
  assert.equal(shoppingChecklistText(null, data), '');
});
