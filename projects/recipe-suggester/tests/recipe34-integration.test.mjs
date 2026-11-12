import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {VARIED_INGREDIENTS, VARIED_RECIPES} from '../varied-recipes.js';
import {TAKEAWAY_INGREDIENTS, TAKEAWAY_RECIPES} from '../takeaway-foods.js';
import {COMFORT_INGREDIENTS, COMFORT_RECIPES} from '../comfort-foods.js';
import {CONFECTIONERY_INGREDIENTS, CONFECTIONERY_RECIPES} from '../confectionery-foods.js';
import {DESSERT_INGREDIENTS, DESSERT_RECIPES} from '../dessert-foods.js';
import {describeRecipe, eligibleRecipes, generateCalendarPlan} from '../planner.js';
import {browseDishes, dishClassification} from '../dish-hierarchy.js';
import {defaultJournal, parseJournal} from '../journal.js';
import {itemFromRecipe, itemNutrition} from '../nutrition.js';
import {recipePortion} from '../catalog.js';
import {shoppingForEntries} from '../shopping.js';

const data = {allergens: ALLERGENS, ingredients: INGREDIENTS, recipes: RECIPES};
const byId = new Map(RECIPES.map(recipe => [recipe.id, recipe]));
const additions = [...VARIED_RECIPES, ...TAKEAWAY_RECIPES, ...COMFORT_RECIPES, ...CONFECTIONERY_RECIPES, ...DESSERT_RECIPES];
const addedIds = new Set(additions.map(recipe => recipe.id));
const addedIngredients = new Set([...Object.keys(VARIED_INGREDIENTS), ...Object.keys(TAKEAWAY_INGREDIENTS), ...Object.keys(COMFORT_INGREDIENTS), ...Object.keys(CONFECTIONERY_INGREDIENTS), ...Object.keys(DESSERT_INGREDIENTS)]);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} != ${expected}`);
const snapshot = (id, quantity = 1) => ({...itemFromRecipe(describeRecipe(id, data), data, quantity), portion: recipePortion(byId.get(id), data)});
const entry = (id, items, status = 'eaten') => ({id, date: '2026-11-13', meal: 'dinner', status, items, note: ''});

test('旧711品・268食材は手順と表示文言・間食分類の整理以外のID・材料・分量・栄養を保持する', () => {
  const original = RECIPES.filter(recipe => !addedIds.has(recipe.id));
  const ingredients = Object.fromEntries(Object.entries(INGREDIENTS).filter(([id]) => !addedIngredients.has(id)));
  assert.equal(original.length, 711);
  assert.equal(Object.keys(ingredients).length, 268);
  // v3.5の変更は表示名・説明と間食9品のfamilyです。stepsは従来どおり除外し、
  // name/variantLabel/family/sourceNote/portion.label（食材はname/note）だけを追加で除外。
  // クリーンなv3.4.0の同じ711品・268食材から計算した固定値で、量・単位・栄養は厳守します。
  const stable = original.map(({steps,name,variantLabel,family,sourceNote,...recipe})=>({...recipe,
    ...(recipe.portion?{portion:Object.fromEntries(Object.entries(recipe.portion).filter(([key])=>key!=='label'))}:{})}));
  const stableIngredients = Object.fromEntries(Object.entries(ingredients).map(([id,{name,note,...ingredient}])=>[id,ingredient]));
  assert.equal(hash(stable), '973426e8109f970adae4389b09d12190c0f10f4f1d7a4d60b2f6a66a8ee4a298');
  assert.equal(hash(stableIngredients), '1f37222ab10c64c9d9c678656a83cb0c18cee691f8d8d200815bd468c7df777c');
  assert.equal(RECIPES.length, 711 + additions.length);
});

test('公開DBは購入品の架空の作り方を除き、家庭料理を必要な工程数で読み込める', () => {
  const counts = new Set();
  for (const recipe of RECIPES) {
    const described = describeRecipe(recipe.id, data);
    if (recipe.nature !== 'home-cooked') {
      assert.deepEqual(recipe.steps, [], recipe.id);
      assert.deepEqual(described.steps, [], recipe.id);
    } else {
      assert.ok(recipe.steps.length > 0 && recipe.steps.length <= 50, recipe.id);
      assert.ok(recipe.steps.every(step => typeof step === 'string' && step.trim() && step.length <= 2000), recipe.id);
      counts.add(recipe.steps.length);
    }
  }
  assert.ok(counts.size >= 5, '全料理を同じ工程数へ水増ししない');
  for (const id of ['classic-gyoza', 'classic-shumai', 'classic-hamburg', 'classic-karaage-thigh']) {
    const steps = byId.get(id).steps.join(' ');
    assert.ok(byId.get(id).steps.length >= 6, id);
    assert.match(steps, /75℃.*1分/s, id);
  }
  assert.doesNotMatch(byId.get('snack-soy-cocoa-pudding').steps.join(' '), /卵液|溶き卵/, '卵なしのプリンに卵の工程を足さない');
});

test('新しい詳細手順と空の購入品手順を保存でき、旧スナップショットは書き換えない', () => {
  const state = defaultJournal('2026-11-13');
  const legacy = snapshot('chicken-teriyaki');
  legacy.id = 'historical-recipe-item';
  legacy.steps = ['鶏肉を均等な厚さに開き、調味料を混ぜる。', 'フライパンで中心まで十分に加熱する。', 'たれを煮詰めて切り分ける。'];
  const current = snapshot('classic-shumai', 1.5);
  const purchased = snapshot('takeaway-harusame-wonton', 2);
  state.entries = [entry('historical-meal', [legacy]), entry('current-meal', [current, purchased])];
  const restored = parseJournal(JSON.stringify(state), data);
  assert.deepEqual(restored, state);
  assert.equal(restored.entries[0].items[0].steps.length, 3);
  assert.ok(restored.entries[1].items[0].steps.length >= 6);
  assert.deepEqual(restored.entries[1].items[1].steps, []);
  assert.equal(restored.entries[1].items[1].quantity, 2);
});

test('即席春雨スープ2杯は表示値の2倍になり、3人分の買い物は完成品6個になる', () => {
  const item = snapshot('takeaway-harusame-wonton', 2);
  close(itemNutrition(item).kcal, 156, 'スープも含む表示78kcal/1杯');
  const result = shoppingForEntries([entry('planned-instant-soup', [item], 'planned')], data,
    {from: '2026-11-13', to: '2026-11-13', servings: 3, pantry: []});
  const product = result.items.find(part => part.id === 'takeaway_harusame_wonton');
  assert.equal(product.unit, '個');
  close(product.required, 6, '完成品の購入数');
  close(result.items.find(part => part.id === 'water').required, 1320, '調製する湯220ml×2杯×3人');
  assert.ok(result.missingMenus.some(menu => menu.name === item.name), '未確認の原材料を確認済みに変えない');
});

test('レシピを省いた水・牛乳は提案でき、未確認の商品とお酒は候補へ戻さない', () => {
  const safe = new Set(eligibleRecipes({}, data).map(recipe => recipe.id));
  assert.ok(safe.has('drink-water'));
  assert.ok(safe.has('drink-milk'));
  for (const recipe of RECIPES) {
    if (recipe.allergensKnown === false || recipe.family === 'alcohol') assert.ok(!safe.has(recipe.id), recipe.id);
  }
  for (const drinkId of ['drink-water', 'drink-milk']) {
    const plan = generateCalendarPlan({startDate: '2026-11-13', days: 1, servings: 2, meal: 'all', drinkId, seed: 14}, data);
    assert.equal(plan.ok, true);
    assert.equal(plan.days.length, 3);
    assert.ok(plan.days.every(day => day.recipeIds.includes(drinkId)), drinkId);
  }
  assert.ok(!eligibleRecipes({allergens: ['milk']}, data).some(recipe => recipe.id === 'drink-milk'));
});

test('新メニューは表示階層から一度ずつ見つかり、商品と家庭料理の違いを保つ', () => {
  for (const source of additions) {
    const recipe = byId.get(source.id);
    assert.ok(recipe, source.id);
    assert.deepEqual(recipe.ingredients, source.ingredients, source.id);
    assert.deepEqual(recipe.manualNutrition, source.manualNutrition, source.id);
    assert.equal(recipe.nature, source.nature, source.id);
    const classification = dishClassification(recipe);
    const result = browseDishes(RECIPES, {section: classification.section,
      ...(['main', 'side'].includes(classification.section) ? {category: classification.category, method: classification.method} : {})});
    assert.equal(result.filter(item => item.id === recipe.id).length, 1, source.id);
    assert.doesNotThrow(() => snapshot(recipe.id, 0.5), source.id);
  }
});

test('公開メニュー検索はかな・漢字の同じ語で同じ結果を返し、調理法の違いも保つ', () => {
  const recipes = RECIPES.map(recipe => ({...recipe, ingredients: recipe.ingredients.map(part => ({...part, name: INGREDIENTS[part.id].name}))}));
  const find = query => browseDishes(recipes, {query}).map(recipe => recipe.id).sort();
  for (const variants of [['焼売', 'しゅうまい', 'シューマイ'], ['唐揚げ', 'からあげ', 'カラアゲ'],
    ['焼き鳥', 'やきとり', 'ヤキトリ'], ['春巻き', 'はるまき', 'ハルマキ'], ['鰻', 'うなぎ', 'ウナギ'], ['春雨', 'はるさめ', 'ハルサメ']]) {
    const expected = find(variants[0]);
    assert.ok(expected.length, variants[0]);
    for (const query of variants.slice(1)) assert.deepEqual(find(query), expected, query);
  }
  assert.ok(find('すいぎょうざ').includes('varied-boiled-gyoza'));
  assert.ok(!find('すいぎょうざ').includes('classic-gyoza'));
  assert.ok(find('ぎょうざ').includes('classic-gyoza'));
  assert.ok(find('ぎょうざ').includes('varied-boiled-gyoza'));
});
