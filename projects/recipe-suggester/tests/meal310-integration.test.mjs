import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {SEAFOOD_INGREDIENTS, SEAFOOD_NUTRITION, SEAFOOD_RECIPES} from '../seafood-foods.js';
import {WORLD_INGREDIENTS, WORLD_NUTRITION, WORLD_RECIPES} from '../world-foods.js';
import {NOODLE_INGREDIENTS, NOODLE_NUTRITION, NOODLE_RECIPES, NOODLE_STYLES} from '../noodle-foods.js';
import {FOOD_COMPOSERS, buildFoodSelection} from '../food-composer.js';
import {buildCurryRiceSelection, curryRiceFor, defaultCurryRiceSelection, eligibleCurryRiceSelections} from '../curry-rice.js';
import {buildNoodleSelection, defaultNoodleSelection, eligibleNoodleSelections, NOODLE_SOUP_INTAKES} from '../noodle-composer.js';
import {catalogFamilies, catalogVariants, isCompleteMeal, recipeFamily, recipePortion} from '../catalog.js';
import {NUTRIENT_KEYS, itemNutrition, recipeNutrition, summariseEntries} from '../nutrition.js';
import {createCatalogEntry} from '../record-actions.js';
import {defaultJournal, parseJournal, validateJournal} from '../journal.js';
import {activeRecipeIds, eligibleRecipes, generateCalendarPlan} from '../planner.js';
import {shoppingForEntries} from '../shopping.js';

const data = {allergens: ALLERGENS, ingredients: INGREDIENTS, recipes: RECIPES};
const contract = JSON.parse(readFileSync(new URL('./fixtures/meal391-data-contract.json', import.meta.url), 'utf8'));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const near = (actual, expected, label = '') => assert.ok(typeof actual === 'number' && Number.isFinite(actual) &&
  Math.abs(actual - expected) < 1e-7, `${label}: expected ${expected}, got ${actual}`);
const date = '2026-11-13';
const amounts = recipe => Object.fromEntries(recipe.ingredients.map(part => [part.id, part.amount]));
const builtin = id => {
  const found = RECIPES.find(recipe => recipe.id === id);
  assert.ok(found, `公開DBから ${id} を利用できる`);
  return found;
};
const withRecipes = recipes => ({...data, recipes:[...RECIPES, ...recipes]});
const record = (recipe, catalog, amount = recipePortion(recipe, catalog).amount, status = 'planned') =>
  createCatalogEntry({recipeId:recipe.id, date, meal:'dinner', status, amount}, catalog);

test('v3.9.1で公開済みの885レシピ・405食材を全項目で保持する', () => {
  const originalIds = new Set(contract.recipeIds);
  const originals = RECIPES.filter(recipe => originalIds.has(recipe.id));
  assert.deepEqual(originals.map(recipe => recipe.id), contract.recipeIds);
  assert.equal(originals.length, 885);
  assert.equal(hash(originals), contract.recipeHash, '既存レシピの材料・量・栄養・手順・出典を変えない');
  const ingredients = Object.fromEntries(contract.ingredientIds.map(id => {
    assert.ok(Object.hasOwn(INGREDIENTS, id), id);
    return [id, INGREDIENTS[id]];
  }));
  assert.equal(Object.keys(ingredients).length, 405);
  assert.equal(hash(ingredients), contract.ingredientHash, '既存食材の成分・単位・換算・出典も変えない');
});

test('追加データが単独の定義だけでなく公開DBと栄養データへ接続される', () => {
  for (const [foods, profiles, recipes] of [
    [SEAFOOD_INGREDIENTS, SEAFOOD_NUTRITION, SEAFOOD_RECIPES],
    [WORLD_INGREDIENTS, WORLD_NUTRITION, WORLD_RECIPES],
    [NOODLE_INGREDIENTS, NOODLE_NUTRITION, NOODLE_RECIPES],
  ]) {
    for (const [id, food] of Object.entries(foods)) {
      assert.ok(Object.hasOwn(INGREDIENTS, id), id);
      assert.equal(INGREDIENTS[id].name, food.name, id);
      assert.deepEqual(INGREDIENTS[id].nutritionPerUnit, profiles[id].nutritionPerUnit, id);
      assert.deepEqual(INGREDIENTS[id].rawNutritionPerUnit, profiles[id].rawNutritionPerUnit, id);
      assert.deepEqual(INGREDIENTS[id].estimatedNutrients, profiles[id].estimatedNutrients, id);
      assert.equal(INGREDIENTS[id].gramsPerUnit, 1, id);
    }
    for (const definition of recipes) {
      const source = builtin(definition.id), nutrition = recipeNutrition(source, data);
      assert.ok(NUTRIENT_KEYS.every(key => Number.isFinite(nutrition[key]) && nutrition[key] >= 0), source.id);
      assert.equal(RECIPES.filter(recipe => recipe.id === source.id).length, 1, source.id);
    }
  }
});

test('要求された刺身・ナン・エスニック料理が分類と選択画面から見つかる', () => {
  const sashimi = FOOD_COMPOSERS.find(composer => composer.kind === 'sashimi');
  for (const choice of ['octopus', 'mizudako', 'amaebi', 'scallop', 'inada', 'hirame', 'tsubu', 'shimesaba', 'aji', 'iwashi', 'sanma', 'akaebi', 'hiramasa']) {
    const option = sashimi.components.find(component => component.id === choice);
    assert.ok(option, choice);
    assert.equal(recipeFamily(builtin(option.recipeId)), 'sashimi', choice);
  }
  assert.equal(sashimi.components.find(choice => choice.id === 'octopus').label, 'マダコ（ボイル）');
  assert.equal(new Set(sashimi.components.map(choice => choice.recipeId)).size, sashimi.components.length);
  const naanIds = ['plain', 'garlic', 'butter', 'cheese', 'sesame', 'wholewheat'].map(style => `world-naan-${style}`);
  assert.deepEqual(catalogVariants(RECIPES, 'naan').map(recipe => recipe.id), naanIds);
  assert.ok(catalogFamilies(RECIPES, {role:'staple'}).some(family => family.id === 'naan' && family.label === 'ナン'));
  for (const id of ['world-tomyum-kung', 'world-massaman-chicken', 'world-mutton-curry', 'world-saag-chicken', 'world-saag-paneer']) {
    assert.equal(builtin(id).genre, 'エスニック', id);
  }
  assert.equal(recipeFamily(builtin('world-crab-cream-croquette')), 'cutlet');
});

test('公開カレーの全種類で米だけを差し替え、ルーのみを主菜として保存できる', () => {
  const before = hash(RECIPES), curries = RECIPES.filter(recipe => recipeFamily(recipe) === 'curry');
  assert.equal(curries.length, 19);
  for (const source of curries) {
    assert.ok(curryRiceFor(source.id, data), source.id);
    assert.equal(defaultCurryRiceSelection(source.id, data).riceGrams, 150);
    const zero = buildCurryRiceSelection({id:`custom-zero-${source.id}`, recipeId:source.id, riceGrams:0}, data);
    const rice = buildCurryRiceSelection({recipeId:source.id, riceGrams:250}, data);
    assert.equal(zero.servings, 1, source.id);
    assert.equal(zero.role, 'main', source.id);
    assert.equal(zero.staple, false, source.id);
    assert.equal(isCompleteMeal(zero), false, source.id);
    assert.ok(!zero.ingredients.some(part => part.id === 'rice' || part.amount === 0), source.id);
    assert.match(zero.name, /ご飯0g・ルーのみ/);
    near(amounts(rice).rice, 250, source.id);
    for (const part of source.ingredients.filter(part => part.id !== 'rice')) near(amounts(zero)[part.id], part.amount / source.servings, `${source.id}:${part.id}`);
    for (const key of NUTRIENT_KEYS) {
      if (zero.manualNutrition[key] === null) assert.equal(rice.manualNutrition[key], null);
      else near(rice.manualNutrition[key] - zero.manualNutrition[key], 250 * INGREDIENTS.rice.nutritionPerUnit[key], `${source.id}:${key}`);
    }
    const state = defaultJournal(date); state.customRecipes = [zero];
    state.entries = [record(zero, withRecipes([zero]))];
    const restored = parseJournal(JSON.stringify(state), data);
    assert.equal(restored.customRecipes[0].role, 'main');
    assert.equal(restored.entries[0].items[0].role, 'main');
    assert.ok(!restored.entries[0].items[0].ingredients.some(part => part.id === 'rice'));
  }
  assert.equal(hash(RECIPES), before);
});

test('米を除外した条件でもカレーだけを選べ、追加ナンとアレルゲン条件を判定する', () => {
  const source = 'world-saag-chicken';
  const choices = eligibleCurryRiceSelections(source, {excludedIngredients:['rice']}, data);
  assert.deepEqual(choices.map(choice => choice.config.riceGrams), [0]);
  assert.deepEqual(eligibleCurryRiceSelections(source, {allergens:['milk']}, data), []);
  const allowed = new Set(eligibleRecipes({allergens:['wheat']}, data).map(recipe => recipe.id));
  for (const recipe of WORLD_RECIPES.filter(recipe => recipe.family === 'naan')) assert.ok(!allowed.has(recipe.id), recipe.id);
  assert.deepEqual(eligibleNoodleSelections('noodle-ramen-tonkotsu', {allergens:['wheat']}, data), []);
});

test('ご飯なしカレーへナンを添え、新しいラーメンは一品の主食として提案できる', () => {
  const curry = buildCurryRiceSelection({id:'custom-plan-curry', recipeId:'world-mutton-curry', riceGrams:0}, data);
  const naan = builtin('world-naan-plain'), soup = builtin('world-tomyum-kung');
  const side = eligibleRecipes({}, data, {role:'side'})[0];
  const settings = {...defaultJournal(date).settings, startDate:date, days:1, stapleMode:'fixed', stapleId:naan.id, stapleAmount:2};
  const withNaan = generateCalendarPlan(settings, {...data, recipes:[curry, naan, side, soup]});
  assert.equal(withNaan.ok, true);
  assert.deepEqual(new Set(activeRecipeIds(withNaan.days[0])), new Set([curry.id, naan.id, side.id, soup.id]));
  assert.equal(withNaan.days[0].quantities[naan.id], 2);
  assert.ok(!curry.ingredients.some(part => part.id === 'rice'));
  for (const recipe of NOODLE_RECIPES.filter(recipe => NOODLE_STYLES.find(model => model.recipeId === recipe.id).soup.length)) {
    const plan = generateCalendarPlan({...settings, stapleId:recipe.id, stapleAmount:1}, {...data, recipes:[recipe, curry, side, soup]});
    assert.equal(plan.ok, true, recipe.id);
    assert.deepEqual(new Set(activeRecipeIds(plan.days[0])), new Set([recipe.id, side.id]), recipe.id);
  }
});

test('すべての麺ジャンルが公開DBで組み立てられ、汁の5段階を保存できる', () => {
  const requested = ['niboshi', 'miso-butter-corn', 'tonkotsu', 'iekei', 'jiro', 'seabura'];
  for (const name of requested) assert.ok(NOODLE_STYLES.some(model => model.recipeId === `noodle-ramen-${name}`), name);
  assert.deepEqual(NOODLE_SOUP_INTAKES.map(intake => intake.fraction), [.1, .25, .5, .8, 1]);
  for (const model of NOODLE_STYLES) {
    const source = builtin(model.recipeId), selection = defaultNoodleSelection(source.id);
    const full = buildNoodleSelection({...selection, id:`custom-integration-${source.id}`}, data);
    for (const key of NUTRIENT_KEYS) near(full.manualNutrition[key], recipeNutrition(source, data)[key], `${source.id}:${key}`);
    const state = defaultJournal(date); state.customRecipes = [full]; state.entries = [record(full, withRecipes([full]))];
    assert.equal(validateJournal(state, data).customRecipes[0].id, full.id);
    if (!model.soup.length) continue;
    for (const intake of NOODLE_SOUP_INTAKES) {
      const selected = buildNoodleSelection({...selection, soupIntake:intake.id}, data);
      assert.deepEqual(selected.ingredients, full.ingredients, `${source.id}:${intake.id}:調理全量`);
      for (const key of NUTRIENT_KEYS) {
        const broth = model.soup.reduce((sum, part) => sum + part.amount * INGREDIENTS[part.id].nutritionPerUnit[key], 0);
        near(full.manualNutrition[key] - selected.manualNutrition[key], broth * (1 - intake.fraction), `${source.id}:${intake.id}:${key}`);
      }
    }
  }
});

test('選択したトッピングは全量を加え、除いた卵の確認情報を残さない', () => {
  const selection = {...defaultNoodleSelection('noodle-ramen-tonkotsu'), toppings:[], soupIntake:'clinging'};
  const plain = buildNoodleSelection(selection, data);
  const topped = buildNoodleSelection({...selection, toppings:[{id:'garlic', amount:2}, {id:'ajitama', amount:1}, {id:'chashu', amount:3}, {id:'menma', amount:20}]}, data);
  near(amounts(topped).garlic, 6);
  near(amounts(topped).egg, 1);
  near(amounts(topped).noodle_chashu, 60);
  for (const key of NUTRIENT_KEYS) assert.ok(topped.manualNutrition[key] >= plain.manualNutrition[key], key);
  const changed = {...data, recipes:RECIPES.map(recipe => recipe.id === selection.recipeId ? {...recipe, allergens:['egg'], proteinSources:['egg']} : recipe)};
  const removed = buildNoodleSelection(selection, changed);
  assert.ok(!removed.allergens.includes('egg'));
  assert.ok(!removed.proteinSources.includes('egg'));
});

test('カレーとナン・刺身・スープを残す麺の予定を、g・人数・手持ちまで一度だけ換算する', () => {
  const curry = buildCurryRiceSelection({id:'custom-cross-curry', recipeId:'world-mutton-curry', riceGrams:0}, data);
  const sashimi = buildFoodSelection({id:'custom-cross-sashimi', kind:'sashimi', components:[{id:'hirame', amount:3, gramsPerUnit:9}, {id:'amaebi', amount:2}, {id:'shimesaba', amount:2}]}, data);
  const ramen = buildNoodleSelection({...defaultNoodleSelection('noodle-ramen-tonkotsu'), id:'custom-cross-ramen', soupIntake:'clinging', toppings:[{id:'garlic', amount:2}]}, data);
  const catalog = withRecipes([curry, sashimi, ramen]), naan = builtin('world-naan-plain');
  const state = defaultJournal(date); state.customRecipes = [curry, sashimi, ramen];
  state.entries = [record(curry, catalog, 1.5), record(naan, catalog, 2), record(sashimi, catalog, .5), record(ramen, catalog, .75), record(ramen, catalog, 1, 'eaten')];
  const restored = parseJournal(JSON.stringify(validateJournal(state, data)), data);
  const pantry = [{id:'garlic', amount:8}, {id:'world_mutton', amount:200}, {id:'seafood_hirame', amount:10}];
  const shopping = shoppingForEntries(restored.entries, data, {from:date, to:date, servings:3, pantry});
  assert.equal(shopping.entryCount, 4); assert.deepEqual(shopping.missingMenus, []);
  const expected = new Map();
  for (const [recipe, quantity] of [[curry, 1.5], [naan, 2], [sashimi, .5], [ramen, .75]]) {
    for (const part of recipe.ingredients) expected.set(part.id, (expected.get(part.id) ?? 0) + part.amount / recipe.servings * quantity * 3);
  }
  assert.equal(shopping.items.length, expected.size);
  assert.ok(!shopping.items.some(item => item.id === 'rice'));
  for (const item of shopping.items) {
    near(item.required, expected.get(item.id), item.id);
    near(item.buy, Math.max(0, expected.get(item.id) - (pantry.find(stock => stock.id === item.id)?.amount ?? 0)), item.id);
  }
  const summary = summariseEntries(restored.entries, {from:date, to:date, status:'planned'});
  for (const key of NUTRIENT_KEYS) near(summary.values[key], restored.entries.filter(entry => entry.status === 'planned').reduce((sum, entry) => sum + itemNutrition(entry.items[0])[key], 0), key);
  const full = buildNoodleSelection({...defaultNoodleSelection('noodle-ramen-tonkotsu'), soupIntake:'full', toppings:[{id:'garlic', amount:2}]}, data);
  assert.ok(ramen.manualNutrition.salt < full.manualNutrition.salt);
  near(shopping.items.find(item => item.id === 'water').required, expected.get('water'));
});

test('料理を選び直し食材DBが更新されても、保存済みの栄養と調理量を保持する', () => {
  const curry = buildCurryRiceSelection({id:'custom-frozen-curry', recipeId:'prepared-retort-keema-curry', riceGrams:0}, data);
  const ramen = buildNoodleSelection({...defaultNoodleSelection('noodle-ramen-jiro'), id:'custom-frozen-ramen', soupIntake:'half'}, data);
  const state = defaultJournal(date); state.customRecipes = [curry, ramen];
  state.entries = [record(curry, withRecipes([curry, ramen]), .5), record(ramen, withRecipes([curry, ramen]), 1.25)];
  const saved = validateJournal(state, data), before = JSON.stringify(saved.entries);
  buildCurryRiceSelection({recipeId:'prepared-retort-keema-curry', riceGrams:500}, data);
  buildNoodleSelection({...defaultNoodleSelection('noodle-ramen-jiro'), soupIntake:'full'}, data);
  const updated = {...data, ingredients:Object.fromEntries(Object.entries(INGREDIENTS).map(([id, food]) => [id, {...food, nutritionPerUnit:Object.fromEntries(NUTRIENT_KEYS.map(key => [key, 0]))}]))};
  const restored = parseJournal(JSON.stringify(saved), updated);
  assert.equal(JSON.stringify(restored.entries), before);
  near(itemNutrition(restored.entries[1].items[0]).fat, ramen.manualNutrition.fat * 1.25);
});

test('不明な栄養をゼロにせず、未分離の市販ラーメンや手入力カレーを推定で分解しない', () => {
  const unknown = {...data, ingredients:{...INGREDIENTS, noodle_tonkotsu_concentrate:{...INGREDIENTS.noodle_tonkotsu_concentrate, nutritionPerUnit:{...INGREDIENTS.noodle_tonkotsu_concentrate.nutritionPerUnit, salt:null}}}};
  const ramen = buildNoodleSelection({...defaultNoodleSelection('noodle-ramen-tonkotsu'), soupIntake:'clinging'}, unknown);
  assert.equal(ramen.manualNutrition.salt, null);
  const source = builtin('prepared-retort-keema-curry'), opaque = {...source, id:'custom-opaque-curry', custom:true};
  assert.equal(curryRiceFor(opaque.id, {...data, recipes:[...RECIPES, opaque]}), null);
  const saltUnknown = {...data, recipes:RECIPES.map(recipe => recipe.id === source.id ? {...recipe, manualNutrition:{...recipe.manualNutrition, salt:null}} : recipe)};
  assert.equal(buildCurryRiceSelection({recipeId:source.id, riceGrams:0}, saltUnknown).manualNutrition.salt, null);
  assert.throws(() => buildNoodleSelection({recipeId:'prepared-cup-ramen-soy', noodleAmount:150, soupIntake:'half', toppings:[]}, data), /分けて/);
});
