import test from 'node:test';
import assert from 'node:assert/strict';
import {cookingIngredients} from '../cooking-view.js';

const dish = (name, amount, quantity, more = {}) => ({
  name, quantity, ingredientsKnown: true, ingredients: [{id:'onion', amount}], ...more
});

test('調理量は保存した材料と一皿の量、人数を掛け、共通の材料を合計して内訳を残す', () => {
  const items = [dish('玉ねぎのスープ', 30.25, 0.5), dish('マリネ', 20.5, 1.5)];
  const before = structuredClone(items);
  assert.deepEqual(cookingIngredients(items, 2), [{id:'onion', amount:91.75, uses:[
    {name:'玉ねぎのスープ', amount:30.25}, {name:'マリネ', amount:61.5}
  ]}]);
  assert.deepEqual(items, before);
  for (const n of [0, 1.5, 9, NaN]) assert.throws(() => cookingIngredients(items, n));
});

test('作り置きと外食の参考材料や分量不明の商品を家庭で用意する材料として重ねない', () => {
  const items = [
    dish('作り置き', 100, 1, {batchId:'batch-1'}),
    dish('外食', 100, 1, {diningMatch:{}}),
    dish('お店の料理', 100, 1, {restaurant:{}}),
    dish('代表例のみ', 100, 1, {ingredientsKnown:false}),
    dish('買う商品量は登録済み', 25, 1, {ingredientsKnown:false, shoppingKnown:true})
  ];
  assert.deepEqual(cookingIngredients(items, 2), [{id:'onion', amount:50, uses:[{name:'買う商品量は登録済み', amount:50}]}]);
});
