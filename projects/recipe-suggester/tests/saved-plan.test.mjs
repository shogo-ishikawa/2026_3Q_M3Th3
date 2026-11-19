import assert from 'node:assert/strict';
import test from 'node:test';
import {RECIPES, INGREDIENTS, ALLERGENS} from '../data.js';
import {defaultJournal, parseJournal, validateJournal} from '../journal.js';
import {generateCalendarPlan, toggleDish, regeneratePlanMeal} from '../planner.js';
import {capturePlan, restorePlan, draftDishKey} from '../saved-plan.js';
import {itemFromRecipe, summariseEntries} from '../nutrition.js';
import {normalizeLegacyJournal, startMealPalette, getAccountSession} from '../app-start.js';

const data = {recipes: RECIPES, ingredients: INGREDIENTS, allergens: ALLERGENS};
const state = defaultJournal('2026-11-19');
state.settings.days = 1;
const draft = generateCalendarPlan({...state.settings, meal:'all', seed: 12}, data);
const itemIds = new Map(draft.days.flatMap(day => day.recipeIds.map((id, i) =>
  [draftDishKey(day.date, day.meal, id), 'item-' + day.meal + '-' + i])));

test('再起動後にも下書きの量・省いた料理・提案理由・買い物の識別子を復元して編集できる', () => {
  const id = draft.days[0].recipeIds[0];
  const edited = toggleDish(draft, {dayIndex: 0, recipeId: id}, data);
  const encoded = JSON.stringify(validateJournal({...state, draftPlan: capturePlan(edited, itemIds)}, data));
  const saved = parseJournal(encoded, data);
  const restored = restorePlan(saved.draftPlan, saved.settings, data);
  assert.deepEqual(restored.shoppingIds, itemIds);
  for (const [i, day] of restored.plan.days.entries()) {
    for (const key of ['recipeIds', 'omittedRecipeIds', 'quantities', 'dishReasons', 'warnings', 'reasons']) {
      assert.deepEqual(day[key], edited.days[i][key]);
    }
  }
  assert.equal(saved.entries.length, 0);
  const again = regeneratePlanMeal(restored.plan, {dayIndex: 1, seed: 93, mealPreference: {volume: 'light'}}, data);
  const after = validateJournal({...state, draftPlan: capturePlan(again, itemIds)}, data);
  assert.equal(after.draftPlan.days.length, draft.days.length);
});

test('過去の形式・予定と実食・栄養目標を引き継ぎ、下書きがなくても開ける', () => {
  const item = itemFromRecipe(RECIPES[0], data);
  const meals = ['eaten','planned'].map((status,i) => ({id:'entry-'+i,date:state.settings.startDate,meal:'lunch',status,
    items:[{...item,id:'dish-'+i}], note:''}));
  const legacy = {...state, entries: meals, targets:{...state.targets,kcal:2150}};
  const restored = parseJournal(normalizeLegacyJournal(JSON.stringify(legacy)), data);
  assert.equal(restored.targets.kcal, 2150);
  const range = {from: state.settings.startDate, to: state.settings.startDate};
  assert.deepEqual(summariseEntries(restored.entries, range), summariseEntries(meals, range));
  assert.deepEqual(restorePlan(restored.draftPlan, restored.settings, data), {plan:null,shoppingIds:new Map()});
});

test('下書きに未収録の料理がある場合でも、以前の予定・実食・栄養記録は読み込める', () => {
  const saved = validateJournal({...state, draftPlan:capturePlan(draft, itemIds)}, data);
  const missing = draft.days[0].recipeIds[0];
  const smaller = {...data, recipes:RECIPES.filter(r => r.id !== missing)};
  const parsed = parseJournal(JSON.stringify(saved), smaller);
  assert.equal(restorePlan(parsed.draftPlan, parsed.settings, smaller).plan.ok, false);
});

test('アカウントの保存先がない状態でアプリを初期化しない', async () => {
  assert.throws(() => getAccountSession());
  await assert.rejects(startMealPalette({user:{uid:'one'},uid:'two',storage:{}}));
  assert.throws(() => getAccountSession());
});
