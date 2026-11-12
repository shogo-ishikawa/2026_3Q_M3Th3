import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {CLASSIC_SIDE_INGREDIENTS,CLASSIC_SIDE_RECIPES} from '../classics-sides.js';
import {describeRecipe,eligibleRecipes} from '../planner.js';
import {itemFromRecipe} from '../nutrition.js';
import {shoppingForEntries} from '../shopping.js';

const ownIds=new Set(CLASSIC_SIDE_RECIPES.map(recipe=>recipe.id));
const data={allergens:ALLERGENS,ingredients:{...INGREDIENTS,...CLASSIC_SIDE_INGREDIENTS},recipes:[...RECIPES.filter(recipe=>!ownIds.has(recipe.id)),...CLASSIC_SIDE_RECIPES]};
const get=slug=>CLASSIC_SIDE_RECIPES.find(recipe=>recipe.id===`classic-side-${slug}`);

test('食堂の小鉢40品と変化を付けた副菜10品を重複なく追加する',()=>{
  assert.equal(CLASSIC_SIDE_RECIPES.length,50);
  assert.equal(CLASSIC_SIDE_RECIPES.filter(recipe=>recipe.family==='small-dish').length,40);
  assert.equal(CLASSIC_SIDE_RECIPES.filter(recipe=>recipe.family==='side').length,10);
  assert.equal(new Set(data.recipes.map(recipe=>recipe.id)).size,data.recipes.length);
  assert.equal(new Set(data.recipes.map(recipe=>recipe.name)).size,data.recipes.length);
  for(const name of ['冷奴（薬味）','卯の花（おから煮）','ポテトサラダ（家庭用）','卵サラダ','春雨サラダ','もずく酢','小松菜のお浸し','里芋の含め煮'])assert.ok(CLASSIC_SIDE_RECIPES.some(recipe=>recipe.name===name),name);
});

test('小鉢の材料と手順がそろい、皿の基準量と調理済み食材の区別を保つ',()=>{
  for(const recipe of CLASSIC_SIDE_RECIPES){
    assert.equal(recipe.role,'side',recipe.id);assert.equal(recipe.staple,false,recipe.id);assert.equal(recipe.mealBase,false,recipe.id);
    assert.equal(recipe.servings,2,recipe.id);assert.deepEqual(recipe.portion,{amount:1,unit:'皿',label:'小鉢1皿を1人分の基準にしています'},recipe.id);
    assert.ok(recipe.minutes>0&&recipe.steps.length>=3,recipe.id);
    assert.equal(recipe.nature,'home-cooked');assert.equal(new Set(recipe.ingredients.map(part=>part.id)).size,recipe.ingredients.length,recipe.id);
    for(const part of recipe.ingredients){assert.ok(data.ingredients[part.id],`${recipe.id}/${part.id}`);assert.ok(Number.isFinite(part.amount)&&part.amount>0,recipe.id);}
    assert.doesNotThrow(()=>describeRecipe(recipe.id,data),recipe.id);
  }
  assert.match(CLASSIC_SIDE_INGREDIENTS.macaroni.name,/乾/);
  assert.match(CLASSIC_SIDE_INGREDIENTS.mozuku.name,/無調味/);
  assert.match(CLASSIC_SIDE_INGREDIENTS.mekabu.name,/無調味/);
  assert.deepEqual(CLASSIC_SIDE_INGREDIENTS.konjac.allergens,[]);
  assert.ok(get('octopus-cucumber').ingredients.some(part=>part.id==='octopus'));
});

test('小鉢でも卵・乳・大豆・落花生と調味料由来の小麦の除外を守る',()=>{
  const eggs=describeRecipe(get('egg-salad').id,data);
  for(const allergen of ['egg','milk','soy','wheat'])assert.ok(eggs.allergens.includes(allergen),allergen);
  const noEgg=new Set(eligibleRecipes({allergens:['egg']},data,{role:'side'}).map(recipe=>recipe.id));
  assert.ok(!noEgg.has(get('egg-salad').id));assert.ok(noEgg.has(get('hiyayakko').id));
  const noSoy=new Set(eligibleRecipes({allergens:['soy']},data,{role:'side'}).map(recipe=>recipe.id));
  assert.ok(!noSoy.has(get('hiyayakko').id));assert.ok(noSoy.has(get('cucumber-sunomono').id));
  const noPeanut=new Set(eligibleRecipes({allergens:['peanut']},data,{role:'side'}).map(recipe=>recipe.id));
  assert.ok(!noPeanut.has(get('komatsuna-peanut-egg').id));
});

test('小鉢半皿を2人分買う場合、基準の2人分材料の半分になる',()=>{
  const recipe=describeRecipe(get('cucumber-sunomono').id,data),item=itemFromRecipe(recipe,data,0.5);
  const entries=[{id:'small-dish-plan',date:'2026-11-12',meal:'dinner',status:'planned',items:[item],note:''}];
  const result=shoppingForEntries(entries,data,{from:'2026-11-12',to:'2026-11-12',servings:2,pantry:[]});
  assert.equal(result.items.find(part=>part.id==='cucumber').required,80);
  assert.equal(result.items.find(part=>part.id==='vinegar').required,10);
  assert.equal(result.items.find(part=>part.id==='salt').required,0.25);
});
