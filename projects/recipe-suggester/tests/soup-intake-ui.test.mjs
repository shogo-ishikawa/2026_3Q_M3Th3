import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {buildFoodSelection, defaultFoodSelection} from '../food-composer.js';
import {mountSoupIntake} from '../soup-intake-ui.js';

class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.listeners=new Map();this.textContent='';}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(type,fn){this.listeners.set(type,fn);}
  emit(type){this.listeners.get(type)?.({target:this});}
}
const data={ingredients:INGREDIENTS,recipes:RECIPES,allergens:ALLERGENS};
const recipe=id=>RECIPES.find(recipe=>recipe.id===id);
const all=root=>[root,...root.children.flatMap(all)];
const byClass=(root,className)=>{const found=all(root).find(node=>node.className.split(' ').includes(className));assert.ok(found,className);return found;};
function withDocument(fn){const old=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};try{return fn();}finally{if(old===undefined)delete globalThis.document;else globalThis.document=old;}}

test('追加UIは初期値を全量として1人分の料理を返し、フォームを入れ子にしない',()=>withDocument(()=>{
  const outputs=[],root=mountSoupIntake({baseRecipe:recipe('soup-001'),data,onChange:next=>outputs.push(next)});
  assert.equal(outputs.length,1);assert.equal(outputs[0].servings,1);
  assert.deepEqual(root.getSelection(),{brothRatio:1,solidRatio:1});
  assert.ok(!all(root).some(node=>node.tagName==='FORM'));
  assert.equal(byClass(root,'soup-intake-broth').value,'1');
  const other=mountSoupIntake({baseRecipe:recipe('soup-001'),data}),ids=new Set(all(root).map(node=>node.id).filter(Boolean));
  assert.ok(all(other).filter(node=>node.id).every(node=>!ids.has(node.id)));
}));

test('汁0にしても材料を保持し、割合を切り替えても安定したIDで再計算する',()=>withDocument(()=>{
  let current;const root=mountSoupIntake({baseRecipe:recipe('daily-miso-tonjiru'),data,onChange:next=>{current=next;}}),full=current,id=current.id;
  const broth=byClass(root,'soup-intake-broth');broth.value='0';broth.emit('change');
  assert.ok(current.manualNutrition.salt<full.manualNutrition.salt);assert.equal(current.id,id);assert.deepEqual(current.ingredients,full.ingredients);
  const solids=byClass(root,'soup-intake-solids');solids.value='0.5';solids.emit('change');
  assert.match(current.sourceNote,/汁0%・具50%/);assert.deepEqual(root.getSelection(),{brothRatio:0,solidRatio:.5});
  const materials=byClass(root,'soup-intake-materials');assert.equal(materials.children[1].children.length,full.ingredients.length);
}));

test('ポトフの具材を変更しても選択済みの汁の割合を維持する',()=>withDocument(()=>{
  let current;const base=buildFoodSelection(defaultFoodSelection('pot-au-feu'),data),root=mountSoupIntake({baseRecipe:base,data,initial:{brothRatio:.25},onChange:next=>{current=next;}}),id=current.id;
  const changed=buildFoodSelection({kind:'pot-au-feu',components:[{id:'chicken',amount:200},{id:'water',amount:400},{id:'salt',amount:1}]},data);
  root.setBaseRecipe(changed);
  assert.equal(current.id,id);assert.equal(current.ingredients.find(part=>part.id==='chicken').amount,200);
  assert.equal(root.getSelection().brothRatio,.25);assert.ok(Math.abs(current.manualNutrition.salt-(changed.manualNutrition.salt-INGREDIENTS.salt.nutritionPerUnit.salt*.75))<1e-8);
}));

test('ポタージュの具の操作を隠し、全体の割合だけで計算する',()=>withDocument(()=>{
  let current;const root=mountSoupIntake({baseRecipe:recipe('soup-004'),data,initial:{brothRatio:.333},onChange:next=>{current=next;}});
  const solids=byClass(root,'soup-intake-solids'),label=all(root).find(node=>node.children.includes(solids));
  assert.equal(label.hidden,true);assert.equal(root.getSelection().brothRatio,.333);assert.match(current.name,/33.3%/);
}));

test('不正な割合や未対応の組み合わせは登録結果を消し、訂正すると同じIDで復帰する',()=>withDocument(()=>{
  let current,error;const base=recipe('soup-001'),root=mountSoupIntake({baseRecipe:base,data,onChange:next=>{current=next;},onError:message=>{error=message;}}),id=current.id;
  const broth=byClass(root,'soup-intake-broth');
  for(const value of ['','-1','NaN','1.1']){broth.value=value;broth.emit('change');assert.equal(current,null);assert.ok(error);assert.equal(byClass(root,'soup-intake-preview').hidden,true);}
  broth.value='1';broth.emit('change');assert.equal(current.id,id);assert.equal(error,'');
  root.setBaseRecipe(null);assert.equal(current,null);assert.ok(error);
  root.setBaseRecipe(base);assert.equal(current.id,id);assert.equal(error,'');
}));
