import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {buildCurryRiceSelection, curryRiceFor, defaultCurryRiceSelection, eligibleCurryRiceSelections} from '../curry-rice.js';
import {isCompleteMeal, recipeFamily} from '../catalog.js';
import {NUTRIENT_KEYS, itemFromRecipe, recipeNutrition} from '../nutrition.js';
import {createCatalogEntry} from '../record-actions.js';
import {defaultJournal, parseJournal} from '../journal.js';
import {shoppingForEntries} from '../shopping.js';

const data = {recipes:RECIPES, ingredients:INGREDIENTS, allergens:ALLERGENS};
const source = id => RECIPES.find(recipe => recipe.id === id);
const build = (recipeId, riceGrams = 150, database = data) => buildCurryRiceSelection({recipeId, riceGrams}, database);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const parts = recipe => Object.fromEntries(recipe.ingredients.map(part => [part.id, part.amount]));
const withRecipe = recipe => ({...data, recipes:[...RECIPES, recipe]});

test('材料が明示された既存の全カレーで元の米量なら元の栄養を再現し、元データを変えない', () => {
  const before = JSON.stringify(data), curries = RECIPES.filter(recipe => recipeFamily(recipe) === 'curry');
  assert.ok(curries.length >= 15);
  for (const base of curries) {
    assert.ok(curryRiceFor(base.id, data), base.id);
    assert.equal(defaultCurryRiceSelection(base.id, data).riceGrams, 150);
    const riceGrams = base.ingredients.filter(part => part.id === 'rice').reduce((sum, part) => sum + part.amount / base.servings, 0);
    const made = build(base.id, riceGrams);
    for (const [key, value] of Object.entries(recipeNutrition(base, data))) value === null ? assert.equal(made.manualNutrition[key], null) : close(made.manualNutrition[key], value);
    for (const part of base.ingredients.filter(part => part.id !== 'rice')) close(parts(made)[part.id], part.amount / base.servings);
    assert.equal(made.servings, 1); assert.equal(made.custom, true); assert.equal(made.family, 'curry');
    assert.equal(made.role, base.role); assert.equal(made.staple, base.staple === true);
  }
  assert.equal(JSON.stringify(data), before);
});

test('0gは米を材料から除き、ルーのみの主菜としてナンと組み合わせられる', () => {
  const id = 'daily-curry-beef', zero = build(id, 0), base = source(id), original = recipeNutrition(base, data);
  assert.ok(!zero.ingredients.some(part => part.id === 'rice'));
  assert.equal(zero.role, 'main'); assert.equal(zero.staple, false); assert.equal(isCompleteMeal(zero), false); assert.equal(zero.family, 'curry');
  assert.match(zero.name, /ご飯0g・ルーのみ/); assert.match(zero.steps[0], /ナン/);
  const rice = base.ingredients.find(part => part.id === 'rice').amount / base.servings;
  for (const key of NUTRIENT_KEYS) close(zero.manualNutrition[key], original[key] - rice * INGREDIENTS.rice.nutritionPerUnit[key]);
  const baked = build('rice-baked-cheese', 0);
  assert.match(baked.steps.join(' '), /カレーの具を入れ/);
  assert.doesNotMatch(baked.steps.join(' '), /温かいご飯と具/);
  for (const id of ['minced-dry-curry', 'daily-curry-keema', 'varied-green-curry-rice', 'varied-butter-chicken-rice']) assert.ok(!build(id, 0).steps.slice(1).some(step => /ご飯/.test(step)), id);
});

test('ご飯0・150・300gの栄養差分は炊飯済みの米だけで、カレーの量を保つ', () => {
  for (const id of ['tomato-chicken-curry', 'prepared-retort-beef-curry', 'prepared-retort-vegetable-curry', 'prepared-retort-keema-curry']) {
    const zero = build(id, 0), one = build(id, 150), two = build(id, 300);
    assert.deepEqual(one.ingredients.filter(part => part.id !== 'rice'), zero.ingredients);
    assert.deepEqual(two.ingredients.filter(part => part.id !== 'rice'), zero.ingredients);
    for (const key of NUTRIENT_KEYS) {
      close(one.manualNutrition[key] - zero.manualNutrition[key], 150 * INGREDIENTS.rice.nutritionPerUnit[key]);
      close(two.manualNutrition[key] - one.manualNutrition[key], 150 * INGREDIENTS.rice.nutritionPerUnit[key]);
    }
  }
});

test('明示されたレトルト配合だけ手入力の完成栄養から米を分離し、未知の完成品は対象外にする', () => {
  const zero = build('prepared-retort-beef-curry', 0);
  close(zero.manualNutrition.kcal, 238); assert.equal(zero.ingredientsKnown, false); assert.equal(zero.allergensKnown, false); assert.equal(zero.shoppingKnown, true); assert.equal(zero.nature, 'retort');
  const foreign = {...source('daily-curry-beef'), id:'unmeasured-takeaway-curry', nature:'fast-food', manualNutrition:{kcal:900}};
  const foreignData = {...data, recipes:[foreign]};
  assert.equal(curryRiceFor(foreign.id, foreignData), null);
  assert.throws(() => build(foreign.id, 0, foreignData), /完成品全体/);
  const corrupt = {...source('prepared-retort-keema-curry'), ingredients:[{id:'rice', amount:100}, {id:'retort_keema_curry_model', amount:400}]};
  assert.equal(curryRiceFor(corrupt.id, {...data, recipes:[corrupt]}), null);
});

test('未測定の成分と材料・アレルギーの確認フラグを米量の変更で確定させない', () => {
  const manual = {...source('prepared-retort-vegetable-curry'), manualNutrition:{...source('prepared-retort-vegetable-curry').manualNutrition, fat:null}};
  const db = {...data, recipes:[manual]};
  for (const grams of [0, 150, 180, 300]) {
    const recipe = build(manual.id, grams, db);
    assert.equal(recipe.manualNutrition.fat, null); assert.equal(recipe.allergensKnown, false); assert.equal(recipe.ingredientsKnown, false);
  }
  const missing = {...data, ingredients:{...INGREDIENTS, chicken:{...INGREDIENTS.chicken, allergensKnown:false, nutritionPerUnit:{...INGREDIENTS.chicken.nutritionPerUnit, salt:null}}}};
  const chicken = build('tomato-chicken-curry', 0, missing);
  assert.equal(chicken.manualNutrition.salt, null); assert.equal(chicken.allergensKnown, false);
  assert.equal(itemFromRecipe(chicken, missing).nutrition.salt, null);
  const missingRice = {...data, recipes:[manual], ingredients:{...INGREDIENTS, rice:{...INGREDIENTS.rice, nutritionPerUnit:{...INGREDIENTS.rice.nutritionPerUnit, carbs:null}}}};
  assert.equal(build(manual.id, 150, missingRice).manualNutrition.carbs, null);
  close(build(manual.id, 180, missingRice).manualNutrition.carbs, manual.manualNutrition.carbs);
});

test('料理の米量は皿数と買い物人数で一度ずつ拡大し、在庫を最後に差し引く', () => {
  const recipe = build('daily-curry-beef', 125.5), catalog = withRecipe(recipe);
  const entry = createCatalogEntry({recipeId:recipe.id, date:'2026-11-13', meal:'dinner', status:'planned', amount:1.5}, catalog);
  const list = shoppingForEntries([entry], data, {from:'2026-11-13', to:'2026-11-13', servings:2, pantry:[{id:'rice', amount:100}]});
  const rice = list.items.find(part => part.id === 'rice');
  assert.equal(rice.required, 376.5); assert.equal(rice.stock, 100); assert.equal(rice.buy, 276.5); assert.equal(rice.unit, 'g');
  const zero = build('daily-curry-beef', 0), zeroEntry = createCatalogEntry({recipeId:zero.id, date:'2026-11-13', meal:'dinner', status:'planned', amount:1}, withRecipe(zero));
  assert.ok(!shoppingForEntries([zeroEntry], data, {from:'2026-11-13', to:'2026-11-13', servings:2}).items.some(part => part.id === 'rice'));
});

test('選んだご飯の配合と栄養を保存・読込みし、後の変更から過去の記録を守る', () => {
  for (const id of ['daily-curry-beef', 'prepared-retort-keema-curry']) for (const riceGrams of [0, 150, 1000]) {
    const recipe = build(id, riceGrams), journal = defaultJournal('2026-11-13');
    journal.customRecipes.push(recipe);
    journal.entries.push(createCatalogEntry({recipeId:recipe.id, date:'2026-11-13', meal:'dinner', status:'eaten', amount:1.5}, withRecipe(recipe)));
    const restored = parseJournal(JSON.stringify(journal), data), snapshot = JSON.stringify(restored.entries);
    assert.deepEqual(restored.customRecipes[0].manualNutrition, recipe.manualNutrition);
    assert.deepEqual(restored.entries[0].items[0].ingredients, recipe.ingredients);
    assert.equal(restored.entries[0].items[0].quantity, 1.5);
    buildCurryRiceSelection({id:recipe.id, recipeId:id, riceGrams:75}, data);
    assert.equal(JSON.stringify(restored.entries), snapshot);
  }
});

test('新しい材料既知のカレーと米なしのカレーにも適用し、米の除外では0gを候補にできる', () => {
  const curry = {...source('tomato-chicken-curry'), id:'new-world-curry', ingredients:source('tomato-chicken-curry').ingredients.filter(part => part.id !== 'rice')};
  const db = {...data, recipes:[curry]};
  assert.ok(curryRiceFor(curry.id, db)); assert.equal(parts(build(curry.id, 150, db)).rice, 150);
  assert.ok(!build(curry.id, 0, db).ingredients.some(part => part.id === 'rice'));
  const safe = eligibleCurryRiceSelections('daily-curry-beef', {allergens:[], excludedIngredients:['rice']}, data);
  assert.deepEqual(safe.map(row => row.config.riceGrams), [0]);
  assert.deepEqual(eligibleCurryRiceSelections('daily-curry-beef', {allergens:['beef'], excludedIngredients:[]}, data), []);
});

test('不正な量・料理・設定や完成品全体の変更を拒否する', () => {
  for (const riceGrams of [-1, 1000.1, Infinity, NaN, null, '150', undefined]) assert.throws(() => buildCurryRiceSelection({recipeId:'daily-curry-beef', riceGrams}, data));
  for (const config of [null, [], {}, {recipeId:'daily-curry-beef', riceGrams:150, extra:true}, {recipeId:'daily-curry-beef', riceGrams:150, id:'builtin'}]) assert.throws(() => buildCurryRiceSelection(config, data));
  assert.equal(curryRiceFor('classic-hamburg', data), null); assert.equal(curryRiceFor(null), null); assert.equal(curryRiceFor('unknown'), null);
  assert.throws(() => defaultCurryRiceSelection('unknown'));
  const purchased = {...source('prepared-retort-beef-curry'), id:'other-beef-curry', manualNutrition:{kcal:500}};
  assert.equal(curryRiceFor(purchased.id, {...data, recipes:[purchased]}), null);
});
