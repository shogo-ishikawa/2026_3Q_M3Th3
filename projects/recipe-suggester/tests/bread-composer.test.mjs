import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {BREAD_INGREDIENTS,BREAD_RECIPES,BREAD_PRESETS} from '../bread-foods.js';
import {FOOD_COMPOSERS,foodComposerFor,foodComposerDefinition,foodPresetSelection,defaultFoodSelection,matchingFoodPreset,availableFoodPresets,buildFoodSelection,eligibleFoodSelection} from '../food-composer.js';
import {recipeNutrition,itemFromRecipe,itemNutrition} from '../nutrition.js';
const data={allergens:ALLERGENS,ingredients:{...INGREDIENTS,...BREAD_INGREDIENTS},recipes:[...new Map([...RECIPES,...BREAD_RECIPES].map(r=>[r.id,r])).values()]};
const amount=(r,id)=>r.ingredients.find(p=>p.id===id)?.amount??0;
const near=(a,b,label='')=>assert.ok(Math.abs(a-b)<1e-8,`${label} ${a} != ${b}`);
const compare=(actual,expected)=>{
 const keys=new Set([...actual.ingredients,...expected.ingredients].map(p=>p.id));
 for(const id of keys)near(amount(actual,id),amount(expected,id)/expected.servings,id);
 const nutrition=recipeNutrition(expected,data);
 for(const key of Object.keys(nutrition))nutrition[key]===null?assert.equal(actual.manualNutrition[key],null):near(actual.manualNutrition[key],nutrition[key],key);
};

test('標準の組み合わせを選ぶと、新規レシピと同じ1人分の材料・栄養を作る',()=>{
 for(const [kind,presets] of Object.entries(BREAD_PRESETS))for(const preset of presets){
  const source=data.recipes.find(r=>r.id===preset.recipeId);assert.ok(source,preset.recipeId);
  const config=foodPresetSelection(kind,preset.id),built=buildFoodSelection(config,data);
  compare(built,source);assert.equal(foodComposerFor(source.id).kind,kind);
  assert.equal(matchingFoodPreset(kind,config).id,preset.id);
 }
 assert.equal(BREAD_RECIPES.length,29);
 assert.equal(BREAD_PRESETS['hot-sandwich'].filter(p=>!p.custom).length,10);
});

test('既存のホットサンド・トーストから開いても材料と栄養を変えない',()=>{
 for(const id of ['chicken-sandwich','breakfast-egg-sandwich','staple-butter-toast','staple-cheese-toast','staple-garlic-toast','staple-sesame-toast','staple-avocado-toast']){
  const kind=foodComposerFor(id).kind,source=data.recipes.find(r=>r.id===id);
  compare(buildFoodSelection(defaultFoodSelection(kind,{recipeId:id}),data),source);
 }
});

test('パンだけの入口から始め、具材やソースを一から選べる',()=>{
 for(const kind of ['english-muffin','sandwich','hot-sandwich','toast']){
  const config=foodPresetSelection(kind,'custom'),plain=buildFoodSelection(config,data);
  assert.equal(config.components.length,1);assert.equal(plain.ingredients.length,1);
  const bread=kind==='english-muffin'?'palette_english_muffin':'bread';near(amount(plain,bread),60);
  const filled=buildFoodSelection({...config,components:[...config.components,{id:'tomato',amount:31.5}]},data);
  near(amount(filled,'tomato'),31.5);assert.equal(amount(plain,'tomato'),0);
  assert.ok(filled.manualNutrition.kcal>plain.manualNutrition.kcal);
 }
});

test('ソーセージエッグは肉・卵・油をそれぞれ一度だけ数え、具を外すと差し引く',()=>{
 const config=foodPresetSelection('english-muffin','sausage-egg-cheese'),full=buildFoodSelection(config,data);
 near(amount(full,'palette_english_muffin'),60);near(amount(full,'pork_minced'),45);near(amount(full,'egg'),1);near(amount(full,'oil'),2);near(amount(full,'cheese'),15);near(amount(full,'salt'),.35);
 const withoutEgg=buildFoodSelection({...config,components:config.components.filter(p=>p.id!=='fried-egg')},data);
 near(amount(withoutEgg,'egg'),0);near(amount(withoutEgg,'oil'),1);
 const egg=recipeNutrition({servings:1,ingredients:[{id:'egg',amount:1},{id:'oil',amount:1}]},data);
 for(const key of Object.keys(egg))near(full.manualNutrition[key]-withoutEgg.manualNutrition[key],egg[key],key);
 assert.ok(full.steps.some(s=>s.includes('ソーセージパティ')&&s.includes('75℃')));
});

test('ピザトーストは食パンで作り、ジャムとピーナッツは製品g数から加算する',()=>{
 const pizza=buildFoodSelection(foodPresetSelection('toast','pizza'),data);
 near(amount(pizza,'bread'),60);near(amount(pizza,'pizza_base'),0);near(amount(pizza,'bread_ketchup'),16);near(amount(pizza,'tomato_paste'),4);
 const jam=buildFoodSelection(foodPresetSelection('toast','jam-butter'),data),base=buildFoodSelection(foodPresetSelection('toast','butter'),data);
 near(amount(jam,'bread_strawberry_jam'),15);near(jam.manualNutrition.kcal-base.manualNutrition.kcal,37.5);
 const peanut=buildFoodSelection(foodPresetSelection('toast','peanut-butter'),data);
 assert.ok(peanut.allergens.includes('peanut'));assert.equal(peanut.ingredientsKnown,false);assert.equal(peanut.allergensKnown,false);
 assert.ok(!eligibleFoodSelection('toast',{allergens:['peanut']},data,{recipeId:'bread-toast-peanut-butter'})?.recipe.allergens.includes('peanut'));
});

test('標準配列を共有せず、確定後の記録・栄養は再選択で変えない',()=>{
 const first=foodPresetSelection('hot-sandwich','tuna-melt'),one=buildFoodSelection(first,data),snapshot=itemFromRecipe(one,data,.5),saved=JSON.stringify(snapshot);
 first.components[0].amount=999;
 assert.equal(foodPresetSelection('hot-sandwich','tuna-melt').components[0].amount,1);
 assert.ok(Object.isFrozen(FOOD_COMPOSERS));assert.ok(Object.isFrozen(foodComposerDefinition('toast').presets));
 buildFoodSelection(foodPresetSelection('hot-sandwich','custom'),data);
 assert.equal(JSON.stringify(snapshot),saved);near(itemNutrition(snapshot).kcal,one.manualNutrition.kcal*.5);
 assert.throws(()=>foodPresetSelection('toast','unknown'),/組み合わせ/);
 const missing={...data,ingredients:Object.fromEntries(Object.entries(data.ingredients).filter(([id])=>id!=='bread_peanut_butter'))};
 assert.ok(!availableFoodPresets('toast',missing).some(p=>p.id==='peanut-butter'));
});

test('代表商品のハム・ベーコンは原材料の未確認状態を選択後も保持する',()=>{
 for(const [kind,preset] of [['sandwich','ham-lettuce'],['sandwich','ham-cheese'],['hot-sandwich','ham-cheese'],['hot-sandwich','bacon-egg']]){
  const made=buildFoodSelection(foodPresetSelection(kind,preset),data);
  assert.equal(made.ingredientsKnown,false,`${kind} ${preset}`);assert.equal(made.allergensKnown,false);assert.equal(made.shoppingKnown,true);
 }
 const plain=buildFoodSelection(foodPresetSelection('sandwich','custom'),data);
 assert.equal(plain.ingredientsKnown,true);
});
