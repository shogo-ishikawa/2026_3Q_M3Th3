import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {defaultJournal,parseJournal,validateJournal,writeJournal,JOURNAL_KEY} from '../journal.js';
import {createCatalogEntry} from '../record-actions.js';
import {createFavourite,recentFoods} from '../favourites.js';
import {createRepeatedMeal} from '../meal-sets.js';
import {createBatch,takeBatch,batchBalance} from '../batch-cooking.js';
import {classifyNutritionBasis} from '../nutrition-basis.js';
import {itemNutrition} from '../nutrition.js';

const data={allergens:ALLERGENS,ingredients:INGREDIENTS,recipes:RECIPES};
const day='2026-11-13';
const rice=(amount=120)=>createCatalogEntry({recipeId:'plain-rice',amount,date:day,meal:'lunch',status:'eaten'},data);
const roundtrip=state=>parseJournal(JSON.stringify(state),data);

test('お気に入りの根拠・未入力成分・最後の量をJSONとブラウザー保存で保持する',()=>{
  const entry=rice(180);entry.items[0].nutrition.fat=null;
  const state=defaultJournal(day);state.entries=[entry];state.favourites=[createFavourite(entry.items[0],data,{name:'いつもの量'} )];
  const before=structuredClone(state),restored=roundtrip(state);
  assert.deepEqual(restored.entries,before.entries);assert.deepEqual(restored.favourites,before.favourites);
  assert.equal(restored.favourites[0].item.nutritionBasis,'ingredients');
  assert.equal(restored.favourites[0].item.nutrition.fat,null);
  assert.equal(restored.favourites[0].item.quantity,1.2);
  assert.equal(recentFoods(restored.entries,{date:day})[0].item.quantity,1.2);
  const stored=new Map();assert.equal(writeJournal({setItem:(key,value)=>stored.set(key,value)},restored,data),true);
  assert.deepEqual(parseJournal(stored.get(JOURNAL_KEY),data),restored);
  const copy=createRepeatedMeal({items:[restored.favourites[0].item],date:'2026-11-14',meal:'dinner',status:'planned'},data);
  assert.notEqual(copy.items[0].id,restored.favourites[0].item.id);
  assert.equal(copy.items[0].nutritionBasis,'ingredients');assert.equal(itemNutrition(copy.items[0]).fat,null);
});

test('旧v3に根拠やお気に入りがなくても栄養を再推定せず、欠損は欠損のまま読み込む',()=>{
  const entry=rice(90),item=entry.items[0];delete item.nutritionBasis;
  item.nutrition={kcal:203,protein:null,fat:null,carbs:44,fiber:null,salt:null};
  const state=defaultJournal(day);state.entries=[entry];delete state.favourites;
  const changedData={...data,ingredients:{...INGREDIENTS,rice:{...INGREDIENTS.rice,nutritionPerUnit:{kcal:999,protein:999,fat:999,carbs:999,fiber:999,salt:999}}}};
  const restored=parseJournal(JSON.stringify(state),changedData);
  assert.deepEqual(restored.entries,[entry]);assert.deepEqual(restored.favourites,[]);
  assert.equal(Object.hasOwn(restored.entries[0].items[0],'nutritionBasis'),false);
  assert.equal(classifyNutritionBasis(restored.entries[0].items[0],changedData).kind,'unknown');
  assert.equal(itemNutrition(restored.entries[0].items[0]).fat,null);
  const saved=createFavourite(restored.entries[0].items[0],changedData);
  assert.equal(Object.hasOwn(saved.item,'nutritionBasis'),false);
  assert.deepEqual(saved.item.nutrition,item.nutrition);
});

test('お気に入りの元レシピと材料がDBからなくても保存した構成と根拠を保持する',()=>{
  const item=rice().items[0];item.recipeId='custom-removed';item.ingredients=[{id:'historic-rice',amount:150}];item.nutritionBasis='manual';item.nutrition.salt=null;
  const state=defaultJournal(day);state.favourites=[createFavourite(item,data)];
  const restored=parseJournal(JSON.stringify(state),data);
  assert.deepEqual(restored.favourites,state.favourites);
  assert.equal(restored.favourites[0].item.recipeId,'custom-removed');
  assert.equal(restored.favourites[0].item.nutritionBasis,'manual');
  const before=JSON.stringify(restored);
  const invalid=structuredClone(restored);invalid.favourites[0].item.nutritionBasis='made-up';
  assert.throws(()=>validateJournal(invalid,data),/根拠/);
  assert.equal(JSON.stringify(restored),before);
  assert.throws(()=>validateJournal({...restored,favourites:null},data),/お気に入り/);
});

test('作り置きの根拠を取り分けにも保存し、根拠の違う取り分けやお気に入りへの迂回を拒否する',()=>{
  const recipe=RECIPES.find(value=>value.id==='chicken-teriyaki');
  const batch=createBatch({id:'batch-integration',recipe,sourceQuantity:4,totalGrams:1200,preparedDate:day},data);
  const entry=takeBatch({batchId:batch.id,grams:150,date:day,meal:'dinner',status:'eaten'},[batch],[]);
  const state=defaultJournal(day);state.batches=[batch];state.entries=[entry];
  const restored=roundtrip(state);
  assert.equal(restored.batches[0].item.nutritionBasis,'ingredients');
  assert.equal(restored.entries[0].items[0].nutritionBasis,'ingredients');
  assert.deepEqual(restored.batches,[batch]);assert.deepEqual(restored.entries,[entry]);
  assert.equal(batchBalance(restored.batches[0],restored.entries).remainingGrams,1050);
  const mismatch=structuredClone(restored);mismatch.entries[0].items[0].nutritionBasis='manual';
  assert.throws(()=>validateJournal(mismatch,data),/調理時/);
  assert.throws(()=>createFavourite(restored.entries[0].items[0],data),/残量画面/);
  assert.deepEqual(recentFoods(restored.entries,{date:day}),[]);
  const legacy=structuredClone(restored);delete legacy.batches[0].item.nutritionBasis;delete legacy.entries[0].items[0].nutritionBasis;
  const legacyRestored=roundtrip(legacy);
  assert.deepEqual(legacyRestored.entries,legacy.entries);assert.deepEqual(legacyRestored.batches,legacy.batches);
  assert.equal(classifyNutritionBasis(legacyRestored.entries[0].items[0],data).kind,'unknown');
});
