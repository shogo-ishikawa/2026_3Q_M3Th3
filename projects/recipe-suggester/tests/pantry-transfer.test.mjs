import test from 'node:test';
import assert from 'node:assert/strict';
import {INGREDIENTS, ALLERGENS, RECIPES} from '../data.js';
import {defaultJournal, validateJournal, parseJournal, writeJournal, JOURNAL_KEY} from '../journal.js';
import {createJournalHistory} from '../journal-history.js';
import {itemFromRecipe} from '../nutrition.js';
import {stockReceipt, cancelReceipt, mealPantryUse, changeMealStatus} from '../pantry-transfer.js';
import {shoppingMenusFromEntries, shoppingMenuContext, discardRemovedCookedMenus} from '../shopping-workflow.js';
import {createShoppingReceipt, pendingShopping} from '../shopping-status.js';
import {createMealSet} from '../meal-sets.js';

const data = {ingredients:INGREDIENTS, allergens:ALLERGENS, recipes:RECIPES};
const date = '2026-11-19';
const range = {from:date,to:date,servings:1};
function fixture() {
  const state = defaultJournal(date), recipe = RECIPES.find(row=>row.id==='plain-rice');
  for (const id of ['first','second']) {
    const item = itemFromRecipe(recipe,data);
    item.id=id+'-item';
    const entry={id,date,meal:id==='first'?'lunch':'dinner',status:'planned',note:'',items:[item],shoppingServings:1};
    state.entries.push(entry);
  }
  state.shoppingCatalog=shoppingMenusFromEntries(state.entries,data,range).map(menu=>({...menu,origin:'plan'}));
  state.shoppingList=state.shoppingCatalog.map(menu=>({...menu,ingredientIds:['rice']}));
  return state;
}
const need = state => {
  const context=shoppingMenuContext(state,data,{...range,source:'draft'});
  return pendingShopping(context.prepared,data,{catalog:context.catalog,pantry:state.pantry,receipts:state.shoppingReceipts}).items[0];
};
function purchase(state, index) {
  const receipt=createShoppingReceipt([state.shoppingList[index]],'rice',data,{id:'bought-'+index,
    pantry:state.pantry,receipts:state.shoppingReceipts,catalog:state.shoppingCatalog,now:date});
  state.shoppingReceipts.push(receipt);
  return receipt;
}
test('transfer keeps split shopping reservations, material units, and a persistent one-time receipt',()=>{
  const state=fixture(),receipt=purchase(state,1),pending=need(state);
  assert.equal(pending.buy,receipt.amount);
  stockReceipt(state,receipt.id,data);
  assert.deepEqual(state.pantry,[{id:'rice',amount:receipt.amount}]);
  assert.equal(need(state).buy,pending.buy);
  assert.equal(need(state).sources[1].purchased,receipt.amount);
  const reloaded=parseJournal(JSON.stringify(state),data);
  assert.throws(()=>stockReceipt(reloaded,receipt.id,data));
  cancelReceipt(reloaded,receipt.id);
  assert.equal(reloaded.pantry[0].amount,0);
  assert.equal(need(reloaded).buy,2*receipt.amount);
});
test('planned to eaten with pantry usage removes the cooked meal from buying and reverses exactly after reload',()=>{
  const state=fixture(),receipt=purchase(state,1);
  stockReceipt(state,receipt.id,data);
  const original=structuredClone(state);
  changeMealStatus(state,'second','planned',{usePantry:true,servings:1});
  assert.equal(state.pantry[0].amount,0);
  assert.equal(state.entries[1].status,'eaten');
  assert.deepEqual(state.entries[1].pantryUse,original.pantry);
  const history=createJournalHistory(); history.record(original,state);
  assert.deepEqual(history.undo(state,{validate:value=>validateJournal(value,data)}),original);
  const repeated=createMealSet({name:'定番',entries:[state.entries[1]]},data);
  assert.equal(repeated.items.length,1);
  const loaded=parseJournal(JSON.stringify(state),data);
  assert.throws(()=>changeMealStatus(loaded,'second','planned',{usePantry:true}));
  assert.throws(()=>cancelReceipt(loaded,receipt.id));
  assert.equal(need(loaded).sources.length,1);
  assert.equal(need(loaded).buy,receipt.amount);
  changeMealStatus(loaded,'second','eaten');
  assert.deepEqual(loaded,original);
});
test('consumption uses frozen per-item quantity, the requested diners and physical stock only',()=>{
  const state=fixture(),entry=state.entries[0],item=entry.items[0];
  item.ingredients=[{id:'rice',amount:15},{id:'rice',amount:25},{id:'stock_kombu_strained',amount:1}];
  item.quantity=1.5;
  state.pantry=[{id:'rice',amount:200},{id:'kombu',amount:2},{id:'stock_kombu_strained',amount:4}];
  entry.items.push({...item,id:'unknown',ingredientsKnown:false,shoppingKnown:false},
    {...item,id:'dining',diningMatch:{}},{...item,id:'batch',batchId:'batch-x'},{...item,id:'restaurant',restaurant:{}});
  assert.deepEqual(mealPantryUse(state,entry,3),[{id:'rice',amount:180},{id:'kombu',amount:2},{id:'stock_kombu_strained',amount:2.5}]);
  assert.throws(()=>mealPantryUse(state,entry,9));
  changeMealStatus(state,entry.id,'planned',{usePantry:true,servings:8});
  assert.ok(state.pantry.every(part=>part.amount===0));
  changeMealStatus(state,entry.id,'eaten');
  assert.deepEqual(state.pantry,[{id:'rice',amount:200},{id:'kombu',amount:2},{id:'stock_kombu_strained',amount:4}]);
  changeMealStatus(state,entry.id,'planned');
  assert.equal(entry.pantryUse,undefined);
  assert.equal(state.pantry[0].amount,200);
});
test('a purchase not entered into pantry covers only its designated dish',()=>{
  const state=fixture(), receipt=purchase(state,1);
  state.pantry.push({id:'rice',amount:receipt.amount});
  assert.deepEqual(mealPantryUse(state,state.entries[1],1),[]);
  assert.deepEqual(mealPantryUse(state,state.entries[0],1),state.pantry);
  changeMealStatus(state,'second','planned');
  assert.throws(()=>stockReceipt(state,receipt.id,data),/食べた料理/);
  assert.equal(state.pantry[0].amount,receipt.amount);
});
test('removing a cooked record drops only its old purchasing snapshots and retains receipt history',()=>{
  const state=fixture(),receipt=purchase(state,1);
  stockReceipt(state,receipt.id,data);
  changeMealStatus(state,'second','planned',{usePantry:true});
  const next=structuredClone(state);next.entries.pop();discardRemovedCookedMenus(state,next);
  assert.deepEqual(next.shoppingList.map(menu=>menu.item.id),['first-item']);
  assert.deepEqual(next.shoppingCatalog.map(menu=>menu.item.id),['first-item']);
  assert.deepEqual(next.shoppingReceipts,state.shoppingReceipts);
  assert.deepEqual(validateJournal(next,data),next);
});
test('invalid transfer markers are protected and unlinked old records remain untouched',()=>{
  const source=fixture(), raw=JSON.stringify(source);
  assert.deepEqual(parseJournal(raw,data),source);
  for(const mutate of [s=>s.entries[0].pantryUse=[{id:'rice',amount:10}],s=>{s.entries[0].status='eaten';s.entries[0].pantryUse=[{id:'unknown',amount:1}];},
    s=>{purchase(s,1).stocked='yes';}]) {
    const broken=structuredClone(source);mutate(broken);const saved=JSON.stringify(broken);
    const memory=new Map([[JOURNAL_KEY,saved]]);
    assert.equal(writeJournal({getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)},source,data),false);
    assert.equal(memory.get(JOURNAL_KEY),saved);
  }
});
