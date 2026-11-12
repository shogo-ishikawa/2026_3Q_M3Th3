import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {CLASSIC_MAIN_INGREDIENTS,CLASSIC_MAIN_RECIPES} from '../classics-mains.js';
import {INGREDIENT_NUTRITION} from '../ingredient-nutrients.js';
import {CATALOG_CATEGORIES,quantityFromAmount,recipeFamily,recipePortion,isCompleteMeal} from '../catalog.js';
import {describeRecipe,eligibleRecipes,GENRES,MOODS} from '../planner.js';
import {itemFromRecipe,itemNutrition} from '../nutrition.js';
import {shoppingForEntries} from '../shopping.js';

const ownIds=new Set(CLASSIC_MAIN_RECIPES.map(recipe=>recipe.id));
const ingredients=Object.fromEntries(Object.entries({...INGREDIENTS,...CLASSIC_MAIN_INGREDIENTS}).map(([id,ingredient])=>[id,{...ingredient,...INGREDIENT_NUTRITION[id]}]));
const data={allergens:ALLERGENS,ingredients,recipes:[...RECIPES.filter(recipe=>!ownIds.has(recipe.id)),...CLASSIC_MAIN_RECIPES]};
const get=slug=>CLASSIC_MAIN_RECIPES.find(recipe=>recipe.id===`classic-${slug}`);
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-7,`${actual} != ${expected}`);

// 新しいメニュー数だけでなく、既存DBへの追加時に同じ料理を二重登録しないことも確認します。
test('定番54品と変化ある主菜20品を重複なく追加する',()=>{
  assert.equal(CLASSIC_MAIN_RECIPES.length,74);
  assert.equal(new Set(data.recipes.map(recipe=>recipe.id)).size,data.recipes.length);
  assert.equal(new Set(data.recipes.map(recipe=>recipe.name)).size,data.recipes.length);
  for(const family of ['karaage','grilled-fish','sashimi','egg-main','bean-main','meat-main','fish-main','cutlet','sushi','omelette-rice'])assert.ok(CLASSIC_MAIN_RECIPES.some(recipe=>recipe.family===family),family);
  assert.equal(CLASSIC_MAIN_RECIPES.filter(recipe=>recipe.family==='grilled-fish').length,6);
  assert.equal(CLASSIC_MAIN_RECIPES.filter(recipe=>recipe.family==='sashimi').length,11);
  assert.equal(CLASSIC_MAIN_RECIPES.filter(recipe=>recipe.family==='sushi').length,8);
  for(const name of ['鶏もも肉の唐揚げ','鮭の塩焼き','さばの塩焼き','まぐろ赤身の刺身','プレーンオムレツ','卵焼き','だし巻き卵','ゆで卵','納豆','メンチカツ','とんかつ','焼き餃子'])assert.ok(CLASSIC_MAIN_RECIPES.some(recipe=>recipe.name===name),name);
});

test('すべての主菜に材料・自然な手順・1人分の基準量と分類を持つ',()=>{
  for(const recipe of CLASSIC_MAIN_RECIPES){
    assert.ok(['main','staple'].includes(recipe.role),recipe.id);
    assert.equal(recipe.servings,2,recipe.id);assert.ok(recipe.minutes>0,recipe.id);
    assert.ok(GENRES.includes(recipe.genre),recipe.id);
    assert.ok(recipe.variantLabel&&recipe.sourceNote,recipe.id);
    assert.ok(['home-cooked','ready-to-eat'].includes(recipe.nature),recipe.id);
    assert.equal(CATALOG_CATEGORIES.find(category=>category.id===recipeFamily(recipe))?.role,recipe.role,recipe.id);
    assert.equal(recipePortion(recipe,data).amount,recipe.portion.amount,recipe.id);assert.equal(recipePortion(recipe,data).unit,recipe.portion.unit,recipe.id);if(recipe.portion.label)assert.equal(recipePortion(recipe,data).label,recipe.portion.label,recipe.id);
    assert.ok(recipe.steps.length>=3,recipe.id);
    for(const step of recipe.steps){assert.ok(typeof step==='string'&&step.trim(),recipe.id);assert.ok(!/\d+\s*(?:g|ml|個|枚|皿|人分|つ)/.test(step),`${recipe.id}: ${step}`);}
    assert.equal(new Set(recipe.ingredients.map(part=>part.id)).size,recipe.ingredients.length,recipe.id);
    for(const part of recipe.ingredients){assert.ok(ingredients[part.id],`${recipe.id}/${part.id}`);assert.ok(Number.isFinite(part.amount)&&part.amount>0,recipe.id);}
    assert.ok(recipe.tags.every(tag=>MOODS.includes(tag)&&tag!=='all'),recipe.id);
    if(recipe.role==='main')assert.equal(recipe.tags.includes('時短'),recipe.minutes<=20,recipe.id);
    else assert.deepEqual(recipe.tags,[],recipe.id);
    const described=describeRecipe(recipe.id,data);assert.equal(described.allergensKnown,true,recipe.id);assert.equal(described.ingredientsKnown,true,recipe.id);
  }
  assert.ok(get('croquette-cream').minutes>=60,'クリームを冷やして固める時間を含める');
});

test('刺身用材料は加熱用の魚と区別し、ゆでだこの既存材料だけを共有する',()=>{
  assert.equal(Object.keys(CLASSIC_MAIN_INGREDIENTS).length,14);
  for(const recipe of CLASSIC_MAIN_RECIPES.filter(recipe=>recipe.family==='sashimi')){
    const fish=recipe.ingredients.filter(part=>ingredients[part.id].proteinSources.includes('fish'));
    assert.equal(fish.reduce((sum,part)=>sum+part.amount,0),200,recipe.id);
    assert.ok(fish.every(part=>part.id.endsWith('_sashimi')||part.id==='octopus'),recipe.id);
    assert.equal(recipe.portion.amount,100,recipe.id);assert.equal(recipe.portion.unit,'g',recipe.id);
    assert.ok(recipe.steps.some(step=>/刺身用|生食用/.test(step)),recipe.id);
  }
  assert.match(CLASSIC_MAIN_INGREDIENTS.salmon_sashimi.name,/刺身用/);
  assert.match(CLASSIC_MAIN_INGREDIENTS.salmon_sashimi.note,/サーモントラウト/);
  assert.notEqual(CLASSIC_MAIN_INGREDIENTS.salmon_sashimi,INGREDIENTS.salmon);
  assert.match(CLASSIC_MAIN_INGREDIENTS.shishamo.name,/からふとししゃも.*生干し/);
  assert.match(INGREDIENTS.octopus.name,/ゆで/);
});

test('卵や乳、小麦・えび・さけの除外と豚肉由来材料の除外を引き継ぐ',()=>{
  const candidates=allergens=>new Set(eligibleRecipes({allergens},data).map(recipe=>recipe.id));
  assert.ok(!candidates(['egg']).has(get('omelette-plain').id));
  assert.ok(!candidates(['milk']).has(get('omelette-cheese').id));
  assert.ok(!candidates(['wheat']).has(get('gyoza').id));
  assert.ok(!candidates(['shrimp']).has(get('sushi-shrimp').id));
  assert.ok(!candidates(['salmon']).has(get('sashimi-salmon').id));
  assert.ok(candidates(['egg','milk']).has(get('grilled-salmon').id));
  const withoutPork=new Set(eligibleRecipes({excludedIngredients:['pork']},data).map(recipe=>recipe.id));
  assert.ok(!withoutPork.has(get('tonkatsu').id));
  const withoutFlour=new Set(eligibleRecipes({excludedIngredients:['flour']},data).map(recipe=>recipe.id));
  assert.ok(!withoutFlour.has(get('shumai').id));
  assert.ok(describeRecipe(get('gyoza').id,data).allergens.includes('wheat'));
});

test('寿司とオムライスは一品の主食として扱い、米や主菜の重ね足しを避ける',()=>{
  for(const recipe of CLASSIC_MAIN_RECIPES.filter(recipe=>['sushi','omelette-rice'].includes(recipe.family))){
    assert.equal(recipe.role,'staple',recipe.id);assert.equal(recipe.mealBase,true,recipe.id);assert.equal(recipe.staple,true,recipe.id);assert.equal(isCompleteMeal(recipe),true,recipe.id);
  }
  const sushi=get('sushi-salmon');assert.equal(recipePortion(sushi,data).amount,8);assert.equal(recipePortion(sushi,data).unit,'貫');
  assert.equal(quantityFromAmount(sushi,data,4),0.5);
  assert.equal(quantityFromAmount(get('sashimi-tuna'),data,150),1.5);
  assert.equal(quantityFromAmount(get('boiled-egg'),data,2),2);
});

test('寿司4貫を2人分買う場合、ご飯180gと刺身用サーモン100gに換算する',()=>{
  const recipe=describeRecipe(get('sushi-salmon').id,data);
  const item=itemFromRecipe(recipe,data,quantityFromAmount(recipe,data,4));
  const entries=[{id:'sushi-plan',date:'2026-11-12',meal:'dinner',status:'planned',items:[item],note:''}];
  const result=shoppingForEntries(entries,data,{from:'2026-11-12',to:'2026-11-12',servings:2,pantry:[]});
  close(result.items.find(part=>part.id==='rice').required,180);
  close(result.items.find(part=>part.id==='salmon_sashimi').required,100);
  close(result.items.find(part=>part.id==='vinegar').required,12);
});

test('刺身150gの記録では魚と添えしょうゆを1.5倍にして買い物へ渡す',()=>{
  const recipe=describeRecipe(get('sashimi-tuna').id,data);
  const item=itemFromRecipe(recipe,data,quantityFromAmount(recipe,data,150));
  const entries=[{id:'sashimi-plan',date:'2026-11-12',meal:'dinner',status:'planned',items:[item],note:''}];
  const result=shoppingForEntries(entries,data,{from:'2026-11-12',to:'2026-11-12',servings:2,pantry:[]});
  close(result.items.find(part=>part.id==='tuna_lean_sashimi').required,300);
  close(result.items.find(part=>part.id==='soy_sauce').required,18);
  const whole=itemNutrition(itemFromRecipe(recipe,data,1)),scaled=itemNutrition(item);
  for(const key of ['kcal','protein','fat','carbs','fiber','salt'])if(whole[key]!==null)close(scaled[key],whole[key]*1.5);
});

test('新しい可食部材料の栄養値に公式由来の出典を持ち、全74品を食事記録に写せる',()=>{
  for(const id of Object.keys(CLASSIC_MAIN_INGREDIENTS)){
    const metadata=INGREDIENT_NUTRITION[id];assert.ok(metadata,`${id}:栄養プロフィール`);
    assert.match(metadata.nutritionSource,/食品番号/,id);
    for(const key of ['kcal','protein','fat','carbs','fiber','salt'])assert.ok(metadata.nutritionPerUnit[key]===null||(Number.isFinite(metadata.nutritionPerUnit[key])&&metadata.nutritionPerUnit[key]>=0),`${id}/${key}`);
  }
  for(const recipe of CLASSIC_MAIN_RECIPES){
    const item=itemFromRecipe(describeRecipe(recipe.id,data),data);
    assert.ok(Number.isFinite(item.nutrition.kcal)&&item.nutrition.kcal>0,recipe.id);
    assert.ok(Number.isFinite(item.nutrition.protein)&&item.nutrition.protein>=0,recipe.id);
    assert.equal(item.allergensKnown,true,recipe.id);assert.equal(item.ingredientsKnown,true,recipe.id);
  }
});
