import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {defaultJournal} from '../journal.js';
import {createCatalogEntry} from '../record-actions.js';
import {createMealSet} from '../meal-sets.js';
import {mountMealSets} from '../meal-sets-ui.js';
class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.listeners=new Map();this.textContent='';}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(type,listener){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(listener);}
  emit(type){for(const listener of this.listeners.get(type)??[])listener({target:this});}
}
const all=root=>[root,...root.children.flatMap(all)];
const byClass=(root,value)=>{const result=all(root).find(node=>node.className.split(' ').includes(value));assert.ok(result,value);return result;};
const field=(root,suffix)=>{const result=all(root).find(node=>node.id?.endsWith(`-${suffix}`));assert.ok(result,suffix);return result;};
const withDocument=fn=>{const old=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};try{return fn();}finally{if(old===undefined)delete globalThis.document;else globalThis.document=old;}};
const data={allergens:ALLERGENS,ingredients:INGREDIENTS,recipes:RECIPES};
const entry=(recipeId='plain-rice',amount=120,date='2026-11-10')=>createCatalogEntry({recipeId,amount,date,meal:'breakfast',status:'eaten'},data);
function state(){const result=defaultJournal('2026-11-13');result.entries=[entry(),entry('chicken-teriyaki',1)];return result;}

test('直近の同じ食事枠の全料理を選び、登録先と半量を指定してコピーする',()=>withDocument(()=>{
  const source=state(),before=structuredClone(source),added=[],root=mountMealSets({state:source,data,date:'2026-11-13',meal:'lunch',status:'planned',onAdd:value=>added.push(value)});
  assert.ok(!all(root).some(node=>node.tagName==='FORM'));assert.equal(field(root,'source-date').value,'2026-11-10');assert.equal(field(root,'source-meal').value,'breakfast');
  field(root,'target-date').value='2026-11-14';field(root,'scale').value='0.5';byClass(root,'meal-sets-copy').emit('click');
  assert.equal(added.length,1);assert.equal(added[0].date,'2026-11-14');assert.equal(added[0].meal,'lunch');assert.equal(added[0].status,'planned');assert.equal(added[0].items.length,2);
  assert.equal(added[0].items[0].quantity,source.entries[0].items[0].quantity*0.5);assert.deepEqual(source,before);
  field(root,'scale').value='';byClass(root,'meal-sets-copy').emit('click');assert.equal(added.length,1);assert.equal(byClass(root,'meal-sets-error').hidden,false);
}));

test('名前を付けて定番セットを保存し、保存済みセットは独立して登録・削除できる',()=>withDocument(()=>{
  const source=state(),saved=[],errors=[],root=mountMealSets({state:source,data,date:'2026-11-13',onSave:value=>saved.push(value),onError:value=>errors.push(value)});
  byClass(root,'meal-sets-save').emit('click');assert.equal(saved.length,0);assert.ok(errors.length);
  field(root,'name').value='いつもの朝食';field(root,'note').value='ご飯は少なめ';field(root,'scale').value='2';byClass(root,'meal-sets-save').emit('click');
  assert.equal(saved.length,1);assert.equal(saved[0].name,'いつもの朝食');assert.equal(saved[0].items[0].quantity,source.entries[0].items[0].quantity);
  source.mealSets=saved;const added=[],removed=[],mounted=mountMealSets({state:source,data,date:'2026-11-13',meal:'breakfast',status:'eaten',onAdd:value=>added.push(value),onDelete:id=>removed.push(id)});
  byClass(mounted,'meal-sets-use').emit('click');assert.equal(added[0].items.length,2);assert.equal(added[0].note,'ご飯は少なめ');assert.notEqual(added[0].items[0].id,saved[0].items[0].id);
  byClass(mounted,'meal-sets-delete').emit('click');assert.deepEqual(removed,[saved[0].id]);
}));

test('記録のない日と作り置きはコピー・セット保存を無効にし、除外情報も表示する',()=>withDocument(()=>{
  const source=state();source.settings.allergens=['soy'];source.entries[0].items[0].batchId='batch-old';
  const root=mountMealSets({state:source,data,date:'2026-11-13'});
  assert.equal(byClass(root,'meal-sets-copy').disabled,true);assert.equal(byClass(root,'meal-sets-save').disabled,true);
  assert.ok(all(root).some(node=>node.textContent.includes('作り置きは残量画面')));assert.ok(all(root).some(node=>node.textContent.includes('避けるアレルゲン')));
  field(root,'source-date').value='2026-11-09';field(root,'source-date').emit('change');assert.equal(byClass(root,'meal-sets-copy').disabled,true);assert.ok(all(root).some(node=>node.textContent.includes('この条件の食事はありません')));
  const empty=mountMealSets({state:defaultJournal('2026-11-13'),data,date:'2026-11-13'});assert.equal(byClass(empty,'meal-sets-use').disabled,true);assert.equal(byClass(empty,'meal-sets-delete').disabled,true);
}));
