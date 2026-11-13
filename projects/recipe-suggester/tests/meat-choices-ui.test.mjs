import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {MEAT_CHOICE_INGREDIENTS, MEAT_CHOICE_NUTRITION} from '../meat-choice-foods.js';
import {mountMeatChoice} from '../meat-choices-ui.js';

class Element {
  constructor(tag) {this.tagName=tag.toUpperCase(); this.children=[]; this.attributes={}; this.listeners=new Map(); this.textContent='';}
  append(...nodes) {this.children.push(...nodes);}
  replaceChildren(...nodes) {this.children=[...nodes];}
  setAttribute(key, value) {this.attributes[key]=value;}
  addEventListener(type, callback) {this.listeners.set(type, callback);}
  emit(type) {this.listeners.get(type)?.({target:this});}
}
const data={recipes:RECIPES, allergens:ALLERGENS, ingredients:{...INGREDIENTS, ...Object.fromEntries(Object.entries(MEAT_CHOICE_INGREDIENTS).map(([id, food]) => [id, {...food, ...MEAT_CHOICE_NUTRITION[id]}]))}};
const all = node => [node, ...node.children.flatMap(all)];
const byClass = (node, name) => all(node).find(element => element.className === name);
const text = node => all(node).map(element => element.textContent).join(' ');
function documentStub(fn) {const previous=globalThis.document; globalThis.document={createElement:tag=>new Element(tag)}; try{return fn();}finally{previous===undefined?delete globalThis.document:globalThis.document=previous;}}

test('肉を切り替えると栄養と材料が更新され、同じマイレシピIDを使う', () => documentStub(() => {
  const outputs=[]; const root=mountMeatChoice({recipeId:'classic-hamburg', data, onChange:recipe=>outputs.push(recipe)});
  assert.equal(outputs.length, 1); assert.ok(!all(root).some(element=>element.tagName==='FORM'));
  const select=byClass(root, 'dish-meat-select'); assert.equal(select.value, 'mixed');
  select.value='chicken'; select.emit('change');
  assert.equal(outputs.at(-1).id, outputs[0].id); assert.notEqual(outputs.at(-1).manualNutrition.fat, outputs[0].manualNutrition.fat);
  assert.match(text(byClass(root, 'dish-material-list')), /鶏/); assert.match(text(byClass(root, 'dish-step-list')), /鶏ひき肉/);
  assert.ok(!outputs.at(-1).ingredients.some(part=>part.id==='beef_minced'));
}));

test('除外済みの肉は選択肢へ出さず、禁止された初期肉を勝手に差し替えない', () => documentStub(() => {
  const root=mountMeatChoice({recipeId:'classic-hamburg', data, initial:{recipeId:'classic-hamburg', meatId:'chicken'}, allowedMeatIds:['pork', 'chicken']});
  const select=byClass(root, 'dish-meat-select'); assert.deepEqual(select.children.map(option=>option.value), ['pork', 'chicken']);
  assert.throws(()=>mountMeatChoice({recipeId:'classic-hamburg', data, allowedMeatIds:['pork', 'chicken']}), /条件/);
  assert.throws(()=>mountMeatChoice({recipeId:'classic-hamburg', data, allowedMeatIds:['unknown']}), /種類/);
}));

test('不正な肉の入力時には未確定を通知し、訂正後にプレビューが戻る', () => documentStub(() => {
  const outputs=[], errors=[]; const root=mountMeatChoice({recipeId:'comfort-nikudofu-pork', data, onChange:recipe=>outputs.push(recipe), onError:message=>errors.push(message)});
  const select=byClass(root, 'dish-meat-select'); select.value='invalid'; select.emit('change');
  assert.equal(outputs.at(-1), null); assert.equal(byClass(root, 'dish-preview').hidden, true); assert.ok(errors.at(-1));
  select.value='beef'; select.emit('change'); assert.ok(outputs.at(-1)); assert.equal(byClass(root, 'dish-preview').hidden, false); assert.equal(errors.at(-1), '');
}));

test('もつの状態と計量の説明も選択に合わせて切り替わる', () => documentStub(() => {
  const root=mountMeatChoice({recipeId:'comfort-motsu-stew', data}); const select=byClass(root, 'dish-meat-select');
  assert.match(text(byClass(root, 'dish-note')), /下ゆで後/);
  select.value='beef'; select.emit('change'); assert.match(text(byClass(root, 'dish-note')), /下ゆで前/); assert.match(text(byClass(root, 'dish-step-list')), /生の牛小腸/);
  select.value='beef-rumen'; select.emit('change'); assert.match(text(byClass(root, 'dish-note')), /第一胃/);
}));
