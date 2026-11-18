import test from 'node:test';
import assert from 'node:assert/strict';
import {INGREDIENTS, RECIPES} from '../data.js';
import {KYOTO_RECIPES, KYOTO_NUTRITION} from '../kyoto-foods.js';
import {buildFoodSelection,foodComposerFor} from '../food-composer.js';
import {recipeNutrition} from '../nutrition.js';
import {dishClassification} from '../dish-hierarchy.js';

const data={recipes:RECIPES,ingredients:INGREDIENTS};
const get=id=>RECIPES.find(recipe=>recipe.id===id);

test('京都の料理と生食用の魚を配合・分量・場面つきで検索台帳に載せる',()=>{
  for(const source of KYOTO_RECIPES){
    const recipe=get(source.id);
    assert.ok(recipe,source.id);
    assert.equal(recipe.servings,2);
    assert.deepEqual(recipe.mealOccasions,source.mealOccasions);
    assert.ok(Object.values(recipeNutrition(recipe,data)).every(v=>Number.isFinite(v)&&v>=0),source.id);
    assert.ok(recipe.ingredients.every(part=>part.amount>0&&INGREDIENTS[part.id]),source.id);
  }
  assert.ok(get('kyoto-egg-spring-roll').ingredients.some(i=>i.id==='egg'));
  assert.ok(!get('kyoto-egg-spring-roll').ingredients.some(i=>i.id==='spring_roll_wrappers'));
  assert.deepEqual(dishClassification(get('kyoto-egg-spring-roll')).secondaryCategories.sort(),['egg','vegetable']);
  assert.deepEqual(get('kyoto-dashimaki').mealOccasions,['朝食','昼食','夕食','晩酌']);
  assert.ok(get('kyoto-namafu-dengaku').ingredients.some(p=>p.id==='kyoto_namafu'));
  assert.ok(INGREDIENTS.kyoto_namafu.allergens.includes('wheat'));
});

test('新規食材は基準重量と成分表の微量・未掲載・推定を区別する',()=>{
  for(const [id,profile] of Object.entries(KYOTO_NUTRITION)){
    assert.deepEqual(INGREDIENTS[id].nutritionPerUnit,profile.nutritionPerUnit,id);
    assert.equal(profile.gramsPerUnit,1,id);
    assert.match(profile.nutritionSource,/fooddb\.mext\.go\.jp/);
  }
  assert.equal(INGREDIENTS.kyoto_namafu.nutritionPerUnit.kcal,1.61);
  assert.equal(INGREDIENTS.kyoto_usukuchi.nutritionPerUnit.salt,0.16);
  assert.equal(INGREDIENTS.kyoto_kombu_dashi.rawNutritionPerUnit.fiber,null);
  assert.equal(INGREDIENTS.kyoto_kombu_dashi.nutritionPerUnit.fiber,0.001);
  assert.equal(INGREDIENTS.kyoto_suzuki.rawNutritionPerUnit.carbs,null);
  assert.equal(INGREDIENTS.kyoto_suzuki.nutritionPerUnit.carbs,0.0003);
});

test('刺身盛り合わせでネギトロの盛り数と魚の切れ数を独立して換算する',()=>{
  for(const id of ['negitoro','torotaku','kanpachi','suzuki']){
    assert.equal(foodComposerFor(`sashimi-${id}`).kind,'sashimi');
  }
  const plate=buildFoodSelection({kind:'sashimi',components:[
    {id:'negitoro',amount:1,gramsPerUnit:60},{id:'kanpachi',amount:2,gramsPerUnit:10},
  ]},data);
  const amount=Object.fromEntries(plate.ingredients.map(part=>[part.id,part.amount]));
  assert.equal(amount.tuna_lean_sashimi,40);
  assert.equal(amount.tuna_mediumfat_sashimi,20);
  assert.equal(amount.kyoto_kanpachi,20);
  assert.equal(amount.scallion_garnish,3);
  assert.equal(amount.rice,undefined);
  assert.equal(amount.soy_sauce,4.2);
  assert.equal(plate.family,'sashimi');
});
