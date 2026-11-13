import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {NOODLE_INGREDIENTS, NOODLE_NUTRITION, NOODLE_RECIPES} from '../noodle-foods.js';
import {mountNoodleComposer} from '../noodle-composer-ui.js';
import {stepQuantityInput} from '../quantity-input.js';

class Element{constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.listeners=new Map();this.textContent='';}append(...children){this.children.push(...children);}replaceChildren(...children){this.children=[...children];}setAttribute(key,value){this.attributes[key]=value;}addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(fn);}emit(type){for(const fn of this.listeners.get(type)??[])fn({target:this});}dispatchEvent(event){this.emit(event.type);return true;}}
const ingredients={...INGREDIENTS,...Object.fromEntries(Object.entries(NOODLE_INGREDIENTS).map(([id,food])=>[id,{...food,...NOODLE_NUTRITION[id]}]))};
const data={allergens:ALLERGENS,ingredients,recipes:[...RECIPES,...NOODLE_RECIPES.filter(recipe=>!RECIPES.some(old=>old.id===recipe.id))]};
const all=root=>[root,...root.children.flatMap(all)];
const byClass=(root,className)=>{const found=all(root).find(element=>element.className.split(' ').includes(className));assert.ok(found,className);return found;};
const byId=(root,end)=>{const found=all(root).find(element=>element.id?.endsWith(end));assert.ok(found,end);return found;};
function withDocument(fn){const previous=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};try{return fn();}finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}}
const initial={recipeId:'daily-ramen-soy',noodleAmount:150,soupIntake:'full',toppings:[]};

test('スープ5段階と具の入力を表示し、飲む量を変えても調理量を変えずformを入れ子にしない',()=>withDocument(()=>{
  let current;const root=mountNoodleComposer({recipeId:initial.recipeId,data,initial,onChange:recipe=>{current=recipe;}}),id=current.id,parts=JSON.stringify(current.ingredients),soup=byClass(root,'noodle-soup-intake');
  assert.equal(soup.children.length,5);assert.ok(soup.children.some(option=>option.textContent.includes('麺に絡む程度（約10%')));
  assert.equal(soup.children.find(option=>option.value==='half').textContent,'半分（約50%・基準量換算 約175ml）');
  assert.match(byClass(root,'noodle-soup-note').textContent,/調味料を加える前のだし・水の基準量は1杯約350ml/);
  assert.match(byClass(root,'noodle-soup-note').textContent,/味噌や油などを加えると出来上がりの量は変わります/);
  assert.ok(!all(root).some(element=>element.tagName==='FORM'));
  const full=current.manualNutrition;soup.value='half';soup.emit('change');assert.equal(current.id,id);assert.equal(JSON.stringify(current.ingredients),parts);assert.ok(current.manualNutrition.salt<full.salt);
}));

test('卓上にんにく小さじをgへ加算し、検索は種類を隠すだけで選択を失わない',()=>withDocument(()=>{
  let current;const root=mountNoodleComposer({recipeId:initial.recipeId,data,initial,onChange:recipe=>{current=recipe;}}),check=byId(root,'-garlic-checked'),amount=byId(root,'-garlic-amount');
  assert.equal(amount.disabled,true);check.checked=true;check.emit('change');amount.value='2';amount.emit('input');assert.equal(current.ingredients.find(part=>part.id==='garlic').amount,6);
  const before=JSON.stringify(current),search=byClass(root,'noodle-topping-search');search.value='味玉';search.emit('input');assert.equal(JSON.stringify(current),before);
  check.checked=false;check.emit('change');assert.ok(!current.ingredients.some(part=>part.id==='garlic'));
}));

test('空の量・不正な量を入力すると旧プレビューを無効にし、リセットで同じIDへ復帰する',()=>withDocument(()=>{
  const outputs=[],root=mountNoodleComposer({recipeId:initial.recipeId,data,initial,onChange:recipe=>outputs.push(recipe)}),id=outputs[0].id,amount=byClass(root,'noodle-amount');
  amount.value='';amount.emit('input');assert.equal(outputs.at(-1),null);assert.equal(byClass(root,'noodle-preview').hidden,true);
  amount.value='-1';amount.emit('input');assert.equal(outputs.at(-1),null);
  byClass(root,'noodle-reset').emit('click');assert.equal(outputs.at(-1).id,id);assert.equal(amount.value,'150');assert.equal(byClass(root,'noodle-preview').hidden,false);
}));

test('汁なしにはスープ量を表示せず、別画面の入力IDは重複しない',()=>withDocument(()=>{
  const first=mountNoodleComposer({recipeId:'noodle-aburasoba',data}),second=mountNoodleComposer({recipeId:'noodle-aburasoba',data});
  assert.ok(!all(first).some(element=>element.className.split(' ').includes('noodle-soup-intake')));
  const ids=new Set(all(first).map(element=>element.id).filter(Boolean));assert.ok(all(second).filter(element=>element.id).every(element=>!ids.has(element.id)));
}));

test('トッピングは小数を保ち、0で選択を外し、再選択で直前の正の量を戻す',()=>withDocument(()=>{
  let current;const root=mountNoodleComposer({recipeId:initial.recipeId,data,initial,onChange:recipe=>{current=recipe;}}),check=byId(root,'-garlic-checked'),amount=byId(root,'-garlic-amount');
  check.checked=true;check.emit('change');amount.value='0.5';amount.emit('input');
  assert.equal(current.ingredients.find(part=>part.id==='garlic').amount,1.5);
  amount.value='0';amount.emit('input');assert.equal(check.checked,false);assert.equal(amount.disabled,true);assert.ok(!current.ingredients.some(part=>part.id==='garlic'));
  check.checked=true;check.emit('change');assert.equal(amount.value,'0.5');assert.equal(amount.disabled,false);assert.equal(current.ingredients.find(part=>part.id==='garlic').amount,1.5);
  byClass(root,'noodle-reset').emit('click');check.checked=true;check.emit('change');const defaultAmount=amount.value;amount.value='0';amount.emit('input');check.checked=true;check.emit('change');assert.equal(amount.value,defaultAmount,'リセット後は初期量を復元する');
}));

test('不正なトッピング入力を0と扱わず、麺と具の小数は入力できる',()=>withDocument(()=>{
  const outputs=[],root=mountNoodleComposer({recipeId:initial.recipeId,data,initial,onChange:recipe=>outputs.push(recipe)}),check=byId(root,'-garlic-checked'),amount=byId(root,'-garlic-amount');
  check.checked=true;check.emit('change');
  for(const value of ['', ' ', 'abc', 'NaN', 'Infinity', '-1', '-0', '+0', '0x0', '0e2', '1e2', '1001']){
    amount.value=value;amount.emit('input');assert.equal(check.checked,true,value);assert.equal(amount.disabled,false,value);assert.equal(outputs.at(-1),null,value);
  }
  amount.value='0.25';amount.emit('input');const noodles=byClass(root,'noodle-amount');noodles.value='125.5';noodles.emit('input');
  assert.ok(outputs.at(-1));assert.equal(outputs.at(-1).ingredients.find(part=>part.id==='garlic').amount,.75);
  assert.ok(outputs.at(-1).ingredients.some(part=>part.amount===125.5));
}));


test('上下操作は小数を保って1ずつ動き、下限0へ達したトッピングを選択解除する',()=>withDocument(()=>{
  let current;const root=mountNoodleComposer({recipeId:initial.recipeId,data,initial,onChange:recipe=>{current=recipe;}}),check=byId(root,'-garlic-checked'),amount=byId(root,'-garlic-amount');
  check.checked=true;check.emit('change');amount.value='0.5';amount.emit('input');
  assert.equal(stepQuantityInput(amount,1),true);assert.equal(amount.value,'1.5');assert.equal(current.ingredients.find(part=>part.id==='garlic').amount,4.5);
  assert.equal(stepQuantityInput(amount,-1),true);assert.equal(amount.value,'0.5');
  assert.equal(stepQuantityInput(amount,-1),true);assert.equal(amount.value,'0');assert.equal(check.checked,false);assert.equal(amount.disabled,true);assert.ok(!current.ingredients.some(part=>part.id==='garlic'));
  assert.equal(stepQuantityInput(amount,1),false,'選択解除した欄の上下操作で勝手に具材を追加しない');
}));
