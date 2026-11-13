import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {INGREDIENT_NUTRITION} from '../ingredient-nutrients.js';
import {buildCustomDish} from '../dish-customisation.js';
import {NUTRIENT_KEYS, recipeNutrition, itemFromRecipe, itemNutrition} from '../nutrition.js';

const data = {ingredients: INGREDIENTS, recipes: RECIPES, allergens: ALLERGENS};
const close = (actual, expected, label = '') => assert.ok(
  typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - expected) < 1e-8,
  `${label}: expected ${expected}, received ${actual}`,
);
const recipe = id => {
  const found = RECIPES.find(row => row.id === id);
  assert.ok(found, `missing recipe ${id}`);
  return found;
};

test('肉は種類・部位・皮の有無ごとの生の代表値を使用量に掛ける', () => {
  // kcal, protein and fat per 100g of the declared edible meat, checked against
  // the MEXT food rows independently of the app's ingredient lookup.
  const reference = [
    ['beef', 221, 17.9, 17.4],
    ['beef_minced', 251, 17.1, 21.1],
    ['pork', 237, 17.1, 19.2],
    ['pork_minced', 209, 17.7, 17.2],
    ['pork_loin', 248, 19.3, 19.2],
    ['pork_belly', 366, 14.4, 35.4],
    ['beef_short_rib', 338, 14.4, 32.9],
    ['chicken', 190, 16.6, 14.2],
    ['chicken_breast', 105, 23.3, 1.9],
    ['chicken_minced', 171, 17.5, 12.0],
  ];
  for (const [id, kcal, protein, fat] of reference) {
    const values = recipeNutrition({servings: 1, ingredients: [{id, amount: 150}]}, data);
    close(values.kcal, kcal * 1.5, `${id}.kcal`);
    close(values.protein, protein * 1.5, `${id}.protein`);
    close(values.fat, fat * 1.5, `${id}.fat`);
  }
});

test('みりん・清酒の微量脂質を概算し肉料理全体の脂質を失わない', () => {
  // Tr is estimated as 0.03g/100g; mirin and sake weigh 1.17 and 0.999g/ml.
  // Each expected total is a hand sum of the existing two-person recipe.
  for (const [id, fat] of [
    ['pork-ginger', 31.549007],
    ['beef-onion', 21.8973845],
    ['chicken-teriyaki', 23.589007],
  ]) close(recipeNutrition(recipe(id), data).fat, fat, id);
});

test('肉g・油ml・卵個・みりんmlと人数・食べる量を独立に換算する', () => {
  const mixed = {id: 'estimate-mixed', name: '換算確認', role: 'main', servings: 2,
    ingredients: [{id: 'beef', amount: 250}, {id: 'oil', amount: 15},
      {id: 'egg', amount: 2}, {id: 'mirin', amount: 20}], steps: []};
  // 250g beef + 15ml oil (=13.695g) + 2 eggs (=100g edible) + 20ml mirin
  // (=23.4g). Divide their totals by two, then record 1.5 portions.
  const expected = {kcal: 436.184325, protein: 28.5101, fat: 33.70101,
    carbs: 5.3794, fiber: 0, salt: 0.325};
  const values = recipeNutrition(mixed, data), item = itemFromRecipe(mixed, data, 1.5);
  const recorded = itemNutrition(item);
  for (const key of NUTRIENT_KEYS) {
    close(values[key], expected[key], key);
    close(recorded[key], expected[key] * 1.5, `recorded.${key}`);
  }
});

test('肉じゃがの牛豚切替は同じ110gの部位差を脂質へ反映する', () => {
  const beef = buildCustomDish({kind: 'nikujaga', meat: 'beef'}, data);
  const pork = buildCustomDish({kind: 'nikujaga', meat: 'pork'}, data);
  // Only 110g of shoulder meat changes: pork minus beef = 16kcal, -0.8g
  // protein, +1.8g fat per 100g. The other ingredients and seasonings cancel.
  close(pork.manualNutrition.kcal - beef.manualNutrition.kcal, 17.6, 'kcal difference');
  close(pork.manualNutrition.protein - beef.manualNutrition.protein, -0.88, 'protein difference');
  close(pork.manualNutrition.fat - beef.manualNutrition.fat, 1.98, 'fat difference');
  const withoutMeat = dish => dish.ingredients.filter(part => !['beef', 'pork'].includes(part.id));
  assert.deepEqual(withoutMeat(beef), withoutMeat(pork));
});

test('概算値を元の成分表のnullと区別し既知の成分を上書きしない', () => {
  for (const [id, key, estimate] of [
    ['sake', 'fat', 0.0002997], ['mirin', 'fat', 0.000351],
    ['mirin', 'fiber', 0], ['soy_sauce', 'fiber', 0.0003543],
  ]) {
    const meta = INGREDIENT_NUTRITION[id];
    assert.equal(meta.rawNutritionPerUnit[key], null, `${id}.${key} raw`);
    assert.ok(meta.estimatedNutrients.includes(key), `${id}.${key} estimate attribution`);
    close(meta.nutritionPerUnit[key], estimate, `${id}.${key} estimate`);
    assert.match(meta.nutritionSource, /概算|推定/, `${id} explanation`);
  }
  for (const id of ['cumin', 'turmeric']) {
    const meta = INGREDIENT_NUTRITION[id];
    assert.deepEqual(meta.rawNutritionPerUnit, Object.fromEntries(NUTRIENT_KEYS.map(key => [key, null])));
    assert.deepEqual([...meta.estimatedNutrients].sort(), [...NUTRIENT_KEYS].sort());
    for (const key of NUTRIENT_KEYS) assert.ok(Number.isFinite(meta.nutritionPerUnit[key]), `${id}.${key}`);
    assert.ok(meta.nutritionPerUnit.kcal > 0 && meta.nutritionPerUnit.fat > 0 && meta.nutritionPerUnit.fiber > 0, id);
  }
  for (const [id, meta] of Object.entries(INGREDIENT_NUTRITION)) {
    for (const key of NUTRIENT_KEYS) {
      if (meta.rawNutritionPerUnit[key] !== null) {
        assert.equal(meta.nutritionPerUnit[key], meta.rawNutritionPerUnit[key], `${id}.${key} known value`);
        assert.ok(!meta.estimatedNutrients.includes(key), `${id}.${key} is already known`);
      }
    }
  }
});

test('材料から計算する全登録料理で6成分の概算が得られる', () => {
  const calculated = RECIPES.filter(row => row.manualNutrition === undefined);
  assert.ok(calculated.length >= 700, 'exercise the full catalogue, not a small selection');
  for (const row of calculated) {
    const values = recipeNutrition(row, data);
    for (const key of NUTRIENT_KEYS) assert.ok(
      typeof values[key] === 'number' && Number.isFinite(values[key]) && values[key] >= 0,
      `${row.id} ${row.name}.${key}: ${values[key]}`,
    );
  }
});

test('本当に未確認の商品と手入力は不明のまま、過去の記録を再計算しない', () => {
  const unknown = Object.fromEntries(NUTRIENT_KEYS.map(key => [key, null]));
  assert.deepEqual(INGREDIENT_NUTRITION.takeaway_frozen_suigyoza.nutritionPerUnit, unknown);
  const purchased = RECIPES.find(row => row.ingredients.some(part => part.id === 'takeaway_frozen_suigyoza'));
  assert.ok(purchased?.manualNutrition);
  assert.deepEqual(recipeNutrition(purchased, data), unknown);

  const manual = {id: 'custom-unknown', name: '未確認', role: 'side', servings: 1,
    ingredients: [], steps: [], custom: true, manualNutrition: {...unknown, kcal: 100}};
  assert.deepEqual(itemNutrition(itemFromRecipe(manual, data, 2)), {...unknown, kcal: 200});

  const source = recipe('pork-ginger');
  const oldData = {ingredients: Object.fromEntries(Object.entries(INGREDIENTS).map(([id, ingredient]) => [id,
    {...ingredient, nutritionPerUnit: INGREDIENT_NUTRITION[id].rawNutritionPerUnit}]))};
  const oldItem = itemFromRecipe(source, oldData), before = JSON.stringify(oldItem);
  assert.equal(itemNutrition(oldItem).fat, null);
  const newItem = itemFromRecipe(source, data);
  close(itemNutrition(newItem).fat, 31.549007, 'new recipe snapshot');
  assert.equal(JSON.stringify(oldItem), before, 'existing snapshots remain unchanged');
  assert.equal(itemNutrition(oldItem).fat, null);

  const incomplete = {ingredients: {...INGREDIENTS, unknown: {name: '未確認材料', unit: 'g',
    nutritionPerUnit: {...unknown, kcal: 1}}}};
  const values = recipeNutrition({servings: 1, ingredients: [{id: 'beef', amount: 100},
    {id: 'unknown', amount: 10}]}, incomplete);
  close(values.kcal, 231);
  assert.equal(values.fat, null, 'unregistered ingredients must not silently become zero');
});
