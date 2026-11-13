import test from 'node:test';
import assert from 'node:assert/strict';
import {CANTEEN_INGREDIENTS,CANTEEN_NUTRITION,CANTEEN_RECIPES} from '../canteen-foods.js';
import {SIMMERED_INGREDIENTS,SIMMERED_NUTRITION} from '../simmered-foods.js';
import {INGREDIENTS,ALLERGENS,RECIPES} from '../data.js';
import {recipeNutrition,itemNutrition,itemFromRecipe,NUTRIENT_KEYS} from '../nutrition.js';
import {eligibleRecipes,describeRecipe} from '../planner.js';
import {createCatalogEntry} from '../record-actions.js';
import {shoppingForEntries} from '../shopping.js';
import {defaultJournal,parseJournal} from '../journal.js';
import {dishClassification} from '../dish-hierarchy.js';
import {recipePortion} from '../catalog.js';

const additions={...SIMMERED_INGREDIENTS,...CANTEEN_INGREDIENTS},profiles={...SIMMERED_NUTRITION,...CANTEEN_NUTRITION};
const ingredients={...INGREDIENTS,...Object.fromEntries(Object.entries(additions).map(([id,item])=>[id,{...item,...profiles[id]}]))};
const data={ingredients,recipes:CANTEEN_RECIPES,allergens:ALLERGENS};
const recipe=id=>{const result=CANTEEN_RECIPES.find(r=>r.id===`canteen-${id}`);assert.ok(result,id);return result;};
const near=(a,b)=>assert.ok(Number.isFinite(a)&&Math.abs(a-b)<1e-7,`${a} != ${b}`);
const date='2026-11-13';

test('弁当・定食から選んだ16料理は独立した2人分の主菜・副菜で具体的な手順と栄養を持つ',()=>{
  assert.equal(CANTEEN_RECIPES.length,16);
  assert.equal(new Set(CANTEEN_RECIPES.map(r=>r.id)).size,16);
  assert.equal(new Set(CANTEEN_RECIPES.map(r=>r.name)).size,16);
  const old=RECIPES.filter(r=>!r.id.startsWith('canteen-'));
  for(const r of CANTEEN_RECIPES){
    assert.ok(!old.some(o=>o.id===r.id||o.name===r.name),r.id);
    assert.equal(r.servings,2);assert.equal(r.nature,'home-cooked');assert.equal(r.staple,false);assert.equal(r.mealBase,false);
    assert.ok(['main','side'].includes(r.role));assert.equal(r.ingredients.length,new Set(r.ingredients.map(p=>p.id)).size);
    assert.ok(r.ingredients.every(p=>ingredients[p.id]&&p.amount>0),r.id);
    assert.ok(r.steps.length>=4,r.id);
    assert.ok(r.steps.every(s=>s.length>=10&&!/\d+\s*(?:g|ml|個|枚|皿|人分|つ)/.test(s)),r.id);
    assert.ok(!r.ingredients.some(p=>p.id==='rice'),r.id);
    assert.equal(recipePortion(r,data).unit,'皿');
    assert.equal(dishClassification(r).section,r.role);
    const described=describeRecipe(r.id,data);assert.ok(described.ingredientsKnown&&described.allergensKnown);
    for(const key of NUTRIENT_KEYS)assert.ok(Number.isFinite(recipeNutrition(r,data)[key]),`${r.id}.${key}`);
    assert.match(r.sourceNote,/家庭向け配合|家庭用配合|家庭向けの配合/);
    assert.match(r.sourceNote,/商品栄養値の再現ではありません/);
    assert.ok(r.tags.includes('時短')===(r.minutes<=20));
  }
});

test('黒酢と青のりは一次資料の100g値を一度だけg単位へ換算する',()=>{
  assert.deepEqual(Object.keys(CANTEEN_INGREDIENTS),Object.keys(CANTEEN_NUTRITION));
  for(const [id,p]of Object.entries(CANTEEN_NUTRITION)){
    assert.equal(p.gramsPerUnit,1);assert.deepEqual(p.estimatedNutrients,[]);
    assert.match(p.nutritionSource,/https:\/\//);assert.ok(Object.isFrozen(p.nutritionPerUnit));
    assert.deepEqual(p.nutritionPerUnit,p.rawNutritionPerUnit);
  }
  const v=recipeNutrition({servings:1,ingredients:[{id:'canteen_black_vinegar',amount:100}]},data);
  near(v.kcal,46);near(v.protein,1.1);near(v.carbs,11.4);near(v.fiber,0);near(v.salt,0);
  const n=recipeNutrition({servings:1,ingredients:[{id:'canteen_aonori',amount:100}]},data);
  near(n.kcal,249);near(n.fiber,35.2);near(n.salt,8.1);
});

test('柚子胡椒3料理は使ったg数の食塩を加え、鶏むねと皮付きももを混同しない',()=>{
  for(const id of ['chicken-yuzu-grill','chicken-mushroom-yuzu-steam','chicken-avocado-yuzu-salad']){
    const r=recipe(id),part=r.ingredients.find(p=>p.id==='simmered_yuzu_kosho');assert.ok(part);
    const noYuzu=recipeNutrition({...r,ingredients:r.ingredients.filter(p=>p!==part)},data);
    const n=recipeNutrition(r,data);near(n.salt-noYuzu.salt,part.amount/2*.13);
    assert.match(r.steps.join(' '),/75℃で1分以上/);
  }
  assert.ok(recipe('chicken-yuzu-grill').ingredients.some(p=>p.id==='chicken'));
  assert.ok(recipe('chicken-mushroom-yuzu-steam').ingredients.some(p=>p.id==='chicken_breast'));
  assert.ok(recipe('chicken-avocado-yuzu-salad').ingredients.some(p=>p.id==='avocado'));
});

test('練り物・衣・調味料のアレルゲンと食材除外を保ち、魚介を含まない料理まで消さない',()=>{
  const shrimp=itemFromRecipe(recipe('prawn-broccoli-egg-salad'),data);
  for(const id of ['shrimp','egg','milk','wheat','soy'])assert.ok(shrimp.allergens.includes(id),id);
  const miso=itemFromRecipe(recipe('pork-aubergine-spicy-miso'),data);
  for(const id of ['pork','wheat','soy','sesame'])assert.ok(miso.allergens.includes(id),id);
  const initial=defaultJournal(date).settings;
  const allowed=eligibleRecipes({...initial,allergens:['shrimp']},data);
  assert.ok(!allowed.some(r=>r.id==='canteen-prawn-broccoli-egg-salad'));
  assert.ok(allowed.some(r=>r.id==='canteen-chicken-yuzu-grill'));
  const noChicken=eligibleRecipes({...initial,excludedIngredients:['chicken']},data);
  assert.ok(!noChicken.some(r=>r.id==='canteen-chicken-mushroom-yuzu-steam'));
  assert.ok(noChicken.some(r=>r.id==='canteen-tuna-natto-okra-tororo'));
});

test('吸収油・卵の衣と卵とじ・三種のジャンを材料に加え、店の完成品栄養値を転記しない',()=>{
  for(const id of ['chicken-vegetable-black-vinegar','chicken-katsu-mizore','pork-katsu-toji','miso-katsu-ni','millefeuille-pork-katsu','chikuwa-isobe','sweet-spicy-sesame-karaage','hokke-tatsuta-negi']){
    const r=recipe(id),withOil=recipeNutrition(r,data),noOil=recipeNutrition({...r,ingredients:r.ingredients.filter(p=>p.id!=='oil')},data);
    assert.ok(withOil.fat>noOil.fat,r.id);assert.match(r.sourceNote,/揚げ鍋/);
    assert.ok(!Object.hasOwn(r,'manualNutrition'),r.id);
  }
  assert.equal(recipe('pork-katsu-toji').ingredients.find(p=>p.id==='egg').amount,3);
  assert.equal(recipe('miso-katsu-ni').ingredients.find(p=>p.id==='egg').amount,3);
  const ids=recipe('pork-aubergine-spicy-miso').ingredients.map(p=>p.id);
  for(const id of ['mapo_doubanjiang','mapo_tianmianjiang','mapo_douchi'])assert.ok(ids.includes(id));
});

test('記録は半皿の栄養を固定し、買い物は3人分と在庫だけを別に計算する',()=>{
  const r=recipe('chicken-yuzu-grill');
  const entry=createCatalogEntry({recipeId:r.id,date,meal:'dinner',status:'planned',amount:.5,note:''},data);
  const n=recipeNutrition(r,data);near(itemNutrition(entry.items[0]).kcal,n.kcal*.5);
  const state=defaultJournal(date);state.entries.push(entry);
  const restored=parseJournal(JSON.stringify(state),data);
  assert.deepEqual(restored.entries[0].items[0],entry.items[0]);
  const shop=shoppingForEntries(restored.entries,data,{from:date,to:date,servings:3,pantry:[{id:'chicken',amount:20}]});
  const chicken=shop.items.find(i=>i.id==='chicken'),yuzu=shop.items.find(i=>i.id==='simmered_yuzu_kosho');
  near(chicken.required,270);near(chicken.buy,250);near(yuzu.required,4.5);
  const changed={...data,ingredients:{...ingredients,chicken:{...ingredients.chicken,nutritionPerUnit:{...ingredients.chicken.nutritionPerUnit,kcal:1000}}}};
  near(itemNutrition(parseJournal(JSON.stringify(restored),changed).entries[0].items[0]).kcal,n.kcal*.5);
});

test('16料理すべてが過去の記録を保つv3形式へ往復でき、不明値を勝手に0へしない',()=>{
  const state=defaultJournal(date);
  for(const r of CANTEEN_RECIPES)state.entries.push(createCatalogEntry({recipeId:r.id,date,meal:'dinner',status:'eaten',amount:1,note:''},data));
  assert.deepEqual(parseJournal(JSON.stringify(state),data).entries,state.entries);
  const changed={...data,ingredients:{...ingredients,canteen_black_vinegar:{...ingredients.canteen_black_vinegar,nutritionPerUnit:{...ingredients.canteen_black_vinegar.nutritionPerUnit,carbs:null}}}};
  assert.equal(recipeNutrition(recipe('chicken-vegetable-black-vinegar'),changed).carbs,null);
  assert.ok(recipeNutrition(recipe('chicken-vegetable-black-vinegar'),changed).fat>0);
});
