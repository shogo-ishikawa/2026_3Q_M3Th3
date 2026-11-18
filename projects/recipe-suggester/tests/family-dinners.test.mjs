import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {defaultJournal, parseJournal, validateJournal} from '../journal.js';
import {createMealSet, createFamilyDinner, planFamilyDinner} from '../meal-sets.js';
import {mountFamilyDinners} from '../family-dinners-ui.js';
import {createCatalogEntry} from '../record-actions.js';
import {shoppingMenuContext} from '../shopping-workflow.js';
import {shoppingForEntries} from '../shopping.js';
import {sumNutrition} from '../nutrition.js';

const data = {allergens:ALLERGENS, ingredients:INGREDIENTS, recipes:RECIPES};
const date = '2026-11-18';
const rice = () => createCatalogEntry({recipeId:'plain-rice', date, meal:'dinner', status:'eaten', amount:120}, data);
const chicken = () => createCatalogEntry({recipeId:'chicken-teriyaki', date, meal:'dinner', status:'eaten', amount:1}, data);

test('保存した献立の量・調理手順・栄養を保ち、買い物のみ家族人数で集計する', () => {
  const items = [rice().items[0], chicken().items[0]];
  const saved = createFamilyDinner('鶏の照り焼き定食', items, data);
  const state = defaultJournal(date);
  state.mealSets = [saved, createMealSet({name:'ほかの定番', entries:[rice()]}, data)];
  const entry = planFamilyDinner(saved, date, 4, data);
  state.entries = [entry];
  const reread = parseJournal(JSON.stringify(state), data);
  assert.equal(reread.mealSets[0].kind, 'family-dinner');
  assert.equal(Object.hasOwn(reread.mealSets[1], 'kind'), false);
  assert.deepEqual(reread.entries[0], entry);
  assert.deepEqual(sumNutrition(entry.items), sumNutrition(items));
  for (const [i, item] of entry.items.entries()) {
    assert.deepEqual(item.steps, items[i].steps);
    assert.deepEqual(item.ingredients, items[i].ingredients);
    assert.equal(item.quantity, items[i].quantity);
    assert.notEqual(item.id, saved.items[i].id);
    assert.notEqual(item.id, items[i].id);
  }
  assert.equal(entry.note, saved.name);
  assert.equal(entry.meal, 'dinner');
  assert.equal(entry.status, 'planned');
  const options = {source:'calendar', from:date, to:date};
  assert.deepEqual(shoppingMenuContext(reread, data, options).menus.map(menu => menu.servings), [4,4]);
  const one = shoppingForEntries([{...entry, shoppingServings:1}], data, options);
  assert.deepEqual(shoppingForEntries([entry], data, options).items.map(row => row.buy), one.items.map(row => row.buy * 4));
  assert.doesNotThrow(() => createMealSet({name:'再保存', entries:[entry]}, data));
  entry.status = 'eaten';
  assert.deepEqual(validateJournal(state, data).entries, [entry]);
  assert.equal(shoppingMenuContext(state, data, options).menus.length, 0);
  assert.throws(() => planFamilyDinner(saved, '2026-02-30', 4, data));
  for (const count of [0, 9, 2.5, null, '2']) {
    entry.shoppingServings = count;
    assert.throws(() => validateJournal(state, data));
    assert.throws(() => planFamilyDinner(saved, date, count, data));
  }
});

// A minimal DOM exercises the same controls and event handlers as the browser.
function installDOM(t) {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.textContent = ''; this.events = {}; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(name, value) { this[name] = value; }
    addEventListener(name, cb) { this.events[name] = cb; }
    fire(name) { if (!this.disabled) this.events[name](); }
  }
  const previous = globalThis.document;
  globalThis.document = {createElement:tag => new Element(tag)};
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
}
function panel(options) {
  const root = mountFamilyDinners({data,date,...options});
  const walk = node => [node, ...node.children.flatMap(walk)];
  const all = () => walk(root);
  return {
    all,
    field:label => all().find(node => node.tag === 'label' && node.textContent === label).children[0],
    click:label => all().find(node => node.tag === 'button' && node.textContent === label).fire('click')
  };
}

test('提案から名付けて保存した夕食を別の日に登録し、条件に合わない夕食には警告を表示する', t => {
  installDOM(t);
  const state = defaultJournal(date);
  let saved, planned;
  const items = chicken().items;
  const proposal = panel({state, proposedItems:items, onSave:set => {saved=set;}});
  proposal.field('定番の名前').value = '鶏の照り焼き';
  proposal.click('家族の定番に保存');
  state.mealSets = [saved];
  const params = {state, onSchedule:entry => {planned=entry;}};
  const picker = panel(params);
  picker.field('夕飯の日付').value = '2026-11-23';
  picker.field('買い物の人数').value = '3';
  picker.click('この日の夕食予定に追加');
  assert.equal(planned.date, '2026-11-23');
  assert.equal(planned.shoppingServings, 3);
  assert.equal(state.entries.length, 0);
  state.settings.allergens = ['soy'];
  const restricted = panel(params);
  assert.ok(restricted.all().some(node => node.textContent.includes('避けるアレルゲン')));
  assert.equal(restricted.all().find(node => node.textContent === 'この日の夕食予定に追加').disabled, true);
});

test('お気に入りの選択または同じ日の夕食から、料理と量を保持して家族の定番を組む', t => {
  installDOM(t);
  const state = defaultJournal(date);
  state.favourites = [rice(), chicken()].map(entry => ({item:entry.items[0]}));
  state.entries = [rice(), chicken(), {...rice(), meal:'lunch'}];
  const saved = [];
  const ui = panel({state, onSave:set => saved.push(set)});
  const checks = ui.all().filter(node => node.type === 'checkbox');
  checks[1].checked = true;
  ui.field('定番の名前').value = 'おかずだけ';
  ui.click('家族の定番に保存');
  assert.deepEqual(saved[0].items.map(item => item.recipeId), ['chicken-teriyaki']);
  const source = ui.field('料理の選び方');
  source.value = 'history';
  source.fire('change');
  ui.field('定番の名前').value = '夕食一式';
  ui.click('家族の定番に保存');
  assert.deepEqual(saved[1].items.map(item => item.recipeId), ['plain-rice','chicken-teriyaki']);
  assert.equal(saved[1].items[0].quantity, rice().items[0].quantity);
});
