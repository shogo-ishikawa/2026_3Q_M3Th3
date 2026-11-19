import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {birthdayGreeting, menuOccasions, personalPlanOptions} from '../planner-personalization.js';
import {recipeOccasionIds} from '../celebration-recipes.js';
import {defaultJournal, validateJournal} from '../journal.js';
import {eligibleRecipes, generateCalendarPlan, regeneratePlanMeal} from '../planner.js';
import {capturePlan, restorePlan} from '../saved-plan.js';

const catalog = {recipes:RECIPES, ingredients:INGREDIENTS, allergens:ALLERGENS};
const recipe = id => RECIPES.find(item => item.id === id);
const birthDate = '1987-12-25';
function main(id, ingredient, method, genre = '和食') {
  return {...recipe('pork-daikon'), id, name:id, genre, ingredients:[{id:ingredient, amount:160}],
    mealOccasions:['昼食','夕食'], displayCategory:'vegetable', displayMethod:method, displaySecondaryCategories:[]};
}
function singleMain(recipes, options = {}, extra = {}, day = '2026-07-14') {
  const settings = {...defaultJournal(day).settings, ...extra, days:1};
  Object.assign(settings.mealPreferences.dinner, {staple:'none', sideCount:0, soup:'none'});
  const result = generateCalendarPlan(settings, {...catalog, recipes}, {personalization:options});
  assert.ok(result.ok, result.warnings.join(' '));
  return result.days[0];
}

test('お祝いの挨拶は当日だけ。予定日と独立し、誕生日と行事の重なりも保持する', () => {
  assert.equal(birthdayGreeting('花子', birthDate, '2026-12-24'), '');
  assert.equal(birthdayGreeting('花子', birthDate, '2026-12-25'), '花子さん、お誕生日おめでとうございます！');
  assert.equal(birthdayGreeting('花子', undefined, '2026-12-25'), '');
  assert.deepEqual(menuOccasions('2026-12-25', birthDate), ['birthday','christmas']);
  assert.deepEqual(menuOccasions('2027-01-03'), ['new-year']);
  assert.deepEqual(menuOccasions('2027-01-04'), []);
});

test('夕食だけを該当日の行事に寄せ、昼食のみの日・再提案にも同じ設定を適用する', () => {
  const state = defaultJournal('2026-12-25');
  state.birthDate = birthDate;
  const settings = {...state.settings, days:1, meal:'all'}, options = {personalization: personalPlanOptions(state)};
  const plan = generateCalendarPlan(settings, catalog, options);
  assert.ok(plan.ok);
  const themed = day => day.recipeIds.flatMap(id => recipeOccasionIds(recipe(id)));
  assert.deepEqual(plan.days.slice(0,2).flatMap(themed), []);
  assert.ok(themed(plan.days[2]).includes('birthday'));
  assert.match(Object.values(plan.days[2].dishReasons).flat().join(), /誕生日の料理/);
  assert.ok(themed(regeneratePlanMeal(plan, {...options, dayIndex:2}, catalog).days[2]).includes('birthday'));
  const noEvents = generateCalendarPlan({...settings,occasionMenus:false}, catalog, options);
  assert.deepEqual(noEvents.days.flatMap(themed), []);
  const ordinary = generateCalendarPlan({...settings,startDate:'2026-12-26'}, catalog, options);
  assert.deepEqual(ordinary.days.flatMap(themed), []);
  settings.mealPreferences.dinner.enabled = false;
  const lunch = generateCalendarPlan(settings, catalog, options).days.find(day => day.meal === 'lunch');
  assert.ok(themed(lunch).includes('birthday'));
});

test('苦手な食材とその派生食材を全役割から外し、固定した飲み物でも条件を緩めない', () => {
  const roles = ['main','side','staple','drink','soup','snack'];
  const recipes = roles.map(role => ({...main('bean-'+role,'soy_sauce','grill'), role, staple:role==='staple'}));
  const data = {...catalog, recipes};
  const settings = {dislikedIngredients:['soybeans']};
  assert.equal(eligibleRecipes(settings,data).length, roles.length);
  assert.deepEqual(eligibleRecipes(settings,data,{forPlan:true}), []);
  const failed = generateCalendarPlan({...defaultJournal('2026-11-12').settings,days:1,dislikedIngredients:['milk']},catalog,{drinkId:'drink-milk'});
  assert.equal(failed.ok,false);
  assert.deepEqual(failed.days,[]);
  assert.match(failed.warnings.join(' '), /苦手な食材/);
});

test('保存時の料理が候補にないときも、確認済みのお気に入りの材料・ジャンルから新しい料理を選ぶ', () => {
  const state = defaultJournal();
  state.favourites = [{genre:'洋食', item:{recipeId:null, ingredients:[{id:'onion'}], ingredientsKnown:true}}];
  const options = personalPlanOptions(state);
  const matched = main('similar-onion','onion','grill','洋食'), other = main('unrelated','tomato','grill');
  for (const seed of [1,8,65]) {
    const day = singleMain([other,matched],options,{seed});
    assert.equal(day.mainId, matched.id);
    assert.match(day.dishReasons[matched.id].join(), /お気に入りと同じ食材/);
  }
  // 材料が不明なら、保存したジャンルだけを手掛かりにする。
  state.favourites[0].item.ingredientsKnown=false;
  const genreOnly=singleMain([other, matched],personalPlanOptions(state));
  assert.match(genreOnly.dishReasons[matched.id].join(), /お気に入りと同じジャンル/);
  const excluded=singleMain([other,matched],options,{dislikedIngredients:['onion']});
  assert.equal(excluded.mainId,other.id);
});

test('調理法の共通点、家族の年代、旬の材料をそれぞれ候補と理由に反映する', () => {
  const stewed = main('stewed','onion','stew'), grilled = main('grilled','onion','grill');
  const original = {...main('fave-stew','milk','stew'), role:'side'};
  const similar = singleMain([grilled,original,stewed],{favouriteRecipeIds:[original.id]});
  assert.equal(similar.mainId,stewed.id);
  assert.match(similar.dishReasons[stewed.id].join(), /同じ調理法/);
  assert.equal(singleMain([grilled,stewed],{counts:{adult:1,senior:1}}).mainId,stewed.id);
  assert.equal(singleMain([grilled,stewed],{counts:{adult:1,teen:1}}).mainId,grilled.id);
  const summery=main('summer','cucumber','grill');
  const summer=singleMain([summery,grilled],{seasonal:true});
  assert.equal(summer.mainId,summery.id);
  assert.match(summer.dishReasons[summery.id].join(), /夏が旬/);
  assert.ok(!Object.values(singleMain([summery,grilled],{seasonal:true},{occasionMenus:false}).dishReasons).flat().some(reason=>reason.includes('が旬')));
});

test('下書きに家族の年代・誕生日・好みを二重保存せず、復元時に現在の苦手食材を照合する', () => {
  const state = defaultJournal('2026-11-17');
  state.settings.household = {useForServings:true, counts:{adult:2, teen:1}};
  state.settings.dislikedIngredients = ['milk'];
  state.settings.days=1;
  const plan = generateCalendarPlan(state.settings,catalog,{personalization:personalPlanOptions(state)});
  assert.ok(plan.ok);
  const captured = capturePlan(plan,new Map());
  assert.ok(!Object.hasOwn(captured.settings,'household') && !Object.hasOwn(captured.settings,'dislikedIngredients'));
  const draft = validateJournal({...state,draftPlan:captured},catalog).draftPlan;
  const changed = {...state.settings, dislikedIngredients:[recipe(plan.days[0].mainId).ingredients[0].id]};
  assert.equal(restorePlan(draft, changed, catalog).plan.ok,false);
});
