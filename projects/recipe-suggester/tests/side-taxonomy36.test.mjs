import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {decorateRecipe} from '../catalog-metadata.js';
import {catalogVariants,recipePortion} from '../catalog.js';
import {browseDishes,dishClassification,dishSection} from '../dish-hierarchy.js';
import {eligibleRecipes} from '../planner.js';
import {recipeNutrition,itemNutrition} from '../nutrition.js';
import {defaultJournal,parseJournal} from '../journal.js';
import {createCatalogEntry} from '../record-actions.js';
import {matchesJapaneseQuery,normaliseJapaneseSearch} from '../japanese-search.js';
import {ACCOMPANIMENT_INGREDIENTS,ACCOMPANIMENT_RECIPES} from '../accompaniment-foods.js';
import {SALAD_INGREDIENTS} from '../salad-builder.js';

const data={allergens:ALLERGENS,ingredients:INGREDIENTS,recipes:RECIPES};
const ids=['classic-boiled-egg','classic-natto-plain','classic-natto-grated-daikon'];
const get=id=>{const recipe=RECIPES.find(recipe=>recipe.id===id);assert.ok(recipe,id);return recipe;};
const contains=(recipes,id)=>recipes.some(recipe=>recipe.id===id);

test('納豆2品とゆで卵を少量の副菜へまとめ、材料と食べる量はv3.5から変えない',()=>{
  const recipes=ids.map(get);
  // v3.5.0公開DBで分類変更前に計算。許容する差分はroleとfamilyだけです。
  const core=recipes.map(({family,role,...recipe})=>recipe);
  assert.equal(createHash('sha256').update(JSON.stringify(core)).digest('hex'),'03668799022f23ad7e820755081489bb83b46cf10978d7ac6d31ad87dd1eb483');
  for(const recipe of recipes){
    assert.equal(recipe.role,'side',recipe.id);
    assert.equal(recipe.family,'small-dish',recipe.id);
    assert.equal(recipe.staple,false,recipe.id);
    assert.equal(recipe.mealBase,false,recipe.id);
    assert.deepEqual(decorateRecipe(recipe),recipe);
  }
  assert.equal(recipePortion(get(ids[0]),data).unit,'個');
  assert.equal(recipePortion(get(ids[0]),data).amount,1);
  assert.equal(recipeNutrition(get(ids[0]),data).kcal,71);
});

test('記録とメニューの副菜→食材→調理法から3品へ到達し、主菜から外れる',()=>{
  for(const[id,category,method]of [[ids[0],'egg','boil'],[ids[1],'bean','cold'],[ids[2],'bean','cold']]){
    const recipe=get(id),classification=dishClassification(recipe);
    assert.equal(dishSection(recipe),'side',id);
    assert.equal(classification.category,category,id);
    assert.equal(classification.method,method,id);
    assert.ok(contains(browseDishes(RECIPES,{section:'side',category,method}),id),id);
    assert.ok(!contains(browseDishes(RECIPES,{section:'main'}),id),id);
    assert.ok(contains(catalogVariants(RECIPES,'small-dish'),id),id);
  }
  assert.equal(dishSection(get('tofu-natto-rice')),'staple');
  assert.equal(get('classic-natto-yam-pan-fry').role,'main');
  assert.equal(get('classic-natto-yam-pan-fry').family,'bean-main');
});

test('自動献立でも3品は副菜候補になり、アレルギーの除外条件は保つ',()=>{
  const mains=eligibleRecipes({},data,{role:'main'}),sides=eligibleRecipes({},data,{role:'side'});
  for(const id of ids){assert.ok(!contains(mains,id),id);assert.ok(contains(sides,id),id);}
  const excluded=eligibleRecipes({allergens:['egg','soy']},data,{role:'side'});
  for(const id of ids)assert.ok(!contains(excluded,id),id);
});

test('過去の主菜スナップショットを保持し、新しいゆで卵2個の記録だけ副菜にする',()=>{
  const current=createCatalogEntry({recipeId:ids[0],date:'2026-11-13',meal:'breakfast',status:'eaten',amount:2},data);
  const old=structuredClone(current);old.id='old-main-egg';old.items[0].id='old-main-egg-item';old.items[0].role='main';
  const state=defaultJournal('2026-11-13');state.entries=[old,current];
  const restored=parseJournal(JSON.stringify(state),data);
  assert.deepEqual(restored.entries,state.entries);
  assert.equal(restored.entries[0].items[0].role,'main');
  assert.equal(restored.entries[1].items[0].role,'side');
  assert.equal(itemNutrition(restored.entries[1].items[0]).kcal,142);
  assert.equal(restored.entries[1].items[0].ingredients[0].amount,1);
  assert.equal(restored.entries[1].items[0].quantity,2);
});

test('ご飯のお供を漢字・かな・商品名でも探せ、油漬けと水煮を同一視しない',()=>{
  for(const group of [
    ['ツナ','シーチキン','つな','ｼｰﾁｷﾝ'],
    ['油漬け','あぶらづけ','オイル漬け'],
    ['生卵','生玉子','なまたまご'],
    ['温泉卵','温泉玉子','おんせんたまご','温玉','おんたま'],
    ['味付けのり','味付海苔','あじつけのり'],
    ['辛子明太子','からしめんたいこ','カラシメンタイコ'],
  ])for(const target of group)for(const query of group)assert.ok(matchesJapaneseQuery(target,query),`${target} / ${query}`);
  assert.notEqual(normaliseJapaneseSearch('ツナ油漬け'),normaliseJapaneseSearch('ツナ水煮'));
  assert.ok(!matchesJapaneseQuery('ツナ（油漬け）','水煮'));
  assert.ok(!matchesJapaneseQuery('ツナ（水煮・ノンオイル）','油漬け'));
  assert.ok(!matchesJapaneseQuery('温泉卵','生卵'));
});

test('追加したご飯のお供の表示名と食材名をかなで検索でき、単品ごとに副菜へ到達する',()=>{
  for(const name of [...ACCOMPANIMENT_RECIPES.map(recipe=>recipe.name),...Object.values(ACCOMPANIMENT_INGREDIENTS).map(ingredient=>ingredient.name)]){
    assert.doesNotMatch(normaliseJapaneseSearch(name),/\p{Script=Han}/u,name);
  }
  const found=query=>browseDishes(ACCOMPANIMENT_RECIPES,{section:'side',query}).map(recipe=>recipe.id).sort();
  assert.deepEqual(found('シーチキン'),['acmp-tuna-oil','acmp-tuna-water']);
  assert.deepEqual(found('ノンオイル'),['acmp-tuna-water']);
  for(const[id,query]of [
    ['acmp-egg-raw','なまたまご'],['acmp-onsen-egg','温玉'],
    ['acmp-seasoned-nori','あじつけのり'],['acmp-tarako','たらこ'],
    ['acmp-mentaiko','からしめんたいこ'],['acmp-salmon-flakes','しゃけふれーく'],
  ])assert.ok(found(query).includes(id),`${id} / ${query}`);
  assert.deepEqual(browseDishes(ACCOMPANIMENT_RECIPES,{section:'main'}),[]);
});

test('選べるサラダの新食材も漢字とかなで検索でき、ゆでた花序の状態を保つ',()=>{
  for(const ingredient of Object.values(SALAD_INGREDIENTS))assert.doesNotMatch(normaliseJapaneseSearch(ingredient.name),/\p{Script=Han}/u,ingredient.name);
  const broccoli=Object.values(SALAD_INGREDIENTS).find(ingredient=>ingredient.name==='ブロッコリー（花序・ゆで）');
  assert.ok(broccoli);
  assert.ok(matchesJapaneseQuery(broccoli.name,'ぶろっこりー かじょ ゆで'));
  assert.ok(!matchesJapaneseQuery(broccoli.name,'生'));
});

test('ツナの別名検索を小松菜の末尾に一致させず、小松菜の読み検索は維持する',()=>{
  for(const query of ['ツナ','つな','シーチキン','ｼｰﾁｷﾝ']){
    assert.ok(!matchesJapaneseQuery('小松菜のミルク煮',query),query);
    assert.ok(!matchesJapaneseQuery('こまつなのみるくに',query),query);
    assert.ok(!matchesJapaneseQuery(['野菜の煮物','小松菜'],query),query);
    assert.ok(matchesJapaneseQuery(['小松菜とツナのサラダ'],query),query);
    assert.ok(matchesJapaneseQuery(['野菜のサラダ','ツナ（水煮）'],query),query);
  }
  assert.ok(matchesJapaneseQuery('小松菜のミルク煮','こまつな'));
  assert.ok(matchesJapaneseQuery('こまつなのみるくに','小松菜'));
  assert.ok(matchesJapaneseQuery('小松菜とツナのサラダ','小松菜 シーチキン'));
  assert.ok(!matchesJapaneseQuery('小松菜だけのサラダ','小松菜 シーチキン'));
});

test('全メニューでシーチキンを探すと単品のツナ2種を先頭にし、ツナ料理も残す',()=>{
  const named=RECIPES.map(recipe=>({...recipe,ingredients:recipe.ingredients.map(part=>({...part,name:INGREDIENTS[part.id]?.name??part.id}))}));
  const reference=browseDishes(named,{query:'シーチキン'});
  assert.deepEqual(reference.slice(0,2).map(recipe=>recipe.id),['acmp-tuna-oil','acmp-tuna-water']);
  assert.ok(contains(reference,'daily-onigiri-tuna-mayo'));
  assert.ok(contains(reference,'daily-pasta-tuna-tomato'));
  assert.ok(contains(reference,'classic-side-daikon-tuna'));
  assert.ok(!contains(reference,'salmon-milk'));
  assert.ok(!contains(reference,'classic-side-komatsuna-ohitashi'));
  for(const query of ['ツナ','つな','ｼｰﾁｷﾝ'])assert.deepEqual(browseDishes(named,{query}).map(recipe=>recipe.id),reference.map(recipe=>recipe.id),query);
  assert.ok(browseDishes(named,{query:'こまつな'}).some(recipe=>recipe.id==='salmon-milk'));
});
