import test from 'node:test';
import assert from 'node:assert/strict';
import {describeRecipe, eligibleRecipes, generatePlan, generateCalendarPlan, replaceRecipe, shoppingList} from '../planner.js';
import {itemFromRecipe, itemNutrition, summariseEntries} from '../nutrition.js';
import {JOURNAL_KEY, defaultJournal, parseJournal, validateJournal} from '../journal.js';
import {defaultState} from '../storage.js';
import {shoppingForEntries} from '../shopping.js';

// 商品の購入単位が分かることと、全原材料を確認できたことは別に検証します。
const nutrients = (kcal = 1) => ({kcal, protein: 0.1, fat: 0.02, carbs: 0.15, fiber: 0.01, salt: 0.001});
const ingredient = (name, groups = [], allergens = [], extra = {}) => ({name, unit: 'g', groups, allergens, proteinSources: [], nutritionPerUnit: nutrients(), ...extra});
const food = (id, role, parts = ['vegetable'], extra = {}) => ({id, name: id, role, genre: '和食', minutes: 5, servings: 1,
  ingredients: parts.map(id => ({id, amount: 100})), steps: ['材料を用意します。'], tags: [], staple: role === 'staple', ...extra});
const sourceNote = '代表的な商品の概算です。原材料と栄養成分は購入した商品の表示を確認してください。';
const product = (id = 'generic-product', role = 'main', extra = {}) => food(id, role, ['pack'], {
  nature: 'retort', allergensKnown: false, ingredientsKnown: false, shoppingKnown: true, sourceNote,
  ingredients: [{id: 'pack', amount: 200}, {id: 'rice', amount: 150}], ...extra});
const DATA = {allergens: ['soy', 'wheat', 'egg'].map(id => ({id, label: id})), ingredients: {
  vegetable: ingredient('野菜', ['vegetable']), rice: ingredient('ご飯', ['staple'], [], {nutritionPerUnit: nutrients(1.5)}),
  water: ingredient('水', [], [], {unit: 'ml'}), soy: ingredient('大豆', ['protein'], ['soy']),
  wheat: ingredient('小麦', ['staple'], ['wheat']), sauce: ingredient('ソース', [], [], {derivedFrom: ['soy', 'wheat']}),
  pack: ingredient('レトルト商品', [], [], {derivedFrom: ['sauce']}),
  egg: ingredient('卵', ['protein'], ['egg'], {unit: '個'}),
}, recipes: [food('main-a', 'main'), food('main-b', 'main'), food('side', 'side'), food('soup', 'soup', ['water']),
  food('plain-rice', 'staple', ['rice']), food('water-drink', 'drink', ['water']), food('snack', 'snack'),
  product(), product('generic-staple', 'staple', {family: 'curry', mealBase: true}),
  product('generic-drink', 'drink'), product('generic-snack', 'snack')]};
const settings = extra => ({startDate: '2026-11-12', days: 1, servings: 2, seed: 7, ...extra});
const entry = (id, item, {date = '2026-11-12', status = 'eaten'} = {}) => ({id, date, meal: 'dinner', status, note: '', items: [item]});
const recipe = id => DATA.recipes.find(recipe => recipe.id === id);

test('組み込みの市販例も未確認フラグを保ち、原料のアレルゲンは失わない', () => {
  const description = describeRecipe('generic-product', DATA);
  const snapshot = itemFromRecipe(recipe('generic-product'), DATA, 1.5);
  for (const item of [description, snapshot]) {
    assert.equal(item.allergensKnown, false);
    assert.equal(item.ingredientsKnown, false);
    assert.equal(item.shoppingKnown, true);
    assert.equal(item.nature, 'retort');
    assert.equal(item.sourceNote, sourceNote);
    assert.deepEqual(new Set(item.allergens), new Set(['soy', 'wheat']));
  }
  assert.equal(snapshot.nutrition.kcal, 425);
  assert.equal(itemNutrition(snapshot).kcal, 637.5);
});

test('即席・レトルト・ファストフードはフラグの付け忘れでも確認済みと解釈しない', () => {
  for (const nature of ['instant', 'retort', 'fast-food']) {
    const missingFlags = food(`missing-${nature}`, 'main', ['pack'], {nature});
    const data = {...DATA, recipes: [...DATA.recipes, missingFlags]};
    const description = describeRecipe(missingFlags.id, data);
    const snapshot = itemFromRecipe(missingFlags, data);
    assert.equal(description.allergensKnown, false, nature);
    assert.equal(snapshot.ingredientsKnown, false, nature);
    assert.ok(!eligibleRecipes({}, data).some(recipe => recipe.id === missingFlags.id));
  }
});

test('材料が確認できる手作りとそのまま食べる単純な食品は従来どおり記録・提案できる', () => {
  for (const nature of [undefined, 'home-cooked', 'ready-to-eat']) {
    const simple = food('simple-egg', 'main', ['egg'], nature === undefined ? {} : {nature});
    const data = {...DATA, recipes: [...DATA.recipes, simple]};
    assert.equal(describeRecipe(simple.id, data).allergensKnown, true);
    assert.equal(itemFromRecipe(simple, data).ingredientsKnown, true);
    assert.ok(eligibleRecipes({}, data).some(recipe => recipe.id === simple.id));
    assert.ok(!eligibleRecipes({allergens: ['egg']}, data).some(recipe => recipe.id === simple.id));
  }
});

test('未確認商品は自動献立・固定主食・固定飲料・間食から除外し候補不足でも戻さない', () => {
  for (const generator of [generatePlan, generateCalendarPlan]) {
    const generated = generator(settings({days: 7}), DATA);
    assert.equal(generated.ok, true);
    assert.ok(generated.days.every(day => day.recipeIds.every(id => !id.startsWith('generic-'))));
    const onlyUnknownMain = {...DATA, recipes: DATA.recipes.filter(recipe => recipe.role !== 'main' || recipe.id === 'generic-product')};
    const incomplete = generator(settings(), onlyUnknownMain);
    assert.equal(incomplete.ok, false);
    assert.deepEqual(incomplete.days, []);
    assert.ok(incomplete.missingRoles.includes('main'));
  }
  for (const choice of [{stapleId: 'generic-staple'}, {drinkId: 'generic-drink'}]) {
    assert.equal(generateCalendarPlan(settings(), DATA, choice).ok, false);
  }
  const onlyUnknownSnack = {...DATA, recipes: DATA.recipes.filter(recipe => recipe.role !== 'snack' || recipe.id === 'generic-snack')};
  assert.equal(generateCalendarPlan(settings({meal: 'snack'}), onlyUnknownSnack).ok, false);
});

test('差し替え候補が未確認商品だけなら元の料理を保ち、古い危険な献立を受け付けない', () => {
  const data = {...DATA, recipes: DATA.recipes.filter(recipe => recipe.id !== 'main-b')};
  for (const generator of [generatePlan, generateCalendarPlan]) {
    const plan = generator(settings(), data);
    const swapped = replaceRecipe(plan, {dayIndex: 0, recipeId: 'main-a'}, data);
    assert.equal(swapped.ok, true);
    assert.deepEqual(swapped.days[0].recipeIds, plan.days[0].recipeIds);
    assert.match(swapped.warnings.join(''), /現在の料理を維持/);
    const stale = {...plan, days: [{...plan.days[0], recipeIds: plan.days[0].recipeIds.map(id => id === 'main-a' ? 'generic-product' : id)}]};
    assert.equal(replaceRecipe(stale, {dayIndex: 0, recipeId: 'generic-product'}, data).ok, false);
    assert.throws(() => shoppingList(stale, 2, data), /除外条件に合わない/);
  }
});

test('商品表示と材料を確認したマイメニューは候補にでき、原料除外も守る', () => {
  const custom = product('custom-verified', 'main', {custom: true, allergensKnown: true, ingredientsKnown: true, allergens: ['egg']});
  const data = {...DATA, recipes: [...DATA.recipes, custom]};
  assert.ok(eligibleRecipes({}, data).some(recipe => recipe.id === custom.id));
  for (const choice of [{allergens: ['soy']}, {allergens: ['wheat']}, {allergens: ['egg']}, {excludedIngredients: ['soy']}]) {
    assert.ok(!eligibleRecipes(choice, data).some(recipe => recipe.id === custom.id));
  }
});

test('商品情報と貫・食の基準量をマイメニューと食事記録のJSONに保持する', () => {
  const state = defaultJournal('2026-11-12');
  state.customRecipes = [product('custom-pack', 'staple', {custom: true, portion: {amount: 1, unit: '食'}, family: 'curry'})];
  delete state.customRecipes[0].tags;
  const sushi = itemFromRecipe(food('sushi', 'staple', ['rice'], {nature: 'ready-to-eat'}), DATA);
  sushi.portion = {amount: 8, unit: '貫', label: '握り寿司8貫'};
  state.entries = [entry('pack-record', {...itemFromRecipe(recipe('generic-product'), DATA), portion: {amount: 1, unit: '食'}}), entry('sushi-record', sushi)];
  const clean = validateJournal(state, DATA);
  const imported = parseJournal(JSON.stringify(clean), DATA);
  assert.deepEqual(imported, clean);
  assert.equal(imported.customRecipes[0].nature, 'retort');
  assert.equal(imported.customRecipes[0].sourceNote, sourceNote);
  assert.equal(imported.customRecipes[0].shoppingKnown, true);
  assert.equal(imported.entries[0].items[0].allergensKnown, false);
  assert.equal(imported.entries[1].items[0].portion.unit, '貫');
  const unspecified = structuredClone(clean);
  unspecified.customRecipes[0].nature = 'unspecified';
  assert.equal(validateJournal(unspecified, DATA).customRecipes[0].nature, 'unspecified');
});

test('不正な性質・確認フラグ・説明や空の購入商品構成を確認済みとして保存しない', () => {
  for (const patch of [{nature: 'mystery'}, {sourceNote: 42}, {sourceNote: 'あ'.repeat(2001)},
    {shoppingKnown: 'true'}, {allergensKnown: 'false'}, {ingredientsKnown: null}, {shoppingKnown: true, ingredients: []}]) {
    const bad = product('bad-product', 'main', patch);
    assert.throws(() => itemFromRecipe(bad, DATA));
    assert.throws(() => describeRecipe(bad.id, {...DATA, recipes: [bad]}));
    const state = defaultJournal('2026-11-12');
    state.customRecipes = [{...bad, id: 'custom-bad', custom: true}];
    // マイレシピにはタグを保存しないため、検証対象から除きます。
    delete state.customRecipes[0].tags;
    assert.throws(() => validateJournal(state, DATA));
  }
  for (const patch of [{nature: 'mystery'}, {sourceNote: []}, {shoppingKnown: 1}, {shoppingKnown: true, ingredients: []}]) {
    const state = defaultJournal('2026-11-12');
    state.entries = [entry('invalid', {...itemFromRecipe(recipe('generic-product'), DATA), ...patch})];
    assert.throws(() => validateJournal(state, DATA));
  }
});

test('旧v3保存ファイルには追加項目を強制せず保存キーとバージョンを維持する', () => {
  const state = defaultJournal('2026-11-12');
  state.entries = [entry('old-v3', itemFromRecipe(recipe('main-a'), DATA))];
  const imported = parseJournal(JSON.stringify(state), DATA);
  assert.deepEqual(imported, state);
  assert.equal(imported.version, 3);
  assert.equal(JOURNAL_KEY, 'kondate-note-v3');
  assert.ok(!Object.hasOwn(imported.entries[0].items[0], 'nature'));
  assert.ok(!Object.hasOwn(imported.entries[0].items[0], 'sourceNote'));
  assert.ok(!Object.hasOwn(imported.entries[0].items[0], 'shoppingKnown'));
});

test('旧履歴からの移行も未確認商品の説明と確認状況を保つ', () => {
  const state = defaultState('2026-11-12');
  state.history = [{id: 'old-product', date: '2026-11-11', meal: 'lunch', recipeIds: ['generic-product'], groups: [], proteinSources: [], note: ''}];
  const migrated = validateJournal(state, DATA).entries[0].items[0];
  assert.equal(migrated.allergensKnown, false);
  assert.equal(migrated.ingredientsKnown, false);
  assert.equal(migrated.shoppingKnown, true);
  assert.equal(migrated.nature, 'retort');
  assert.equal(migrated.sourceNote, sourceNote);
  assert.deepEqual(new Set(migrated.allergens), new Set(['soy', 'wheat']));
});

test('購入商品は人数と量を掛けて集計し、原材料確認の注意を残して在庫は一度だけ引く', () => {
  const first = itemFromRecipe(recipe('generic-product'), DATA, 1.5);
  const second = itemFromRecipe(recipe('generic-product'), DATA, 0.5);
  const entries = [entry('first', first, {status: 'planned'}), entry('second', second, {date: '2026-11-13', status: 'planned'})];
  const before = structuredClone(entries);
  const shopping = shoppingForEntries(entries, DATA, {from: '2026-11-12', to: '2026-11-13', servings: 3, pantry: [{id: 'pack', amount: 100}, {id: 'rice', amount: 50}]});
  const items = Object.fromEntries(shopping.items.map(item => [item.id, item]));
  assert.equal(items.pack.required, 1200);
  assert.equal(items.pack.buy, 1100);
  assert.equal(items.rice.required, 900);
  assert.equal(items.rice.buy, 850);
  assert.deepEqual(shopping.missingMenus, [{name: 'generic-product', entryId: 'first'}, {name: 'generic-product', entryId: 'second'}]);
  assert.deepEqual(entries, before);
});

test('購入商品未確認のマイメニューは一部の材料があっても買い物を完了扱いにしない', () => {
  const entries = [undefined, false].map((shoppingKnown, i) => {
    const item = itemFromRecipe(recipe('generic-product'), DATA);
    delete item.shoppingKnown;
    if (shoppingKnown !== undefined) item.shoppingKnown = shoppingKnown;
    return entry(`unknown-${i}`, item, {status: 'planned'});
  });
  const shopping = shoppingForEntries(entries, DATA, {from: '2026-11-12', to: '2026-11-12', servings: 2});
  assert.deepEqual(shopping.items, []);
  assert.equal(shopping.missingMenus.length, 2);
});

test('市販品を食べた実績は栄養集計に入り買い物予定には入らない', () => {
  const entries = [entry('eaten-product', itemFromRecipe(recipe('generic-product'), DATA, 2))];
  const summary = summariseEntries(entries, {from: '2026-11-12', to: '2026-11-12'});
  assert.equal(summary.values.kcal, 850);
  assert.equal(summary.complete.kcal, true);
  const shopping = shoppingForEntries(entries, DATA, {from: '2026-11-12', to: '2026-11-12', servings: 2});
  assert.deepEqual(shopping.items, []);
  assert.deepEqual(shopping.missingMenus, []);
});
