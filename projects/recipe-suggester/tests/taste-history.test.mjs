import test from 'node:test';
import assert from 'node:assert/strict';
import {RECIPES} from '../data.js';
import {buildTasteHistory, eatenRecipeId, tasteHistoryScore} from '../taste-history.js';

const data = {recipes:RECIPES};
const target = {date:'2026-11-19', meal:'lunch'};
const recipe = id => RECIPES.find(item => item.id === id);
const eaten = (date, meal, ...ids) => ({
  status:'eaten', date, meal, items:ids.map(recipeId => ({recipeId, quantity:1})),
});
const history = (entries, catalog = data) => buildTasteHistory(entries, catalog, target);

test('独立した2食から、調理法、主材料、ジャンルを別の料理にも反映し理由を1件に絞る', () => {
  const past = history([
    eaten('2026-09-02', 'dinner', 'salmon-miso'),
    eaten('2026-10-08', 'lunch', 'salmon-foil'),
  ]);
  const reasons = [];
  assert.equal(tasteHistoryScore(recipe('cod-salt-steam'),past,reasons), 3);
  assert.deepEqual(reasons, ['直近90日の食事記録で「蒸し物」が2食ありました。']);
  assert.equal(tasteHistoryScore(recipe('chicken-steam'),past), 2);
  assert.equal(tasteHistoryScore(recipe('salmon-lemon'),past), 1);
  assert.equal(tasteHistoryScore(recipe('chicken-teriyaki'),past), 0.8);
  assert.equal(tasteHistoryScore(recipe('chicken-tomato'),past), 0);
  const fishReasons = [];
  tasteHistoryScore(recipe('salmon-lemon'),past,fishReasons);
  assert.match(fishReasons[0], /魚介が主材料の料理/);
});

test('分割記録、品数、食べた分量によって同じ1食が反復にならない', () => {
  const entries = [
    eaten('2026-11-17', 'dinner', 'salmon-miso', 'salmon-foil'),
    eaten('2026-11-17', 'dinner', 'cod-salt-steam'),
  ];
  entries[0].items[0].quantity = 100;
  const reasons = [];
  assert.equal(tasteHistoryScore(recipe('salmon-foil'),history(entries),reasons), 0);
  assert.deepEqual(reasons, []);
  const many = [...entries, ...Array.from({length:15}, (_,i) => eaten('2026-10-'+String(10+i), 'lunch', 'salmon-miso'))];
  assert.equal(tasteHistoryScore(recipe('cod-salt-steam'),history(many)), 3);
  const mixed = [...entries, eaten('2026-10-08','lunch','salmon-miso'), eaten('2026-10-07','dinner','chicken-tomato')];
  assert.ok(tasteHistoryScore(recipe('cod-salt-steam'),history(mixed)) < 3);
});

test('対象の食事枠と90日の境界を守り、予定・提案・記録のないメモからは学習しない', () => {
  const eligible = [eaten('2026-08-21','dinner','salmon-miso'), eaten(target.date,'breakfast','salmon-foil')];
  const ignored = [
    eaten('2026-08-20','dinner','salmon-miso'), eaten(target.date,'lunch','salmon-miso'),
    eaten(target.date,'dinner','salmon-miso'), eaten('2026-11-20','breakfast','salmon-miso'),
    {...eaten('2026-11-17','lunch','salmon-miso'),status:'planned'},
    {date:'2026-11-18',meal:'dinner',recipeIds:['salmon-miso']},
    {...eaten('2026-11-18','lunch'),note:'鮭の蒸し物が好き'},
    eaten('2026-09-31','dinner','salmon-miso'), eaten('2026-11-15','unknown','salmon-miso'),
  ];
  assert.equal(tasteHistoryScore(recipe('cod-salt-steam'),history(ignored)), 0);
  const reasons = [];
  tasteHistoryScore(recipe('cod-salt-steam'),history([...eligible,...ignored]),reasons);
  assert.match(reasons[0], /蒸し物」が2食/);
  const explicitLegacy = {status:'eaten',date:'2026-09-17',meal:'lunch',recipeIds:['salmon-miso']};
  assert.equal(tasteHistoryScore(recipe('cod-salt-steam'),history([eligible[0],explicitLegacy])), 3);
  assert.equal(tasteHistoryScore(recipe('cod-salt-steam'),history([eligible[0],{...explicitLegacy,items:[]}])), 0);
});

test('手入力・似た外食・主要な材料の変更・商品・飲料・添えご飯を家庭料理の根拠にしない', () => {
  const custom = {...recipe('salmon-miso'),id:'custom-miso',custom:true};
  const alias = {...custom,id:'alias-without-custom-prefix'};
  const catalog = {recipes:[...data.recipes,custom,alias]};
  const items = [
    {recipeId:null,name:'さけのみそ蒸し',genre:'和食',displayMethod:'steam'},
    {recipeId:'missing',name:'さけのみそ蒸し'},
    {recipeId:'salmon-miso',diningMatch:{mode:'similar'}},
    {recipeId:'salmon-foil',ingredientEdit:{baseChanged:true}},
    {recipeId:'salmon-miso',quantity:0}, {recipeId:'salmon-miso',quantity:'invalid'},
    ...[custom.id,alias.id,'quick-food-grilled-skewer','plain-rice','drink-water'].map(recipeId=>({recipeId})),
  ];
  const entries = ['2026-11-01','2026-11-02'].map(date => ({date,meal:'lunch',status:'eaten',items}));
  const reasons = [];
  assert.equal(tasteHistoryScore(recipe('cod-salt-steam'),history(entries,catalog),reasons),0);
  assert.deepEqual(reasons,[]);
  const known = history([eaten('2026-11-05','lunch','salmon-miso'),eaten('2026-11-06','lunch','salmon-foil')],catalog);
  for (const candidate of [custom,alias,recipe('quick-food-grilled-skewer'),recipe('plain-rice'),{...recipe('salmon-miso'),custom:true}]) {
    assert.equal(tasteHistoryScore(candidate,known),0);
  }
  const duplicate = {recipes:[recipe('salmon-miso'),recipe('salmon-miso'),recipe('cod-salt-steam')]};
  const duplicateMeals = ['2026-11-01','2026-11-02'].map(date => eaten(date,'dinner','salmon-miso'));
  assert.equal(tasteHistoryScore(recipe('cod-salt-steam'),history(duplicateMeals,duplicate)),0);
});

test('お気に入り再登場用の実食IDも、コピー元でなく実際に食べた自作IDを返す', () => {
  assert.equal(eatenRecipeId({recipeId:'custom-home-dinner',quantity:0.5}),'custom-home-dinner');
  assert.equal(eatenRecipeId({recipeId:'salmon-miso',diningMatch:{mode:'similar'}}),null);
  assert.equal(eatenRecipeId({recipeId:'salmon-miso',ingredientEdit:{baseChanged:true}}),null);
  assert.equal(eatenRecipeId({recipeId:'salmon-miso',quantity:0}),null);
  assert.equal(eatenRecipeId({name:'さけのみそ蒸し'}),null);
});
