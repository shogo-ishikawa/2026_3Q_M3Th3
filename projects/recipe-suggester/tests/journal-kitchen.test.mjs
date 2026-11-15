import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {itemFromRecipe} from '../nutrition.js';
import {defaultJournal, validateJournal, parseJournal, readJournal, writeJournal, JOURNAL_KEY} from '../journal.js';
import {defaultMealPreference} from '../meal-profiles.js';

const data = {allergens:ALLERGENS, ingredients:INGREDIENTS, recipes:RECIPES};
const state = () => defaultJournal('2026-11-15');
const food = () => itemFromRecipe(RECIPES.find(recipe=>recipe.id==='plain-rice'),data,1.25);
const catalog = () => ({id:JSON.stringify(['week-entry','week-item']),item:food(),servings:2,label:'2026-11-16 朝食',date:'2026-11-16',meal:'breakfast',origin:'plan'});
const receipt = () => ({id:'purchase-1',ingredientId:'rice',amount:187.5,purchasedAt:'2026-11-15T03:04:05.000Z',allocations:[{menuId:catalog().id,amount:187.5}]});

test('weekly shopping catalogue and purchase allocations round trip independently of active list',()=>{
  const source=state(),menu=catalog();
  menu.item.nutrition.kcal=123.456789;menu.item.nutrition.salt=null;
  source.shoppingCatalog=[menu];source.shoppingReceipts=[receipt()];source.shoppingList=[];
  const before=structuredClone(source),loaded=parseJournal(JSON.stringify(source),data);
  assert.deepEqual(loaded,before);assert.equal(loaded.shoppingReceipts[0].allocations[0].menuId,menu.id);
  loaded.shoppingCatalog[0].item.nutrition.kcal=999;
  assert.deepEqual(source,before);
});

test('historical receipts survive removed ingredients and menus while old journals gain independent empty lists',()=>{
  const source=state();
  source.shoppingReceipts=[{...receipt(),ingredientId:'removed-rice',allocations:[{menuId:'removed-menu',amount:187.5}],legacy:true,purchasedAt:'1970-01-01T00:00:00.000Z'}];
  assert.deepEqual(validateJournal(source,data),source);
  delete source.shoppingCatalog;delete source.shoppingReceipts;
  const first=validateJournal(source,data),second=validateJournal(source,data);
  assert.deepEqual(first.shoppingCatalog,[]);assert.deepEqual(first.shoppingReceipts,[]);
  first.shoppingCatalog.push(catalog());first.shoppingReceipts.push(receipt());
  assert.deepEqual(second.shoppingCatalog,[]);assert.deepEqual(second.shoppingReceipts,[]);
});

test('old global staple and morning drink migrate into expanded meal settings without adding later drinks',()=>{
  const source=state();
  source.settings.stapleId='plain-rice';source.settings.stapleMode='fixed';source.settings.stapleAmount=170;
  const drink=RECIPES.find(r=>r.role==='drink'&&r.portion?.unit==='ml');assert.ok(drink);
  source.settings.drinkId=drink.id;source.settings.drinkAmount=180;
  source.settings.mealPreferences=Object.fromEntries(['breakfast','lunch','dinner'].map(meal=>[meal,{volume:'light',mood:'時短'}]));
  const loaded=validateJournal(source,data);
  for(const meal of ['breakfast','lunch','dinner']){
    assert.equal(loaded.settings.mealPreferences[meal].staple,'fixed');
    assert.equal(loaded.settings.mealPreferences[meal].stapleId,'plain-rice');
    assert.equal(loaded.settings.mealPreferences[meal].stapleAmount,170);
    assert.equal(loaded.settings.mealPreferences[meal].volume,'light');
  }
  assert.equal(loaded.settings.mealPreferences.breakfast.drinkId,drink.id);
  assert.equal(loaded.settings.mealPreferences.breakfast.drinkAmount,180);
  assert.equal(loaded.settings.mealPreferences.lunch.drinkId,'none');
  assert.equal(loaded.settings.mealPreferences.dinner.drinkId,'none');
  const again=parseJournal(JSON.stringify(loaded),data);assert.deepEqual(again,loaded);
});

test('invalid weekly data, receipt timestamps, allocations and meal references cannot overwrite protected source',()=>{
 const mutations=[
  s=>{s.shoppingCatalog=[catalog(),catalog()];},
  s=>{s.shoppingCatalog=[{...catalog(),id:'x'.repeat(501)}];},
  s=>{s.shoppingCatalog=[{...catalog(),date:'2026-02-30'}];},
  s=>{s.shoppingCatalog=[{...catalog(),meal:'late-night'}];},
  s=>{s.shoppingCatalog=[{...catalog(),origin:'foreign'}];},
  s=>{s.shoppingCatalog=[{...catalog(),servings:0}];},
  s=>{s.shoppingCatalog=[{...catalog(),item:{...food(),quantity:0}}];},
  s=>{s.shoppingReceipts=[receipt(),receipt()];},
  s=>{s.shoppingReceipts=[{...receipt(),amount:0}];},
  s=>{s.shoppingReceipts=[{...receipt(),allocations:[]}];},
  s=>{s.shoppingReceipts=[{...receipt(),purchasedAt:'2026-02-30T00:00:00.000Z'}];},
  s=>{s.shoppingReceipts=[{...receipt(),purchasedAt:'2026-11-15'}];},
  s=>{s.shoppingReceipts=[{...receipt(),allocations:[{menuId:'one',amount:100},{menuId:'two',amount:100}]}];},
  s=>{s.shoppingReceipts=[{...receipt(),allocations:[{menuId:'one',amount:50},{menuId:'one',amount:50}]}];},
  s=>{s.shoppingReceipts=[{...receipt(),allocations:[{menuId:'one',amount:-5}]}];},
  s=>{s.shoppingReceipts=[{...receipt(),legacy:'true'}];},
  s=>{s.settings.mealPreferences.breakfast.staple='fixed';s.settings.mealPreferences.breakfast.stapleId='missing';},
  s=>{s.settings.mealPreferences.lunch.drinkId='plain-rice';},
  s=>{s.settings.mealPreferences.dinner.enabled='false';},
 ];
 for(const mutate of mutations){
   const source=state();mutate(source);const raw=JSON.stringify(source),memory=new Map([[JOURNAL_KEY,raw]]),writes=[];
   const storage={getItem:key=>memory.get(key)??null,setItem:(key,value)=>{writes.push(key);memory.set(key,value);}};
   assert.throws(()=>parseJournal(raw,data));
   assert.deepEqual(readJournal(storage,data).recovery,{key:JOURNAL_KEY,raw});
   assert.equal(writeJournal(storage,state(),data),false);assert.equal(memory.get(JOURNAL_KEY),raw);assert.deepEqual(writes,[]);
 }
});

test('purchase allocation tolerance allows harmless sum roundoff but rejects excess material',()=>{
 const source=state();source.shoppingReceipts=[{...receipt(),amount:.3,allocations:[{menuId:'one',amount:.1},{menuId:'two',amount:.2}]}];
 assert.equal(validateJournal(source,data).shoppingReceipts[0].amount,.3);
 source.shoppingReceipts[0].allocations[1].amount=.201;assert.throws(()=>validateJournal(source,data));
 assert.equal(defaultMealPreference('breakfast').drinkId,'none');
});
