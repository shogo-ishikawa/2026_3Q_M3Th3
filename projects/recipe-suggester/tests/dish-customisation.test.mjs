import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {DISH_CUSTOMISERS, DISH_CUSTOM_INGREDIENTS, defaultDishSelection, buildCustomDish, eligibleDishSelections} from '../dish-customisation.js';
import {itemNutrition, recipeNutrition} from '../nutrition.js';
import {createCatalogEntry} from '../record-actions.js';
import {defaultJournal, parseJournal} from '../journal.js';
import {eligibleRecipes} from '../planner.js';
import {isCompleteMeal} from '../catalog.js';
import {shoppingForEntries} from '../shopping.js';

const data={recipes:RECIPES,ingredients:INGREDIENTS,allergens:ALLERGENS};
const base=id=>RECIPES.find(recipe=>recipe.id===id);
const parts=recipe=>Object.fromEntries(recipe.ingredients.map(part=>[part.id,part.amount]));
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
const make=(kind,presetId,changes={})=>buildCustomDish({...defaultDishSelection(kind,presetId),...changes},data);
const withRecipe=recipe=>({...data,recipes:[...RECIPES,recipe]});
const entry=(recipe,amount=1)=>createCatalogEntry({recipeId:recipe.id,date:'2026-11-13',meal:'dinner',status:'planned',amount},withRecipe(recipe));

test('肉じゃがは既存の牛肉版の量を維持し、豚肉へ切り替えると肉だけと栄養が変わる',()=>{
  const before=JSON.stringify(data),beef=make('nikujaga'),pork=make('nikujaga',undefined,{meat:'pork'}),source=base('beef-potato');
  assert.deepEqual(beef.ingredients,source.ingredients.map(part=>({...part,amount:part.amount/source.servings})));
  const expected={...parts(beef)};delete expected.beef;expected.pork=110;
  assert.deepEqual(parts(pork),expected);assert.equal(parts(beef).beef,110);
  assert.equal(pork.name,'肉じゃが（豚肉）');assert.equal(beef.name,'肉じゃが（牛肉）');
  for(const key of ['kcal','protein','fat','carbs','salt']){if(pork.manualNutrition[key]===null||beef.manualNutrition[key]===null)assert.equal(pork.manualNutrition[key],beef.manualNutrition[key]);else near(pork.manualNutrition[key]-beef.manualNutrition[key],110*(INGREDIENTS.pork.nutritionPerUnit[key]-INGREDIENTS.beef.nutritionPerUnit[key]));}
  assert.match(pork.steps.join(' '),/豚肉/);assert.doesNotMatch(pork.steps.join(' '),/牛肉/);assert.match(beef.steps.join(' '),/牛肉/);
  assert.equal(pork.role,'main');assert.equal(isCompleteMeal(pork),false);assert.equal(JSON.stringify(data),before);
});

test('肉を変えた時に元の牛肉アレルゲンを残さず、選んだ肉の除外条件へ従う',()=>{
  const beef=make('nikujaga'),pork=make('nikujaga',undefined,{meat:'pork'});
  assert.ok(beef.allergens.includes('beef'));assert.ok(!beef.allergens.includes('pork'));
  assert.ok(pork.allergens.includes('pork'));assert.ok(!pork.allergens.includes('beef'));
  assert.equal(eligibleRecipes({allergens:['beef'],excludedIngredients:[]},withRecipe(pork)).some(r=>r.id===pork.id),true);
  assert.equal(eligibleRecipes({allergens:[],excludedIngredients:['pork']},withRecipe(pork)).some(r=>r.id===pork.id),false);
});

test('お好み焼きの初期配合は既存の海鮮1人分と一致し、主食を重ねない一品料理になる',()=>{
  const custom=make('okonomiyaki'),source=base('seafood-okonomiyaki');
  const expected=Object.fromEntries(source.ingredients.map(part=>[part.id,part.amount/source.servings]));
  assert.deepEqual(Object.keys(parts(custom)).sort(),Object.keys(expected).sort());
  for(const[id,amount]of Object.entries(expected))near(parts(custom)[id],amount);
  for(const[key,value]of Object.entries(recipeNutrition(source,data)))value===null?assert.equal(custom.manualNutrition[key],null):near(custom.manualNutrition[key],value);
  assert.ok(isCompleteMeal(custom));assert.equal(custom.role,'main');assert.ok(custom.staple&&custom.mealBase);
  assert.match(custom.name,/イカ・えび/);assert.doesNotMatch(custom.steps.join(' '),/豚肉用|豚ばら肉/);
});

test('豚玉、イカ玉、シーフード、もちねぎ、モダン、ミックスを1つのテンプレートから作れる',()=>{
  assert.equal(DISH_CUSTOMISERS.length,2);
  const definition=DISH_CUSTOMISERS.find(row=>row.kind==='okonomiyaki');assert.equal(definition.components.length,6);assert.equal(definition.presets.length,6);
  const before=JSON.stringify(RECIPES);
  for(const preset of definition.presets){
    const config=defaultDishSelection('okonomiyaki',preset.id),custom=buildCustomDish(config,data);
    assert.equal(new Set(custom.ingredients.map(part=>part.id)).size,custom.ingredients.length);
    assert.ok(custom.name.length<=200&&custom.sourceNote.length<=2000);
    assert.ok(custom.steps.length>=6);assert.ok(custom.allergensKnown&&custom.ingredientsKnown&&custom.shoppingKnown);
    const state=defaultJournal('2026-11-13');state.customRecipes.push(custom);state.entries.push(entry(custom));
    assert.equal(parseJournal(JSON.stringify(state),data).customRecipes[0].name,custom.name);
  }
  assert.equal(JSON.stringify(RECIPES),before);
  const first=defaultDishSelection('okonomiyaki','modern');first.components[0].amount=3;
  assert.equal(defaultDishSelection('okonomiyaki','modern').components[0].amount,50);
});

test('餅と薄切り豚ばらは計量状態を区別し、祖先の食材除外を引き継ぐ',()=>{
  const mochi=INGREDIENTS.dish_mochi,pork=INGREDIENTS.dish_pork_belly_sliced;
  assert.equal(DISH_CUSTOM_INGREDIENTS.dish_mochi.unit,'g');assert.deepEqual(mochi.derivedFrom,['rice']);assert.deepEqual(pork.derivedFrom,['pork_belly']);
  for(const[key,value]of Object.entries({kcal:2.23,protein:.04,fat:.006,carbs:.508,fiber:.005,salt:0}))near(mochi.nutritionPerUnit[key],value);
  assert.deepEqual(pork.nutritionPerUnit,INGREDIENTS.pork_belly.nutritionPerUnit);
  const custom=make('okonomiyaki','mochi-negi');assert.equal(parts(custom).dish_mochi,30);
  assert.match(custom.steps.join(' '),/薄い小片/);assert.match(custom.sourceNote,/加熱前/);
  assert.equal(eligibleRecipes({allergens:[],excludedIngredients:['rice']},withRecipe(custom)).some(r=>r.id===custom.id),false);
  const porkDish=make('okonomiyaki','pork');
  assert.equal(eligibleRecipes({allergens:[],excludedIngredients:['pork']},withRecipe(porkDish)).some(r=>r.id===porkDish.id),false);
});

test('具材・ソース・マヨネーズの選択だけで量とアレルゲンを更新する',()=>{
  const pork=make('okonomiyaki','pork');assert.ok(!pork.allergens.includes('shrimp')&&!pork.allergens.includes('squid'));
  assert.ok(pork.allergens.includes('pork'));assert.ok(pork.allergens.includes('milk'));
  const bare=make('okonomiyaki','pork',{sauceId:'none',sauceAmount:0,mayonnaiseAmount:0});
  assert.equal(parts(bare).worcestershire_sauce,undefined);assert.equal(parts(bare).mayonnaise,undefined);
  assert.ok(!bare.allergens.includes('milk')&&!bare.allergens.includes('apple'));assert.ok(bare.allergens.includes('egg'));
  const twice=make('okonomiyaki','pork',{sauceAmount:30,mayonnaiseAmount:10});
  near(parts(pork).worcestershire_sauce*1.195,15);near(parts(twice).worcestershire_sauce*1.195,30);
  assert.equal(parts(pork).cabbage,parts(twice).cabbage);assert.equal(parts(pork).dish_pork_belly_sliced,parts(twice).dish_pork_belly_sliced);
  for(const key of ['kcal','protein','fat','carbs','salt'])near(twice.manualNutrition[key]-bare.manualNutrition[key],2*(pork.manualNutrition[key]-bare.manualNutrition[key]));
});

test('モダン焼きは麺を含め、選んだ具材に合わせて調理の順序と加熱の説明も変える',()=>{
  const plain=make('okonomiyaki','pork'),modern=make('okonomiyaki','modern');
  assert.equal(parts(modern).yakisoba_noodles,100);assert.equal(parts(plain).yakisoba_noodles,undefined);
  for(const key of ['kcal','protein','fat','carbs','salt'])near(modern.manualNutrition[key]-plain.manualNutrition[key],100*INGREDIENTS.yakisoba_noodles.nutritionPerUnit[key]);
  assert.match(modern.name,/モダン焼き/);assert.ok(modern.steps.findIndex(step=>step.includes('麺をほぐして温める'))<modern.steps.findIndex(step=>step.includes('上へ豚ばら肉')));
  assert.match(modern.steps.join(' '),/75℃/);assert.match(modern.steps.join(' '),/1分以上/);
  assert.match(modern.steps.join(' '),/麺入り/);assert.match(modern.steps.join(' '),/残りの油/);
  assert.ok(modern.steps.findIndex(step=>step.includes('表示の油の一部'))<modern.steps.findIndex(step=>step.includes('残りの油')));
  for(const preset of DISH_CUSTOMISERS.find(row=>row.kind==='okonomiyaki').presets.filter(row=>!row.components.some(part=>part.id==='noodles'))){
    const dish=make('okonomiyaki',preset.id),instructions=dish.steps.join(' ');
    assert.doesNotMatch(instructions,/麺|残りの油/,preset.id);
    assert.match(instructions,/フライパンに油を入れて中火で温め/,preset.id);
  }
});

test('0、負数、非有限、不明・重複具材、空、量の上限超過を保存前に拒否する',()=>{
  const valid=defaultDishSelection('okonomiyaki','pork');
  const bad=[null,[],{}, {kind:'unknown'}, {kind:'nikujaga',meat:'chicken'}, {kind:'nikujaga',meat:'beef',hidden:true},
    {...valid,components:[]},{...valid,components:Array(1)},{...valid,components:[{id:'shrimp',amount:50},{id:'shrimp',amount:10}]},
    {...valid,components:[{id:'constructor',amount:50}]},{...valid,presetId:'bad'},{...valid,sauceId:'bad'},
    {...valid,sauceId:'none',sauceAmount:1},{...valid,sauceAmount:0},{...valid,hidden:1},
    {...valid,components:[{id:'shrimp',amount:300},{id:'squid',amount:201}]},
    ...[0,-1,NaN,Infinity,null,'50',301].map(amount=>({...valid,components:[{id:'shrimp',amount}]})),
    ...[-1,NaN,Infinity,null,'5',101].map(mayonnaiseAmount=>({...valid,mayonnaiseAmount})),
    ...[-1,NaN,Infinity,null,'5',101].map(sauceAmount=>({...valid,sauceAmount})),
  ];
  for(const config of bad)assert.throws(()=>buildCustomDish(config,data));
  assert.throws(()=>defaultDishSelection('unknown'));assert.throws(()=>defaultDishSelection('okonomiyaki','bad'));
  const wrong={...data,ingredients:{...INGREDIENTS,egg:{...INGREDIENTS.egg,unit:'g'}}};
  assert.throws(()=>buildCustomDish(valid,wrong),/材料/);
});

test('半皿の栄養と3人分の買い物へ反映し、マイDBへ保存しなくても確定内容を保持する',()=>{
  const custom=make('okonomiyaki','modern',{id:'custom-dish-snapshot'}),record=entry(custom,.5);
  const state=defaultJournal('2026-11-13');state.customRecipes=[custom];state.entries=[record];
  const saved=parseJournal(JSON.stringify(state),data);assert.equal(saved.entries[0].items.length,1);
  const consumed=itemNutrition(saved.entries[0].items[0]);
  for(const[key,value]of Object.entries(custom.manualNutrition))value===null?assert.equal(consumed[key],null):near(consumed[key],value*.5);
  const shopping=shoppingForEntries(saved.entries,data,{from:'2026-11-13',to:'2026-11-13',servings:3,pantry:[{id:'yakisoba_noodles',amount:20}]});
  near(shopping.items.find(item=>item.id==='dish_pork_belly_sliced').required,75);near(shopping.items.find(item=>item.id==='yakisoba_noodles').required,150);
  saved.customRecipes=[];saved.entries[0].items[0].recipeId=null;
  assert.deepEqual(parseJournal(JSON.stringify(saved),data).entries[0].items[0].ingredients,record.items[0].ingredients);
  assert.deepEqual(parseJournal(JSON.stringify(saved),data).entries[0].items[0].nutrition,record.items[0].nutrition);
});

test('欠損した栄養を0へ変えず、選択配合と元DBを変更しない',()=>{
  const config=defaultDishSelection('nikujaga');config.meat='pork';
  const before=JSON.stringify(config),changed={...data,ingredients:{...INGREDIENTS,pork:{...INGREDIENTS.pork,nutritionPerUnit:{...INGREDIENTS.pork.nutritionPerUnit,fat:null}}}};
  const custom=buildCustomDish(config,changed);assert.equal(custom.manualNutrition.fat,null);assert.ok(custom.manualNutrition.kcal>0);
  assert.equal(JSON.stringify(config),before);assert.ok(INGREDIENTS.pork.nutritionPerUnit.fat>0);
});


test('選べる料理の入口は肉や具材を変えても必須除外を守り、調味料なしの候補も検査する',()=>{
  const before=JSON.stringify(data),settings={allergens:['beef'],excludedIngredients:[]};
  const allowed=eligibleDishSelections('nikujaga',settings,data);
  assert.deepEqual(allowed.map(row=>row.config.meat),['pork']);assert.ok(allowed.every(row=>!row.recipe.allergens.includes('beef')));
  const fishFree=eligibleDishSelections('okonomiyaki',{allergens:['shrimp','squid','milk','soy'],excludedIngredients:[]},data);
  assert.deepEqual(fishFree.map(row=>row.config.presetId),['pork','mochi-negi','modern']);
  assert.ok(fishFree.every(row=>row.config.sauceId==='none'&&row.config.mayonnaiseAmount===0));
  for(const allergen of ['egg','wheat'])assert.deepEqual(eligibleDishSelections('okonomiyaki',{allergens:[allergen],excludedIngredients:[]},data),[]);
  const porkFree=eligibleDishSelections('okonomiyaki',{allergens:[],excludedIngredients:['pork']},data);
  assert.ok(porkFree.length);assert.ok(porkFree.every(row=>!row.recipe.ingredients.some(part=>part.id==='dish_pork_belly_sliced')));
  assert.throws(()=>eligibleDishSelections('unknown',settings,data));
  assert.equal(JSON.stringify(data),before);assert.deepEqual(settings,{allergens:['beef'],excludedIngredients:[]});
  const configs=eligibleDishSelections('okonomiyaki',{},data);configs[0].config.components[0].amount=1;
  assert.notEqual(configs[1].config.components[0].amount,1);
});
