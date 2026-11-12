import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {INGREDIENT_NUTRITION} from '../ingredient-nutrients.js';
import {PERFORMANCE_INGREDIENTS, PERFORMANCE_RECIPES} from '../performance-foods.js';
import {recipeFamily, recipePortion, quantityFromAmount, catalogVariants} from '../catalog.js';
import {describeRecipe, eligibleRecipes} from '../planner.js';
import {recipeNutrition, itemFromRecipe, itemNutrition, NUTRIENT_KEYS} from '../nutrition.js';
import {shoppingForEntries} from '../shopping.js';
import {defaultJournal, parseJournal} from '../journal.js';

const ownIds=new Set(PERFORMANCE_RECIPES.map(recipe=>recipe.id));
const data={allergens:ALLERGENS,
  ingredients:Object.fromEntries(Object.entries({...INGREDIENTS,...PERFORMANCE_INGREDIENTS})
    .map(([id,item])=>[id,{...item,...INGREDIENT_NUTRITION[id]}])),
  recipes:[...RECIPES.filter(recipe=>!ownIds.has(recipe.id)),...PERFORMANCE_RECIPES]};
const get=id=>PERFORMANCE_RECIPES.find(recipe=>recipe.id===`performance-${id}`);
const close=(actual,expected)=>assert.ok(typeof actual==='number'&&Math.abs(actual-expected)<1e-7,`${actual} != ${expected}`);
const record=(recipe,input)=>itemFromRecipe(describeRecipe(recipe.id,data),data,quantityFromAmount(recipe,data,input));

test('酒10・プロテイン5・清涼飲料水5・補食9を既存の飲料へ重複追加しない',()=>{
  assert.equal(Object.keys(PERFORMANCE_INGREDIENTS).length,26);
  assert.equal(PERFORMANCE_RECIPES.length,29);
  assert.equal(new Set(data.recipes.map(recipe=>recipe.id)).size,data.recipes.length);
  assert.equal(new Set(data.recipes.map(recipe=>recipe.name)).size,data.recipes.length);
  for(const [family,count]of [['alcohol',10],['protein-drink',5],['soft-drink',5],['functional-snack',9]]){
    assert.equal(PERFORMANCE_RECIPES.filter(recipe=>recipeFamily(recipe)===family).length,count,family);
    for(const recipe of PERFORMANCE_RECIPES.filter(recipe=>recipe.family===family))assert.ok(catalogVariants(data.recipes,family).some(item=>item.id===recipe.id));
  }
  assert.ok(!PERFORMANCE_RECIPES.some(recipe=>['コーラ','スポーツドリンク'].includes(recipe.name)));
});

test('商品名・基準量・公式出典・確認日と2人分の材料をそろえる',()=>{
  for(const recipe of PERFORMANCE_RECIPES){
    assert.equal(recipe.servings,2,recipe.id);assert.equal(recipe.staple,false,recipe.id);assert.equal(recipe.mealBase,false,recipe.id);
    assert.equal(recipe.role,recipe.family==='functional-snack'?'snack':'drink',recipe.id);
    assert.equal(recipe.nature,'ready-to-eat',recipe.id);assert.deepEqual(recipe.tags,['時短'],recipe.id);
    assert.equal(recipe.allergensKnown,false,recipe.id);assert.equal(recipe.ingredientsKnown,false,recipe.id);assert.equal(recipe.shoppingKnown,true,recipe.id);
    assert.match(recipe.sourceNote,/2026-11-13/,recipe.id);assert.match(recipe.sourceNote,/https:\/\//,recipe.id);assert.ok(recipe.sourceNote.length<=2000,recipe.id);
    assert.equal(recipe.steps.length,3,recipe.id);assert.ok(recipe.steps.every(step=>step.length>=10),recipe.id);
    for(const part of recipe.ingredients){assert.ok(data.ingredients[part.id],`${recipe.id}/${part.id}`);assert.ok(part.amount>0,recipe.id);}
    assert.doesNotThrow(()=>describeRecipe(recipe.id,data),recipe.id);
    assert.ok(recipePortion(recipe,data).amount>0,recipe.id);
  }
});

test('粉末28gを1杯として水割と牛乳割を分け、完成mlを推定しない',()=>{
  const soy=get('soy_powder-water'),whey=get('whey_powder-water');
  assert.deepEqual(soy.ingredients,[{id:'perf_soy_powder',amount:56},{id:'water',amount:400}]);
  assert.equal(recipePortion(soy,data).unit,'杯');assert.match(soy.portion.label,/完成容量は未測定/);
  close(recipeNutrition(soy,data).kcal,103);close(recipeNutrition(soy,data).protein,20);
  close(recipeNutrition(whey,data).kcal,108);close(recipeNutrition(whey,data).fiber,1.4);
  for(const base of ['soy','whey']){
    const water=recipeNutrition(get(`${base}_powder-water`),data),milk=recipeNutrition(get(`${base}_powder-milk`),data);
    close(milk.kcal,water.kcal+INGREDIENT_NUTRITION.milk.nutritionPerUnit.kcal*200);
    close(milk.protein,water.protein+INGREDIENT_NUTRITION.milk.nutritionPerUnit.protein*200);
    assert.equal(water.salt,null);assert.equal(milk.salt,null);
  }
  assert.equal(recipeNutrition(soy,data).fiber,null);
  assert.equal(recipeNutrition(get('soy_powder-milk'),data).fiber,null);
});

test('表示mlと1本の栄養を重ねず、ゼロ表示と未表示を区別する',()=>{
  const ready=get('milk_protein');assert.deepEqual(ready.ingredients,[{id:'perf_milk_protein',amount:400}]);
  close(itemNutrition(record(ready,100)).kcal,51.5);assert.equal(recipeNutrition(ready,data).fiber,null);
  close(recipeNutrition(get('energy'),data).kcal,115);close(recipeNutrition(get('energy'),data).salt,.5);
  close(itemNutrition(record(get('energy'),125)).kcal,57.5);
  const zero=recipeNutrition(get('cola_zero'),data);assert.equal(zero.kcal,0);assert.equal(zero.carbs,0);assert.equal(zero.fiber,null);close(zero.salt,.025);
  close(recipeNutrition(get('ion_water'),data).kcal,27.5);
  close(recipeNutrition(get('ginger_ale'),data).kcal,90);
});

test('バーは本数、チキンは袋、ブロックは4本80gを基準にする',()=>{
  close(recipeNutrition(get('bar_baked_choco'),data).kcal,199);
  assert.equal(recipeNutrition(get('bar_baked_choco'),data).fiber,null);
  assert.equal(recipeNutrition(get('bar_baked_choco'),data).salt,null);
  close(recipeNutrition(get('bar_baked_bitter'),data).fiber,6.9);
  close(recipeNutrition(get('bar_manzoku'),data).salt,.49);
  const block=get('calorie_block_choco');assert.equal(recipePortion(block,data).amount,4);assert.equal(recipePortion(block,data).unit,'本');
  assert.equal(quantityFromAmount(block,data,2),.5);close(itemNutrition(record(block,2)).kcal,200);
  close(itemNutrition(record(get('calorie_block_cheese'),1)).kcal,100);
  close(recipeNutrition(get('chicken_plain'),data).protein,30.3);close(recipeNutrition(get('chicken_herb'),data).fiber,.4);
  close(recipeNutrition(get('chicken_smoke'),data).carbs,3);close(recipeNutrition(get('calorie_jelly_apple'),data).salt,.08);
  assert.deepEqual(data.ingredients.perf_calorie_block_choco.nutritionPerUnit,Object.fromEntries(NUTRIENT_KEYS.map(key=>[key,null])));
});

test('MEXT酒類はgをmlへ換算し、アルコール由来のエネルギーを消さない',()=>{
  close(recipeNutrition(get('beer'),data).kcal,137.592); // 39kcal/100g × 1.008g/ml × 350ml
  for(const key of ['fat','fiber','salt'])assert.equal(recipeNutrition(get('beer'),data)[key],0,key);
  close(recipeNutrition(get('wine_white'),data).carbs,2.994);
  close(recipeNutrition(get('sake'),data).kcal,192.4074);
  close(recipeNutrition(get('whisky'),data).kcal,66.8304);
  assert.equal(recipeNutrition(get('wine_red'),data).fiber,null);
  assert.equal(recipeNutrition(get('shochu'),data).salt,null);
  const highball=get('highball');assert.equal(highball.portion.unit,'杯');assert.deepEqual(highball.ingredients,[{id:'perf_whisky',amount:90},{id:'carbonated_water',amount:270}]);
  close(recipeNutrition(highball,data).kcal,100.2456);
});

test('酒は確認済みフラグへ変更しても分類を基に自動提案から外す',()=>{
  const alcohol=PERFORMANCE_RECIPES.filter(recipe=>recipe.family==='alcohol').map(recipe=>({...recipe,allergensKnown:true,ingredientsKnown:true}));
  const isolated={...data,recipes:alcohol};
  assert.deepEqual(eligibleRecipes({},isolated),[]);
  const choices=new Set(eligibleRecipes({},data).map(recipe=>recipe.id));
  for(const id of ownIds)assert.ok(!choices.has(id),id);
});

test('買い物では購入品を数え、粉末と割り材だけを分ける',()=>{
  const items=[record(get('soy_powder-milk'),1),record(get('bar_baked_choco'),2),record(get('calorie_block_choco'),2),record(get('chicken_plain'),1)];
  const entries=[{id:'performance-plan',date:'2026-11-13',meal:'snack',status:'planned',items,note:''}];
  const result=shoppingForEntries(entries,data,{from:'2026-11-13',to:'2026-11-13',servings:2,pantry:[]});
  const required=id=>result.items.find(part=>part.id===id)?.required;
  close(required('perf_soy_powder'),56);close(required('milk'),400);
  close(required('perf_bar_baked_choco'),4);close(required('perf_calorie_block_choco'),1);close(required('perf_chicken_plain'),2);
  assert.equal(result.items.find(part=>part.id==='perf_calorie_block_choco').unit,'箱');
  assert.ok(!result.items.some(part=>['chicken_breast','soybeans','chocolate','flour'].includes(part.id)));
  assert.equal(result.missingMenus.length,4);
});

test('記録とJSONへ基準栄養・確認状況・商品メモをそのまま残す',()=>{
  const item=record(get('calorie_block_choco'),2),journal=defaultJournal();
  journal.entries=[{id:'performance-history',date:'2026-11-13',meal:'snack',status:'eaten',items:[item],note:''}];
  const imported=parseJournal(JSON.stringify(journal),data);
  const restored=imported.entries[0].items[0];
  assert.equal(restored.quantity,.5);assert.equal(restored.nutrition.kcal,400);assert.equal(restored.allergensKnown,false);assert.equal(restored.ingredientsKnown,false);assert.equal(restored.shoppingKnown,true);assert.equal(restored.sourceNote,item.sourceNote);
});
