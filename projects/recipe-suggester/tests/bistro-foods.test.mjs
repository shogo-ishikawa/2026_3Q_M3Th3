import test from 'node:test';
import assert from 'node:assert/strict';
import {BISTRO_INGREDIENTS,BISTRO_NUTRITION,BISTRO_RECIPES} from '../bistro-foods.js';
import {INGREDIENTS,RECIPES,ALLERGENS} from '../data.js';
import {NUTRIENT_KEYS,recipeNutrition,itemFromRecipe,itemNutrition} from '../nutrition.js';
import {dishClassification} from '../dish-hierarchy.js';
import {eligibleRecipes} from '../planner.js';
import {createCatalogEntry} from '../record-actions.js';
import {defaultJournal,parseJournal} from '../journal.js';
import {shoppingForEntries} from '../shopping.js';
const ingredients={...INGREDIENTS,...Object.fromEntries(Object.entries(BISTRO_INGREDIENTS).map(([id,food])=>[id,{...food,...BISTRO_NUTRITION[id]}]))};
const data={ingredients,allergens:ALLERGENS,recipes:[...new Map([...RECIPES,...BISTRO_RECIPES].map(r=>[r.id,r])).values()]};
const byId=id=>{const r=BISTRO_RECIPES.find(r=>r.id===`bistro-${id}`);assert.ok(r,id);return r;};
const near=(actual,expected)=>assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<1e-7,`${actual} != ${expected}`);
const date='2026-11-13';

test('洋食16品を主菜8・副菜8として、全材料と具体的な調理手順で独立して追加する',()=>{
  assert.equal(BISTRO_RECIPES.length,16);
  assert.equal(BISTRO_RECIPES.filter(r=>r.role==='main').length,8);
  assert.equal(BISTRO_RECIPES.filter(r=>r.role==='side').length,8);
  assert.equal(new Set(BISTRO_RECIPES.map(r=>r.id)).size,16);
  const previous=RECIPES.filter(r=>!r.id.startsWith('bistro-'));
  for(const r of BISTRO_RECIPES){
    assert.ok(!previous.some(old=>old.id===r.id||old.name===r.name),r.id);
    assert.equal(r.servings,2);assert.equal(r.nature,'home-cooked');
    assert.equal(r.staple,false);assert.equal(r.mealBase,false);
    assert.equal(new Set(r.ingredients.map(p=>p.id)).size,r.ingredients.length,r.id);
    assert.ok(r.ingredients.every(p=>ingredients[p.id]&&Number.isFinite(p.amount)&&p.amount>0),r.id);
    assert.ok(r.steps.length>=3&&r.steps.every(s=>s.length>=10),r.id);
    assert.ok(r.steps.every(s=>!/[0-9]+\s*(?:g|ml|個|枚|皿|人分|つ)/.test(s)),r.id);
    for(const k of NUTRIENT_KEYS)assert.ok(Number.isFinite(recipeNutrition(r,data)[k]),`${r.id}.${k}`);
    assert.equal(dishClassification(r).section,r.role);
    assert.notEqual(dishClassification(r).category,'other');
    assert.match(r.sourceNote,/家庭.*外食/);
    assert.match(r.sourceNote,/https:\/\//);
  }
});

test('ラム脂身つき・殻なしムール貝・液切りエスカルゴを別の状態と可食部で扱う',()=>{
  assert.equal(Object.keys(BISTRO_INGREDIENTS).length,3);
  assert.deepEqual(Object.keys(BISTRO_INGREDIENTS),Object.keys(BISTRO_NUTRITION));
  for(const [id,food]of Object.entries(BISTRO_NUTRITION)){
    assert.equal(food.gramsPerUnit,1);
    assert.match(food.rawNutritionSource,/fooddb\.mext\.go\.jp/);
    assert.ok(Object.isFrozen(food.rawNutritionPerUnit));
    assert.deepEqual(food.rawNutritionPerUnit,food.nutritionPerUnit);
    assert.deepEqual(food.estimatedNutrients,[]);
  }
  const lamb=recipeNutrition({servings:1,ingredients:[{id:'bistro_lamb_loin',amount:100}]},data);
  near(lamb.kcal,287);near(lamb.fat,25.9);near(lamb.protein,15.6);near(lamb.salt,.2);
  const mussel=recipeNutrition({servings:1,ingredients:[{id:'bistro_mussel_raw',amount:100}]},data);
  near(mussel.kcal,63);near(mussel.protein,10.3);near(mussel.salt,1.4);
  assert.match(BISTRO_INGREDIENTS.bistro_mussel_raw.note,/殻.*約2.5倍/);
  const escargot=recipeNutrition({servings:1,ingredients:[{id:'bistro_escargot_canned',amount:100}]},data);
  near(escargot.kcal,75);near(escargot.fat,1);near(escargot.salt,.7);
  assert.match(BISTRO_INGREDIENTS.bistro_escargot_canned.note,/液切り/);
});

test('アヒージョは口にする油全量、フライは吸収油とソース用油を区別して加算する',()=>{
  const ajillo=byId('seafood-broccoli-ajillo');
  const noOil={...ajillo,ingredients:ajillo.ingredients.filter(p=>p.id!=='olive_oil')};
  const full=recipeNutrition(ajillo,data),lean=recipeNutrition(noOil,data);
  near(full.fat-lean.fat,ingredients.olive_oil.nutritionPerUnit.fat*30);
  near(full.kcal-lean.kcal,ingredients.olive_oil.nutritionPerUnit.kcal*30);
  assert.match(ajillo.sourceNote,/全量を口にする/);
  assert.match(ajillo.sourceNote,/食べ残した分は自動では差し引きません/);
  assert.ok(!ajillo.sourceNote.includes('追加・アレンジ'));
  assert.match(ajillo.steps.join(' '),/残した油の栄養は差し引かない/);
  const fried=byId('camembert-fry');
  assert.equal(fried.ingredients.find(p=>p.id==='oil').amount,16);
  assert.equal(fried.ingredients.find(p=>p.id==='olive_oil').amount,4);
  assert.match(fried.sourceNote,/吸収量.*オリーブ油はトマトソース/);
  assert.match(byId('onion-rings').sourceNote,/揚げ鍋に張る全量では/);
});

test('卵・乳・小麦と調味料の大豆やりんごを引き継ぎ、除外で該当する料理だけを落とす',()=>{
  const source=byId('cheese-in-hamburg');
  assert.equal(source.ingredients.find(p=>p.id==='beef_minced').amount,170);
  assert.equal(source.ingredients.find(p=>p.id==='pork_minced').amount,170);
  assert.match(source.steps.join(' '),/選んだひき肉/);
  const burger=itemFromRecipe(source,data);
  for(const id of ['egg','milk','wheat','soy','apple','beef','pork'])assert.ok(burger.allergens.includes(id),id);
  const settings=defaultJournal(date).settings;settings.allergens=['milk'];
  const candidates=eligibleRecipes(settings,{...data,recipes:BISTRO_RECIPES});
  assert.ok(candidates.some(r=>r.id==='bistro-lamb-spice-skewers'));
  assert.ok(!candidates.some(r=>['bistro-cheese-in-hamburg','bistro-camembert-fry','bistro-mentaiko-cheese-baked-potato'].includes(r.id)));
  settings.allergens=[];settings.excludedIngredients=['bistro_lamb_loin'];
  assert.ok(!eligibleRecipes(settings,{...data,recipes:BISTRO_RECIPES}).some(r=>r.id==='bistro-lamb-spice-skewers'));
  assert.ok(recipeNutrition(byId('mentaiko-cheese-baked-potato'),data).salt>1,'明太子とチーズの塩分を計上');
});

test('半皿×4人の買い物と在庫を別に扱い、アヒージョの油も準備する全量を渡す',()=>{
  const recipe=byId('seafood-broccoli-ajillo');
  const entry=createCatalogEntry({recipeId:recipe.id,date,meal:'dinner',status:'planned',amount:.5},data);
  const list=shoppingForEntries([entry],data,{from:date,to:date,servings:4,pantry:[{id:'olive_oil',amount:10}]});
  const oil=list.items.find(p=>p.id==='olive_oil');
  assert.equal(oil.unit,'ml');near(oil.required,60);near(oil.buy,50);
  near(list.items.find(p=>p.id==='shrimp').required,140);
  near(list.items.find(p=>p.id==='salt').required,1.6);
  near(itemNutrition(entry.items[0]).fat,recipeNutrition(recipe,data).fat*.5);
});

test('新料理の数量・栄養をv3の保存へ写し、その後の食材DB変更でも過去の値を保持する',()=>{
  const entry=createCatalogEntry({recipeId:'bistro-lamb-spice-skewers',date,meal:'dinner',status:'eaten',amount:1.5},data);
  const journal=defaultJournal(date);journal.entries=[entry];
  const updated={...data,ingredients:{...ingredients,bistro_lamb_loin:{...ingredients.bistro_lamb_loin,nutritionPerUnit:{...ingredients.bistro_lamb_loin.nutritionPerUnit,kcal:0,fat:0}}}};
  const saved=parseJournal(JSON.stringify(journal),updated);
  assert.deepEqual(saved.entries,journal.entries);
  near(itemNutrition(saved.entries[0].items[0]).kcal,recipeNutrition(byId('lamb-spice-skewers'),data).kcal*1.5);
});

test('食材で不明な成分があれば、その料理と記録の成分も不明のまま保持する',()=>{
  const unknown={...data,ingredients:{...ingredients,bistro_mussel_raw:{...ingredients.bistro_mussel_raw,nutritionPerUnit:{...ingredients.bistro_mussel_raw.nutritionPerUnit,fat:null}}}};
  const recipe=byId('mussel-garlic-bake');
  assert.equal(recipeNutrition(recipe,unknown).fat,null);
  const entry=createCatalogEntry({recipeId:recipe.id,date,meal:'dinner',status:'eaten',amount:1},unknown);
  assert.equal(itemNutrition(entry.items[0]).fat,null);
  assert.ok(itemNutrition(entry.items[0]).kcal>0);
});
