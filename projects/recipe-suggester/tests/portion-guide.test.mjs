import test from 'node:test';
import assert from 'node:assert/strict';
import {RECIPES,INGREDIENTS,ALLERGENS} from '../data.js';
import {recipePortion} from '../catalog.js';
import {itemFromRecipe} from '../nutrition.js';
import {recordPortionPresets,plannedQuantity,planPortionLabel,portionLabel,formatCookingIngredient,cookingIngredientGuide,formatPurchaseAmount} from '../portion-guide.js';
const data={recipes:RECIPES,ingredients:INGREDIENTS,allergens:ALLERGENS};
const settings=volume=>({meal:'breakfast',mealPreferences:{breakfast:{volume,mood:'all'}}});
const recipe=id=>RECIPES.find(r=>r.id===id);

test('automatic rice sizes are standard grams and bread uses half slices, without changing recipes',()=>{
  const rice=recipe('plain-rice'),bread=recipe('staple-plain-bread'),before=JSON.stringify([rice,bread]);
  const sizes=['light','normal','hearty'];
  assert.deepEqual(sizes.map(v=>plannedQuantity(rice,settings(v),data)*recipePortion(rice,data).amount),[100,150,200]);
  assert.deepEqual(sizes.map(v=>plannedQuantity(bread,settings(v),data)*recipePortion(bread,data).amount),[.5,1,1.5]);
  assert.deepEqual(sizes.map(v=>planPortionLabel(rice,plannedQuantity(rice,settings(v),data),data)),['小盛り（100g）','ふつう（150g）','大盛り（200g）']);
  assert.deepEqual(sizes.map(v=>planPortionLabel(bread,plannedQuantity(bread,settings(v),data),data)),['半枚','1枚','1枚半']);
  assert.equal(JSON.stringify([rice,bread]),before);
});

test('automatic main and side quantities use simple portions rather than multiplied fractions',()=>{
  const main=RECIPES.find(r=>r.role==='main'&&!r.staple),side=RECIPES.find(r=>r.role==='side');
  for(const r of [main,side]){
    assert.deepEqual(['light','normal','hearty'].map(v=>plannedQuantity(r,settings(v),data)),[.5,1,1.5]);
    assert.match(planPortionLabel(r,.5,data),/少なめ/);assert.match(planPortionLabel(r,1.5,data),/多め/);
  }
  const soup=RECIPES.find(r=>r.role==='soup'),drink=RECIPES.find(r=>r.role==='drink');
  assert.equal(plannedQuantity(soup,settings('hearty'),data),1);assert.equal(plannedQuantity(drink,settings('light'),data),1);
});

test('stored portions are described without altering saved quantities or recomputing nutrients',()=>{
  const side=RECIPES.find(r=>r.role==='side'),item=itemFromRecipe(side,data,.5625);item.portion={amount:1,unit:'皿'};
  const before=structuredClone(item);assert.equal(portionLabel(item,data),'少なめ');assert.deepEqual(item,before);
  const old={...item,recipeId:null,quantity:2.35};assert.equal(portionLabel(old,{...data,recipes:[]}),'2.35人分');
});

test('recipe material guides round useful grams and give only supportable household units',()=>{
  const shrimp=cookingIngredientGuide('shrimp',39.375,data),lettuce=cookingIngredientGuide('lettuce',33.75,data);
  assert.equal(shrimp.text,'むきえび 約40g（数尾・大きさで調整）');
  assert.equal(lettuce.text,'レタス 約35g（1枚前後）');
  assert.equal(shrimp.exactAmount,39.375);assert.equal(lettuce.exactAmount,33.75);
  assert.match(formatCookingIngredient('onion',49.9,data),/約50g（1\/4個程度）/);
  assert.match(formatCookingIngredient('carrot',37.4,data),/約35g（1\/4本程度）/);
  assert.match(formatCookingIngredient('lettuce',60,data),/60g（約2枚）/);
  assert.equal(formatCookingIngredient('shrimp',39.375,data,{includeName:false}),'約40g（数尾・大きさで調整）');
});

test('spoon measures respect registered g versus ml and never erase small seasoning quantities',()=>{
  assert.match(formatCookingIngredient('salt',1.5,data),/1.5g（小さじ1\/4程度）/);
  assert.match(formatCookingIngredient('sugar',3,data),/3g（小さじ1程度）/);
  assert.match(formatCookingIngredient('oil',5,data),/5ml（小さじ1程度）/);
  assert.equal(formatCookingIngredient('salt',.06,data),'食塩 0.1g未満（ごく少量）');
  assert.equal(formatCookingIngredient('salt',.5,data),'食塩 0.5g');
  assert.equal(formatCookingIngredient('unregistered',.06,{ingredients:{unregistered:{name:'未知の調味料',unit:'g'}}}),'未知の調味料 0.1g未満（ごく少量）');
  assert.equal(formatCookingIngredient('oil',5,data,{unit:'g',includeName:false}),'5g');
});

test('fallback units stay honest and raw totals remain exact while purchase display rounds upward',()=>{
  assert.equal(formatCookingIngredient('past',1.25,{ingredients:{}}),'past 1.25（単位未登録）');
  assert.equal(formatCookingIngredient('packet',.5,{ingredients:{packet:{name:'食品',unit:'袋'}}}),'食品 0.5袋');
  assert.equal(formatPurchaseAmount(111.111,'g'),'約115g');assert.equal(formatPurchaseAmount(110,'g'),'110g');
  assert.equal(formatPurchaseAmount(.01,'ml'),'約0.1ml');assert.equal(formatPurchaseAmount(2,'袋'),'2袋');
  assert.equal(formatPurchaseAmount(0,'g'),'0g');
  for(const invalid of [-1,NaN,Infinity,'1'])assert.throws(()=>formatCookingIngredient('lettuce',invalid,data));
});

test('all catalogue materials have a finite display fallback without altering ingredient data',()=>{
  const before=JSON.stringify(data.ingredients);
  for(const r of RECIPES)for(const part of r.ingredients){
    const text=formatCookingIngredient(part.id,part.amount/r.servings*.5,data);
    assert.ok(text.length>0);assert.doesNotMatch(text,/NaN|Infinity|undefined/);
  }
  assert.equal(JSON.stringify(data.ingredients),before);
});


test('食事の記録に使うご飯の分量は100・150・200gで、皿や履歴は保存した単位を使う',()=>{
  const rice=recipe('plain-rice');
  assert.deepEqual(recordPortionPresets(rice, recipePortion(rice,data)), [
    {label:'100g',value:100},{label:'150g',value:150},{label:'200g',value:200},
  ]);
  assert.deepEqual(recordPortionPresets(null, {amount:2,unit:'個'}).map(p=>p.value),[1,2,4]);
  assert.deepEqual(recordPortionPresets(null, {amount:150,unit:'g'}),[]);
});
