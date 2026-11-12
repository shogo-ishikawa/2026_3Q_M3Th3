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

test('everyday noodles and pizza crust retain their declared preparation state', () => {
  close(value('yakisoba_noodles', 'kcal', 200), 324);
  close(value('ramen_noodles', 'kcal', 200), 266);
  close(value('pizza_base', 'kcal', 100), 265);
  close(value('pizza_base', 'protein', 100), 9.1);
  assert.match(INGREDIENT_NUTRITION.yakisoba_noodles.nutritionSource, /蒸し中華めん/);
  assert.match(INGREDIENT_NUTRITION.ramen_noodles.nutritionSource, /ゆでた中華めん/);
  assert.match(INGREDIENT_NUTRITION.pizza_base.nutritionSource, /具やチーズは含みません/);
});

test('everyday sauces use official volume densities', () => {
  close(value('worcestershire_sauce', 'salt', 10), 1.01575);
  close(value('oyster_sauce', 'salt', 10), 1.4022);
  close(value('worcestershire_sauce', 'kcal', 10), 13.9815);
  assert.match(INGREDIENT_NUTRITION.worcestershire_sauce.nutritionSource, /100ml=119.5g/);
  assert.match(INGREDIENT_NUTRITION.oyster_sauce.nutritionSource, /100ml=123g/);
});

test('processed snacks use the appropriate official representative foods', () => {
  close(value('potato_chips', 'kcal', 30), 162.3);
  close(value('chocolate', 'kcal', 20), 110);
  close(value('biscuit', 'kcal', 20), 102.4);
  close(value('vanilla_ice_cream', 'kcal', 80), 142.4);
  close(value('rice_cracker', 'salt', 20), 0.26);
  assert.match(INGREDIENT_NUTRITION.vanilla_ice_cream.nutritionSource, /普通脂肪/);
  assert.match(INGREDIENT_NUTRITION.potato_chips.nutritionSource, /成形品やフレーバー/);
});

test('finished fried food, canned tuna and bacon are not treated as raw lean meat', () => {
  close(value('shrimp_tempura', 'kcal', 40), 77.6);
  close(value('shrimp_tempura', 'fat', 40), 4.12);
  close(value('tuna_canned', 'kcal', 80), 56);
  close(value('bacon', 'salt', 40), 1.04);
  assert.match(INGREDIENT_NUTRITION.shrimp_tempura.nutritionSource, /衣と吸収油を含む/);
  assert.match(INGREDIENT_NUTRITION.tuna_canned.nutritionSource, /液汁を含む/);
});

test('sugared drinks and unsweetened carbonated water remain separate', () => {
  close(value('cola', 'kcal', 250), 118.45);
  close(value('cola', 'carbs', 250), 29.355);
  close(value('sports_drink', 'kcal', 500), 106.05);
  close(value('sports_drink', 'salt', 500), 0.505);
  assert.equal(INGREDIENT_NUTRITION.cola.nutritionPerUnit.fat, null);
  assert.equal(INGREDIENT_NUTRITION.cola.nutritionPerUnit.fiber, null);
  assert.equal(INGREDIENT_NUTRITION.sports_drink.nutritionPerUnit.fat, null);
  assert.equal(INGREDIENT_NUTRITION.sports_drink.nutritionPerUnit.fiber, null);
  assert.deepEqual(INGREDIENT_NUTRITION.carbonated_water.nutritionPerUnit,
    Object.fromEntries(keys.map(key => [key, 0])));
});

test('raw rice, fresh basil and finished pork buns have separate representative profiles', () => {
  close(value('uncooked_rice', 'kcal', 60), 205.2);
  close(value('uncooked_rice', 'carbs', 60), 46.56);
  close(value('fresh_basil', 'kcal', 20), 4.2);
  close(value('octopus', 'protein', 50), 10.85);
  close(value('steamed_pork_bun', 'kcal', 100), 242);
  assert.notEqual(INGREDIENT_NUTRITION.uncooked_rice.nutritionPerUnit.kcal,
    INGREDIENT_NUTRITION.rice.nutritionPerUnit.kcal);
  assert.match(INGREDIENT_NUTRITION.fresh_basil.nutritionSource, /乾燥バジルとは区別/);
  assert.match(INGREDIENT_NUTRITION.steamed_pork_bun.nutritionSource, /皮と肉あん/);
});

test('sashimi uses the declared species, edible parts and fat classification', () => {
  for (const [id, code, kcal, protein, fat] of [
    ['tuna_lean_sashimi', '10253', 115, 26.4, 1.4],
    ['tuna_mediumfat_sashimi', '10254', 308, 20.1, 27.5],
    ['salmon_sashimi', '10402', 176, 20.5, 10.8],
    ['yellowtail_sashimi', '10241', 222, 21.4, 17.6],
    ['seabream_sashimi', '10408', 131, 21.2, 5.9],
    ['bonito_sashimi', '10086', 108, 25.8, 0.5],
    ['horse_mackerel_sashimi', '10389', 108, 19.7, 4.1],
    ['squid_sashimi', '10418', 80, 18.6, 0.6],
    ['scallop_sashimi', '10313', 82, 16.9, 0.3],
  ]) {
    close(value(id, 'kcal', 100), kcal);
    close(value(id, 'protein', 100), protein);
    close(value(id, 'fat', 100), fat);
    assert.match(INGREDIENT_NUTRITION[id].nutritionSource, new RegExp(`食品番号${code}`));
  }
  assert.match(INGREDIENT_NUTRITION.tuna_mediumfat_sashimi.nutritionSource, /中トロ専用の分析値ではなく/);
  assert.match(INGREDIENT_NUTRITION.salmon_sashimi.nutritionSource, /サーモントラウト/);
});

test('classic fish and meat recipes start with raw edible input rather than whole-fish or cooked weights', () => {
  close(value('atka_mackerel_dried', 'kcal', 100), 161);
  close(value('atka_mackerel_dried', 'salt', 100), 1.8);
  close(value('saury', 'fat', 100), 25.6);
  close(value('shishamo', 'salt', 100), 1.5);
  close(value('pork_loin', 'protein', 100), 19.3);
  close(value('dumpling_wrappers', 'kcal', 100), 275);
  close(value('dumpling_wrappers', 'carbs', 100), 57);
  assert.match(INGREDIENT_NUTRITION.atka_mackerel_dried.nutritionSource, /加熱前の可食重量/);
  assert.match(INGREDIENT_NUTRITION.shishamo.nutritionSource, /魚体全体重量/);
});

test('small-dish ingredients distinguish dried macaroni, cooked vegetables and salted fish or seaweed', () => {
  close(value('macaroni', 'kcal', 50), 173.5);
  close(value('bamboo_shoot_cooked', 'fiber', 100), 3.3);
  close(value('shirasu_dried', 'salt', 20), 0.84);
  close(value('mozuku', 'salt', 50), 0.3);
  close(value('mekabu', 'salt', 50), 0.2);
  close(value('konjac', 'kcal', 100), 5);
  assert.equal(INGREDIENT_NUTRITION.konjac.nutritionPerUnit.fat, null);
  assert.equal(INGREDIENT_NUTRITION.konjac.nutritionPerUnit.salt, 0);
  assert.match(INGREDIENT_NUTRITION.macaroni.nutritionSource, /乾マカロニ/);
  assert.match(INGREDIENT_NUTRITION.bamboo_shoot_cooked.nutritionSource, /下ゆで/);
});

test('instant noodles include dry contents and seasoning, with water counted separately', () => {
  for (const [id, kcal, salt] of [
    ['cup_ramen_soy_dry', 417, 6.3],
    ['cup_ramen_salt_dry', 422, 5.8],
    ['cup_ramen_nonfried_dry', 314, 7.1],
    ['cup_udon_dry', 437, 6.7],
    ['cup_soba_dry', 437, 6.7],
    ['cup_yakisoba_dry', 418, 3.8],
    ['bag_fried_noodles_dry', 439, 5.6],
    ['bag_nonfried_noodles_dry', 336, 6.9],
  ]) {
    close(value(id, 'kcal', 100), kcal);
    close(value(id, 'salt', 100), salt);
    assert.match(INGREDIENT_NUTRITION[id].nutritionSource, /乾燥/);
  }
  // A dry 90g serving plus 400ml water retains 90g of dry contents in this model.
  close(value('cup_ramen_soy_dry', 'kcal', 90) + value('water', 'kcal', 400), 375.3);
  close(value('cup_ramen_soy_dry', 'salt', 90) + value('water', 'salt', 400), 5.67);
  assert.match(INGREDIENT_NUTRITION.cup_soba_dry.nutritionSource, /カップそば専用の分析値ではありません/);
});

test('prepared curry and donburi toppings do not already contain a serving of rice', () => {
  for (const [id, code, kcal] of [
    ['retort_beef_curry', '18001', 119],
    ['retort_pork_curry', '18041', 116],
    ['retort_chicken_curry', '18040', 131],
    ['retort_oyakodon_topping', '18030', 101],
    ['retort_mapo_topping', '18049', 104],
  ]) {
    close(value(id, 'kcal', 100), kcal);
    assert.match(INGREDIENT_NUTRITION[id].nutritionSource, new RegExp(`食品番号${code}`));
    assert.match(INGREDIENT_NUTRITION[id].nutritionSource, /ご飯/);
  }
  close(value('retort_beef_curry', 'kcal', 180) + value('rice', 'kcal', 150), 448.2);
  close(value('retort_mapo_topping', 'protein', 100), 7.8);
  assert.match(INGREDIENT_NUTRITION.retort_mapo_topping.nutritionSource, /豆腐を含む/);
});

test('burger model ingredients use cooked food profiles and retain unmeasured fibre', () => {
  close(value('hamburger_bun', 'kcal', 60), 163.8);
  close(value('burger_meat_patty', 'kcal', 80), 157.6);
  close(value('burger_chicken_patty', 'fat', 80), 10.24);
  close(value('ready_breaded_fish', 'fat', 80), 17.44);
  close(value('ready_sliced_ham', 'salt', 20), 0.46);
  assert.equal(INGREDIENT_NUTRITION.burger_chicken_patty.nutritionPerUnit.fiber, null);
  assert.equal(INGREDIENT_NUTRITION.ready_breaded_fish.nutritionPerUnit.fiber, null);
  assert.match(INGREDIENT_NUTRITION.hamburger_bun.nutritionSource, /コッペパン/);
  assert.match(INGREDIENT_NUTRITION.ready_sliced_ham.nutritionSource, /食品番号11176/);
  assert.match(INGREDIENT_NUTRITION.ready_breaded_fish.nutritionSource, /衣と吸収油/);
});

test('unidentified bought products keep unknown components separate from complete-meal models', () => {
  for (const id of [
    'retort_vegetable_curry_model', 'retort_keema_curry_model', 'retort_gyudon_model', 'retort_chukadon_model',
    'prepared_item_burger_plain', 'prepared_item_burger_cheese', 'prepared_item_burger_teriyaki',
    'prepared_item_burger_chicken', 'prepared_item_burger_fish', 'prepared_item_burger_double',
    'prepared_item_sandwich_egg', 'prepared_item_sandwich_ham', 'prepared_item_sandwich_tuna',
    'prepared_item_sandwich_vegetable',
  ]) {
    assert.deepEqual(INGREDIENT_NUTRITION[id].nutritionPerUnit,
      Object.fromEntries(keys.map(key => [key, null])), id);
    assert.match(INGREDIENT_NUTRITION[id].nutritionSource, /商品表示を確認/);
    assert.doesNotMatch(INGREDIENT_NUTRITION[id].nutritionSource, /食品番号/);
  }
});

test('familiar cooked dishes use the actual raw cut or species and drained product weight', () => {
  // MEXT 2026-03-27 corrected table: kcal, protein, fat, carbs, fibre, salt per edible 100g.
  for (const [id, code, expected] of [
    ['flounder', '10100', [89, 19.6, 1.3, 0.1, 0, 0.3]],
    ['yellowtail', '10241', [222, 21.4, 17.6, 0.3, 0, 0.1]],
    ['beef_stew_cut', '11064', [221, 17.9, 17.4, 0.1, 0, 0.1]],
    ['pork_belly', '11129', [366, 14.4, 35.4, 0.1, 0, 0.1]],
    ['shirataki', '02005', [7, 0.2, null, 3, 2.9, 0]],
    ['parmesan_cheese', '13038', [445, 44, 30.8, 1.9, 0, 3.8]],
  ]) {
    for (const [index, key] of keys.entries()) {
      if (expected[index] === null) assert.equal(INGREDIENT_NUTRITION[id].nutritionPerUnit[key], null);
      else close(value(id, key, 100), expected[index]);
    }
    assert.match(INGREDIENT_NUTRITION[id].nutritionSource, new RegExp(`食品番号${code}`));
  }
  assert.deepEqual(INGREDIENT_NUTRITION.beef_stew_cut.nutritionPerUnit, INGREDIENT_NUTRITION.beef.nutritionPerUnit);
  assert.deepEqual(INGREDIENT_NUTRITION.yellowtail.nutritionPerUnit, INGREDIENT_NUTRITION.yellowtail_sashimi.nutritionPerUnit);
  assert.match(INGREDIENT_NUTRITION.flounder.nutritionSource, /骨付き切り身の総重量とは区別/);
  assert.match(INGREDIENT_NUTRITION.pork_belly.nutritionSource, /調理前の重量/);
  close(value('parmesan_cheese', 'salt', 5), 0.19);
});
