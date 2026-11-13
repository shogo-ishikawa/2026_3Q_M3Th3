import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {groupMenuRecipes, getVariationGroup} from '../menu-variations.js';
import {buildMeatSelection, defaultMeatSelection, eligibleMeatSelections} from '../meat-choices.js';
import {createCatalogEntry} from '../record-actions.js';
import {defaultJournal, parseJournal} from '../journal.js';
import {recipeNutrition, itemNutrition} from '../nutrition.js';
import {shoppingForEntries} from '../shopping.js';

const data={allergens:ALLERGENS,ingredients:INGREDIENTS,recipes:RECIPES};
const recipeId='mapo-tofu-chen-style', date='2026-11-13';
const source=()=>{const found=RECIPES.find(recipe=>recipe.id===recipeId);assert.ok(found,'本格麻婆豆腐を公開DBへ統合する');return found;};
const amounts=recipe=>Object.fromEntries(recipe.ingredients.map(part=>[part.id,part.amount]));
const near=(actual,expected)=>assert.ok(typeof actual==='number'&&Number.isFinite(actual)&&Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
const entry=(id=recipeId,catalog=data)=>createCatalogEntry({recipeId:id,date,meal:'dinner',status:'planned',amount:1},catalog);
const shopping=entries=>shoppingForEntries(entries,data,{from:date,to:date,servings:2,pantry:[]});

// ユーザー指定の代用品は、葉ではなく生の花茎として重量と栄養を扱う。
test('本格麻婆豆腐はにんにくの芽を使う家庭用2皿で、香辛調味料と油を材料へ含める',()=>{
  const recipe=source(),parts=amounts(recipe);
  assert.equal(recipe.servings,2);assert.deepEqual(recipe.portion,{amount:1,unit:'皿'});
  assert.match(recipe.name,/陳建一風/);assert.match(recipe.sourceNote,/家庭用2皿/);
  assert.equal(parts.tofu,400);assert.equal(parts.pork_minced,100);assert.equal(parts.mapo_garlic_shoots,40);
  assert.equal(parts.mapo_doubanjiang,18);assert.equal(parts.mapo_tianmianjiang,18);
  assert.equal(parts.mapo_douchi,10);assert.equal(parts.mapo_huajiao,.5);
  assert.equal(parts.oil,20);assert.equal(parts.mapo_chilli_oil,10);
  assert.equal(parts.water,170);assert.equal(parts.starch,10);
  assert.match(INGREDIENTS.mapo_garlic_shoots.name,/茎にんにく/);
  assert.ok(recipe.ingredients.every(part=>!/^leaf[-_]|garlic_leaf|leaf_garlic/.test(part.id)));
  assert.ok(recipe.steps.findIndex(step=>/にんにくの芽を加え/.test(step))<recipe.steps.findIndex(step=>/豆板醤/.test(step)),'硬い花茎を香辛調味料より先に炒める');
});

test('麻婆豆腐の初期表示は本格版で、以前の辛くない料理も選択肢に保持する',()=>{
  const group=groupMenuRecipes(RECIPES).find(group=>group.groupId==='mapo-tofu');
  assert.ok(group);assert.equal(group.selectedRecipeId,recipeId);
  assert.deepEqual(new Set(group.recipes.map(recipe=>recipe.id)),new Set([recipeId,'tofu-mapo']));
  const mild=RECIPES.find(recipe=>recipe.id==='tofu-mapo');
  assert.match(mild.name,/辛くない/);
  assert.deepEqual(amounts(mild),{silken_tofu:350,pork_minced:150,negi:80,ginger:8,miso:20,soy_sauce:15,starch:10,water:200,oil:10});
  assert.equal(getVariationGroup('tofu-mapo',RECIPES).selectedRecipeId,'tofu-mapo');
  const matching=groupMenuRecipes(group.recipes,{query:'辛くない'})[0];
  assert.equal(matching.selectedRecipeId,'tofu-mapo','明示検索では辛くない方へ到達する');
  const filtered=groupMenuRecipes([mild])[0];
  assert.equal(filtered.selectedRecipeId,'tofu-mapo','本格版が除外されても候補へ補い戻さない');
});

test('本格版の肉変更は1人50gを保ち、香辛調味料・豆腐・にんにくの芽を変更しない',()=>{
  const original=source(),before=JSON.stringify(original);
  assert.equal(defaultMeatSelection(recipeId).meatId,'pork');
  const pork=buildMeatSelection({recipeId,meatId:'pork'},data);
  const beef=buildMeatSelection({recipeId,meatId:'beef'},data);
  const chicken=buildMeatSelection({recipeId,meatId:'chicken'},data);
  const mixed=buildMeatSelection({recipeId,meatId:'mixed'},data);
  const expected=Object.fromEntries(original.ingredients.filter(part=>part.id!=='pork_minced').map(part=>[part.id,part.amount/2]));
  for(const recipe of [pork,beef,chicken,mixed]){
    assert.equal(recipe.servings,1);
    assert.deepEqual(Object.fromEntries(recipe.ingredients.filter(part=>!['pork_minced','beef_minced','chicken_minced'].includes(part.id)).map(part=>[part.id,part.amount])),expected);
  }
  assert.equal(amounts(pork).pork_minced,50);assert.equal(amounts(beef).beef_minced,50);
  assert.equal(amounts(chicken).chicken_minced,50);assert.equal(amounts(mixed).pork_minced,25);assert.equal(amounts(mixed).beef_minced,25);
  // MEXT生ひき肉100g: 豚209kcal/F17.2g、牛251kcal/F21.1g、鶏171kcal/F12g。
  near(recipeNutrition(beef,data).kcal-recipeNutrition(pork,data).kcal,21);
  near(recipeNutrition(beef,data).fat-recipeNutrition(pork,data).fat,1.95);
  near(recipeNutrition(chicken,data).kcal-recipeNutrition(pork,data).kcal,-19);
  near(recipeNutrition(chicken,data).fat-recipeNutrition(pork,data).fat,-2.6);
  assert.equal(JSON.stringify(original),before);
  assert.equal(eligibleMeatSelections(recipeId,{allergens:['wheat']},data).length,0);
  assert.ok(eligibleMeatSelections(recipeId,{allergens:['pork']},data).every(choice=>!['pork','mixed'].includes(choice.config.meatId)));
});

test('1皿ずつ2人分の買い物はにんにくの芽40g・豆腐400gで、油と水溶き片栗粉を二重計上しない',()=>{
  const recorded=entry(),result=shopping([recorded]);
  const required=id=>{const row=result.items.find(row=>row.id===id);assert.ok(row,id);return row;};
  assert.equal(required('mapo_garlic_shoots').unit,'g');near(required('mapo_garlic_shoots').required,40);
  near(required('tofu').required,400);near(required('pork_minced').required,100);
  near(required('oil').required,20);assert.equal(required('oil').unit,'ml');
  near(required('mapo_chilli_oil').required,10);assert.equal(required('mapo_chilli_oil').unit,'g');
  near(required('starch').required,10);near(required('water').required,170);
  assert.equal(result.missingMenus.length,0);
  const withStock=shoppingForEntries([recorded],data,{from:date,to:date,servings:2,pantry:[{id:'mapo_garlic_shoots',amount:15}]});
  near(withStock.items.find(row=>row.id==='mapo_garlic_shoots').buy,25);
  near(itemNutrition(recorded.items[0]).kcal,recipeNutrition(source(),data).kcal);
});

test('新しい麻婆豆腐を保存しても、既存の辛くない記録やその時の栄養を上書きしない',()=>{
  const state=defaultJournal(date),mild=entry('tofu-mapo');
  const composed=buildMeatSelection({recipeId,meatId:'mixed'},data);
  const customData={...data,recipes:[...RECIPES,composed]};
  state.entries=[mild,entry(composed.id,customData)];state.customRecipes=[composed];
  const expected=structuredClone(state.entries);
  const changedData={...data,ingredients:{...INGREDIENTS,mapo_garlic_shoots:{...INGREDIENTS.mapo_garlic_shoots,nutritionPerUnit:{...INGREDIENTS.mapo_garlic_shoots.nutritionPerUnit,kcal:999}}}};
  const loaded=parseJournal(JSON.stringify(state),changedData);
  assert.deepEqual(loaded.entries,expected);
  assert.equal(loaded.entries[0].items[0].recipeId,'tofu-mapo');
  assert.match(loaded.entries[0].items[0].name,/辛くない/);
  assert.equal(loaded.customRecipes[0].manualNutrition.kcal,composed.manualNutrition.kcal);
});

test('香辛料の成分値が不明なら、肉変更後も不明を0にして保存しない',()=>{
  const uncertain={...data,ingredients:{...INGREDIENTS,mapo_huajiao:{...INGREDIENTS.mapo_huajiao,nutritionPerUnit:{...INGREDIENTS.mapo_huajiao.nutritionPerUnit,fiber:null}}}};
  assert.equal(recipeNutrition(source(),uncertain).fiber,null);
  const recipe=buildMeatSelection({recipeId,meatId:'pork'},uncertain);
  assert.equal(recipe.manualNutrition.fiber,null);
  const state=defaultJournal(date);state.customRecipes=[recipe];
  state.entries=[entry(recipe.id,{...uncertain,recipes:[...RECIPES,recipe]})];
  const loaded=parseJournal(JSON.stringify(state),uncertain);
  assert.equal(loaded.customRecipes[0].manualNutrition.fiber,null);
  assert.equal(loaded.entries[0].items[0].nutrition.fiber,null);
});
