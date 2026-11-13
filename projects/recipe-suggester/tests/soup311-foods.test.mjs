import test from 'node:test';
import assert from 'node:assert/strict';
import {SOUP311_INGREDIENTS,SOUP311_NUTRITION,SOUP311_RECIPES} from '../soup311-foods.js';
import {INGREDIENTS,RECIPES,ALLERGENS} from '../data.js';
import {NUTRIENT_KEYS,recipeNutrition,itemFromRecipe,itemNutrition} from '../nutrition.js';
import {recipePortion} from '../catalog.js';
import {eligibleRecipes} from '../planner.js';
import {createCatalogEntry} from '../record-actions.js';
import {defaultJournal,parseJournal} from '../journal.js';
import {shoppingForEntries} from '../shopping.js';
const ids=new Set(SOUP311_RECIPES.map(recipe=>recipe.id));
const ingredients={...INGREDIENTS,...Object.fromEntries(Object.entries(SOUP311_INGREDIENTS).map(([id,value])=>[id,{...value,...SOUP311_NUTRITION[id]}]))};
const data={ingredients,recipes:[...RECIPES.filter(recipe=>!ids.has(recipe.id)),...SOUP311_RECIPES],allergens:ALLERGENS};
const near=(actual,expected)=>assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
const byId=id=>{const recipe=SOUP311_RECIPES.find(recipe=>recipe.id===`soup311-${id}`);assert.ok(recipe,id);return recipe;};
const nutrients=rows=>recipeNutrition({servings:1,ingredients:rows},data);
const date='2026-11-13';

test('追加9スープは既存のクリーム・豆乳・鶏ワンタンを重複させず、2人分の材料で計算する',()=>{
  assert.equal(SOUP311_RECIPES.length,9);
  const existing=RECIPES.filter(recipe=>!ids.has(recipe.id));
  for(const recipe of SOUP311_RECIPES){
    assert.ok(!existing.some(previous=>previous.name===recipe.name),recipe.id);
    assert.equal(recipe.servings,2);assert.equal(recipe.role,'soup');assert.equal(recipe.family,'soup');
    assert.equal(recipe.staple,false);assert.equal(recipe.mealBase,false);
    assert.equal(recipe.nature,'home-cooked');assert.equal(recipePortion(recipe,data).unit,'杯');
    assert.equal(new Set(recipe.ingredients.map(part=>part.id)).size,recipe.ingredients.length);
    assert.ok(recipe.ingredients.every(part=>ingredients[part.id]&&Number.isFinite(part.amount)&&part.amount>0));
    assert.ok(recipe.steps.length>=3&&recipe.steps.every(step=>step.length>=10));
    assert.ok(recipe.steps.every(step=>!/[0-9]+\s*(?:g|ml|個|枚|皿|人分|つ)/.test(step)),recipe.id);
    assert.ok(NUTRIENT_KEYS.every(key=>Number.isFinite(recipeNutrition(recipe,data)[key])),recipe.id);
  }
  for(const id of ['familiar-side-clam-chowder','soup-004','soup-038'])assert.ok(data.recipes.some(recipe=>recipe.id===id),id);
});

test('抽出済み合わせだしの100mlを換算し、Trと未掲載値は原値を残して補完する',()=>{
  const raw=SOUP311_NUTRITION.soup311_awase_dashi;
  assert.equal(SOUP311_INGREDIENTS.soup311_awase_dashi.unit,'ml');
  assert.equal(raw.gramsPerUnit,1);assert.equal(raw.rawNutritionPerUnit.fat,null);assert.equal(raw.rawNutritionPerUnit.fiber,null);
  assert.deepEqual(raw.estimatedNutrients,['fat','fiber']);
  const n=nutrients([{id:'soup311_awase_dashi',amount:100}]);
  near(n.kcal,2);near(n.protein,.3);near(n.fat,.03);near(n.carbs,.3);near(n.fiber,0);near(n.salt,.1);
  assert.match(SOUP311_INGREDIENTS.soup311_awase_dashi.note,/取り除いた液体/);
  assert.ok(!byId('osuimono-tofu-wakame').ingredients.some(part=>['bonito','kombu'].includes(part.id)),'だしがらの栄養を二重加算しない');
});

test('コンソメの公式5.3g値とワンタン皮の公式110g値を正しい基準で使う',()=>{
  const stock=nutrients([{id:'soup311_consomme',amount:5.3}]);
  near(stock.kcal,12);near(stock.protein,.36);near(stock.fat,.26);near(stock.carbs,2);near(stock.salt,2.4);
  assert.equal(SOUP311_NUTRITION.soup311_consomme.rawNutritionPerUnit.fiber,null);
  assert.deepEqual(SOUP311_NUTRITION.soup311_consomme.estimatedNutrients,['fiber']);
  const skin=nutrients([{id:'soup311_wonton_wrappers',amount:44}]);
  near(skin.kcal,118.8);near(skin.protein,3.6);near(skin.fat,.48);near(skin.carbs,25.44);near(skin.fiber,.76);near(skin.salt,.28);
  assert.deepEqual(SOUP311_NUTRITION.soup311_wonton_wrappers.estimatedNutrients,[]);
  near(recipeNutrition(byId('consomme-plain'),data).salt,1.2);
});

test('殻付きあさりの可食率30%を一度だけ適用し、魚のあらは骨を除いた身の量で扱う',()=>{
  const shell=nutrients([{id:'clam',amount:200}]);
  near(ingredients.clam.gramsPerUnit,.3);near(shell.kcal,17.4);near(shell.protein,3.42);
  const asari=byId('osuimono-asari');assert.equal(asari.ingredients.find(part=>part.id==='clam').amount,200);
  assert.match(asari.sourceNote,/可食率30%を一度だけ/);
  for(const [slug,id]of [['arajiru-salmon','salmon'],['arajiru-buri','yellowtail']]){
    const recipe=byId(slug);assert.equal(recipe.ingredients.find(part=>part.id===id).amount,160);
    assert.match(recipe.sourceNote,/骨付きあらの購入重量ではありません/);
    assert.match(recipe.sourceNote,/骨そのものの重量は栄養に加えません/);
    assert.ok(!recipe.ingredients.some(part=>/bones|fishhead/.test(part.id)));
  }
});

test('スープの素・皮・肉由来のアレルゲンと除外食材を引き継ぐ',()=>{
  const plain=itemFromRecipe(byId('consomme-plain'),data);
  for(const id of ['wheat','milk','beef','soy','chicken'])assert.ok(plain.allergens.includes(id),id);
  const wonton=itemFromRecipe(byId('wonton-pork'),data);
  for(const id of ['wheat','soy','pork','chicken','sesame'])assert.ok(wonton.allergens.includes(id),id);
  const settings=defaultJournal(date).settings;settings.allergens=['milk'];
  const allowed=new Set(eligibleRecipes(settings,{...data,recipes:SOUP311_RECIPES}).map(recipe=>recipe.id));
  assert.ok(allowed.has('soup311-osuimono-tofu-wakame'));
  for(const slug of ['consomme-plain','consomme-vegetable','pumpkin-milk-potage','clam-chowder-tomato'])assert.ok(!allowed.has(`soup311-${slug}`));
  settings.allergens=[];settings.excludedIngredients=['pork'];
  assert.ok(!eligibleRecipes(settings,{...data,recipes:SOUP311_RECIPES}).some(recipe=>recipe.id==='soup311-wonton-pork'));
});

test('全スープの半杯を記録・復元し、元DBが変わっても保存した量と栄養を保つ',()=>{
  const journal=defaultJournal(date);
  for(const recipe of SOUP311_RECIPES){
    const entry=createCatalogEntry({recipeId:recipe.id,date,meal:'dinner',status:'planned',amount:.5},data);
    assert.equal(entry.items[0].quantity,.5);
    for(const key of NUTRIENT_KEYS)near(itemNutrition(entry.items[0])[key],recipeNutrition(recipe,data)[key]/2);
    journal.entries.push(entry);
  }
  const restored=parseJournal(JSON.stringify(journal),data);
  assert.deepEqual(restored.entries,journal.entries);
  const preserved=structuredClone(restored.entries[0].items[0]);
  const changed={...data,recipes:[],ingredients:{...data.ingredients,soup311_awase_dashi:{...data.ingredients.soup311_awase_dashi,nutritionPerUnit:Object.fromEntries(NUTRIENT_KEYS.map(key=>[key,999]))}}};
  assert.deepEqual(parseJournal(JSON.stringify(restored),changed).entries[0].items[0],preserved);
});

test('半杯×3人分の買い物で殻付き重量・皮・汁を一度だけ倍率計算し在庫を差し引く',()=>{
  const entries=['osuimono-asari','wonton-pork','consomme-plain'].map(slug=>createCatalogEntry({recipeId:byId(slug).id,date,meal:'dinner',status:'planned',amount:.5},data));
  const result=shoppingForEntries(entries,data,{from:date,to:date,servings:3,pantry:[{id:'soup311_wonton_wrappers',amount:5},{id:'clam',amount:20}]});
  const byIngredient=id=>{const row=result.items.find(item=>item.id===id);assert.ok(row,id);return row;};
  near(byIngredient('clam').required,150);near(byIngredient('clam').buy,130);
  near(byIngredient('soup311_wonton_wrappers').required,33);near(byIngredient('soup311_wonton_wrappers').buy,28);
  near(byIngredient('soup311_consomme').required,3.975);
  near(byIngredient('water').required,525);
  near(byIngredient('noodle_chinese_stock').required,300);
  assert.equal(result.missingMenus.length,0);
});

test('未掲載の栄養を不明へ戻した場合はレシピ・保存でもnullを保持する',()=>{
  const uncertain={...data,ingredients:{...ingredients,soup311_consomme:{...ingredients.soup311_consomme,nutritionPerUnit:{...ingredients.soup311_consomme.nutritionPerUnit,fiber:null}}}};
  const item=itemFromRecipe(byId('consomme-plain'),uncertain);
  assert.equal(item.nutrition.fiber,null);
  assert.equal(itemNutrition(item).fiber,null);
  assert.match(SOUP311_NUTRITION.soup311_consomme.nutritionSource,/未表示/);
  for(const [id,profile]of Object.entries(SOUP311_NUTRITION)){
    assert.match(profile.rawNutritionSource,/https:\/\//,id);
    assert.ok(Object.isFrozen(profile.nutritionPerUnit));
  }
});
