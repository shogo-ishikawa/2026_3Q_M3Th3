import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {CATALOG_CATEGORIES, catalogFamilies, catalogVariants, recipeFamily, recipePortion, quantityFromAmount} from '../catalog.js';
import {decorateRecipe} from '../catalog-metadata.js';
import {groupMenuRecipes, getVariationGroup} from '../menu-variations.js';
import {browseDishes, dishSection} from '../dish-hierarchy.js';
import {defaultJournal, parseJournal} from '../journal.js';
import {createCatalogEntry} from '../record-actions.js';

const data={recipes:RECIPES, ingredients:INGREDIENTS, allergens:ALLERGENS};
const soup=RECIPES.filter(recipe=>recipe.role==='soup');
const byId=id=>RECIPES.find(recipe=>recipe.id===id);

test('86品の汁物を10小分類へ重複なく分け、記録とメニューの同じ候補を返す',()=>{
  const before=JSON.stringify(RECIPES),families=catalogFamilies(RECIPES,{role:'soup'});
  assert.equal(soup.length,86);assert.equal(families.length,10);
  const ids=families.flatMap(family=>catalogVariants(RECIPES,family.id).map(recipe=>recipe.id));
  assert.equal(ids.length,86);assert.equal(new Set(ids).size,86);
  assert.deepEqual(new Set(ids),new Set(browseDishes(RECIPES,{section:'soup'}).map(recipe=>recipe.id)));
  assert.equal(families.reduce((total,family)=>total+family.count,0),86);
  for(const family of families){
    const members=catalogVariants(RECIPES,family.id);
    assert.equal(members.length,family.count);assert.ok(members.every(recipe=>dishSection(recipe)==='soup'));
    const menus=groupMenuRecipes(members),flattened=menus.flatMap(menu=>menu.recipes.map(recipe=>recipe.id));
    assert.deepEqual(new Set(flattened),new Set(members.map(recipe=>recipe.id)));
    assert.equal(flattened.length,members.length);
  }
  assert.equal(JSON.stringify(RECIPES),before);
});

test('和風・洋風・中華・エスニックと調理法で、紛らわしい汁物を選び分ける',()=>{
  const expectations={
    'daily-miso-tonjiru':'miso-soup','soup311-osuimono-asari':'clear-soup','soup-027':'clear-soup',
    'soup311-arajiru-buri':'arajiru','soup311-consomme-vegetable':'consomme-soup',
    'familiar-side-onion-gratin-soup':'consomme-soup','familiar-side-pot-au-feu':'vegetable-soup',
    'soup-031':'vegetable-soup','calendar-soup-lettuce-tofu':'vegetable-soup',
    'soup311-pumpkin-milk-potage':'potage','familiar-side-clam-chowder':'creamy-soup',
    'soup311-clam-chowder-tomato':'creamy-soup','soup-024':'creamy-soup',
    'soup311-wonton-pork':'chinese-soup','soup-034':'chinese-soup',
    'varied-yukgaejang-soup':'ethnic-soup','world-tomyum-kung':'ethnic-soup','soup-032':'soup',
  };
  for(const [id,family]of Object.entries(expectations))assert.equal(recipeFamily(byId(id)),family,id);
  assert.equal(recipeFamily(byId('daily-ramen-miso')),'ramen','みそラーメンは汁物へ移さない');
  assert.equal(dishSection(byId('familiar-yose-nabe')),'main','鍋料理の役割は変えない');
});

test('カップスープと春雨スープの味違いを小分類で分断せず、提供形態でも絞れる',()=>{
  const families=catalogFamilies(RECIPES,{role:'soup',nature:'instant'});
  assert.deepEqual(families.map(family=>family.id),['potage','chinese-soup']);
  assert.equal(catalogVariants(RECIPES,'potage',{nature:'instant'}).length,6);
  assert.equal(catalogVariants(RECIPES,'chinese-soup',{nature:'instant'}).length,5);
  for(const id of ['takeaway-knorr-corn','takeaway-knorr-tomato'])assert.equal(getVariationGroup(id,catalogVariants(RECIPES,'potage')).variantCount,6);
  assert.equal(getVariationGroup('takeaway-harusame-wonton',catalogVariants(RECIPES,'chinese-soup')).variantCount,5);
  assert.equal(getVariationGroup('soup311-arajiru-buri',catalogVariants(RECIPES,'arajiru')).variantCount,2);
  assert.equal(getVariationGroup('soup311-clam-chowder-tomato',catalogVariants(RECIPES,'creamy-soup')).variantCount,2);
});

test('分類名の検索からも候補を探せ、空の分類や異なる料理を混ぜない',()=>{
  const cream=catalogFamilies(RECIPES,{role:'soup',query:'チャウダー'});
  assert.deepEqual(cream.map(family=>family.id),['creamy-soup']);
  assert.ok(catalogVariants(RECIPES,'creamy-soup',{query:'チャウダー'}).some(recipe=>recipe.id==='familiar-side-clam-chowder'));
  assert.deepEqual(catalogFamilies(RECIPES,{role:'soup',query:'コンソメ'}).map(family=>family.id),['consomme-soup']);
  assert.equal(catalogFamilies(RECIPES,{role:'soup',query:'存在しない汁物xyz'}).length,0);
  for(const family of CATALOG_CATEGORIES.filter(category=>category.role==='soup'))assert.ok(catalogVariants(RECIPES,family.id).length>0,family.id);
});

test('旧データの大まかなfamilyを維持し、表示と単位だけを新しい小分類から求める',()=>{
  for(const recipe of soup){
    assert.ok(['soup','miso-soup'].includes(recipe.family),recipe.id);
    const decorated=decorateRecipe(recipe);
    assert.deepEqual(decorated,recipe,recipe.id);
    assert.equal(recipePortion(recipe,data).unit,'杯',recipe.id);
    assert.equal(quantityFromAmount(recipe,data,.5),.5,recipe.id);
  }
  const custom={id:'custom-soup',name:'私のかぼちゃポタージュ',role:'soup',family:'soup',custom:true,servings:1,ingredients:[],steps:[]};
  assert.equal(recipeFamily(custom),'potage');assert.equal(decorateRecipe(custom).family,'soup');
  assert.equal(recipeFamily({...custom,name:'私のスープ',family:'creamy-soup'}),'creamy-soup');
  assert.equal(recipeFamily({...custom,name:'私のスープ'}),'soup');
});

test('記録の栄養・量・材料を保ったまま新しい小分類のマイレシピも保存できる',()=>{
  const state=defaultJournal('2026-11-13');
  state.entries=soup.map(recipe=>createCatalogEntry({recipeId:recipe.id,date:'2026-11-13',meal:'dinner',status:'eaten',amount:.5},data));
  const restored=parseJournal(JSON.stringify(state),data);
  assert.deepEqual(restored.entries,state.entries);
  state.customRecipes=[{id:'custom-cream',name:'私のクリームスープ',role:'soup',family:'creamy-soup',servings:1,custom:true,ingredients:[],steps:[],manualNutrition:{kcal:120,protein:null,fat:null,carbs:null,fiber:null,salt:null}}];
  const saved=parseJournal(JSON.stringify(state),data).customRecipes[0];
  assert.equal(saved.family,'creamy-soup');assert.equal(recipePortion(saved,data).unit,'杯');
});
