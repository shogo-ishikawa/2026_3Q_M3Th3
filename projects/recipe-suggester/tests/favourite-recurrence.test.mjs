import test from 'node:test';
import assert from 'node:assert/strict';
import {RECIPES,INGREDIENTS,ALLERGENS} from '../data.js';
import {defaultJournal} from '../journal.js';
import {itemFromRecipe} from '../nutrition.js';
import {generateCalendarPlan} from '../planner.js';
import {personalPlanOptions} from '../planner-personalization.js';

const data = {recipes:RECIPES,ingredients:INGREDIENTS,allergens:ALLERGENS};
const original = RECIPES.find(recipe => recipe.id === 'pork-daikon');
const favourite = {...original, id:'favourite-main', name:'定番の煮物'};
const other = {...original, id:'other-main', name:'別の煮物'};
const items = {...data, recipes:[favourite,other]};
const state = defaultJournal('2026-11-26');
const settings = {...state.settings,days:1,meal:'dinner',occasionMenus:false};
Object.assign(settings.mealPreferences.dinner,{staple:'none',sideCount:0,soup:'none'});
const options = {favouriteRecipeIds:[favourite.id]};
const dayOf = (personalization, entries = [], overrides = {}, catalog = items) => {
  const result = generateCalendarPlan({...settings,...overrides},catalog,{personalization,entries});
  assert.ok(result.ok,result.warnings.join(' '));
  return result.days[0];
};
const entry = (date, meal = 'dinner', status = 'eaten', recipe = favourite) =>
  ({date,meal,status,items:[itemFromRecipe(recipe,items)]});
const offered = date => [{date,recipeIds:[favourite.id]}];

test('お気に入りは初回に選択でき、直近0～6日は他の候補に譲り、14日目から再登場を示す',()=>{
  for (const seed of [0,3,11,99]) {
    const choose = date => dayOf({...options,suggestionHistory:date ? offered(date) : []},[],{seed});
    assert.equal(choose(null).mainId,favourite.id);
    assert.deepEqual(choose(null).dishReasons[favourite.id],['お気に入りの料理']);
    for (const date of ['2026-11-26','2026-11-20']) assert.equal(choose(date).mainId,other.id);
    for (const date of ['2026-11-19','2026-11-13']) {
      const day = choose(date);
      assert.equal(day.mainId,favourite.id);
      assert.deepEqual(day.dishReasons[favourite.id],['お気に入りの料理']);
    }
    const due = choose('2026-11-12');
    assert.equal(due.mainId,favourite.id);
    assert.ok(due.dishReasons[favourite.id].includes('久しぶりのお気に入り'));
  }
});

test('最後に食べた日・提案日の新しいほうを採用し、予定・未来や後の食事枠は使わない',()=>{
  const old = {...options,suggestionHistory:offered('2026-11-01')};
  assert.equal(dayOf(old,[entry('2026-11-24')]).mainId,other.id);
  assert.equal(dayOf({...options,suggestionHistory:offered('2026-11-25')},[entry('2026-10-20')]).mainId,other.id);
  for (const later of [entry('2026-11-30'),entry('2026-11-25','dinner','planned'),entry('2026-11-26','dinner')]) {
    assert.deepEqual(dayOf(old,[later]).dishReasons[favourite.id],['久しぶりのお気に入り']);
  }
  assert.equal(dayOf(old,[entry('2026-11-26','breakfast')]).mainId,other.id);
  const future = dayOf({...options,suggested:[favourite.id],suggestionHistory:offered('2026-12-10')});
  assert.deepEqual(future,dayOf(options));
  const legacy = dayOf({...options,suggested:[favourite.id]});
  assert.ok(!Object.values(legacy.dishReasons).flat().includes('久しぶりのお気に入り'));
});

test('類似の外食と基本の配合を変えた記録は、基準料理を食べた日とみなさない',()=>{
  const old = {...options,suggestionHistory:offered('2026-11-05')};
  for (const change of [{diningMatch:{mode:'similar'}},{ingredientEdit:{baseChanged:true}}]) {
    const logged = entry('2026-11-25');
    Object.assign(logged.items[0], change);
    assert.deepEqual(dayOf(old,[logged]).dishReasons[favourite.id],['久しぶりのお気に入り']);
  }
});

test('適格な候補が一品だけなら最近のお気に入りも提案でき、除外条件と週内の重複回避を尊重する',()=>{
  const sole = {...items,recipes:[favourite]};
  assert.equal(dayOf({...options,suggestionHistory:offered('2026-11-25')},[],{},sole).mainId,favourite.id);
  const safe = {...other,ingredients:[{id:'onion',amount:120}]};
  const catalog = {...items,recipes:[favourite,safe]};
  const changed = dayOf({...options,suggestionHistory:offered('2026-10-05')},[],{excludedIngredients:['daikon']},catalog);
  assert.equal(changed.mainId,other.id);
  const period = generateCalendarPlan({...settings,days:7},items,{personalization:options});
  assert.ok(period.ok);
  assert.notEqual(period.days[0].mainId,period.days[1].mainId);
  assert.ok(period.days.every(day=>!Object.values(day.dishReasons).flat().includes('久しぶりのお気に入り')));
});

test('商品名・配合を変えて保存したお気に入りは提案できる商品ジャンルや元の料理として示す',()=>{
  const product = RECIPES.find(recipe=>recipe.id==='quick-food-sandwich');
  const packed = itemFromRecipe(product,data);
  const journal = {...state,favourites:[{item:{...packed,productLabel:{name:'購入したサンド'}},genre:'洋食'}],
    suggestionHistory:[{date:'2026-10-10',recipeIds:[product.id]}]};
  const quick = {...settings.mealPreferences, dinner:{...settings.mealPreferences.dinner,easyPurchase:true,staple:'bread'}};
  const day = dayOf(personalPlanOptions(journal),[],{mealPreferences:quick},data);
  assert.equal(day.mainId, product.id);
  assert.ok(day.dishReasons[product.id].includes('久しぶりのお気に入り（市販品の種類）'));
  assert.ok(day.dishReasons[product.id].every(reason=>!reason.includes('購入したサンド')));
  const adjusted = {...journal,favourites:[{item:{...itemFromRecipe(favourite,items),ingredientEdit:{}},genre:'和食'}],
    suggestionHistory:offered('2026-10-10')};
  assert.ok(dayOf(personalPlanOptions(adjusted)).dishReasons[favourite.id].includes('久しぶりのお気に入り（元の料理）'));
});
