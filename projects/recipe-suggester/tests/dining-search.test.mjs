import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {createDiningSearch} from '../dining-search.js';
import {createCatalogEntry} from '../record-actions.js';

const data = {recipes:RECIPES, ingredients:INGREDIENTS, allergens:ALLERGENS};
const search = createDiningSearch(data);
const ids = choices => choices.map(choice => choice.recipe?.id);
const createEntry = recipeId => createCatalogEntry(
  {recipeId, date:'2026-11-18', meal:'lunch', status:'eaten', amount:1, note:'外食'}, data);

test('通常の献立と同じ全料理へ名前から到達でき、かな・食材名の積でも探せる', () => {
  for (const [query, id] of [
    ['ごはん','plain-rice'], ['オヤコドン','daily-donburi-oyako'], ['味噌ラーメン','daily-ramen-miso'],
    ['鯖の塩焼き','classic-grilled-mackerel'], ['焼き鮭','classic-grilled-salmon'],
    ['焼きシャケ','classic-grilled-salmon'], ['焼鯖','classic-grilled-mackerel'], ['塩サバ','classic-grilled-mackerel'], ['えび レタス','familiar-side-shrimp-salad'],
  ]) {
    const [first] = search(query);
    assert.ok(first,query);
    assert.equal(first.recipe.id,id,query);
    assert.equal(first.approximate,false);
  }
  assert.ok(search('ご飯',{limit:Infinity}).length > 40);
  assert.equal(new Set(search('カレー',{limit:Infinity}).map(r => r.key)).size,search('カレー',{limit:Infinity}).length);
  assert.deepEqual(search('焼き魚',{limit:2}), search('焼き魚',{limit:Infinity}).slice(0,2));
});

test('店頭の料理名で単品や近い料理を検索し、定食まるごとの一致と区別する', () => {
  for (const [query, id] of [
    ['焼き魚定食','classic-grilled-salmon'], ['唐揚げ定食','classic-karaage-thigh'],
    ['鯖塩焼きていしょく','classic-grilled-mackerel'], ['さばしおやき','classic-grilled-mackerel'], ['豚の生姜焼きランチ','pork-ginger'],
    ['濃厚味噌ラーメン','daily-ramen-miso'], ['チーズ牛丼','beef-rice-bowl'],
    ['牛丼 大盛','beef-rice-bowl'],['焼き魚定食（小盛り）','classic-grilled-salmon'],
  ]) {
    const [first] = search(query);
    assert.equal(first?.recipe.id,id,query);
    assert.equal(first.approximate,true,query);
    assert.ok(!first.name.includes('定食'));
  }
  assert.deepEqual(search('日替わり定食'),[]);
  assert.deepEqual(search('チューリップの花束'),[]);
  assert.equal(search('牛丼')[0].name,'牛丼');
  const initial = search('');
  assert.ok(initial.length > 0 && initial.length < 20);
  assert.ok(ids(initial).includes('plain-rice'));
});

test('過去に食べた店の呼び名と参照料理を検索でき、同じ外食は直近のスナップショットで1件になる', () => {
  const prior = createEntry('classic-grilled-mackerel'), recent = structuredClone(prior);
  prior.items[0].id='old';
  recent.items[0].id='new';
  for (const entry of [prior,recent]) {
    const item=entry.items[0];
    item.diningMatch={mode:'similar', actualName:'鯖の麹焼き',storeName:'港の食堂',
      referenceName:'さばの塩焼き',referenceBasis:'estimate'};
    item.name='鯖の麹焼き';
  }
  const plan=structuredClone(recent);
  plan.status='planned';plan.items[0].id='planned';
  plan.items[0].diningMatch.storeName='未訪問';
  const find=createDiningSearch(data, [prior, recent, plan]);
  for (const query of ['', '港の食堂','鯖の麹焼き','さばの塩焼き']) {
    const historical=find(query).filter(choice=>choice.item);
    assert.deepEqual(historical.map(choice=>choice.key),['history-new'],query);
    assert.match(historical[0].name,/港の食堂/);
    assert.equal(historical[0].item.recipeId,'classic-grilled-mackerel');
  }
  assert.deepEqual(find('未訪問'),[]);
});

test('更新済みの店別メニューを1件だけ表示し、削除済みの店は実績から選べる', () => {
  const standard=RECIPES.find(recipe=>recipe.id==='classic-grilled-salmon');
  const restaurant={...standard,id:'custom-restaurant-example',name:'駅前食堂｜焼き魚定食（並）',custom:true,
    restaurant:{storeName:'駅前食堂',sizeName:'並',genericRecipeId:standard.id}};
  const saved=createEntry(standard.id);
  Object.assign(saved.items[0],{recipeId:restaurant.id,name:restaurant.name,restaurant:restaurant.restaurant});
  const liveSearch=createDiningSearch({...data,recipes:[...RECIPES,restaurant]},[saved]);
  const options=liveSearch('駅前食堂 焼き魚定食');
  assert.equal(options.length,1);
  assert.equal(options[0].recipe,restaurant);
  assert.equal(options[0].approximate,false);
  assert.equal(liveSearch('焼き魚定食')[0].recipe,restaurant);
  assert.equal(createDiningSearch(data,[saved])('駅前食堂')[0].item,saved.items[0]);
});
