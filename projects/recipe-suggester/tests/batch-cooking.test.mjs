import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {defaultJournal,validateJournal} from '../journal.js';
import {itemNutrition,NUTRIENT_KEYS,recipeNutrition} from '../nutrition.js';
import {createBatch,validateBatches,batchBalance,takeBatch,assertBatchUsage} from '../batch-cooking.js';
import {shoppingForEntries} from '../shopping.js';
import {buildRestaurantRecipe} from '../restaurant-menu.js';

const data={ingredients:INGREDIENTS,recipes:RECIPES,allergens:ALLERGENS};
const recipe=RECIPES.find(candidate=>candidate.id==='chicken-teriyaki');
const create=(extra={})=>createBatch({id:'batch-test',recipe,sourceQuantity:4,totalGrams:1200,preparedDate:'2026-11-13',...extra},data);
const take=(batch,grams,extra={},entries=[])=>takeBatch({batchId:batch.id,grams,date:'2026-11-14',meal:'lunch',status:'eaten',...extra},[batch],entries);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function validateItem(item){const state=defaultJournal('2026-11-13');state.entries=[{id:'test-validation',date:'2026-11-13',meal:'dinner',status:'eaten',note:'',items:[item]}];return validateJournal(state,data).entries[0].items[0];}

test('完成重量を基準に全体の栄養と材料を凍結し、元レシピを書き換えない',()=>{
  const before=JSON.stringify(recipe),source=recipeNutrition(recipe,data),batch=create();
  assert.equal(batch.item.quantity,1);assert.equal(batch.item.portion.amount,1200);
  for(const key of NUTRIENT_KEYS)near(batch.item.nutrition[key],source[key]*4);
  near(batch.item.ingredients.find(part=>part.id==='chicken').amount,recipe.ingredients.find(part=>part.id==='chicken').amount/recipe.servings*4);
  assert.equal(JSON.stringify(recipe),before);
  const stored=validateBatches([batch],data,{validateItem})[0];
  assert.deepEqual(stored,batch);stored.item.nutrition.kcal=0;assert.ok(batch.item.nutrition.kcal>0);
});

test('1200gの料理から150gを取り分けると全体の8分の1の栄養になる',()=>{
  const batch=create(),entry=take(batch,150),item=entry.items[0],nutrition=itemNutrition(item);
  assert.equal(item.batchId,batch.id);assert.deepEqual(item.portion,{amount:100,unit:'g',label:'完成した作り置き100g'});assert.equal(item.quantity,1.5);
  for(const key of NUTRIENT_KEYS)near(nutrition[key],batch.item.nutrition[key]/8);
  const second=take(batch,80);assert.notEqual(entry.id,second.id);assert.notEqual(item.id,second.items[0].id);
  const balance=batchBalance(batch,[entry,second]);assert.equal(balance.eatenGrams,230);assert.equal(balance.remainingGrams,970);
});

test('予定を予約し、実績への切り替えで二重消費せず、削除や減量で残りが戻る',()=>{
  const batch=create(),eaten=take(batch,300),planned=take(batch,500,{status:'planned'},[eaten]);
  assert.deepEqual(batchBalance(batch,[eaten,planned]),{eatenGrams:300,plannedGrams:500,reservedGrams:800,remainingGrams:400});
  planned.status='eaten';assert.equal(batchBalance(batch,[eaten,planned]).remainingGrams,400);
  planned.items[0].quantity=2;assert.equal(batchBalance(batch,[eaten,planned]).remainingGrams,700);
  assert.equal(batchBalance(batch,[eaten]).remainingGrams,900);
  assert.equal(batchBalance(batch,[eaten,planned],{excludeEntryId:planned.id}).remainingGrams,900);
});

test('完成重量を超える予約や調理日より前の記録、不正な基準量を拒否する',()=>{
  const batch=create(),entry=take(batch,1000);
  assert.throws(()=>take(batch,201,{},[entry]),/取り分け可能/);
  assert.throws(()=>take(batch,20,{date:'2026-11-12'}),/日付/);
  entry.items[0].quantity=13;assert.throws(()=>assertBatchUsage([batch],[entry]),/完成重量/);
  entry.items[0].quantity=1;entry.items[0].portion.amount=200;assert.throws(()=>assertBatchUsage([batch],[entry]),/100g/);
  entry.items[0].portion.amount=100;entry.items[0].batchId='batch-deleted';assert.throws(()=>assertBatchUsage([batch],[entry]),/見つかりません/);
});

test('終了後は新たに取り分けず、保存済みの参照と栄養を残す',()=>{
  const batch=create(),entry=take(batch,100);batch.archived=true;
  assert.throws(()=>take(batch,100),/終了/);assert.equal(assertBatchUsage([batch],[entry]),true);
  assert.equal(batchBalance(batch,[entry]).remainingGrams,1100);
  assert.throws(()=>assertBatchUsage([],[entry]),/削除せず終了/);
});

test('不明な栄養は不明のまま、別レシピへの変更後も調理時の栄養を維持する',()=>{
  const manual={...recipe,ingredients:recipe.ingredients.map(part=>({...part})),id:'custom-batch-test',custom:true,manualNutrition:{kcal:100,protein:10,fat:4,carbs:8,fiber:null,salt:1},allergensKnown:true,ingredientsKnown:true};
  const batch=create({recipe:manual}),entry=take(batch,300);
  manual.manualNutrition.kcal=1000;manual.ingredients[0]={...manual.ingredients[0],amount:1};
  near(itemNutrition(entry.items[0]).kcal,100);assert.equal(itemNutrition(entry.items[0]).fiber,null);
  assert.equal(batch.item.nutrition.kcal,400);assert.equal(batch.item.nutrition.fiber,null);
});

test('保存形式は未知項目・重複・不一致重量・数量を拒否する',()=>{
  const batch=create();
  for(const source of [[{...batch,extra:true}],[batch,batch],[{...batch,totalGrams:0}],[{...batch,sourceQuantity:-1}],[{...batch,preparedDate:'2026-02-30'}],[{...batch,item:{...batch.item,quantity:2}}],[{...batch,item:{...batch.item,portion:{amount:100,unit:'g'}}}]])assert.throws(()=>validateBatches(source,data,{validateItem}));
  for(const totalGrams of [0,-1,NaN,Infinity,100001,'1200'])assert.throws(()=>create({totalGrams}));
  assert.throws(()=>validateBatches([batch],data),/検証/);
});

test('作り置きと取り分けをJSON保存し、予定の材料を買い物へ二重に足さない',()=>{
  const batch=create(),entry=take(batch,200,{status:'planned'}),state=defaultJournal('2026-11-13');
  state.batches=[batch];state.entries=[entry];
  const restored=validateJournal(JSON.parse(JSON.stringify(state)),data);
  assert.deepEqual(restored.batches,[batch]);assert.deepEqual(restored.entries,[entry]);assert.equal(batchBalance(restored.batches[0],restored.entries).remainingGrams,1000);
  const shopping=shoppingForEntries(restored.entries,data,{from:'2026-11-13',to:'2026-11-14',servings:2});
  assert.deepEqual(shopping.items,[]);assert.deepEqual(shopping.missingMenus,[]);
  const tooMuch=structuredClone(restored);tooMuch.entries[0].items[0].quantity=13;assert.throws(()=>validateJournal(tooMuch,data),/完成重量/);
});

test('取り分け元と異なる栄養・材料・確認情報を付けたJSONを拒否する',()=>{
  const batch=create(),entry=take(batch,100,{status:'planned'}),state=defaultJournal('2026-11-13');state.batches=[batch];state.entries=[entry];
  for(const mutate of [
    item=>{item.nutrition.kcal=9999;},
    item=>{item.nutrition.protein=null;},
    item=>{item.ingredients[0].amount=9999;},
    item=>{item.ingredients.pop();},
    item=>{item.ingredients.push({id:'shimeji',amount:1});},
    item=>{item.allergensKnown=!item.allergensKnown;},
    item=>{item.role='drink';},
    item=>{item.name='別の料理';},
    item=>{item.allergens=[];},
  ]){
    const altered=structuredClone(state);mutate(altered.entries[0].items[0]);assert.throws(()=>validateJournal(altered,data),/作り置きの取り分け/);
  }
  const rounded=structuredClone(state);rounded.entries[0].items[0].nutrition.kcal+=1e-10;rounded.entries[0].items[0].ingredients[0].amount+=1e-10;
  assert.doesNotThrow(()=>validateJournal(rounded,data));
  const reordered=structuredClone(state);reordered.entries[0].items[0].ingredients.reverse();reordered.entries[0].items[0].allergens.reverse();
  assert.doesNotThrow(()=>validateJournal(reordered,data));
});

test('店別メニューを取り分けても調理時の店・サイズ・出典情報を変更しない',()=>{
  const restaurantRecipe=buildRestaurantRecipe({genericRecipeId:recipe.id,storeName:'確認用店舗',sizeName:'通常',menuName:'照り焼き',inclusion:'主菜のみ',riceIncluded:false,sidesIncluded:false,basis:'portion',portionAmount:1,portionUnit:'皿',sourceUrl:'https://example.jp/menu',checkedDate:'2026-11-13',nutrition:{kcal:400,protein:30,fat:20,carbs:20,fiber:null,salt:2}},data);
  const batch=create({recipe:restaurantRecipe}),entry=take(batch,100),state=defaultJournal('2026-11-13');state.batches=[batch];state.entries=[entry];
  assert.deepEqual(validateJournal(state,data).entries[0].items[0].restaurant,batch.item.restaurant);
  const altered=structuredClone(state);altered.entries[0].items[0].restaurant.storeName='別店舗';assert.throws(()=>validateJournal(altered,data),/調理時/);
  const alteredUnknown=structuredClone(state);alteredUnknown.entries[0].items[0].nutrition.fiber=0;assert.throws(()=>validateJournal(alteredUnknown,data),/100g/);
});
