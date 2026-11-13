import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {NOODLE_INGREDIENTS, NOODLE_NUTRITION, NOODLE_RECIPES, NOODLE_STYLES} from '../noodle-foods.js';
import {NOODLE_SOUP_INTAKES, buildNoodleSelection, defaultNoodleSelection, eligibleNoodleSelections, noodleComposerFor} from '../noodle-composer.js';
import {NUTRIENT_KEYS, recipeNutrition, itemNutrition} from '../nutrition.js';
import {createCatalogEntry} from '../record-actions.js';
import {defaultJournal, parseJournal, validateJournal} from '../journal.js';
import {shoppingForEntries} from '../shopping.js';

const ingredients={...INGREDIENTS,...Object.fromEntries(Object.entries(NOODLE_INGREDIENTS).map(([id,food])=>[id,{...food,...NOODLE_NUTRITION[id]}]))};
const data={allergens:ALLERGENS,ingredients,recipes:[...RECIPES,...NOODLE_RECIPES.filter(recipe=>!RECIPES.some(old=>old.id===recipe.id))]};
const near=(actual,expected,label='')=>assert.ok(typeof actual==='number'&&Number.isFinite(actual)&&Math.abs(actual-expected)<1e-7,`${label}: ${actual} != ${expected}`);
const quantities=recipe=>Object.fromEntries(recipe.ingredients.map(part=>[part.id,part.amount]));
const baseConfig={recipeId:'daily-ramen-soy',noodleAmount:150,soupIntake:'full',toppings:[]};
const make=change=>buildNoodleSelection({...baseConfig,...change},data);
const profile=(id,key,amount)=>data.ingredients[id].nutritionPerUnit[key]*amount;

test('基準の麺・具・全スープを変更せず、全モデルの初期値を1杯の保存用レシピへ変換する',()=>{
  const before=JSON.stringify(data);
  for(const model of NOODLE_STYLES){
    const source=data.recipes.find(recipe=>recipe.id===model.recipeId),recipe=buildNoodleSelection(defaultNoodleSelection(model.recipeId),data);
    assert.equal(recipe.servings,1);assert.deepEqual(recipe.portion,{amount:1,unit:'皿'});
    assert.ok(recipe.name.startsWith(source.name),`${model.recipeId}の料理名を保つ`);
    const actual=quantities(recipe),expected=Object.fromEntries(source.ingredients.map(part=>[part.id,part.amount/source.servings]));
    assert.deepEqual(new Set(Object.keys(actual)),new Set(Object.keys(expected)),model.recipeId);
    for(const id of Object.keys(expected))near(actual[id],expected[id],`${model.recipeId} ${id}`);
    const nutrient=recipeNutrition(source,data);
    for(const key of NUTRIENT_KEYS)if(nutrient[key]===null)assert.equal(recipe.manualNutrition[key],null);else near(recipe.manualNutrition[key],nutrient[key],`${model.recipeId} ${key}`);
  }
  assert.equal(JSON.stringify(data),before);
});

test('5段階は汁だけを10/25/50/80/100%にし、麺・肉・野菜と調理全量を保つ',()=>{
  assert.deepEqual(NOODLE_SOUP_INTAKES.map(intake=>intake.fraction),[.1,.25,.5,.8,1]);
  const full=make({}),fullNutrition=full.manualNutrition;
  for(const intake of NOODLE_SOUP_INTAKES){
    const selected=make({soupIntake:intake.id});
    assert.deepEqual(selected.ingredients,full.ingredients);
    for(const key of NUTRIENT_KEYS){
      // 旧しょうゆラーメンの材料表から独立に決めた1人分の汁。
      const broth=profile('water',key,350)+profile('ginger',key,2)+profile('sesame_oil',key,4)+profile('soy_sauce',key,15)+profile('salt',key,.6);
      near(selected.manualNutrition[key],fullNutrition[key]-broth*(1-intake.fraction),`${intake.id} ${key}`);
    }
    near(quantities(selected).ramen_noodles,150);near(quantities(selected).pork,50);near(quantities(selected).cabbage,50);
    assert.match(selected.sourceNote,/材料欄と買い物リストは1杯を調理する全量/);
  }
});

test('にんにく小さじ・味玉・チャーシューはスープ摂取率に関係なく選んだ全量を足す',()=>{
  const tops=[{id:'garlic',amount:2},{id:'chashu',amount:2},{id:'ajitama',amount:1},{id:'menma',amount:20}];
  const full=make({toppings:tops}),small=make({toppings:tops,soupIntake:'clinging'}),without=make({soupIntake:'clinging'});
  assert.deepEqual(full.ingredients,small.ingredients);
  near(quantities(full).garlic,6);near(quantities(full).noodle_chashu,40);near(quantities(full).egg,1);
  const added=make({toppings:tops}).manualNutrition,plain=make({}).manualNutrition;
  for(const key of NUTRIENT_KEYS)near(small.manualNutrition[key]-without.manualNutrition[key],added[key]-plain[key],key);
});

test('麺量だけの変更は茹で麺の差分を加え、具やスープの量を増やさない',()=>{
  const one=make({}),two=make({noodleAmount:300});
  for(const key of NUTRIENT_KEYS)near(two.manualNutrition[key]-one.manualNutrition[key],profile('ramen_noodles',key,150),key);
  for(const [id,amount]of Object.entries(quantities(one)))if(id!=='ramen_noodles')near(quantities(two)[id],amount,id);
});

test('汁なし3種類はたれを全量で扱い、存在しないスープ摂取率を受け付けない',()=>{
  for(const recipeId of ['noodle-aburasoba','noodle-hiyashi-chuka','noodle-soupless-tantan']){
    const config=defaultNoodleSelection(recipeId);assert.equal(config.soupIntake,'none');
    const source=data.recipes.find(recipe=>recipe.id===recipeId),recipe=buildNoodleSelection(config,data);
    for(const key of NUTRIENT_KEYS)near(recipe.manualNutrition[key],recipeNutrition(source,data)[key],`${recipeId} ${key}`);
    assert.throws(()=>buildNoodleSelection({...config,soupIntake:'half'},data),/スープ/);
  }
});

test('予定の買い物は全スープの人数分、栄養は飲んだ量で保存され過去の記録を再計算しない',()=>{
  const date='2026-11-13',recipe=make({id:'custom-noodle-save',soupIntake:'half',toppings:[{id:'garlic',amount:1}]}),catalog={...data,recipes:[...data.recipes,recipe]};
  const entry=createCatalogEntry({recipeId:recipe.id,date,meal:'lunch',status:'planned',amount:1},catalog);
  const state=defaultJournal(date);state.customRecipes=[recipe];state.entries=[entry];
  const saved=validateJournal(state,data),before=JSON.stringify(saved.entries);
  make({soupIntake:'clinging'});
  const restored=parseJournal(JSON.stringify(saved),data);assert.equal(JSON.stringify(restored.entries),before);
  for(const key of NUTRIENT_KEYS)near(itemNutrition(restored.entries[0].items[0])[key],recipe.manualNutrition[key],key);
  const shopping=shoppingForEntries(restored.entries,data,{from:date,to:date,servings:2,pantry:[]});
  near(shopping.items.find(item=>item.id==='water').required,700);near(shopping.items.find(item=>item.id==='ramen_noodles').required,300);near(shopping.items.find(item=>item.id==='garlic').required,6);
});

test('外した味玉のアレルゲンを持ち越さず、除外条件に合わない材料は候補へ戻さない',()=>{
  const egg=make({toppings:[{id:'ajitama',amount:1}]}),plain=make({toppings:[]});
  assert.ok(egg.allergens.includes('egg'));assert.ok(!plain.allergens.includes('egg'));
  const stale={...data,recipes:data.recipes.map(source=>source.id===baseConfig.recipeId?{...source,allergens:['egg']}:source)};
  assert.ok(!buildNoodleSelection(baseConfig,stale).allergens.includes('egg'));
  const choices=eligibleNoodleSelections('daily-ramen-soy',{allergens:['egg'],excludedIngredients:[]},data);assert.ok(choices.length);assert.ok(choices.every(choice=>!choice.recipe.allergens.includes('egg')));
  assert.deepEqual(eligibleNoodleSelections('daily-ramen-soy',{allergens:['wheat'],excludedIngredients:[]},data),[]);
});

test('不明な汁の栄養を0にせず、カップ・袋の一体プロフィールを勝手に分解しない',()=>{
  const unknown={...data,ingredients:{...data.ingredients,soy_sauce:{...data.ingredients.soy_sauce,nutritionPerUnit:{...data.ingredients.soy_sauce.nutritionPerUnit,salt:null}}}};
  assert.equal(buildNoodleSelection({...baseConfig,soupIntake:'clinging'},unknown).manualNutrition.salt,null);
  const unconfirmed={...data,recipes:data.recipes.map(source=>source.id===baseConfig.recipeId?{...source,allergensKnown:false,ingredientsKnown:false,shoppingKnown:false}:source)};
  const selected=buildNoodleSelection(baseConfig,unconfirmed);
  for(const key of ['allergensKnown','ingredientsKnown','shoppingKnown'])assert.equal(selected[key],false);
  assert.equal(noodleComposerFor('prepared-cup-ramen-soy'),null);assert.equal(noodleComposerFor('prepared-bag-ramen-soy'),null);assert.equal(noodleComposerFor(null),null);
  assert.throws(()=>buildNoodleSelection({...baseConfig,recipeId:'prepared-cup-ramen-soy'},data),/材料を分けて/);
});

test('壊れた量・重複・未対応の摂取率・保存項目を拒否する',()=>{
  for(const value of [0,-1,NaN,Infinity,2001,'150'])assert.throws(()=>make({noodleAmount:value}),/麺の量/);
  for(const value of ['',null,'zero'])assert.throws(()=>make({soupIntake:value}),/スープ/);
  assert.throws(()=>make({toppings:[{id:'garlic',amount:1},{id:'garlic',amount:1}]}),/重複/);
  assert.throws(()=>make({toppings:[{id:'garlic',amount:-2}]}),/トッピング/);
  assert.throws(()=>make({toppings:[{id:'not-known',amount:1}]}),/トッピング/);
  assert.throws(()=>make({brothFraction:.2}),/選択内容/);
  assert.throws(()=>make({id:null}),/識別子/);
});
