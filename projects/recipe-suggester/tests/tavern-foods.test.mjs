import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {TAVERN_INGREDIENTS,TAVERN_NUTRITION,TAVERN_RECIPES} from '../tavern-foods.js';
import {recipeNutrition,itemFromRecipe,itemNutrition,NUTRIENT_KEYS} from '../nutrition.js';
import {dishClassification} from '../dish-hierarchy.js';
import {eligibleRecipes} from '../planner.js';
import {createCatalogEntry} from '../record-actions.js';
import {defaultJournal,parseJournal,validateJournal} from '../journal.js';
import {shoppingForEntries} from '../shopping.js';

const ingredients={...INGREDIENTS,...Object.fromEntries(Object.entries(TAVERN_INGREDIENTS).map(([id,food])=>[id,{...food,...TAVERN_NUTRITION[id]}]))};
const data={ingredients,recipes:[...new Map([...RECIPES,...TAVERN_RECIPES].map(recipe=>[recipe.id,recipe])).values()],allergens:ALLERGENS};
const recipe=id=>TAVERN_RECIPES.find(item=>item.id===`tavern-${id}`);
const near=(actual,expected)=>assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
const date='2026-11-13';

test('中華・焼鳥店を参考にした14のおかずは米を含めず、家庭の材料と具体的な工程で記録できる',()=>{
  assert.equal(TAVERN_RECIPES.length,14);
  assert.equal(new Set(TAVERN_RECIPES.map(item=>item.id)).size,14);
  assert.equal(new Set(TAVERN_RECIPES.map(item=>item.name)).size,14);
  const oldNames=new Set(RECIPES.filter(item=>!item.id.startsWith('tavern-')).map(item=>item.name));
  for(const item of TAVERN_RECIPES){
    assert.ok(!oldNames.has(item.name),item.id);
    assert.equal(item.servings,2);assert.equal(item.nature,'home-cooked');
    assert.equal(item.staple,false);assert.equal(item.mealBase,false);
    assert.ok(['main','side'].includes(item.role));
    assert.equal(new Set(item.ingredients.map(part=>part.id)).size,item.ingredients.length);
    assert.ok(item.ingredients.every(part=>ingredients[part.id]&&part.amount>0),item.id);
    assert.ok(!item.ingredients.some(part=>part.id==='rice'),item.id);
    assert.ok(item.steps.length>=4&&item.steps.every(step=>step.length>=10));
    assert.ok(item.steps.every(step=>!/[0-9]+\s*(?:g|ml|個|枚|皿|人分|つ)/.test(step)),item.id);
    assert.match(item.sourceNote,/家庭|家庭用/);assert.match(item.sourceNote,/https:\/\//);
    assert.ok(!Object.hasOwn(item,'manualNutrition'),'店舗の完成品表示から家庭用の栄養を作らない');
    const nutrition=recipeNutrition(item,data);
    assert.ok(NUTRIENT_KEYS.every(key=>Number.isFinite(nutrition[key])&&nutrition[key]>=0),item.id);
    assert.ok(nutrition.kcal>25&&nutrition.kcal<850,item.id);
    assert.equal(dishClassification(item).category,item.displayCategory);
    assert.equal(dishClassification(item).method,item.displayMethod);
  }
});

test('豚レバー・鶏砂肝・鶏ハツは部位の栄養差を保持し、乾燥きくらげを戻し後のgで計算しない',()=>{
  assert.equal(Object.keys(TAVERN_INGREDIENTS).length,5);
  assert.deepEqual(Object.keys(TAVERN_NUTRITION),Object.keys(TAVERN_INGREDIENTS));
  const values=id=>recipeNutrition({servings:1,ingredients:[{id,amount:100}]},data);
  const liver=values('tavern_pork_liver'),gizzard=values('tavern_chicken_gizzard'),heart=values('tavern_chicken_heart');
  near(liver.kcal,114);near(liver.protein,20.4);near(liver.fat,3.4);
  near(gizzard.kcal,86);near(gizzard.fat,1.8);near(heart.kcal,186);near(heart.fat,15.5);
  near(values('tavern_wood_ear_dried').fiber,57.4);
  assert.match(TAVERN_INGREDIENTS.tavern_wood_ear_dried.name,/戻す前/);
  assert.deepEqual(recipe('pork-wood-ear-egg').ingredients.find(part=>part.id==='tavern_wood_ear_dried'),{id:'tavern_wood_ear_dried',amount:6});
  assert.match(recipe('pork-wood-ear-egg').steps[0],/戻し水は捨て/);
  for(const [id,profile]of Object.entries(TAVERN_NUTRITION)){
    assert.equal(profile.gramsPerUnit,id==='tavern_onsen_egg'?47:1,id);assert.match(profile.rawNutritionSource,id==='tavern_onsen_egg'?/valor\.jp/:/fooddb\.mext\.go\.jp/);
    assert.ok(Object.isFrozen(profile));assert.ok(Object.isFrozen(profile.nutritionPerUnit));
  }
});

test('Trを実測ゼロへ変えず、計算用の概算と不明値の伝播を分ける',()=>{
  for(const id of ['tavern_chicken_gizzard','tavern_chicken_heart']){
    assert.equal(TAVERN_NUTRITION[id].rawNutritionPerUnit.carbs,null);
    near(TAVERN_NUTRITION[id].nutritionPerUnit.carbs,.0003);
    assert.deepEqual(TAVERN_NUTRITION[id].estimatedNutrients,['carbs']);
    assert.match(TAVERN_NUTRITION[id].nutritionSource,/Tr/);
  }
  const changed={...data,ingredients:{...ingredients,tavern_pork_liver:{...ingredients.tavern_pork_liver,nutritionPerUnit:{...ingredients.tavern_pork_liver.nutritionPerUnit,fat:null}}}};
  assert.equal(recipeNutrition(recipe('liver-chive'),changed).fat,null);
  assert.ok(recipeNutrition(recipe('liver-chive'),changed).protein>20);
});

test('肉や調味料のアレルゲンと親食材の除外を献立候補へ反映する',()=>{
  const settings=defaultJournal(date).settings;
  settings.allergens=['pork'];
  const allowed=new Set(eligibleRecipes(settings,{...data,recipes:TAVERN_RECIPES}).map(item=>item.id));
  assert.ok(!allowed.has('tavern-liver-chive'));
  assert.ok(!allowed.has('tavern-negi-chashu'));
  assert.ok(allowed.has('tavern-fluffy-yam-pan'));
  settings.allergens=[];settings.excludedIngredients=['chicken'];
  const excluded=new Set(eligibleRecipes(settings,{...data,recipes:TAVERN_RECIPES}).map(item=>item.id));
  assert.ok(!excluded.has('tavern-gizzard-heart-ponzu'));
  assert.ok(!excluded.has('tavern-chicken-mentaiko-mayo'));
  assert.ok(itemFromRecipe(recipe('chive-kimchi-tofu'),data).allergens.includes('soy'));
  assert.ok(itemFromRecipe(recipe('chicken-mentaiko-mayo'),data).allergens.includes('egg'));
  assert.ok(itemFromRecipe(recipe('negi-chashu'),data).allergens.includes('sesame'));
});

test('14品の皿倍率をその時点の材料・栄養としてJSON往復し、DB更新後も値を変えない',()=>{
  const state=defaultJournal(date);
  state.entries=TAVERN_RECIPES.map(item=>createCatalogEntry({recipeId:item.id,date,meal:'dinner',status:'planned',amount:.5,note:''},data));
  const saved=validateJournal(state,data),restored=parseJournal(JSON.stringify(saved),data);
  assert.equal(restored.entries.length,14);
  for(let index=0;index<14;index++){
    const item=restored.entries[index].items[0],nutrition=recipeNutrition(TAVERN_RECIPES[index],data);
    assert.equal(item.quantity,.5);
    for(const key of NUTRIENT_KEYS)near(itemNutrition(item)[key],nutrition[key]*.5);
  }
  const mutated={...data,ingredients:Object.fromEntries(Object.entries(ingredients).map(([id,food])=>[id,{...food,nutritionPerUnit:Object.fromEntries(NUTRIENT_KEYS.map(key=>[key,0]))}]))};
  assert.equal(JSON.stringify(parseJournal(JSON.stringify(saved),mutated).entries),JSON.stringify(saved.entries));
});

test('半皿を3人分買う場合は生の部位・乾燥食材・調味料を量倍し、在庫は一度引く',()=>{
  const selected=[recipe('liver-chive'),recipe('pork-wood-ear-egg'),recipe('gizzard-heart-ponzu')];
  const entries=selected.map(item=>createCatalogEntry({recipeId:item.id,date,meal:'dinner',status:'planned',amount:.5,note:''},data));
  const shopping=shoppingForEntries(entries,data,{from:date,to:date,servings:3,pantry:[{id:'tavern_pork_liver',amount:50},{id:'soy_sauce',amount:8}]});
  assert.deepEqual(shopping.missingMenus,[]);
  const row=id=>shopping.items.find(item=>item.id===id);
  near(row('tavern_pork_liver').required,165);near(row('tavern_pork_liver').buy,115);
  near(row('tavern_wood_ear_dried').required,4.5);
  near(row('tavern_chicken_gizzard').required,105);
  near(row('soy_sauce').required,(12+14+14)*.75);near(row('soy_sauce').buy,(12+14+14)*.75-8);
  assert.ok(!shopping.items.some(item=>item.id==='rice'));
});

test('明太マヨ・たれかつの吸収油・自作昆布だれも抜かさず、工程と材料の役割を明記する',()=>{
  const mentai=recipe('chicken-mentaiko-mayo');
  const without=recipeNutrition({...mentai,ingredients:mentai.ingredients.filter(part=>!['mayonnaise','acmp_mentaiko'].includes(part.id))},data);
  const withSauce=recipeNutrition(mentai,data);
  assert.ok(withSauce.fat>without.fat);assert.ok(withSauce.salt>without.salt);
  near(TAVERN_NUTRITION.tavern_onsen_egg.nutritionPerUnit.kcal,66);
  assert.equal(TAVERN_NUTRITION.tavern_onsen_egg.rawNutritionPerUnit.fiber,null);
  assert.deepEqual(TAVERN_NUTRITION.tavern_onsen_egg.estimatedNutrients,['fiber']);
  const cutlet=recipe('tare-chicken-katsu-egg');
  assert.deepEqual(cutlet.ingredients.find(part=>part.id==='oil'),{id:'oil',amount:22});
  assert.match(cutlet.sourceNote,/吸収量/);assert.match(cutlet.steps.join(' '),/75℃で1分以上/);
  assert.match(recipe('negi-kombu').steps.join(' '),/昆布を全量食べる/);
  assert.match(recipe('liver-chive').steps.join(' '),/中心75℃で1分以上/);
  assert.match(recipe('gizzard-heart-ponzu').steps.join(' '),/中心75℃で1分以上/);
});
