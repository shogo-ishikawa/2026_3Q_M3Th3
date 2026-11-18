import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {defaultJournal, validateJournal} from '../journal.js';
import {summariseEntries} from '../nutrition.js';
import {buildRestaurantRecipe} from '../restaurant-menu.js';
import {mountDiningLog} from '../dining-log-ui.js';

const data = {recipes:RECIPES, ingredients:INGREDIENTS, allergens:ALLERGENS};
const day = '2026-11-17';
class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.events = {}; this.value = ''; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(type, fn) { (this.events[type] ??= []).push(fn); }
  setAttribute(name, value) { this[name] = value; }
  fire(type) { this.events[type]?.forEach(fn => fn({target:this, preventDefault(){}})); }
}
const oldDocument = globalThis.document;
test.beforeEach(() => { globalThis.document = {createElement:tag => new Element(tag)}; });
test.afterEach(() => { if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument; });
function render(options = {}) {
  const saved = [];
  const root = mountDiningLog({data, entries:[], date:day, onSave:entry => saved.push(entry), ...options});
  const walk = element => [element, ...element.children.flatMap(walk)];
  const field = name => walk(root).find(element => element.id === `dining-${name}`);
  return {saved, field, submit:() => root.fire('submit'), set:(id, value, event='input') => {
    const input = field(id); input.value = value; input.fire(event);
  }};
}
const summary = (entries, date=day) => summariseEntries(entries, {from:date, to:date});

test('店と料理の記録を予定の献立と同じ日に追加し、成分が未記載のときはすべて不明に保つ', () => {
  const view = render();
  assert.equal(view.field('meal').value, 'lunch');
  view.set('shop', '学食');
  view.set('dish', '日替わり定食');
  view.submit();
  const [entry] = view.saved;
  assert.equal(entry.note, '外食');
  assert.deepEqual([entry.date, entry.meal, entry.status], [day, 'lunch', 'eaten']);
  const [item] = entry.items;
  assert.equal(item.name, '学食｜日替わり定食');
  assert.equal(item.recipeId, null);
  assert.equal(item.ingredientsKnown, false);
  assert.equal(item.allergensKnown, false);
  assert.equal(item.nutritionBasis, 'unknown');
  const journal = defaultJournal(day);
  journal.entries.push({id:'dinner', date:day, meal:'dinner', status:'planned', items:[], note:'家族の夕食'}, entry);
  const clean = validateJournal(JSON.parse(JSON.stringify(journal)), data);
  assert.equal(clean.customRecipes.length, 0);
  assert.deepEqual(clean.entries.map(r => r.id), ['dinner', entry.id]);
  assert.ok(Object.values(clean.entries[1].items[0].nutrition).every(value => value === null));
  assert.equal(summary(clean.entries).knownCounts.kcal, 0);
  assert.equal(summary(clean.entries).entryCount, 1);
});

test('料理1人前の表示値を食べた量で換算し、表示値ゼロ・未掲載・不正を区別する', () => {
  const view = render();
  view.set('dish', 'そば');
  view.set('kcal', '421.25');
  view.set('fat', '0');
  view.set('servings', '0.5');
  view.field('fiber').validity = {badInput:true};
  view.submit();
  assert.equal(view.saved.length, 0);
  view.field('fiber').validity = {badInput:false};
  view.submit();
  const item = view.saved[0].items[0], totals = summary(view.saved);
  assert.equal(item.nutritionBasis, 'manual');
  assert.equal(item.nutrition.fiber, null);
  assert.equal(totals.values.kcal, 210.625);
  assert.equal(totals.complete.fat, true);
  assert.equal(totals.knownCounts.fat, 1);
  assert.equal(totals.knownCounts.fiber, 0);
});

test('履歴は新しい識別子で指定日に複写し、以前に修正した表示値と元の記録を保つ', () => {
  const view = render();
  view.set('dish', 'カツ定食');
  view.set('kcal', '500');
  view.submit();
  const previous = view.saved[0];
  previous.items[0].nutrition.kcal = 507;
  const start = structuredClone(previous);
  const again = render({entries:[previous]});
  again.set('mode', 'saved', 'change');
  again.set('search', 'カツ定食');
  const selected = again.field('choice').children.find(option => option.value.startsWith('history-'));
  assert.ok(selected);
  again.set('choice', selected.value, 'change');
  again.set('amount', '0.5');
  again.set('date', '2026-11-18');
  again.set('meal', 'dinner', 'change');
  again.submit();
  const [entry] = again.saved;
  assert.deepEqual([entry.date, entry.meal, entry.status], ['2026-11-18','dinner','eaten']);
  assert.equal(summary([entry], entry.date).values.kcal, 253.5);
  assert.notEqual(previous.items[0].id, entry.items[0].id);
  assert.deepEqual(previous, start);
});

test('登録した店の最新の値と提供単位を使い、候補から消えた料理を誤って保存しない', () => {
  const restaurant = buildRestaurantRecipe({id:'custom-restaurant-a', genericRecipeId:'chicken-teriyaki',
    storeName:'駅前食堂', menuName:'照り焼き丼', sizeName:'並', inclusion:'ご飯と鶏肉', riceIncluded:true,
    sidesIncluded:false, basis:'per100g', portionAmount:250, portionUnit:'g', sourceUrl:'https://example.com/list',
    checkedDate:day, nutrition:{kcal:140, fiber:null}}, data);
  const view = render({data:{...data, recipes:[...data.recipes, restaurant]}});
  view.set('mode', 'saved', 'change');
  view.set('search', '駅前食堂');
  view.set('choice', `recipe-${restaurant.id}`, 'change');
  assert.equal(view.field('amount').value, '250');
  view.set('search', '該当なし');
  view.submit();
  assert.equal(view.saved.length, 0);
  view.set('search', '駅前食堂');
  view.set('choice', `recipe-${restaurant.id}`, 'change');
  view.set('amount', '125');
  view.submit();
  const [item] = view.saved[0].items;
  assert.equal(item.restaurant.storeName, '駅前食堂');
  assert.equal(item.nutritionBasis, 'official');
  assert.equal(summary(view.saved).values.kcal, 175);
  assert.equal(item.nutrition.fiber, null);
});
