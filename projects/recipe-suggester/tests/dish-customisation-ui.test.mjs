import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {DISH_CUSTOMISERS, defaultDishSelection, buildCustomDish} from '../dish-customisation.js';
import {mountDishCustomiser} from '../dish-customisation-ui.js';

// 実ブラウザの見た目の検証に加え、入力イベントが配合とcallbackへつながることを確かめます。
class Element {
  constructor(tag) {this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.listeners = new Map(); this.textContent = '';}
  append(...children) {this.children.push(...children);}
  replaceChildren(...children) {this.children = [...children];}
  setAttribute(key, value) {this.attributes[key] = value;}
  addEventListener(type, listener) {if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(listener);}
  emit(type) {for (const listener of this.listeners.get(type) ?? []) listener({target: this});}
}
const data = {allergens: ALLERGENS, ingredients: INGREDIENTS, recipes: RECIPES};
const all = root => [root, ...root.children.flatMap(all)];
const find = (root, predicate) => {const result = all(root).find(predicate); assert.ok(result, '入力欄が見つかる'); return result;};
const byClass = (root, name) => find(root, element => element.className === name);
const checkbox = (root, id) => find(root, element => element.id?.endsWith(`-${id}-checked`));
const amount = (root, label) => find(root, element => element.attributes['aria-label'] === `${label}の量（g）`);
const texts = root => all(root).map(element => element.textContent).join('\n');
const selectedParts = recipe => recipe.ingredients.map(part => [part.id, part.amount]);
function withDocument(fn) {
  const old = globalThis.document;
  globalThis.document = {createElement: tag => new Element(tag)};
  try {return fn();} finally {if (old === undefined) delete globalThis.document; else globalThis.document = old;}
}

test('肉じゃがは牛肉と豚肉の選択を配合・栄養・作り方へ反映する', () => withDocument(() => {
  const outputs = [];
  const root = mountDishCustomiser({kind: 'nikujaga', data, onChange: recipe => outputs.push(recipe)});
  assert.equal(outputs.length, 1);
  const first = outputs[0];
  assert.equal(first.role, 'main');
  assert.deepEqual(first.portion, {amount: 1, unit: '皿'});
  assert.ok(!all(root).some(element => element.tagName === 'FORM'));
  const meat = byClass(root, 'dish-meat-select');
  meat.value = 'pork'; meat.emit('change');
  const expected = buildCustomDish({...defaultDishSelection('nikujaga'), meat: 'pork'}, data);
  assert.deepEqual(selectedParts(outputs.at(-1)), selectedParts(expected));
  assert.deepEqual(outputs.at(-1).manualNutrition, expected.manualNutrition);
  assert.notEqual(outputs.at(-1).manualNutrition.kcal, first.manualNutrition.kcal);
  assert.equal(outputs.at(-1).id, first.id);
  assert.match(texts(byClass(root, 'dish-step-list')), /豚/);
  meat.value = 'beef'; meat.emit('change');
  assert.deepEqual(selectedParts(outputs.at(-1)), selectedParts(first));
}));

test('お好み焼きのプリセットを替えると具材・調味料と手順をまとめて替える', () => withDocument(() => {
  let current;
  const root = mountDishCustomiser({kind: 'okonomiyaki', data, onChange: recipe => {current = recipe;}});
  const originalId = current.id;
  const preset = byClass(root, 'dish-preset-select');
  preset.value = 'modern'; preset.emit('change');
  const expected = buildCustomDish(defaultDishSelection('okonomiyaki', 'modern'), data);
  assert.deepEqual(selectedParts(current), selectedParts(expected));
  assert.deepEqual(current.manualNutrition, expected.manualNutrition);
  assert.equal(checkbox(root, 'noodles').checked, true);
  assert.match(texts(byClass(root, 'dish-step-list')), /麺|めん/);
  preset.value = 'squid'; preset.emit('change');
  assert.equal(checkbox(root, 'noodles').checked, false);
  assert.equal(checkbox(root, 'squid').checked, true);
  assert.deepEqual(selectedParts(current), selectedParts(buildCustomDish(defaultDishSelection('okonomiyaki', 'squid'), data)));
  assert.equal(current.id, originalId);
}));

test('具材と量の手動変更を自由調整として扱い、外した具材を計算しない', () => withDocument(() => {
  let current;
  const root = mountDishCustomiser({kind: 'okonomiyaki', data, onChange: recipe => {current = recipe;}});
  const definition = DISH_CUSTOMISERS.find(item => item.kind === 'okonomiyaki');
  const shrimp = definition.components.find(item => item.id === 'shrimp');
  const shrimpChoice = checkbox(root, 'shrimp'); shrimpChoice.checked = false; shrimpChoice.emit('change');
  assert.equal(amount(root, shrimp.label).disabled, true);
  assert.ok(!current.ingredients.some(part => part.id === shrimp.ingredientId));
  assert.equal(byClass(root, 'dish-preset-select').value, 'custom');
  const pork = definition.components.find(item => item.id === 'pork-belly');
  const porkChoice = checkbox(root, 'pork-belly'); porkChoice.checked = true; porkChoice.emit('change');
  const input = amount(root, pork.label); input.value = '85'; input.emit('input');
  assert.equal(current.ingredients.find(part => part.id === pork.ingredientId).amount, 85);
  assert.equal(input.disabled, false);
  assert.match(texts(byClass(root, 'dish-step-list')), /豚/);
}));

test('不正な量では古い配合を返さずnullを通知し、修正すると栄養表示を戻す', () => withDocument(() => {
  const outputs = [], errors = [];
  const root = mountDishCustomiser({kind: 'okonomiyaki', data,
    onChange: recipe => outputs.push(recipe), onError: message => errors.push(message)});
  const definition = DISH_CUSTOMISERS.find(item => item.kind === 'okonomiyaki');
  const selected = defaultDishSelection('okonomiyaki').components[0];
  const component = definition.components.find(item => item.id === selected.id);
  const input = amount(root, component.label); input.value = ''; input.emit('input');
  assert.equal(outputs.at(-1), null);
  assert.equal(byClass(root, 'dish-preview').hidden, true);
  assert.equal(byClass(root, 'dish-error').hidden, false);
  assert.ok(errors.at(-1));
  input.value = '60'; input.emit('input');
  assert.ok(outputs.at(-1));
  assert.equal(byClass(root, 'dish-preview').hidden, false);
  assert.equal(errors.at(-1), '');
  for (const component of definition.components) {
    const choice = checkbox(root, component.id);
    if (choice.checked) {choice.checked = false; choice.emit('change');}
  }
  assert.equal(outputs.at(-1), null, '全て外した配合は登録可能として返さない');
  const squid = checkbox(root, 'squid'); squid.checked = true; squid.emit('change');
  assert.ok(outputs.at(-1), '具材を選び直すと計算を戻す');
}));

test('ソースなしとマヨネーズ0gを選べ、調味料の量を手動で栄養へ反映する', () => withDocument(() => {
  let current;
  const root = mountDishCustomiser({kind: 'okonomiyaki', data, onChange: recipe => {current = recipe;}});
  const sauce = byClass(root, 'dish-sauce-select'), sauceAmount = byClass(root, 'dish-sauce-amount');
  sauce.value = 'none'; sauce.emit('change');
  assert.equal(sauceAmount.disabled, true);
  assert.equal(Number(sauceAmount.value), 0);
  const mayo = byClass(root, 'dish-mayonnaise-amount'); mayo.value = '0'; mayo.emit('input');
  const plainKcal = current.manualNutrition.kcal;
  mayo.value = '10'; mayo.emit('input');
  assert.ok(current.manualNutrition.kcal > plainKcal);
  assert.ok(current.ingredients.some(part => part.id === 'mayonnaise' && part.amount === 10));
  sauce.value = 'worcestershire'; sauce.emit('change');
  assert.equal(sauceAmount.disabled, false);
  assert.ok(Number(sauceAmount.value) > 0);
  assert.equal(byClass(root, 'dish-preset-select').value, 'custom');
}));

test('不正な初期設定と種類を拒否し、複数画面のlabelを一意にする', () => withDocument(() => {
  assert.throws(() => mountDishCustomiser({kind: 'unknown', data}), /料理/);
  assert.throws(() => mountDishCustomiser({kind: 'nikujaga', data, initial: defaultDishSelection('okonomiyaki')}), /種類|設定/);
  const bad = defaultDishSelection('okonomiyaki'); bad.components.push({id: 'unknown', amount: 10});
  assert.throws(() => mountDishCustomiser({kind: 'okonomiyaki', data, initial: bad}), /具材|材料|種類/);
  const first = mountDishCustomiser({kind: 'nikujaga', data}), second = mountDishCustomiser({kind: 'okonomiyaki', data});
  const ids = new Set(all(first).map(element => element.id).filter(Boolean));
  assert.ok(all(second).filter(element => element.id).every(element => !ids.has(element.id)));
  for (const root of [first, second]) {
    const localIds = new Set(all(root).map(element => element.id).filter(Boolean));
    for (const label of all(root).filter(element => element.tagName === 'LABEL')) assert.ok(localIds.has(label.htmlFor));
  }
}));
