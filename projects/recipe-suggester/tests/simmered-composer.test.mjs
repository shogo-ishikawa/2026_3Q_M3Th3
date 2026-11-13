import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {SIMMERED_INGREDIENTS, SIMMERED_NUTRITION} from '../simmered-foods.js';
import {availableFoodComponents, buildFoodSelection, defaultFoodSelection, eligibleFoodSelection, foodComposerDefinition, foodComposerFor} from '../food-composer.js';
import {NUTRIENT_KEYS, itemNutrition, recipeNutrition} from '../nutrition.js';
import {createCatalogEntry} from '../record-actions.js';
import {defaultJournal, parseJournal} from '../journal.js';
import {shoppingForEntries} from '../shopping.js';

const ingredients=Object.fromEntries(Object.entries({...INGREDIENTS,...SIMMERED_INGREDIENTS}).map(([id,food])=>[id,{...food,...SIMMERED_NUTRITION[id]}]));
const data={allergens:ALLERGENS,recipes:RECIPES,ingredients};
const date='2026-11-13';
const near=(actual,expected)=>assert.ok(typeof actual==='number'&&Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
const amount=(recipe,id)=>recipe.ingredients.find(part=>part.id===id)?.amount;
const compose=(kind,components,catalog=data)=>buildFoodSelection({kind,components},catalog);
const entries=(...rows)=>rows.map(([id,amount])=>({id,amount}));
const quantities=recipe=>Object.fromEntries(recipe.ingredients.map(part=>[part.id,part.amount]));

test('ポトフの初期値は既存ベーコンと野菜の1人分を正確に復元し、元レシピを変えない',()=>{
  const source=RECIPES.find(recipe=>recipe.id==='familiar-side-pot-au-feu'),before=JSON.stringify(source);
  const result=buildFoodSelection(defaultFoodSelection('pot-au-feu'),data);
  assert.equal(foodComposerFor(source.id).kind,'pot-au-feu');
  assert.equal(result.role,'soup');assert.equal(result.family,'soup');assert.equal(result.servings,1);
  assert.deepEqual(quantities(result),Object.fromEntries(source.ingredients.map(part=>[part.id,part.amount/source.servings])));
  const oldNutrition=recipeNutrition(source,data);
  for(const key of NUTRIENT_KEYS)near(result.manualNutrition[key],oldNutrition[key]);
  assert.equal(JSON.stringify(source),before);
  assert.match(foodComposerDefinition('pot-au-feu').intro,/煮汁を全量食べる/);
  assert.match(result.sourceNote,/煮汁・調味料を全量食べる/);
  assert.match(result.sourceNote,/買い物は用意する全量/);
});

test('ポトフで選んだ肉・野菜・水・塩だけを栄養と材料へ計上する',()=>{
  const result=compose('pot-au-feu',entries(['chicken-breast',120],['turnip',80],['mushroom',30],['water',300],['salt',0.5]));
  assert.deepEqual(quantities(result),{chicken_breast:120,turnip:80,mushroom:30,water:300,salt:0.5});
  for(const key of NUTRIENT_KEYS){
    const expected=result.ingredients.reduce((sum,part)=>sum+ingredients[part.id].nutritionPerUnit[key]*part.amount,0);
    near(result.manualNutrition[key],expected);
  }
  near(result.manualNutrition.fat,120*.019+80*.001+30*.003);
  near(result.manualNutrition.salt,120*.001+.5*.995);
  assert.ok(!result.ingredients.some(part=>['oil','bacon','soy_sauce'].includes(part.id)));
});

test('ポトフは煮汁の水を必要とし、調味料や水だけでは保存しない',()=>{
  assert.throws(()=>compose('pot-au-feu',entries(['chicken',100])),/煮汁の水/);
  assert.throws(()=>compose('pot-au-feu',entries(['potato',100],['water',0])),/煮汁の水/);
  assert.throws(()=>compose('pot-au-feu',entries(['water',350],['salt',1])),/具材/);
  const saltFree=compose('pot-au-feu',entries(['potato',100],['water',350],['salt',0]));
  assert.ok(!saltFree.ingredients.some(part=>part.id==='salt'));
  assert.equal(eligibleFoodSelection('pot-au-feu',{excludedIngredients:['water']},data),null);
  const withoutPork=eligibleFoodSelection('pot-au-feu',{allergens:['pork']},data);
  assert.ok(withoutPork);assert.ok(!withoutPork.recipe.allergens.includes('pork'));
  assert.ok(!withoutPork.config.components.some(part=>part.id==='bacon'));
});

test('おでんは21種類の具を持ち、製品g・個数・乾燥昆布の標準重量を区別する',()=>{
  const all=availableFoodComponents('oden',data);
  assert.equal(all.filter(part=>part.food!==false).length,21);
  const required=['potato','taro','sausage','shirataki','kombu-knot','octopus','satsumaage','chikuwabu','tsumire','gobomaki','quail-egg','cabbage-roll'];
  for(const id of required)assert.ok(all.some(part=>part.id===id),id);
  const result=compose('oden',entries(['tsumire',2],['gobomaki',2],['quail-egg',3],['kombu-knot',1],['octopus',2]));
  near(amount(result,'simmered_tsumire'),36);near(amount(result,'simmered_gobomaki'),54);
  near(amount(result,'simmered_quail_egg_boiled'),27);near(amount(result,'kombu'),2);near(amount(result,'octopus'),60);
  assert.match(all.find(part=>part.id==='kombu-knot').note,/戻す前の乾燥昆布/);
  assert.match(result.sourceNote,/汁の栄養と買い物量は、選択した実際に飲む量だけ/);
  assert.match(result.sourceNote,/鍋に用意する汁全量とは異なり/);
  const adjusted=compose('oden',[{id:'potato',amount:2,gramsPerUnit:100}]);
  near(amount(adjusted,'potato'),200);assert.match(adjusted.name,/約200g/);
});

test('おでんのロールキャベツを原材料へ展開し、選んだ加工品の不明状態とアレルゲンを引き継ぐ',()=>{
  const roll=compose('oden',entries(['cabbage-roll',2]));
  assert.deepEqual(quantities(roll),{cabbage:60,pork_minced:40,onion:16,starch:4,salt:0.1});
  assert.ok(roll.allergens.includes('pork'));assert.match(roll.steps.join(' '),/中心75℃で1分以上/);
  const cake=compose('oden',entries(['satsumaage',1]));
  assert.equal(cake.ingredientsKnown,false);assert.equal(cake.allergensKnown,false);assert.equal(cake.shoppingKnown,true);
  const quail=compose('oden',entries(['quail-egg',2]));assert.ok(quail.allergens.includes('egg'));
  const safe=eligibleFoodSelection('oden',{allergens:['egg','wheat']},data);
  assert.ok(safe);assert.ok(!safe.recipe.allergens.includes('egg'));assert.ok(!safe.recipe.allergens.includes('wheat'));
});

test('ポトフとおでんの手順は選んだ具材だけを案内し、生肉と加熱済み製品を区別する',()=>{
  const chicken=compose('pot-au-feu',entries(['chicken-breast',100],['water',350]));
  const text=chicken.steps.join(' ');assert.match(text,/鶏むね肉/);assert.match(text,/中心75℃で1分以上/);
  assert.doesNotMatch(text,/ベーコン|ウインナー|玉ねぎ|キャベツ|じゃがいも|きのこ|かぶ|パセリ/);
  const onlyPotato=compose('oden',entries(['potato',1]));
  assert.match(onlyPotato.steps.join(' '),/じゃがいも/);
  assert.doesNotMatch(onlyPotato.steps.join(' '),/ロールキャベツ|ひき肉|卵|はんぺん|ちくわぶ/);
  const cooked=compose('oden',entries(['tsumire',1]));
  assert.match(cooked.steps.join(' '),/10〜15分/);
  assert.doesNotMatch(cooked.steps.join(' '),/ひき肉|肉だね/);
});

test('ポトフと新しいおでん具材を半皿で記録し、JSON往復後も当時の材料と栄養を保つ',()=>{
  for(const recipe of [buildFoodSelection(defaultFoodSelection('pot-au-feu'),data),compose('oden',entries(['quail-egg',2],['tsumire',3],['broth',120]))]){
    const catalog={...data,recipes:[...data.recipes,recipe]};
    const entry=createCatalogEntry({recipeId:recipe.id,date,meal:'dinner',status:'planned',amount:.5},catalog);
    const state=defaultJournal(date);state.entries=[entry];state.customRecipes=[recipe];
    const saved=parseJournal(JSON.stringify(state),data);
    assert.deepEqual(saved.entries,state.entries);assert.deepEqual(saved.customRecipes,state.customRecipes);
    for(const key of NUTRIENT_KEYS)recipe.manualNutrition[key]===null?assert.equal(itemNutrition(entry.items[0])[key],null):near(itemNutrition(entry.items[0])[key],recipe.manualNutrition[key]*.5);
    const before=JSON.stringify(saved.entries);
    compose('pot-au-feu',entries(['potato',500],['water',300]));
    assert.equal(JSON.stringify(saved.entries),before);
  }
});

test('半皿×3人と在庫を一度ずつ適用し、ポトフは準備した水の全量を買い物へ渡す',()=>{
  const recipe=buildFoodSelection(defaultFoodSelection('pot-au-feu'),data),catalog={...data,recipes:[...data.recipes,recipe]};
  const record=createCatalogEntry({recipeId:recipe.id,date,meal:'dinner',status:'planned',amount:.5},catalog);
  const list=shoppingForEntries([record],catalog,{from:date,to:date,servings:3,pantry:[{id:'bacon',amount:12.5}]});
  const bacon=list.items.find(part=>part.id==='bacon');near(bacon.required,52.5);near(bacon.buy,40);
  near(list.items.find(part=>part.id==='water').required,525);near(list.items.find(part=>part.id==='salt').required,1.05);
  assert.deepEqual(list.missingMenus,[]);
  const oden=compose('oden',[{id:'potato',amount:2,gramsPerUnit:100},{id:'quail-egg',amount:2},{id:'broth',amount:100}]);
  const odenData={...data,recipes:[...data.recipes,oden]};
  const entry=createCatalogEntry({recipeId:oden.id,date,meal:'dinner',status:'planned',amount:.5},odenData);
  const odenList=shoppingForEntries([entry],odenData,{from:date,to:date,servings:3,pantry:[{id:'potato',amount:80}]});
  near(odenList.items.find(part=>part.id==='potato').required,300);near(odenList.items.find(part=>part.id==='potato').buy,220);
  near(odenList.items.find(part=>part.id==='simmered_quail_egg_boiled').required,27);near(odenList.items.find(part=>part.id==='water').required,141);
});

test('ポトフの材料栄養が不明なら0で埋めず、変更後の値も保存可能なnullで残す',()=>{
  const unknown={...data,ingredients:{...data.ingredients,bacon:{...data.ingredients.bacon,nutritionPerUnit:{...data.ingredients.bacon.nutritionPerUnit,fat:null}}}};
  const recipe=buildFoodSelection(defaultFoodSelection('pot-au-feu'),unknown);
  assert.equal(recipe.manualNutrition.fat,null);assert.ok(Number.isFinite(recipe.manualNutrition.protein));
  const catalog={...unknown,recipes:[...unknown.recipes,recipe]};
  const record=createCatalogEntry({recipeId:recipe.id,date,meal:'dinner',status:'planned',amount:1},catalog);
  const state=defaultJournal(date);state.entries=[record];
  assert.equal(parseJournal(JSON.stringify(state),catalog).entries[0].items[0].nutrition.fat,null);
});
