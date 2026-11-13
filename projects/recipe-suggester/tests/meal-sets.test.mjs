import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {createMealSet,createRepeatedMeal,validateMealSets,mealSetWarnings,MAX_MEAL_SETS} from '../meal-sets.js';
import {defaultJournal,validateJournal,parseJournal} from '../journal.js';
import {createCatalogEntry} from '../record-actions.js';
import {itemNutrition,sumNutrition} from '../nutrition.js';
import {shoppingForEntries} from '../shopping.js';
const data={allergens:ALLERGENS,ingredients:INGREDIENTS,recipes:RECIPES};
const source=()=>[
  createCatalogEntry({recipeId:'plain-rice',date:'2026-11-10',meal:'breakfast',status:'eaten',amount:120},data),
  createCatalogEntry({recipeId:'chicken-teriyaki',date:'2026-11-10',meal:'breakfast',status:'eaten',amount:1},data),
];
const repeated=(items,extra={})=>createRepeatedMeal({items,date:'2026-11-13',meal:'lunch',status:'planned',...extra},data);

test('複数記録を定番セットにまとめ、日付・状態を保存せず独立したIDで栄養を固定する',()=>{
  const entries=source(),before=structuredClone(entries),set=createMealSet({name:'いつもの朝食',note:'ご飯は120g',entries},data);
  assert.deepEqual(Object.keys(set),['id','name','note','items']);assert.equal(set.items.length,2);
  assert.deepEqual(sumNutrition(set.items),sumNutrition(entries.flatMap(entry=>entry.items)));
  assert.ok(set.items.every(item=>!entries.flatMap(entry=>entry.items).some(original=>original.id===item.id)));
  set.items[0].ingredients[0].amount=999;set.items[1].nutrition.kcal=999;set.items[1].steps.push('変更');
  assert.deepEqual(entries,before);
});

test('コピーは量だけに倍率を掛け、新しい日付・区分・予定へ追加できる',()=>{
  const items=source().flatMap(entry=>entry.items),before=structuredClone(items),entry=repeated(items,{scale:0.5,note:'半量'});
  assert.equal(entry.date,'2026-11-13');assert.equal(entry.meal,'lunch');assert.equal(entry.status,'planned');assert.equal(entry.note,'半量');
  for(const [index,item]of entry.items.entries()){
    assert.notEqual(item.id,items[index].id);assert.equal(item.quantity,items[index].quantity*0.5);
    assert.deepEqual(item.nutrition,items[index].nutrition);assert.deepEqual(item.ingredients,items[index].ingredients);
    assert.equal(itemNutrition(item).kcal,itemNutrition(items[index]).kcal*0.5);
  }
  assert.notEqual(entry.id,repeated(items).id);assert.deepEqual(items,before);
  const buy=shoppingForEntries([entry],data,{from:entry.date,to:entry.date,servings:1,pantry:[]});
  const originalBuy=shoppingForEntries([repeated(items)],data,{from:entry.date,to:entry.date,servings:1,pantry:[]});
  for(const item of buy.items)assert.equal(item.required,originalBuy.items.find(part=>part.id===item.id).required/2);
});

test('過去の料理や材料がDBから消えても、凍結された名称・栄養・不明値を維持する',()=>{
  const item=source()[0].items[0];item.recipeId='retired-dish';item.ingredients=[{id:'retired-material',amount:50}];item.nutrition.fat=null;item.ingredientsKnown=false;item.allergensKnown=false;
  const set=validateMealSets([{id:'meal-set-retired',name:'昔の朝食',items:[item]}],data)[0],entry=repeated(set.items);
  assert.equal(entry.items[0].recipeId,'retired-dish');assert.equal(entry.items[0].ingredients[0].id,'retired-material');assert.equal(entry.items[0].nutrition.fat,null);assert.equal(entry.items[0].allergensKnown,false);
  assert.ok(mealSetWarnings(set,{},data).some(warning=>warning.includes('現在の食材DBにない')));
});

test('定番セットはjournalの書き出し読込で往復し、旧版は空セットへ移行する',()=>{
  const state=defaultJournal('2026-11-13'),set=createMealSet({name:'朝食',entries:source()},data);state.mealSets=[set];
  const clean=validateJournal(state,data);assert.deepEqual(parseJournal(JSON.stringify(clean),data),clean);assert.deepEqual(clean.mealSets[0],set);
  const old=structuredClone(state);delete old.mealSets;assert.deepEqual(validateJournal(old,data).mealSets,[]);assert.deepEqual(validateMealSets(undefined,data),[]);
});

test('除外中の原料とアレルゲンを知らせ、手動記録でも確認フラグを格上げしない',()=>{
  const entries=source(),item=entries[1].items[0];item.allergensKnown=false;
  const set=createMealSet({name:'要確認',entries},data),settings={allergens:['soy','wheat'],excludedIngredients:['chicken','soy']};
  const warnings=mealSetWarnings(set,settings,data);assert.ok(warnings.some(value=>value.includes('アレルゲン')));assert.ok(warnings.some(value=>value.includes('除外中の食材')));assert.ok(warnings.some(value=>value.includes('未確認')));
  const copy=repeated(set.items);assert.equal(copy.items[1].allergensKnown,false);assert.deepEqual(settings,{allergens:['soy','wheat'],excludedIngredients:['chicken','soy']});
});

test('作り置きの割当てをコピー・セット保存で再利用しない',()=>{
  const entries=source();entries[0].items[0].batchId='batch-old';
  assert.throws(()=>createMealSet({name:'作り置き',entries},data),/作り置きは残量画面/);
  assert.throws(()=>repeated(entries.flatMap(entry=>entry.items)),/作り置きは残量画面/);
  assert.throws(()=>validateMealSets([{id:'meal-set-batch',name:'不可',items:entries[0].items}],data),/作り置きは残量画面/);
});

test('名前・日時・倍率・件数・スナップショットの不正値を保存前に拒否する',()=>{
  const entries=source(),set=createMealSet({name:'朝食',entries},data),items=set.items;
  for(const changes of [{date:'2026-02-30'},{date:'2101-01-01'},{meal:'brunch'},{status:'done'},{scale:0},{scale:-1},{scale:NaN},{scale:Infinity},{scale:1001},{scale:'2'},{note:'あ'.repeat(2001)},{extra:true}])assert.throws(()=>repeated(items,changes));
  assert.throws(()=>repeated([{...items[0],quantity:999}],{scale:2}));
  for(const name of ['', 'あ'.repeat(201),null])assert.throws(()=>createMealSet({name,entries},data));
  for(const raw of [null,{},[{}],[{...set,unknown:1}],[set,{...set}],[{...set,items:[]}],Array(MAX_MEAL_SETS+1).fill(set),[{...set,items:[{...items[0],nutrition:{...items[0].nutrition,kcal:-1}}]}]])assert.throws(()=>validateMealSets(raw,data));
});

test('getter・循環・特殊prototype・疎な配列を検証時に実行しない',()=>{
  let reads=0;const set=createMealSet({name:'朝食',entries:source()},data),getter={...set};Object.defineProperty(getter,'name',{enumerable:true,get(){reads++;return '危険';}});
  const cyclic={...set};cyclic.items=[cyclic];
  for(const raw of [[getter],[cyclic],[new Date()],Array(1),[{...set,items:Array(1)}],JSON.parse('[{"__proto__":{}}]')])assert.throws(()=>validateMealSets(raw,data));
  assert.equal(reads,0);
});
