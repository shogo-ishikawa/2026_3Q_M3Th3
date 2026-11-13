import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {COMFORT_INGREDIENTS,COMFORT_RECIPES} from '../comfort-foods.js';
import {INGREDIENT_NUTRITION} from '../ingredient-nutrients.js';
import {describeRecipe,eligibleRecipes,GENRES,MOODS} from '../planner.js';
import {recipePortion,isCompleteMeal} from '../catalog.js';
import {dishClassification,dishSection,browseDishes} from '../dish-hierarchy.js';
import {createCatalogEntry} from '../record-actions.js';
import {recipeNutrition,itemNutrition} from '../nutrition.js';
import {shoppingForEntries} from '../shopping.js';
import {defaultJournal,parseJournal} from '../journal.js';

const ownIds=new Set(COMFORT_RECIPES.map(recipe=>recipe.id));
const data={allergens:ALLERGENS,ingredients:Object.fromEntries(Object.entries({...INGREDIENTS,...COMFORT_INGREDIENTS}).map(([id,ingredient])=>[id,{...ingredient,...INGREDIENT_NUTRITION[id]}])),recipes:[...RECIPES.filter(recipe=>!ownIds.has(recipe.id)),...COMFORT_RECIPES]};
const get=id=>COMFORT_RECIPES.find(recipe=>recipe.id===`comfort-${id}`);
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const entry=(id,amount)=>createCatalogEntry({recipeId:get(id).id,date:'2026-11-13',meal:'dinner',status:'planned',amount},data);

test('肉豆腐・もつ煮・ぼっかけ・そばめし・牛タンを既存の料理を保持して追加する',()=>{
  assert.equal(COMFORT_RECIPES.length,5);
  assert.equal(new Set(data.recipes.map(recipe=>recipe.id)).size,data.recipes.length);
  assert.equal(new Set(data.recipes.map(recipe=>recipe.name)).size,data.recipes.length);
  assert.deepEqual(COMFORT_RECIPES.map(recipe=>recipe.id),['comfort-nikudofu-pork','comfort-motsu-stew','comfort-bokkake','comfort-sobameshi','comfort-tongue-salt']);
  assert.ok(data.recipes.some(recipe=>recipe.id==='varied-beef-tongue-negi'));
  assert.ok(data.recipes.some(recipe=>recipe.name==='牛肉と豆腐のすき煮'));
});

test('家庭用の材料と6〜7工程を登録し、分量変更と二重になる絶対量は工程に埋め込まない',()=>{
  for(const recipe of COMFORT_RECIPES){
    assert.equal(recipe.nature,'home-cooked');assert.equal(recipe.servings,2);assert.ok(GENRES.includes(recipe.genre));
    assert.ok(recipe.steps.length>=6&&recipe.steps.length<=7,recipe.id);
    assert.equal(new Set(recipe.ingredients.map(part=>part.id)).size,recipe.ingredients.length);
    for(const part of recipe.ingredients){assert.ok(data.ingredients[part.id],`${recipe.id}/${part.id}`);assert.ok(Number.isFinite(part.amount)&&part.amount>0);}
    for(const step of recipe.steps){assert.ok(step.trim().length>=10);assert.ok(!/\d+\s*(?:g|ml|個|枚|皿|人分|つ)/.test(step),`${recipe.id}/${step}`);}
    assert.ok(recipe.tags.every(tag=>MOODS.includes(tag)));
    if(recipe.role==='staple')assert.deepEqual(recipe.tags,[]);
    else assert.equal(recipe.tags.includes('時短'),recipe.minutes<=20);
    for(const key of ['ingredientsKnown','allergensKnown','shoppingKnown'])assert.equal(recipe[key],true,recipe.id);
    assert.match(recipe.sourceNote,/家庭/);assert.doesNotThrow(()=>describeRecipe(recipe.id,data));
  }
  assert.match(get('motsu-stew').steps.join(' '),/生もつ.*手順ではない/);
  assert.match(get('motsu-stew').steps.join(' '),/75℃.*1分/);
  assert.match(get('motsu-stew').steps.join(' '),/浅い容器.*冷や/);
  assert.match(get('tongue-salt').steps.join(' '),/75℃.*1分/);
});

test('主菜4品は肉料理の調理法内へ置き、そばめしは主食を含む一皿にする',()=>{
  const expected={'nikudofu-pork':'simmer','motsu-stew':'stew',bokkake:'stew','tongue-salt':'grill'};
  for(const [id,method] of Object.entries(expected)){
    const recipe=get(id);assert.equal(dishSection(recipe),'main');
    assert.equal(dishClassification(recipe).category,'meat');assert.equal(dishClassification(recipe).method,method);
    assert.equal(isCompleteMeal(recipe),false);
  }
  assert.deepEqual(new Set(browseDishes(COMFORT_RECIPES,{section:'main',category:'meat',method:'stew'}).map(recipe=>recipe.id)),new Set([get('motsu-stew').id,get('bokkake').id]));
  assert.equal(dishSection(get('sobameshi')),'staple');assert.equal(get('sobameshi').family,'fried-rice');assert.equal(isCompleteMeal(get('sobameshi')),true);
  assert.equal(get('sobameshi').ingredients.filter(part=>part.id==='rice').length,1);
});

test('豚と牛の派生元・大豆・小麦をもつや牛すじ、調味料からも除外する',()=>{
  const candidates=settings=>new Set(eligibleRecipes(settings,data).map(recipe=>recipe.id));
  assert.ok(!candidates({excludedIngredients:['pork']}).has(get('motsu-stew').id));
  assert.ok(!candidates({allergens:['pork']}).has(get('nikudofu-pork').id));
  assert.ok(!candidates({allergens:['beef']}).has(get('bokkake').id));
  assert.ok(!candidates({excludedIngredients:['beef']}).has(get('tongue-salt').id));
  assert.ok(!candidates({allergens:['soy']}).has(get('motsu-stew').id));
  assert.ok(!candidates({allergens:['wheat']}).has(get('sobameshi').id));
  assert.ok(!candidates({allergens:['apple']}).has(get('sobameshi').id));
  assert.ok(candidates({allergens:['wheat']}).has(get('tongue-salt').id));
});

test('下ゆで済みの可食部成分を使い、牛すじの微量炭水化物は原表と概算を区別する',()=>{
  const expected={pork_small_intestine_boiled:{food:'11169',values:[159,14,11.9,0,0,0]},beef_tendon_boiled:{food:'11101',values:[157,31,5.1,null,0,0.2]}};
  const keys=['kcal','protein','fat','carbs','fiber','salt'];
  for(const [id,{food,values}] of Object.entries(expected)){
    assert.match(COMFORT_INGREDIENTS[id].name,/ゆで・味付けなし/);
    assert.match(COMFORT_INGREDIENTS[id].note,/下ゆで後/);
    assert.ok(INGREDIENT_NUTRITION[id],id);assert.ok(INGREDIENT_NUTRITION[id].nutritionSource.includes(`食品番号${food}`));
    keys.forEach((key,index)=>values[index]===null?assert.equal(INGREDIENT_NUTRITION[id].rawNutritionPerUnit[key],null):close(INGREDIENT_NUTRITION[id].nutritionPerUnit[key],values[index]/100));
  }
  const nutrition=recipeNutrition(get('bokkake'),data);
  close(INGREDIENT_NUTRITION.beef_tendon_boiled.nutritionPerUnit.carbs,0.0003);
  assert.ok(nutrition.carbs>0);assert.ok(nutrition.kcal>0);assert.ok(nutrition.protein>0);
});

test('ぼっかけ半皿を3人分へ換算し、下ゆで済み牛すじとこんにゃくを買い物へ反映する',()=>{
  assert.equal(recipePortion(get('bokkake'),data).unit,'皿');
  const list=shoppingForEntries([entry('bokkake',0.5)],data,{from:'2026-11-13',to:'2026-11-13',servings:3,pantry:[]});
  close(list.items.find(part=>part.id==='beef_tendon_boiled').required,187.5);
  close(list.items.find(part=>part.id==='konjac').required,135);
  assert.equal(list.missingMenus.length,0);
});

test('そばめしのご飯とめんを記録量から一度だけ換算する',()=>{
  const record=entry('sobameshi',1.5);
  const list=shoppingForEntries([record],data,{from:'2026-11-13',to:'2026-11-13',servings:2,pantry:[]});
  close(list.items.find(part=>part.id==='rice').required,450);
  close(list.items.find(part=>part.id==='yakisoba_noodles').required,270);
  assert.equal(record.items.length,1);assert.equal(list.missingMenus.length,0);
});

test('5品の量・材料・手順・概算栄養を記録に保存して復元できる',()=>{
  const state=defaultJournal('2026-11-13');
  state.entries=COMFORT_RECIPES.map(recipe=>createCatalogEntry({recipeId:recipe.id,date:'2026-11-13',meal:'dinner',status:'eaten',amount:0.75},data));
  const parsed=parseJournal(JSON.stringify(state),data);
  assert.deepEqual(parsed.entries,state.entries);
  for(const record of parsed.entries){
    assert.ok(record.items[0].steps.length>=6);
    assert.ok(Object.values(itemNutrition(record.items[0])).every(value=>value===null||Number.isFinite(value)&&value>=0));
  }
  close(parsed.entries.find(record=>record.items[0].recipeId===get('bokkake').id).items[0].nutrition.carbs,18.4583575);
});
