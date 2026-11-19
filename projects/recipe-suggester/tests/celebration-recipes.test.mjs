import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {seasonalIngredientPreference} from '../seasonal-preference.js';
import {CLASSIC_CELEBRATION_RECIPES, CELEBRATION_RECIPES, recipeOccasionIds} from '../celebration-recipes.js';
import {RECIPE_TAG_LABELS} from '../occasion-calendar.js';
import {browseDishes} from '../dish-hierarchy.js';
import {canSuggestAtMeal} from '../meal-suitability.js';
import {describeRecipe, eligibleRecipes} from '../planner.js';
import {itemNutrition, recipeNutrition, NUTRIENT_KEYS} from '../nutrition.js';
import {createCatalogEntry} from '../record-actions.js';
import {shoppingForEntries} from '../shopping.js';
import {defaultJournal, parseJournal} from '../journal.js';

const data = {recipes: RECIPES, ingredients: INGREDIENTS, allergens: ALLERGENS};
const celebrationIds = new Set(CELEBRATION_RECIPES.map(recipe => recipe.id));
const additions = RECIPES.filter(recipe => celebrationIds.has(recipe.id));
const date = '2026-12-25';

test('各行事を名前で検索でき、主菜2品・副菜・汁物を昼食や夕食に選べる', () => {
  assert.equal(CLASSIC_CELEBRATION_RECIPES.length, 12);
  assert.deepEqual(additions.map(item => item.id), CELEBRATION_RECIPES.map(item => item.id));
  assert.deepEqual(recipeOccasionIds({id: 'plain-rice'}), []);
  assert.equal(new Set(RECIPES.map(item => item.name)).size, RECIPES.length);
  for (const [id, term] of [['birthday', '誕生日'], ['christmas', 'クリスマス'], ['new-year', 'お正月']]) {
    const dishes = CLASSIC_CELEBRATION_RECIPES.filter(recipe => recipeOccasionIds(recipe).includes(id));
    assert.deepEqual(dishes.map(recipe => recipe.role).sort(), ['main', 'main', 'side', 'soup']);
    const found = new Set(browseDishes(RECIPES, {query: term}).map(recipe => recipe.id));
    for (const recipe of dishes) {
      assert.ok(found.has(recipe.id), recipe.name);
      assert.ok(canSuggestAtMeal(recipe, 'lunch') && canSuggestAtMeal(recipe, 'dinner'), recipe.name);
      assert.ok(!canSuggestAtMeal(recipe, 'breakfast') && !canSuggestAtMeal(recipe, 'snack'), recipe.name);
      assert.ok(recipe.steps.length >= 4, recipe.name);
      assert.equal(recipe.nature, 'home-cooked');
    }
  }
});

test('行事と季節の各分類で名前から料理を探せ、2人分の配合と作業を区別できる', () => {
  const ids = new Set(additions.map(recipe => recipe.id));
  assert.equal(ids.size, additions.length);
  assert.equal(ids.size, CELEBRATION_RECIPES.length);
  for (const [tag, label] of Object.entries(RECIPE_TAG_LABELS)) {
    const recipes = additions.filter(recipe => recipeOccasionIds(recipe).includes(tag));
    assert.ok(recipes.length >= 4, label);
    const found = new Set(browseDishes(RECIPES, {query: label}).map(recipe => recipe.id));
    for (const recipe of recipes) {
      assert.ok(found.has(recipe.id), label + ' / ' + recipe.name);
      assert.ok(canSuggestAtMeal(recipe, 'lunch') && canSuggestAtMeal(recipe, 'dinner'), recipe.name);
      assert.ok(recipe.steps.length >= 3 && recipe.steps.every(step => step.trim().length >= 8), recipe.name);
      assert.ok(recipe.ingredientsKnown && recipe.allergensKnown && recipe.shoppingKnown, recipe.name);
    }
  }
  const uniqueMethods = new Set(additions.map(recipe => recipe.steps.join('\n')));
  assert.equal(uniqueMethods.size, additions.length);
});

test('使用する全材料から6成分とアレルゲンを求め、通常の除外設定を尊重する', () => {
  const catalogue = {...data, recipes: additions};
  for (const recipe of additions) {
    assert.equal(recipe.servings, 2);
    assert.equal(new Set(recipe.ingredients.map(part => part.id)).size, recipe.ingredients.length);
    const totals = recipeNutrition(recipe, data);
    for (const key of NUTRIENT_KEYS) {
      const calculated = recipe.ingredients.reduce((sum, {id, amount}) => {
        assert.ok(Number.isFinite(amount) && amount > 0 && Number.isFinite(INGREDIENTS[id].nutritionPerUnit[key]));
        return sum + amount * INGREDIENTS[id].nutritionPerUnit[key];
      }, 0) / recipe.servings;
      assert.ok(Math.abs(totals[key] - calculated) < 1e-8, `${recipe.name} / ${key}`);
    }
    const metadata = describeRecipe(recipe.id, catalogue);
    for (const allergen of metadata.allergens) {
      assert.ok(!eligibleRecipes({allergens: [allergen]}, catalogue).some(dish => dish.id === recipe.id));
    }
    const first = recipe.ingredients[0].id;
    assert.ok(!eligibleRecipes({excludedIngredients: [first]}, catalogue).some(dish => dish.id === recipe.id));
  }
  for (const [id, allergens] of [
    ['birthday-pear-walnut-salad', ['walnut']], ['birthday-scallop-coquille', ['milk', 'wheat']],
    ['new-year-shrimp-lotus', ['shrimp', 'soy', 'wheat']], ['new-year-matsukaze', ['egg', 'sesame', 'chicken']],
  ]) {
    const dish = describeRecipe('celebration-' + id, catalogue);
    for (const allergen of allergens) assert.ok(dish.allergens.includes(allergen), dish.name);
  }
});

test('祝い膳の料理を1人分記録し、3人分の買い物と当時の栄養・手順を復元する', () => {
  const journal = defaultJournal(date);
  for (const recipe of additions) {
    const entry = createCatalogEntry({recipeId: recipe.id, date, meal: 'dinner', status: 'planned', amount: 1}, data);
    const shopping = shoppingForEntries([entry], data, {from: date, to: date, servings: 3, pantry: []});
    const main = recipe.ingredients[0];
    assert.equal(shopping.items.find(item => item.id === main.id).required, main.amount / 2 * 3);
    assert.deepEqual(itemNutrition(entry.items[0]), recipeNutrition(recipe, data));
    journal.entries.push(entry);
  }
  const restored = parseJournal(JSON.stringify(journal), data);
  assert.deepEqual(restored.entries, journal.entries);
});


test('春夏秋冬の切り替わりを献立日で判定し、実際の材料だけに一度の加点を行う', () => {
  const summerDish = {servings: 2, ingredients: [{id: 'tomato', amount: 70}, {id: 'cucumber', amount: 50}]};
  const expected = [
    ['02-28', 'chinese_cabbage', '冬が旬の白菜'], ['03-01', 'asparagus', '春が旬のアスパラガス'],
    ['05-31', 'bamboo_shoot_cooked', '春が旬のたけのこ'], ['06-01', 'tomato', '夏が旬のトマト'],
    ['08-31', 'horse_mackerel', '夏が旬のあじ'], ['09-01', 'sweet_potato', '秋が旬のさつまいも'],
    ['11-30', 'shiitake', '秋が旬のしいたけ'], ['12-01', 'yellowtail', '冬が旬のぶり'], ['01-01', 'daikon', '冬が旬の大根'],
  ];
  for (const [day, id, reason] of expected) {
    const dish = {servings: 2, ingredients: [{id, amount: 20}]};
    assert.equal(INGREDIENTS[id].unit, 'g');
    assert.deepEqual(seasonalIngredientPreference(dish, '2026-' + day), {score: 3, reason: reason + 'を使った料理'});
  }
  assert.deepEqual(seasonalIngredientPreference(summerDish, '2026-07-21'), {score: 3, reason: '夏が旬のトマトを使った料理'});
  assert.equal(seasonalIngredientPreference(summerDish, '2026-02-28'), null);
  const pantry = {name: 'トマトときゅうり', servings: 2, ingredients: [{id: 'canned_tomato', amount: 200}, {id: 'cucumber', amount: 5}]};
  assert.equal(seasonalIngredientPreference(pantry, '2026-07-21'), null);
});
