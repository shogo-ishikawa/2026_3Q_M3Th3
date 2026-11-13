import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {defaultJournal,validateJournal,parseJournal,validateFrozenItems} from '../journal.js';
import {buildRecipeArrangement} from '../recipe-arrangement.js';
import {createMealSet,createRepeatedMeal} from '../meal-sets.js';
import {purchaseDefaults,derivePurchase} from '../purchase-conversion.js';
import {createBatch,takeBatch,batchBalance} from '../batch-cooking.js';
import {buildRestaurantRecipe} from '../restaurant-menu.js';
import {itemFromRecipe,itemNutrition,NUTRIENT_KEYS} from '../nutrition.js';
import {createCatalogEntry} from '../record-actions.js';
import {shoppingForEntries} from '../shopping.js';
const data={allergens:ALLERGENS,ingredients:INGREDIENTS,recipes:RECIPES};
const base=RECIPES.find(recipe=>recipe.id==='chicken-teriyaki');
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
function fixture(){
  const arranged=buildRecipeArrangement({id:'custom-integration-arranged',baseRecipe:base,name:'鶏むねのきのこ照り焼き',ingredientEdits:[{id:'chicken',replacementId:'chicken_breast',amount:150,unit:'g'},{id:'oil',amount:0}],additions:[{id:'shimeji',amount:40,unit:'g'}]},data);
  const expanded={...data,recipes:[...RECIPES,arranged]},restaurant=buildRestaurantRecipe({id:'custom-integration-restaurant',genericRecipeId:arranged.id,storeName:'統合確認用の店',menuName:'鶏むねの照り焼き',sizeName:'普通',inclusion:'主菜のみ。ご飯と付け合わせは別。',riceIncluded:false,sidesIncluded:false,basis:'per100g',portionAmount:240,sourceUrl:'https://example.com/official-menu',checkedDate:'2026-11-13',nutrition:{kcal:180,protein:20,fat:5,carbs:12,fiber:null,salt:1.2}},expanded);
  expanded.recipes.push(restaurant);
  const home=createCatalogEntry({recipeId:arranged.id,date:'2026-11-13',meal:'breakfast',status:'eaten',amount:1},expanded),out=createCatalogEntry({recipeId:restaurant.id,date:'2026-11-13',meal:'breakfast',status:'eaten',amount:120},expanded);
  const mealSet=createMealSet({name:'主菜の組み合わせ',entries:[home,out]},data),copy=createRepeatedMeal({items:mealSet.items,date:'2026-11-16',meal:'lunch',status:'planned',scale:0.5},data);
  const homeBatch=createBatch({id:'batch-integration-home',recipe:arranged,sourceQuantity:4,totalGrams:1000,preparedDate:'2026-11-13'},expanded),outBatch=createBatch({id:'batch-integration-out',recipe:restaurant,sourceQuantity:2,totalGrams:650,preparedDate:'2026-11-13'},expanded);
  const homeTake=takeBatch({batchId:homeBatch.id,grams:125,date:'2026-11-14',meal:'dinner',status:'eaten'},[homeBatch,outBatch],[]),outTake=takeBatch({batchId:outBatch.id,grams:100,date:'2026-11-15',meal:'lunch',status:'planned'},[homeBatch,outBatch],[homeTake]);
  const rice=createCatalogEntry({recipeId:'plain-rice',date:'2026-11-15',meal:'dinner',status:'planned',amount:150},data),state=defaultJournal('2026-11-13');
  state.customRecipes=[arranged,restaurant];state.entries=[home,out,copy,homeTake,outTake,rice];state.mealSets=[mealSet];state.batches=[homeBatch,outBatch];state.pantry=[{id:'rice',amount:70}];state.purchaseSettings=[{...purchaseDefaults('rice',data),packSize:100,packUnit:'袋'}];
  return {state,arranged,restaurant,homeBatch,outBatch,homeTake,outTake,mealSet};
}

test('5機能を同じ保存データで往復し、アレンジ・定番・作り置き・外食の凍結情報を保つ',()=>{
  const {state,arranged,restaurant,homeBatch,outBatch,homeTake,outTake,mealSet}=fixture(),before=structuredClone(state),clean=parseJournal(JSON.stringify(state),data);
  assert.deepEqual(clean,state);assert.deepEqual(state,before);
  assert.ok(!arranged.ingredients.some(part=>part.id==='chicken'||part.id==='oil'));assert.equal(arranged.ingredients.find(part=>part.id==='chicken_breast').amount,150);assert.equal(arranged.ingredients.find(part=>part.id==='shimeji').amount,40);
  assert.deepEqual(clean.mealSets[0].items[1].restaurant,restaurant.restaurant);assert.equal(clean.mealSets[0].items[1].quantity,0.5);assert.equal(clean.mealSets[0].items[1].nutrition.fiber,null);
  assert.deepEqual(clean.batches[1].item.restaurant,restaurant.restaurant);assert.deepEqual(clean.entries.find(entry=>entry.id===outTake.id).items[0].restaurant,restaurant.restaurant);
  for(const key of NUTRIENT_KEYS){near(itemNutrition(homeTake.items[0])[key],homeBatch.item.nutrition[key]*125/1000);if(outBatch.item.nutrition[key]===null)assert.equal(itemNutrition(outTake.items[0])[key],null);else near(itemNutrition(outTake.items[0])[key],outBatch.item.nutrition[key]*100/650);}
  assert.equal(batchBalance(clean.batches[0],clean.entries).remainingGrams,875);assert.equal(batchBalance(clean.batches[1],clean.entries).remainingGrams,550);
  assert.notEqual(clean.entries[2].items[0].id,mealSet.items[0].id);assert.equal(clean.entries[2].items[0].quantity,0.5);
});

test('買い物は作り置きを再購入せず、同じ状態の在庫を引いてから生米と包装へ換算する',()=>{
  const {state}=fixture(),clean=validateJournal(state,data),shopping=shoppingForEntries(clean.entries,data,{from:'2026-11-15',to:'2026-11-15',servings:2,pantry:clean.pantry});
  assert.equal(shopping.items.length,1);assert.deepEqual(shopping.missingMenus,[]);
  const rice=shopping.items[0];assert.equal(rice.id,'rice');assert.equal(rice.required,300);assert.equal(rice.stock,70);assert.equal(rice.buy,230);
  const purchase=derivePurchase(rice,clean.purchaseSettings,data);near(purchase.amount,100);assert.equal(purchase.packCount,1);assert.equal(purchase.packedAmount,100);assert.equal(purchase.unit,'g');
  assert.deepEqual(state.purchaseSettings,clean.purchaseSettings);assert.equal(clean.entries.find(entry=>entry.items.some(item=>item.batchId)).items[0].portion.unit,'g');
});

test('元のマイレシピや一般メニューのリンク先を削除しても、外食・セット・取り分けの履歴を残す',()=>{
  const {state,restaurant}=fixture(),frozen=structuredClone({entries:state.entries,sets:state.mealSets,batches:state.batches});
  state.customRecipes=state.customRecipes.filter(recipe=>recipe.id===restaurant.id);
  const clean=validateJournal(state,data);assert.equal(clean.customRecipes.length,1);assert.equal(clean.customRecipes[0].restaurant.genericRecipeId,'custom-integration-arranged');
  assert.deepEqual(clean.entries,frozen.entries);assert.deepEqual(clean.mealSets,frozen.sets);assert.deepEqual(clean.batches,frozen.batches);
  state.customRecipes=[];const deleted=validateJournal(state,data);assert.deepEqual(deleted.entries,frozen.entries);assert.deepEqual(deleted.batches,frozen.batches);
});

test('旧v3に新機能の項目がなくても履歴を保持し、明示的nullや未知項目は受け付けない',()=>{
  const old=defaultJournal('2026-11-13');old.entries=[createCatalogEntry({recipeId:'plain-rice',date:'2026-11-13',meal:'dinner',status:'eaten',amount:150},data)];delete old.mealSets;delete old.purchaseSettings;delete old.batches;
  const clean=validateJournal(old,data);assert.deepEqual(clean.entries,old.entries);assert.deepEqual(clean.mealSets,[]);assert.deepEqual(clean.purchaseSettings,[]);assert.deepEqual(clean.batches,[]);
  for(const key of ['mealSets','purchaseSettings','batches'])assert.throws(()=>validateJournal({...old,[key]:null},data));
  assert.throws(()=>validateJournal({...old,mealSets:[],unexpected:[]},data));
});

test('取り分けの参照切れ・過大な量・不正な基準量と公式資料情報を読み込み前に拒否する',()=>{
  const {state,homeTake}=fixture();
  for(const alter of [
    source=>{source.batches=source.batches.filter(batch=>batch.id!=='batch-integration-home');},
    source=>{source.entries.find(entry=>entry.id===homeTake.id).items[0].quantity=11;},
    source=>{source.entries.find(entry=>entry.id===homeTake.id).items[0].portion.amount=200;},
    source=>{source.batches[0].item.batchId=source.batches[0].id;},
    source=>{source.entries[1].items[0].restaurant.sourceUrl='javascript:alert(1)';},
    source=>{source.mealSets[0].items[1].restaurant.basisUnit='ml';},
    source=>{source.batches[1].item.restaurant.checkedDate='2026-02-30';},
  ]){const invalid=structuredClone(state);alter(invalid);assert.throws(()=>validateJournal(invalid,data));}
  const overflow=structuredClone(state);overflow.entries[2].items[0].quantity=1001;assert.throws(()=>validateJournal(overflow,data));
  const custom=structuredClone(state);custom.customRecipes[0].batchId='batch-integration-home';assert.throws(()=>validateJournal(custom,data));
});

test('共有スナップショット検証は外食の不明値を残し、アクセサーや未知の追加属性を拒否する',()=>{
  const {state}=fixture(),item=state.entries[1].items[0],copy=validateFrozenItems([item],data)[0];assert.deepEqual(copy,item);copy.restaurant.storeName='変更';assert.notEqual(item.restaurant.storeName,'変更');
  let invoked=false;const getter=structuredClone(item);Object.defineProperty(getter.restaurant,'basisAmount',{enumerable:true,get(){invoked=true;return 100;}});assert.throws(()=>validateFrozenItems([getter],data));assert.equal(invoked,false);
  assert.throws(()=>validateFrozenItems([{...item,externalNutrition:true}],data));
});
