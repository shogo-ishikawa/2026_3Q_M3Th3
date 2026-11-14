import test from 'node:test';
import assert from 'node:assert/strict';
import {mountShoppingWorkflow, shoppingChecklistText} from '../shopping-workflow-ui.js';

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
const menus = () => [
  {id: 'a', label: '2026-11-15 夕食', servings: 2, item: {name: '肉じゃが', quantity: 2, ingredientsKnown: true, ingredients: [{id: 'carrot', amount: 25}, {id: 'salt', amount: 1}]}},
  {id: 'b', servings: 1, extra: true, item: {name: '野菜スープ', quantity: 1, ingredientsKnown: true, ingredients: [{id: 'carrot', amount: 20}, {id: 'water', amount: 100}]}},
];
const prepared = () => menus().map(menu => ({id: menu.id, item: structuredClone(menu.item), servings: menu.servings, ingredientIds: menu.item.ingredients.map(part => part.id)}));

test('メニュー別の必要量と除外設定を示し、チェックした材料だけを保存候補へ渡す', () => withDocument(() => {
  const source = menus(), before = structuredClone(source), changed = [], saved = [];
  const root = mountShoppingWorkflow({menus: source, data, omittedIds: ['water', 'salt'], onSelectionChange: value => changed.push(value), onPrepare: value => saved.push(value)});
  assert.equal(one(root, 'shopping-review').open, true);
  assert.match(text(byClass(root, 'shopping-menu-card')[0]), /100g/);
  assert.equal(labelled(root, '肉じゃがの塩を買う').disabled, true);
  assert.equal(labelled(root, '野菜スープの水を買う').checked, false);
  const carrot = labelled(root, '肉じゃがのにんじんを買う'); carrot.checked = false; carrot.emit('change');
  assert.deepEqual(changed, [{a: []}]);
  one(root, 'shopping-prepare').emit('click');
  assert.deepEqual(saved[0].map(menu => menu.ingredientIds), [[], ['carrot']]);
  assert.equal(saved[0][0].servings, 2);
  saved[0][1].item.ingredients[0].amount = 999;
  assert.deepEqual(source, before);
  assert.equal(byClass(root, 'shopping-check-row').length, 0);
}));

test('メニュー全体と全候補を選択・解除でき、明示的な空配列を初期の全選択へ戻さない', () => withDocument(() => {
  const selection = {a: []}, changed = [], root = mountShoppingWorkflow({menus: menus(), data, selection, omittedIds: ['water'], onSelectionChange: value => changed.push(value)});
  assert.equal(labelled(root, '肉じゃがのにんじんを買う').checked, false);
  const menuCheck = labelled(root, '肉じゃがの材料をまとめて選ぶ'); menuCheck.checked = true; menuCheck.emit('change');
  assert.deepEqual(changed.at(-1).a, ['carrot', 'salt']);
  one(root, 'shopping-select-none').emit('click'); assert.deepEqual(changed.at(-1), {a: [], b: []});
  one(root, 'shopping-select-all').emit('click'); assert.deepEqual(changed.at(-1), {a: ['carrot', 'salt'], b: ['carrot']});
  assert.deepEqual(selection, {a: []});
}));

test('保存済み選択をカテゴリ別の購入一覧へし、合算後の在庫差引と料理別の出所を開ける', () => withDocument(() => {
  const source = prepared(), root = mountShoppingWorkflow({menus: [], data, prepared: source, pantry: [{id: 'carrot', amount: 20}], omittedIds: ['salt', 'water']});
  assert.equal(one(root, 'shopping-review').open, false);
  const rows = byClass(root, 'shopping-check-row'); assert.equal(rows.length, 1);
  const row = rows[0]; assert.equal(row.dataset.ingredientId, 'carrot');
  assert.match(text(one(row, 'shopping-ingredient-sources')), /合計 120g.*手持ち 20g.*不足 100g/);
  assert.match(text(one(row, 'shopping-ingredient-sources')), /肉じゃが（2人分） 100g.*野菜スープ（1人分） 20g/);
  assert.match(text(one(root, 'shopping-check-group')), /野菜・いも・きのこ/);
  assert.match(text(one(row, 'shopping-check-description')), /111\.111g必要/);
  assert.match(text(one(root, 'shopping-omitted-note')), /塩.*水/);
  assert.deepEqual(source, prepared());
}));

test('購入済みのチェックと非表示、進捗を即時更新し、再表示でも保存されたチェックを使う', () => withDocument(() => {
  const checked = [], visibility = [], source = prepared(), props = {menus: [], data, prepared: source, omittedIds: ['water', 'salt']};
  const root = mountShoppingWorkflow({...props, onCheck: (id, value) => checked.push([id, value]), onHidePurchasedChange: value => visibility.push(value)});
  const row = one(root, 'shopping-check-row'), check = labelled(root, 'にんじんを購入済みにする');
  check.checked = true; check.emit('change'); assert.deepEqual(checked, [['carrot', true]]);
  assert.match(one(root, 'shopping-check-progress').textContent, /1品目中 1品目.*すべて揃いました/);
  const hide = one(root, 'shopping-hide-purchased').children[0]; hide.checked = true; hide.emit('change');
  assert.equal(row.hidden, true); assert.equal(one(root, 'shopping-check-group').hidden, true); assert.deepEqual(visibility, [true]);
  const remounted = mountShoppingWorkflow({...props, checks: ['carrot'], hidePurchased: true});
  assert.equal(labelled(remounted, 'にんじんを購入済みにする').checked, true); assert.equal(one(remounted, 'shopping-check-row').hidden, true);
}));

test('献立候補が変わっても明示的に作り直すまで保存済み料理の一覧を表示する', () => withDocument(() => {
  const current = menus(); current[0].item.name = '新しいメニュー'; current[0].item.ingredients[0].amount = 1000;
  const root = mountShoppingWorkflow({menus: current, data, prepared: prepared(), omittedIds: ['salt', 'water']});
  assert.match(text(one(root, 'shopping-review')), /新しいメニュー/);
  assert.match(text(one(root, 'shopping-final')), /肉じゃが/);
  assert.doesNotMatch(text(one(root, 'shopping-final')), /新しいメニュー/);
  assert.match(text(one(root, 'shopping-source-total')), /合計 120g/);
}));

test('材料不明は購入不要と断定せず、作り置き・外食は原材料の選択肢にしない', () => withDocument(() => {
  const candidates = menus(); candidates[0].item.ingredientsKnown = false; candidates[0].item.ingredients = [];
  candidates[1].item.batchId = 'held';
  const source = candidates.map(menu => ({id: menu.id, item: menu.item, servings: menu.servings, ingredientIds: []}));
  const root = mountShoppingWorkflow({menus: candidates, data, prepared: source});
  assert.match(text(root), /調理済みのため/);
  assert.match(text(one(root, 'shopping-missing-note')), /肉じゃが/);
  assert.match(one(root, 'shopping-nothing-needed').textContent, /確認できた材料.*未確認のメニュー/);
  assert.doesNotMatch(one(root, 'shopping-nothing-needed').textContent, /^購入する材料はありません/);
  assert.equal(byClass(root, 'shopping-check-row').length, 0);
  assert.equal(byClass(root, 'shopping-menu-toggle').length, 1);
}));

test('保存失敗では購入チェックを戻し、料理名や材料名をHTMLへ変換しない', () => withDocument(() => {
  const source = prepared(); source[0].item.name = '<script>menu()</script>';
  const root = mountShoppingWorkflow({menus: [], data, prepared: source, omittedIds: ['water', 'salt'], onCheck() { throw Error('保存できません'); }});
  const check = labelled(root, 'にんじんを購入済みにする'); check.checked = true; check.emit('change');
  assert.equal(check.checked, false); assert.match(one(root, 'shopping-workflow-error').textContent, /保存できません/);
  assert.match(text(one(root, 'shopping-final')), /<script>menu\(\)<\/script>/);
  assert.equal(all(root).filter(element => element.tagName === 'SCRIPT').length, 0);
}));

test('コピー用の一覧も選択済み材料と購入チェックを使い、不明分を注意として残す', () => {
  const source = prepared(); source.push({id: 'c', servings: 1, ingredientIds: [], item: {name: '材料不明の食事', quantity: 1, ingredientsKnown: false, ingredients: []}});
  assert.equal(shoppingChecklistText(null, data), '');
  const copied = shoppingChecklistText(source, data, {pantry: [{id: 'carrot', amount: 20}], omittedIds: ['water', 'salt'], checks: ['carrot']});
  assert.match(copied, /【野菜・いも・きのこ】/); assert.match(copied, /✓ にんじん（皮付き・購入時） 約111\.111g/);
  assert.match(copied, /材料未確認：材料不明の食事/); assert.doesNotMatch(copied, /□ 塩|□ 水/);
  const unknownOnly = shoppingChecklistText([source.at(-1)], data);
  assert.match(unknownOnly, /確認できた材料.*未確認のメニュー/);
  assert.doesNotMatch(unknownOnly, /\n購入する材料はありません/);
});
