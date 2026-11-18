import test from 'node:test';
import assert from 'node:assert/strict';
import {INGREDIENTS, RECIPES} from '../data.js';
import {itemFromRecipe, recipeNutrition} from '../nutrition.js';
import {buildShoppingChecklist, removeShoppingIngredient} from '../shopping-workflow.js';
import {pendingShopping, createShoppingReceipt, shoppingMenuStatuses} from '../shopping-status.js';
import {recordIngredientDraft, editRecordIngredients} from '../record-ingredient-edit.js';
import {ALLERGENS} from '../data.js';

const data={ingredients:INGREDIENTS,recipes:RECIPES,allergens:ALLERGENS};
const recipe=id=>RECIPES.find(row=>row.id===id);
test('だしがらを除くみそ汁・具として食べる昆布・かつお節を区別する',()=>{
  const soup=recipe('soup-001'), flakes=recipe('daily-onigiri-okaka'), kelp=recipe('daily-onigiri-kombu');
  const item=itemFromRecipe(soup,data);
  assert.ok(soup.ingredients.some(p=>p.id==='stock_kombu_strained'&&p.amount===3));
  assert.ok(flakes.ingredients.some(p=>p.id==='bonito')&&kelp.ingredients.some(p=>p.id==='kombu'));
  assert.equal(Number(recipeNutrition(soup,data).fiber.toFixed(2)),1.80);
  const draft=recordIngredientDraft(item,data);
  assert.ok(draft.editableBase);
  const filtered=draft.ingredients.filter(p=>p.id!=='stock_kombu_strained');
  const edited=editRecordIngredients(item,{ingredients:filtered,additions:[]},data);
  assert.ok(edited.nutrition.fiber<item.nutrition.fiber);
});

test('具とだしが同じ乾物なら一度だけ在庫を引き、購入済みを料理ごとに消し込む',()=>{
  const menu=(id,material)=>({id,servings:1,ingredientIds:[material],item:{name:id,quantity:1,ingredientsKnown:true,
    ingredients:[{id:material,amount:3}]}});
  const menus=[menu('煮物','stock_kombu_strained'),menu('おにぎり','kombu')];
  const options={pantry:[{id:'kombu',amount:1}]};
  const listed=buildShoppingChecklist(menus,data,options);
  assert.deepEqual(listed.items.map(r=>[r.id,r.required,r.buy]),[['kombu',6,5]]);
  const receipt=createShoppingReceipt(menus,'kombu',data,{...options,id:'receipt',now:'2026-11-18T01:00:00Z'});
  assert.equal(pendingShopping(menus,data,{...options,receipts:[receipt]}).items[0].buy,0);
  assert.ok(shoppingMenuStatuses(menus,data,{...options,receipts:[receipt]}).every(s=>s.remainingIngredients===0));
  assert.deepEqual(removeShoppingIngredient(menus,'kombu',['煮物']).map(m=>m.id),['おにぎり']);
  assert.equal(buildShoppingChecklist(menus,data,{omittedIds:['kombu']}).items.length,0);
});
