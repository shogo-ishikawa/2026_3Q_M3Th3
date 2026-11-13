import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {buildFoodSelection} from '../food-composer.js';
import {classifyNutritionBasis} from '../nutrition-basis.js';
import {NUTRIENT_KEYS,itemFromRecipe,recipeNutrition} from '../nutrition.js';
import {defaultJournal,validateJournal} from '../journal.js';

const data={allergens:ALLERGENS,ingredients:INGREDIENTS,recipes:RECIPES};
const source=RECIPES.find(recipe=>recipe.id==='takeaway-yakitori-momo-tare');
const compose=(components,current=data)=>buildFoodSelection({kind:'yakitori',components},current);
const withSource=changes=>({...data,recipes:RECIPES.map(recipe=>recipe.id===source.id?{...recipe,...changes}:recipe)});
const purchased=[{id:'takeaway-momo-tare',amount:2}];
const close=(actual,expected)=>assert.ok(typeof actual==='number'&&Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);

test('購入品だけの組み合わせは実際の出典説明と基準量を保存して表示値を引き継ぐ',()=>{
  const recipe=compose(purchased),values=recipeNutrition(source,data);
  assert.equal(recipe.nutritionBasis,'official');assert.equal(classifyNutritionBasis(recipe,data).label,'公式表示値（参考）');
  assert.ok(recipe.sourceNote.includes(source.sourceNote));assert.match(recipe.sourceNote,/参照元（もも・たれ（購入品））/);
  assert.match(recipe.sourceNote,/https:\/\//);assert.match(recipe.sourceNote,/2本/);
  for(const key of NUTRIENT_KEYS)assert.equal(recipe.manualNutrition[key],values[key]===null?null:values[key]*2);
  assert.deepEqual(recipe.ingredients,source.ingredients.map(part=>({id:part.id,amount:part.amount/source.servings*2})));
  assert.equal(itemFromRecipe(recipe,data).nutritionBasis,'official');
});

test('手作りと表示値を混ぜた場合は表示値＋概算とし、各種類の栄養を一度だけ合算する',()=>{
  const handmade=compose([{id:'thigh-salt',amount:1}]),official=compose([{id:'takeaway-momo-tare',amount:1}]);
  const combined=compose([{id:'thigh-salt',amount:1},{id:'takeaway-momo-tare',amount:1}]);
  assert.equal(handmade.nutritionBasis,'ingredients');assert.equal(combined.nutritionBasis,'mixed');
  assert.ok(combined.sourceNote.includes(source.sourceNote));
  for(const key of NUTRIENT_KEYS){const expected=handmade.manualNutrition[key]===null||official.manualNutrition[key]===null?null:handmade.manualNutrition[key]+official.manualNutrition[key];if(expected===null)assert.equal(combined.manualNutrition[key],null);else close(combined.manualNutrition[key],expected);}
  const tempura=buildFoodSelection({kind:'tempura',components:[{id:'takeaway-shrimp',amount:1},{id:'dipping-sauce',amount:10}]},data);
  assert.equal(tempura.nutritionBasis,'mixed');assert.match(tempura.sourceNote,/https:\/\//);
});

test('合算する前の根拠未記録を、出典の文言や計算だけで昇格させない',()=>{
  const current=withSource({nutritionBasis:'unknown',sourceNote:'公式表示 https://example.com/label'});
  const recipe=compose(purchased,current),mixed=compose([...purchased,{id:'thigh-salt',amount:1}],current);
  assert.equal(recipe.nutritionBasis,'unknown');assert.equal(mixed.nutritionBasis,'unknown');
  assert.match(recipe.sourceNote,/公式表示 https/);
  assert.deepEqual(recipe.manualNutrition,compose(purchased).manualNutrition);
});

test('手入力だけなら手入力を保ち、手入力と材料・配合モデルの合算は概算とする',()=>{
  const manual=withSource({nutritionBasis:'manual'});
  assert.equal(compose(purchased,manual).nutritionBasis,'manual');
  assert.equal(compose([...purchased,{id:'thigh-salt',amount:1}],manual).nutritionBasis,'estimate');
  assert.equal(compose(purchased,withSource({nutritionBasis:'estimate'})).nutritionBasis,'estimate');
  assert.equal(compose(purchased,withSource({nutritionBasis:'mixed'})).nutritionBasis,'mixed');
});

test('公式分類でも参照説明を保存できない場合は公式の組み合わせとして扱わない',()=>{
  for(const sourceNote of ['',`長い出典メモ${'あ'.repeat(1900)} https://example.com/label`]){
    const recipe=compose(purchased,withSource({sourceNote}));
    assert.equal(recipe.nutritionBasis,'mixed');assert.ok(recipe.sourceNote.length<=2000);
    assert.deepEqual(recipe.manualNutrition,compose(purchased).manualNutrition);
  }
});

test('組み合わせの分類・出典・不明栄養を保存しても元レシピや材料を書き換えない',()=>{
  const before=JSON.stringify(data),recipe=compose(purchased),journal=defaultJournal('2026-11-13');
  journal.customRecipes=[recipe];journal.entries=[{id:'composed-basis',date:'2026-11-13',meal:'dinner',status:'eaten',note:'',items:[itemFromRecipe(recipe,data)]}];
  const saved=validateJournal(JSON.parse(JSON.stringify(journal)),data);
  assert.equal(saved.customRecipes[0].nutritionBasis,'official');assert.equal(saved.entries[0].items[0].nutritionBasis,'official');
  assert.equal(saved.customRecipes[0].sourceNote,recipe.sourceNote);assert.deepEqual(saved.entries[0].items[0].nutrition,recipe.manualNutrition);
  assert.equal(JSON.stringify(data),before);
});
