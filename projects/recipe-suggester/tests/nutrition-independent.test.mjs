import test from 'node:test';
import assert from 'node:assert/strict';
import {recipeNutrition, itemFromRecipe, itemNutrition, sumNutrition, summariseEntries} from '../nutrition.js';

// Deliberately tiny food table: expected results below are calculated by hand.
const nutrient = (kcal, protein, fat, carbs, fiber, salt) => ({kcal, protein, fat, carbs, fiber, salt});
const complete = nutrient(2, 0.1, 0.02, 0.4, 0.03, 0.001);
const data = {
  ingredients: {
    grain: {name:'穀類', unit:'g', groups:['staple'], proteinSources:[], allergens:[], nutritionPerUnit:complete},
    milk: {name:'牛乳', unit:'ml', groups:['dairy'], proteinSources:[], allergens:['milk'], nutritionPerUnit:nutrient(0.5, 0.04, 0.02, 0.05, 0, 0.001)},
    egg: {name:'卵', unit:'個', groups:['protein'], proteinSources:['egg'], allergens:['egg'], nutritionPerUnit:nutrient(75, 6, 5, 0.5, 0, 0.15)},
    unknown: {name:'分量のみ判明', unit:'g', groups:[], proteinSources:[], allergens:[], nutritionPerUnit:nutrient(1, null, 0, 0.2, null, null)},
  },
  recipes: [],
  allergens: [{id:'milk'}, {id:'egg'}],
};
const recipe = {id:'test-bowl', name:'計算確認用', role:'main', servings:2, ingredients:[{id:'grain',amount:100},{id:'milk',amount:200},{id:'egg',amount:2}], steps:['混ぜる。']};
const knownItem = () => itemFromRecipe(recipe, data);
const entry = (id,date,meal,status,items=[knownItem()]) => ({id,date,meal,status,note:'',items});
function close(actual, expected) {
  for (const [key, value] of Object.entries(expected)) assert.ok(Math.abs(actual[key] - value) < 1e-10, `${key}: expected ${value}, got ${actual[key]}`);
}

test('g・ml・個の単位を変換せず人数で割った1人分の栄養を計算する', () => {
  // Total recipe: 450 kcal, protein 30g, fat16g, carbs51g, fiber3g, salt0.6g.
  close(recipeNutrition(recipe,data), nutrient(225,15,8,25.5,1.5,0.3));
  const item = itemFromRecipe(recipe,data,1.5);
  close(itemNutrition(item), nutrient(337.5,22.5,12,38.25,2.25,0.45));
  assert.deepEqual(item.ingredients, [{id:'grain',amount:50},{id:'milk',amount:100},{id:'egg',amount:1}]);
});

test('人数の設定や外部DBの変更で過去の食事スナップショットを書き換えない', () => {
  const copy = structuredClone(data), original = structuredClone(recipe);
  const snapshot = itemFromRecipe(original, copy, 2);
  copy.ingredients.grain.nutritionPerUnit.kcal = 999;
  copy.ingredients.egg.allergens.push('milk');
  original.ingredients[0].amount = 9000;
  original.steps[0] = '変更';
  original.servings = 8;
  close(itemNutrition(snapshot), nutrient(450,30,16,51,3,0.6));
  assert.deepEqual(snapshot.ingredients[0], {id:'grain',amount:50});
  assert.deepEqual(snapshot.steps, ['混ぜる。']);
  assert.deepEqual(snapshot.allergens.sort(), ['egg','milk']);
});

test('一部の栄養が不明でも既知の数値を保持し不明を0にしない', () => {
  const partial = {id:'partial',name:'一部不明',role:'side',servings:2,ingredients:[{id:'grain',amount:100},{id:'unknown',amount:50}],steps:[]};
  const nutrition = recipeNutrition(partial,data);
  assert.equal(nutrition.kcal,125);
  assert.equal(nutrition.fat,1);
  assert.equal(nutrition.carbs,25);
  assert.equal(nutrition.protein,null);
  assert.equal(nutrition.fiber,null);
  assert.equal(nutrition.salt,null);
  const result=sumNutrition([knownItem(),itemFromRecipe(partial,data,2)]);
  close(result.values,nutrient(475,15,10,75.5,1.5,0.3));
  assert.deepEqual(result.complete,{kcal:true,protein:false,fat:true,carbs:true,fiber:false,salt:false});
  assert.equal(result.unknownItems,1);
});

test('手入力の未登録栄養と実測0を区別し手入力の値は1人分として扱う', () => {
  const custom = {id:'custom-zero',name:'手入力',role:'drink',servings:1,ingredients:[],steps:[],custom:true,allergensKnown:false,ingredientsKnown:false,manualNutrition:nutrient(0,null,0,null,null,0)};
  const snapshot = itemFromRecipe(custom,data,2);
  assert.deepEqual(itemNutrition(snapshot),nutrient(0,null,0,null,null,0));
  assert.equal(snapshot.allergensKnown,false);
  assert.equal(snapshot.ingredientsKnown,false);
  const result=sumNutrition([snapshot]);
  assert.equal(result.values.kcal,0);
  assert.equal(result.complete.kcal,true);
  assert.equal(result.complete.protein,false);
  assert.equal(result.unknownItems,1);
});

test('原材料をたどったアレルゲンと手動登録アレルゲンをスナップショットに残す', () => {
  const local=structuredClone(data);
  local.ingredients.wheat={name:'小麦',unit:'g',allergens:['wheat'],nutritionPerUnit:complete};
  local.ingredients.flour={name:'小麦粉',unit:'g',allergens:[],derivedFrom:['wheat'],nutritionPerUnit:complete};
  local.ingredients.dough={name:'生地',unit:'g',allergens:[],derivedFrom:['flour'],nutritionPerUnit:complete};
  const custom={id:'custom-bread',name:'手作りパン',role:'staple',servings:1,ingredients:[{id:'dough',amount:100}],steps:[],custom:true,allergensKnown:true,ingredientsKnown:true,allergens:['egg']};
  const snapshot=itemFromRecipe(custom,local);
  assert.deepEqual(snapshot.allergens.sort(),['egg','wheat']);
});

test('派生元の循環や不明な材料を確認済みの食事として記録しない',()=>{
  const local=structuredClone(data);
  local.ingredients.grain.derivedFrom=['milk'];
  local.ingredients.milk.derivedFrom=['grain'];
  assert.throws(()=>itemFromRecipe(recipe,local),/循環/);
  local.ingredients.grain.derivedFrom=['not-in-table'];
  assert.throws(()=>itemFromRecipe(recipe,local),/材料/);
  const broken={...recipe,ingredients:[{id:'not-in-table',amount:100}]};
  assert.throws(()=>itemFromRecipe(broken,data),/材料/);
  assert.throws(()=>recipeNutrition(broken,data),/材料/);
});

test('摂取集計は期間両端を含め食べた食事だけを数え間食も含める', () => {
  const entries = [
    entry('before','2026-11-09','dinner','eaten'),
    entry('breakfast','2026-11-10','breakfast','eaten'),
    entry('snack-a','2026-11-10','snack','eaten'),
    entry('snack-b','2026-11-10','snack','eaten'),
    entry('dinner','2026-11-11','dinner','eaten'),
    entry('planned','2026-11-11','lunch','planned'),
    entry('after','2026-11-12','breakfast','eaten'),
  ];
  const result=summariseEntries(entries,{from:'2026-11-10',to:'2026-11-11',status:'eaten'});
  close(result.values,nutrient(900,60,32,102,6,1.2));
  assert.equal(result.entryCount,4);
  assert.equal(result.recordedDays,2);
  assert.equal(result.recordedMeals,3);
  const planned=summariseEntries(entries,{from:'2026-11-10',to:'2026-11-11',status:'planned'});
  assert.equal(planned.values.kcal,225);
  assert.equal(planned.entryCount,1);
});

test('無効な量と期間を拒否し呼び出し元の値を変更しない', () => {
  const snapshot=knownItem(), before=structuredClone(snapshot);
  sumNutrition([snapshot]);
  assert.deepEqual(snapshot,before);
  for(const quantity of [0,-1,NaN,Infinity,'1']) assert.throws(()=>itemFromRecipe(recipe,data,quantity));
  assert.throws(()=>itemNutrition({...snapshot,quantity:0}));
  assert.throws(()=>summariseEntries([],{from:'2026-02-30',to:'2026-03-01'}));
  assert.throws(()=>summariseEntries([],{from:'2026-11-11',to:'2026-11-10'}));
});
