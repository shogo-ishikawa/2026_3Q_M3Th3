import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {FAMILIAR_MAIN_INGREDIENTS, FAMILIAR_MAIN_RECIPES} from '../familiar-mains.js';
import {FAMILIAR_SIDE_INGREDIENTS, FAMILIAR_SIDE_RECIPES} from '../familiar-sides.js';
import {SUSHI_INGREDIENTS, SUSHI_RECIPES} from '../sushi-foods.js';
import {PERFORMANCE_INGREDIENTS, PERFORMANCE_RECIPES} from '../performance-foods.js';
import {TAKEAWAY_INGREDIENTS, TAKEAWAY_RECIPES} from '../takeaway-foods.js';
import {VARIED_INGREDIENTS, VARIED_RECIPES} from '../varied-recipes.js';
import {COMFORT_INGREDIENTS, COMFORT_RECIPES} from '../comfort-foods.js';
import {CONFECTIONERY_INGREDIENTS, CONFECTIONERY_RECIPES} from '../confectionery-foods.js';
import {DESSERT_INGREDIENTS, DESSERT_RECIPES} from '../dessert-foods.js';
import {ACCOMPANIMENT_INGREDIENTS, ACCOMPANIMENT_RECIPES} from '../accompaniment-foods.js';
import {SALAD_INGREDIENTS} from '../salad-builder.js';
import {DISH_CUSTOM_INGREDIENTS} from '../dish-customisation.js';
import {CATALOG_CATEGORIES, recipePortion} from '../catalog.js';
import {dishSection, dishClassification, browseDishes, availableDishCategories, availableCookingMethods} from '../dish-hierarchy.js';
import {describeRecipe, eligibleRecipes, generateCalendarPlan} from '../planner.js';
import {NUTRIENT_KEYS, itemFromRecipe, itemNutrition} from '../nutrition.js';
import {defaultJournal, parseJournal, JOURNAL_KEY} from '../journal.js';
import {shoppingForEntries} from '../shopping.js';

const data = {allergens: ALLERGENS, ingredients: INGREDIENTS, recipes: RECIPES};
const incoming = [...FAMILIAR_MAIN_RECIPES, ...FAMILIAR_SIDE_RECIPES];
const additions = [...incoming, ...SUSHI_RECIPES, ...PERFORMANCE_RECIPES, ...TAKEAWAY_RECIPES, ...VARIED_RECIPES, ...COMFORT_RECIPES, ...CONFECTIONERY_RECIPES, ...DESSERT_RECIPES, ...ACCOMPANIMENT_RECIPES];
const addedIds = new Set(additions.map(recipe => recipe.id));
const addedIngredientIds = new Set([...Object.keys(FAMILIAR_MAIN_INGREDIENTS), ...Object.keys(FAMILIAR_SIDE_INGREDIENTS), ...Object.keys(SUSHI_INGREDIENTS), ...Object.keys(PERFORMANCE_INGREDIENTS), ...Object.keys(TAKEAWAY_INGREDIENTS), ...Object.keys(VARIED_INGREDIENTS), ...Object.keys(COMFORT_INGREDIENTS), ...Object.keys(CONFECTIONERY_INGREDIENTS), ...Object.keys(DESSERT_INGREDIENTS), ...Object.keys(ACCOMPANIMENT_INGREDIENTS), ...Object.keys(SALAD_INGREDIENTS), ...Object.keys(DISH_CUSTOM_INGREDIENTS)]);
const reclassifiedSides = new Set(['classic-boiled-egg', 'classic-natto-plain', 'classic-natto-grated-daikon']);
// v3.6で副菜へ移した3品だけを旧roleへ戻し、歴史的な固定ハッシュを保ちます。
// 別の料理のrole変更や、3品の材料・量・栄養変更を許容する投影ではありません。
const historicalRole = recipe => reclassifiedSides.has(recipe.id) ? {...recipe, role: 'main'} : recipe;
const byId = new Map(RECIPES.map(recipe => [recipe.id, recipe]));
const entry = (id, items, status = 'planned') => ({id, date: '2026-11-12', meal: 'dinner', status, note: '', items});
const snapshot = (recipe, quantity = 1) => ({...itemFromRecipe(describeRecipe(recipe.id, data), data, quantity), portion: recipePortion(recipe, data)});
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-8, `${label}: ${actual} != ${expected}`);

test('既存580品は手順と表示文言・間食分類の整理と3品の副菜への移動以外の材料・量・栄養・一意性を保つ', () => {
  const originalRecipes = RECIPES.filter(recipe => !addedIds.has(recipe.id));
  const originalIngredients = Object.fromEntries(Object.entries(INGREDIENTS).filter(([id]) => !addedIngredientIds.has(id)));
  assert.equal(originalRecipes.length, 580);
  assert.equal(Object.keys(originalIngredients).length, 235);
  // 寿司・飲料の8品は下で意図を検査します。572品・235食材の基準件数は維持します。
  // v3.5は間食9品のfamilyと購入品の表示名・説明を整理します。stepsの既存の除外に加え、
  // name/variantLabel/family/sourceNote/portion.label（食材はname/note）だけを投影から除きます。
  // 固定ハッシュはクリーンなv3.4.0公開DBから独立計算済み。材料・量・単位・栄養は除外しません。
  const changedIds = new Set(['classic-sushi-tuna', 'classic-sushi-salmon', 'classic-sushi-shrimp', 'classic-sushi-squid',
    'classic-sushi-assorted', 'drink-milk-cocoa', 'drink-soy-cocoa', 'drink-yogurt']);
  const stableRecipes = originalRecipes.filter(recipe => !changedIds.has(recipe.id)).map(historicalRole).map(({steps,name,variantLabel,family,sourceNote,...recipe})=>({...recipe,
    ...(recipe.portion?{portion:Object.fromEntries(Object.entries(recipe.portion).filter(([key])=>key!=='label'))}:{})}));
  const stableIngredients = Object.fromEntries(Object.entries(originalIngredients).map(([id,{name,note,...ingredient}])=>[id,ingredient]));
  assert.equal(stableRecipes.length, 572);
  const digest = createHash('sha256').update(JSON.stringify({RECIPES: stableRecipes, INGREDIENTS: stableIngredients})).digest('hex');
  assert.equal(digest, '74f349c1874544d03436ab77ffa3e472a181468f40c3fb04a8643435d37bc5d8');
  for (const id of ['classic-sushi-tuna', 'classic-sushi-salmon', 'classic-sushi-shrimp', 'classic-sushi-squid']) {
    const recipe = byId.get(id);
    assert.equal(recipe.portion.amount, 1, id);
    assert.equal(recipe.portion.unit, '貫', id);
    assert.equal(recipe.servings, 2, id);
    assert.equal(recipe.ingredients.find(part => part.id === 'rice').amount, 45, id);
    assert.equal(recipe.ingredients.find(part => part.id === 'soy_sauce').amount, 1, id);
    assert.equal(recipe.mealBase, true, id);
  }
  assert.equal(byId.get('classic-sushi-assorted').portion.amount, 1);
  assert.equal(byId.get('classic-sushi-assorted').portion.unit, '皿');
  assert.match(byId.get('classic-sushi-assorted').portion.label, /8貫/);
  assert.equal(byId.get('classic-sushi-assorted').ingredients.find(part => part.id === 'rice').amount, 360);
  for (const id of ['drink-milk-cocoa', 'drink-soy-cocoa', 'drink-yogurt']) assert.equal(byId.get(id).family, 'other-drink', id);
  assert.equal(RECIPES.length, 580 + additions.length);
  assert.equal(incoming.length, 87);
  assert.equal(Object.keys(INGREDIENTS).length, 235 + addedIngredientIds.size);
  assert.equal(new Set(RECIPES.map(recipe => recipe.id)).size, RECIPES.length);
  for (const source of incoming) {
    const integrated = byId.get(source.id);
    assert.ok(integrated, source.id);
    for (const key of ['role', 'family', 'servings', 'portion', 'ingredients', 'displayCategory', 'displayMethod', 'displaySecondaryCategories']) {
      assert.deepEqual(integrated[key], source[key], `${source.id}/${key}`);
    }
  }
  const sections = ['main', 'side', 'staple', 'soup', 'drink', 'snack'];
  const shown = sections.flatMap(section => {
    const recipes = browseDishes(RECIPES, {section});
    assert.ok(recipes.length > 0, section);
    assert.ok(recipes.every(recipe => dishSection(recipe) === section), section);
    return recipes;
  });
  assert.equal(shown.length, RECIPES.length);
  assert.equal(new Set(shown.map(recipe => recipe.id)).size, RECIPES.length);
  const canonicalRoles = new Map(CATALOG_CATEGORIES.map(category => [category.id, category.role]));
  const oldStaples = RECIPES.filter(recipe => !addedIds.has(recipe.id) && recipe.role === 'main' && canonicalRoles.get(recipe.family) === 'staple');
  assert.equal(oldStaples.length, 30);
  const mainIds = new Set(browseDishes(RECIPES, {section: 'main'}).map(recipe => recipe.id));
  const stapleIds = new Set(browseDishes(RECIPES, {section: 'staple'}).map(recipe => recipe.id));
  for (const recipe of oldStaples) {
    assert.ok(stapleIds.has(recipe.id), recipe.id);
    assert.ok(!mainIds.has(recipe.id), recipe.id);
  }
});

test('新87品の階層が統合後も使え、別の食材カテゴリから同じ料理へ到達できる', () => {
  for (const source of incoming) {
    const recipe = byId.get(source.id), display = dishClassification(recipe);
    assert.equal(display.section, source.role, source.id);
    if (['main', 'side'].includes(display.section)) {
      assert.equal(display.category, source.displayCategory, source.id);
      assert.equal(display.method, ['karaage','cutlet','croquette','fry'].includes(source.displayMethod) ? 'fried' : source.displayMethod, source.id);
      for (const category of [display.category, ...display.secondaryCategories]) {
        const result = browseDishes(RECIPES, {section: display.section, category, method: display.method});
        assert.equal(result.filter(item => item.id === recipe.id).length, 1, `${recipe.id}/${category}`);
        assert.equal(result.find(item => item.id === recipe.id), recipe, '表示用に別レシピへ作り替えない');
      }
    } else {
      assert.ok(['staple', 'soup'].includes(display.section), source.id);
      assert.deepEqual(browseDishes([recipe], {category: source.displayCategory}), [], source.id);
    }
  }
  const meuniere = browseDishes(RECIPES, {section: 'main', category: 'fish', method: 'meuniere'});
  assert.deepEqual(meuniere.map(recipe => recipe.id).sort(), ['familiar-aji-meuniere', 'familiar-cod-meuniere', 'familiar-salmon-meuniere']);
  const fromMeat = browseDishes(RECIPES, {section: 'main', category: 'meat', method: 'hotpot'});
  const fromBeans = browseDishes(RECIPES, {section: 'main', category: 'bean', method: 'hotpot'});
  assert.equal(fromMeat.find(recipe => recipe.id === 'familiar-sukiyaki'), fromBeans.find(recipe => recipe.id === 'familiar-sukiyaki'));
  assert.ok(browseDishes(RECIPES, {section: 'side', category: 'vegetable', method: 'salad'}).some(recipe => recipe.id === 'familiar-side-caesar'));
});

test('新メニューの記録は既存v3形式のまま数量・栄養・説明を保持し、表示専用項目を保存しない', () => {
  const state = defaultJournal('2026-11-12');
  state.entries = incoming.map((source, index) => entry(`new-${index}`, [snapshot(byId.get(source.id), index % 2 ? 1.5 : 0.5)], 'eaten'));
  const imported = parseJournal(JSON.stringify(state), data);
  assert.equal(JOURNAL_KEY, 'kondate-note-v3');
  assert.equal(imported.version, 3);
  assert.deepEqual(imported, state);
  for (const [index, source] of incoming.entries()) {
    const recipe = byId.get(source.id), item = imported.entries[index].items[0], base = itemFromRecipe(recipe, data);
    assert.equal(item.recipeId, source.id);
    assert.equal(item.role, source.role);
    assert.equal(item.sourceNote, source.sourceNote);
    assert.equal(item.nature, source.nature);
    assert.deepEqual(item.portion, recipePortion(recipe, data));
    assert.equal(item.allergensKnown, true);
    assert.equal(item.ingredientsKnown, true);
    for (const key of ['displayCategory', 'displayMethod', 'displaySecondaryCategories', 'category', 'method', 'methodDetail']) assert.ok(!Object.hasOwn(item, key), `${recipe.id}/${key}`);
    const actual = itemNutrition(item);
    for (const key of NUTRIENT_KEYS) {
      if (base.nutrition[key] === null) assert.equal(actual[key], null, `${recipe.id}/${key}`);
      else close(actual[key], base.nutrition[key] * item.quantity, `${recipe.id}/${key}`);
    }
  }
});

test('新87品を半量ずつ4人分にすると原レシピの材料合計になり、表示カテゴリで買物を二重計上しない', () => {
  const planned = incoming.map((source, index) => entry(`shopping-${index}`, [snapshot(byId.get(source.id), 0.5)]));
  const required = new Map();
  for (const source of incoming) {
    assert.equal(source.servings, 2, source.id);
    for (const part of source.ingredients) required.set(part.id, (required.get(part.id) ?? 0) + part.amount);
  }
  const result = shoppingForEntries(planned, data, {from: '2026-11-12', to: '2026-11-12', servings: 4, pantry: [{id: 'rice', amount: 125}]});
  assert.equal(result.entryCount, 87);
  assert.equal(result.items.length, required.size);
  assert.deepEqual(result.missingMenus, []);
  for (const item of result.items) {
    close(item.required, required.get(item.id), item.id);
    close(item.buy, Math.max(0, required.get(item.id) - (item.id === 'rice' ? 125 : 0)), item.id);
    assert.equal(item.unit, INGREDIENTS[item.id].unit, item.id);
  }
});

test('表示階層を絞ってもアレルゲン条件と未確認商品の除外を緩めず、献立や元データを変更しない', () => {
  const before = structuredClone(RECIPES), options = {startDate: '2026-11-12', days: 3, servings: 2, seed: 107};
  const plan = generateCalendarPlan(options, data);
  const safe = eligibleRecipes({allergens: ['milk', 'wheat']}, data);
  assert.deepEqual(browseDishes(safe, {section: 'main', category: 'fish', method: 'meuniere'}), [], 'バターや小麦を避ける条件を空候補でも緩めない');
  for (const section of ['all', 'main', 'side', 'staple', 'soup', 'drink', 'snack']) {
    availableDishCategories(safe, {section});
    availableCookingMethods(safe, {section});
    browseDishes(safe, {section});
  }
  const allowedIds = new Set(eligibleRecipes({}, data).map(recipe => recipe.id));
  assert.ok(plan.ok);
  assert.ok(plan.days.every(day => day.recipeIds.every(id => allowedIds.has(id))));
  assert.deepEqual(new Set(RECIPES.filter(recipe => !allowedIds.has(recipe.id)).map(recipe => recipe.id)),
    new Set(RECIPES.filter(recipe => describeRecipe(recipe.id, data).allergensKnown === false || recipe.family === 'alcohol').map(recipe => recipe.id)));
  assert.deepEqual(generateCalendarPlan(options, data), plan);
  assert.deepEqual(RECIPES, before);
});

