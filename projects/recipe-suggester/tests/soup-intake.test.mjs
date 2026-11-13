import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {dishClassification} from '../dish-hierarchy.js';
import {buildFoodSelection, defaultFoodSelection} from '../food-composer.js';
import {NUTRIENT_KEYS, itemFromRecipe, recipeNutrition} from '../nutrition.js';
import {defaultJournal, parseJournal} from '../journal.js';
import {shoppingForEntries} from '../shopping.js';
import {SOUP_INTAKE_STAGES, buildSoupIntake, soupIntakeFor} from '../soup-intake.js';

const data={ingredients:INGREDIENTS,recipes:RECIPES,allergens:ALLERGENS};
const recipe=id=>RECIPES.find(recipe=>recipe.id===id);
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
const compare=(actual,expected)=>{for(const key of NUTRIENT_KEYS)expected[key]===null?assert.equal(actual[key],null):near(actual[key],expected[key]);};

test('監査済みの汁物・鍋料理は全量摂取で従来値と完全に一致し、1人分へ正規化する',()=>{
  const supported=RECIPES.filter(base=>soupIntakeFor(base,data));assert.equal(supported.length,97);
  for(const base of supported){
    const generated=buildSoupIntake({baseRecipe:base},data);
    assert.deepEqual(recipeNutrition(generated,data),recipeNutrition(base,data),base.id);
    assert.equal(generated.servings,1);
    assert.deepEqual(itemFromRecipe(generated,data).ingredients,itemFromRecipe(base,data).ingredients,base.id);
    assert.equal(generated.role,base.role);assert.equal(generated.family,base.family);
    assert.equal(generated.nutritionBasis,'estimate');
  }
  for(const base of RECIPES.filter(r=>dishClassification(r).method==='hotpot'))assert.ok(soupIntakeFor(base,data),base.id);
});

test('みそ汁で汁だけを残すとみそ・だしの栄養だけ減り、具の栄養は全量残る',()=>{
  const base=recipe('soup-001'),none=buildSoupIntake({baseRecipe:base,brothRatio:0},data),half=buildSoupIntake({baseRecipe:base,brothRatio:.5},data),definition=soupIntakeFor(base,data);
  compare(none.manualNutrition,recipeNutrition({...base,ingredients:base.ingredients.filter(part=>!['miso','water','kombu'].includes(part.id))},data));
  compare(none.manualNutrition,definition.solidNutrition);
  for(const key of NUTRIENT_KEYS)near(half.manualNutrition[key],definition.solidNutrition[key]+definition.brothNutrition[key]*.5);
  assert.ok(none.manualNutrition.salt<recipeNutrition(base,data).salt);
  assert.match(none.sourceNote,/均一/);assert.match(none.sourceNote,/溶け出す脂/);assert.match(none.sourceNote,/過去の記録は変更しません/);
});

test('鍋の付けだれ・つくねの調味料・ワンタンの皮と肉だねは汁0でも具側に残す',()=>{
  for(const id of ['familiar-mizutaki','familiar-pork-shabu','familiar-yudofu']){
    const model=soupIntakeFor(recipe(id),data);assert.equal(model.ingredientFractions.soy_sauce,0);assert.equal(model.ingredientFractions.vinegar,0);
  }
  assert.equal(soupIntakeFor(recipe('familiar-chanko-nabe'),data).ingredientFractions.starch,0);
  assert.equal(soupIntakeFor(recipe('simmered-chicken-salt-lemon-nabe'),data).ingredientFractions.starch,0);
  const wonton=soupIntakeFor(recipe('soup311-wonton-pork'),data);
  assert.equal(wonton.ingredientFractions.soy_sauce,.5);assert.equal(wonton.ingredientFractions.sesame_oil,.5);assert.equal(wonton.ingredientFractions.salt,0);
  const handmade=soupIntakeFor(recipe('soup-038'),data);
  assert.equal(handmade.ingredientFractions.flour,0);assert.equal(handmade.ingredientFractions.water,.9);assert.equal(handmade.ingredientFractions.salt,.5);
});

test('ポタージュは全体を均一とする仮定で減らし、具を残す割合は分離して扱う',()=>{
  const base=recipe('soup-004'),portion=buildSoupIntake({baseRecipe:base,brothRatio:.25,solidRatio:0},data);
  assert.equal(soupIntakeFor(base,data).homogeneous,true);
  for(const key of NUTRIENT_KEYS)near(portion.manualNutrition[key],recipeNutrition(base,data)[key]*.25);
  const miso=recipe('soup-001'),part=buildSoupIntake({baseRecipe:miso,brothRatio:0,solidRatio:.5},data);
  for(const key of NUTRIENT_KEYS)near(part.manualNutrition[key],soupIntakeFor(miso,data).solidNutrition[key]*.5);
});

test('自由に選んだポトフにも割合を適用し、用意する全材料と買い物量を減らさない',()=>{
  const base=buildFoodSelection(defaultFoodSelection('pot-au-feu'),data);
  assert.ok(soupIntakeFor(base,data));
  const none=buildSoupIntake({baseRecipe:base,brothRatio:0},data),full=buildSoupIntake({baseRecipe:base},data);
  assert.deepEqual(none.ingredients,full.ingredients);
  assert.ok(none.manualNutrition.salt<full.manualNutrition.salt);
  const shopping=source=>shoppingForEntries([{id:'planned',date:'2026-11-12',meal:'dinner',status:'planned',items:[itemFromRecipe(source,data,1.5)]}],data,{from:'2026-11-12',to:'2026-11-12',servings:2}).items;
  assert.deepEqual(shopping(none),shopping(base));
  const changed=structuredClone(base);changed.manualNutrition.kcal+=100;
  assert.equal(soupIntakeFor(changed,data),null,'手入力の合計を分解しない');
});

test('割合は0〜1の有限数だけ受け付け、公式合計・任意の料理・麺・従来のおでんを分解しない',()=>{
  for(const ratio of [-1,1.01,Infinity,NaN,'0.5',null])assert.throws(()=>buildSoupIntake({baseRecipe:recipe('soup-001'),brothRatio:ratio},data),/割合/);
  for(const ratio of [-1,Infinity,NaN,'1'])assert.throws(()=>buildSoupIntake({baseRecipe:recipe('soup-001'),solidRatio:ratio},data),/割合/);
  assert.equal(soupIntakeFor({...recipe('soup-001'),manualNutrition:recipeNutrition(recipe('soup-001'),data)},data),null);
  assert.equal(soupIntakeFor({...recipe('soup-001'),id:'custom-other',custom:true},data),null);
  assert.equal(soupIntakeFor({...recipe('soup-001'),ingredients:[...recipe('soup-001').ingredients,{id:'sugar',amount:1}]},data),null);
  const oden=buildFoodSelection(defaultFoodSelection('oden'),data);assert.equal(soupIntakeFor(oden,data),null);
  assert.equal(soupIntakeFor(recipe('noodle-ramen-shoyu'),data),null);
  assert.throws(()=>buildSoupIntake({baseRecipe:recipe('soup-001'),id:'bad-id'},data),/識別子/);
  assert.deepEqual(SOUP_INTAKE_STAGES.map(stage=>stage.fraction),[0,.1,.25,.5,.8,1]);
});

test('マイレシピ保存とJSON復元後も選択割合・栄養・買い物材料を保持し、過去の記録を変更しない',()=>{
  const base=recipe('daily-miso-tonjiru'),before=JSON.stringify(base),old=itemFromRecipe(base,data),oldJSON=JSON.stringify(old);
  const adjusted=buildSoupIntake({baseRecipe:base,brothRatio:.1,solidRatio:.8},data),item=itemFromRecipe(adjusted,data,1.25);
  const journal=defaultJournal('2026-11-12');journal.customRecipes.push(adjusted);journal.entries.push({id:'soup-entry',date:'2026-11-12',meal:'dinner',status:'eaten',note:'',items:[item]});
  const restored=parseJournal(JSON.stringify(journal),data);
  assert.deepEqual(restored.entries[0].items[0].nutrition,item.nutrition);
  assert.deepEqual(restored.entries[0].items[0].ingredients,item.ingredients);
  assert.match(restored.customRecipes[0].sourceNote,/汁10%・具80%/);
  assert.equal(restored.customRecipes[0].servings,1);
  assert.deepEqual(restored.customRecipes[0].manualNutrition,adjusted.manualNutrition);
  assert.equal(JSON.stringify(base),before);assert.equal(JSON.stringify(old),oldJSON);
});
