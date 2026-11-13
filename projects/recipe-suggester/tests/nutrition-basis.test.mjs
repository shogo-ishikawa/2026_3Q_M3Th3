import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {TAKEAWAY_RECIPES} from '../takeaway-foods.js';
import {CONFECTIONERY_RECIPES} from '../confectionery-foods.js';
import {DESSERT_RECIPES} from '../dessert-foods.js';
import {PERFORMANCE_RECIPES} from '../performance-foods.js';
import {ACCOMPANIMENT_RECIPES} from '../accompaniment-foods.js';
import {PREPARED_RECIPES} from '../prepared-foods.js';
import {classifyNutritionBasis,deriveRecipeBasis,NUTRITION_BASIS_KINDS,validateNutritionBasis} from '../nutrition-basis.js';
import {itemFromRecipe,recipeNutrition} from '../nutrition.js';
import {defaultJournal,validateJournal} from '../journal.js';
import {buildRestaurantRecipe} from '../restaurant-menu.js';

const data={ingredients:INGREDIENTS,recipes:RECIPES,allergens:ALLERGENS};
const plain=RECIPES.find(recipe=>recipe.id==='plain-rice');
const candy=CONFECTIONERY_RECIPES.find(recipe=>recipe.id==='confectionery-pocky');
const performance=id=>PERFORMANCE_RECIPES.find(recipe=>recipe.id===`performance-${id}`);
const clone=value=>JSON.parse(JSON.stringify(value));

test('分類は固定した6種類の文字列だけを受け付ける',()=>{
  assert.equal(new Set(NUTRITION_BASIS_KINDS).size,6);
  for(const kind of NUTRITION_BASIS_KINDS)assert.equal(validateNutritionBasis(kind),kind);
  for(const value of [undefined,null,'','Official','公式',{},['manual'],0,true])assert.throws(()=>validateNutritionBasis(value));
  assert.throws(()=>deriveRecipeBasis({...plain,nutritionBasis:'source-url'},data));
});

test('材料を計算する料理と材料の合算を保存した自作料理は材料からの概算になる',()=>{
  assert.equal(deriveRecipeBasis(plain,data),'ingredients');
  const handmade={...clone(plain),id:'custom-handmade',custom:true,manualNutrition:recipeNutrition(plain,data)};
  assert.equal(deriveRecipeBasis(handmade,data),'ingredients');
  handmade.manualNutrition.kcal+=100;
  assert.equal(deriveRecipeBasis(handmade,data),'unknown');
  assert.equal(deriveRecipeBasis({...handmade,nutritionBasis:'manual'},data),'manual');
  const missingData={...data,ingredients:{...INGREDIENTS,rice:{...INGREDIENTS.rice,nutritionPerUnit:{...INGREDIENTS.rice.nutritionPerUnit,fat:null}}}};
  assert.deepEqual(classifyNutritionBasis(plain,missingData).unknownKeys,['fat']);
  assert.match(classifyNutritionBasis(plain,missingData).unknownNote,/脂質/);
  assert.equal(deriveRecipeBasis({...plain,ingredients:[{id:'missing-food',amount:100}]},data),'unknown');
  assert.equal(deriveRecipeBasis({...plain,manualNutrition:{kcal:-100}},data),'unknown');
  assert.equal(deriveRecipeBasis(null,data),'unknown');
});

test('実際の表示値を持つ登録プロフィールだけを公式表示例とする',()=>{
  for(const recipe of [...TAKEAWAY_RECIPES,...CONFECTIONERY_RECIPES,...DESSERT_RECIPES,...ACCOMPANIMENT_RECIPES.filter(recipe=>recipe.manualNutrition!==undefined)]){
    assert.equal(deriveRecipeBasis(recipe,data),'official',recipe.id);
  }
  const badge=classifyNutritionBasis(candy,data);
  assert.equal(badge.label,'公式表示値（参考）');
  assert.match(badge.description,/参照商品・店舗/);
  assert.match(badge.description,/実物の規格や量/);
  assert.equal(deriveRecipeBasis({...clone(candy),manualNutrition:{...candy.manualNutrition,kcal:candy.manualNutrition.kcal+1}},data),'estimate');
  assert.notEqual(deriveRecipeBasis({...clone(candy),ingredients:[{...candy.ingredients[0],amount:100}]},data),'official');
  assert.notEqual(deriveRecipeBasis({...clone(candy),portion:{...candy.portion,amount:100}},data),'official');
  assert.notEqual(deriveRecipeBasis({...clone(candy),ingredients:[null]},data),'official');
  assert.equal(deriveRecipeBasis({...clone(candy),custom:true},data),'unknown');
});

test('商品名の接頭辞やURL、公式という文言から表示値へ昇格させない',()=>{
  const unrelated={...clone(candy),id:'takeaway-invented',sourceNote:'メーカー公式 https://example.com/label'};
  assert.equal(deriveRecipeBasis(unrelated,data),'estimate');
  assert.equal(deriveRecipeBasis({...unrelated,id:'custom-user',custom:true},data),'unknown');
  for(const recipe of PREPARED_RECIPES.filter(recipe=>recipe.manualNutrition!==undefined))assert.notEqual(deriveRecipeBasis(recipe,data),'official',recipe.id);
  const modeled=PREPARED_RECIPES.find(recipe=>recipe.id==='prepared-retort-vegetable-curry');
  assert.ok(modeled);assert.equal(deriveRecipeBasis(modeled,data),'estimate');
});

test('プロテインの水割りと牛乳割りで表示値と追加材料を区別する',()=>{
  for(const kind of ['soy','whey']){
    assert.equal(deriveRecipeBasis(performance(`${kind}_powder-water`),data),'official');
    assert.equal(deriveRecipeBasis(performance(`${kind}_powder-milk`),data),'mixed');
    assert.match(classifyNutritionBasis(performance(`${kind}_powder-milk`),data).description,/別の食材/);
  }
  const beer=PERFORMANCE_RECIPES.find(recipe=>recipe.name.includes('ビール')&&recipe.manualNutrition===undefined);
  assert.ok(beer);assert.equal(deriveRecipeBasis(beer,data),'ingredients');
});

test('店舗登録は構造化された表示基準を使い、登録資料の自動確認ではないことを示す',()=>{
  const recipe=buildRestaurantRecipe({genericRecipeId:plain.id,storeName:'表示値の確認用店舗',sizeName:'普通',menuName:'ご飯',
    inclusion:'ご飯のみ',riceIncluded:true,sidesIncluded:false,basis:'per100g',portionAmount:200,portionUnit:'g',
    sourceUrl:'https://example.com/nutrition',checkedDate:'2026-11-13',nutrition:{kcal:150,protein:2.5}},data);
  assert.equal(deriveRecipeBasis(recipe,data),'official');
  const basis=classifyNutritionBasis(recipe,data);
  assert.match(basis.description,/利用者が登録/);assert.match(basis.description,/自動照合した値ではありません/);
  assert.deepEqual(basis.unknownKeys,['fat','carbs','fiber','salt']);
  assert.equal(deriveRecipeBasis({...recipe,restaurant:{sourceUrl:'https://example.com',storeName:'公式'}},data),'unknown');
  assert.equal(deriveRecipeBasis({...recipe,restaurant:{...recipe.restaurant,checkedDate:'2026-02-30'}},data),'unknown');
  assert.equal(deriveRecipeBasis({...recipe,restaurant:{...recipe.restaurant,sourceUrl:'https://user:password@example.com/'}},data),'unknown');
});

test('分類を保存していない過去のスナップショットは現行DBで書き換えない',()=>{
  const item=itemFromRecipe(candy,data);assert.equal(item.nutritionBasis,'official');
  const old=clone(item);delete old.nutritionBasis;
  const original=JSON.stringify(old);
  for(const altered of [data,{...data,recipes:[]},{...data,recipes:[{...candy,nutritionBasis:'manual'}]}]){
    assert.equal(classifyNutritionBasis(old,altered).kind,'unknown');
    assert.equal(deriveRecipeBasis(old,altered),'unknown');
    assert.equal(classifyNutritionBasis(item,altered).kind,'official');
  }
  assert.equal(JSON.stringify(old),original);
  assert.equal(classifyNutritionBasis({...old,restaurant:{storeName:'公式'}},data).kind,'unknown');
  assert.throws(()=>classifyNutritionBasis({...candy,nutritionBasis:undefined},data));
});

test('新しいスナップショットは分類を固定し、不明な成分と既存記録をそのまま保存する',()=>{
  const known=itemFromRecipe(candy,data),old=clone(known);old.id='old-nutrition-basis';delete old.nutritionBasis;
  const journal=defaultJournal('2026-11-13');journal.entries=[{id:'basis-entry',date:'2026-11-13',meal:'snack',status:'eaten',note:'',items:[known,old]}];
  const clean=validateJournal(clone(journal),data),items=clean.entries[0].items;
  assert.equal(items[0].nutritionBasis,'official');assert.equal(Object.hasOwn(items[1],'nutritionBasis'),false);
  assert.deepEqual(items[0].nutrition,known.nutrition);
  assert.equal(classifyNutritionBasis(items[1],data).label,'根拠未記録');
  assert.equal(itemFromRecipe({...plain,nutritionBasis:'manual'},data).nutritionBasis,'manual');
  const invalid=clone(journal);invalid.entries[0].items[0].nutritionBasis='source-url';
  assert.throws(()=>validateJournal(invalid,data));
  const custom={id:'custom-basis',name:'入力したご飯',role:'staple',servings:1,custom:true,nutritionBasis:'manual',manualNutrition:recipeNutrition(plain,data)};
  const customJournal=defaultJournal('2026-11-13');customJournal.customRecipes=[custom];
  assert.equal(validateJournal(customJournal,data).customRecipes[0].nutritionBasis,'manual');
  custom.nutritionBasis={kind:'manual'};assert.throws(()=>validateJournal(customJournal,data));
});

test('全レシピを分類しても材料や栄養の元データを変更しない',()=>{
  const before=JSON.stringify(data);
  for(const recipe of RECIPES){const kind=deriveRecipeBasis(recipe,data);assert.ok(NUTRITION_BASIS_KINDS.includes(kind),recipe.id);assert.equal(classifyNutritionBasis(recipe,data).kind,kind,recipe.id);}
  assert.equal(JSON.stringify(data),before);
});
