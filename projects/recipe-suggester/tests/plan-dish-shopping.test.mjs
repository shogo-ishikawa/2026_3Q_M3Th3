import test from 'node:test';
import assert from 'node:assert/strict';
import {draftDishShoppingContext, mergeShoppingSelections, shoppingMenuContext, shoppingMenusFromEntries} from '../shopping-workflow.js';
import {createShoppingReceipt, pendingShopping} from '../shopping-status.js';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {defaultJournal, parseJournal} from '../journal.js';
import {itemFromRecipe} from '../nutrition.js';

const data = {ingredients: {rice:{name:'ご飯',unit:'g'}, chicken:{name:'鶏肉',unit:'g'}}};
const date = '2026-11-19';
const part = (recipeId, id, amount, quantity = 1) => ({
  id, recipeId, name:recipeId, quantity, ingredientsKnown:true, ingredients:[{id:recipeId,amount}]
});
const entry = (id, date, meal, items, shoppingServings) => ({id,date,meal,items,shoppingServings,status:'planned'});

function stateWithDraft() {
  const entries = [
    entry('breakfast',date,'breakfast',[part('rice','breakfast-rice',100)],1),
    entry('dinner',date,'dinner',[part('rice','dinner-rice',100,1.5),part('chicken','dinner-main',80)],3),
    entry('tomorrow','2026-11-20','dinner',[part('rice','tomorrow-rice',100)],2),
  ];
  const catalog = shoppingMenusFromEntries(entries, data, {from:date,to:'2026-11-20',servings:2});
  return {entries:[],settings:{startDate:date},shoppingCatalog:catalog.map(menu=>({...menu,origin:'plan'})),
    shoppingExtras:[],shoppingList:null,pantry:[{id:'rice',amount:180}],shoppingReceipts:[]};
}

test('one planned dish uses the selected date, meal, portion and diners without activating the whole week', () => {
  const state = stateWithDraft();
  const {menu,catalog} = draftDishShoppingContext(state,data,date,'dinner','rice');
  assert.deepEqual([menu.item.id,menu.date,menu.meal,menu.servings,menu.item.quantity],
    ['dinner-rice',date,'dinner',3,1.5]);
  assert.equal(menu.id, JSON.stringify(['dinner','dinner-rice']));
  assert.equal(catalog.length,0);
  const selected = {...menu,ingredientIds:['rice']};
  state.shoppingList = mergeShoppingSelections(null,[selected],{single:true});
  const kitchen = shoppingMenuContext(state,data,{source:'draft',from:date,to:date});
  const result = pendingShopping(kitchen.prepared,data,{catalog:kitchen.catalog,pantry:state.pantry});
  assert.deepEqual(result.items.map(row=>[row.id,row.required,row.buy]), [['rice',450,270]]);
  assert.equal(kitchen.prepared.length,1);
  assert.equal(draftDishShoppingContext(state,data,date,'dinner','absent').menu, undefined);
  assert.equal(draftDishShoppingContext(state,data,'2026-11-20','dinner','rice').menu.item.id,'tomorrow-rice');
});

for (const origin of ['draft','calendar']) test(`${origin}: unrelated rice order keeps its stock after a single recipe import and a journal reload`, () => {
  const builtins = {recipes:RECIPES, ingredients:INGREDIENTS, allergens:ALLERGENS};
  const rice = RECIPES.find(row=>row.id === 'plain-rice');
  const chicken = RECIPES.find(row=>row.id === 'chicken-teriyaki');
  const state = defaultJournal(date);
  state.pantry = [{id:'rice', amount:100}];
  const old = {id:'old-rice',origin:'menu',servings:1,item:itemFromRecipe(rice,builtins),ingredientIds:['rice']};
  state.shoppingList = [old];
  const itemA = itemFromRecipe(rice,builtins), itemB = itemFromRecipe(chicken,builtins);
  const proposed = entry('proposal',date,'dinner',[itemA,itemB],1);
  proposed.note = '';
  if(origin === 'calendar')state.entries = [proposed];
  else state.shoppingCatalog = shoppingMenusFromEntries([proposed],builtins,{from:date,to:date,servings:1}).map(menu=>({...menu,origin:'plan'}));
  const review = shoppingMenuContext(state,builtins,{source:origin,from:date,to:date});
  const cur = review.menus.find(menu=>menu.item.recipeId === chicken.id);
  const target = {...cur,ingredientIds:['chicken']};
  state.shoppingList = mergeShoppingSelections(state.shoppingList,[target],{single:true});
  const restored = parseJournal(JSON.stringify(state),builtins);
  function riceInList(state) {
    const {prepared,catalog} = shoppingMenuContext(state,builtins,{source:'menu',from:date,to:date});
    return pendingShopping(prepared,builtins,{pantry:state.pantry,catalog}).items.find(row=>row.id==='rice');
  }
  assert.equal(riceInList(restored).buy,50);
  assert.equal(restored.shoppingList[1].stockScope,'selected');
  restored.shoppingList = mergeShoppingSelections(restored.shoppingList,[target],{single:true});
  assert.equal(restored.shoppingList.length,2);
  // 一括取込に切り替えると、従来と同じ週全体の予約を適用。次の個別クリックは降格させない。
  restored.shoppingList = mergeShoppingSelections(restored.shoppingList,[target]);
  assert.equal(restored.shoppingList[1].stockScope,undefined);
  assert.equal(riceInList(restored).buy,150);
  restored.shoppingList = mergeShoppingSelections(restored.shoppingList,[target],{single:true});
  assert.equal(restored.shoppingList[1].stockScope,undefined);
});

test('a partially selected plated dish does not reserve omitted rice or displace an older order', () => {
  const state = stateWithDraft();
  const item = {...part('plate','plate-id',0), ingredients:[{id:'rice',amount:150},{id:'chicken',amount:80}]};
  const [dish] = shoppingMenusFromEntries([entry('plate',date,'dinner',[item],1)],data,{from:date,to:date,servings:1});
  state.shoppingCatalog.push({...dish,origin:'plan'});
  const prior = {id:'old',origin:'menu',servings:1,item:part('rice','old-rice',150),ingredientIds:['rice']};
  state.pantry = [{id:'rice',amount:100}];
  state.shoppingList = mergeShoppingSelections([prior],[{...dish,origin:'plan',ingredientIds:['chicken']}],{single:true});
  const {prepared,catalog} = shoppingMenuContext(state,data,{source:'draft',from:date,to:date});
  assert.deepEqual(pendingShopping(prepared,data,{catalog,pantry:state.pantry}).items
    .map(row=>[row.id,row.buy]).sort(),[['chicken',80],['rice',50]]);
});

test('an unconfirmed menu candidate does not reserve stock on its own before or after an individual import', () => {
  const state = stateWithDraft();
  state.pantry = [{id:'rice',amount:100}];
  state.shoppingExtras = [{id:'extra',item:part('rice','unused',100),servings:1}];
  const {menu,catalog} = draftDishShoppingContext(state,data,date,'breakfast','rice');
  const selected = {...menu,ingredientIds:['rice']};
  assert.equal(pendingShopping([selected], data, {pantry:state.pantry,catalog}).items[0].buy,0);
  state.shoppingList = mergeShoppingSelections(null,[selected],{single:true});
  const current = shoppingMenuContext(state,data,{source:'menu',from:date,to:date});
  assert.equal(pendingShopping(current.prepared,data,{pantry:state.pantry,catalog:current.catalog}).items[0].buy,0);
  assert.ok(current.menus.some(menu=>menu.id==='extra'));
});

test('repeating the direct or bulk import shares the order ID, receipts and the other selected meals', () => {
  const state = stateWithDraft();
  const rice = draftDishShoppingContext(state,data,date,'dinner','rice').menu;
  const chicken = draftDishShoppingContext(state,data,date,'dinner','chicken').menu;
  const selections = [rice,chicken].map(menu=>({...menu, ingredientIds:[menu.item.recipeId]}));
  state.shoppingList = mergeShoppingSelections(null, selections.slice(0,1));
  const original = structuredClone(state.shoppingList);
  const kitchen = shoppingMenuContext(state,data,{source:'draft',from:date,to:date});
  const options = {catalog:kitchen.catalog,pantry:state.pantry};
  const receipt = createShoppingReceipt(state.shoppingList,'rice',data,{...options,id:'rice-purchase',now:date});
  state.shoppingList = mergeShoppingSelections(state.shoppingList,selections);
  state.shoppingList = mergeShoppingSelections(state.shoppingList,selections.slice(0,1));
  assert.deepEqual(state.shoppingList[0],original[0]);
  assert.equal(state.shoppingList.length,2);
  assert.deepEqual(pendingShopping(state.shoppingList,data,{...options,receipts:[receipt]}).items.map(row=>[row.id,row.buy]).sort(),
    [['chicken',240],['rice',0]]);
});
