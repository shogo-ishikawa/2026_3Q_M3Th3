import test from 'node:test';
import assert from 'node:assert/strict';
import {WORLD_INGREDIENTS,WORLD_NUTRITION,WORLD_RECIPES} from '../world-foods.js';
import {INGREDIENTS,ALLERGENS} from '../data.js';
import {recipeNutrition,itemFromRecipe,NUTRIENT_KEYS} from '../nutrition.js';

// The isolated module can be verified before data.js imports it.
const ingredients={...INGREDIENTS,...Object.fromEntries(Object.entries(WORLD_INGREDIENTS).map(([id,metadata])=>[id,{...metadata,...WORLD_NUTRITION[id]}]))};
const data={ingredients,recipes:WORLD_RECIPES,allergens:ALLERGENS};
const byId=id=>{const result=WORLD_RECIPES.find(recipe=>recipe.id===id);assert.ok(result,id);return result;};
const near=(actual,expected)=>assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<1e-7,`${actual} != ${expected}`);

test('世界の料理12種は2人分の可食材料と計算可能な栄養を持つ',()=>{
  assert.equal(WORLD_RECIPES.length,12);
  assert.equal(new Set(WORLD_RECIPES.map(recipe=>recipe.id)).size,12);
  assert.deepEqual(Object.keys(WORLD_INGREDIENTS).sort(),Object.keys(WORLD_NUTRITION).sort());
  for(const recipe of WORLD_RECIPES){
    assert.equal(recipe.servings,2,recipe.id);
    assert.ok(!Object.hasOwn(recipe,'searchAliases'),recipe.id);
    assert.equal(new Set(recipe.ingredients.map(part=>part.id)).size,recipe.ingredients.length,recipe.id);
    assert.ok(recipe.ingredients.every(part=>ingredients[part.id]&&Number.isFinite(part.amount)&&part.amount>0),recipe.id);
    assert.ok(recipe.steps.length>=3,recipe.id);
    assert.ok(recipe.steps.every(step=>typeof step==='string'&&step.length>=10),recipe.id);
    assert.ok(recipe.steps.every(step=>!/[0-9]+\s*(?:g|ml|個|枚|皿|人分|つ)/.test(step)),recipe.id);
    for(const key of NUTRIENT_KEYS)assert.ok(Number.isFinite(recipeNutrition(recipe,data)[key]),`${recipe.id}.${key}`);
  }
  for(const [id,profile]of Object.entries(WORLD_NUTRITION)){
    assert.equal(profile.gramsPerUnit,1,id);
    assert.match(profile.rawNutritionSource,/https:\/\//,id);
    assert.ok(Object.isFrozen(profile.nutritionPerUnit),id);
    for(const key of NUTRIENT_KEYS)assert.ok(Number.isFinite(profile.nutritionPerUnit[key]),`${id}.${key}`);
  }
});

test('マトンは成羊ロースの脂質と塩分を使い、パニールは乳製品として記録される',()=>{
  const mutton=recipeNutrition({servings:1,ingredients:[{id:'world_mutton',amount:100}]},data);
  near(mutton.kcal,192);near(mutton.protein,19.3);near(mutton.fat,15);near(mutton.salt,.2);
  assert.match(WORLD_INGREDIENTS.world_mutton.name,/マトン.*ロース.*生/);
  const paneer=recipeNutrition({servings:1,ingredients:[{id:'world_paneer',amount:100}]},data);
  near(paneer.kcal,312);near(paneer.fat,24);near(paneer.salt,.06096);
  const saag=itemFromRecipe(byId('world-saag-paneer'),data);
  assert.ok(saag.allergens.includes('milk'));
  assert.ok(!saag.proteinSources.includes('meat'));
});

test('ラベルに無い繊維を実測の0へ書き換えず補完根拠を残す',()=>{
  for(const id of ['world_paneer','world_tomyum_paste','world_garam_masala']){
    assert.equal(WORLD_NUTRITION[id].rawNutritionPerUnit.fiber,null,id);
    assert.deepEqual(WORLD_NUTRITION[id].estimatedNutrients,['fiber'],id);
    assert.match(WORLD_NUTRITION[id].nutritionSource,/未表示/,id);
  }
  assert.ok(WORLD_NUTRITION.world_tomyum_paste.nutritionPerUnit.fiber>0);
  near(WORLD_NUTRITION.world_tomyum_paste.nutritionPerUnit.salt,.178);
  near(WORLD_NUTRITION.world_garam_masala.nutritionPerUnit.kcal,4.3);
});

test('カレーは初期ライス150gを独立した材料として持ち、除けばカレーだけの栄養になる',()=>{
  const curries=WORLD_RECIPES.filter(recipe=>recipe.family==='curry');
  assert.equal(curries.length,4);
  for(const recipe of curries){
    assert.equal(recipe.role,'staple');assert.equal(recipe.staple,true);assert.equal(recipe.mealBase,true);
    assert.deepEqual(recipe.ingredients.find(part=>part.id==='rice'),{id:'rice',amount:300});
    assert.match(recipe.sourceNote,/0g/);
    const total=recipeNutrition(recipe,data);
    const noRice=recipeNutrition({...recipe,ingredients:recipe.ingredients.filter(part=>part.id!=='rice')},data);
    near(total.kcal-noRice.kcal,234);
    near(total.carbs-noRice.carbs,55.65);
    assert.ok(noRice.kcal>200,recipe.id);
    assert.ok(noRice.fat>10,recipe.id);
  }
});

test('ナン6種は主食で原材料を買い物へ渡し、チーズと全粒粉の差を反映する',()=>{
  const naans=WORLD_RECIPES.filter(recipe=>recipe.family==='naan');
  assert.equal(naans.length,6);
  for(const recipe of naans){
    assert.equal(recipe.role,'staple');assert.equal(recipe.staple,true);assert.equal(recipe.mealBase,false);
    assert.equal(recipe.portion.unit,'枚');assert.equal(recipe.portion.amount,1);
    assert.ok(recipe.ingredients.some(part=>/flour/.test(part.id)),recipe.id);
    assert.ok(!recipe.ingredients.some(part=>/naan/.test(part.id)),recipe.id);
  }
  const plain=recipeNutrition(byId('world-naan-plain'),data),cheese=recipeNutrition(byId('world-naan-cheese'),data);
  assert.ok(cheese.kcal>plain.kcal+80);
  assert.ok(cheese.fat>plain.fat+5);
  const whole=recipeNutrition(byId('world-naan-wholewheat'),data);
  assert.ok(whole.fiber>plain.fiber+3);
  assert.equal(byId('world-naan-wholewheat').ingredients.find(part=>part.id==='world_wholemeal_flour').amount,80);
});

test('えびペーストのアレルゲンとカニクリームの衣・吸収油を記録に含める',()=>{
  const tomyum=itemFromRecipe(byId('world-tomyum-kung'),data);
  assert.ok(tomyum.allergens.includes('shrimp'));
  assert.ok(tomyum.allergens.includes('soy'));
  const recipe=byId('world-crab-cream-croquette'),croquette=itemFromRecipe(recipe,data);
  for(const allergen of ['crab','milk','egg','wheat'])assert.ok(croquette.allergens.includes(allergen),allergen);
  assert.equal(recipe.ingredients.find(part=>part.id==='oil').amount,22);
  assert.equal(recipe.portion.amount,2);
  assert.equal(recipe.displayMethod,'fried');
  assert.ok(croquette.nutrition.fat>15);
  assert.match(recipe.sourceNote,/吸収油20ml/);
});
