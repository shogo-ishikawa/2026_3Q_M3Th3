import test from 'node:test';
import assert from 'node:assert/strict';
import {RECIPES, INGREDIENTS, ALLERGENS} from '../data.js';
import {MEAL_OCCASIONS, hasReviewedMealOccasions, mealOccasionsFor, recipeSceneIds, SCENE_LABELS} from '../meal-occasions.js';
import {isAvailableOnDate} from '../planner-personalization.js';
import {getVariationGroup} from '../menu-variations.js';
import {canSuggestAtMeal} from '../meal-suitability.js';
import {generateCalendarPlan, generatePlan, replaceRecipe} from '../planner.js';

const get = id => RECIPES.find(recipe => recipe.id === id);
const dataWith = (...ids) => ({recipes: ids.map(get), ingredients: INGREDIENTS, allergens: ALLERGENS});

test('every catalogued dish carries one or more explicitly reviewed occasions', () => {
  for (const recipe of RECIPES) {
    assert.ok(hasReviewedMealOccasions(recipe), recipe.id);
    const occasions = mealOccasionsFor(recipe);
    assert.ok(occasions.length, recipe.id);
    assert.deepEqual(occasions, MEAL_OCCASIONS.filter(label => occasions.includes(label)), recipe.id);
  }
});

test('recording occasions include overlapping uses and keep alcohol out of automatic meals', () => {
  assert.deepEqual(mealOccasionsFor(get('classic-sashimi-tuna')), ['昼食', '夕食', '晩酌']);
  assert.deepEqual(mealOccasionsFor(get('snack-banana')), ['朝食', '間食']);
  assert.deepEqual(mealOccasionsFor(get('daily-snack-chocolate')), ['間食']);
  assert.deepEqual(mealOccasionsFor(get('performance-beer')), ['晩酌']);
  assert.equal(canSuggestAtMeal(get('performance-beer'), 'dinner', {banshaku:true}), false);
  assert.equal(canSuggestAtMeal(get('performance-energy'), 'breakfast'), false);
  const example = {...get('snack-banana'), id:'added-fruit', mealOccasions:['間食', '朝食']};
  assert.deepEqual(mealOccasionsFor(example), ['朝食', '間食']);
  assert.equal(hasReviewedMealOccasions({...example, mealOccasions:['夜食']}), false);
});

test('both automatic planners respect ordinary dinner-only dishes and all morning drinks are filtered', () => {
  const limited = dataWith('familiar-kimchi-nabe', 'classic-side-spinach-ohitashi', 'soup-001', 'plain-rice');
  for (const generate of [generateCalendarPlan, generatePlan]) {
    assert.ok(generate({meal:'dinner', days:1}, limited).ok);
    assert.equal(generate({meal:'lunch', days:1}, limited).ok, false);
  }
  const breakfast = dataWith('classic-fried-egg', 'plain-rice', 'soup-001', 'daily-drink-cola');
  assert.equal(generateCalendarPlan({meal:'breakfast',days:1}, breakfast, {drinkId:'auto'}).ok, false);
  assert.ok(generateCalendarPlan({meal:'breakfast',days:1}, breakfast, {drinkId:'none'}).ok);
});


test('rice balls can be proposed or swapped as a one-item snack', () => {
  const data = dataWith('daily-onigiri-salmon', 'daily-onigiri-plum');
  const plan = generateCalendarPlan({meal:'snack', days:1}, data);
  assert.ok(plan.ok);
  const [id] = plan.days[0].recipeIds;
  const replaced = replaceRecipe(plan, {dayIndex:0, recipeId:id}, data);
  assert.ok(replaced.ok);
  assert.equal(replaced.days[0].recipeIds.length, 1);
  assert.notEqual(replaced.days[0].recipeIds[0], id);
});

test('行事と日常シーンの登録、時間帯との併用、地域・家庭向け料理の年中の提案', () => {
  const covered = new Set();
  for (const recipe of RECIPES) {
    const scenes = recipeSceneIds(recipe);
    assert.ok(scenes.length && scenes.every(id => Object.hasOwn(SCENE_LABELS, id)), recipe.id);
    assert.equal(new Set(scenes).size, scenes.length, recipe.id);
    scenes.forEach(id => covered.add(id));
    if (mealOccasionsFor(recipe).includes('間食')) assert.ok(scenes.includes('teatime'),recipe.id);
  }
  assert.deepEqual(covered, new Set(Object.keys(SCENE_LABELS)));
  for (const [id, scene, meal] of [
    ['celebration-regional-nara-chagayu','regional','朝食'],
    ['celebration-regional-gifu-gohei','teatime','間食'],
    ['celebration-menemen','brunch','朝食'],
    ['celebration-salmon-tartare-avocado','anniversary','晩酌'],
    ['celebration-new-year-apple-kinton','new-year','朝食'],
    ['breakfast-lentil-potato','everyday','朝食'],
  ]) {
    assert.ok(recipeSceneIds(get(id)).includes(scene), id);
    assert.ok(mealOccasionsFor(get(id)).includes(meal), id);
  }
  const salmon=get('celebration-salmon-tartare-avocado');
  assert.equal(isAvailableOnDate(salmon, [], '2026-06-09', {seasonal:false}),true);
  assert.equal(recipeSceneIds(salmon).includes('everyday'),false);
  assert.equal(isAvailableOnDate(get('celebration-new-year-seabream-soup'), [], '2026-06-09', {seasonal:false}),false);
  const regionalLunch=RECIPES.filter(recipe=>recipeSceneIds(recipe).includes('regional') && mealOccasionsFor(recipe).includes('昼食'));
  const udonGroup=getVariationGroup('celebration-regional-kagawa-shippoku',regionalLunch);
  assert.equal(udonGroup.groupId,'udon');
  assert.ok(udonGroup.recipes.some(recipe=>recipe.id==='kyoto-keiran-udon'));
  assert.ok(!udonGroup.recipes.some(recipe=>recipe.id==='daily-udon-plain'));
});
