import test from 'node:test';
import assert from 'node:assert/strict';
import {RECIPES, INGREDIENTS, ALLERGENS} from '../data.js';
import {QUICK_FOOD_RECIPES, quickFoodCategory, quickFoodOptions} from '../quick-foods.js';
import {ingredientOptions} from '../ingredient-options.js';
import {eligibleRecipes} from '../planner.js';
import {itemFromRecipe} from '../nutrition.js';
import {ingredientGroup} from '../shopping-categories.js';
import {pantryClassification} from '../pantry-catalog.js';
import {buildShoppingChecklist} from '../shopping-workflow.js';

const data = {recipes: RECIPES, ingredients: INGREDIENTS, allergens: ALLERGENS};
const date = '2026-11-19';
const parameters = {meal: 'lunch', date, seed: 7};
const recipe = slug => data.recipes.find(r => r.id === 'quick-food-' + slug);
const entry = (status, day, meal, id) => ({status, date:day, meal, items:[{recipeId:id}]});

test('市販ジャンルは一般名で購入し、全商品の原材料・アレルゲンが既知とは扱わない', () => {
  const shownIngredients = new Set(ingredientOptions(data).map(x => x.id));
  for (const model of QUICK_FOOD_RECIPES) {
    const category = quickFoodCategory(model.id);
    assert.equal(data.recipes.filter(r => r.id === model.id).length, 1);
    assert.equal(model.ingredientsKnown, false);
    assert.equal(model.allergensKnown, false);
    assert.equal(model.shoppingKnown, true);
    assert.equal(model.nutritionBasis, 'estimate');
    assert.ok(category.referenceIds.length);
    assert.equal(model.ingredients[0].id, category.ingredientId);
    assert.equal(data.ingredients[category.ingredientId].name, category.name);
    assert.equal(ingredientGroup(category.ingredientId,data), 'prepared');
    assert.equal(pantryClassification(category.ingredientId,data).subgroup, 'quick-food');
    assert.equal(shownIngredients.has(category.ingredientId), false);
    assert.doesNotMatch(model.name + model.sourceNote, /ローソン|セブン|ファミリーマート|クノール/);
  }
  assert.deepEqual(eligibleRecipes({}, {...data, recipes: QUICK_FOOD_RECIPES}), []);
  assert.equal(quickFoodCategory('convenience-salmon-onigiri'), null);
});

test('確認済みの代表例の基準量から求めた目安で、栄養の欠測をゼロにしない', () => {
  const item = itemFromRecipe(recipe('onigiri'), data);
  const refs = ['convenience-salmon-onigiri','convenience-tuna-mayo-onigiri'].map(id => RECIPES.find(x => x.id === id));
  assert.equal(item.nutrition.kcal,(refs[0].manualNutrition.kcal + refs[1].manualNutrition.kcal)/2);
  assert.equal(item.nutritionBasis, 'estimate');
  assert.equal(item.ingredientsKnown, false);
  assert.equal(item.allergensKnown, false);
  assert.deepEqual(item.ingredients,[{id:'quick_purchase_onigiri',amount:1}]);
  assert.equal(recipe('cup-soup').manualNutrition.fiber, null);
  assert.equal(recipe('cup-soup').nature,'instant');
  assert.match(INGREDIENTS.quick_purchase_onigiri.nutritionSource,/https:\/\//);
  assert.equal(recipe('cup-soup').portion.unit,'杯');
  assert.equal(INGREDIENTS.quick_purchase_cup_soup.unit, '袋');
});

test('レトルトは具200gの1袋だけ、ご飯180gは1個を別に計上する', () => {
  const rice = recipe('pack-rice');
  assert.equal(rice.manualNutrition.kcal,180 * INGREDIENTS.rice.nutritionPerUnit.kcal);
  for (const slug of ['retort-curry','retort-rice-topping']) {
    const product = recipe(slug), category = quickFoodCategory(product.id);
    const exact = category.referenceIds.map(id => 200 * INGREDIENTS[id].nutritionPerUnit.kcal);
    assert.equal(product.manualNutrition.kcal,exact.reduce((a,b)=>a+b,0)/exact.length);
    assert.equal(category.pairWithRice, true);
    assert.equal(product.nature,'retort');
    assert.match(INGREDIENTS[category.ingredientId].nutritionSource,/食品番号/);
    const prepared = [rice,product].map(r => {
      const item = itemFromRecipe(r, data);
      return {id:item.id,item,servings:2,ingredientIds:item.ingredients.map(p=>p.id)};
    });
    const result = buildShoppingChecklist(prepared, data);
    assert.deepEqual(result.items.map(x=>[x.id,x.buy,x.unit]).sort(), [
      ['quick_purchase_pack_rice',2,'個'], [category.ingredientId,2,'袋'],
    ].sort());
    assert.equal(result.missingMenus.length,2);
  }
});

test('原材料に依存する除外条件では未確認のジャンルを提案しない。年齢だけで一律に外さない', () => {
  for (const restrictions of [{allergens:['egg']},{excludedIngredients:['sesame_oil']},{dislikedIngredients:['carrot']}]) {
    assert.deepEqual(quickFoodOptions(data,restrictions,parameters), []);
  }
  assert.ok(quickFoodOptions(data,{household:{counts:{preschool:1}}},parameters).length > 0);
  const original = recipe('onigiri');
  const unsafe = {...original, name:'節分の炒り大豆'};
  assert.deepEqual(quickFoodOptions({...data,recipes:[unsafe]}, {household:{counts:{preschool:1}}}, parameters), []);
  for (const records of [[], [original,original], [{...original, custom:true}], [{...original, ingredients:[]}]]) {
    assert.deepEqual(quickFoodOptions({...data,recipes:records}, {}, parameters), []);
  }
});

test('食事枠を守り、明示したジャンルとその時点で食べた記録だけを順位の根拠にする', () => {
  const day = (settings, entries=[]) => quickFoodOptions(data,settings,{...parameters,entries});
  const fresh = day({});
  assert.ok(fresh.every(x => x.reason === '' && x.category.meals.includes('lunch')));
  assert.deepEqual(fresh,day({}));
  assert.ok(!fresh.some(x=>x.category.id==='quick-food-sweet-bread'));
  const prior = entry('eaten','2026-11-18','dinner','chicken-teriyaki');
  assert.equal(day({},[prior])[0].category.genre,'和食');
  assert.match(day({},[prior])[0].reason,/食べた記録/);
  for (const unrelated of [entry('planned','2026-11-18','dinner','chicken-teriyaki'),
    entry('eaten','2026-11-20','dinner','chicken-teriyaki'), entry('eaten',date,'dinner','chicken-teriyaki')]) {
    assert.deepEqual(day({},[unrelated]),fresh);
  }
  const explicit = day({preferences:{genreMode:'single',genre:'洋食'}},[prior]);
  assert.equal(explicit[0].category.genre,'洋食');
  assert.match(explicit[0].reason,/希望/);
});

test('差し替えで候補から外した料理の実食も照合し、1食の分割や似た料理では回数を水増ししない', () => {
  const candidates = {...data,recipes:[recipe('onigiri'),recipe('sandwich')]};
  const options = entries => quickFoodOptions(candidates,{}, {...parameters,entries,historyRecipes:data.recipes});
  const japanese = entry('eaten','2026-11-15','dinner','chicken-teriyaki');
  const western = ['2026-11-13','2026-11-14'].map(date=>entry('eaten',date,'dinner','chicken-tomato'));
  assert.equal(options([japanese,...western])[0].category.genre,'洋食');
  assert.equal(options([...Array(8).fill(japanese),...western])[0].category.genre,'洋食');
  const similar = {...japanese,items:[{recipeId:'chicken-teriyaki',diningMatch:{mode:'similar'}}]};
  assert.deepEqual(options([similar]),options([]));
  assert.ok(options([japanese]).every(option=>candidates.recipes.includes(option.recipe)));
});
