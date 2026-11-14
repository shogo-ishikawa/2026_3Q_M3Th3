import test from 'node:test';
import assert from 'node:assert/strict';
import {RECIPES, INGREDIENTS} from '../data.js';
import {browseDishes, dishSection} from '../dish-hierarchy.js';
import {catalogFamilies, catalogVariants, recipeFamily} from '../catalog.js';
import {groupMenuRecipes, variationSearchAliases} from '../menu-variations.js';
import {matchesJapaneseQuery, normaliseJapaneseSearch} from '../japanese-search.js';
import {recipeArtwork} from '../recipe-illustration.js';
import {BREAD_RECIPES, BREAD_INGREDIENTS} from '../bread-foods.js';
import {getVariationGroup, validateVariationDefinitions} from '../menu-variations.js';

const pizzaIds=['daily-pizza-margherita','daily-pizza-mixed','daily-pizza-teriyaki','daily-pizza-seafood'];
const enriched=()=>RECIPES.map(recipe=>({...recipe,searchAliases:[...(recipe.searchAliases??[]),...variationSearchAliases(recipe)],
  ingredients:recipe.ingredients.map(part=>({...part,name:INGREDIENTS[part.id]?.name??part.id}))}));
const ids=recipes=>recipes.map(recipe=>recipe.id);

test('ピザはすべて・主食の両方から検索でき、元の4種類を一つのピザメニューに保つ',()=>{
  const before=JSON.stringify(RECIPES),view=enriched();
  for(const section of ['all','staple']){
    const expected=ids(browseDishes(view,{section,query:'ピザ'}));
    for(const id of pizzaIds)assert.ok(expected.includes(id),`${section}: ${id}`);
    for(const query of ['ぴざ','ﾋﾟｻﾞ'])assert.deepEqual(ids(browseDishes(view,{section,query})),expected,query);
    const realPizza=browseDishes(view,{section,query:'ピザ'}).filter(recipe=>recipeFamily(recipe)==='pizza');
    assert.deepEqual(ids(realPizza),pizzaIds);
    const groups=groupMenuRecipes(realPizza,{query:'ピザ'});
    assert.equal(groups.length,1);assert.equal(groups[0].label,'ピザ');
    assert.deepEqual(ids(groups[0].recipes),pizzaIds);
  }
  assert.ok(catalogFamilies(view,{role:'staple',query:'ピザ'}).some(family=>family.id==='pizza'&&family.count===4));
  assert.deepEqual(ids(catalogVariants(view,'pizza',{query:'ピザ'})),pizzaIds);
  assert.deepEqual(browseDishes(view,{section:'drink',query:'ピザ'}),[]);
  assert.equal(JSON.stringify(RECIPES),before);
});

test('ピザの検索候補とイラストの有無は別条件で、未対応の絵を流用しない',()=>{
  const pizzas=RECIPES.filter(recipe=>pizzaIds.includes(recipe.id));
  assert.equal(pizzas.length,4);
  for(const recipe of pizzas){assert.equal(dishSection(recipe),'staple');assert.equal(recipeArtwork(recipe),null);}
  assert.equal(browseDishes(enriched(),{query:'ピザ'}).filter(recipe=>recipeArtwork(recipe)).length,0);
});

test('お刺身・お刺し身・御刺身は共通の検索で刺身と同じ候補へ到達する',()=>{
  const source='まぐろの刺身';
  for(const query of ['刺身','刺し身','お刺身','お刺し身','御刺身','おさしみ','オサシミ']){
    assert.equal(normaliseJapaneseSearch(query),normaliseJapaneseSearch('刺身'),query);
    assert.ok(matchesJapaneseQuery(source,query),query);
    assert.deepEqual(ids(browseDishes(enriched(),{query})),ids(browseDishes(enriched(),{query:'刺身'})),query);
  }
  assert.ok(!matchesJapaneseQuery('ぶりの照り焼き','お刺身'));
  for(const query of ['寿司','鮨','お寿司','おすし'])assert.ok(matchesJapaneseQuery('まぐろのにぎり寿司',query),query);
  assert.notEqual(normaliseJapaneseSearch('おでん'),normaliseJapaneseSearch('でん'),'料理名のおを一般的に削らない');
});

test('ホットサンドとピザトーストはパンの主食として探し、本来のピザへ統合しない',()=>{
  for(const id of ['chicken-sandwich','breakfast-egg-sandwich']){
    const recipe=RECIPES.find(row=>row.id===id);assert.ok(recipe,id);
    assert.equal(recipe.role,'main','保存済みデータの旧roleは変えない');
    assert.equal(recipeFamily(recipe),'bread');assert.equal(dishSection(recipe),'staple');
  }
  const sample={id:'custom-pizza-toast',name:'ピザトースト',role:'staple',family:'bread',custom:true,staple:true,mealBase:false,
    ingredients:[],servings:1,nature:'home-cooked'};
  assert.equal(recipeFamily(sample),'bread');
  assert.equal(browseDishes([sample],{section:'staple',query:'ピザ'}).length,1);
  assert.equal(catalogVariants([sample],'pizza',{query:'ピザ'}).length,0);
  assert.notEqual(groupMenuRecipes([sample])[0].groupId,'pizza');
});

const breadCatalogue=()=>[...new Map([...RECIPES,...BREAD_RECIPES].map(recipe=>[recipe.id,recipe])).values()];

test('パンの新しい種類を既存の見出しへまとめ、標準プリセットから開ける',()=>{
  const recipes=breadCatalogue(),before=JSON.stringify(recipes),groups=groupMenuRecipes(recipes);
  for(const [groupId,count] of [['hot-sandwich',13],['toast',12],['sandwich',7],['english-muffin',6]]){
    const group=groups.find(row=>row.groupId===groupId);assert.ok(group,groupId);assert.equal(group.variantCount,count,groupId);
  }
  assert.equal(groups.find(row=>row.groupId==='hot-sandwich').selectedRecipeId,'bread-hot-sandwich-ham-cheese');
  assert.equal(groups.find(row=>row.groupId==='english-muffin').selectedRecipeId,'bread-english-muffin-ham-cheese');
  assert.equal(getVariationGroup('bread-toast-pizza',recipes).groupId,'toast');
  const pizza=getVariationGroup('daily-pizza-margherita',recipes);
  assert.deepEqual(ids(pizza.recipes),pizzaIds);assert.ok(!ids(pizza.recipes).includes('bread-toast-pizza'));
  for(const recipe of BREAD_RECIPES)assert.equal(dishSection(recipe),'staple',recipe.id);
  assert.equal(JSON.stringify(recipes),before);
});

test('英マフィンのパンだけと具入りを同じ入口で選んでも、提供形態による絞り込みを保つ',()=>{
  const recipes=breadCatalogue(),plain=recipes.find(row=>row.id==='palette-english-muffin');
  const assembled=recipes.find(row=>row.id==='bread-english-muffin-ham-cheese');
  assert.equal(plain.nature,'ready-to-eat');assert.equal(plain.mealBase,false);
  assert.equal(assembled.nature,'home-cooked');assert.equal(assembled.mealBase,true);
  const ready=browseDishes(recipes,{section:'staple',query:'イングリッシュマフィン',nature:'ready-to-eat'});
  assert.deepEqual(ids(ready),['palette-english-muffin']);
  assert.deepEqual(ids(getVariationGroup(plain.id,ready).recipes),['palette-english-muffin']);
  const cooked=browseDishes(recipes,{section:'staple',query:'イングリッシュマフィン',nature:'home-cooked'});
  assert.equal(cooked.length,5);assert.ok(cooked.every(recipe=>recipe.id!==plain.id));
  assert.equal(getVariationGroup(assembled.id,cooked).variantCount,5);
  for(const changed of [{...plain,nature:'home-cooked'},{...plain,mealBase:true},{...assembled,nature:'ready-to-eat'},{...assembled,mealBase:false}]){
    assert.equal(getVariationGroup(changed.id,[changed]),null,'IDだけでは違う状態の料理を同じ入口へ入れない');
  }
  for(const recipeProfiles of [[],{'not-in-group':{nature:'ready-to-eat'}},{a:{role:'main'}},{a:{nature:'unknown'}},{a:{mealBase:1}}]){
    assert.throws(()=>validateVariationDefinitions([{id:'test',label:'test',recipeIds:['a'],recipeProfiles}]),/条件/);
  }
});

test('追加したパンの完成名と食材を全文かなで検索できる',()=>{
  for(const item of [...BREAD_RECIPES,...Object.values(BREAD_INGREDIENTS)])assert.ok(!/\p{Script=Han}/u.test(normaliseJapaneseSearch(item.name)),item.name);
  assert.ok(matchesJapaneseQuery('ホットサンド（具材を指定する）','ほっとさんど ぐざいをしていする'));
  assert.ok(matchesJapaneseQuery('いちごジャム（高糖度・代表値）','こうとうど'));
});
