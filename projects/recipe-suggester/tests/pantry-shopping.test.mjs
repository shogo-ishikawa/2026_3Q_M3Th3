import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {defaultJournal, parseJournal} from '../journal.js';
import {itemFromRecipe} from '../nutrition.js';
import {pantryRecipeOptions} from '../pantry-availability.js';
import {mergeShoppingSelections, missingShoppingSelection, retireMenuShopping, shoppingMenuContext} from '../shopping-workflow.js';
import {createShoppingReceipt, isCompletedMenuPurchase, pendingShopping} from '../shopping-status.js';

const data = {allergens: ALLERGENS, ingredients: INGREDIENTS, recipes: RECIPES};
const day = '2026-11-19';
const recipe = RECIPES.find(row => row.id === 'chicken-teriyaki');
const freshItem = () => itemFromRecipe(recipe, data);
const catalogData = {...data, recipes: [recipe]};

function scenario() {
  const state = defaultJournal(day);
  state.settings.shoppingOmittedIds = recipe.ingredients.map(part => part.id).filter(id => id !== 'chicken');
  state.pantry = [{id:'chicken', amount:80}];
  return state;
}

function checklist(state) {
  const {prepared, catalog} = shoppingMenuContext(state, data, {source:'menu', from:day, to:day});
  return pendingShopping(prepared, data, {catalog, pantry:state.pantry, receipts:state.shoppingReceipts,
    omittedIds:state.settings.shoppingOmittedIds}).items;
}

test('selected servings, partial stock and the saved recipe produce precisely the displayed shortfall', () => {
  const state = scenario();
  const [option] = pantryRecipeOptions(catalogData, state.settings, state.pantry, 2);
  assert.deepEqual(option.missing.map(row => [row.id, row.missing]), [['chicken', 220]]);
  const menu = missingShoppingSelection(state, freshItem(), 2, option.missing.map(row => row.id));
  assert.deepEqual(menu.ingredientIds, ['chicken']);
  assert.equal(menu.item.ingredients.find(row => row.id === 'chicken').amount, 150);
  state.shoppingList = mergeShoppingSelections(state.shoppingList, [menu]);
  const restored = parseJournal(JSON.stringify(state), data);
  assert.deepEqual(checklist(restored).map(row => [row.id, row.buy]), [['chicken', 220]]);
  assert.equal(missingShoppingSelection(restored, freshItem(), 2, ['chicken']), null);
  assert.deepEqual(restored.pantry, [{id:'chicken', amount:80}]);
  assert.equal(restored.shoppingExtras.length, 0);
});

test('same dish already in the review list or partially selected reuses one order and its receipt', () => {
  const state = scenario();
  state.settings.shoppingOmittedIds = [];
  const item = freshItem();
  state.shoppingExtras.push({id:'review-row', item, servings:2});
  state.shoppingList = [{id:'review-row', origin:'menu', item, servings:2, ingredientIds:['mirin']}];
  const menu = missingShoppingSelection(state, freshItem(), 2, ['chicken']);
  assert.equal(menu.id, 'review-row');
  state.shoppingList = mergeShoppingSelections(state.shoppingList, [menu]);
  assert.deepEqual(state.shoppingList.map(row => row.ingredientIds), [['mirin','chicken']]);
  state.shoppingReceipts.push(createShoppingReceipt(state.shoppingList, 'chicken', data,
    {id:'receipt', pantry:state.pantry, now:day}));
  assert.equal(missingShoppingSelection(state, freshItem(), 2, ['chicken']), null);
  assert.equal(checklist(state).find(row => row.id === 'chicken').buy, 0);
  assert.notEqual(missingShoppingSelection(state, freshItem(), 3, ['chicken']).id, menu.id);
});

test('separate dishes share aggregate stock once and preserve a prepared calendar order', () => {
  const state = scenario();
  const first = freshItem();
  state.shoppingList = [{id:'other-order', origin:'calendar', item:first, servings:1, ingredientIds:['chicken']}];
  const menu = missingShoppingSelection(state, freshItem(), 2, ['chicken']);
  state.shoppingList = mergeShoppingSelections(state.shoppingList, [menu]);
  assert.equal(state.shoppingList.length, 2);
  assert.equal(checklist(state).find(row => row.id === 'chicken').buy, 150 + 300 - 80);
});

test('strained stock selects original recipe IDs and deducts the purchase ingredient once', () => {
  const state = scenario();
  state.settings.shoppingOmittedIds = [];
  state.pantry = [{id:'kombu', amount:1}, {id:'stock_kombu_strained', amount:0.5}];
  const soup = RECIPES.find(row => row.id === 'udon-egg');
  const menu = missingShoppingSelection(state, itemFromRecipe(soup, data), 2, ['kombu']);
  assert.deepEqual(menu.ingredientIds, ['stock_kombu_strained']);
  state.shoppingList = mergeShoppingSelections(state.shoppingList, [menu]);
  assert.deepEqual(checklist(state).map(row => [row.id, row.buy]), [['kombu', 2.5]]);
});

test('a confirmed new purchase retires its predecessor without charging its stock or losing its receipt', () => {
  const state = scenario();
  const old = missingShoppingSelection(state, freshItem(), 2, ['chicken']);
  state.shoppingList = [old];
  state.shoppingExtras = [{id:old.id, item:old.item, servings:2}];
  const receipt = createShoppingReceipt(state.shoppingList, 'chicken', data, {id:'old-purchase', pantry:state.pantry, now:'2026-11-01'});
  const options = () => ({pantry:state.pantry, receipts:state.shoppingReceipts,
    catalog:shoppingMenuContext(state, data, {source:'menu',from:day,to:day}).catalog});
  assert.equal(isCompletedMenuPurchase(old.id, ['chicken'], state.shoppingList, data, options()), false);
  state.shoppingReceipts = [receipt];
  assert.equal(isCompletedMenuPurchase(old.id, ['chicken'], state.shoppingList, data, options()), true);
  const newMenu = missingShoppingSelection(state, freshItem(), 2, ['chicken'], {newOrder:true});
  assert.notEqual(newMenu.id, old.id);
  retireMenuShopping(state, old.id);
  state.shoppingList = mergeShoppingSelections(state.shoppingList, [newMenu]);
  const restored = parseJournal(JSON.stringify(state), data);
  const context = shoppingMenuContext(restored, data, {source:'menu',from:day,to:day});
  assert.deepEqual(context.prepared.map(menu=>menu.id), [newMenu.id]);
  assert.equal(context.catalog.some(menu => menu.id === old.id), false);
  assert.deepEqual(checklist(restored).map(row=>[row.id, row.buy]), [['chicken',220]]);
  assert.deepEqual(restored.shoppingReceipts, [receipt]);
  assert.equal(restored.shoppingList.find(menu=>menu.id === old.id).item.name, recipe.name);
  assert.equal(missingShoppingSelection(restored, freshItem(), 2, ['chicken']), null);
  assert.equal(isCompletedMenuPurchase(newMenu.id, ['chicken'], context.prepared, data, options()), false);
});

test('prior purchase with a revived shortfall after stock use keeps the current order', () => {
  const state = scenario();
  const menu = missingShoppingSelection(state, freshItem(), 2, ['chicken']);
  state.shoppingList = [menu];
  const receipt = createShoppingReceipt([menu], 'chicken', data, {id:'stocked', pantry:state.pantry, now:day});
  state.shoppingReceipts = [{...receipt, stocked:true}];
  state.pantry = [{id:'chicken', amount:115}];
  assert.equal(isCompletedMenuPurchase(menu.id, ['chicken'], [menu], data, {pantry:state.pantry, receipts:state.shoppingReceipts}), false);
  assert.equal(missingShoppingSelection(state, freshItem(), 2, ['chicken']), null);
  assert.equal(checklist(state)[0].buy, 185);
});
