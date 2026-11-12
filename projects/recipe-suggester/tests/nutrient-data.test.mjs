import test from 'node:test';
import assert from 'node:assert/strict';
import { INGREDIENTS } from '../data.js';
import { INGREDIENT_NUTRITION } from '../ingredient-nutrients.js';

const keys = ['kcal', 'protein', 'fat', 'carbs', 'fiber', 'salt'];
const value = (id, key, amount = 1) => INGREDIENT_NUTRITION[id].nutritionPerUnit[key] * amount;
const close = (actual, expected, tolerance = 1e-6) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `expected ${expected}, received ${actual}`,
);

test('every built-in ingredient has an attributed six-component profile', () => {
  for (const id of Object.keys(INGREDIENTS)) {
    const metadata = INGREDIENT_NUTRITION[id];
    assert.ok(metadata, `missing ingredient profile: ${id}`);
    assert.deepEqual(Object.keys(metadata.nutritionPerUnit), keys);
    assert.ok(metadata.nutritionSource.length > 20, `missing source: ${id}`);
  }
  for (const [id, metadata] of Object.entries(INGREDIENT_NUTRITION)) {
    for (const key of keys) {
      const number = metadata.nutritionPerUnit[key];
      assert.ok(number === null || (Number.isFinite(number) && number >= 0), `${id}.${key}`);
    }
  }
});

test('new staples, unsweetened drinks and berries also have profiles', () => {
  for (const id of [
    'brown_rice', 'cooked_barley', 'wholegrain_bread', 'oatmeal', 'somen',
    'green_tea', 'roasted_tea', 'barley_tea', 'oolong_tea', 'black_tea', 'coffee',
    'cocoa_powder', 'orange_juice', 'apple_juice', 'tomato_juice', 'strawberry', 'blueberry',
  ]) assert.ok(INGREDIENT_NUTRITION[id], id);
});

test('an egg means 50g edible weight, and a shell-on clam uses its edible yield', () => {
  close(value('egg', 'kcal'), 71);
  close(value('egg', 'protein'), 6.1);
  close(value('egg', 'fat'), 5.1);
  // MEXT10281: 29kcal and 5.7g protein per100g edible; shell-on yield30%.
  close(value('clam', 'kcal', 100), 8.7);
  close(value('clam', 'protein', 100), 1.71);
  // The peeled shrimp itself is edible, so shell-on refuse is not applied twice.
  close(value('shrimp', 'protein', 100), 19.6);
});

test('oil volume is converted with density, not treated as grams', () => {
  close(value('oil', 'fat', 15), 13.695);
  close(value('olive_oil', 'fat', 15), 13.65);
  close(value('sesame_oil', 'fat', 15), 13.8);
  assert.ok(value('oil', 'kcal', 15) > 120 && value('oil', 'kcal', 15) < 123);
});

test('salt, soy sauce and miso use the declared units and realistic salt content', () => {
  close(value('salt', 'salt', 1), 0.995);
  close(value('soy_sauce', 'salt', 15), 2.568675);
  close(value('miso', 'salt', 18), 2.232);
  assert.equal(value('salt', 'kcal'), 0);
  assert.equal(INGREDIENTS.soy_sauce.unit, 'ml');
  assert.equal(INGREDIENTS.miso.unit, 'g');
});

test('cooked and dried staples remain distinct', () => {
  close(value('rice', 'kcal', 150), 234);
  close(value('pasta', 'kcal', 100), 347);
  close(value('udon', 'kcal', 100), 95);
  close(value('brown_rice', 'kcal', 150), 228);
  assert.ok(value('barley', 'kcal') > value('cooked_barley', 'kcal') * 2);
});

test('heated potato is estimated from boiled composition and the official97% weight yield', () => {
  close(value('potato', 'kcal', 100), 68.87);
  close(value('potato', 'fiber', 100), 3.007);
  close(value('potato', 'protein', 100), 1.649);
  assert.match(INGREDIENT_NUTRITION.potato.nutritionSource, /食品番号02019/);
  assert.match(INGREDIENT_NUTRITION.potato.nutritionSource, /重量変化率97%/);
  // 125g in the fish stew plus130g in the potato cakes are one person's raw inputs.
  close(value('potato', 'fiber', 125 + 130), 7.66785);
});

test('cooked legumes use cooked profiles rather than dry-bean composition', () => {
  for (const [id, code, kcal, fiber] of [
    ['soybeans', '04024', 163, 8.5],
    ['lentil_cooked', '04094', 149, 9.4],
    ['chickpea_cooked', '04066', 149, 11.6],
    ['white_bean_cooked', '04008', 127, 13.6],
    ['kidney_bean_cooked', '04008', 127, 13.6],
  ]) {
    close(value(id, 'kcal', 100), kcal);
    close(value(id, 'fiber', 100), fiber);
    assert.ok(INGREDIENT_NUTRITION[id].nutritionSource.includes(`食品番号${code}`), id);
  }
});

test('unknown and trace components stay null while source-defined zeros stay zero', () => {
  for (const id of ['turmeric', 'cumin']) {
    assert.deepEqual(INGREDIENT_NUTRITION[id].nutritionPerUnit,
      Object.fromEntries(keys.map(key => [key, null])));
  }
  assert.equal(INGREDIENT_NUTRITION.cashew.nutritionPerUnit.salt, null);
  assert.equal(INGREDIENT_NUTRITION.soba.nutritionPerUnit.salt, null);
  assert.equal(INGREDIENT_NUTRITION.somen.nutritionPerUnit.salt, null);
  assert.equal(INGREDIENT_NUTRITION.soy_sauce.nutritionPerUnit.fiber, null);
  assert.equal(INGREDIENT_NUTRITION.green_tea.nutritionPerUnit.fiber, null);
  assert.equal(INGREDIENT_NUTRITION.lemon.nutritionPerUnit.fiber, null);
  assert.equal(value('egg', 'fiber'), 0);
  assert.deepEqual(INGREDIENT_NUTRITION.water.nutritionPerUnit,
    Object.fromEntries(keys.map(key => [key, 0])));
});

test('density assumptions are visible in the attribution and metadata is immutable', () => {
  close(value('milk', 'kcal', 200), 125.66);
  close(value('orange_juice', 'kcal', 200), 94.76);
  assert.match(INGREDIENT_NUTRITION.milk.nutritionSource, /1ml=1.03g/);
  assert.match(INGREDIENT_NUTRITION.clam.nutritionSource, /可食率30%/);
  assert.ok(Object.isFrozen(INGREDIENT_NUTRITION));
  assert.ok(Object.isFrozen(INGREDIENT_NUTRITION.egg.nutritionPerUnit));
});
