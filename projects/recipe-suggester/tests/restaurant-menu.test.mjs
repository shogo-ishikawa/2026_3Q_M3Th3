import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {buildRestaurantRecipe,restaurantConfigFromRecipe,restaurantVariantsFor,validateRestaurantMetadata} from '../restaurant-menu.js';
import {itemFromRecipe,itemNutrition} from '../nutrition.js';
import {defaultJournal,validateJournal} from '../journal.js';
import {shoppingForEntries} from '../shopping.js';
import {recipeFamily,quantityFromAmount} from '../catalog.js';
const data={ingredients:INGREDIENTS,recipes:RECIPES,allergens:ALLERGENS};
const base=RECIPES.find(recipe=>recipe.id==='chicken-teriyaki');
const config={genericRecipeId:base.id,storeName:'表示確認用の店',sizeName:'普通',menuName:'照り焼きチキン',inclusion:'チキンと付け合わせの野菜。ご飯は含まない。',riceIncluded:false,sidesIncluded:true,basis:'portion',portionAmount:1,portionUnit:'食',sourceUrl:'https://example.com/official-menu',checkedDate:'2026-11-13',nutrition:{kcal:450,protein:30,fat:20,carbs:35,fiber:null,salt:2.5}};

test('一般的な料理へ店舗・サイズを紐づけ、材料の概算を公式表示へ混ぜない',()=>{
  const before=JSON.stringify(base),recipe=buildRestaurantRecipe(config,data);
  assert.equal(recipe.restaurant.genericRecipeId,base.id);assert.equal(recipe.restaurant.sizeName,'普通');assert.match(recipe.name,/表示確認用の店.*普通/);
  assert.deepEqual(recipe.manualNutrition,config.nutrition);assert.deepEqual(recipe.ingredients,[]);assert.equal(recipe.shoppingKnown,false);assert.equal(recipe.ingredientsKnown,false);assert.equal(recipe.allergensKnown,false);assert.equal(JSON.stringify(base),before);
  assert.equal(recipe.portion.amount,1);assert.equal(recipe.portion.unit,'食');assert.equal(recipe.staple,false);assert.equal(recipe.mealBase,false);
});

test('100g当たりの表示を提供量に一度だけ換算し、食べたg数でも二重換算しない',()=>{
  const recipe=buildRestaurantRecipe({...config,basis:'per100g',portionAmount:250,nutrition:{kcal:200,protein:12,fat:10,carbs:15,salt:null}},data);
  assert.equal(recipe.manualNutrition.kcal,500);assert.equal(recipe.manualNutrition.protein,30);assert.equal(recipe.manualNutrition.fiber,null);assert.equal(recipe.manualNutrition.salt,null);
  assert.deepEqual(recipe.restaurant.basisAmount,100);assert.equal(recipe.portion.unit,'g');
  const item=itemFromRecipe(recipe,data,quantityFromAmount(recipe,data,125));assert.equal(itemNutrition(item).kcal,250);
  const editing=restaurantConfigFromRecipe(recipe);assert.equal(editing.nutrition.kcal,200);assert.equal(editing.portionAmount,250);assert.deepEqual(buildRestaurantRecipe(editing,data).manualNutrition,recipe.manualNutrition);
});

test('ご飯込みの定食は主食へ、ライスなしカレーは主菜へ、ラーメンはご飯なしでも主食へ分類する',()=>{
  const set=buildRestaurantRecipe({...config,riceIncluded:true},data);assert.equal(recipeFamily(set),'other-staple');assert.equal(set.role,'staple');assert.equal(set.mealBase,true);
  const curry=RECIPES.find(recipe=>recipeFamily(recipe)==='curry');assert.ok(curry);
  const sauce=buildRestaurantRecipe({...config,genericRecipeId:curry.id},data);assert.equal(recipeFamily(sauce),'main');assert.equal(sauce.role,'main');assert.equal(sauce.staple,false);assert.equal(sauce.mealBase,false);
  const ramen=RECIPES.find(recipe=>recipeFamily(recipe)==='ramen');const noodle=buildRestaurantRecipe({...config,genericRecipeId:ramen.id},data);assert.equal(recipeFamily(noodle),'ramen');assert.equal(noodle.role,'staple');assert.equal(noodle.mealBase,true);
});

test('提供量と表示対象を保存し、別サイズと過去の栄養を混同しない',()=>{
  const regular=buildRestaurantRecipe({...config,id:'custom-restaurant-regular'},data),large=buildRestaurantRecipe({...config,id:'custom-restaurant-large',sizeName:'大盛り',nutrition:{...config.nutrition,kcal:650}},data);
  const item=itemFromRecipe(regular,data);assert.deepEqual(item.restaurant,regular.restaurant);
  const journal=defaultJournal('2026-11-13');journal.customRecipes=[regular,large];journal.entries=[{id:'dinner',date:'2026-11-13',meal:'dinner',status:'eaten',note:'',items:[item]}];
  const clean=validateJournal(JSON.parse(JSON.stringify(journal)),data);assert.deepEqual(clean.customRecipes[0].restaurant,regular.restaurant);assert.deepEqual(clean.entries[0].items[0].restaurant,regular.restaurant);assert.equal(clean.entries[0].items[0].nutrition.kcal,450);
  assert.equal(restaurantVariantsFor(base.id,clean.customRecipes).length,2);assert.equal(restaurantVariantsFor('not-found',clean.customRecipes).length,0);
  const historical=validateRestaurantMetadata(regular.restaurant,{...data,recipes:[]},{historical:true});assert.equal(historical.genericRecipeId,base.id);
});

test('外食は材料を作らず買い物に合算しない。アレルゲンは店で確認した値だけ保存する',()=>{
  const recipe=buildRestaurantRecipe({...config,allergens:['egg'],allergensKnown:true},data),item=itemFromRecipe(recipe,data);
  assert.deepEqual(item.allergens,['egg']);assert.equal(item.allergensKnown,true);
  const result=shoppingForEntries([{id:'planned',date:'2026-11-13',status:'planned',items:[item]}],data,{from:'2026-11-13',to:'2026-11-13',servings:1});assert.equal(result.items.length,0);assert.deepEqual(result.missingMenus,[]);
});

test('URL・日付・基準・栄養の不正値を拒否し、未掲載値を0と推定しない',()=>{
  for(const bad of [
    {sourceUrl:'javascript:alert(1)'},{sourceUrl:'http://example.com'},{sourceUrl:'https://user:secret@example.com'},
    {checkedDate:'2026-02-30'},{checkedDate:'1999-01-01'},{storeName:''},{sizeName:''},{inclusion:''},
    {genericRecipeId:'missing'},{basis:'per100ml'},{basis:'portion',portionUnit:'g'},
    {portionAmount:0},{portionAmount:Infinity},{riceIncluded:'yes'},{sidesIncluded:null},
    {nutrition:{kcal:null}},{nutrition:{kcal:-1}},{nutrition:{kcal:NaN}},{nutrition:{kcal:500,fat:'20'}},{allergens:['missing']},
  ])assert.throws(()=>buildRestaurantRecipe({...config,...bad},data),JSON.stringify(bad));
  const unknown=buildRestaurantRecipe({...config,nutrition:{kcal:450}},data);assert.equal(unknown.manualNutrition.fat,null);assert.equal(unknown.manualNutrition.fiber,null);
  assert.throws(()=>validateRestaurantMetadata({...unknown.restaurant,arbitrary:'bad'},data));
});
