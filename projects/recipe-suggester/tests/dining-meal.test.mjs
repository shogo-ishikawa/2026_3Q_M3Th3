import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {defaultJournal, parseJournal, validateJournal} from '../journal.js';
import {createDiningItem, createDiningEntry} from '../dining-meal.js';
import {createCatalogEntry} from '../record-actions.js';
import {sumNutrition, summariseEntries} from '../nutrition.js';
import {classifyNutritionBasis} from '../nutrition-basis.js';
import {buildRestaurantRecipe} from '../restaurant-menu.js';
import {shoppingForEntries} from '../shopping.js';
import {shoppingMenusFromEntries, buildShoppingChecklist} from '../shopping-workflow.js';
import {shoppingMenuStatuses} from '../shopping-status.js';

const data = {ingredients:INGREDIENTS, recipes:RECIPES, allergens:ALLERGENS};
const recipe = id => RECIPES.find(item => item.id === id);
const day = '2026-11-18';
const context = {date:day, meal:'lunch'};
const records = entries => ({...defaultJournal(day), entries});
const sameDay = {from:day, to:day, servings:4};
const salmon = () => createDiningItem({recipe:recipe('classic-grilled-salmon')},
  {amount:0.5, mode:'similar', actualName:'学食の焼き鮭', storeName:'学生食堂'}, data);
const store = () => buildRestaurantRecipe({id:'custom-restaurant-salmon', genericRecipeId:'classic-grilled-salmon',
  storeName:'駅前食堂', menuName:'鮭焼き', sizeName:'小', inclusion:'鮭とたれ', riceIncluded:false, sidesIncluded:false,
  basis:'per100g', portionAmount:250, sourceUrl:'https://example.com/nutrition', checkedDate:day,
  nutrition:{kcal:120, fat:0}, allergensKnown:true, allergens:['salmon']}, data);

test('外食一食を同じ調理済み献立の数量・栄養と照合して保存し、材料は買い物対象外にする', () => {
  const fish = salmon(), rice = createDiningItem({recipe:recipe('plain-rice')}, {amount:100}, data);
  const dining = createDiningEntry({...context, items:[fish,rice]}, data);
  const regular = [createCatalogEntry({...context,status:'eaten',recipeId:'classic-grilled-salmon',amount:0.5},data),
    createCatalogEntry({...context,status:'eaten',recipeId:'plain-rice',amount:100},data)];
  assert.deepEqual(sumNutrition(dining.items),sumNutrition(regular.flatMap(entry=>entry.items)));
  assert.deepEqual(dining.items.map(item=>item.recipeId),['classic-grilled-salmon','plain-rice']);
  assert.ok(fish.proteinSources.includes('fish'));
  assert.deepEqual(fish.diningMatch, {mode:'similar', referenceName:'鮭の塩焼き', actualName:'学食の焼き鮭', storeName:'学生食堂', referenceBasis:'ingredients'});
  assert.equal(classifyNutritionBasis(fish,data).label,'似た料理から概算');
  assert.equal(fish.allergensKnown,false);
  assert.equal(fish.ingredientsKnown,false);
  const planned={...dining, id:'family', status:'planned', items:dining.items.map((item,i)=>({...item,id:'planned-'+i}))};
  assert.deepEqual(summariseEntries([dining,planned],sameDay).values,sumNutrition(regular.flatMap(e=>e.items)).values);
  const menus=shoppingMenusFromEntries([dining,planned],data,sameDay);
  assert.equal(menus.length,2);
  const selections=menus.map(menu=>({...menu,ingredientIds:menu.item.ingredients.map(part=>part.id)}));
  assert.deepEqual(shoppingForEntries([dining,planned],data,sameDay).items,[]);
  assert.deepEqual(buildShoppingChecklist(selections,data).items,[]);
  assert.ok(shoppingMenuStatuses(menus,data).every(menu=>menu.status==='omitted'));
  const clean=validateJournal(records([dining]),data);
  assert.deepEqual(parseJournal(JSON.stringify(clean),data).entries,[dining]);
  fish.quantity=1;
  assert.equal(dining.items[0].quantity,0.5);
});

test('店舗表示を本人が照合した料理と、別の店に近い料理として使った場合を区別する', () => {
  const restaurant=store(), menuData={...data,recipes:[...RECIPES,restaurant]};
  const exact=createDiningItem({recipe:restaurant},{mode:'menu',amount:125},menuData);
  assert.equal(exact.recipeId,restaurant.id);
  assert.equal(exact.restaurant.genericRecipeId,'classic-grilled-salmon');
  assert.equal(exact.nutritionBasis,'official');
  assert.equal(exact.diningMatch.storeName,'駅前食堂');
  assert.ok(exact.proteinSources.includes('fish'));
  assert.equal(exact.proteinSources.length,new Set(exact.proteinSources).size);
  assert.deepEqual(exact.ingredients,[]);
  assert.deepEqual(sumNutrition([exact]).values.kcal,150);
  assert.equal(exact.nutrition.fiber,null);
  assert.equal(exact.nutrition.fat,0);
  const alias=createDiningItem({recipe:restaurant},{mode:'similar',amount:125,actualName:'本日の焼き魚',storeName:'別の食堂'},menuData);
  assert.equal(alias.diningMatch.referenceBasis,'official');
  assert.equal(alias.diningMatch.storeName,'別の食堂');
  assert.equal(alias.nutritionBasis,'estimate');
  assert.equal(alias.allergensKnown,false);
  const dayOne=createDiningEntry({...context,items:[exact,alias]},menuData);
  assert.deepEqual(validateJournal(records([dayOne]),data).entries,[dayOne]);
  const history=createDiningItem({item:alias},{amount:100,mode:'menu'},data);
  assert.equal(history.allergensKnown,false);
  assert.equal(history.diningMatch.mode,'similar');
  assert.equal(history.nutritionBasis,'estimate');
  const sameAgain=createDiningItem({item:alias},{amount:100,mode:'menu',storeName:'駅前食堂'},data);
  assert.equal(sameAgain.nutritionBasis,'official');
  assert.equal(sameAgain.allergensKnown,false);
  assert.deepEqual(history.nutrition,alias.nutrition);
});

test('履歴からの複写は元の名前と店を保ち、明示した空欄だけを消す。量の編集は一度だけ反映する', () => {
  const previous=salmon(), original=structuredClone(previous);
  const copy=createDiningItem({item:previous},{amount:0.25},data);
  assert.equal(copy.quantity,0.25);
  assert.equal(copy.name,previous.name);
  assert.notEqual(copy.id,previous.id);
  assert.deepEqual(copy.diningMatch,previous.diningMatch);
  assert.equal(sumNutrition([copy]).values.kcal,sumNutrition([previous]).values.kcal*0.5);
  const cleared=createDiningItem({item:previous},{amount:1,actualName:'',storeName:''},data);
  assert.equal(cleared.name,'鮭の塩焼き');
  assert.equal(cleared.diningMatch.storeName,'');
  assert.deepEqual(previous,original);
  const old={...structuredClone(previous),recipeId:null,nutritionBasis:'manual'};
  delete old.diningMatch;
  old.name='以前の店｜定食';
  assert.deepEqual(validateJournal(records([createDiningEntry({...context,items:[old]},data)]),data).entries[0].items[0],old);
});

test('不整合のある照合情報、重複する料理ID、上限を超えた量を受け付けない', () => {
  const fish=salmon();
  const meal=items=>createDiningEntry({...context,items},data);
  assert.throws(()=>meal([]));
  assert.throws(()=>meal([fish,fish]));
  for(const change of [{name:'別名'},{quantity:Infinity},{allergensKnown:true},{nutritionBasis:'official'},
    {diningMatch:{...fish.diningMatch,arbitrary:1}}, {diningMatch:{...fish.diningMatch,referenceBasis:'invalid'}}]){
    assert.throws(()=>meal([{...fish,...change}]));
  }
  for(const amount of [0,NaN,Infinity,1001,100001]){
    assert.throws(()=>createDiningItem({item:fish},{amount},data));
    assert.throws(()=>createDiningItem({recipe:recipe('classic-grilled-salmon')},{amount},data));
  }
});
