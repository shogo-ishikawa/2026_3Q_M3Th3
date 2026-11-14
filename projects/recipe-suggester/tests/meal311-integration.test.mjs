import {BREAD_RECIPES,BREAD_INGREDIENTS} from '../bread-foods.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {ADDED_311_RECIPES,ADDED_311_INGREDIENTS} from './helpers/meal311-additions.mjs';
import {buildFoodSelection,defaultFoodSelection,foodComposerDefinition,eligibleFoodSelection} from '../food-composer.js';
import {getVariationGroup,groupMenuRecipes} from '../menu-variations.js';
import {browseDishes,dishClassification} from '../dish-hierarchy.js';
import {recipeNutrition,itemNutrition,NUTRIENT_KEYS} from '../nutrition.js';
import {defaultJournal,parseJournal} from '../journal.js';
import {createCatalogEntry} from '../record-actions.js';
import {recipePortion} from '../catalog.js';
import {eligibleRecipes} from '../planner.js';
import {buildMeatSelection} from '../meat-choices.js';
import {shoppingForEntries} from '../shopping.js';

const data={allergens:ALLERGENS,ingredients:INGREDIENTS,recipes:RECIPES};
const fixture=JSON.parse(readFileSync(new URL('./fixtures/meal310-data-contract.json',import.meta.url),'utf8'));
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const near=(a,b)=>assert.ok(Number.isFinite(a)&&Math.abs(a-b)<1e-7,`${a} != ${b}`);
const builtin=id=>{const r=RECIPES.find(r=>r.id===id);assert.ok(r,id);return r;};
const date='2026-11-13';
const customData=recipe=>({...data,recipes:[...RECIPES,recipe]});
const entry=(recipe,quantity=1)=>createCatalogEntry({recipeId:recipe.id,date,meal:'dinner',status:'planned',amount:quantity},customData(recipe));

test('v3.10の917料理・429食材の全項目を固定ハッシュで保持する',()=>{
  const ids=new Set(fixture.recipeIds),originals=RECIPES.filter(r=>ids.has(r.id));
  assert.equal(originals.length,917);assert.deepEqual(originals.map(r=>r.id),fixture.recipeIds);
  assert.equal(hash(originals),fixture.recipeHash);
  const foods=Object.fromEntries(fixture.ingredientIds.map(id=>[id,INGREDIENTS[id]]));
  assert.equal(Object.keys(foods).length,429);assert.equal(hash(foods),fixture.ingredientHash);
});

test('新モジュールの料理・食材を実際の公開DBへ一度だけ取り込む',()=>{
  assert.equal(RECIPES.length,917+ADDED_311_RECIPES.length+BREAD_RECIPES.length);
  assert.equal(Object.keys(INGREDIENTS).length,429+Object.keys(ADDED_311_INGREDIENTS).length+Object.keys(BREAD_INGREDIENTS).length);
  assert.equal(new Set(RECIPES.map(r=>r.id)).size,RECIPES.length);
  assert.equal(new Set(RECIPES.map(r=>r.name)).size,RECIPES.length);
  for(const source of ADDED_311_RECIPES){
    const r=builtin(source.id);assert.equal(r.name,source.name);
    assert.equal(r.servings,2);assert.ok(['main','side','soup'].includes(r.role));
    const n=recipeNutrition(r,data);
    for(const key of NUTRIENT_KEYS)assert.ok(n[key]===null||(Number.isFinite(n[key])&&n[key]>=0),r.id+'.'+key);
  }
  for(const id of Object.keys(ADDED_311_INGREDIENTS)){
    const food=INGREDIENTS[id];assert.ok(food?.nutritionSource,id);assert.match(food.nutritionSource,/https:\/\//);
    if(['g','ml'].includes(food.unit))assert.equal(food.gramsPerUnit,1,id);
    else assert.ok(Number.isFinite(food.gramsPerUnit)&&food.gramsPerUnit>0,id);
    assert.ok(food.rawNutritionPerUnit,id);
  }
});

test('追加した鍋は既存の鍋と同じ入口にまとまり、回鍋肉を混ぜない',()=>{
  const group=getVariationGroup('familiar-yose-nabe',RECIPES);
  assert.ok(group);assert.equal(group.groupId,'nabe');
  for(const source of ADDED_311_RECIPES.filter(r=>r.id.startsWith('simmered-'))){
    assert.ok(group.recipes.some(r=>r.id===source.id),source.id);
    assert.equal(dishClassification(builtin(source.id)).method,'hotpot');
  }
  for(const id of ['chicken-tofu-pot','familiar-mizutaki','familiar-sukiyaki','familiar-pork-shabu','familiar-yudofu'])assert.ok(group.recipes.some(r=>r.id===id),id);
  assert.ok(!group.recipes.some(r=>r.id==='varied-hoikoro'));
  const menus=groupMenuRecipes(RECIPES),allIds=menus.flatMap(m=>m.recipes.map(r=>r.id));
  assert.equal(new Set(allIds).size,RECIPES.length);assert.equal(allIds.length,RECIPES.length);
});

test('柚子胡椒の鶏料理と指定されたスープの種類を重複なしで記録できる',()=>{
  const yuzu=ADDED_311_RECIPES.filter(r=>/鶏|チキン/.test(r.name)&&/柚子胡椒/.test(r.name));
  assert.ok(yuzu.length>=4);for(const source of yuzu)assert.ok(builtin(source.id).ingredients.some(p=>p.id==='simmered_yuzu_kosho'),source.id);
  for(const name of ['お吸い物','あら汁','クラムチャウダー','かぼちゃ','コンソメ','ワンタン']){
    assert.ok(RECIPES.some(r=>r.role==='soup'&&r.name.includes(name)),name);
  }
  const journal=defaultJournal(date);
  journal.entries=ADDED_311_RECIPES.map(source=>createCatalogEntry({recipeId:source.id,date,meal:'dinner',status:'planned',amount:recipePortion(builtin(source.id),data).amount},data));
  const restored=parseJournal(JSON.stringify(journal),data);assert.equal(restored.entries.length,ADDED_311_RECIPES.length);
  for(let i=0;i<journal.entries.length;i++)assert.deepEqual(restored.entries[i].items[0],journal.entries[i].items[0]);
});

test('ポトフの既定量を維持し、選択した鶏肉・きのこだけで栄養と買い物を作る',()=>{
  const original=builtin('familiar-side-pot-au-feu');
  const defaults=buildFoodSelection(defaultFoodSelection('pot-au-feu'),data);
  for(const key of NUTRIENT_KEYS)near(defaults.manualNutrition[key],recipeNutrition(original,data)[key]);
  const recipe=buildFoodSelection({id:'custom-meal311-potauf',kind:'pot-au-feu',components:[{id:'chicken-breast',amount:120},{id:'shimeji',amount:70},{id:'carrot',amount:50},{id:'water',amount:300},{id:'salt',amount:.4}]},data);
  assert.equal(recipe.role,'soup');assert.ok(!recipe.ingredients.some(p=>p.id==='bacon'));
  assert.ok(recipe.steps.some(s=>s.includes('75℃')));assert.ok(recipe.steps.some(s=>s.includes('鶏むね')));
  assert.doesNotMatch(recipe.steps.join(' '),/マッシュルーム/);
  const expected=recipeNutrition({servings:1,ingredients:recipe.ingredients},data);
  for(const key of NUTRIENT_KEYS)near(recipe.manualNutrition[key],expected[key]);
  const shopping=shoppingForEntries([entry(recipe,.5)],data,{from:date,to:date,servings:3,pantry:[{id:'chicken_breast',amount:20}]});
  const chicken=shopping.items.find(x=>x.id==='chicken_breast');near(chicken.required,180);near(chicken.buy,160);
  near(shopping.items.find(x=>x.id==='water').required,450);
  assert.ok(!shopping.items.some(x=>x.id==='bacon'));
  const settings=defaultJournal(date).settings;settings.allergens=['milk'];
  assert.ok(eligibleRecipes(settings,{...data,recipes:[recipe]}).length===1);
  assert.ok(eligibleFoodSelection('pot-au-feu',settings,data));
});

test('おでんの新しい具材の個数と可食重量を保存し、半皿・人数・在庫を一度だけ掛ける',()=>{
  const def=foodComposerDefinition('oden');assert.equal(def.components.filter(c=>c.food!==false).length,21);
  const recipe=buildFoodSelection({id:'custom-meal311-oden',kind:'oden',components:[{id:'quail-egg',amount:2,gramsPerUnit:10},{id:'chikuwabu',amount:2,gramsPerUnit:25},{id:'satsumaage',amount:1,gramsPerUnit:40},{id:'cabbage-roll',amount:1},{id:'broth',amount:50}]},data);
  const map=Object.fromEntries(recipe.ingredients.map(p=>[p.id,p.amount]));
  near(map.simmered_quail_egg_boiled,20);near(map.simmered_chikuwabu,50);near(map.simmered_satsumaage,40);near(map.pork_minced,20);near(map.cabbage,30);
  const recorded=entry(recipe,.5),journal=defaultJournal(date);journal.customRecipes=[recipe];journal.entries=[recorded];
  const restored=parseJournal(JSON.stringify(journal),data);
  assert.deepEqual(restored.entries[0].items[0],recorded.items[0]);
  const shopping=shoppingForEntries(restored.entries,data,{from:date,to:date,servings:3,pantry:[{id:'simmered_chikuwabu',amount:5}]});
  const row=shopping.items.find(x=>x.id==='simmered_chikuwabu');near(row.required,75);near(row.buy,70);
  const frozen=itemNutrition(restored.entries[0].items[0]);
  const altered={...data,ingredients:{...INGREDIENTS,simmered_chikuwabu:{...INGREDIENTS.simmered_chikuwabu,nutritionPerUnit:Object.fromEntries(NUTRIENT_KEYS.map(k=>[k,999]))}}};
  const reread=parseJournal(JSON.stringify(journal),altered);
  assert.deepEqual(itemNutrition(reread.entries[0].items[0]),frozen);
});


test('新しいチーズインハンバーグにも挽肉4種の選択を引き継ぎ、チーズやソースを保つ',()=>{
  const source=builtin('bistro-cheese-in-hamburg');
  const initial=buildMeatSelection({recipeId:source.id,meatId:'mixed'},data);
  for(const key of NUTRIENT_KEYS)near(initial.manualNutrition[key],recipeNutrition(source,data)[key]);
  for(const meatId of ['beef','pork','mixed','chicken']){
    const selected=buildMeatSelection({recipeId:source.id,meatId},data);
    near(selected.ingredients.find(p=>p.id==='mozzarella').amount,25);
    near(selected.ingredients.find(p=>p.id==='palette_cheddar').amount,10);
    const meat=selected.ingredients.filter(p=>['beef_minced','pork_minced','chicken_minced'].includes(p.id));
    near(meat.reduce((sum,p)=>sum+p.amount,0),170);
    const state=defaultJournal(date);state.customRecipes=[selected];state.entries=[entry(selected)];
    assert.deepEqual(parseJournal(JSON.stringify(state),data).entries,state.entries);
  }
});
