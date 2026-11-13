import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {mountSaladBuilder, defaultSaladSelection} from '../salad-builder-ui.js';
import {SALAD_DRESSINGS} from '../salad-builder.js';

// 画面全体のブラウザ検証とは別に、実際の入力イベントとcallbackの接続を確かめます。
class Element {
  constructor(tag) {this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.listeners = new Map(); this.textContent = '';}
  append(...children) {this.children.push(...children);}
  replaceChildren(...children) {this.children = [...children];}
  setAttribute(key, value) {this.attributes[key] = value;}
  getAttribute(key) {return this.attributes[key] ?? null;}
  addEventListener(type, listener) {if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(listener);}
  dispatchEvent(event) {this.emit(event.type, event); return true;}
  emit(type, event = {}) {for (const listener of this.listeners.get(type) ?? []) listener({target: this, preventDefault() {}, ...event, key: event.key});}
}
const data = {allergens: ALLERGENS, ingredients: INGREDIENTS, recipes: RECIPES};
const all = root => [root, ...root.children.flatMap(all)];
const find = (root, fn) => {const result = all(root).find(fn); assert.ok(result, '入力欄が見つかる'); return result;};
const amount = (root, name) => find(root, e => e.attributes['aria-label'] === `${name}の量（g）`);
const checkbox = (root, id) => find(root, e => e.id?.endsWith(`-${id}-checked`));
const byClass = (root, name) => find(root, e => e.className === name);

function withDocument(fn) {
  const original = globalThis.document;
  globalThis.document = {createElement: tag => new Element(tag)};
  try {return fn();} finally {if (original === undefined) delete globalThis.document; else globalThis.document = original;}
}

test('既存の生野菜サラダと同じ初期量を使い、1皿の計算結果を最初に渡す', () => withDocument(() => {
  const outputs = [];
  const root = mountSaladBuilder({data, onChange: recipe => outputs.push(recipe)});
  assert.equal(outputs.length, 1);
  const recipe = outputs[0];
  assert.equal(recipe.role, 'side');
  assert.deepEqual(recipe.portion, {amount: 1, unit: '皿'});
  assert.deepEqual(recipe.ingredients.map(part => [part.id, part.amount]), [['lettuce', 50], ['cabbage', 50], ['cucumber', 30], ['tomato', 50], ['carrot', 15]]);
  assert.ok(!all(root).some(e => e.tagName === 'FORM'), 'カレンダーのformを入れ子にしない');
  assert.equal(amount(root, 'レタス').disabled, false);
  assert.equal(checkbox(root, 'broccoli').checked, false);
  assert.equal(byClass(root, 'salad-dressing-amount').disabled, true);
  const first = defaultSaladSelection(); first.components[0].amount = 999;
  assert.equal(defaultSaladSelection().components[0].amount, 50, '初期配合を共有して書き換えない');
}));

test('材料を外すと実際の配合と量欄を更新し、外した材料の量を足さない', () => withDocument(() => {
  let current;
  const root = mountSaladBuilder({data, onChange: recipe => {current = recipe;}});
  const firstId = current.id;
  const lettuce = checkbox(root, 'lettuce'); lettuce.checked = false; lettuce.emit('change');
  assert.equal(amount(root, 'レタス').disabled, true);
  assert.ok(!current.ingredients.some(part => part.id === 'lettuce'));
  assert.equal(current.id, firstId, '入力のたびに別メニューの識別子を増やさない');
  const cabbage = amount(root, 'キャベツ'); cabbage.value = '75'; cabbage.emit('input');
  assert.equal(current.ingredients.find(part => part.id === 'cabbage').amount, 75);
  lettuce.checked = true; lettuce.emit('change');
  assert.equal(amount(root, 'レタス').disabled, false);
  assert.equal(current.ingredients.find(part => part.id === 'lettuce').amount, 50);
}));

test('不正な量では古い有効結果を返さずnullを通知し、修正すると再計算する', () => withDocument(() => {
  const outputs = [], errors = [];
  const root = mountSaladBuilder({data, onChange: recipe => outputs.push(recipe), onError: message => errors.push(message)});
  const input = amount(root, 'レタス'); input.value = ''; input.emit('input');
  assert.equal(outputs.at(-1), null);
  assert.ok(errors.at(-1));
  assert.equal(byClass(root, 'salad-preview').hidden, true);
  assert.equal(byClass(root, 'salad-error').hidden, false);
  input.value = '25'; input.emit('input');
  assert.equal(outputs.at(-1).ingredients.find(part => part.id === 'lettuce').amount, 25);
  assert.equal(errors.at(-1), '');
  assert.equal(byClass(root, 'salad-error').hidden, true);
}));

test('ドレッシングを替えると既定g量へ変更し、追加材料と栄養を反映する', () => withDocument(() => {
  let current;
  const root = mountSaladBuilder({data, onChange: recipe => {current = recipe;}});
  const plain = current.manualNutrition.kcal;
  const select = byClass(root, 'salad-dressing-select');
  const input = byClass(root, 'salad-dressing-amount');
  select.value = 'wafu'; select.emit('change');
  assert.equal(input.disabled, false);
  assert.equal(Number(input.value), SALAD_DRESSINGS.find(dressing => dressing.id === 'wafu').defaultAmount);
  assert.ok(current.manualNutrition.kcal > plain);
  const dressedKcal = current.manualNutrition.kcal;
  input.value = String(Number(input.value) * 2); input.emit('input');
  assert.ok(current.manualNutrition.kcal > dressedKcal);
  select.value = 'none'; select.emit('change');
  assert.equal(input.disabled, true);
  assert.equal(Number(input.value), 0);
  assert.equal(current.manualNutrition.kcal, plain);
}));

test('初期設定の未知の材料を黙って削らず拒否し、複数画面のlabel識別子を分ける', () => withDocument(() => {
  const first = mountSaladBuilder({data}), second = mountSaladBuilder({data});
  const firstIds = new Set(all(first).map(e => e.id).filter(Boolean));
  assert.ok(all(second).filter(e => e.id).every(e => !firstIds.has(e.id)));
  for (const root of [first, second]) {
    const ids = new Set(all(root).map(e => e.id).filter(Boolean));
    for (const label of all(root).filter(e => e.tagName === 'LABEL')) assert.ok(ids.has(label.htmlFor));
  }
  const initial = defaultSaladSelection(); initial.components.push({id: 'unknown', amount: 10});
  assert.throws(() => mountSaladBuilder({data, initial}), /材料|野菜|選択|サラダ/);
}));

test('野菜を0gにすると外れ、再選択で最後の小数量を戻して栄養を復元する', () => withDocument(() => {
  let current;const root=mountSaladBuilder({data,onChange:recipe=>{current=recipe;}}),lettuce=checkbox(root,'lettuce'),quantity=amount(root,'レタス');
  quantity.value='0.25';quantity.emit('input');const kcal=current.manualNutrition.kcal;
  assert.equal(current.ingredients.find(part=>part.id==='lettuce').amount,.25);
  quantity.value='0';quantity.emit('input');assert.equal(lettuce.checked,false);assert.equal(quantity.disabled,true);assert.ok(!current.ingredients.some(part=>part.id==='lettuce'));
  lettuce.checked=true;lettuce.emit('change');assert.equal(quantity.value,'0.25');assert.equal(quantity.disabled,false);assert.equal(current.manualNutrition.kcal,kcal);
  quantity.emit('keydown',{key:'ArrowUp'});assert.equal(quantity.value,'1.25');assert.equal(current.ingredients.find(part=>part.id==='lettuce').amount,1.25);
}));

test('ドレッシング0gはなしへ切り替え、不正値は選択を保って記録を止める', () => withDocument(() => {
  let current;const root=mountSaladBuilder({data,onChange:recipe=>{current=recipe;}}),select=byClass(root,'salad-dressing-select'),quantity=byClass(root,'salad-dressing-amount');
  const plain=current.manualNutrition.kcal;select.value='wafu';select.emit('change');
  for(const value of ['', '-1', '-0', 'abc', 'Infinity', '1e2', '0x10', '301']){
    quantity.value=value;quantity.emit('input');assert.equal(select.value,'wafu',value);assert.equal(quantity.disabled,false,value);assert.equal(current,null,value);
    quantity.value='0.5';quantity.emit('input');assert.ok(current,value);
  }
  quantity.emit('keydown',{key:'ArrowDown'});assert.equal(quantity.value,'0');assert.equal(select.value,'none');assert.equal(quantity.disabled,true);assert.equal(current.manualNutrition.kcal,plain);
}));
