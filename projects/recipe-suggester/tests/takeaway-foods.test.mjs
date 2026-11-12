import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {INGREDIENT_NUTRITION} from '../ingredient-nutrients.js';
import {TAKEAWAY_INGREDIENTS,TAKEAWAY_RECIPES} from '../takeaway-foods.js';
import {recipeFamily,recipeNature,recipePortion,quantityFromAmount} from '../catalog.js';
import {dishClassification} from '../dish-hierarchy.js';
import {describeRecipe,eligibleRecipes} from '../planner.js';
import {itemFromRecipe,itemNutrition,recipeNutrition,NUTRIENT_KEYS} from '../nutrition.js';
import {shoppingForEntries} from '../shopping.js';
import {defaultJournal,parseJournal} from '../journal.js';

const ownIds=new Set(TAKEAWAY_RECIPES.map(r=>r.id));
const data={allergens:ALLERGENS,
  ingredients:Object.fromEntries(Object.entries({...INGREDIENTS,...TAKEAWAY_INGREDIENTS}).map(([id,ingredient])=>[id,{...ingredient,...INGREDIENT_NUTRITION[id]}])),
  recipes:[...RECIPES.filter(r=>!ownIds.has(r.id)),...TAKEAWAY_RECIPES]};
const get=slug=>TAKEAWAY_RECIPES.find(r=>r.id===`takeaway-${slug}`);
const close=(a,b)=>assert.ok(typeof a==='number'&&Math.abs(a-b)<1e-8,`${a} != ${b}`);
const item=(slug,amount)=>{const r=get(slug);return itemFromRecipe(describeRecipe(r.id,data),data,quantityFromAmount(r,data,amount));};
const planned=(items)=>[{id:'takeaway-plan',date:'2026-11-13',meal:'dinner',status:'planned',items,note:''}];

test('即席の春雨5品・ポタージュ6品と惣菜等28品に出典と実用単位を持たせる',()=>{
  assert.equal(TAKEAWAY_RECIPES.length,28);assert.equal(Object.keys(TAKEAWAY_INGREDIENTS).length,28);
  assert.equal(TAKEAWAY_RECIPES.filter(r=>r.id.startsWith('takeaway-harusame-')).length,5);
  assert.equal(TAKEAWAY_RECIPES.filter(r=>r.id.startsWith('takeaway-knorr-')).length,6);
  assert.equal(new Set(data.recipes.map(r=>r.id)).size,data.recipes.length);
  assert.equal(new Set(data.recipes.map(r=>r.name)).size,data.recipes.length);
  for(const r of TAKEAWAY_RECIPES){
    assert.equal(r.servings,2,r.id);assert.deepEqual(r.steps,[],r.id);
    assert.ok(['instant','ready-to-eat'].includes(recipeNature(r)),r.id);
    assert.match(r.sourceNote,/2026-11-13/,r.id);assert.match(r.sourceNote,/https:\/\//,r.id);
    assert.ok(r.sourceNote.length<=2000,r.id);
    for(const part of r.ingredients){assert.ok(data.ingredients[part.id],`${r.id}/${part.id}`);assert.ok(part.amount>0,r.id);}
    assert.doesNotThrow(()=>recipePortion(r,data),r.id);assert.doesNotThrow(()=>recipeFamily(r),r.id);
  }
});

test('惣菜を肉・魚介・きのこの主菜副菜へ配置し、単品とご飯込みを区別する',()=>{
  assert.equal(dishClassification(get('shumai'),data).category,'meat');
  assert.equal(dishClassification(get('shumai'),data).method,'steam');
  assert.equal(dishClassification(get('spring-roll'),data).method,'fried');
  assert.equal(dishClassification(get('tempura-shrimp'),data).category,'fish');
  assert.equal(dishClassification(get('tempura-maitake'),data).section,'side');
  assert.equal(dishClassification(get('tempura-maitake'),data).category,'mushroom');
  assert.equal(get('unaju').mealBase,true);assert.equal(recipeFamily(get('unaju')),'donburi');
  assert.equal(get('eel-kabayaki').mealBase,false);
});

test('原材料の登録が不完全な購入品を自動献立へ混ぜない',()=>{
  const choices=new Set(eligibleRecipes({},data).map(r=>r.id));
  for(const r of TAKEAWAY_RECIPES){
    assert.equal(r.allergensKnown,false);assert.equal(r.ingredientsKnown,false);assert.equal(r.shoppingKnown,true);
    assert.ok(!choices.has(r.id),r.id);
  }
});

test('春雨スープ2杯の栄養と製品・湯を一度だけ換算する',()=>{
  const wonton=item('harusame-wonton',2);close(itemNutrition(wonton).kcal,156);close(itemNutrition(wonton).salt,4.2);
  close(recipeNutrition(get('harusame-wakame-vegetable'),data).kcal,72);
  close(recipeNutrition(get('harusame-wakame-vegetable'),data).fiber,.9);
  const shopping=shoppingForEntries(planned([wonton]),data,{from:'2026-11-13',to:'2026-11-13',servings:2,pantry:[]});
  close(shopping.items.find(i=>i.id==='takeaway_harusame_wonton').required,4);
  close(shopping.items.find(i=>i.id==='water').required,880);
  assert.ok(!shopping.items.some(i=>i.id==='harusame'));
});

test('即席ポタージュは小袋単位で集計し、未表示の食物繊維を0へしない',()=>{
  const half=item('knorr-potage',.5);close(itemNutrition(half).kcal,34.5);close(itemNutrition(half).salt,.6);
  assert.equal(itemNutrition(half).fiber,null);
  close(recipeNutrition(get('knorr-corn'),data).kcal,80);
  close(recipeNutrition(get('knorr-pumpkin'),data).kcal,82);
  const shopping=shoppingForEntries(planned([half]),data,{from:'2026-11-13',to:'2026-11-13',servings:2,pantry:[]});
  close(shopping.items.find(i=>i.id==='takeaway_knorr_potage').required,1);
  assert.equal(shopping.items.find(i=>i.id==='takeaway_knorr_potage').unit,'袋');
});

test('トマトジュースは200ml表示を100mlへ換算し、範囲の塩分と繊維を不明に保つ',()=>{
  for(const slug of ['tomato-unsalted','tomato-low-salt']){
    const half=item(slug,100);close(itemNutrition(half).kcal,19.5);close(itemNutrition(half).protein,.9);
    assert.equal(itemNutrition(half).fat,0);assert.equal(itemNutrition(half).salt,null);assert.equal(itemNutrition(half).fiber,null);
  }
  const shopping=shoppingForEntries(planned([item('tomato-unsalted',100)]),data,{from:'2026-11-13',to:'2026-11-13',servings:2,pantry:[]});
  close(shopping.items.find(i=>i.id==='takeaway_tomato_unsalted').required,200);
});

test('本数や袋の端数を完成品の購入量へ渡し、加熱前の食材へ分解しない',()=>{
  close(itemNutrition(item('yakitori-momo-tare',3)).kcal,282);
  close(itemNutrition(item('shumai',6)).kcal,192);
  close(itemNutrition(item('beef-karubi',.5)).kcal,113);
  const shopping=shoppingForEntries(planned([item('frozen-suigyoza',6),item('tempura-shrimp',3)]),data,{from:'2026-11-13',to:'2026-11-13',servings:2,pantry:[]});
  close(shopping.items.find(i=>i.id==='takeaway_frozen_suigyoza').required,1);
  close(shopping.items.find(i=>i.id==='takeaway_tempura_shrimp').required,6);
  assert.ok(!shopping.items.some(i=>['pork_minced','flour','shrimp','rice'].includes(i.id)));
  assert.equal(shopping.missingMenus.length,2);
});

test('公式未掲載と数値0を区別し、空手順と量をv3記録へ保存する',()=>{
  assert.deepEqual(recipeNutrition(get('frozen-suigyoza'),data),Object.fromEntries(NUTRIENT_KEYS.map(key=>[key,null])));
  assert.equal(recipeNutrition(get('tempura-maitake'),data).salt,0);
  for(const id of Object.keys(TAKEAWAY_INGREDIENTS)){
    assert.deepEqual(data.ingredients[id].nutritionPerUnit,Object.fromEntries(NUTRIENT_KEYS.map(key=>[key,null])),id);
    assert.match(data.ingredients[id].nutritionSource,/https:\/\//,id);
  }
  const journal=defaultJournal();journal.entries=[{...planned([item('spring-roll',2)])[0],status:'eaten'}];
  const restored=parseJournal(JSON.stringify(journal),data).entries[0].items[0];
  assert.deepEqual(restored.steps,[]);assert.equal(restored.quantity,2);assert.equal(restored.nutrition.kcal,131);
  assert.equal(restored.allergensKnown,false);assert.equal(restored.ingredientsKnown,false);assert.equal(restored.shoppingKnown,true);
  assert.equal(restored.sourceNote,journal.entries[0].items[0].sourceNote);
});
