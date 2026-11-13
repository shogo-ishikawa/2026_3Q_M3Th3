import test from 'node:test';
import assert from 'node:assert/strict';
import {PALETTE_INGREDIENTS,PALETTE_NUTRITION,PALETTE_RECIPES} from '../palette-foods.js';
import {INGREDIENTS,RECIPES,ALLERGENS} from '../data.js';
import {recipeNutrition,NUTRIENT_KEYS} from '../nutrition.js';
import {eligibleRecipes} from '../planner.js';

const data={ingredients:INGREDIENTS,recipes:RECIPES,allergens:ALLERGENS};
const byId=id=>{const found=PALETTE_RECIPES.find(r=>r.id===id);assert.ok(found,id);return found;};
const near=(actual,expected)=>assert.ok(typeof actual==='number'&&Math.abs(actual-expected)<1e-6,`${actual} != ${expected}`);

test('追加28品と24食材は明示分量と出典を持ち、既存の卵・ハム・ナッツも再利用する',()=>{
  assert.equal(PALETTE_RECIPES.length,28);
  assert.equal(Object.keys(PALETTE_INGREDIENTS).length,24);
  assert.deepEqual(Object.keys(PALETTE_NUTRITION).sort(),Object.keys(PALETTE_INGREDIENTS).sort());
  for(const recipe of PALETTE_RECIPES){
    assert.equal(recipe.servings,2,recipe.id);
    assert.equal(new Set(recipe.ingredients.map(p=>p.id)).size,recipe.ingredients.length,recipe.id);
    assert.ok(recipe.ingredients.every(p=>p.amount>0&&Number.isFinite(p.amount)&&INGREDIENTS[p.id]),recipe.id);
    for(const key of NUTRIENT_KEYS)assert.ok(Number.isFinite(recipeNutrition(recipe,data)[key]),`${recipe.id}.${key}`);
  }
  for(const [id,profile]of Object.entries(PALETTE_NUTRITION)){
    assert.ok(profile.nutritionSource.includes('https://'),id);
    assert.ok(Object.isFrozen(profile.nutritionPerUnit),id);
  }
  assert.equal(byId('palette-ham').ingredients[0].id,'ready_sliced_ham');
  assert.equal(byId('palette-bacon').ingredients[0].id,'bacon');
  assert.ok(RECIPES.some(r=>r.id==='classic-fried-egg'));
  assert.ok(RECIPES.some(r=>r.id==='classic-scrambled-egg'));
  assert.ok(RECIPES.some(r=>r.id==='snack-peanut'));
  assert.ok(!PALETTE_RECIPES.some(r=>/scrambled|fried-egg|nuts-peanut/.test(r.id)));
});

test('ウインナー3本60gとカキフライ3個90gの栄養を独立に換算する',()=>{
  const wiener=recipeNutrition(byId('palette-wiener'),data);
  near(wiener.kcal,191.4);near(wiener.fat,18.36);near(wiener.salt,1.14);
  const oyster=byId('palette-oyster-fry'),values=recipeNutrition(oyster,data);
  near(values.kcal,230.4);near(values.protein,6.84);near(values.fat,9.99);near(values.fiber,.585);
  assert.deepEqual(oyster.ingredients,[{id:'palette_oyster_fry',amount:180}]);
  assert.equal(PALETTE_NUTRITION.palette_oyster_fry.rawNutritionPerUnit.fiber,null);
  assert.deepEqual(PALETTE_NUTRITION.palette_oyster_fry.estimatedNutrients,['fiber']);
});

test('味付けナッツの塩分を無塩の0にせず殻の廃棄率を重ねない',()=>{
  const pistachio=recipeNutrition(byId('palette-nuts-pistachio'),data);
  near(pistachio.kcal,92.55);near(pistachio.salt,.105);
  const macadamia=recipeNutrition(byId('palette-nuts-macadamia'),data);
  near(macadamia.kcal,112.65);near(macadamia.fat,11.505);near(macadamia.salt,.075);
  assert.match(PALETTE_INGREDIENTS.palette_pistachio.name,/味付け/);
});

test('握り追加7種は1貫と2貫分材料を区別し、卵とあなごの調味料を合算する',()=>{
  const sushi=PALETTE_RECIPES.filter(r=>r.id.startsWith('palette-nigiri-'));
  assert.equal(sushi.length,7);
  for(const r of sushi){
    assert.deepEqual(r.portion,{amount:1,unit:'貫',label:'握り1貫（ご飯約22.5g）'});
    assert.equal(r.ingredients.find(p=>p.id==='rice').amount,45);
    assert.equal(r.servings,2);
  }
  near(recipeNutrition(byId('palette-nigiri-scallop'),data).kcal,50.98253);
  near(byId('palette-nigiri-egg').ingredients.find(p=>p.id==='sugar').amount,2.25);
  near(byId('palette-nigiri-anago').ingredients.find(p=>p.id==='soy_sauce').amount,2);
  assert.equal(PALETTE_NUTRITION.palette_anago_steamed.rawNutritionPerUnit.carbs,null);
  near(PALETTE_NUTRITION.palette_anago_steamed.nutritionPerUnit.carbs,.0003);
});

test('マフィンは焼成前生地の70g分と原材料配合が一致する',()=>{
  const base=recipeNutrition({servings:1,ingredients:[{id:'palette_muffin_base',amount:70}]},data);
  const raw=recipeNutrition(byId('palette-muffin'),data);
  for(const key of NUTRIENT_KEYS)near(base[key],raw[key]);
  assert.match(PALETTE_INGREDIENTS.palette_muffin_base.name,/焼成前/);
  assert.ok(!byId('palette-muffin').ingredients.some(p=>p.id==='palette_muffin_base'),'買い物へ原材料を渡す');
  assert.equal(PALETTE_NUTRITION.palette_muffin_base.estimatedNutrients.length,6);
  assert.match(PALETTE_NUTRITION.palette_waffle.nutritionSource,/1枚70g/);
});

test('商品表示を未確認の一般加工品は栄養を記録できても自動献立へ混ぜない',()=>{
  const eligible=new Set(eligibleRecipes({},data).map(r=>r.id));
  for(const id of ['palette-oden','palette-wiener','palette-chicken-nugget','palette-oyster-fry','palette-prosciutto','palette-ham','palette-bacon','palette-takuan','palette-bagel','palette-sandwich']){
    const recipe=byId(id);
    assert.equal(recipe.ingredientsKnown,false,id);
    assert.equal(recipe.allergensKnown,false,id);
    assert.equal(recipe.shoppingKnown,true,id);
    assert.ok(!eligible.has(id),id);
    assert.ok(Object.values(recipeNutrition(recipe,data)).every(value=>Number.isFinite(value)),id);
  }
  for(const id of ['palette_chikuwa','palette_hanpen','palette_ganmodoki','palette_wiener','palette_chicken_nugget','palette_oyster_fry','palette_prosciutto','palette_takuan','palette_bagel']){
    assert.equal(PALETTE_INGREDIENTS[id].ingredientsKnown,false,id);
    assert.equal(PALETTE_INGREDIENTS[id].allergensKnown,false,id);
  }
});
