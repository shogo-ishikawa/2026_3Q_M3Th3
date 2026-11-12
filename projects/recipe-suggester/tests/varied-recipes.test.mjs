import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {VARIED_INGREDIENTS,VARIED_RECIPES} from '../varied-recipes.js';
import {INGREDIENT_NUTRITION} from '../ingredient-nutrients.js';
import {describeRecipe,eligibleRecipes,GENRES,MOODS} from '../planner.js';
import {recipePortion,quantityFromAmount,isCompleteMeal} from '../catalog.js';
import {dishClassification,dishSection,browseDishes} from '../dish-hierarchy.js';
import {createCatalogEntry} from '../record-actions.js';
import {itemNutrition} from '../nutrition.js';
import {shoppingForEntries} from '../shopping.js';
import {defaultJournal,parseJournal} from '../journal.js';

const ownIds=new Set(VARIED_RECIPES.map(recipe=>recipe.id));
const data={allergens:ALLERGENS,ingredients:Object.fromEntries(Object.entries({...INGREDIENTS,...VARIED_INGREDIENTS}).map(([id,ingredient])=>[id,{...ingredient,...INGREDIENT_NUTRITION[id]}])),recipes:[...RECIPES.filter(recipe=>!ownIds.has(recipe.id)),...VARIED_RECIPES]};
const get=id=>VARIED_RECIPES.find(recipe=>recipe.id===`varied-${id}`);
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const entry=(id,amount)=>createCatalogEntry({recipeId:get(id).id,date:'2026-11-13',meal:'dinner',status:'planned',amount},data);

test('定番45品を追加し、既存の餃子・シュウマイ・ねぎまを重複登録しない',()=>{
  assert.equal(VARIED_RECIPES.length,45);
  assert.equal(new Set(data.recipes.map(recipe=>recipe.id)).size,data.recipes.length);
  assert.equal(new Set(data.recipes.map(recipe=>recipe.name)).size,data.recipes.length);
  for(const name of ['焼き餃子','蒸しシュウマイ','焼き鳥（ねぎま）'])assert.ok(data.recipes.some(recipe=>recipe.name===name),name);
  for(const id of ['boiled-gyoza','spring-roll','shrimp-shumai','green-curry-rice','tandoori-chicken','beef-karubi','beef-tongue-negi','unadon','shrimp-tempura'])assert.ok(get(id),id);
  assert.deepEqual(Object.fromEntries(['main','staple','side','soup'].map(role=>[role,VARIED_RECIPES.filter(recipe=>recipe.role===role).length])),{main:30,staple:8,side:3,soup:4});
});

test('手作りの工程は包み方・火加減・仕上がりを記述し、材料の絶対量を二重に指示しない',()=>{
  const lengths=new Set();
  for(const recipe of VARIED_RECIPES){
    assert.equal(recipe.nature,'home-cooked');assert.equal(recipe.servings,2);assert.ok(GENRES.includes(recipe.genre),recipe.id);
    assert.ok(recipe.steps.length>=4&&recipe.steps.length<=9,recipe.id);lengths.add(recipe.steps.length);
    assert.equal(new Set(recipe.ingredients.map(part=>part.id)).size,recipe.ingredients.length,recipe.id);
    for(const part of recipe.ingredients){assert.ok(data.ingredients[part.id],`${recipe.id}/${part.id}`);assert.ok(Number.isFinite(part.amount)&&part.amount>0,recipe.id);}
    for(const step of recipe.steps){assert.ok(step.trim().length>=10,recipe.id);assert.ok(!/\d+\s*(?:g|ml|個|枚|皿|人分|つ)/.test(step),`${recipe.id}/${step}`);}
    assert.ok(recipe.tags.every(tag=>MOODS.includes(tag)),recipe.id);
    if(recipe.role==='staple')assert.deepEqual(recipe.tags,[],recipe.id);
    else assert.equal(recipe.tags.includes('時短'),recipe.minutes<=20,recipe.id);
    assert.equal(recipe.ingredientsKnown,true);assert.equal(recipe.allergensKnown,true);assert.match(recipe.sourceNote,/店舗|家庭/);
    assert.doesNotThrow(()=>describeRecipe(recipe.id,data),recipe.id);
  }
  assert.ok(lengths.size>=3);
  assert.match(get('spring-roll').steps.join(' '),/冷ま/);
  assert.match(get('spring-roll').steps.join(' '),/160〜170℃/);
  assert.match(get('shrimp-shumai').steps.join(' '),/蒸気/);
  assert.match(get('tandoori-chicken').steps.join(' '),/冷蔵庫で30分/);
  assert.match(get('tandoori-chicken').steps.join(' '),/200℃/);
});

test('主菜と副菜は食材→調理法の中に置き、天ぷらや焼き鳥を独立区分にしない',()=>{
  for(const recipe of VARIED_RECIPES){
    assert.equal(dishSection(recipe),recipe.role,recipe.id);
    if(['main','side'].includes(recipe.role)){
      const classification=dishClassification(recipe);
      assert.equal(classification.category,recipe.displayCategory,recipe.id);
      assert.equal(classification.method,recipe.displayMethod,recipe.id);
    }
  }
  const meatGrills=browseDishes(VARIED_RECIPES,{section:'main',category:'meat',method:'grill'});
  assert.ok(meatGrills.some(recipe=>recipe.id===get('yakitori-skin').id));
  assert.ok(meatGrills.some(recipe=>recipe.id===get('beef-tongue-negi').id));
  const fishFried=browseDishes(VARIED_RECIPES,{section:'main',category:'fish',method:'fried'});
  assert.ok(fishFried.some(recipe=>recipe.id===get('shrimp-tempura').id));
  assert.ok(!fishFried.some(recipe=>recipe.id===get('vegetable-tempura').id));
  assert.equal(dishClassification(get('vegetable-tempura')).category,'vegetable');
  assert.equal(dishClassification(get('shimeji-tempura')).category,'mushroom');
});

test('除外食材・小麦・乳・えび・卵・ごまを包み皮や付けだれからも引き継ぐ',()=>{
  const candidates=settings=>new Set(eligibleRecipes(settings,data).map(recipe=>recipe.id));
  assert.ok(!candidates({allergens:['wheat']}).has(get('spring-roll').id));
  assert.ok(!candidates({allergens:['shrimp']}).has(get('shrimp-shumai').id));
  assert.ok(!candidates({allergens:['milk']}).has(get('tandoori-chicken').id));
  assert.ok(!candidates({allergens:['sesame']}).has(get('beef-tongue-negi').id));
  assert.ok(!candidates({allergens:['egg']}).has(get('shrimp-tempura').id));
  assert.ok(candidates({allergens:['egg']}).has(get('kakiage').id));
  assert.ok(!candidates({excludedIngredients:['beef']}).has(get('beef-karubi').id));
  assert.ok(!candidates({excludedIngredients:['chicken']}).has(get('yakitori-skin').id));
  assert.ok(!candidates({excludedIngredients:['fish_sauce']}).has(get('green-curry-rice').id));
  assert.ok(candidates({allergens:[]}).has(get('unadon').id));
});

test('水餃子3個を2人分へ換算し、皮と肉だねを一度だけ買い物へ反映する',()=>{
  const recipe=get('boiled-gyoza');assert.deepEqual(recipePortion(recipe,data),{amount:5,unit:'個',label:recipe.portion.label});
  close(quantityFromAmount(recipe,data,3),0.6);
  const record=entry('boiled-gyoza',3),list=shoppingForEntries([record],data,{from:'2026-11-13',to:'2026-11-13',servings:2,pantry:[]}).items;
  close(list.find(part=>part.id==='dumpling_wrappers').required,48);
  close(list.find(part=>part.id==='pork_minced').required,132);
  assert.equal(record.items[0].portion.unit,'個');assert.equal(record.items[0].portion.amount,5);
});

test('焼き鳥1本と半量の丼を記録し、個数とご飯の二重計上を避ける',()=>{
  const skewer=get('yakitori-thigh-salt'),meal=get('unadon');
  close(quantityFromAmount(skewer,data,1),0.5);assert.equal(recipePortion(skewer,data).unit,'本');
  const skewers=shoppingForEntries([entry('yakitori-thigh-salt',1)],data,{from:'2026-11-13',to:'2026-11-13',servings:2,pantry:[]}).items;
  close(skewers.find(part=>part.id==='chicken').required,150);
  assert.equal(isCompleteMeal(meal),true);assert.equal(isCompleteMeal(get('eel-kabayaki')),false);
  for(const recipe of VARIED_RECIPES.filter(recipe=>recipe.role==='staple')){assert.equal(isCompleteMeal(recipe),true,recipe.id);assert.equal(recipe.staple,true,recipe.id);}
  const don=shoppingForEntries([entry('unadon',0.5)],data,{from:'2026-11-13',to:'2026-11-13',servings:2,pantry:[]}).items;
  close(don.find(part=>part.id==='rice').required,180);close(don.find(part=>part.id==='eel_shirayaki').required,100);
});

test('白焼きと蒲焼き・生うなぎを混同せず、揚げ油の推定と付けだれを明記する',()=>{
  assert.match(VARIED_INGREDIENTS.eel_shirayaki.name,/調理済み・無調味/);
  assert.match(get('eel-kabayaki').sourceNote,/生のうなぎを調理する手順ではありません/);
  for(const recipe of VARIED_RECIPES.filter(recipe=>recipe.ingredients.some(part=>part.id==='eel_shirayaki'))){
    assert.ok(recipe.ingredients.some(part=>part.id==='soy_sauce'),recipe.id);
    assert.ok(recipe.ingredients.some(part=>part.id==='mirin'),recipe.id);
  }
  for(const recipe of VARIED_RECIPES.filter(recipe=>recipe.displayMethod==='fried'))assert.match(recipe.sourceNote,/油.*残る量/);
  assert.match(get('beef-tongue-negi').steps.join(' '),/生の肉を漬け込むためには使わない/);
  assert.match(get('yakitori-skin').sourceNote,/落ちた脂/);
});

test('全新メニューを保存往復し、当時の工程・量・栄養スナップショットを保持する',()=>{
  const state=defaultJournal('2026-11-13');
  state.entries=VARIED_RECIPES.map(recipe=>createCatalogEntry({recipeId:recipe.id,date:'2026-11-13',meal:'dinner',status:'eaten',amount:recipePortion(recipe,data).amount*0.75},data));
  const parsed=parseJournal(JSON.stringify(state),data);
  assert.deepEqual(parsed.entries,state.entries);
  for(const record of parsed.entries){
    const nutrition=itemNutrition(record.items[0]);
    assert.ok(Object.values(nutrition).every(value=>value===null||Number.isFinite(value)&&value>=0));
    assert.ok(record.items[0].steps.length>=4);
  }
  for(const id of Object.keys(VARIED_INGREDIENTS)){assert.ok(INGREDIENT_NUTRITION[id],id);assert.match(INGREDIENT_NUTRITION[id].nutritionSource,/食品番号/,id);}
});
