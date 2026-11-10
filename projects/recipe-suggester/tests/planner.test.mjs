import test from 'node:test';
import assert from 'node:assert/strict';
import {GENRES, activeRecipeIds, allocateGenreCounts, analyseHistory, describeRecipe, eligibleRecipes, generatePlan, replaceRecipe, shoppingList, toggleDish} from '../planner.js';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';

const makeRecipe = (id, role, ingredientIds, extra = {}) => ({
  id, name: id, role, genre: '和食', minutes: 15, servings: 2,
  ingredients: ingredientIds.map(id => ({id, amount: 100})),
  steps: ['材料を用意して加熱します。'], tags: [], staple: false, ...extra,
});
const ingredient = (name, allergens = [], groups = [], proteinSources = []) => ({name, unit: 'g', allergens, groups, proteinSources});
const DATA = {
  allergens: ['egg', 'milk', 'wheat', 'soy', 'fish'].map(id => ({id, label: id})),
  ingredients: {
    rice: ingredient('米', [], ['staple']),
    chicken: ingredient('鶏肉', [], ['protein'], ['meat']),
    fish: ingredient('魚', ['fish'], ['protein'], ['fish']),
    tofu: ingredient('豆腐', ['soy'], ['protein'], ['soy']),
    egg: ingredient('卵', ['egg'], ['protein'], ['egg']),
    milk: ingredient('牛乳', ['milk'], ['dairy']),
    broccoli: ingredient('ブロッコリー', [], ['vegetable']),
    carrot: ingredient('にんじん', [], ['vegetable']),
    soy_sauce: ingredient('しょうゆ', ['wheat', 'soy']),
    water: {...ingredient('水'), unit: 'ml'},
    unknown_stock: {name: '表示未確認のスープの素', unit: 'g', groups: []},
  },
  recipes: [
    makeRecipe('chicken-main', 'main', ['chicken']),
    makeRecipe('fish-main', 'main', ['fish']),
    makeRecipe('tofu-main', 'main', ['tofu']),
    makeRecipe('egg-rice', 'main', ['egg', 'rice'], {staple: true}),
    makeRecipe('chicken-soy', 'main', ['chicken', 'soy_sauce']),
    makeRecipe('broccoli-side', 'side', ['broccoli']),
    makeRecipe('carrot-side', 'side', ['carrot']),
    makeRecipe('tofu-side', 'side', ['tofu', 'carrot']),
    makeRecipe('carrot-soup', 'soup', ['carrot', 'water']),
    makeRecipe('broccoli-soup', 'soup', ['broccoli', 'water']),
    makeRecipe('milk-soup', 'soup', ['broccoli', 'milk']),
    makeRecipe('plain-rice', 'staple', ['rice'], {staple: true}),
  ],
};
const settings = extra => ({startDate: '2026-11-10', days: 3, servings: 2, meal: 'dinner', seed: 1, ...extra});

test('ingredients and compound seasonings determine allergen information', () => {
  assert.deepEqual(new Set(describeRecipe('chicken-soy', DATA).allergens), new Set(['wheat', 'soy']));
  assert.deepEqual(describeRecipe('chicken-soy', DATA).groups, ['protein']);
  assert.deepEqual(describeRecipe('chicken-soy', DATA).proteinSources, ['meat']);
  assert.ok(!eligibleRecipes({allergens: ['wheat']}, DATA).some(recipe => recipe.id === 'chicken-soy'));
});

test('unknown allergen composition, unknown ingredient and incomplete steps fail closed', () => {
  const data = {...DATA, recipes: [...DATA.recipes,
    makeRecipe('unknown-compound', 'main', ['chicken', 'unknown_stock']),
    makeRecipe('unknown-id', 'main', ['not-listed']),
    makeRecipe('no-steps', 'main', ['chicken'], {steps: []}),
  ]};
  const safe = eligibleRecipes({}, data);
  assert.ok(!safe.some(recipe => ['unknown-compound', 'unknown-id', 'no-steps'].includes(recipe.id)));
  assert.throws(() => describeRecipe('unknown-compound', data), /確認情報/);
  assert.match(generatePlan(settings(), data).warnings.join(''), /3品/);
});

test('a duplicate recipe ID cannot hide a second version with different ingredients', () => {
  const data = {...DATA, recipes: [...DATA.recipes, makeRecipe('chicken-main', 'main', ['egg'])]};
  assert.ok(!eligibleRecipes({}, data).some(recipe => recipe.id === 'chicken-main'));
  assert.throws(() => describeRecipe('chicken-main', data), /重複/);
});

test('no candidate ever restores allergy-excluded recipes to fill a menu', () => {
  const data = {...DATA, recipes: DATA.recipes.filter(recipe => recipe.role !== 'main' || recipe.id === 'egg-rice')};
  const plan = generatePlan(settings({allergens: ['egg']}), data);
  assert.equal(plan.ok, false);
  assert.deepEqual(plan.days, []);
  assert.ok(plan.missingRoles.includes('main'));
  assert.match(plan.warnings.join(''), /条件外の料理で埋めていません/);
});

test('every selected allergen stays excluded through generation and replacement', () => {
  const ids = DATA.allergens.map(item => item.id);
  for (let mask = 0; mask < 1 << ids.length; mask++) {
    const allergens = ids.filter((_, i) => mask & (1 << i));
    for (const seed of [1, 2, 3]) {
      const plan = generatePlan(settings({allergens, seed, days: 7,
        preferences: {preferredIngredients: ['egg', 'tofu']}}), DATA);
      assert.equal(plan.ok, true);
      const swapped = replaceRecipe(plan, {dayIndex: 0, recipeId: plan.days[0].recipeIds[0], allergens, seed: seed + 10}, DATA);
      assert.equal(swapped.ok, true);
      for (const menu of [plan, swapped]) for (const day of menu.days) for (const recipeId of day.recipeIds) {
        assert.ok(!describeRecipe(recipeId, DATA).allergens.some(id => allergens.includes(id)), `${recipeId}: ${allergens}`);
      }
    }
  }
});

test('custom exclusions use explicit ingredient IDs or complete ingredient names', () => {
  assert.ok(!eligibleRecipes({excludedIngredients: ['鶏肉']}, DATA).some(recipe => recipe.ingredients.some(part => part.id === 'chicken')));
  assert.ok(!eligibleRecipes({excludedIngredients: ['soy_sauce']}, DATA).some(recipe => recipe.id === 'chicken-soy'));
  assert.throws(() => eligibleRecipes({excludedIngredients: ['unknown']}, DATA), /材料一覧/);
  assert.throws(() => generatePlan(settings({allergens: ['unknown']}), DATA), /登録されていないアレルゲン/);
});

const DERIVED_DATA = {...DATA,
  ingredients: {...DATA.ingredients,
    tomato: ingredient('トマト', [], ['vegetable']),
    canned_tomato: {...ingredient('トマト水煮', [], ['vegetable']), derivedFrom: ['tomato']},
    tomato_paste: {...ingredient('トマトペースト', [], ['vegetable']), derivedFrom: ['canned_tomato']},
  },
  recipes: [...DATA.recipes,
    makeRecipe('raw-tomato-main', 'main', ['chicken', 'tomato']),
    makeRecipe('canned-tomato-main', 'main', ['chicken', 'canned_tomato']),
    makeRecipe('tomato-paste-main', 'main', ['chicken', 'tomato_paste']),
  ],
};

test('canonical ingredient exclusions include all derived ancestors in a directed graph', () => {
  const profile = describeRecipe('tomato-paste-main', DERIVED_DATA);
  assert.deepEqual(profile.ingredients.find(item => item.id === 'tomato_paste').ancestorIds, ['canned_tomato', 'tomato']);
  const withoutTomato = eligibleRecipes({excludedIngredients: ['tomato']}, DERIVED_DATA);
  assert.ok(!withoutTomato.some(recipe => recipe.id.includes('tomato')));
  const withoutCanned = eligibleRecipes({excludedIngredients: ['canned_tomato']}, DERIVED_DATA);
  assert.ok(withoutCanned.some(recipe => recipe.id === 'raw-tomato-main'));
  assert.ok(!withoutCanned.some(recipe => ['canned-tomato-main', 'tomato-paste-main'].includes(recipe.id)));
  const withoutPaste = eligibleRecipes({excludedIngredients: ['tomato_paste']}, DERIVED_DATA);
  assert.ok(withoutPaste.some(recipe => recipe.id === 'raw-tomato-main'));
  assert.ok(withoutPaste.some(recipe => recipe.id === 'canned-tomato-main'));
});

test('unknown, cyclic or non-array derived ingredient metadata fails closed', () => {
  for (const derivedFrom of [['missing-parent'], ['tomato_paste'], 'tomato', null]) {
    const ingredients = {...DERIVED_DATA.ingredients,
      tomato_paste: {...DERIVED_DATA.ingredients.tomato_paste, derivedFrom},
    };
    const data = {...DERIVED_DATA, ingredients};
    assert.ok(!eligibleRecipes({}, data).some(recipe => recipe.id === 'tomato-paste-main'));
    assert.throws(() => describeRecipe('tomato-paste-main', data), /派生元/);
  }
  const data = {...DERIVED_DATA, ingredients: {...DERIVED_DATA.ingredients,
    tomato: {...DERIVED_DATA.ingredients.tomato, derivedFrom: ['tomato_paste']},
  }};
  assert.ok(!eligibleRecipes({}, data).some(recipe => recipe.id.includes('tomato')));
});

test('derived exclusions remain hard constraints in generation, swaps and saved shopping lists', () => {
  const options = settings({excludedIngredients: ['tomato'], days: 7,
    preferences: {preferredIngredients: ['tomato', 'canned_tomato', 'tomato_paste']}});
  const plan = generatePlan(options, DERIVED_DATA);
  assert.equal(plan.ok, true);
  const swapped = replaceRecipe(plan, {dayIndex: 0, recipeId: plan.days[0].recipeIds[0], excludedIngredients: ['tomato']}, DERIVED_DATA);
  for (const candidate of [plan, swapped]) {
    for (const day of candidate.days) for (const id of day.recipeIds) {
      assert.ok(!describeRecipe(id, DERIVED_DATA).ingredients.some(item => [item.id, ...item.ancestorIds].includes('tomato')));
    }
  }
  const saved = {...plan, days: [{...plan.days[0], recipeIds: ['tomato-paste-main']}]};
  assert.throws(() => shoppingList(saved, 2, DERIVED_DATA), /除外条件に合わない/);
});

test('ancestor allergen omissions are resolved once for display, eligibility, swaps and shopping lists', () => {
  const ingredients = {...DATA.ingredients,
    egg_extract: {...ingredient('卵由来の加工材料'), derivedFrom: ['egg']},
    egg_processed: {...ingredient('さらに加工した材料'), derivedFrom: ['egg_extract']},
  };
  const childRecipe = makeRecipe('processed-egg-main', 'main', ['egg_processed']);
  const data = {...DATA, ingredients, recipes: [...DATA.recipes, childRecipe]};
  const profile = describeRecipe(childRecipe.id, data);
  assert.deepEqual(profile.allergens, ['egg']);
  assert.deepEqual(profile.ingredients[0].allergens, ['egg']);
  assert.deepEqual(profile.groups, []);
  assert.deepEqual(profile.proteinSources, []);
  assert.ok(!eligibleRecipes({allergens: ['egg']}, data).some(recipe => recipe.id === childRecipe.id));
  const plan = generatePlan(settings({allergens: ['egg'], days: 1}), data);
  const swapped = replaceRecipe(plan, {dayIndex: 0, recipeId: plan.days[0].recipeIds[0], allergens: ['egg']}, data);
  assert.ok(!swapped.days[0].recipeIds.includes(childRecipe.id));
  const stalePlan = {...plan, days: [{...plan.days[0], recipeIds: [childRecipe.id]}]};
  assert.throws(() => shoppingList(stalePlan, 2, data), /除外条件に合わない/);
  const brokenParent = {...data, ingredients: {...ingredients,
    egg: {...ingredients.egg, allergens: ['unknown-allergen']},
  }};
  assert.ok(!eligibleRecipes({}, brokenParent).some(recipe => recipe.id === childRecipe.id));
});

test('infeasible side or soup means failure, not a successful partial meal', () => {
  for (const role of ['side', 'soup']) {
    const data = {...DATA, recipes: DATA.recipes.filter(recipe => recipe.role !== role)};
    const plan = generatePlan(settings(), data);
    assert.equal(plan.ok, false);
    assert.deepEqual(plan.days, []);
    assert.ok(plan.missingRoles.includes(role));
  }
});

test('a starchy main receives no second starch, and other mains get a rice recipe', () => {
  for (const mainId of ['egg-rice', 'chicken-main']) {
    const data = {...DATA, recipes: DATA.recipes.filter(recipe => recipe.role !== 'main' || recipe.id === mainId)};
    const plan = generatePlan(settings({days: 1}), data);
    assert.equal(plan.ok, true);
    assert.equal(plan.days[0].recipeIds.includes('plain-rice'), mainId !== 'egg-rice');
  }
});

test('a starchy main can form a meal without separate rice, other mains cannot', () => {
  let data = {...DATA, recipes: DATA.recipes.filter(recipe => recipe.role !== 'staple')};
  let plan = generatePlan(settings(), data);
  assert.equal(plan.ok, true);
  assert.ok(plan.days.every(day => day.recipeIds.includes('egg-rice')));
  data = {...data, recipes: data.recipes.filter(recipe => recipe.id !== 'egg-rice')};
  plan = generatePlan(settings(), data);
  assert.equal(plan.ok, false);
  assert.ok(plan.missingRoles.includes('staple'));
});

test('same settings and seed repeat exactly without mutating history or data', () => {
  const history = [{date: '2026-11-09', meal: 'dinner', recipeIds: ['chicken-main']}];
  const before = JSON.stringify({DATA, history});
  assert.deepEqual(generatePlan(settings({history}), DATA), generatePlan(settings({history}), DATA));
  assert.equal(JSON.stringify({DATA, history}), before);
});

test('recent known dishes favour an alternative main protein', () => {
  const data = {...DATA, recipes: DATA.recipes.filter(recipe => recipe.role !== 'main' || ['chicken-main', 'fish-main'].includes(recipe.id))};
  const history = [{date: '2026-11-09', meal: 'dinner', recipeIds: ['chicken-main']}];
  const plan = generatePlan(settings({days: 1, history}), data);
  assert.equal(plan.days[0].recipeIds[0], 'fish-main');
  assert.match(plan.days[0].reasons.join(''), /魚/);
});

test('explicit food-group history changes ranking without claiming nutrient quantities', () => {
  const ingredients = {...DATA.ingredients,
    apple: ingredient('りんご', [], ['fruit']),
    orange: ingredient('みかん', [], ['fruit']),
  };
  const data = {...DATA, ingredients, recipes: [
    ...DATA.recipes.filter(recipe => ['main', 'soup', 'staple'].includes(recipe.role)),
    makeRecipe('vegetable-fruit-side', 'side', ['carrot', 'apple']),
    makeRecipe('vegetable-dairy-side', 'side', ['carrot', 'milk']),
  ]};
  const fruitHistory = [{date: '2026-11-09', meal: 'dinner', groups: ['vegetable', 'protein', 'fruit']}];
  const dairyHistory = [{date: '2026-11-09', meal: 'dinner', groups: ['vegetable', 'protein', 'dairy']}];
  const fruitPlan = generatePlan(settings({days: 1, history: fruitHistory}), data);
  const dairyPlan = generatePlan(settings({days: 1, history: dairyHistory}), data);
  assert.ok(fruitPlan.days[0].recipeIds.includes('vegetable-dairy-side'));
  assert.ok(dairyPlan.days[0].recipeIds.includes('vegetable-fruit-side'));
});

test('the rolling date window sees earlier planned days and avoids immediate repeats', () => {
  const plan = generatePlan(settings({days: 3}), DATA);
  assert.equal(new Set(plan.days.map(day => day.recipeIds[0])).size, 3);
  assert.deepEqual(plan.days.map(day => day.date), ['2026-11-10', '2026-11-11', '2026-11-12']);
  assert.match(plan.days[0].reasons.join(''), /履歴がない/);
  assert.match(plan.days[1].reasons.join(''), /先に提案した献立/);
  assert.doesNotMatch(plan.days[1].reasons.join(''), /食事記録|食事の記録|履歴で/);
});

test('history combines duplicate entries in one meal and counts meal presence, not quantities', () => {
  const history = [
    {date: '2026-11-09', meal: 'dinner', recipeIds: ['chicken-main'], groups: ['vegetable']},
    {date: '2026-11-09', meal: 'dinner', recipeIds: ['chicken-main'], groups: ['vegetable'], proteinSources: ['fish']},
  ];
  const report = analyseHistory(history, {beforeDate: '2026-11-10'}, DATA);
  assert.equal(report.entryCount, 2);
  assert.equal(report.mealCount, 1);
  assert.equal(report.groups.vegetable, 1);
  assert.equal(report.groups.protein, 1);
  assert.equal(report.proteinSources.meat, 1);
  assert.equal(report.recipeCounts['chicken-main'], 1);
});

test('the last seven days and same-day earlier meals count, future meals do not', () => {
  const history = [
    {date: '2026-11-02', meal: 'dinner', groups: ['fruit']},
    {date: '2026-11-03', meal: 'dinner', groups: ['vegetable']},
    {date: '2026-11-10', meal: 'breakfast', groups: ['dairy']},
    {date: '2026-11-10', meal: 'lunch', groups: ['protein']},
    {date: '2026-11-10', meal: 'dinner', groups: ['fruit']},
    {date: '2026-11-11', meal: 'breakfast', groups: ['fruit']},
  ];
  const report = analyseHistory(history, {beforeDate: '2026-11-10', beforeMeal: 'dinner'}, DATA);
  assert.equal(report.mealCount, 3);
  assert.equal(report.groups.fruit, 0);
  assert.equal(report.groups.vegetable, 1);
  assert.equal(report.groups.dairy, 1);
});

test('free-text history does not invent ingredients, nutrients or food groups', () => {
  const history = [{date: '2026-11-09', meal: 'dinner', note: '卵と肉と果物を大量に食べた'}];
  const report = analyseHistory(history, {beforeDate: '2026-11-10'}, DATA);
  assert.equal(report.hasHistory, true);
  assert.equal(report.hasTaggedData, false);
  assert.ok(Object.values(report.groups).every(count => count === 0));
  const plan = generatePlan(settings({days: 1, history}), DATA);
  assert.match(plan.days[0].reasons.join(''), /比較できる.*履歴がない/);
});

test('invalid historical records are ignored without treating them as nutritional facts', () => {
  const report = analyseHistory([null, {date: 'bad', meal: 'dinner'}, {date: '2026-11-09', meal: 'dinner', groups: ['invented'], note: 'fish'}],
    {beforeDate: '2026-11-10'}, DATA);
  assert.equal(report.ignoredCount, 2);
  assert.equal(report.hasTaggedData, false);
});

test('swapping a main adds or removes rice atomically and leaves input untouched', () => {
  const data = {...DATA, recipes: DATA.recipes.filter(recipe => recipe.role !== 'main' || ['chicken-main', 'egg-rice'].includes(recipe.id))};
  const plan = generatePlan(settings({days: 1}), data);
  const old = JSON.stringify(plan);
  const next = replaceRecipe(plan, {dayIndex: 0, recipeId: plan.days[0].recipeIds[0]}, data);
  const main = describeRecipe(next.days[0].recipeIds[0], data);
  assert.equal(next.days[0].recipeIds.includes('plain-rice'), !main.staple);
  assert.notEqual(next.days[0].recipeIds[0], plan.days[0].recipeIds[0]);
  assert.equal(JSON.stringify(plan), old);
});

test('new allergy settings invalidate an old unsafe plan rather than leaving its other dishes', () => {
  const data = {...DATA, recipes: DATA.recipes.filter(recipe => recipe.role !== 'main' || recipe.id === 'egg-rice')};
  const plan = generatePlan(settings({days: 1}), data);
  const next = replaceRecipe(plan, {dayIndex: 0, recipeId: plan.days[0].recipeIds[1], allergens: ['egg']}, data);
  assert.equal(next.ok, false);
  assert.deepEqual(next.days, []);
  assert.match(next.warnings.join(''), /献立全体を作り直して/);
});

test('no allowed replacement keeps the allowed current recipe with an explicit message', () => {
  const data = {...DATA, recipes: DATA.recipes.filter(recipe => recipe.role !== 'main' || recipe.id === 'chicken-main')};
  const plan = generatePlan(settings({days: 1}), data);
  const next = replaceRecipe(plan, {dayIndex: 0, recipeId: 'chicken-main', allergens: ['egg']}, data);
  assert.equal(next.ok, true);
  assert.deepEqual(next.days[0].recipeIds, plan.days[0].recipeIds);
  assert.match(next.warnings.join(''), /別の料理がない/);
});

test('preferences cannot override exclusions, and unmet time or genre is disclosed', () => {
  const plan = generatePlan(settings({days: 1, allergens: ['egg', 'soy'],
    preferences: {genre: 'エスニック', maxMinutes: 1, preferredIngredients: ['egg', 'tofu']}}), DATA);
  assert.equal(plan.ok, true);
  assert.ok(!plan.days[0].recipeIds.includes('egg-rice'));
  assert.match(plan.days[0].warnings.join(''), /希望ジャンル以外/);
  assert.match(plan.days[0].warnings.join(''), /所要時間を超える/);
});

test('shopping amounts scale by portions and combine the same ingredient only in its own unit', () => {
  const data = {...DATA, recipes: DATA.recipes.filter(recipe => recipe.role !== 'main' || recipe.id === 'chicken-main')};
  const plan = generatePlan(settings({days: 1}), data);
  const small = shoppingList(plan, 2, data);
  const large = shoppingList(plan, 4, data);
  for (const item of small) {
    const other = large.find(candidate => candidate.id === item.id && candidate.unit === item.unit);
    assert.equal(other.amount, item.amount * 2);
  }
  assert.equal(small.find(item => item.id === 'water').unit, 'ml');
});

test('shopping lists recheck metadata and exclusion rules instead of trusting saved IDs', () => {
  const plan = generatePlan(settings({days: 1}), DATA);
  const broken = {...plan, days: [{...plan.days[0], recipeIds: ['missing']}]};
  assert.throws(() => shoppingList(broken, 2, DATA), /料理が見つからない/);
  const unsafe = {...plan, settings: {...plan.settings, allergens: ['egg']}, days: [{...plan.days[0], recipeIds: ['egg-rice']}]};
  assert.throws(() => shoppingList(unsafe, 2, DATA), /除外条件に合わない/);
});

test('dates, servings and days are checked rather than coerced or silently truncated', () => {
  for (const invalid of [{startDate: '2026-02-30'}, {days: 0}, {days: 8}, {days: 2.5}, {servings: 0}, {servings: 9}, {servings: '2'},
    {meal: 'snack'}, {history: {}}, {seed: NaN}, {preferences: {maxMinutes: 0}}]) {
    assert.throws(() => generatePlan(settings(invalid), DATA));
  }
  const leap = generatePlan(settings({startDate: '2028-02-28', days: 3}), DATA);
  assert.deepEqual(leap.days.map(day => day.date), ['2028-02-28', '2028-02-29', '2028-03-01']);
});

test('the distributed catalogue keeps selected allergens excluded through seven-day plans, swaps and shopping lists', () => {
  const data = {allergens: ALLERGENS, ingredients: INGREDIENTS, recipes: RECIPES};
  const scenarios = [[], ...ALLERGENS.map(item => [item.id]), ALLERGENS.map(item => item.id), ['egg', 'milk', 'wheat', 'soy']];
  for (const allergens of scenarios) {
    const plan = generatePlan(settings({allergens, days: 7, servings: 4, seed: 192,
      history: [{date: '2026-11-09', meal: 'dinner', groups: ['staple', 'protein'], proteinSources: ['meat']}]}), data);
    if (!plan.ok) {
      assert.deepEqual(plan.days, []);
      continue;
    }
    assert.equal(plan.days.length, 7);
    const variants = [plan, ...plan.days[0].recipeIds.map(recipeId => replaceRecipe(plan, {dayIndex: 0, recipeId, allergens, seed: 193}, data))];
    for (const variant of variants) {
      assert.equal(variant.ok, true);
      for (const day of variant.days) for (const id of day.recipeIds) {
        assert.ok(!describeRecipe(id, data).allergens.some(id => allergens.includes(id)));
      }
      for (const item of shoppingList(variant, 4, data)) assert.ok(!item.allergens.some(id => allergens.includes(id)));
    }
  }
});

test('excluding tomato from the distributed catalogue also removes its registered processed forms', () => {
  const data = {allergens: ALLERGENS, ingredients: INGREDIENTS, recipes: RECIPES};
  const tomatoIds = ['tomato', 'canned_tomato', 'tomato_paste'];
  for (const id of tomatoIds) assert.ok(INGREDIENTS[id], `${id} is present in the distributed catalogue`);
  assert.ok(RECIPES.some(recipe => recipe.ingredients.some(part => part.id === 'canned_tomato')));
  const filtered = eligibleRecipes({excludedIngredients: ['tomato']}, data);
  assert.ok(filtered.length > 0);
  assert.ok(filtered.every(recipe => !recipe.ingredients.some(part => tomatoIds.includes(part.id))));
  const plan = generatePlan(settings({days: 7, excludedIngredients: ['tomato']}), data);
  assert.equal(plan.ok, true);
  const variants = [plan, ...plan.days[0].recipeIds.map(recipeId => replaceRecipe(plan,
    {dayIndex: 0, recipeId, excludedIngredients: ['tomato'], seed: 92}, data))];
  for (const variant of variants) {
    assert.equal(variant.ok, true);
    for (const day of variant.days) for (const id of day.recipeIds) {
      assert.ok(!describeRecipe(id, data).ingredients.some(part => tomatoIds.includes(part.id)));
    }
    assert.ok(!shoppingList(variant, 2, data).some(item => tomatoIds.includes(item.id)));
  }
});

const RATIOS = {和食: 40, 洋食: 30, 中華: 20, エスニック: 10, その他: 0};
const RATIO_DATA = {...DATA, recipes: [
  ...DATA.recipes.filter(recipe => recipe.role !== 'main'),
  ...GENRES.flatMap((genre, index) => [
    makeRecipe(`genre-${index}-light`, 'main', ['chicken'], {genre, tags: ['さっぱり', '時短'], minutes: 10}),
    makeRecipe(`genre-${index}-hearty`, 'main', ['chicken'], {genre, tags: ['ガッツリ', '定番']}),
  ]),
]};

test('genre percentages use largest remainders and allocate every day exactly once', () => {
  assert.deepEqual(allocateGenreCounts(7, RATIOS), {和食: 3, 洋食: 2, 中華: 1, エスニック: 1, その他: 0});
  assert.deepEqual(allocateGenreCounts(1, {和食: 20, 洋食: 20, 中華: 20, エスニック: 20, その他: 20}),
    {和食: 1, 洋食: 0, 中華: 0, エスニック: 0, その他: 0});
  for (let days = 1; days <= 7; days++) assert.equal(Object.values(allocateGenreCounts(days, RATIOS)).reduce((sum, value) => sum + value, 0), days);
  for (const bad of [{和食: 99}, {和食: 101, 洋食: -1}, {和食: 99.5, 洋食: 0.5}, {和食: 90, unknown: 10}]) {
    assert.throws(() => allocateGenreCounts(7, bad));
  }
});

test('ratio targets match actual main genres when safe candidates exist, including repeated recipes', () => {
  const plan = generatePlan(settings({days: 7, preferences: {genreMode: 'ratio', genreRatios: RATIOS}}), RATIO_DATA);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.genreSummary.targets, {和食: 3, 洋食: 2, 中華: 1, エスニック: 1, その他: 0});
  assert.deepEqual(plan.genreSummary.actual, plan.genreSummary.targets);
  assert.equal(plan.genreSummary.activeMainCount, 7);
  for (const day of plan.days) assert.equal(describeRecipe(day.recipeIds[0], RATIO_DATA).genre, day.targetGenre);
  const allJapanese = generatePlan(settings({days: 7, preferences: {genreMode: 'ratio', genreRatios: {和食: 100}}}), RATIO_DATA);
  assert.ok(allJapanese.days.every(day => describeRecipe(day.recipeIds[0], RATIO_DATA).genre === '和食'));
  assert.ok(allJapanese.days.some(day => day.warnings.some(message => message.includes('同じ料理'))));
});

test('an unavailable target genre falls back safely even to zero-percent genres with explicit counts', () => {
  const data = {...DATA, recipes: [
    ...DATA.recipes.filter(recipe => recipe.role !== 'main'),
    makeRecipe('egg-japanese', 'main', ['egg'], {genre: '和食'}),
    makeRecipe('chicken-western', 'main', ['chicken'], {genre: '洋食'}),
  ]};
  const plan = generatePlan(settings({days: 7, allergens: ['egg'], preferences: {genreMode: 'ratio', genreRatios: {和食: 100}}}), data);
  assert.equal(plan.ok, true);
  assert.equal(plan.genreSummary.targets.和食, 7);
  assert.equal(plan.genreSummary.actual.洋食, 7);
  assert.match(plan.genreSummary.note, /0%/);
  for (const day of plan.days) {
    assert.equal(day.targetGenre, '和食');
    assert.match(day.warnings.join(''), /和食.*洋食/);
    assert.ok(!describeRecipe(day.recipeIds[0], data).allergens.includes('egg'));
  }
});

test('single mode and legacy genre preferences keep the requested main genre ahead of repetition', () => {
  const history = RATIO_DATA.recipes.filter(recipe => recipe.role === 'main' && recipe.genre === '和食')
    .map(recipe => ({date: '2026-11-09', meal: 'dinner', recipeIds: [recipe.id]}));
  for (const preferences of [{genre: '和食'}, {genreMode: 'single', genre: '和食'}]) {
    const plan = generatePlan(settings({days: 3, preferences, history}), RATIO_DATA);
    assert.equal(plan.settings.preferences.genreMode, 'single');
    assert.ok(plan.days.every(day => describeRecipe(day.recipeIds[0], RATIO_DATA).genre === '和食'));
  }
  assert.equal(generatePlan(settings(), DATA).settings.preferences.genreMode, 'any');
});

test('main swaps preserve the day target and update actual genres when only another genre is available', () => {
  const plan = generatePlan(settings({days: 7, preferences: {genreMode: 'ratio', genreRatios: RATIOS}}), RATIO_DATA);
  const swapped = replaceRecipe(plan, {dayIndex: 0, recipeId: plan.days[0].recipeIds[0], seed: 93}, RATIO_DATA);
  assert.equal(swapped.days[0].targetGenre, plan.days[0].targetGenre);
  assert.equal(describeRecipe(swapped.days[0].recipeIds[0], RATIO_DATA).genre, plan.days[0].targetGenre);
  assert.deepEqual(swapped.genreSummary.actual, plan.genreSummary.actual);
  const data = {...DATA, recipes: [...DATA.recipes.filter(recipe => recipe.role !== 'main'),
    makeRecipe('only-japanese', 'main', ['chicken'], {genre: '和食'}),
    makeRecipe('only-western', 'main', ['chicken'], {genre: '洋食'}),
  ]};
  const one = generatePlan(settings({days: 1, preferences: {genreMode: 'single', genre: '和食'}}), data);
  const fallback = replaceRecipe(one, {dayIndex: 0, recipeId: 'only-japanese'}, data);
  assert.equal(fallback.days[0].targetGenre, '和食');
  assert.equal(fallback.genreSummary.actual.洋食, 1);
  assert.match(fallback.days[0].warnings.join(''), /和食.*洋食/);
});

test('mood tags are preferred inside the requested genre and cannot bypass allergy checks', () => {
  for (const mood of ['さっぱり', 'ガッツリ', '時短', '定番']) {
    const plan = generatePlan(settings({days: 1, preferences: {genreMode: 'single', genre: '和食', mood}}), RATIO_DATA);
    const main = describeRecipe(plan.days[0].recipeIds[0], RATIO_DATA);
    assert.equal(main.genre, '和食');
    assert.ok(main.tags.includes(mood));
  }
  const data = {...DATA, recipes: [...DATA.recipes.filter(recipe => recipe.role !== 'main'),
    makeRecipe('light-egg', 'main', ['egg'], {genre: '和食', tags: ['さっぱり']}),
    makeRecipe('hearty-chicken', 'main', ['chicken'], {genre: '和食', tags: ['ガッツリ']}),
    makeRecipe('foreign-light', 'main', ['chicken'], {genre: '洋食', tags: ['さっぱり']}),
  ]};
  const plan = generatePlan(settings({days: 1, allergens: ['egg'], preferences: {genreMode: 'single', genre: '和食', mood: 'さっぱり'}}), data);
  assert.equal(plan.days[0].recipeIds[0], 'hearty-chicken');
  assert.match(plan.days[0].warnings.join(''), /気分「さっぱり」/);
  const next = replaceRecipe(plan, {dayIndex: 0, recipeId: 'hearty-chicken', allergens: ['egg']}, data);
  assert.equal(next.days[0].recipeIds[0], 'foreign-light');
  assert.ok(!next.days[0].recipeIds.includes('light-egg'));
});

test('omitting and restoring a dish changes shopping and active-main counts without changing the proposal', () => {
  const plan = generatePlan(settings({days: 1}), DATA);
  const original = JSON.stringify(plan);
  const mainId = plan.days[0].recipeIds[0];
  const omitted = toggleDish(plan, {dayIndex: 0, recipeId: mainId}, DATA);
  assert.equal(JSON.stringify(plan), original);
  assert.deepEqual(omitted.days[0].recipeIds, plan.days[0].recipeIds);
  assert.ok(!activeRecipeIds(omitted.days[0]).includes(mainId));
  assert.equal(omitted.genreSummary.activeMainCount, 0);
  assert.equal(omitted.genreSummary.omittedMainCount, 1);
  assert.match(omitted.days[0].warnings.join(''), /主菜/);
  assert.doesNotMatch(omitted.days[0].reasons.join(''), /主菜に含めています/);
  const expected = shoppingList({...plan, days: [{...plan.days[0], recipeIds: activeRecipeIds(omitted.days[0])}]}, 2, DATA);
  assert.deepEqual(shoppingList(omitted, 2, DATA), expected);
  const restored = toggleDish(omitted, {dayIndex: 0, recipeId: mainId}, DATA);
  assert.deepEqual(restored.days[0].omittedRecipeIds, []);
  assert.deepEqual(restored.days[0].reasons, plan.days[0].reasons);
  assert.deepEqual(shoppingList(restored, 2, DATA), shoppingList(plan, 2, DATA));
  assert.equal(restored.genreSummary.activeMainCount, 1);
});

test('all dishes may be explicitly omitted, producing an empty shopping list and no active recipe IDs', () => {
  let plan = generatePlan(settings({days: 1}), DATA);
  const ids = [...plan.days[0].recipeIds];
  for (const recipeId of ids) plan = toggleDish(plan, {dayIndex: 0, recipeId}, DATA);
  assert.equal(plan.ok, true);
  assert.deepEqual(activeRecipeIds(plan.days[0]), []);
  assert.deepEqual(shoppingList(plan, 2, DATA), []);
  assert.equal(plan.genreSummary.activeMainCount, 0);
  assert.match(plan.days[0].reasons.join(''), /すべて/);
});

test('swapping an omitted dish is rejected while swapping another dish preserves omission', () => {
  const plan = generatePlan(settings({days: 1}), DATA);
  const side = plan.days[0].recipeIds.find(id => describeRecipe(id, DATA).role === 'side');
  const omitted = toggleDish(plan, {dayIndex: 0, recipeId: side}, DATA);
  assert.throws(() => replaceRecipe(omitted, {dayIndex: 0, recipeId: side}, DATA), /戻してから/);
  const changed = replaceRecipe(omitted, {dayIndex: 0, recipeId: omitted.days[0].recipeIds[0]}, DATA);
  assert.deepEqual(changed.days[0].omittedRecipeIds, [side]);
  assert.ok(!activeRecipeIds(changed.days[0]).includes(side));
  assert.throws(() => toggleDish(plan, {dayIndex: 0, recipeId: 'missing'}, DATA), /料理が見つかりません/);
});

test('an unsafe saved omitted dish cannot be restored after exclusion settings change', () => {
  const data = {...DATA, recipes: DATA.recipes.filter(recipe => recipe.role !== 'main' || recipe.id === 'egg-rice')};
  const plan = generatePlan(settings({days: 1}), data);
  const omitted = toggleDish(plan, {dayIndex: 0, recipeId: 'egg-rice'}, data);
  const changed = {...omitted, settings: {...omitted.settings, allergens: ['egg']}};
  const restored = toggleDish(changed, {dayIndex: 0, recipeId: 'egg-rice'}, data);
  assert.equal(restored.ok, false);
  assert.deepEqual(restored.days, []);
});

test('preferred source ingredients include derivatives, and exclusion conflicts are disclosed', () => {
  const data = {...DERIVED_DATA, recipes: [
    ...DERIVED_DATA.recipes.filter(recipe => recipe.role !== 'main'),
    makeRecipe('tomato-option', 'main', ['chicken', 'tomato_paste']),
    makeRecipe('carrot-option', 'main', ['chicken', 'carrot']),
  ]};
  for (const seed of [1, 2, 3, 4]) {
    const plan = generatePlan(settings({days: 1, seed, preferences: {preferredIngredients: ['tomato']}}), data);
    assert.equal(plan.days[0].recipeIds[0], 'tomato-option');
  }
  const excluded = generatePlan(settings({days: 1, excludedIngredients: ['tomato'], preferences: {preferredIngredients: ['tomato_paste']}}), data);
  assert.equal(excluded.days[0].recipeIds[0], 'carrot-option');
  assert.match(excluded.warnings.join(''), /優先食材.*除外を優先/);
});

test('the distributed ethnic main collection supports seven days at 100% without silently changing genre', () => {
  const data = {allergens: ALLERGENS, ingredients: INGREDIENTS, recipes: RECIPES};
  assert.ok(RECIPES.some(recipe => recipe.role === 'main' && recipe.genre === 'エスニック'));
  const plan = generatePlan(settings({days: 7, preferences: {genreMode: 'ratio', genreRatios: {エスニック: 100}}}), data);
  assert.equal(plan.ok, true);
  assert.equal(plan.genreSummary.targets.エスニック, 7);
  assert.equal(plan.genreSummary.actual.エスニック, 7);
  assert.ok(plan.days.every(day => describeRecipe(day.recipeIds[0], data).genre === 'エスニック'));
});
