import test from 'node:test';
import assert from 'node:assert/strict';
import {RECIPES} from '../data.js';
import {decorateRecipe} from '../catalog-metadata.js';
import {CATALOG_CATEGORIES, FOOD_NATURES, catalogVariants, isCompleteMeal, recipeNature} from '../catalog.js';

const decorated = RECIPES.map(decorateRecipe);
const byId = id => decorated.find(recipe=>recipe.id===id);

test('metadata decoration preserves source recipes, nutrition and all stable IDs', () => {
  const metadataKeys = new Set(['family','variantLabel','genre','nature','role','staple','mealBase','portion']);
  const sourceFields = recipe=>Object.fromEntries(Object.entries(recipe).filter(([key])=>!metadataKeys.has(key)));
  const before = structuredClone(RECIPES);
  for (let i=0;i<RECIPES.length;i++) {
    assert.notEqual(decorated[i],RECIPES[i]);
    assert.deepEqual(sourceFields(decorated[i]),sourceFields(RECIPES[i]),RECIPES[i].id);
    assert.equal(decorated[i].id,RECIPES[i].id);
    assert.equal(decorated[i].name,RECIPES[i].name);
  }
  assert.deepEqual(RECIPES,before);
  assert.equal(new Set(decorated.map(r=>r.id)).size,decorated.length);
  assert.equal(new Set(decorated.map(r=>r.name)).size,decorated.length);
});

test('every built-in has a registered family and explicit cooking form after audit', () => {
  const families=new Set(CATALOG_CATEGORIES.map(f=>f.id));
  const natures=new Set(FOOD_NATURES.map(n=>n.id));
  for (const recipe of decorated) {
    assert.ok(families.has(recipe.family),recipe.id);
    assert.ok(natures.has(recipe.nature),recipe.id);
    assert.notEqual(recipe.nature,'unspecified',recipe.id);
    assert.ok(typeof recipe.variantLabel==='string' && recipe.variantLabel.trim(),recipe.id);
    assert.equal(typeof recipe.mealBase,'boolean',recipe.id);
    assert.deepEqual(decorateRecipe(recipe),recipe,'idempotent: '+recipe.id);
  }
});

test('canteen small dishes share a family and no longer behave as snacks or full mains', () => {
  const ids=['snack-edamame','snack-soybean','breakfast-natto-okra','side-001','side-029',
    'side-030','side-037','side-044','side-049','daily-snack-bacon-cheese-roll'];
  for (const id of ids) {
    const recipe=byId(id);
    assert.equal(recipe.family,'small-dish',id);
    assert.equal(recipe.role,'side',id);
    assert.equal(recipe.staple,false,id);
    assert.equal(isCompleteMeal(recipe),false,id);
  }
  assert.ok(catalogVariants(decorated,'small-dish',{query:'枝豆'}).some(r=>r.id==='snack-edamame'));
  assert.ok(!catalogVariants(decorated,'snack').some(r=>r.id==='snack-edamame'));
  assert.equal(byId('daily-snack-oven-karaage').family,'karaage');
  assert.equal(byId('daily-snack-oven-karaage').role,'main');
  for (const id of ['daily-snack-oven-chicken','daily-snack-oven-fries','daily-snack-takoyaki']) {
    assert.equal(byId(id).family,'hot-snack',id);
  }
});

test('legacy omelette rice and flour dishes do not acquire plain rice portions', () => {
  assert.equal(byId('rice-egg-omelette').family,'omelette-rice');
  assert.equal(byId('rice-flour-chijimi').family,'other-staple');
  assert.equal(byId('breakfast-banana-pancake').family,'other-staple');
  assert.equal(byId('salmon-fried-rice').family,'rice');
  assert.equal(byId('plain-rice').family,'rice');
  assert.equal(byId('staple-salt-onigiri').family,'onigiri');
});

test('cooking forms distinguish store-bought portions from home recipes of the same kind', () => {
  assert.equal(byId('daily-snack-butter-cookie').nature,'ready-to-eat');
  assert.equal(byId('daily-snack-chocolate-cookie').nature,'home-cooked');
  assert.equal(byId('daily-snack-vanilla-ice').nature,'ready-to-eat');
  assert.equal(byId('daily-snack-cocoa-ice').nature,'home-cooked');
  assert.equal(byId('daily-snack-custard-pudding').nature,'home-cooked');
  assert.equal(byId('daily-snack-oven-chicken').nature,'home-cooked');
  assert.equal(byId('snack-almond').nature,'ready-to-eat');
  assert.equal(byId('snack-edamame').nature,'home-cooked');
  assert.equal(byId('daily-snack-takoyaki').genre,'和食');
  assert.equal(byId('daily-snack-pork-bun').genre,'中華');
  assert.equal(byId('daily-snack-custard-pudding').genre,'洋食');
});

test('explicit processed-food uncertainty and personal metadata are preserved', () => {
  const ingredients=Object.freeze([Object.freeze({id:'generic_product',amount:100})]);
  const source=Object.freeze({id:'prepared-example',name:'レトルトカレー',role:'staple',staple:true,
    family:'curry',servings:1,nature:'retort',ingredients,allergensKnown:false,
    ingredientsKnown:false,manualNutrition:Object.freeze({kcal:320}),
    portion:Object.freeze({amount:1,unit:'食'}),sourceNote:'商品によって異なる'});
  const result=decorateRecipe(source);
  assert.equal(result.nature,'retort');
  assert.equal(result.allergensKnown,false);
  assert.equal(result.ingredientsKnown,false);
  assert.equal(result.manualNutrition,source.manualNutrition);
  assert.equal(result.ingredients,ingredients);
  assert.deepEqual(result.portion,source.portion);
  assert.notEqual(result.portion,source.portion);
  const custom=decorateRecipe({...source,id:'custom-personal',custom:true,nature:undefined});
  assert.equal(recipeNature(custom),'unspecified');
  assert.equal(decorateRecipe({...source,custom:true,nature:'fast-food'}).nature,'fast-food');
  assert.throws(()=>decorateRecipe(null));
  assert.throws(()=>decorateRecipe({family:'not-registered'}));
  assert.throws(()=>decorateRecipe({...source,nature:'healthy'}));
});
