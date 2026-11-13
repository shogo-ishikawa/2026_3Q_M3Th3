import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {SEAFOOD_INGREDIENTS,SEAFOOD_NUTRITION,SEAFOOD_RECIPES,SEAFOOD_SASHIMI_CHOICES} from '../seafood-foods.js';
import {FOOD_COMPOSERS,buildFoodSelection,defaultFoodSelection,eligibleFoodSelection,foodComposerFor} from '../food-composer.js';
import {NUTRIENT_KEYS,itemFromRecipe,itemNutrition,recipeNutrition} from '../nutrition.js';
import {recipePortion} from '../catalog.js';
import {dishClassification} from '../dish-hierarchy.js';
import {createCatalogEntry} from '../record-actions.js';
import {defaultJournal,parseJournal} from '../journal.js';
import {shoppingForEntries} from '../shopping.js';
import {eligibleRecipes} from '../planner.js';

const ids=new Set(SEAFOOD_RECIPES.map(recipe=>recipe.id));
const data={allergens:ALLERGENS,
  ingredients:{...INGREDIENTS,...Object.fromEntries(Object.entries(SEAFOOD_INGREDIENTS).map(([id,value])=>[id,{...value,...SEAFOOD_NUTRITION[id]}]))},
  recipes:[...RECIPES.filter(recipe=>!ids.has(recipe.id)),...SEAFOOD_RECIPES]};
const sashimi=FOOD_COMPOSERS.find(definition=>definition.kind==='sashimi');
const near=(actual,expected)=>assert.ok(typeof actual==='number'&&Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);
const grams=(recipe,id)=>recipe.ingredients.find(part=>part.id===id)?.amount;
const compose=components=>buildFoodSelection({id:'custom-seafood-audit',kind:'sashimi',components},data);
const date='2026-11-13';

test('刺身20種類でアジ・ホタテとマダコの既存ID・基準材料を再利用する',()=>{
  assert.equal(SEAFOOD_RECIPES.length,10);assert.equal(Object.keys(SEAFOOD_INGREDIENTS).length,10);
  assert.equal(sashimi.components.length,20);assert.equal(new Set(sashimi.components.map(part=>part.recipeId)).size,20);
  assert.equal(sashimi.components.find(part=>part.id==='octopus').label,'マダコ（ボイル）');
  for(const [choice,recipeId] of [['aji','classic-sashimi-aji'],['scallop','classic-sashimi-scallop'],['octopus','classic-sashimi-octopus']]){
    assert.equal(sashimi.components.filter(part=>part.recipeId===recipeId).length,1);
    assert.equal(sashimi.components.find(part=>part.id===choice).recipeId,recipeId);
  }
  const old=RECIPES.find(recipe=>recipe.id==='classic-sashimi-octopus');
  assert.equal(old.name,'ゆでだこの刺身');
  assert.deepEqual(old.ingredients,[{id:'octopus',amount:200},{id:'soy_sauce',amount:12},{id:'shiso',amount:2}]);
  assert.equal(new Set(data.recipes.map(recipe=>recipe.id)).size,data.recipes.length);
});

test('生・ボイル・酢締めと魚種を区別し、原料のgと100gの基準を一致させる',()=>{
  for(const recipe of SEAFOOD_RECIPES){
    const ingredient=data.ingredients[recipe.ingredients[0].id];
    assert.ok(ingredient);assert.equal(ingredient.unit,'g');assert.equal(ingredient.gramsPerUnit,1);
    assert.equal(recipe.servings,2);assert.equal(grams(recipe,recipe.ingredients[0].id),200);
    assert.equal(recipePortion(recipe,data).amount,100);assert.equal(recipePortion(recipe,data).unit,'g');
    assert.equal(recipe.nature,'ready-to-eat');assert.deepEqual(recipe.steps,[]);
    assert.deepEqual(dishClassification(recipe),{section:'main',category:'fish',secondaryCategories:[],method:'sashimi'});
    assert.equal(foodComposerFor(recipe.id).kind,'sashimi');
    assert.ok(Object.values(recipeNutrition(recipe,data)).every(value=>Number.isFinite(value)&&value>=0));
    if(recipe.id!=='seafood-sashimi-shimesaba')assert.match(ingredient.name,/生.*刺身用/);
  }
  assert.match(data.ingredients.seafood_mizudako.note,/マダコのボイルとは別/);
  assert.match(data.ingredients.seafood_shimesaba.name,/酢締め/);
  assert.match(data.ingredients.seafood_sanma.note,/皮付きサンマとは区別/);
});

test('文科省の魚種別の値を使い、イナダの代用と赤えびのTr・未収載だけを推定する',()=>{
  near(SEAFOOD_NUTRITION.seafood_mizudako.nutritionPerUnit.fat,.009);
  near(SEAFOOD_NUTRITION.seafood_hiramasa.nutritionPerUnit.protein,.226);
  near(SEAFOOD_NUTRITION.seafood_shimesaba.nutritionPerUnit.salt,.016);
  near(SEAFOOD_NUTRITION.seafood_sanma.nutritionPerUnit.fat,.25);
  for(const [id,profile] of Object.entries(SEAFOOD_NUTRITION)){
    assert.match(profile.nutritionSource,/https:\/\/fooddb\.mext\.go\.jp/);
    assert.deepEqual(Object.keys(profile.nutritionPerUnit),NUTRIENT_KEYS);
    if(id==='seafood_inada'){
      assert.deepEqual(profile.estimatedNutrients,NUTRIENT_KEYS);
      assert.ok(Object.values(profile.rawNutritionPerUnit).every(value=>value===null));
      assert.match(profile.nutritionSource,/食品番号10411/);assert.match(profile.nutritionSource,/同種の若魚/);
    }else if(id==='seafood_akaebi'){
      assert.deepEqual(profile.estimatedNutrients,['carbs','fiber']);
      assert.equal(profile.rawNutritionPerUnit.carbs,null);assert.equal(profile.rawNutritionPerUnit.fiber,null);
      near(profile.nutritionPerUnit.carbs,.0003);near(profile.nutritionPerUnit.fiber,0);
    }else{
      assert.deepEqual(profile.estimatedNutrients,[]);assert.deepEqual(profile.rawNutritionPerUnit,profile.nutritionPerUnit);
    }
  }
});

test('追加した全選択肢の切れ数・尾数をgへ換算し、1単位の重さを変更できる',()=>{
  for(const choice of SEAFOOD_SASHIMI_CHOICES){
    assert.equal(choice.unit,['amaebi','akaebi'].includes(choice.id)?'尾':'切れ');
    const defaultConfig=defaultFoodSelection('sashimi',{recipeId:choice.recipeId});
    assert.deepEqual(defaultConfig.components,[{id:choice.id,amount:choice.defaultAmount}]);
    const normal=compose([{id:choice.id,amount:2}]);
    near(grams(normal,`seafood_${choice.id}`),2*choice.gramsPerUnit);
    const adjusted=compose([{id:choice.id,amount:2,gramsPerUnit:7.5}]);
    near(grams(adjusted,`seafood_${choice.id}`),15);near(grams(adjusted,'soy_sauce'),.9);near(grams(adjusted,'shiso'),.15);
    assert.match(adjusted.name,new RegExp(`2${choice.unit}（約15g）`));
  }
});

test('組み合わせの栄養は可食部と別添え調味料の合計で、酢締めの塩分を含める',()=>{
  const mixed=compose([{id:'shimesaba',amount:2},{id:'akaebi',amount:2,gramsPerUnit:12},{id:'mizudako',amount:3}]);
  near(grams(mixed,'seafood_shimesaba'),30);near(grams(mixed,'seafood_akaebi'),24);near(grams(mixed,'seafood_mizudako'),15);
  near(grams(mixed,'soy_sauce'),4.14);near(grams(mixed,'shiso'),.69);
  for(const key of NUTRIENT_KEYS){
    const expected=mixed.ingredients.reduce((sum,part)=>sum+data.ingredients[part.id].nutritionPerUnit[key]*part.amount,0);
    near(mixed.manualNutrition[key],expected);
  }
  assert.ok(mixed.manualNutrition.salt>0.48+.192+.165);
});

test('刺身のえび・さばと別添えしょうゆの小麦・大豆を除外条件へ反映する',()=>{
  const safeIds=allergens=>new Set(eligibleRecipes({allergens},data).map(recipe=>recipe.id));
  for(const id of ['seafood-sashimi-amaebi','seafood-sashimi-akaebi'])assert.ok(!safeIds(['shrimp']).has(id));
  assert.ok(!safeIds(['mackerel']).has('seafood-sashimi-shimesaba'));
  assert.ok(safeIds(['shrimp','mackerel']).has('seafood-sashimi-hirame'));
  const withoutShrimp=eligibleFoodSelection('sashimi',{allergens:['shrimp']},data);
  assert.ok(withoutShrimp);assert.ok(!withoutShrimp.config.components.some(part=>['amaebi','akaebi'].includes(part.id)));
  const withoutMackerel=eligibleFoodSelection('sashimi',{allergens:['mackerel']},data);
  assert.ok(withoutMackerel);assert.ok(!withoutMackerel.config.components.some(part=>part.id==='shimesaba'));
  assert.equal(eligibleFoodSelection('sashimi',{allergens:['wheat']},data),null);
  const shrimp=itemFromRecipe(compose([{id:'amaebi',amount:2}]),data);
  for(const allergen of ['shrimp','soy','wheat'])assert.ok(shrimp.allergens.includes(allergen));
});

test('切れ数の確定後はgと栄養を保存し、再編集や保存復元で変わらない',()=>{
  const recipe=compose([{id:'hirame',amount:3,gramsPerUnit:9},{id:'amaebi',amount:2}]);
  const customData={...data,recipes:[...data.recipes,recipe]};
  const record=createCatalogEntry({recipeId:recipe.id,date,meal:'dinner',status:'planned',amount:0.5},customData);
  const state=defaultJournal(date);state.entries=[record];
  const saved=parseJournal(JSON.stringify(state),customData);
  assert.deepEqual(saved.entries,state.entries);
  near(saved.entries[0].items[0].ingredients.find(part=>part.id==='seafood_hirame').amount,27);
  const before=JSON.stringify(saved.entries);
  compose([{id:'hirame',amount:3,gramsPerUnit:20},{id:'amaebi',amount:4}]);
  assert.equal(JSON.stringify(saved.entries),before);
  near(itemNutrition(record.items[0]).kcal,recipe.manualNutrition.kcal*.5);
});

test('切れ数・尾数を可食部gにして人数・食べる量・手持ちを買い物へ一度だけ換算する',()=>{
  const recipe=compose([{id:'hirame',amount:3,gramsPerUnit:9},{id:'amaebi',amount:2},{id:'shimesaba',amount:2}]);
  const customData={...data,recipes:[...data.recipes,recipe]};
  const record=createCatalogEntry({recipeId:recipe.id,date,meal:'dinner',status:'planned',amount:0.5},customData);
  const list=shoppingForEntries([record],customData,{from:date,to:date,servings:4,pantry:[{id:'seafood_hirame',amount:14}]});
  const flounder=list.items.find(part=>part.id==='seafood_hirame');
  near(flounder.required,54);near(flounder.buy,40);assert.equal(flounder.unit,'g');
  near(list.items.find(part=>part.id==='seafood_amaebi').required,20);
  near(list.items.find(part=>part.id==='seafood_shimesaba').required,60);
  near(list.items.find(part=>part.id==='soy_sauce').required,8.04);
  assert.deepEqual(list.missingMenus,[]);
});
