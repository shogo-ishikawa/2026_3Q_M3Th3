import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {itemFromRecipe, itemNutrition, summariseEntries} from '../nutrition.js';
import {defaultJournal, parseJournal} from '../journal.js';
import {applyProductLabel, validateProductLabel} from '../product-label.js';
import {classifyNutritionBasis} from '../nutrition-basis.js';
import {editRecordIngredients} from '../record-ingredient-edit.js';

const data={ingredients:INGREDIENTS,allergens:ALLERGENS,recipes:RECIPES};
const date='2026-11-19';
function snapshot(quantity=1) {
  const model=RECIPES.find(recipe=>recipe.id==='quick-food-onigiri');
  assert.ok(model);
  return {...itemFromRecipe(model,data,quantity),portion:model.portion};
}
function label(overrides={}) {
  return {name:'梅のおにぎり',unit:'個',amount:1,unitSize:null,
    nutrition:{kcal:190,protein:4.2,fat:0,carbs:41.6,fiber:null,salt:0.01},...overrides};
}
const entry=(id,items,status)=>({id,date,meal:'lunch',status,note:'',items});

test('per 100 g label scales to fractional pieces, survives JSON, and only changes the selected snapshot',()=>{
  const model=snapshot(1.5),other=snapshot(),planned=snapshot(2), meal=defaultJournal(date);
  meal.entries=[entry('eaten',[model,other],'eaten'),entry('plan',[planned],'planned')];
  const before=structuredClone(meal);
  const source=label({unit:'g',amount:100,unitSize:120});
  meal.entries[0].items[0]=applyProductLabel(model,source,data);
  const saved=parseJournal(JSON.stringify(meal),data);
  const corrected=saved.entries[0].items[0];
  assert.deepEqual(corrected.productLabel,source);
  assert.equal(corrected.id,model.id);
  assert.deepEqual(corrected.portion,model.portion);
  assert.deepEqual(corrected.ingredients,model.ingredients);
  assert.equal(corrected.quantity,1.5);
  assert.equal(corrected.allergensKnown,model.allergensKnown);
  assert.deepEqual(saved.entries[0].items[1],before.entries[0].items[1]);
  assert.deepEqual(saved.entries[1],before.entries[1]);
  assert.deepEqual(model,before.entries[0].items[0]);
  assert.equal(itemNutrition(corrected).kcal,342);
  assert.equal(itemNutrition(corrected).fat,0);
  assert.equal(itemNutrition(corrected).fiber,null);
  assert.ok(Math.abs(itemNutrition(corrected).salt-.018)<1e-12);
  const daily=summariseEntries(saved.entries,{from:date,to:date});
  assert.equal(daily.values.kcal,342+itemNutrition(other).kcal);
  assert.equal(daily.complete.fiber,false);
  assert.equal(classifyNutritionBasis(corrected,data).label,'手元の商品の表示値');
  assert.notEqual(classifyNutritionBasis(other,data).label,'手元の商品の表示値');
  const revised=applyProductLabel(planned,label({amount:2}),data);
  assert.equal(itemNutrition(revised).kcal,190);
  saved.entries[1].items[0]=revised;
  assert.equal(summariseEntries(saved.entries,{from:date,to:date,status:'planned'}).values.kcal,190);
  assert.equal(summariseEntries(saved.entries,{from:date,to:date}).values.kcal,daily.values.kcal);
});

test('an entered zero, an omitted nutrient and a mistaken unit remain distinct',()=>{
  const item=snapshot(),raw=label();
  for (const bad of [label({amount:0}),label({unit:'g',unitSize:null}),label({unit:'ml',unitSize:0}),label({unit:'皿'}),
    label({nutrition:{...raw.nutrition,kcal:-1}}),label({nutrition:Object.fromEntries(Object.keys(raw.nutrition).map(k=>[k,null]))})]) {
    assert.throws(()=>validateProductLabel(bad,item.portion));
  }
  assert.equal(applyProductLabel(item,label({nutrition:{...raw.nutrition,salt:0}}),data).nutrition.salt,0);
  assert.equal(applyProductLabel(item,label({nutrition:{...raw.nutrition,protein:null}}),data).nutrition.protein,null);
});

test('changing the product label preserves separate ingredient additions and can be repeated',()=>{
  const base=snapshot(2), added=editRecordIngredients(base,{ingredients:base.ingredients.map(p=>({...p,amount:p.amount*2})),additions:[{id:'carrot',amount:20}]},data);
  const corrected=applyProductLabel(added,label(),data);
  assert.deepEqual(corrected.ingredientEdit.additions,added.ingredientEdit.additions);
  assert.equal(corrected.nutritionBasis,'mixed');
  assert.ok(Math.abs(corrected.nutrition.kcal-(190+INGREDIENTS.carrot.nutritionPerUnit.kcal*10))<1e-8);
  assert.equal(corrected.nutrition.fiber,null);
  const repeated=applyProductLabel(corrected,label(),data);
  assert.deepEqual(repeated.nutrition,corrected.nutrition);
  const restored=editRecordIngredients(repeated,{ingredients:base.ingredients.map(p=>({...p,amount:p.amount*2})),additions:[]},data);
  assert.equal(restored.nutritionBasis,'manual');
  assert.equal(restored.nutrition.kcal,190);
  assert.deepEqual(restored.productLabel,corrected.productLabel);
});
