import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EVENING_MAINS} from '../evening-mains.js';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {itemFromRecipe, NUTRIENT_KEYS, recipeNutrition} from '../nutrition.js';
import {dishClassification} from '../dish-hierarchy.js';

const data = {ingredients: INGREDIENTS, allergens: ALLERGENS};
const recipe = slug => EVENING_MAINS.find(item => item.id === `evening-main-${slug}`);

test('晩酌主菜の料理名、食材、資料は既存の料理と照合できる', () => {
  const oldNames = new Set(RECIPES.filter(item => !item.id.startsWith('evening-main-')).map(item => item.name));
  const sources = readFileSync(new URL('../docs/evening-mains.md', import.meta.url), 'utf8');
  assert.equal(EVENING_MAINS.length, 12);
  assert.equal(new Set(EVENING_MAINS.map(item => item.name)).size, EVENING_MAINS.length);
  for (const item of EVENING_MAINS) {
    assert.ok(!oldNames.has(item.name), item.name);
    assert.equal(item.role, 'main');
    assert.equal(item.staple, false);
    assert.equal(item.servings, 2);
    assert.ok(item.tags.includes('晩酌'));
    assert.equal(item.tags.includes('時短'), item.minutes <= 20);
    assert.equal(dishClassification(item).method, item.displayMethod);
    assert.equal(dishClassification(item).category, item.displayCategory);
    const reference = item.sourceNote.match(/https:\/\/\S+/)[0];
    assert.ok(sources.includes(reference), item.name);
    for (const part of item.ingredients) {
      assert.ok(Object.hasOwn(INGREDIENTS, part.id), part.id);
      assert.ok(Number.isFinite(part.amount) && part.amount > 0, part.id);
    }
    const nutrition = recipeNutrition(item, data);
    for (const key of NUTRIENT_KEYS) assert.ok(Number.isFinite(nutrition[key]) && nutrition[key] >= 0, item.name);
  }
});

test('主菜の日常使い、取り分け鍋、晩酌の小串を個別に区分する', () => {
  assert.deepEqual(recipe('tuna-negi-nabe').mealSuitability, ['dinner']);
  assert.deepEqual(recipe('pork-onion-kushikatsu').mealSuitability, []);
  const sharedMeals = EVENING_MAINS.filter(item => item.mealSuitability.includes('lunch'));
  assert.equal(sharedMeals.length, 10);
  for (const item of sharedMeals) assert.deepEqual(item.mealSuitability, ['lunch', 'dinner']);
});

test('加工調味料や衣を含めたアレルゲンを記録し、かつお節と切り身を区別する', () => {
  const allergens = slug => new Set(itemFromRecipe(recipe(slug), data).allergens);
  assert.deepEqual(allergens('pork-onion-kushikatsu'), new Set(['pork', 'wheat', 'egg', 'milk', 'soy', 'apple']));
  assert.deepEqual(allergens('ika-poppo'), new Set(['squid', 'soy', 'wheat']));
  assert.deepEqual(allergens('goya-chanpuru'), new Set(['soy', 'pork', 'egg']));
  assert.ok(recipe('katsuo-tatsuta').ingredients.some(part => part.id === 'bonito_sashimi'));
  assert.ok(recipe('goya-chanpuru').ingredients.some(part => part.id === 'bonito'));
});
