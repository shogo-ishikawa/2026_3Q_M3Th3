import {PALETTE_RECIPES} from '../palette-foods.js';
import test from 'node:test';
import {BREAD_RECIPES} from '../bread-foods.js';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {CLASSIC_MAIN_RECIPES} from '../classics-mains.js';
import {CLASSIC_SIDE_RECIPES} from '../classics-sides.js';
import {PREPARED_RECIPES} from '../prepared-foods.js';
import {PERFORMANCE_RECIPES} from '../performance-foods.js';
import {SUSHI_RECIPES} from '../sushi-foods.js';
import {TAKEAWAY_RECIPES} from '../takeaway-foods.js';
import {COMFORT_RECIPES} from '../comfort-foods.js';
import {CONFECTIONERY_RECIPES} from '../confectionery-foods.js';
import {DESSERT_RECIPES} from '../dessert-foods.js';
import {ACCOMPANIMENT_RECIPES} from '../accompaniment-foods.js';
import {CATALOG_CATEGORIES, FOOD_NATURES, recipePortion, quantityFromAmount} from '../catalog.js';
import {describeRecipe, eligibleRecipes, generateCalendarPlan, replaceRecipe} from '../planner.js';
import {itemFromRecipe, itemNutrition, NUTRIENT_KEYS} from '../nutrition.js';
import {defaultJournal, parseJournal, JOURNAL_KEY} from '../journal.js';
import {shoppingForEntries} from '../shopping.js';

// 各追加モジュールの単体テストとは別に、公開アプリが import する完成DBを使います。
const data = {allergens: ALLERGENS, ingredients: INGREDIENTS, recipes: RECIPES};
const byId = new Map(RECIPES.map(recipe => [recipe.id, recipe]));
const unconfirmedIds = new Set([...PREPARED_RECIPES, ...PERFORMANCE_RECIPES, ...TAKEAWAY_RECIPES, ...CONFECTIONERY_RECIPES, ...DESSERT_RECIPES, ...ACCOMPANIMENT_RECIPES,...PALETTE_RECIPES].filter(recipe => recipe.allergensKnown === false).map(recipe => recipe.id));
const settings = {startDate: '2026-11-12', days: 7, servings: 3, meal: 'dinner', seed: 73};
const near = (actual, expected, message = '') => assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} != ${expected}`);
const snapshot = (id, amount) => {
  const recipe = byId.get(id), portion = recipePortion(recipe, data);
  return {...itemFromRecipe(describeRecipe(id, data), data, quantityFromAmount(recipe, data, amount ?? portion.amount)), portion};
};
const entry = (id, items, status = 'planned') => ({id, date: '2026-11-12', meal: 'dinner', status, note: '', items});

test('統合DBへ全追加モジュールを取り込み、公開用の分類を全品へ適用している', () => {
  assert.ok(RECIPES.length >= 580);
  assert.ok(Object.keys(INGREDIENTS).length >= 235);
  const familyIds = new Set(CATALOG_CATEGORIES.map(family => family.id));
  const natureIds = new Set(FOOD_NATURES.map(nature => nature.id));
  for (const recipe of RECIPES) {
    // decorateRecipe をテスト内で再適用すると、data.js の適用漏れを隠してしまいます。
    assert.ok(familyIds.has(recipe.family), recipe.id);
    assert.ok(natureIds.has(recipe.nature) && recipe.nature !== 'unspecified', recipe.id);
    assert.ok(typeof recipe.variantLabel === 'string' && recipe.variantLabel.trim(), recipe.id);
    assert.equal(typeof recipe.mealBase, 'boolean', recipe.id);
  }
  for (const source of [...CLASSIC_MAIN_RECIPES, ...CLASSIC_SIDE_RECIPES, ...PREPARED_RECIPES, ...PERFORMANCE_RECIPES, ...SUSHI_RECIPES, ...TAKEAWAY_RECIPES, ...COMFORT_RECIPES, ...CONFECTIONERY_RECIPES, ...DESSERT_RECIPES, ...ACCOMPANIMENT_RECIPES,...PALETTE_RECIPES]) {
    const integrated = byId.get(source.id);
    assert.ok(integrated, source.id);
    assert.deepEqual(integrated.ingredients, source.ingredients, source.id);
    if(integrated.nature==='home-cooked')assert.ok(integrated.steps.length>=3,source.id);
    else assert.deepEqual(integrated.steps,[],source.id);
    for (const key of ['family', 'nature', 'sourceNote', 'shoppingKnown', 'allergensKnown', 'ingredientsKnown']) {
      const movedSide = ['classic-boiled-egg', 'classic-natto-plain', 'classic-natto-grated-daikon'].includes(source.id);
      assert.equal(integrated[key], movedSide && key === 'family' ? 'small-dish' : source[key], `${source.id}/${key}`);
    }
  }
  assert.deepEqual(['family', 'role', 'staple', 'mealBase'].map(key => byId.get('snack-edamame')[key]), ['small-dish', 'side', false, false]);
  assert.equal(byId.get('daily-snack-oven-karaage').role, 'main');
  assert.equal(byId.get('daily-snack-oven-karaage').family, 'karaage');
});

test('統合後も未確認商品を記録用に残し、自動献立と差し替えには入れない', () => {
  const unconfirmed = new Set(RECIPES.filter(recipe => describeRecipe(recipe.id, data).allergensKnown === false).map(recipe => recipe.id));
  assert.deepEqual(unconfirmed, new Set([...unconfirmedIds,...BREAD_RECIPES.filter(recipe=>recipe.allergensKnown===false).map(recipe=>recipe.id)]));
  const safe = new Set(eligibleRecipes({}, data).map(recipe => recipe.id));
  assert.equal(safe.size, RECIPES.filter(recipe => !unconfirmed.has(recipe.id) && recipe.family !== 'alcohol').length);
  const plan = generateCalendarPlan(settings, data);
  assert.equal(plan.ok, true);
  for (const [dayIndex, day] of plan.days.entries()) {
    assert.ok(day.recipeIds.every(id => safe.has(id)));
    const mainId = day.recipeIds.find(id => byId.get(id).role === 'main');
    assert.ok(mainId);
    const swapped = replaceRecipe(plan, {dayIndex, recipeId: mainId, seed: dayIndex + 7}, data);
    assert.equal(swapped.ok, true);
    assert.ok(swapped.days.every(day => day.recipeIds.every(id => safe.has(id))));
  }
});

test('公開DBの全メニューを数量付きv3記録へ写し、分類・商品説明・確認状況を保存できる', () => {
  const state = defaultJournal('2026-11-12');
  state.entries = RECIPES.map((recipe, index) => entry(`integrated-${index}`, [snapshot(recipe.id, recipePortion(recipe, data).amount * 1.5)], 'eaten'));
  const imported = parseJournal(JSON.stringify(state), data);
  assert.equal(imported.version, 3);
  assert.equal(JOURNAL_KEY, 'kondate-note-v3');
  assert.deepEqual(imported, state);
  for (const [index, recipe] of RECIPES.entries()) {
    const item = imported.entries[index].items[0];
    assert.equal(item.quantity, 1.5, recipe.id);
    assert.equal(item.nature, recipe.nature, recipe.id);
    assert.equal(item.sourceNote, recipe.sourceNote, recipe.id);
    assert.equal(item.shoppingKnown, recipe.shoppingKnown, recipe.id);
    const base = itemFromRecipe(recipe, data).nutrition, scaled = itemNutrition(item);
    for (const key of NUTRIENT_KEYS) {
      if (base[key] === null) assert.equal(scaled[key], null, `${recipe.id}/${key}`);
      else near(scaled[key], base[key] * 1.5, `${recipe.id}/${key}`);
    }
  }
});

test('寿司は貫数、刺身は魚介のg数で記録し、固定寿司へ別の主食や主菜を重ねない', () => {
  const sushi = snapshot('classic-sushi-salmon', 4), sashimi = snapshot('classic-sashimi-tuna', 150);
  assert.equal(sushi.portion.unit, '貫');
  assert.equal(sushi.quantity, 4);
  assert.equal(sashimi.portion.unit, 'g');
  assert.equal(sashimi.quantity, 1.5);
  assert.equal(sashimi.nature, 'ready-to-eat');
  near(sashimi.ingredients.find(part => part.id === 'tuna_lean_sashimi').amount * sashimi.quantity, 150);
  const plan = generateCalendarPlan({...settings, days: 1, stapleId: 'classic-sushi-salmon', stapleAmount: 4}, data);
  assert.equal(plan.ok, true);
  assert.equal(plan.days[0].quantities['classic-sushi-salmon'], 4);
  assert.deepEqual(plan.days[0].recipeIds.filter(id => ['main', 'staple'].includes(byId.get(id).role)), ['classic-sushi-salmon']);
  const state = defaultJournal('2026-11-12');
  state.entries = [entry('historical-sushi-and-fish', [sushi, sashimi], 'eaten')];
  const reducedDB = {...data, recipes: RECIPES.filter(recipe => !['classic-sushi-salmon', 'classic-sashimi-tuna'].includes(recipe.id))};
  assert.deepEqual(parseJournal(JSON.stringify(state), reducedDB), state, '元のレシピがなくなっても過去の単位と説明を保持する');
});

test('統合DBの購入品と家庭料理を混ぜても購入単位と注意を保ち、在庫を一度だけ引く', () => {
  const burger = snapshot('prepared-burger-plain', 2), curry = snapshot('prepared-retort-beef-curry', 0.5), sushi = snapshot('classic-sushi-salmon', 4);
  for (const item of [burger, curry]) {
    assert.equal(item.ingredientsKnown, false);
    assert.equal(item.shoppingKnown, true);
    assert.match(item.sourceNote, /商品表示/);
  }
  const shopping = shoppingForEntries([entry('mixed-plan', [burger, curry, sushi]), entry('already-eaten', [snapshot('prepared-burger-plain')], 'eaten')], data,
    {from: '2026-11-12', to: '2026-11-12', servings: 3, pantry: [{id: 'rice', amount: 100}]});
  const items = new Map(shopping.items.map(item => [item.id, item]));
  assert.equal(items.get('prepared_item_burger_plain').unit, '個');
  near(items.get('prepared_item_burger_plain').required, 6);
  near(items.get('retort_beef_curry').required, 300);
  near(items.get('rice').required, 540);
  near(items.get('rice').buy, 440);
  near(items.get('salmon_sashimi').required, 150);
  assert.ok(!items.has('hamburger_bun'));
  assert.deepEqual(shopping.missingMenus.map(menu => menu.name), [burger.name, curry.name]);
  assert.equal(shopping.entryCount, 1);
});

test('追加項目のない旧v3記録と商品表示から入力したマイメニューを同じ保存形式で扱える', () => {
  const old = defaultJournal('2026-11-12'), oldItem = snapshot('plain-rice');
  delete oldItem.nature;
  delete oldItem.sourceNote;
  delete oldItem.shoppingKnown;
  old.entries = [entry('previous-v3', [oldItem], 'eaten')];
  assert.deepEqual(parseJournal(JSON.stringify(old), data), old);
  const state = structuredClone(old);
  state.customRecipes = [{id: 'custom-package-label', name: '商品表示から登録したカレー', role: 'staple', nature: 'retort',
    sourceNote: '購入した商品の表示を転記。1食分の値。', shoppingKnown: true, ingredientsKnown: false, allergensKnown: false,
    ingredients: [{id: 'retort_beef_curry', amount: 200}, {id: 'rice', amount: 150}], portion: {amount: 1, unit: '食'},
    manualNutrition: {kcal: 490, protein: 12, fat: 15, carbs: 75, fiber: null, salt: 2.5}}];
  const custom = parseJournal(JSON.stringify(state), data).customRecipes[0];
  const item = itemFromRecipe(custom, data);
  assert.equal(item.sourceNote, state.customRecipes[0].sourceNote);
  assert.equal(item.nutrition.kcal, 490);
  assert.equal(item.nutrition.fiber, null);
  assert.equal(item.shoppingKnown, true);
  assert.equal(item.allergensKnown, false);
  assert.equal(item.ingredientsKnown, false);
  assert.ok(!eligibleRecipes({}, {...data, recipes: [...RECIPES, custom]}).some(recipe => recipe.id === custom.id));
});
