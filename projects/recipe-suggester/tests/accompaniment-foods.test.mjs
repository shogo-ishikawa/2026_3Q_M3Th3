import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {ACCOMPANIMENT_INGREDIENTS,ACCOMPANIMENT_RECIPES} from '../accompaniment-foods.js';
import {INGREDIENT_NUTRITION} from '../ingredient-nutrients.js';
import {eligibleRecipes} from '../planner.js';
import {recipePortion} from '../catalog.js';
import {dishClassification,dishSection,browseDishes} from '../dish-hierarchy.js';
import {createCatalogEntry} from '../record-actions.js';
import {recipeNutrition,itemNutrition,summariseEntries} from '../nutrition.js';
import {shoppingForEntries} from '../shopping.js';
import {defaultJournal,parseJournal} from '../journal.js';

const keys=['kcal','protein','fat','carbs','fiber','salt'];
const ownIds=new Set(ACCOMPANIMENT_RECIPES.map(recipe=>recipe.id));
const data={allergens:ALLERGENS,ingredients:Object.fromEntries(Object.entries({...INGREDIENTS,...ACCOMPANIMENT_INGREDIENTS}).map(([id,ingredient])=>[id,{...ingredient,...INGREDIENT_NUTRITION[id]}])),recipes:[...RECIPES.filter(recipe=>!ownIds.has(recipe.id)),...ACCOMPANIMENT_RECIPES]};
const get=slug=>ACCOMPANIMENT_RECIPES.find(recipe=>recipe.id===`acmp-${slug}`);
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const entry=(slug,amount=1,status='eaten')=>createCatalogEntry({recipeId:get(slug).id,date:'2026-11-13',meal:'dinner',status,amount},data);

test('ご飯のお供8品を副菜として追加し、卵・魚介・海藻から探せる',()=>{
  assert.equal(ACCOMPANIMENT_RECIPES.length,8);
  assert.equal(Object.keys(ACCOMPANIMENT_INGREDIENTS).length,6);
  assert.equal(new Set(data.recipes.map(recipe=>recipe.id)).size,data.recipes.length);
  assert.equal(new Set(data.recipes.map(recipe=>recipe.name)).size,data.recipes.length);
  assert.deepEqual(ACCOMPANIMENT_RECIPES.map(recipe=>recipe.id),['acmp-tuna-oil','acmp-tuna-water','acmp-egg-raw','acmp-onsen-egg','acmp-seasoned-nori','acmp-tarako','acmp-mentaiko','acmp-salmon-flakes']);
  for(const recipe of ACCOMPANIMENT_RECIPES){
    assert.equal(recipe.role,'side');assert.equal(recipe.family,'small-dish');assert.equal(dishSection(recipe),'side');
    assert.equal(dishClassification(recipe).category,recipe.displayCategory);
    assert.ok(browseDishes(data.recipes,{section:'side',category:recipe.displayCategory}).some(item=>item.id===recipe.id));
    assert.equal(recipe.staple,false);assert.equal(recipe.mealBase,false);
    assert.ok(!recipe.ingredients.some(part=>['rice','soy_sauce','dashi'].includes(part.id)),recipe.id);
    assert.equal(recipe.ingredients.length,1);assert.equal(recipe.steps.length,0);assert.equal(recipe.nature,'ready-to-eat');
  }
});

test('ツナの油漬けと水煮を別の成分表で計算し、油切り前の基準を保つ',()=>{
  assert.equal(get('tuna-oil').ingredients[0].id,'acmp_tuna_oil');
  assert.equal(get('tuna-water').ingredients[0].id,'tuna_canned');
  close(itemNutrition(entry('tuna-oil',70).items[0]).kcal,185.5);
  close(itemNutrition(entry('tuna-water',70).items[0]).kcal,49);
  close(itemNutrition(entry('tuna-oil',17.5).items[0]).kcal,46.375);
  close(itemNutrition(entry('tuna-water',17.5).items[0]).fat,0.1225);
  for(const slug of ['tuna-oil','tuna-water']){
    assert.match(get(slug).name,/液汁を含む/);assert.equal(recipePortion(get(slug),data).amount,35);
    assert.equal(recipePortion(get(slug),data).unit,'g');assert.match(get(slug).sourceNote,/切り後の量ではありません/);
  }
});

test('4新食材は公的食品番号の100g値を1gへ換算し、別の利用可能炭水化物列を使わない',()=>{
  const expected={acmp_tuna_oil:['10263',[265,17.7,21.7,0.1,0,0.9]],acmp_seasoned_nori:['09005',[303,40,3.5,41.8,25.2,4.3]],acmp_tarako:['10202',[131,24,4.7,0.4,0,4.6]],acmp_mentaiko:['10204',[121,21,3.3,3,0,5.6]]};
  for(const[id,[code,values]]of Object.entries(expected)){
    assert.ok(INGREDIENT_NUTRITION[id],id);assert.ok(INGREDIENT_NUTRITION[id].nutritionSource.includes(`食品番号${code}`));
    keys.forEach((key,index)=>close(INGREDIENT_NUTRITION[id].nutritionPerUnit[key],values[index]/100));
  }
  close(recipeNutrition(get('tarako'),data).salt,0.92);
  close(recipeNutrition(get('mentaiko'),data).salt,1.12);
  close(recipeNutrition(get('seasoned-nori'),data).fiber,0.504);
});

test('生卵は殻を除く1個で記録し、牛丼やご飯と組み合わせてもご飯を増やさない',()=>{
  assert.equal(get('egg-raw').ingredients[0].id,'egg');
  assert.deepEqual(itemNutrition(entry('egg-raw',2).items[0]),{kcal:142,protein:12.2,fat:10.2,carbs:0.4,fiber:0,salt:0.4});
  const bowl=createCatalogEntry({recipeId:'beef-rice-bowl',date:'2026-11-13',meal:'dinner',status:'eaten',amount:1},data);
  const egg=entry('egg-raw',1),combined={...bowl,items:[...bowl.items,...egg.items]};
  const summary=summariseEntries([combined],{from:'2026-11-13',to:'2026-11-13'});
  close(summary.values.kcal,itemNutrition(bowl.items[0]).kcal+71);
  const list=shoppingForEntries([{...combined,status:'planned'}],data,{from:'2026-11-13',to:'2026-11-13',servings:3,pantry:[]});
  close(list.items.find(part=>part.id==='egg').required,3);
  close(list.items.find(part=>part.id==='rice').required,bowl.items[0].ingredients.find(part=>part.id==='rice').amount*3);
  assert.match(get('egg-raw').sourceNote,/すき焼き.*二重計上/);
  assert.match(get('egg-raw').sourceNote,/生食用.*期限内.*ひび割れ/);
  assert.match(get('egg-raw').sourceNote,/食べる直前/);
  assert.match(get('egg-raw').sourceNote,/https:\/\/www\.fsc\.go\.jp/);
});

test('温泉卵と鮭フレークは完成品の公式表示を使い、不明の食物繊維を0にしない',()=>{
  const onsen=entry('onsen-egg',2).items[0],flakes=entry('salmon-flakes',20).items[0];
  assert.deepEqual(itemNutrition(onsen),{kcal:132,protein:12,fat:9,carbs:0.6,fiber:null,salt:0.4});
  close(itemNutrition(flakes).kcal,87*20/45);close(itemNutrition(flakes).protein,11.2*20/45);close(itemNutrition(flakes).salt,0.8);
  assert.equal(itemNutrition(flakes).fiber,null);
  for(const id of ['acmp_onsen_egg','acmp_salmon_flakes']){
    assert.ok(INGREDIENT_NUTRITION[id],id);assert.ok(Object.values(INGREDIENT_NUTRITION[id].nutritionPerUnit).every(value=>value===null),id);
  }
  const list=shoppingForEntries([{...entry('onsen-egg',2,'planned'),items:[onsen,flakes]}],data,{from:'2026-11-13',to:'2026-11-13',servings:3,pantry:[]});
  close(list.items.find(part=>part.id==='acmp_onsen_egg').required,6);
  close(list.items.find(part=>part.id==='acmp_salmon_flakes').required,60);
});

test('全原材料が未確認の商品例は記録できても自動提案せず、純粋な卵も卵アレルギー時は除外する',()=>{
  const normal=new Set(eligibleRecipes({allergens:[],excludedIngredients:[]},data,{role:'side'}).map(recipe=>recipe.id));
  const noEgg=new Set(eligibleRecipes({allergens:['egg'],excludedIngredients:[]},data,{role:'side'}).map(recipe=>recipe.id));
  for(const recipe of ACCOMPANIMENT_RECIPES){
    const raw=recipe.id==='acmp-egg-raw';assert.equal(recipe.allergensKnown,raw);assert.equal(recipe.ingredientsKnown,raw);
    assert.equal(normal.has(recipe.id),raw,recipe.id);assert.equal(noEgg.has(recipe.id),false,recipe.id);
    assert.doesNotThrow(()=>entry(recipe.id.slice(5),recipe.portion.amount));
  }
});

test('店舗名を一般名の見出しへ混ぜず、正確な参照商品・量・URLは出典に保持する',()=>{
  const store=/バロー|ニッスイ|ValorSelect|イセデリカ/;
  for(const recipe of ACCOMPANIMENT_RECIPES){
    assert.doesNotMatch([recipe.name,recipe.variantLabel,recipe.portion.label].join(' '),store);
    assert.match(recipe.sourceNote,/確認日2026-11-13/);assert.match(recipe.sourceNote,/https:\/\//);
  }
  assert.match(get('onsen-egg').sourceNote,/バロー ValorSelect.*6個入り.*1個・可食部標準47g/);
  assert.match(get('salmon-flakes').sourceNote,/ニッスイ.*45g.*10g/);
});

test('単品のgと個の基準、栄養、原材料確認をスナップショットとして保存・復元する',()=>{
  const state=defaultJournal('2026-11-13');state.entries=ACCOMPANIMENT_RECIPES.map(recipe=>entry(recipe.id.slice(5),recipe.portion.amount*1.5));
  const restored=parseJournal(JSON.stringify(state),data);assert.deepEqual(restored.entries,state.entries);
  for(const entry of restored.entries){
    assert.equal(entry.items.length,1);assert.equal(entry.items[0].role,'side');assert.equal(entry.items[0].steps.length,0);
    assert.ok(Object.values(itemNutrition(entry.items[0])).every(value=>value===null||Number.isFinite(value)&&value>=0));
  }
});
