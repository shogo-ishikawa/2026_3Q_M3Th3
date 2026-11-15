import test from 'node:test';
import assert from 'node:assert/strict';
import {pendingShopping, createShoppingReceipt, shoppingMenuStatuses, menuShoppingStatus, visibleReceipts, migrateLegacyReceipts, undoReceipt} from '../shopping-status.js';

const data = {ingredients:{onion:{name:'玉ねぎ',unit:'g'},chicken:{name:'鶏肉',unit:'g'},salt:{name:'塩',unit:'g'}}};
const menu = (id, parts, more = {}) => ({id,servings:1,item:{id:`item-${id}`,name:`料理${id}`,quantity:1,
  ingredientsKnown:true,ingredients:parts.map(([id,amount])=>({id,amount})),...more},ingredientIds:parts.map(([id])=>id)});
const on = (items, id) => items.find(item=>item.id===id);
const receipt = (menus, ingredientId, receipts = [], extra = {}) => createShoppingReceipt(menus, ingredientId, data,
  {receipts,id:`receipt-${receipts.length}-${ingredientId}`,now:'2026-11-15T01:00:00.000Z',...extra});

test('first three days and overlapping later import retain recipe-specific purchase coverage',()=>{
  const week = Array.from({length:7},(_,i)=>menu(`day${i+1}`,[['onion',100],['chicken',150]]));
  const first = week.slice(0,3), bought = [receipt(first,'onion',[],{catalog:week})];
  const after = pendingShopping(week.slice(2,5),data,{catalog:week,receipts:bought});
  assert.equal(on(after.items,'onion').required,300);
  assert.equal(on(after.items,'onion').purchased,100);
  assert.equal(on(after.items,'onion').buy,200);
  assert.deepEqual(on(after.items,'onion').sources.map(s=>[s.menuId,s.purchased,s.buy]),[
    ['day3',100,0],['day4',0,100],['day5',0,100],
  ]);
  const second = receipt(week.slice(2,5),'onion',bought,{catalog:week});
  assert.equal(second.amount,200);
  assert.deepEqual(second.allocations,[{menuId:'day4',amount:100},{menuId:'day5',amount:100}]);
  assert.equal(on(pendingShopping(first,data,{catalog:week,receipts:[...bought,second]}).items,'onion').buy,0);
  assert.equal(on(pendingShopping(week.slice(5),data,{catalog:week,receipts:[...bought,second]}).items,'onion').buy,200);
});

test('pantry is allocated once across whole weekly catalogue even for out-of-order batches',()=>{
  const week = [menu('a',[['onion',100]]),menu('b',[['onion',100]]),menu('c',[['onion',100]])];
  const pantry = [{id:'onion',amount:120}];
  assert.equal(on(pendingShopping([week[1]],data,{catalog:week,pantry}).items,'onion').buy,80);
  const first = receipt([week[1]],'onion',[],{catalog:week,pantry});
  assert.equal(first.amount,80);assert.deepEqual(first.allocations,[{menuId:'b',amount:80}]);
  const third = pendingShopping([week[2]],data,{catalog:week,pantry,receipts:[first]});
  assert.equal(on(third.items,'onion').buy,100);
  const statuses = shoppingMenuStatuses(week,data,{pantry,receipts:[first]});
  assert.deepEqual(statuses.map(x=>x.status),['stock','ready','unpurchased']);
  assert.equal(menuShoppingStatus(week[2],data,{catalog:week,pantry,receipts:[first]}).status,'unpurchased');
});

test('same ingredient in two recipes aggregates once and each allocation keeps its exact quantity',()=>{
  const selected = [menu('a',[['onion',35],['onion',15]],{quantity:1.5}), menu('b',[['onion',50]])];
  selected[0].ingredientIds=['onion'];selected[0].servings=2;
  const before = structuredClone(selected), created = receipt(selected,'onion');
  assert.equal(created.amount,200);
  assert.deepEqual(created.allocations,[{menuId:'a',amount:150},{menuId:'b',amount:50}]);
  const result = pendingShopping(selected,data,{receipts:[created]});
  assert.equal(on(result.items,'onion').buy,0);assert.equal(on(result.items,'onion').purchased,200);
  assert.deepEqual(selected,before);
  assert.throws(()=>receipt(selected,'onion',[created]),/未購入分/);
});

test('recipe status remains partial when another ingredient was deliberately not imported',()=>{
  const full = menu('a',[['onion',100],['chicken',150]]), imported = {...full,ingredientIds:['onion']};
  const bought = receipt([imported],'onion');
  const status = menuShoppingStatus(full,data,{receipts:[bought]});
  assert.equal(status.status,'partial');assert.equal(status.purchasedIngredients,1);assert.equal(status.remainingIngredients,1);
  assert.equal(menuShoppingStatus(imported,data,{receipts:[bought]}).unselectedIngredients,1);
  assert.equal(menuShoppingStatus(imported,data,{receipts:[bought]}).status,'partial');
  const other = menu('other',[['onion',100]]);
  assert.equal(menuShoppingStatus(other,data,{receipts:[bought]}).status,'unpurchased');
});

test('unknown materials, omitted seasonings, stock and restaurant meals do not become false purchased claims',()=>{
  const menus = [menu('known',[['onion',100],['salt',1]]),menu('unknown',[['deleted',20]]),
    menu('unchecked',[['onion',20]],{ingredientsKnown:false}),menu('restaurant',[['chicken',150]],{restaurant:{name:'店'}})];
  const states = shoppingMenuStatuses(menus,data,{pantry:[{id:'onion',amount:100}],omittedIds:['salt']});
  assert.deepEqual(states.map(s=>s.status),['stock','unknown','unknown','omitted']);
  assert.equal(states[0].omittedIngredients,1);
  assert.equal(pendingShopping(menus,data,{omittedIds:['salt']}).missingMenus.length,2);
  assert.throws(()=>receipt(menus,'salt',[],{omittedIds:['salt']}),/未購入分/);
});

test('receipt display expires after seven days while recipe coverage remains and undo restores buying need',()=>{
  const menus=[menu('a',[['onion',75]])], bought=receipt(menus,'onion');
  assert.equal(visibleReceipts([bought],{now:'2026-11-22T00:59:59.999Z'}).length,1);
  assert.equal(visibleReceipts([bought],{now:'2026-11-22T01:00:00.000Z'}).length,0);
  assert.equal(menuShoppingStatus(menus[0],data,{receipts:[bought]}).status,'purchased');
  assert.equal(menuShoppingStatus(menus[0],data,{receipts:undoReceipt(bought.id,[bought])}).status,'unpurchased');
  const shown=visibleReceipts([bought],{now:'2026-11-15T02:00:00.000Z'});shown[0].allocations[0].amount=1;
  assert.equal(bought.allocations[0].amount,75);
});

test('legacy purchase checks migrate only the old saved source menus without spreading to later ones',()=>{
  const menus=[menu('a',[['onion',10],['chicken',20]])], migrated=migrateLegacyReceipts(menus,['onion','not-in-list'],data);
  assert.equal(migrated.length,1);assert.equal(migrated[0].legacy,true);
  assert.equal(migrated[0].purchasedAt,'1970-01-01T00:00:00.000Z');
  assert.deepEqual(migrated,migrateLegacyReceipts(menus,['onion'],data));
  assert.equal(menuShoppingStatus(menus[0],data,{receipts:migrated}).status,'partial');
  assert.equal(menuShoppingStatus(menu('new',[['onion',10]]),data,{receipts:migrated}).status,'unpurchased');
  assert.deepEqual(visibleReceipts(migrated,{now:'2026-11-15T01:00:00.000Z'}),[]);
});

test('quantity growth credits only bought amounts and decrease never yields negative need',()=>{
  const original=menu('a',[['onion',100]]), bought=receipt([original],'onion');
  const larger={...original,item:{...original.item,quantity:2}};
  assert.equal(on(pendingShopping([larger],data,{receipts:[bought]}).items,'onion').buy,100);
  const smaller={...original,item:{...original.item,quantity:.5}};
  assert.equal(on(pendingShopping([smaller],data,{receipts:[bought]}).items,'onion').buy,0);
  assert.equal(menuShoppingStatus(smaller,data,{receipts:[bought]}).status,'purchased');
});

test('bad receipt amounts, dates, duplicate ids and over-allocation are rejected',()=>{
  const menus=[menu('a',[['onion',100]])], valid=receipt(menus,'onion');
  for(const patch of [{amount:-1},{purchasedAt:'not-a-date'},{allocations:[{menuId:'a',amount:101}]},
    {allocations:[{menuId:'a',amount:50},{menuId:'a',amount:50}]},{ingredientId:''}]){
    assert.throws(()=>pendingShopping(menus,data,{receipts:[{...valid,...patch}]}));
  }
  assert.throws(()=>pendingShopping(menus,data,{receipts:[valid,valid]}));
  assert.throws(()=>visibleReceipts([],{days:0}));
  assert.throws(()=>receipt(menus,'onion',[],{id:'',now:'2026-11-15T01:00:00.000Z'}));
});
