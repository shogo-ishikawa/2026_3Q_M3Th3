/** 独立確認：セット保存から再登録・JSON復元までの凍結と境界条件。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {defaultJournal,validateJournal,parseJournal} from '../journal.js';
import {createMealSet,createRepeatedMeal,validateMealSets,mealSetWarnings} from '../meal-sets.js';
import {itemFromRecipe} from '../nutrition.js';
import {mountMealSets} from '../meal-sets-ui.js';

const data={allergens:ALLERGENS,ingredients:INGREDIENTS,recipes:RECIPES};
const date='2026-11-13';
function item(id='test-item'){return {...itemFromRecipe({id:'custom-old-dish',name:'保存時の卵料理',role:'main',servings:1,ingredients:[{id:'egg',amount:1}],steps:['卵を加熱する。']},data),id,portion:{amount:1,unit:'皿'}};}
function entry(items=[item()]){return {id:'old-entry',date,meal:'breakfast',status:'eaten',note:'元のメモ',items};}

class Element {
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.listeners=new Map();this.textContent='';}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(type,fn){this.listeners.set(type,[...(this.listeners.get(type)??[]),fn]);}
  emit(type){for(const fn of this.listeners.get(type)??[])fn({target:this});}
}
const walk=root=>[root,...root.children.flatMap(walk)];
const find=(root,className)=>{const result=walk(root).find(element=>element.className?.split(' ').includes(className));assert.ok(result,className);return result;};
function withDocument(fn){const previous=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};try{return fn();}finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}}

test('セットを保存・復元・倍率付き再登録しても、DB更新や元記録の編集から独立する',()=>{
  const source=entry(),old=structuredClone(source.items[0]);
  const set=createMealSet({name:'いつもの朝食',note:'卵は1皿',entries:[source]},data);
  source.items[0].nutrition.kcal=9999;source.items[0].ingredients[0].amount=9;source.items[0].steps[0]='変更';
  const changedData={...data,recipes:data.recipes.filter(recipe=>recipe.id!==old.recipeId),ingredients:{...data.ingredients,egg:{...data.ingredients.egg,nutritionPerUnit:{kcal:9999},allergens:[]}}};
  const state=defaultJournal(date);state.mealSets=[set];
  const restored=parseJournal(JSON.stringify(state),changedData);
  const repeated=createRepeatedMeal({items:restored.mealSets[0].items,date:'2026-11-14',meal:'lunch',status:'planned',scale:.5},changedData);
  assert.deepEqual(repeated.items[0].nutrition,old.nutrition);assert.deepEqual(repeated.items[0].ingredients,old.ingredients);assert.deepEqual(repeated.items[0].allergens,old.allergens);assert.deepEqual(repeated.items[0].steps,old.steps);
  assert.equal(repeated.items[0].quantity,.5);assert.notEqual(repeated.items[0].id,set.items[0].id);assert.notEqual(set.items[0].id,old.id);
  repeated.items[0].ingredients[0].amount=50;assert.equal(restored.mealSets[0].items[0].ingredients[0].amount,1);
});

test('消えた食材を含む過去のセットも保存・コピーでき、現在DBで置き換えず警告する',()=>{
  const old=item();old.ingredients=[{id:'historic-ingredient',amount:60}];old.ingredientsKnown=false;old.allergensKnown=false;
  const set=createMealSet({name:'過去の組み合わせ',entries:[entry([old])]},data),state=defaultJournal(date);state.mealSets=[set];
  const restored=validateJournal(state,data);assert.equal(restored.mealSets[0].items[0].ingredients[0].id,'historic-ingredient');
  const copied=createRepeatedMeal({items:set.items,date,meal:'lunch',status:'eaten'},data);assert.deepEqual(copied.items[0].nutrition,old.nutrition);
  const warnings=mealSetWarnings(set,{allergens:['egg'],excludedIngredients:['historic-ingredient']},data).join('\n');
  assert.match(warnings,/アレルゲン/);assert.match(warnings,/除外中の食材/);assert.match(warnings,/未確認/);assert.match(warnings,/現在の食材DBにない/);
});

test('作り置きのコピー・セット化を禁止し、残量の二重使用を防ぐ',()=>{
  const batched={...item(),batchId:'batch-example'};
  assert.throws(()=>createMealSet({name:'二重使用',entries:[entry([batched])]},data),/作り置き/);
  assert.throws(()=>createRepeatedMeal({items:[batched],date,meal:'lunch',status:'eaten'},data),/作り置き/);
});

test('100品のセットは使え、101品と倍率適用後の量上限超過を拒否する',()=>{
  const items=Array.from({length:100},(_,index)=>item(`old-${index}`));
  const set=createMealSet({name:'100品',entries:[entry(items)]},data);assert.equal(set.items.length,100);
  const repeated=createRepeatedMeal({items:set.items,date,meal:'lunch',status:'eaten'},data);assert.equal(repeated.items.length,100);assert.equal(new Set(repeated.items.map(item=>item.id)).size,100);
  assert.throws(()=>createMealSet({name:'101品',entries:[entry([...items,item('extra')])]},data),/100品/);
  const tooMuch=item();tooMuch.quantity=2;assert.throws(()=>createRepeatedMeal({items:[tooMuch],date,meal:'lunch',status:'eaten',scale:1000},data),/食べた量/);
});

test('旧v3の未指定フィールドは移行するが、明示したnullは配列として受け付けない',()=>{
  const old=defaultJournal(date);delete old.mealSets;delete old.purchaseSettings;delete old.batches;
  const restored=validateJournal(old,data);assert.deepEqual(restored.mealSets,[]);assert.deepEqual(restored.purchaseSettings,[]);assert.deepEqual(restored.batches,[]);
  for(const key of ['mealSets','purchaseSettings','batches'])assert.throws(()=>validateJournal({...old,[key]:null},data),undefined,key);
});

test('循環やアクセサーを評価せず拒否し、保存元のオブジェクトも変更しない',()=>{
  let calls=0;const accessor={};Object.defineProperty(accessor,'items',{enumerable:true,get(){calls++;throw Error('実行不可');}});
  assert.throws(()=>validateMealSets([{id:'test-set',name:'アクセサー',items:[accessor]}],data));assert.equal(calls,0);
  const cyclic={id:'test-set',name:'循環',items:[]};cyclic.items.push(cyclic);assert.throws(()=>validateMealSets([cyclic],data));
  const source=entry(),before=JSON.stringify(source);createMealSet({name:'朝食',entries:[source]},data);assert.equal(JSON.stringify(source),before);
});

test('セットUIは除外食材と未確認情報を表示してから登録でき、コピー元100品超過は無効にする',()=>withDocument(()=>{
  const source=item();source.ingredientsKnown=false;source.allergensKnown=false;
  const state=defaultJournal(date);state.settings.allergens=['egg'];state.entries=[entry([source])];state.mealSets=[createMealSet({name:'卵の朝食',entries:state.entries},data)];
  let added;const root=mountMealSets({state,data,date,onAdd:value=>{added=value;}});
  const warnings=walk(root).filter(element=>element.className==='meal-sets-warning').map(element=>element.textContent).join('\n');assert.match(warnings,/アレルゲン/);assert.match(warnings,/未確認/);
  find(root,'meal-sets-use').emit('click');assert.ok(added);assert.equal(added.items[0].ingredientsKnown,false);assert.deepEqual(added.items[0].nutrition,source.nutrition);
  state.entries=[entry(Array.from({length:101},(_,index)=>item(`large-${index}`)))];state.mealSets=[];
  const tooLarge=mountMealSets({state,data,date});assert.equal(find(tooLarge,'meal-sets-copy').disabled,true);assert.equal(find(tooLarge,'meal-sets-save').disabled,true);
}));
