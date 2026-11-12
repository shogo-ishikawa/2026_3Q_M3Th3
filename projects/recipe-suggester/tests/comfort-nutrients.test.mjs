import test from 'node:test';
import assert from 'node:assert/strict';
import {INGREDIENTS} from '../data.js';
import {INGREDIENT_NUTRITION} from '../ingredient-nutrients.js';
import {COMFORT_INGREDIENTS} from '../comfort-foods.js';
import {CONFECTIONERY_INGREDIENTS,CONFECTIONERY_RECIPES} from '../confectionery-foods.js';
import {DESSERT_INGREDIENTS,DESSERT_RECIPES} from '../dessert-foods.js';
import {NUTRIENT_KEYS,recipeNutrition} from '../nutrition.js';

const close=(actual,expected)=>assert.ok(typeof actual==='number'&&Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
const data={ingredients:Object.fromEntries(Object.entries(INGREDIENTS).map(([id,ingredient])=>[
  id,{...ingredient,...INGREDIENT_NUTRITION[id]},
]))};
const ingredientNutrition=(id,grams)=>recipeNutrition({servings:1,ingredients:[{id,amount:grams}]},data);

test('豚小腸ゆで11169は可食部1gの6成分と調理状態を保つ',()=>{
  const id='pork_small_intestine_boiled',profile=INGREDIENT_NUTRITION[id];
  assert.equal(COMFORT_INGREDIENTS[id].unit,'g');assert.equal(INGREDIENTS[id].unit,'g');
  assert.deepEqual(profile.nutritionPerUnit,{kcal:1.59,protein:.14,fat:.119,carbs:0,fiber:0,salt:0});
  assert.match(profile.nutritionSource,/食品番号11169/);
  assert.match(profile.nutritionSource,/https:\/\/fooddb\.mext\.go\.jp\/details\/details\.pl\?ITEM_NO=11_11169_7/);
  assert.match(profile.nutritionSource,/下ゆで後.*味付けなし.*小腸/);
  assert.match(INGREDIENTS[id].name,/小腸・ゆで・味付けなし/);
  assert.match(INGREDIENTS[id].note,/下ゆで後.*水気.*小腸/);
  const full=ingredientNutrition(id,100);
  for(const [key,value] of Object.entries({kcal:159,protein:14,fat:11.9,carbs:0,fiber:0,salt:0}))close(full[key],value);
});

test('牛腱ゆで11101は1g値を使用し、総炭水化物Trを別列や0で補わない',()=>{
  const id='beef_tendon_boiled',profile=INGREDIENT_NUTRITION[id];
  assert.equal(COMFORT_INGREDIENTS[id].unit,'g');assert.equal(INGREDIENTS[id].unit,'g');
  assert.deepEqual(profile.nutritionPerUnit,{kcal:1.57,protein:.31,fat:.051,carbs:null,fiber:0,salt:.002});
  assert.match(profile.nutritionSource,/食品番号11101/);
  assert.match(profile.nutritionSource,/https:\/\/fooddb\.mext\.go\.jp\/details\/details\.pl\?ITEM_NO=11_11101_7/);
  assert.match(profile.nutritionSource,/食品名は腱.*すじ/);
  assert.match(profile.nutritionSource,/炭水化物Trはnull.*利用可能炭水化物0\.8を代入しない/);
  assert.match(INGREDIENTS[id].name,/腱・ゆで・味付けなし/);
  assert.match(INGREDIENTS[id].note,/下ゆで後.*水気.*腱/);
  const full=ingredientNutrition(id,100);
  close(full.kcal,157);close(full.protein,31);close(full.fat,5.1);close(full.salt,.2);
  assert.equal(full.carbs,null);assert.equal(full.fiber,0);
});

test('豚肉・牛肉のアレルゲンを継承しても栄養は調理済み部位の値で計算する',()=>{
  for(const [id,parent] of [['pork_small_intestine_boiled','pork'],['beef_tendon_boiled','beef']]){
    assert.deepEqual(COMFORT_INGREDIENTS[id].derivedFrom,[parent]);
    assert.ok(COMFORT_INGREDIENTS[id].allergens.includes(parent));
    assert.notDeepEqual(INGREDIENT_NUTRITION[id].nutritionPerUnit,INGREDIENT_NUTRITION[parent].nutritionPerUnit);
    assert.match(INGREDIENT_NUTRITION[id].nutritionSource,/2026-03-27更新/);
    assert.match(INGREDIENT_NUTRITION[id].nutritionSource,/確認日2026-11-13/);
  }
});

test('追加購入材料58種は栄養を不明に保ち、完成品の公式表示と混ぜない',()=>{
  const purchased={...CONFECTIONERY_INGREDIENTS,...DESSERT_INGREDIENTS};
  const recipes=[...CONFECTIONERY_RECIPES,...DESSERT_RECIPES];
  assert.equal(Object.keys(CONFECTIONERY_INGREDIENTS).length,34);
  assert.equal(Object.keys(DESSERT_INGREDIENTS).length,24);
  assert.equal(Object.keys(purchased).length,58);assert.equal(recipes.length,58);
  const unknown=Object.fromEntries(NUTRIENT_KEYS.map(key=>[key,null]));
  for(const id of Object.keys(purchased)){
    assert.ok(INGREDIENTS[id],id);assert.ok(INGREDIENT_NUTRITION[id],id);
    assert.deepEqual(INGREDIENT_NUTRITION[id].nutritionPerUnit,unknown,id);
    assert.match(INGREDIENT_NUTRITION[id].nutritionSource,/対応する栄養値は未登録/);
    assert.match(INGREDIENT_NUTRITION[id].nutritionSource,/https:\/\//);
    assert.match(INGREDIENT_NUTRITION[id].nutritionSource,/2026-11-13/);
    const recipe=recipes.find(r=>r.ingredients.some(part=>part.id===id));
    assert.ok(recipe,id);assert.ok(recipe.manualNutrition,id);
    assert.deepEqual(recipeNutrition(recipe,data),recipe.manualNutrition,id);
    assert.ok(Object.values(recipe.manualNutrition).some(value=>typeof value==='number'),id);
  }
});
