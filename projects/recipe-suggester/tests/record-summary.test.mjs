import test from 'node:test';
import assert from 'node:assert/strict';
import {describeRegistration} from '../record-summary.js';

const nutrients = (kcal=200) => ({kcal, protein:6, fat:4, carbs:30, fiber:2, salt:.6});
const data = {allergens:[], recipes:[], ingredients:{
  bread:{name:'食パン',unit:'g',nutritionPerUnit:nutrients(9999)},
  butter:{name:'バター',unit:'g',nutritionPerUnit:nutrients(9999)},
}};
const item = () => ({id:'toast-item',recipeId:'old-toast',name:'トースト',quantity:2,
  nutrition:nutrients(),ingredients:[{id:'bread',amount:60},{id:'butter',amount:5}],
  groups:[],proteinSources:[],allergens:[],allergensKnown:true,ingredientsKnown:true,
  steps:[],role:'staple',portion:{amount:1,unit:'枚',label:'食パン1枚分'}});
const entry = () => ({date:'2026-11-14',meal:'breakfast',status:'eaten',items:[item()]});

test('登録する数量を栄養・材料へ一度だけ掛け、元のスナップショットを変えない',()=>{
  const source=entry(),before=structuredClone(source),summary=describeRegistration(source,data);
  assert.equal(summary.date,'2026-11-14');assert.equal(summary.mealLabel,'朝食');assert.equal(summary.statusLabel,'食べた');
  assert.deepEqual(summary.items[0],{name:'トースト',quantity:2,amount:2,unit:'枚',portionLabel:'食パン1枚分',
    nutrition:{kcal:400,protein:12,fat:8,carbs:60,fiber:4,salt:1.2}});
  assert.deepEqual(summary.ingredients,[
    {id:'bread',name:'食パン',amount:120,unit:'g',known:true},
    {id:'butter',name:'バター',amount:10,unit:'g',known:true},
  ]);
  assert.equal(summary.nutrition.values.kcal,400);assert.equal(summary.nutrition.complete.kcal,true);
  assert.equal(summary.ingredientsComplete,true);assert.deepEqual(source,before);
  summary.ingredients[0].amount=999;summary.items[0].nutrition.kcal=999;
  assert.deepEqual(source,before);
});

test('複数品の同じ食材をまとめ、保存済みの栄養と不明分を保持する',()=>{
  const source=entry(),second={...item(),id:'second',quantity:.5,name:'少量のパン',nutrition:{...nutrients(100),fat:null},
    ingredients:[{id:'bread',amount:20}],portion:{amount:2,unit:'個'}};
  source.items.push(second);source.status='planned';
  const changed={...data,recipes:[{id:'old-toast',name:'変更後',manualNutrition:nutrients(8000)}]};
  const summary=describeRegistration(source,changed);
  assert.equal(summary.items[0].name,'トースト');assert.equal(summary.items[1].amount,1);
  assert.equal(summary.items[1].nutrition.fat,null);
  assert.equal(summary.ingredients.find(part=>part.id==='bread').amount,130);
  assert.equal(summary.nutrition.values.kcal,450);assert.equal(summary.nutrition.values.fat,8);
  assert.equal(summary.nutrition.complete.fat,false);assert.equal(summary.nutrition.unknownItems,1);
  assert.equal(summary.statusLabel,'これからの予定');
});

test('基準量がgの料理でも、表示量と材料を二重に倍率換算しない',()=>{
  const source=entry();source.items[0].quantity=.5;source.items[0].portion={amount:150,unit:'g'};
  const summary=describeRegistration(source,data);
  assert.equal(summary.items[0].amount,75);assert.equal(summary.ingredients[0].amount,30);
  assert.equal(summary.nutrition.values.kcal,100);
});

test('現在のDBから消えた材料や未確認の内訳を補完せず、不明な単位を残す',()=>{
  const source=entry();source.items[0].ingredientsKnown=false;
  const summary=describeRegistration(source,{...data,ingredients:{bread:{name:'食パン'}}});
  assert.deepEqual(summary.ingredients,[
    {id:'bread',name:'食パン',amount:120,unit:null,known:false},
    {id:'butter',name:'butter（名称未登録）',amount:10,unit:null,known:false},
  ]);
  assert.equal(summary.ingredientsComplete,false);assert.equal(summary.nutrition.values.kcal,400);
  source.items[0].ingredients=[];
  source.items[0].nutrition=Object.fromEntries(Object.keys(nutrients()).map(key=>[key,null]));
  const unknown=describeRegistration(source,data);
  assert.deepEqual(unknown.ingredients,[]);assert.equal(unknown.ingredientsComplete,false);
  assert.equal(unknown.items[0].nutrition.kcal,null);assert.equal(unknown.nutrition.complete.kcal,false);
});

test('不正な登録先・分量・材料を説明するプレビューとして受け付けない',()=>{
  for(const change of [
    e=>{e.date='2026-02-30';},e=>{e.date='2101-01-01';},e=>{e.meal='unknown';},e=>{e.status='unknown';},
    e=>{e.items=[];},e=>{e.items[0].quantity=0;},e=>{e.items[0].quantity=NaN;},
    e=>{e.items[0].nutrition.kcal=Infinity;},e=>{e.items[0].ingredients.push({id:'bread',amount:1});},
  ]){const source=entry();change(source);assert.throws(()=>describeRegistration(source,data));}
  for(const invalid of [null,[],{},'entry'])assert.throws(()=>describeRegistration(invalid,data));
  let reads=0;const source=entry();Object.defineProperty(source,'date',{get(){reads++;return '2026-11-14';}});
  assert.throws(()=>describeRegistration(source,data));assert.equal(reads,0);
});
