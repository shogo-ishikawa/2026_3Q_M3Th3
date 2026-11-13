import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {FOOD_COMPOSERS, buildFoodSelection, defaultFoodSelection, eligibleFoodSelection, foodComposerFor} from '../food-composer.js';
import {createCatalogEntry} from '../record-actions.js';
import {defaultJournal, parseJournal, validateJournal, JOURNAL_KEY} from '../journal.js';
import {NUTRIENT_KEYS, itemNutrition, recipeNutrition, summariseEntries} from '../nutrition.js';
import {shoppingForEntries} from '../shopping.js';
import {eligibleRecipes} from '../planner.js';
import {isCompleteMeal} from '../catalog.js';

const data = {allergens: ALLERGENS, ingredients: INGREDIENTS, recipes: RECIPES};
const date = '2026-11-13';
const near = (actual, expected, label = '') => assert.ok(
  typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - expected) < 1e-7,
  `${label}: expected ${expected}, received ${actual}`,
);
const definition = kind => {
  const found = FOOD_COMPOSERS.find(item => item.kind === kind);
  assert.ok(found, `missing composer ${kind}`);
  return found;
};
const optionForRecipe = (kind, recipeId) => {
  const option = definition(kind).components.find(item => item.recipeId === recipeId);
  assert.ok(option, `missing ${kind} choice for ${recipeId}`);
  return option.id;
};
const selection = (kind, components, suffix) => buildFoodSelection({
  id: `custom-meal38-${suffix}`, kind, components,
}, data);
const customData = recipe => ({...data, recipes: [...RECIPES, recipe]});
const record = (recipe, amount = 1, status = 'planned') => createCatalogEntry({
  recipeId: recipe.id, date, meal: 'dinner', status, amount, note: '組み合わせの検証',
}, customData(recipe));
const quantities = parts => Object.fromEntries(parts.map(part => [part.id, part.amount]));
const shopping = (entries, servings = 1) => shoppingForEntries(entries, data, {
  from: date, to: date, servings, pantry: [],
});
const mixSushi = () => selection('sushi', [
  {id: optionForRecipe('sushi', 'classic-sushi-tuna'), amount: 2},
  {id: optionForRecipe('sushi', 'sushi-hosomaki-kappa'), amount: 3},
  {id: optionForRecipe('sushi', 'sushi-gunkan-ikura'), amount: 1},
  {id: optionForRecipe('sushi', 'sushi-futomaki-seafood'), amount: 2},
], 'sushi');

// 既存の4レシピを別々に読み、1貫・1切れの分量から手で合算した期待値。
// エンジンが返す材料やレシピ栄養値から期待値を再生成しません。
const SUSHI_PARTS = Object.freeze({
  rice: 167.5, vinegar: 11.5, sugar: 4.875, salt: 0.4875, nori: 1.9,
  cucumber: 30, tuna_lean_sashimi: 35, salmon_sashimi: 10, ikura_salted: 10,
  soy_sauce: 1, shiso: 0.5,
});
const SUSHI_PER_100 = Object.freeze({
  rice: [156, 2.5, 0.3, 37.1, 1.5, 0],
  vinegar: [46, 0.2, 0, 7.4, 0, 0],
  sugar: [391, 0, 0, 99.3, 0, 0],
  salt: [0, 0, 0, 0, 0, 99.5],
  nori: [297, 41.4, 3.7, 44.3, 36, 1.3],
  cucumber: [13, 1, 0.1, 3, 1.1, 0],
  tuna_lean_sashimi: [115, 26.4, 1.4, 0.1, 0, 0.1],
  salmon_sashimi: [176, 20.5, 10.8, 0.2, 0, 0.1],
  ikura_salted: [252, 32.6, 15.6, 0.2, 0, 2.3],
  // しょうゆだけはml単位。100g値に密度1.181g/mlを乗じる。
  soy_sauce: [76, 7.7, 0, 7.9, 0.03, 14.5].map(value => value * 1.181),
  shiso: [32, 3.9, 0.1, 7.5, 7.3, 0],
});
const sushiExpected = Object.fromEntries(NUTRIENT_KEYS.map((key, column) => [key,
  Object.entries(SUSHI_PARTS).reduce((sum, [id, amount]) => sum + amount * SUSHI_PER_100[id][column] / 100, 0),
]));

test('握り・細巻・軍艦・太巻の混在を貫と切れで数え、選んだ材料だけを合算する', () => {
  const before = JSON.stringify(data), recipe = mixSushi();
  assert.equal(recipe.servings, 1);
  assert.deepEqual(recipe.portion, {amount: 1, unit: '皿'});
  assert.equal(isCompleteMeal(recipe), true);
  const parts = quantities(recipe.ingredients);
  assert.deepEqual(Object.keys(parts).sort(), Object.keys(SUSHI_PARTS).sort());
  for (const [id, amount] of Object.entries(SUSHI_PARTS)) near(parts[id], amount, id);
  for (const key of NUTRIENT_KEYS) near(recipeNutrition(recipe, data)[key], sushiExpected[key], key);
  assert.deepEqual([...recipe.allergens].sort(), ['salmon', 'salmon_roe', 'soy', 'wheat']);
  assert.ok(!recipe.ingredients.some(part => ['shrimp', 'egg', 'crab'].includes(part.id)));
  assert.equal(JSON.stringify(data), before, '食べる組み合わせで共通DBを書き換えない');
});

test('組合せ1皿を2皿で記録し、買い物の人数だけを別の倍率として扱う', () => {
  const recipe = mixSushi(), one = record(recipe), two = record(recipe, 2);
  for (const key of NUTRIENT_KEYS) {
    near(itemNutrition(one.items[0])[key], sushiExpected[key], key);
    near(itemNutrition(two.items[0])[key], sushiExpected[key] * 2, `2皿 ${key}`);
  }
  const result = shopping([two], 3);
  assert.deepEqual(result.missingMenus, []);
  for (const [id, amount] of Object.entries(SUSHI_PARTS)) near(
    result.items.find(item => item.id === id)?.required, amount * 2 * 3, id,
  );
  const nutrition = summariseEntries([{...two, status: 'eaten'}], {from: date, to: date});
  near(nutrition.values.kcal, sushiExpected.kcal * 2, '人数3を摂取栄養へ掛けない');
  assert.equal(summariseEntries([two], {from: date, to: date}).entryCount, 0, '予定は未摂取');
});

test('寿司の混在でも未選択のえび除外は通り、選んだいくら除外は通らない', () => {
  const recipe = mixSushi(), isolated = {...data, recipes: [recipe]};
  assert.equal(eligibleRecipes({allergens: ['shrimp']}, isolated).length, 1);
  assert.deepEqual(eligibleRecipes({allergens: ['salmon_roe']}, isolated), []);
  assert.deepEqual(eligibleRecipes({excludedIngredients: ['soybeans']}, isolated), [], 'しょうゆの原料まで引き継ぐ');
});

test('卵を避けたおでん等の安全な初期値を作り、全候補が乳のチーズは入口を返さない', () => {
  const allowed = eligibleFoodSelection('oden', {allergens: ['egg']}, data, {recipeId: 'palette-oden'});
  assert.ok(allowed);
  assert.ok(!allowed.recipe.allergens.includes('egg'));
  assert.ok(!allowed.recipe.ingredients.some(part => ['egg', 'palette_chikuwa', 'palette_hanpen', 'palette_ganmodoki'].includes(part.id)));
  const entry = record(allowed.recipe), state = defaultJournal(date);
  state.customRecipes = [allowed.recipe]; state.entries = [entry];
  const loaded = parseJournal(JSON.stringify(state), data);
  assert.ok(!loaded.entries[0].items[0].allergens.includes('egg'));
  assert.equal(eligibleFoodSelection('cheese', {allergens: ['milk']}, data), null);
  const skewers = eligibleFoodSelection('yakitori', {allergens: ['wheat', 'egg', 'milk', 'soy']}, data);
  assert.ok(skewers);
  assert.ok(!skewers.config.components.some(part => part.id.startsWith('takeaway-')));
  assert.ok(!skewers.recipe.allergens.some(id => ['wheat', 'egg', 'milk', 'soy'].includes(id)));
});

test('全種類のデフォルト組合せがカレンダー・マイメニュー・買い物のv3往復に対応する', () => {
  assert.ok(FOOD_COMPOSERS.length >= 10);
  const before = JSON.stringify(data);
  const state = defaultJournal(date);
  for (const item of FOOD_COMPOSERS) {
    const config = {...defaultFoodSelection(item.kind), id: `custom-meal38-default-${item.kind}`};
    const recipe = buildFoodSelection(config, data);
    assert.equal(recipe.custom, true, item.kind);
    assert.ok(recipe.ingredients.length > 0, item.kind);
    assert.ok(recipe.name.length <= 200 && recipe.sourceNote.length <= 2000, item.kind);
    state.customRecipes.push(recipe);
    state.entries.push(record(recipe, 0.5));
  }
  assert.doesNotThrow(() => validateJournal(state, data));
  const loaded = parseJournal(JSON.stringify(state), data);
  assert.equal(JOURNAL_KEY, 'kondate-note-v3');
  assert.equal(loaded.version, 3);
  assert.deepEqual(loaded.entries, state.entries, '選択内容・量・栄養・日付を保持');
  for (const entry of loaded.entries) {
    assert.equal(entry.date, date);
    const result = shopping([entry], 2), item = entry.items[0];
    if (item.ingredientsKnown || item.shoppingKnown) {
      for (const part of item.ingredients) near(
        result.items.find(row => row.id === part.id)?.required, part.amount, `${item.name}/${part.id}`,
      ); // 半皿×2人＝選択した一皿分
    } else assert.equal(result.missingMenus.length, 1);
  }
  assert.equal(JSON.stringify(data), before);
});

test('多数の寿司を選んでも保存文字数の上限を超えず、全材料を保持する', () => {
  const options = definition('sushi').components.filter(item => item.recipeId);
  assert.ok(options.length >= 20, '握りの追加と軍艦・巻物の選択肢');
  const recipe = selection('sushi', options.map(item => ({id: item.id, amount: 1})), 'sushi-many');
  const state = defaultJournal(date); state.customRecipes = [recipe]; state.entries = [record(recipe)];
  const loaded = parseJournal(JSON.stringify(state), data);
  assert.deepEqual(loaded.entries, state.entries);
  assert.ok(loaded.customRecipes[0].name.length <= 200);
  assert.ok(loaded.customRecipes[0].sourceNote.length <= 2000);
  assert.deepEqual(loaded.customRecipes[0].ingredients, recipe.ingredients);
});

test('既存の食事とマイメニュー削除後の組合せは新しいDBから再計算しない', () => {
  const recipe = mixSushi(), state = defaultJournal(date), historical = record(recipe, 1, 'eaten');
  historical.items[0].recipeId = null;
  historical.items[0].name = '過去に記録した寿司';
  historical.items[0].nutrition = {kcal: 432, protein: 12, fat: null, carbs: 75, fiber: null, salt: 2};
  historical.items[0].ingredients = [{id: 'rice', amount: 180}, {id: 'tuna_lean_sashimi', amount: 100}];
  historical.items[0].portion = {amount: 8, unit: '貫'};
  state.entries = [historical];
  const loaded = parseJournal(JSON.stringify(state), data);
  assert.deepEqual(loaded.entries, state.entries);
  assert.deepEqual(loaded.customRecipes, []);
  assert.equal(loaded.entries[0].items[0].nutrition.fat, null);
  const sourceChanged = {...data, ingredients: {...INGREDIENTS, rice: {...INGREDIENTS.rice,
    nutritionPerUnit: {...INGREDIENTS.rice.nutritionPerUnit, kcal: 999}}}};
  assert.deepEqual(parseJournal(JSON.stringify(state), sourceChanged).entries, state.entries);
  assert.equal(foodComposerFor('nonexistent-recipe'), null);
});

test('おでんは具の標準重量と飲む汁だけを加え、汁を選ばなければ調味料を加えない', () => {
  const food = [{id: 'daikon', amount: 2}, {id: 'egg', amount: 1}, {id: 'konjac', amount: 1}];
  const plain = selection('oden', food, 'oden-plain');
  assert.deepEqual(quantities(plain.ingredients), {daikon: 120, egg: 1, konjac: 50});
  const broth = selection('oden', [...food, {id: 'broth', amount: 100}], 'oden-broth');
  const parts = quantities(broth.ingredients);
  near(parts.daikon, 120); near(parts.egg, 1); near(parts.konjac, 50);
  near(parts.soy_sauce, 4); near(parts.mirin, 2); near(parts.bonito, 0.3);
  assert.ok(!Object.keys(parts).some(id => ['palette_chikuwa', 'palette_hanpen', 'beef_tendon_boiled'].includes(id)));
  const before = recipeNutrition(plain, data), after = recipeNutrition(broth, data);
  // 水は0kcal。醤油4ml + みりん2ml + かつお節0.3gの独立合計。
  near(after.kcal - before.kcal, 4 * 76 * 1.181 / 100 + 2 * 241 * 1.17 / 100 + 0.3 * 332 / 100, '汁のkcal');
  near(after.salt - before.salt, 4 * 14.5 * 1.181 / 100 + 0.3 * 0.3 / 100, '汁の食塩');
  assert.ok(!plain.allergens.includes('soy'));
  assert.ok(broth.allergens.includes('soy') && broth.allergens.includes('wheat'));
  assert.throws(() => selection('oden', [{id: 'broth', amount: 100}], 'oden-only-broth'), /汁|具材|種類/);
  const result = shopping([record(broth, 0.5)], 2);
  near(result.items.find(item => item.id === 'daikon')?.required, 120);
  near(result.items.find(item => item.id === 'soy_sauce')?.required, 4);
});

test('購入した塩・たれ焼き鳥は公式の1本値を量倍し、原材料未確認を引き継ぐ', () => {
  const recipe = selection('yakitori', [
    {id: 'takeaway-momo-tare', amount: 2}, {id: 'takeaway-momo-salt', amount: 1},
  ], 'yakitori-bought');
  const expected = {kcal: 272, protein: 20.5, fat: 17.1, carbs: 6.2, fiber: null, salt: 1.5};
  for (const key of NUTRIENT_KEYS) expected[key] === null
    ? assert.equal(recipeNutrition(recipe, data)[key], null, key)
    : near(recipeNutrition(recipe, data)[key], expected[key], key);
  assert.equal(recipe.allergensKnown, false);
  assert.equal(recipe.ingredientsKnown, false);
  assert.equal(recipe.shoppingKnown, true);
  assert.deepEqual(eligibleRecipes({}, {...data, recipes: [recipe]}), []);
  assert.deepEqual(quantities(recipe.ingredients), {
    takeaway_yakitori_momo_tare: 2, takeaway_yakitori_momo_salt: 1,
  });
  const entry = record(recipe, 2), result = shopping([entry], 3);
  near(result.items.find(item => item.id === 'takeaway_yakitori_momo_tare')?.required, 12);
  near(result.items.find(item => item.id === 'takeaway_yakitori_momo_salt')?.required, 6);
  assert.equal(result.missingMenus.length, 1);
  assert.ok(!result.items.some(item => ['chicken', 'oil', 'soy_sauce'].includes(item.id)), '完成品へ原料と油を重ねない');
  const state = defaultJournal(date); state.customRecipes = [recipe]; state.entries = [entry];
  const loaded = parseJournal(JSON.stringify(state), data);
  assert.equal(loaded.customRecipes[0].allergensKnown, false);
  assert.equal(loaded.entries[0].items[0].nutrition.fiber, null);
});

test('手作り天ぷらの個数と天つゆ、完成品天ぷらの吸収油を区別する', () => {
  const foods = [{id: 'shrimp', amount: 2}, {id: 'pumpkin', amount: 1}];
  const plain = selection('tempura', foods, 'tempura-plain'), parts = quantities(plain.ingredients);
  for (const [id, expected] of Object.entries({shrimp: 40, pumpkin: 25, flour: 15, egg: 0.15, water: 24, oil: 9, salt: 0.09})) near(parts[id], expected, id);
  near(recipeNutrition(plain, data).fat, 9.522, '材料と吸収油の脂質');
  assert.ok(!plain.ingredients.some(part => ['soy_sauce', 'mirin', 'daikon'].includes(part.id)));
  const dipped = selection('tempura', [...foods, {id: 'dipping-sauce', amount: 30}], 'tempura-dipped');
  const dippedParts = quantities(dipped.ingredients);
  near(dippedParts.soy_sauce, 3); near(dippedParts.mirin, 1.5);
  near(dippedParts.oil, 9, 'つゆを足しても吸収油は同じ');
  assert.ok(dipped.allergens.includes('soy'));
  const bought = selection('tempura', [
    {id: 'takeaway-shrimp', amount: 2}, {id: 'takeaway-squid', amount: 1},
  ], 'tempura-bought');
  near(recipeNutrition(bought, data).kcal, 166);
  near(recipeNutrition(bought, data).fat, 7.2);
  assert.equal(recipeNutrition(bought, data).fiber, null);
  assert.deepEqual(quantities(bought.ingredients), {takeaway_tempura_shrimp: 2, takeaway_tempura_squid: 1});
  assert.ok(!bought.ingredients.some(part => ['oil', 'flour', 'egg'].includes(part.id)));
});

test('ベーグル・ワッフル・マフィンの選んだ具材だけを独立した栄養値へ加算する', () => {
  const cases = [
    ['bagel', [{id: 'base', amount: 1}, {id: 'cream-cheese', amount: 15}, {id: 'prosciutto', amount: 20}, {id: 'lettuce', amount: 10}],
      {kcal: 366.65, protein: 15.69, fat: 10.28, carbs: 55.325, fiber: 2.61, salt: 2.465},
      {palette_bagel: 100, palette_cream_cheese: 15, palette_prosciutto: 20, lettuce: 10}],
    ['waffle', [{id: 'base', amount: 1}, {id: 'maple', amount: 10}, {id: 'strawberry', amount: 30}],
      {kcal: 273.7575, protein: 5.49796, fat: 9.4769, carbs: 43.365, fiber: 1.17, salt: 0.35885},
      {palette_waffle: 70, palette_maple_syrup: 10, strawberry: 30}],
    ['muffin', [{id: 'base', amount: 1}, {id: 'blueberry', amount: 20}, {id: 'walnut', amount: 8}],
      {kcal: 280.483, protein: 5.39821, fat: 13.3969, carbs: 36.0709, fiber: 1.8725, salt: 0.3206},
      {flour: 24.5, egg: 0.28, milk: 10.5 / 1.03, butter: 7, sugar: 13.3, palette_baking_powder: 0.7, blueberry: 20, walnut: 8}],
  ];
  // ワッフルは薄力粉30g・卵15g・牛乳25.75g・バター8g・砂糖10g・BP0.7g。
  // マフィン70gは薄力粉24.5g・卵14g・牛乳10.5g・バター7g・砂糖13.3g・BP0.7g。
  // それぞれの原料100g値から別に手計算した期待値。中間の1g丸めのみ許容します。
  for (const [kind, components, nutrition, materials] of cases) {
    const recipe = selection(kind, components, `topping-${kind}`);
    assert.deepEqual(quantities(recipe.ingredients), materials, kind);
    for (const key of NUTRIENT_KEYS) assert.ok(Math.abs(recipeNutrition(recipe, data)[key] - nutrition[key]) < 2e-6, `${kind}/${key}`);
    const result = shopping([record(recipe, 2)], 1);
    for (const [id, amount] of Object.entries(materials)) near(result.items.find(item => item.id === id)?.required, amount * 2, `${kind}/${id}`);
  }
});
