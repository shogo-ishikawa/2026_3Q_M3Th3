import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {SIMMERED_INGREDIENTS,SIMMERED_NUTRITION,SIMMERED_RECIPES} from '../simmered-foods.js';
import {dishClassification} from '../dish-hierarchy.js';
import {itemFromRecipe,itemNutrition,NUTRIENT_KEYS,recipeNutrition} from '../nutrition.js';
import {createCatalogEntry} from '../record-actions.js';
import {defaultJournal,parseJournal,validateJournal} from '../journal.js';
import {eligibleRecipes} from '../planner.js';
import {shoppingForEntries} from '../shopping.js';

const ingredients={...INGREDIENTS,...Object.fromEntries(Object.entries(SIMMERED_INGREDIENTS).map(([id,meta])=>[id,{...meta,...SIMMERED_NUTRITION[id]}]))};
const data={ingredients,recipes:SIMMERED_RECIPES,allergens:ALLERGENS};
const recipe=id=>{const found=SIMMERED_RECIPES.find(r=>r.id===`simmered-${id}`);assert.ok(found,id);return found;};
const near=(a,b)=>assert.ok(Number.isFinite(a)&&Math.abs(a-b)<1e-7,`${a} != ${b}`);
const values=(id,amount=100)=>recipeNutrition({servings:1,ingredients:[{id,amount}]},data);

test('鍋12種は既存料理と重複せず、ご飯や麺を含まない2人分の主菜として詳細な手順を持つ',()=>{
  assert.equal(SIMMERED_RECIPES.length,12);
  assert.equal(new Set(SIMMERED_RECIPES.map(r=>r.name)).size,12);
  const originals=RECIPES.filter(r=>!r.id.startsWith('simmered-'));
  for(const r of SIMMERED_RECIPES){
    assert.ok(!originals.some(old=>old.id===r.id||old.name===r.name),r.id);
    assert.equal(r.servings,2);assert.equal(r.role,'main');assert.equal(r.staple,false);assert.equal(r.mealBase,false);
    assert.equal(dishClassification(r).method,'hotpot');assert.equal(dishClassification(r).section,'main');
    assert.equal(new Set(r.ingredients.map(p=>p.id)).size,r.ingredients.length,r.id);
    assert.ok(r.ingredients.every(p=>ingredients[p.id]&&p.amount>0),r.id);
    assert.ok(!r.ingredients.some(p=>['rice','udon','ramen_noodles','dish_mochi'].includes(p.id)),r.id);
    assert.equal(r.steps.length,4);assert.ok(r.steps.every(step=>step.length>=25),r.id);
    assert.ok(r.steps.every(step=>!/[0-9]+\s*(?:g|ml|個|枚|皿|人分|つ)/.test(step)),r.id);
    assert.match(r.sourceNote,/全量食べる概算/);assert.match(r.sourceNote,/https:\/\//);
    for(const key of NUTRIENT_KEYS)assert.ok(Number.isFinite(recipeNutrition(r,data)[key]),`${r.id}.${key}`);
  }
});

test('新10食材はMEXT・メーカーの1g値を持ち、皮付き鴨と加熱用牡蠣を既存の肉魚と混同しない',()=>{
  assert.equal(Object.keys(SIMMERED_INGREDIENTS).length,10);
  assert.deepEqual(Object.keys(SIMMERED_INGREDIENTS),Object.keys(SIMMERED_NUTRITION));
  for(const [id,profile]of Object.entries(SIMMERED_NUTRITION)){
    assert.equal(profile.gramsPerUnit,1,id);assert.equal(SIMMERED_INGREDIENTS[id].unit,'g',id);
    assert.match(profile.rawNutritionSource,/https:\/\//,id);assert.ok(Object.isFrozen(profile.nutritionPerUnit));
    for(const key of NUTRIENT_KEYS)assert.ok(Number.isFinite(profile.nutritionPerUnit[key]),`${id}.${key}`);
  }
  near(values('simmered_duck').fat,29);near(values('simmered_duck').kcal,304);
  near(values('simmered_oyster').salt,1.2);near(values('simmered_oyster').protein,6.9);
  assert.match(SIMMERED_INGREDIENTS.simmered_duck.name,/皮つき.*生/);
  assert.match(SIMMERED_INGREDIENTS.simmered_oyster.name,/加熱用.*むき身/);
});

test('柚子こしょうは少量でも公式の塩分を量倍し、未表示繊維と配合仮定を分ける',()=>{
  const v=values('simmered_yuzu_kosho',6);near(v.kcal,3);near(v.salt,.78);near(v.protein,.06);
  const profile=SIMMERED_NUTRITION.simmered_yuzu_kosho;
  assert.equal(profile.rawNutritionPerUnit.fiber,null);assert.deepEqual(profile.estimatedNutrients,['fiber']);
  assert.match(profile.nutritionSource,/実際の配合・分析値ではありません/);
  assert.ok(profile.nutritionPerUnit.fiber>0);
  const r=recipe('chicken-yuzu-kosho-nabe'),without={...r,ingredients:r.ingredients.filter(p=>p.id!=='simmered_yuzu_kosho')};
  near(recipeNutrition(r,data).salt-recipeNutrition(without,data).salt,.39);
});

test('おでん用のつみれ・ごぼう巻・うずら卵を標準個数から製品gへ換算できる',()=>{
  const tsumire=values('simmered_tsumire',18),gobo=values('simmered_gobomaki',27),quail=values('simmered_quail_egg_boiled',9);
  near(tsumire.kcal,98/5);near(tsumire.salt,1.2/5);near(gobo.kcal,144/4);near(gobo.fat,3.9/4);
  near(quail.kcal,162*.09);near(quail.salt,.5*.09);
  assert.equal(SIMMERED_NUTRITION.simmered_tsumire.rawNutritionPerUnit.fiber,null);
  assert.equal(SIMMERED_NUTRITION.simmered_gobomaki.rawNutritionPerUnit.fiber,null);
  near(values('simmered_chikuwabu').fiber,1.5);near(values('simmered_satsumaage').fat,2.4);
});

test('乳・ごま・豚由来だし・柚子こしょうの除外を鍋の分類が迂回しない',()=>{
  const settings=defaultJournal('2026-11-13').settings;
  for(const [allergen,id]of [['milk','ishikari-nabe'],['milk','chicken-tomato-cheese-nabe'],['sesame','soy-milk-tantan-nabe'],['pork','pork-mizore-nabe']]){
    settings.allergens=[allergen];settings.excludedIngredients=[];
    assert.ok(!eligibleRecipes(settings,data).some(r=>r.id===recipe(id).id),`${allergen}/${id}`);
  }
  settings.allergens=[];settings.excludedIngredients=['simmered_yuzu_kosho'];
  assert.ok(!eligibleRecipes(settings,data).some(r=>r.id===recipe('chicken-yuzu-kosho-nabe').id));
  assert.equal(SIMMERED_INGREDIENTS.simmered_satsumaage.allergensKnown,false,'一般品の原材料を確認済みへ格上げしない');
});

test('鍋の半皿記録をJSONへ保存し、人数と在庫は買い物だけの倍率として扱う',()=>{
  const r=recipe('chicken-yuzu-kosho-nabe');
  const entry=createCatalogEntry({recipeId:r.id,date:'2026-11-13',meal:'dinner',status:'planned',amount:.5},data);
  const journal=defaultJournal('2026-11-13');journal.entries=[entry];
  validateJournal(journal,data);const restored=parseJournal(JSON.stringify(journal),data);
  assert.deepEqual(restored.entries,journal.entries);
  near(itemNutrition(entry.items[0]).kcal,recipeNutrition(r,data).kcal*.5);
  const shopping=shoppingForEntries(restored.entries,data,{from:'2026-11-13',to:'2026-11-13',servings:3,pantry:[{id:'simmered_yuzu_kosho',amount:1}]});
  const yuzu=shopping.items.find(row=>row.id==='simmered_yuzu_kosho');
  near(yuzu.required,4.5);near(yuzu.buy,3.5);
  const snapshot=itemFromRecipe(r,data),changed={...data,ingredients:{...ingredients,simmered_yuzu_kosho:{...ingredients.simmered_yuzu_kosho,nutritionPerUnit:{...ingredients.simmered_yuzu_kosho.nutritionPerUnit,salt:100}}}};
  near(itemNutrition(snapshot).salt,recipeNutrition(r,data).salt);
  assert.notEqual(recipeNutrition(r,changed).salt,itemNutrition(snapshot).salt);
});
