import {BREAKFAST_INGREDIENTS} from '../breakfast-recipes.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildShoppingChecklist, shoppingMenusFromEntries} from '../shopping-workflow.js';
import {INGREDIENT_GROUPS, ingredientGroup, commonPantryIds} from '../shopping-categories.js';
import {INGREDIENTS} from '../data.js';

const data = {ingredients: {
  onion: {name: '玉ねぎ', unit: 'g', groups: ['vegetable']},
  chicken: {name: '鶏肉', unit: 'g', groups: ['protein'], proteinSources: ['meat']},
  milk: {name: '牛乳', unit: 'ml', groups: ['dairy']},
  egg: {name: '卵', unit: '個', groups: ['protein'], proteinSources: ['egg']},
  salt: {name: '塩', unit: 'g'}, water: {name: '水', unit: 'ml'},
}};
const item = (name, ingredients, quantity = 1, more = {}) => ({id: name, recipeId: name,
  name, ingredients, quantity, ingredientsKnown: true, ...more});
const choose = (id, source, servings = 2, ingredientIds = [...new Set(source.ingredients.map(part => part.id))]) => ({id, item: source, servings, ingredientIds});
const entry = (id, date, meal, items, status = 'planned') => ({id, date, meal, items, status});
const options = {from: '2026-11-15', to: '2026-11-16', servings: 3};

test('料理ごとに選んだ食材を合計した後で在庫を一度だけ引き、各料理の出所を残す', () => {
  const selections = [
    choose('curry', item('カレー', [{id:'onion',amount:80},{id:'chicken',amount:100},{id:'salt',amount:1}], 1.5), 2, ['onion','chicken']),
    choose('soup', item('スープ', [{id:'onion',amount:30},{id:'milk',amount:100},{id:'water',amount:200}], .5), 4, ['onion','milk']),
  ];
  const pantry = [{id:'onion',amount:70},{id:'milk',amount:300}];
  const original = structuredClone({selections, pantry});
  const result = buildShoppingChecklist(selections, data, {pantry});
  const byId = Object.fromEntries(result.items.map(row => [row.id, row]));
  assert.equal(byId.onion.required, 300); // 80×1.5×2 + 30×0.5×4
  assert.equal(byId.onion.stock, 70); assert.equal(byId.onion.buy, 230);
  assert.deepEqual(byId.onion.sources, [
    {menuId:'curry', name:'カレー', amount:240, unit:'g', servings:2},
    {menuId:'soup', name:'スープ', amount:60, unit:'g', servings:4},
  ]);
  assert.equal(byId.chicken.buy, 300); assert.equal(byId.milk.required, 200); assert.equal(byId.milk.buy, 0);
  assert.equal(byId.milk.unit, 'ml'); assert.equal(byId.salt, undefined); assert.equal(byId.water, undefined);
  assert.deepEqual({selections, pantry}, original);
  byId.onion.sources[0].name = '変更後';
  assert.deepEqual({selections, pantry}, original);
});

test('一つの料理に同じ食材が複数あっても出所を一行にまとめる', () => {
  const result = buildShoppingChecklist([choose('a', item('分けて加えるスープ', [
    {id:'water',amount:50},{id:'water',amount:100},{id:'salt',amount:.3},
  ]), 2)], data);
  const water = result.items.find(row => row.id === 'water');
  assert.equal(water.required, 300); assert.equal(water.sources.length, 1); assert.equal(water.sources[0].amount, 300);
});

test('普段ある調味料は選んだものだけ別枠へ移し、何も選ばなければ省かない', () => {
  const selections = [choose('soup', item('スープ', [{id:'salt',amount:.5},{id:'water',amount:200},{id:'onion',amount:40}]))];
  const all = buildShoppingChecklist(selections, data);
  assert.equal(all.items.length, 3); assert.deepEqual(all.omittedItems, []);
  const reduced = buildShoppingChecklist(selections, data, {omittedIds:['water','salt']});
  assert.deepEqual(reduced.items.map(row => row.id), ['onion']);
  assert.deepEqual(reduced.omittedItems.map(row => row.id).sort(), ['salt','water']);
  assert.equal(reduced.omittedItems.find(row => row.id === 'water').required, 400);
  assert.equal(reduced.omittedItems.find(row => row.id === 'salt').sources[0].name, 'スープ');
});

test('材料不明、古い食材ID、商品として買える未確認メニューを区別する', () => {
  const selections = [
    choose('unknown', item('材料不明', [{id:'onion',amount:99}], 1, {ingredientsKnown:false})),
    choose('mixed', item('過去の料理', [{id:'deleted',amount:10},{id:'onion',amount:20}])),
    choose('product', item('商品表示を要確認', [{id:'milk',amount:200}], .5, {ingredientsKnown:false,shoppingKnown:true})),
    choose('empty', item('メモだけ', [], 1, {ingredientsKnown:false})),
  ];
  const result = buildShoppingChecklist(selections, data);
  assert.equal(result.items.find(row => row.id === 'onion').required, 40);
  assert.equal(result.items.find(row => row.id === 'milk').required, 200);
  assert.deepEqual(result.missingMenus.map(row => row.name), ['材料不明','過去の料理','商品表示を要確認','メモだけ']);
  assert.match(result.missingMenus[0].reason, /合計に含めていません/);
  assert.match(result.missingMenus[2].reason, /分かる材料・商品だけ/);
  assert.equal(result.items.some(row => row.id === 'deleted'), false);
});

test('作り置きと外食の原材料を再購入しない', () => {
  const source = item('材料はあるが準備済み', [{id:'chicken',amount:100}]);
  const result = buildShoppingChecklist([
    choose('batch', {...source, batchId:'batch-1'}), choose('restaurant', {...source, restaurant:{chain:'test'}}),
  ], data);
  assert.deepEqual(result, {items:[], missingMenus:[], omittedItems:[]});
});

test('予定の対象期間を料理単位へ分け、同名料理を別の予定として扱う', () => {
  const first = item('同じ料理', [{id:'egg',amount:1}]);
  const entries = [
    entry('first','2026-11-15','breakfast',[first]),
    entry('second','2026-11-16','dinner',[first]),
    entry('eaten','2026-11-15','lunch',[first],'eaten'),
    entry('before','2026-11-14','dinner',[first]),
    entry('after','2026-11-17','dinner',[first]),
    {...entry('memo','2026-11-15','dinner',[]), note:'まだ料理未指定'},
  ];
  const original = structuredClone(entries);
  const menus = shoppingMenusFromEntries(entries, data, options);
  assert.equal(menus.length, 2); assert.notEqual(menus[0].id, menus[1].id);
  assert.equal(menus[0].label, '2026-11-15 朝食'); assert.equal(menus[1].label, '2026-11-16 夕食');
  assert.equal(menus[0].servings, 3); assert.deepEqual(menus[0].item, first);
  menus[0].item.ingredients[0].amount = 9;
  assert.deepEqual(entries, original);
});

test('区切り文字を含む元IDでも料理の選択IDが衝突しない', () => {
  const menus = shoppingMenusFromEntries([
    entry('a:b','2026-11-15','lunch',[item('c',[])]),
    entry('a','2026-11-15','lunch',[item('b:c',[])]),
  ], data, options);
  assert.notEqual(menus[0].id, menus[1].id);
});

test('不正な人数、材料選択、分量や在庫を黙って集計しない', () => {
  const valid = choose('a', item('料理', [{id:'egg',amount:1}]));
  for (const servings of [0,9,1.5,'2',NaN]) assert.throws(() => buildShoppingChecklist([{...valid,servings}], data));
  for (const ingredientIds of [null,'egg',['egg','egg'],['onion']]) assert.throws(() => buildShoppingChecklist([{...valid,ingredientIds}], data));
  assert.throws(() => buildShoppingChecklist([valid,valid], data));
  for (const amount of [0,-1,'2',NaN,Infinity]) assert.throws(() => buildShoppingChecklist([choose('a',item('不正な料理',[{id:'egg',amount}]))],data));
  for (const amount of [-1,'2',NaN,Infinity]) assert.throws(() => buildShoppingChecklist([valid],data,{pantry:[{id:'egg',amount}]}));
  assert.throws(() => buildShoppingChecklist([valid],data,{pantry:[{id:'egg',amount:1},{id:'egg',amount:2}]}));
  assert.throws(() => buildShoppingChecklist([valid],data,{pantry:[{id:'unknown',amount:1}]}));
  for (const from of ['2026-02-30','1999-12-31','bad']) assert.throws(() => shoppingMenusFromEntries([],data,{...options,from}));
  assert.throws(() => shoppingMenusFromEntries([],data,{...options,to:'2026-11-14'}));
});

test('全食材が売り場に近い区分へ入り、分類は栄養や元データを書き換えない', () => {
  const catalogue = {ingredients:INGREDIENTS};
  const before = structuredClone(INGREDIENTS), valid = new Set(INGREDIENT_GROUPS.map(group => group.id));
  assert.equal(Object.keys(INGREDIENTS).length, 458+Object.keys(BREAKFAST_INGREDIENTS).length);
  for (const id of Object.keys(INGREDIENTS)) {
    assert.ok(valid.has(ingredientGroup(id,catalogue)), id);
    assert.notEqual(ingredientGroup(id,catalogue),'other',id);
  }
  for (const [id, expected] of Object.entries({
    chicken:'meat',shrimp:'fish',natto:'eggsoy',mushroom:'vegetable',banana:'fruit',butter:'dairy',
    flour:'grain',acmp_seasoned_nori:'seaweed',walnut:'nuts',water:'water',olive_oil:'oil',
    soy_sauce:'seasoning',carbonated_water:'drink',prepared_item_burger_plain:'prepared',
    takeaway_tomato_unsalted:'drink',confectionery_kinoko:'snack',soup311_wonton_wrappers:'grain',
  })) assert.equal(ingredientGroup(id,catalogue), expected, id);
  assert.equal(ingredientGroup('new-unclassified',{ingredients:{'new-unclassified':{name:'追加食材'}}}),'other');
  assert.deepEqual(INGREDIENTS,before);
});

test('調味料を省く一括候補は明示した材料だけで、珍しい調味料や食品を巻き込まない', () => {
  const catalogue = {ingredients:INGREDIENTS};
  const common = commonPantryIds(catalogue);
  for (const id of ['water','oil','salt','sugar','soy_sauce']) assert.ok(common.includes(id));
  for (const id of ['mapo_doubanjiang','world_tomyum_paste','chicken','milk','carbonated_water']) assert.ok(!common.includes(id));
  assert.deepEqual(commonPantryIds({ingredients:{water:{}}}), ['water']);
});
