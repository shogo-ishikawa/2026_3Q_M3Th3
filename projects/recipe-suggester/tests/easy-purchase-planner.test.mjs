import assert from 'node:assert/strict';
import test from 'node:test';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {defaultJournal, parseJournal, validateJournal} from '../journal.js';
import {defaultMealPreference} from '../meal-profiles.js';
import {itemFromRecipe} from '../nutrition.js';
import {addPlanDish, eligiblePlanDishChoices, generateCalendarPlan, generatePlan, regeneratePlanMeal,
  replaceRecipe, shoppingList, toggleDish, updatePlanStaple} from '../planner.js';
import {quickFoodCategory} from '../quick-foods.js';
import {capturePlan, draftDishKey, restorePlan} from '../saved-plan.js';

const data = {recipes:RECIPES, ingredients:INGREDIENTS, allergens:ALLERGENS};
const state = defaultJournal('2026-11-19');
const profiles = (changes = {}) => Object.fromEntries(['breakfast','lunch','dinner'].map(meal =>
  [meal, {...defaultMealPreference(), ...changes[meal]}]));
const settings = {startDate:'2026-11-19', days:1, servings:2, meal:'lunch', seed:9};
const easy = {...settings, mealPreferences:profiles({lunch:{easyPurchase:true}})};
const names = day => day.recipeIds.filter(id => quickFoodCategory(id));

test('通常は従来の提案を保ち、簡単指定の食事だけに市販ジャンルを提案する', () => {
  const legacy = generateCalendarPlan({...settings, meal:'all'}, data);
  assert.deepEqual(legacy, generateCalendarPlan({...settings, meal:'all', mealPreferences:profiles()}, data));
  assert.ok(legacy.days.every(day => !names(day).length));
  const plan = generateCalendarPlan({...easy, meal:'all'}, data);
  assert.ok(plan.ok);
  for (const day of plan.days) {
    assert.equal(names(day).length > 0, day.meal === 'lunch');
    if (day.meal === 'lunch') {
      assert.deepEqual(names(day), day.recipeIds);
      assert.ok(day.warnings.some(note => note.includes('商品の表示')));
      assert.ok(day.warnings.every(note => !note.includes('食品群がありません')));
    }
  }
  assert.ok(generatePlan(easy, data).days[0].recipeIds.every(id => quickFoodCategory(id)));
});

test('レトルトは白いご飯と別商品、弁当や麺には主食を重ねず、白いパックご飯は単独で出さない', () => {
  const plan = generateCalendarPlan({...easy, days:7}, data);
  const mainIds = new Set(plan.days.map(day => day.mainId));
  assert.ok(mainIds.size >= 4);
  for (const day of plan.days) {
    assert.notEqual(day.mainId, 'quick-food-pack-rice');
    const topping = day.recipeIds.find(id => quickFoodCategory(id).pairWithRice);
    assert.equal(day.recipeIds.includes('quick-food-pack-rice'), Boolean(topping));
    assert.equal(day.recipeIds.filter(id => quickFoodCategory(id).course === 'base').length, 1);
  }
  const subset = {...data, recipes:RECIPES.filter(recipe =>
    ['quick-food-retort-curry','quick-food-pack-rice','plain-rice','quick-food-salad'].includes(recipe.id))};
  const meal = generateCalendarPlan(easy, subset);
  assert.deepEqual(meal.days[0].recipeIds, ['quick-food-retort-curry','quick-food-pack-rice']);
  assert.deepEqual(shoppingList(meal, 3, subset).map(({id,amount,unit}) => [id,amount,unit]).sort(),
    [['quick_purchase_pack_rice',3,'個'], ['quick_purchase_retort_curry',3,'袋']]);
  const fixed = generateCalendarPlan({...easy, mealPreferences:profiles({
    lunch:{easyPurchase:true, staple:'fixed', stapleId:'plain-rice', stapleAmount:120},
  })}, subset);
  assert.deepEqual(fixed.days[0].recipeIds, ['quick-food-retort-curry','plain-rice']);
  assert.equal(fixed.days[0].quantities['plain-rice'], 0.8);
  assert.throws(() => updatePlanStaple(meal, {dayIndex:0,stapleId:'plain-rice'}, subset), /市販品/);
  const replacement = replaceRecipe(meal,{dayIndex:0,recipeId:'quick-food-pack-rice'},subset);
  assert.deepEqual(replacement.days, meal.days);
});

test('一食だけ指定した簡単設定・数量・購入IDを復元し、追加・除外・一品だけの差し替えができる', () => {
  const regular = generateCalendarPlan({...settings, meal:'all'}, data);
  const changes = regeneratePlanMeal(regular, {dayIndex:1, mealPreference:{easyPurchase:true,staple:'bread',sideCount:1}}, data);
  assert.deepEqual(changes.settings, regular.settings);
  for (const index of [0,2]) assert.deepEqual(changes.days[index], regular.days[index]);
  const category = changes.days[1].mainId;
  const shoppingIds = new Map([[draftDishKey(changes.days[1].date,'lunch',category),'saved-shopping-id']]);
  const serialized = JSON.stringify(validateJournal({...state, draftPlan:capturePlan(changes,shoppingIds)},data));
  const saved = parseJournal(serialized,data);
  const {plan,shoppingIds:ids} = restorePlan(saved.draftPlan,saved.settings,data);
  assert.ok(plan.ok);
  assert.deepEqual(ids,shoppingIds);
  assert.equal(plan.days[1].mealPreference.easyPurchase,true);
  assert.equal(plan.settings.mealPreferences.lunch.easyPurchase,false);
  assert.equal(eligiblePlanDishChoices(plan.settings,plan.days[0],data).some(recipe=>quickFoodCategory(recipe.id)),false);
  const soup = 'quick-food-cup-soup';
  assert.ok(eligiblePlanDishChoices(plan.settings,plan.days[1],data).some(recipe=>recipe.id===soup));
  assert.throws(()=>addPlanDish(plan,{dayIndex:0,recipeId:soup},data), /条件/);
  const withSoup = addPlanDish(plan,{dayIndex:1,recipeId:soup},data);
  const hidden = toggleDish(withSoup,{dayIndex:1,recipeId:soup},data);
  assert.ok(!shoppingList(hidden,2,data).some(row=>row.id===quickFoodCategory(soup).ingredientId));
  const shown = toggleDish(hidden,{dayIndex:1,recipeId:soup},data);
  assert.equal(shoppingList(shown,3,data).find(row=>row.id===quickFoodCategory(soup).ingredientId).amount,3);
  const sideId = plan.days[1].recipeIds[1];
  const replaced = replaceRecipe(shown,{dayIndex:1,recipeId:sideId},data);
  assert.ok(replaced.ok);
  assert.notEqual(replaced.days[1].recipeIds[1],sideId);
  assert.deepEqual(replaced.days[1].recipeIds.filter((_,i)=>i!==1), shown.days[1].recipeIds.filter((_,i)=>i!==1));
  for (const index of [0,2]) assert.deepEqual(replaced.days[index],shown.days[index]);
  const off = regeneratePlanMeal(replaced,{dayIndex:1,mealPreference:{easyPurchase:false}},data);
  assert.equal(names(off.days[1]).length,0);
});

test('アレルギー・除外・苦手な食材の変更時に表示未確認の商品を提案・再利用・買い物に回さない', () => {
  const baseline = generateCalendarPlan(easy,data);
  const draft = capturePlan(baseline,new Map());
  for (const limit of [{allergens:['egg']},{excludedIngredients:['egg']},{dislikedIngredients:['egg']}]) {
    const restricted = {...easy,...limit};
    const meal = generateCalendarPlan(restricted,data);
    assert.ok(meal.ok);
    assert.deepEqual(names(meal.days[0]),[]);
    assert.ok(meal.days[0].recipeIds.every(id => RECIPES.find(recipe=>recipe.id===id).minutes <= 5));
    assert.equal(restorePlan(draft,{...state.settings,...limit},data).plan.ok,false);
    assert.throws(()=>shoppingList({...baseline,settings:restricted},1,data), /除外条件/);
  }
});

test('食べた記録の料理ジャンルを選んだ商品の提案理由として保存する', () => {
  const item = itemFromRecipe(RECIPES.find(recipe => recipe.id === 'plain-rice'), data);
  const entries = [{date:'2026-11-18',meal:'dinner',status:'eaten',items:[item]}];
  const plan = generateCalendarPlan(easy,data,{entries});
  assert.ok(plan.ok);
  assert.ok(Object.values(plan.days[0].dishReasons).flat().some(reason=>reason.includes('食べた記録にある料理ジャンル（和食）')));
});
