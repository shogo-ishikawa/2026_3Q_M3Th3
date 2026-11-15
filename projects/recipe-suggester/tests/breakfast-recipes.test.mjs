import test from 'node:test';
import assert from 'node:assert/strict';
import {BREAKFAST_INGREDIENTS,BREAKFAST_NUTRITION,BREAKFAST_RECIPES} from '../breakfast-recipes.js';
import {INGREDIENTS,RECIPES,ALLERGENS} from '../data.js';
import {eligibleRecipes,describeRecipe} from '../planner.js';
import {recipeNutrition,itemFromRecipe,itemNutrition} from '../nutrition.js';
import {isCompleteMeal,recipePortion} from '../catalog.js';
import {recipeMealSuitability} from '../meal-suitability.js';
import {pantryClassification} from '../pantry-catalog.js';
import {shoppingForEntries} from '../shopping.js';
const data={ingredients:INGREDIENTS,recipes:RECIPES,allergens:ALLERGENS};
const get=id=>RECIPES.find(recipe=>recipe.id===`breakfast-${id}`);
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);

test('朝食の卵3品とパン5品は既存IDと重ならず、朝昼夕の候補として読める',()=>{
  assert.equal(BREAKFAST_RECIPES.length,8);assert.equal(Object.keys(BREAKFAST_INGREDIENTS).length,5);
  assert.equal(new Set(RECIPES.map(recipe=>recipe.id)).size,RECIPES.length);
  const available=new Set(eligibleRecipes({},data).map(recipe=>recipe.id));
  for(const recipe of BREAKFAST_RECIPES){
    assert.ok(available.has(recipe.id),recipe.id);assert.doesNotThrow(()=>describeRecipe(recipe.id,data));
    assert.deepEqual(recipeMealSuitability(recipe).meals,['breakfast','lunch','dinner']);
    assert.ok(recipe.ingredients.every(part=>INGREDIENTS[part.id]&&part.amount>0));
    assert.equal(recipe.servings,2);assert.equal(recipe.ingredientsKnown,true);assert.equal(recipe.allergensKnown,true);
  }
  for(const id of ['ham-egg','bacon-egg','chashu-egg']){assert.equal(get(id).family,'egg-main');assert.equal(get(id).staple,false);assert.match(get(id).steps.join(' '),/黄身.*固まる/);}
  for(const id of ['bagel-egg-cheese','bagel-ham-cheese','english-muffin-egg','english-muffin-ham-cheese'])assert.equal(isCompleteMeal(get(id)),true,id);
  assert.equal(isCompleteMeal(get('bagel-plain')),false);assert.deepEqual(get('bagel-plain').steps,[]);
});

test('製品の表示単位を独立に換算し、食物繊維の未掲載を0へ変えない',()=>{
  near(recipeNutrition(get('bagel-plain'),data).kcal,204);
  near(recipeNutrition(get('ham-egg'),data).kcal,46/39*20+INGREDIENTS.egg.nutritionPerUnit.kcal+INGREDIENTS.oil.nutritionPerUnit.kcal*2+INGREDIENTS.black_pepper.nutritionPerUnit.kcal*.05);
  for(const [id,item]of Object.entries(BREAKFAST_INGREDIENTS)){
    assert.equal(item.rawNutritionPerUnit.fiber,null,id);assert.equal(item.nutritionPerUnit.fiber,null,id);
    assert.deepEqual(item.estimatedNutrients,[],id);assert.match(item.nutritionSource,/https:\/\//);
    assert.deepEqual(INGREDIENTS[id].nutritionPerUnit,BREAKFAST_NUTRITION[id].nutritionPerUnit);
  }
  assert.equal(recipeNutrition(get('bagel-plain'),data).fiber,null);
  assert.equal(INGREDIENTS.breakfast_bagel.gramsPerUnit,undefined);
  assert.equal(INGREDIENTS.breakfast_english_muffin.gramsPerUnit,67);
});

test('ハム・ベーコン・焼豚の製品表示に含まれる卵・乳・大豆・ごまも除外に効く',()=>{
  const candidates=settings=>new Set(eligibleRecipes(settings,data).map(recipe=>recipe.id));
  for(const allergen of ['egg','milk','soy','pork'])for(const id of ['ham-egg','bacon-egg','chashu-egg'])assert.ok(!candidates({allergens:[allergen]}).has(`breakfast-${id}`),`${id}/${allergen}`);
  assert.ok(!candidates({allergens:['sesame']}).has('breakfast-chashu-egg'));
  assert.ok(!candidates({excludedIngredients:['pork']}).has('breakfast-ham-egg'));
  assert.ok(!candidates({excludedIngredients:['flour']}).has('breakfast-bagel-plain'));
  assert.ok(!candidates({excludedIngredients:['corn']}).has('breakfast-english-muffin-egg'));
  assert.ok(!candidates({allergens:['milk']}).has('breakfast-bagel-plain'));
  assert.ok(candidates({allergens:['shrimp']}).has('breakfast-ham-egg'));
  assert.equal(pantryClassification('breakfast_bagel',data).subgroup,'bread');
  assert.equal(pantryClassification('breakfast_ham',data).subgroup,'processed');
});

test('2人分のベーグルは完成パン2個と具材を買い、原料の小麦粉を重ねない',()=>{
  const recipe=get('bagel-ham-cheese'),item={...itemFromRecipe(recipe,data),portion:recipePortion(recipe,data)};
  const entry={id:'breakfast-test',date:'2026-11-15',meal:'breakfast',status:'planned',items:[item],note:''};
  const result=shoppingForEntries([entry],data,{from:'2026-11-15',to:'2026-11-15',servings:2,pantry:[]});
  near(result.items.find(part=>part.id==='breakfast_bagel').required,2);
  near(result.items.find(part=>part.id==='breakfast_ham').required,40);
  assert.ok(!result.items.some(part=>part.id==='flour'));
  const original=itemNutrition(item);const changed={...data,ingredients:{...INGREDIENTS,breakfast_bagel:{...INGREDIENTS.breakfast_bagel,nutritionPerUnit:{kcal:900}}}};
  assert.deepEqual(itemNutrition(item,changed),original);
});

test('既存の確認済みトーストとサンドイッチも朝食に残し、未確認の旧商品は戻さない',()=>{
  const available=new Set(eligibleRecipes({},data).map(recipe=>recipe.id));
  for(const id of ['staple-butter-toast','staple-cheese-toast','bread-sandwich-egg-mayo','bread-sandwich-tuna-cucumber','bread-sandwich-vegetable','bread-sandwich-chicken']){
    assert.ok(available.has(id),id);assert.ok(recipeMealSuitability(RECIPES.find(recipe=>recipe.id===id)).meals.includes('breakfast'),id);
  }
  for(const id of ['palette-bagel','palette-english-muffin','palette-sandwich'])assert.ok(!available.has(id),id);
});
