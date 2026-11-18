import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {createCatalogItem} from '../record-actions.js';
import {createDiningItem} from '../dining-meal.js';
import {defaultJournal, parseJournal, validateFrozenItems} from '../journal.js';
import {itemNutrition, recipeNutrition} from '../nutrition.js';
import {classifyNutritionBasis} from '../nutrition-basis.js';
import {recordIngredientDraft, editRecordIngredients} from '../record-ingredient-edit.js';
import {shoppingForEntries} from '../shopping.js';

const data={ingredients:INGREDIENTS,recipes:RECIPES,allergens:ALLERGENS};
const qty=(id,amount)=>({id,amount});
const recipe=id=>RECIPES.find(r=>r.id===id);
const edit=(item,changes)=>editRecordIngredients(item,{...recordIngredientDraft(item,data),...changes},data);
const day='2026-11-19';
const almost=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} versus ${b}`);

test('半量に加えた卵を一個として保存し、再編集・予定の買い物・変更の取り消しまで一致する',()=>{
  const dish=createCatalogItem('plain-rice',75,data), original=structuredClone(dish);
  const extra=edit(dish,{additions:[qty('egg',1)]});
  assert.equal(extra.id,dish.id);
  assert.equal(extra.recipeId,dish.recipeId);
  assert.equal(extra.quantity,0.5);
  assert.equal(extra.proteinSources.includes('egg'),true);
  assert.equal(extra.allergens.includes('egg'),true);
  almost(itemNutrition(extra).protein,itemNutrition(dish).protein+INGREDIENTS.egg.nutritionPerUnit.protein);
  const entry={date:day,meal:'dinner',id:'planned',note:'',status:'planned',items:[extra]};
  const shopping=shoppingForEntries([entry],data,{from:day,to:day,servings:3});
  assert.equal(shopping.items.find(item=>item.id==='egg').required,3);
  const copied=parseJournal(JSON.stringify({...defaultJournal(day),entries:[entry]}),data).entries[0].items[0];
  assert.deepEqual(copied,extra);
  assert.deepEqual(recordIngredientDraft(copied,data).additions,[qty('egg',1)]);
  assert.deepEqual(edit(copied,{additions:[]}),original);
  assert.deepEqual(dish,original);
  assert.deepEqual(recordIngredientDraft({...copied,quantity:1},data).additions,[qty('egg',2)]);
});

test('焼き鮭の材料から魚を除き、同じ記録に卵を加えると魚の食品情報と栄養を更新する',()=>{
  const fish=createCatalogItem('classic-grilled-salmon',0.5,data), original=structuredClone(fish);
  const draft=recordIngredientDraft(fish,data);
  const salmon=draft.ingredients.find(part=>INGREDIENTS[part.id].proteinSources.includes('fish'));
  const ingredients=draft.ingredients.filter(part=>part.id!==salmon.id);
  const edited=edit(fish,{ingredients,additions:[qty('egg',1)]});
  assert.equal(edited.id,fish.id);assert.deepEqual(edited.steps,fish.steps);
  assert.deepEqual(fish,original);
  assert.ok(!edited.proteinSources.includes('fish'));assert.ok(edited.proteinSources.includes('egg'));
  assert.ok(!edited.allergens.includes('salmon'));assert.ok(edited.allergens.includes('egg'));
  const expected=recipeNutrition({servings:1,ingredients:[...ingredients,qty('egg',1)]},data);
  for (const [key,n] of Object.entries(itemNutrition(edited))) almost(n,expected[key]);
  assert.deepEqual(edit(edited,{}),edited);
});

test('元の数値と材料が対応しない料理は追加した食材だけを編集し、最後に元の表示へ戻せる',()=>{
  const dish=createCatalogItem('plain-rice',150,data);
  dish.nutritionBasis='official';dish.nutrition.fiber=null;dish.nutrition.kcal=123;dish.ingredientsKnown=false;
  const original=structuredClone(dish);
  const withEgg=edit(dish,{additions:[qty('egg',1)]});
  assert.equal(recordIngredientDraft(withEgg,data).editableBase,false);
  assert.equal(withEgg.nutrition.fiber,null);
  assert.equal(withEgg.nutritionBasis,'mixed');
  assert.throws(()=>edit(withEgg,{ingredients:[]}),/追加/);
  assert.equal(edit(withEgg,{additions:[qty('egg',2)]}).nutrition.kcal,123+2*INGREDIENTS.egg.nutritionPerUnit.kcal);
  assert.deepEqual(edit(withEgg,{additions:[]}),original);
  const missing={...dish,ingredients:[qty('old-food-no-longer-catalogued',12)]};
  assert.equal(edit(missing,{additions:[qty('egg',1)]}).ingredients[0].id,'old-food-no-longer-catalogued');
});

test('似た外食で参考にした材料を直しても、店で使用した原材料まで確認済みとは扱わない',()=>{
  const dish=createDiningItem({recipe:recipe('plain-rice')},{amount:100,actualName:'食堂のご飯'},data);
  const draft=recordIngredientDraft(dish,data);
  assert.equal(draft.editableBase,true);
  const item=edit(dish,{ingredients:draft.ingredients.map(p=>({...p,amount:80})),additions:[qty('egg',1)]});
  almost(itemNutrition(item).kcal, itemNutrition(dish).kcal*0.8+INGREDIENTS.egg.nutritionPerUnit.kcal);
  assert.equal(item.recipeId,'plain-rice');assert.equal(item.diningMatch.mode,'similar');
  assert.equal(item.shoppingKnown,false);assert.equal(item.allergensKnown,false);assert.equal(item.ingredientsKnown,false);
  assert.match(classifyNutritionBasis(item,data).description,/材料/);
  assert.throws(()=>validateFrozenItems([{...item,ingredients:[]}],data),/一致/);
  assert.throws(()=>edit({...dish,batchId:'batch-1'},{additions:[qty('egg',1)]}));
  const packaged=createDiningItem({recipe:recipe('prepared-cup-ramen-soy')},{amount:1},data);
  assert.equal(recordIngredientDraft(packaged,data).editableBase,false);
  assert.throws(()=>edit(packaged,{ingredients:[]}),/追加/);
});

test('追加した食材が元と同じでも二重に数えず、元の量と追加分をそれぞれ更新できる',()=>{
  const dish=createCatalogItem('plain-rice',150,data),rice=dish.ingredients[0].id;
  const plus=edit(dish,{ingredients:[qty(rice,75)],additions:[qty(rice,25)]});
  assert.deepEqual(plus.ingredients,[qty(rice,100)]);
  const draft=recordIngredientDraft(plus,data);
  assert.deepEqual(draft.ingredients,[qty(rice,75)]);
  assert.deepEqual(draft.additions,[qty(rice,25)]);
  const twice=edit(plus,{ingredients:[qty(rice,50)],additions:[qty(rice,100)]});
  almost(twice.nutrition.kcal,dish.nutrition.kcal);
  assert.throws(()=>edit(twice,{ingredients:[],additions:[]}),/1つ/);
  assert.throws(()=>edit(twice,{additions:[qty('egg',Infinity)]}),/分量/);
  const replaced=edit(dish,{ingredients:[],additions:[qty('egg',1)]});
  assert.throws(()=>edit(replaced,{additions:[]}),/1つ/);
});
