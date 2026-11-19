import assert from 'node:assert/strict';
import test from 'node:test';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {ingredientOptions} from '../ingredient-options.js';
import {defaultJournal, parseJournal} from '../journal.js';
import {eligibleRecipes} from '../planner.js';

const data = {ingredients: INGREDIENTS, recipes: RECIPES, allergens: ALLERGENS};
const ids = (query, options) => ingredientOptions(data, query, options).map(food => food.id);

test('食材の設定候補に完成料理や菓子・飲料の商品名が入らない', () => {
  assert.deepEqual(ingredientOptions(data, 'マヨネーズ'), [{id:'mayonnaise', name:'マヨネーズ', unit:'g'}]);
  assert.deepEqual(ids('ﾏﾖ'), ['mayonnaise']);
  for (const text of ['ツナマヨ', 'おにぎり', 'クノール', 'カラムーチョ', 'レッドブル', 'カキフライ']) {
    assert.deepEqual(ids(text), [], text);
  }
  const all = ids('');
  assert.equal(all.length, new Set(all).size);
  assert.ok(all.includes('simmered_satsumaage') && all.includes('mapo_doubanjiang') && all.includes('perf_wine_white'));
  assert.ok(!all.some(id => /^(convenience_|confectionery_|prepared_item_|takeaway_|retort_)/u.test(id)));
});

test('ごま自体を使う選択肢は別々に残し、元の量や材料・アレルゲン注記で拾わない', () => {
  for (const query of ['ごま', 'ゴマ', '胡麻']) {
    assert.deepEqual(new Set(ids(query)), new Set(['sesame', 'ground_sesame', 'sesame_oil']));
  }
  assert.deepEqual(ids('しょうゆ'), ['soy_sauce', 'kyoto_usukuchi']);
  assert.ok(!ids('卵').includes('mayonnaise') && !ids('小麦').includes('soy_sauce'));
  assert.deepEqual(ids('ごま', {selectedIds: ['ground_sesame', 'sesame_oil']}), ['sesame']);
});

test('水煮・油漬けなど食材の状態はラベルと検索の両方で区別できる', () => {
  const tuna = ingredientOptions(data, 'ツナ');
  assert.equal(tuna.length, 2);
  assert.notEqual(tuna[0].name, tuna[1].name);
  assert.deepEqual(ids('ツナ 水煮'), ['tuna_canned']);
  assert.deepEqual(ids('ツナ 油漬け'), ['acmp_tuna_oil']);
  assert.deepEqual(ids('ごま', {limit: 0}), []);
});

test('既存の商品IDを保持し、登録済み食材・アレルゲンの除外は従来どおり働く', () => {
  const previous = defaultJournal('2026-11-19');
  const product = 'convenience_tuna_mayo_onigiri';
  previous.settings.excludedIngredients = [product, 'mayonnaise'];
  previous.settings.shoppingOmittedIds = [product];
  previous.settings.dislikedIngredients = [product];
  previous.settings.allergens = ['sesame'];
  const restored = parseJournal(JSON.stringify(previous), data);
  for (const key of ['excludedIngredients', 'shoppingOmittedIds', 'dislikedIngredients', 'allergens']) {
    assert.deepEqual(restored.settings[key], previous.settings[key]);
  }
  const relevant = {...data, recipes: RECIPES.filter(r => ['onigiri-tuna-mayo','onigiri-sesame','plain-rice'].includes(r.id))};
  assert.deepEqual(eligibleRecipes(restored.settings, relevant).map(r => r.id), ['plain-rice']);
});
