import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {mountCurryRice} from '../curry-rice-ui.js';

class Element {
  constructor(tag) {this.tagName=tag.toUpperCase(); this.children=[]; this.attributes={}; this.listeners=new Map(); this.textContent='';}
  append(...nodes) {this.children.push(...nodes);}
  replaceChildren(...nodes) {this.children=[...nodes];}
  setAttribute(key, value) {this.attributes[key]=value;}
  addEventListener(type, callback) {this.listeners.set(type, callback);}
  emit(type) {this.listeners.get(type)?.({target:this});}
}
const data={recipes:RECIPES, allergens:ALLERGENS, ingredients:INGREDIENTS};
const all=node=>[node, ...node.children.flatMap(all)];
const byClass=(node,name)=>all(node).find(element=>element.className===name);
const text=node=>all(node).map(element=>element.textContent).join(' ');
function documentStub(fn) {const previous=globalThis.document; globalThis.document={createElement:tag=>new Element(tag)}; try{return fn();}finally{previous===undefined?delete globalThis.document:globalThis.document=previous;}}

test('150gを初期表示し、0gや300gに変えると同じIDの材料と栄養を通知する',()=>documentStub(()=>{
  const outputs=[], root=mountCurryRice({recipeId:'daily-curry-beef',data,onChange:recipe=>outputs.push(recipe)});
  assert.equal(outputs.length,1); assert.ok(!all(root).some(element=>element.tagName==='FORM'));
  const input=byClass(root,'dish-rice-amount'); assert.equal(input.value,'150'); assert.equal(input.min,'0'); assert.equal(input.max,'1000');
  assert.match(text(byClass(root,'dish-material-list')),/150 g/);
  input.value='0'; input.emit('input');
  assert.equal(outputs.at(-1).id,outputs[0].id); assert.ok(!outputs.at(-1).ingredients.some(part=>part.id==='rice'));
  assert.match(text(byClass(root,'dish-preview-title')),/ご飯0g・ルーのみ/);
  input.value='300'; input.emit('change');
  assert.equal(outputs.at(-1).id,outputs[0].id); assert.ok(outputs.at(-1).manualNutrition.kcal>outputs[0].manualNutrition.kcal);
  assert.match(text(byClass(root,'dish-material-list')),/300 g/);
}));

test('空欄・範囲外入力は未確定を通知し、訂正するとプレビューが戻る',()=>documentStub(()=>{
  const outputs=[],errors=[],root=mountCurryRice({recipeId:'daily-curry-beef',data,onChange:recipe=>outputs.push(recipe),onError:message=>errors.push(message)}),input=byClass(root,'dish-rice-amount');
  for(const value of ['', ' ', '-1', '1001', 'NaN']) {
    input.value=value;input.emit('input');assert.equal(outputs.at(-1),null);assert.equal(byClass(root,'dish-preview').hidden,true);assert.ok(errors.at(-1));assert.equal(input.attributes['aria-invalid'],'true');
  }
  input.value='0';input.emit('input');assert.ok(outputs.at(-1));assert.equal(byClass(root,'dish-preview').hidden,false);assert.equal(errors.at(-1),'');assert.equal(input.attributes['aria-invalid'],'false');
}));

test('初期0gを保持し、複数の画面でもラベルと入力の識別子は重ならない',()=>documentStub(()=>{
  const root=mountCurryRice({recipeId:'daily-curry-beef',data,initial:{recipeId:'daily-curry-beef',riceGrams:0}});
  const second=mountCurryRice({recipeId:'daily-curry-beef',data});
  const input=byClass(root,'dish-rice-amount');assert.equal(input.value,'0');assert.notEqual(input.id,byClass(second,'dish-rice-amount').id);
  assert.equal(byClass(root,'dish-rice-label').htmlFor,input.id);assert.equal(input.attributes['aria-describedby'],byClass(root,'dish-note').id);
  assert.throws(()=>mountCurryRice({recipeId:'daily-curry-beef',data,initial:{recipeId:'daily-curry-pork',riceGrams:150}}),/一致/);
}));

test('レトルトのアレルゲン確認状態をプレビューにも表示する',()=>documentStub(()=>{
  const root=mountCurryRice({recipeId:'prepared-retort-beef-curry',data});
  assert.match(text(byClass(root,'dish-allergens')),/商品ごとのアレルギー表示/);
  assert.match(text(byClass(root,'dish-intro')),/ナン/);
}));
