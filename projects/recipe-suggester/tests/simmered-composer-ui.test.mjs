import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {SIMMERED_INGREDIENTS,SIMMERED_NUTRITION} from '../simmered-foods.js';
import {mountFoodComposer} from '../food-composer-ui.js';

class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.listeners=new Map();this.textContent='';}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(type,listener){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(listener);}
  emit(type){for(const listener of this.listeners.get(type)??[])listener({target:this});}
}
const data={allergens:ALLERGENS,recipes:RECIPES,ingredients:Object.fromEntries(Object.entries({...INGREDIENTS,...SIMMERED_INGREDIENTS}).map(([id,food])=>[id,{...food,...SIMMERED_NUTRITION[id]}]))};
const all=root=>[root,...root.children.flatMap(all)];
const find=(root,predicate)=>{const result=all(root).find(predicate);assert.ok(result,'入力が見つかる');return result;};
const check=(root,id)=>find(root,element=>element.id?.endsWith(`-${id}-checked`));
const byClass=(root,name)=>find(root,element=>element.className.split(' ').includes(name));
const field=(root,label)=>find(root,element=>element.attributes['aria-label']===label);
const withDocument=fn=>{const before=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};try{return fn();}finally{if(before===undefined)delete globalThis.document;else globalThis.document=before;}};

test('ポトフの水0や空欄では古い栄養を記録へ返さず、リセットで同じIDに戻る',()=>withDocument(()=>{
  const changes=[],root=mountFoodComposer({kind:'pot-au-feu',data,onChange:recipe=>changes.push(recipe)});
  const original=changes.at(-1);assert.ok(original);assert.equal(original.role,'soup');
  assert.ok(!all(root).some(element=>element.tagName==='FORM'));
  const water=field(root,'煮汁の水の量（ml）');water.value='0';water.emit('input');
  assert.equal(changes.at(-1),null);assert.equal(byClass(root,'food-composer-preview').hidden,true);
  assert.match(byClass(root,'food-composer-error').textContent,/煮汁の水/);
  water.value='';water.emit('input');assert.equal(changes.at(-1),null);
  byClass(root,'food-composer-reset').emit('click');assert.equal(changes.at(-1).id,original.id);
  assert.equal(changes.at(-1).ingredients.find(part=>part.id==='water').amount,350);
}));

test('おでんの新しい具を個数と標準重量で編集し、外した具の重さを残さない',()=>withDocument(()=>{
  const changes=[],root=mountFoodComposer({kind:'oden',data,onChange:recipe=>changes.push(recipe)});
  assert.equal(all(root).filter(element=>element.className==='food-composer-check').length,22);
  const potato=check(root,'potato');potato.checked=true;potato.emit('change');
  const qty=field(root,'じゃがいもの量（個）'),weight=field(root,'じゃがいもの1個の重さ（g）');
  qty.value='2';qty.emit('input');weight.value='100';weight.emit('input');
  assert.equal(changes.at(-1).ingredients.find(part=>part.id==='potato').amount,200);
  potato.checked=false;potato.emit('change');
  assert.ok(!changes.at(-1).ingredients.some(part=>part.id==='potato'));
  assert.equal(qty.disabled,true);assert.equal(weight.disabled,true);
}));
