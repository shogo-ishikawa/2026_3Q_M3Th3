import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {FAMILIAR_MAIN_INGREDIENTS,FAMILIAR_MAIN_RECIPES} from '../familiar-mains.js';
import {INGREDIENT_NUTRITION} from '../ingredient-nutrients.js';
import {FOOD_CATEGORIES,COOKING_METHODS,dishClassification,dishSection,browseDishes} from '../dish-hierarchy.js';
import {describeRecipe,eligibleRecipes,GENRES,MOODS} from '../planner.js';
import {isCompleteMeal,recipePortion,quantityFromAmount} from '../catalog.js';
import {itemFromRecipe,itemNutrition} from '../nutrition.js';
import {shoppingForEntries} from '../shopping.js';
const ownIds=new Set(FAMILIAR_MAIN_RECIPES.map(recipe=>recipe.id));
const data={allergens:ALLERGENS,ingredients:Object.fromEntries(Object.entries({...INGREDIENTS,...FAMILIAR_MAIN_INGREDIENTS}).map(([id,ingredient])=>[id,{...ingredient,...INGREDIENT_NUTRITION[id]}])),recipes:[...RECIPES.filter(recipe=>!ownIds.has(recipe.id)),...FAMILIAR_MAIN_RECIPES]};
const get=id=>FAMILIAR_MAIN_RECIPES.find(recipe=>recipe.id===`familiar-${id}`);
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-7,`${actual} != ${expected}`);

test('既存の普通のハンバーグや中華丼を再利用し、不足していた定番50品だけを加える',()=>{
  assert.equal(FAMILIAR_MAIN_RECIPES.length,50);
  assert.equal(new Set(data.recipes.map(recipe=>recipe.id)).size,data.recipes.length);
  assert.equal(new Set(data.recipes.map(recipe=>recipe.name)).size,data.recipes.length);
  assert.ok(data.recipes.some(recipe=>recipe.id==='classic-hamburg'));
  assert.ok(data.recipes.some(recipe=>recipe.id==='daily-donburi-chinese'));
  assert.ok(!FAMILIAR_MAIN_RECIPES.some(recipe=>recipe.name==='ハンバーグ'||recipe.name==='中華丼'));
  for(const name of ['カツ丼','天丼','天津飯','エビフライ','ぶり大根','かれいの煮付け','ビーフシチュー','水炊き','すき焼き','肉野菜炒め','焼き鳥（ねぎま）'])assert.ok(FAMILIAR_MAIN_RECIPES.some(recipe=>recipe.name===name),name);
});

test('全50品の分量・手順・確認情報・気分タグを既存データと同じ規約にする',()=>{
  for(const recipe of FAMILIAR_MAIN_RECIPES){
    assert.equal(recipe.servings,2,recipe.id);assert.ok(recipe.minutes>0,recipe.id);assert.ok(GENRES.includes(recipe.genre),recipe.id);
    assert.equal(recipe.nature,'home-cooked');assert.ok(recipe.sourceNote&&recipe.variantLabel,recipe.id);
    assert.ok(recipe.steps.length>=3,recipe.id);
    assert.equal(new Set(recipe.ingredients.map(part=>part.id)).size,recipe.ingredients.length,recipe.id);
    for(const part of recipe.ingredients){assert.ok(data.ingredients[part.id],`${recipe.id}/${part.id}`);assert.ok(Number.isFinite(part.amount)&&part.amount>0,recipe.id);}
    for(const step of recipe.steps){assert.ok(typeof step==='string'&&step.trim(),recipe.id);assert.ok(!/\d+\s*(?:g|ml|個|枚|皿|人分|つ)/.test(step),`${recipe.id}/${step}`);}
    assert.equal(recipePortion(recipe,data).amount,1,recipe.id);assert.equal(recipePortion(recipe,data).unit,'皿',recipe.id);
    assert.ok(recipe.tags.every(tag=>MOODS.includes(tag)&&tag!=='all'),recipe.id);
    if(recipe.role==='main'){assert.equal(recipe.tags.includes('時短'),recipe.minutes<=20,recipe.id);assert.equal(recipe.mealBase,false,recipe.id);}
    else {assert.deepEqual(recipe.tags,[],recipe.id);assert.equal(recipe.staple,true,recipe.id);assert.equal(isCompleteMeal(recipe),true,recipe.id);}
    const item=itemFromRecipe(describeRecipe(recipe.id,data),data);assert.equal(item.allergensKnown,true,recipe.id);assert.equal(item.ingredientsKnown,true,recipe.id);
  }
  assert.equal(FAMILIAR_MAIN_RECIPES.filter(recipe=>recipe.role==='main').length,37);
  assert.equal(FAMILIAR_MAIN_RECIPES.filter(recipe=>recipe.role==='staple').length,13);
});

test('ムニエル3品は魚に小麦粉をまぶしてバターで焼き、フライと区別する',()=>{
  const meals=FAMILIAR_MAIN_RECIPES.filter(recipe=>recipe.displayMethod==='meuniere');assert.equal(meals.length,3);
  for(const recipe of meals){
    assert.equal(recipe.displayCategory,'fish',recipe.id);
    assert.ok(recipe.ingredients.some(part=>part.id==='flour'&&part.amount>0));assert.ok(recipe.ingredients.some(part=>part.id==='butter'&&part.amount>0));
    assert.ok(!recipe.ingredients.some(part=>part.id==='breadcrumbs'));assert.ok(recipe.steps.some(step=>/薄力粉/.test(step)));
    assert.ok(recipe.steps.some(step=>/バター/.test(step)));assert.equal(dishClassification(recipe).method,'meuniere');
  }
  assert.equal(dishClassification(get('shrimp-fry')).method,'fried');assert.equal(dishClassification(get('shrimp-fry')).methodDetail,'cutlet');assert.equal(dishClassification(get('shrimp-fry')).category,'fish');
});

test('鍋9品と煮込みを表示用metadataで整理し、混合料理を他の材料からも探せる',()=>{
  const categories=new Set(FOOD_CATEGORIES.map(category=>category.id)),methods=new Set([...COOKING_METHODS.map(method=>method.id),'karaage','cutlet','croquette','fry']);
  for(const recipe of FAMILIAR_MAIN_RECIPES){
    assert.ok(categories.has(recipe.displayCategory),recipe.id);assert.ok(methods.has(recipe.displayMethod),recipe.id);
    assert.equal(new Set(recipe.displaySecondaryCategories).size,recipe.displaySecondaryCategories.length,recipe.id);
    assert.ok(recipe.displaySecondaryCategories.every(category=>categories.has(category)&&category!==recipe.displayCategory),recipe.id);
    assert.equal(dishSection(recipe),recipe.role,recipe.id);
  }
  const pots=browseDishes(FAMILIAR_MAIN_RECIPES,{section:'main',method:'hotpot'});assert.equal(pots.length,9);
  assert.ok(pots.some(recipe=>recipe.id===get('sukiyaki').id));assert.ok(pots.every(recipe=>recipe.mealBase===false));
  assert.equal(dishClassification(get('happosai')).category,'vegetable');assert.ok(dishClassification(get('happosai')).secondaryCategories.includes('fish'));
  assert.equal(dishClassification(get('mapo-aubergine')).category,'vegetable');assert.ok(dishClassification(get('mapo-aubergine')).secondaryCategories.includes('meat'));
  assert.equal(dishClassification(get('beef-stew')).method,'stew');assert.equal(dishClassification(get('flounder-simmer')).method,'simmer');
  const fromBeans=browseDishes(FAMILIAR_MAIN_RECIPES,{section:'main',category:'bean',method:'hotpot'});assert.ok(fromBeans.some(recipe=>recipe.id===get('sukiyaki').id));
});

test('カツ丼とロコモコは衣・肉だね・卵料理に使う卵を重複材料なしで合算する',()=>{
  for(const id of ['katsudon','loco-moco'])assert.equal(get(id).ingredients.find(part=>part.id==='egg').amount,3,id);
  assert.match(get('katsudon').steps[0],/卵の一部/);assert.match(get('loco-moco').steps[0],/卵の一部/);
  assert.match(get('loco-moco').steps[1],/残りの卵/);
});

test('小麦・乳・えび・大豆や派生肉の除外を新しい定番にも適用する',()=>{
  const candidates=allergens=>new Set(eligibleRecipes({allergens},data).map(recipe=>recipe.id));
  assert.ok(!candidates(['wheat']).has(get('salmon-meuniere').id));assert.ok(!candidates(['milk']).has(get('cod-meuniere').id));
  assert.ok(!candidates(['shrimp']).has(get('shrimp-fry').id));assert.ok(!candidates(['soy']).has(get('yudofu').id));
  assert.ok(candidates(['milk','egg']).has(get('buri-daikon').id));
  const noPork=new Set(eligibleRecipes({excludedIngredients:['pork']},data).map(recipe=>recipe.id));assert.ok(!noPork.has(get('pork-kakuni').id));
  const noBeef=new Set(eligibleRecipes({excludedIngredients:['beef']},data).map(recipe=>recipe.id));assert.ok(!noBeef.has(get('beef-stew').id));
});

test('鍋を半皿ずつ2人分作ると、元レシピの材料の半量を買い物へ反映する',()=>{
  const recipe=describeRecipe(get('sukiyaki').id,data),item=itemFromRecipe(recipe,data,quantityFromAmount(recipe,data,0.5));
  const entries=[{id:'pot-half',date:'2026-11-12',meal:'dinner',status:'planned',items:[item],note:''}];
  const result=shoppingForEntries(entries,data,{from:'2026-11-12',to:'2026-11-12',servings:2,pantry:[]});
  close(result.items.find(part=>part.id==='beef').required,140);close(result.items.find(part=>part.id==='shirataki').required,90);close(result.items.find(part=>part.id==='egg').required,1);
  const whole=itemNutrition(itemFromRecipe(recipe,data,1)),half=itemNutrition(item);
  for(const key of ['kcal','protein','fat','carbs','fiber','salt'])if(whole[key]!==null)close(half[key],whole[key]/2);
});

test('新5材料に出典を付け、魚の骨や豚角煮の脂の流出を栄養計算で断定しない',()=>{
  assert.equal(Object.keys(FAMILIAR_MAIN_INGREDIENTS).length,5);
  for(const id of Object.keys(FAMILIAR_MAIN_INGREDIENTS)){
    const meta=INGREDIENT_NUTRITION[id];assert.ok(meta,id);assert.match(meta.nutritionSource,/食品番号/,id);
    for(const value of Object.values(meta.nutritionPerUnit))assert.ok(value===null||(Number.isFinite(value)&&value>=0),id);
  }
  assert.match(FAMILIAR_MAIN_INGREDIENTS.flounder.name,/可食部/);assert.match(get('pork-kakuni').sourceNote,/脂の流出/);
  assert.notEqual(FAMILIAR_MAIN_INGREDIENTS.yellowtail,INGREDIENTS.yellowtail_sashimi);
  for(const recipe of FAMILIAR_MAIN_RECIPES){const item=itemFromRecipe(describeRecipe(recipe.id,data),data);assert.ok(Number.isFinite(item.nutrition.kcal)&&item.nutrition.kcal>0,recipe.id);assert.ok(Number.isFinite(item.nutrition.protein)&&item.nutrition.protein>=0,recipe.id);}
});

test('水炊きの付けだれと締めを鍋の煮汁や基準材料に混同しない',()=>{
  const mizutaki=get('mizutaki');assert.match(mizutaki.steps[0],/別の器/);assert.match(mizutaki.steps[2],/付けだれ/);
  assert.ok(!mizutaki.ingredients.some(part=>['rice','udon','ramen_noodles'].includes(part.id)));
  assert.match(mizutaki.sourceNote,/締めは含みません/);assert.match(get('yose-nabe').sourceNote,/汁を残した量は補正していません/);
});
