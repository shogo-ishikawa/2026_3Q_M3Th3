import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {createCatalogItem} from '../record-actions.js';
import {mountRecordIngredientEditor} from '../record-ingredient-edit-ui.js';
import {itemNutrition} from '../nutrition.js';

const data = {ingredients: INGREDIENTS, recipes: RECIPES, allergens: ALLERGENS};
class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.value = ''; this.listeners = {}; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this[key] = value; }
  addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
  emit(type, props = {}) { for (const listener of this.listeners[type] ?? []) listener({type, target:this, ...props}); }
}
const originalDocument = globalThis.document;
test.beforeEach(() => { globalThis.document = {createElement: tag => new Element(tag)}; });
test.afterEach(() => { if (originalDocument) globalThis.document = originalDocument; else delete globalThis.document; });
const all = root => [root, ...root.children.flatMap(all)];
const findClass = (root, name) => all(root).find(node => node.className?.split(' ').includes(name));
function screen(item, options = {}) {
  const saved = [];
  let cancelled = 0;
  const root = mountRecordIngredientEditor({item, data, onApply: value => saved.push(value),
    onCancel: () => { cancelled++; }, ...options});
  const field = name => findClass(root, 'record-ingredient-' + name);
  return {root, saved, field, cancelled: () => cancelled,
    row:(kind, id) => all(root).find(node => node['data-kind'] === kind && node['data-ingredient'] === id),
    set:(control, value, event='input') => { control.value = value; control.emit(event); },
    selectAdd:id => {
      field('choice').value = id;
      field('choice').emit('change');
      field('add').emit('click');
    }};
}

test('半量のご飯に卵1個を追加し、実際に食べた分だけを反映する', () => {
  const item = createCatalogItem('plain-rice', 75, data);
  const original = structuredClone(item);
  const view = screen(item, {applyLabel:'この内容で記録'});
  assert.equal(view.field('apply').textContent, 'この内容で記録');
  view.set(view.field('search'), 'たまご');
  assert.equal(view.field('choice').value, 'egg');
  view.field('add').emit('click');
  const qty = findClass(view.row('addition', 'egg'), 'record-ingredient-amount');
  assert.equal(qty.value, '1');
  assert.equal(qty['aria-label'], '卵の量（個）');
  const baseQty = findClass(view.row('base', item.ingredients[0].id), 'record-ingredient-amount');
  assert.equal(baseQty.value, '75');
  view.field('apply').emit('click');
  assert.equal(itemNutrition(view.saved[0]).kcal, itemNutrition(item).kcal + INGREDIENTS.egg.nutritionPerUnit.kcal);
  assert.deepEqual(item, original);
  assert.equal(view.saved[0].id, item.id);
});

test('入力途中は反映を無効にし、キャンセルでは元の内容を保つ', () => {
  const item = createCatalogItem('classic-grilled-salmon', 1, data);
  const original = structuredClone(item), view = screen(item);
  const row = view.row('base', item.ingredients[0].id);
  const qty = findClass(row, 'record-ingredient-amount');
  view.set(qty, '');
  assert.equal(view.field('apply').disabled, true);
  assert.equal(view.field('preview').hidden, true);
  view.field('apply').emit('click');
  assert.equal(view.saved.length, 0);
  view.set(qty, '40');
  assert.equal(view.field('apply').disabled, false);
  findClass(row, 'record-ingredient-remove').emit('click');
  assert.ok(!view.row('base', item.ingredients[0].id));
  view.field('cancel').emit('click');
  assert.deepEqual(item, original);
  assert.equal(view.saved.length, 0);
  assert.equal(view.cancelled(), 1);
});

test('原材料が不確かな料理では追加分だけを再編集し、未確認の成分をゼロにしない', () => {
  const item = createCatalogItem('plain-rice', 150, data);
  item.nutrition = {...item.nutrition, protein:null};
  item.nutritionBasis = 'estimate';
  item.ingredientsKnown = false;
  item.allergensKnown = false;
  const view = screen(item);
  assert.ok(!findClass(view.row('base', item.ingredients[0].id), 'record-ingredient-remove'));
  view.selectAdd('egg');
  view.field('apply').emit('click');
  assert.equal(view.saved[0].nutrition.protein, null);
  const next = screen(view.saved[0]);
  const qty = findClass(next.row('addition', 'egg'), 'record-ingredient-amount');
  next.set(qty, '2');
  next.field('apply').emit('click');
  assert.equal(itemNutrition(next.saved[0]).kcal, itemNutrition(item).kcal + 2 * INGREDIENTS.egg.nutritionPerUnit.kcal);
});

test('食材の種類とかな検索を組み合わせ、該当なしでも追加済みの食材を保つ', () => {
  const view = screen(createCatalogItem('plain-rice', 150, data));
  view.selectAdd('cheese');
  view.set(view.field('category'), 'meat', 'change');
  view.set(view.field('search'), 'なちゅらるちーず');
  assert.equal(view.field('choice').value, '');
  assert.equal(view.field('add').disabled, true);
  assert.ok(view.row('addition','cheese'));
  view.set(view.field('category'), 'dairy', 'change');
  assert.ok(view.field('choice').children.some(child => child.value === 'cheese'));
  let prevented = 0;
  view.root.emit('keydown', {key:'Enter', target:view.field('search'), preventDefault:() => prevented++});
  assert.equal(prevented, 1);
  assert.ok(all(view.root).filter(node => node.tagName === 'BUTTON').every(node => node.type === 'button'));
});
