import test from 'node:test';
import assert from 'node:assert/strict';
import { ALLERGENS, INGREDIENTS, RECIPES } from '../data.js';

const allowedGroups = new Set(['staple','vegetable','protein','dairy','fruit']);
const allowedProteins = new Set(['meat','fish','egg','soy']);
const allergenIds = new Set(ALLERGENS.map(item => item.id));
const byId = new Map(RECIPES.map(item => [item.id,item]));
const recipeAllergens = recipe => new Set(recipe.ingredients.flatMap(item => INGREDIENTS[item.id].allergens));

test('allergen choices contain the current 9 required and 20 recommended items once', () => {
  assert.equal(ALLERGENS.length,29);
  assert.equal(allergenIds.size,29);
  assert.equal(ALLERGENS.filter(item => item.category === 'required').length,9);
  assert.equal(ALLERGENS.filter(item => item.category === 'recommended').length,20);
  assert.equal(ALLERGENS.find(item => item.id === 'milk').label,'乳');
  assert.ok(allergenIds.has('pistachio'));
  assert.equal(ALLERGENS.find(item => item.id === 'cashew').category,'required');
});

test('every ingredient explicitly describes allergens and food groups', () => {
  for (const [id,item] of Object.entries(INGREDIENTS)) {
    assert.ok(item.name && item.unit,id);
    assert.ok(Array.isArray(item.allergens),id);
    assert.ok(Array.isArray(item.groups),id);
    assert.ok(Array.isArray(item.proteinSources),id);
    assert.equal(new Set(item.allergens).size,item.allergens.length,id);
    assert.ok(item.allergens.every(value => allergenIds.has(value)),id);
    assert.ok(item.groups.every(value => allowedGroups.has(value)),id);
    assert.ok(item.proteinSources.every(value => allowedProteins.has(value)),id);
  }
});

test('the expanded collection consists of distinct complete dishes', () => {
  assert.ok(RECIPES.length >= 200);
  assert.equal(new Set(RECIPES.map(item => item.id)).size,RECIPES.length);
  assert.equal(new Set(RECIPES.map(item => item.name)).size,RECIPES.length);
  assert.ok(RECIPES.filter(item => item.role === 'main').length >= 90);
  assert.ok(RECIPES.filter(item => item.role === 'side').length >= 60);
  assert.ok(RECIPES.filter(item => item.role === 'soup').length >= 40);
  for (const recipe of RECIPES) {
    assert.ok(['main','side','soup','staple'].includes(recipe.role),recipe.id);
    assert.equal(recipe.servings,2,recipe.id);
    assert.ok(Number.isFinite(recipe.minutes) && recipe.minutes > 0,recipe.id);
    assert.ok(Array.isArray(recipe.ingredients) && recipe.ingredients.length > 0,recipe.id);
    assert.equal(new Set(recipe.ingredients.map(item => item.id)).size,recipe.ingredients.length,recipe.id);
    for (const item of recipe.ingredients) {
      assert.ok(INGREDIENTS[item.id],recipe.id + ':' + item.id);
      assert.ok(Number.isFinite(item.amount) && item.amount > 0,recipe.id + ':' + item.id);
    }
    assert.ok(Array.isArray(recipe.steps) && recipe.steps.length >= (recipe.role === 'staple' ? 1 : 3),recipe.id);
    assert.ok(recipe.steps.every(step => typeof step === 'string' && step.length >= 10),recipe.id);
    assert.equal(typeof recipe.staple,'boolean',recipe.id);
  }
});

test('compound ingredients conservatively preserve their stated allergen ingredients', () => {
  const needs = {
    soy_sauce:['wheat','soy'], miso:['soy'], butter:['milk'],
    bread:['wheat','egg','milk','soy'], breadcrumbs:['wheat','egg','milk','soy'],
    mayonnaise:['egg','soy','milk','wheat'], soba:['buckwheat','wheat'],
  };
  for (const [id,expected] of Object.entries(needs)) {
    for (const allergen of expected) assert.ok(INGREDIENTS[id].allergens.includes(allergen),id + ':' + allergen);
  }
  assert.match(INGREDIENTS.curry_powder.name,/香辛料のみ/);
  assert.match(INGREDIENTS.canned_tomato.name,/トマト/);
});

test('an ingredient such as soy sauce cannot disappear from a dish allergen profile', () => {
  assert.ok(recipeAllergens(byId.get('chicken-teriyaki')).has('wheat'));
  assert.ok(recipeAllergens(byId.get('chicken-teriyaki')).has('soy'));
  assert.ok(recipeAllergens(byId.get('chicken-teriyaki')).has('chicken'));
  assert.ok(recipeAllergens(byId.get('chicken-cashew')).has('cashew'));
  assert.ok(recipeAllergens(byId.get('soba-chicken')).has('buckwheat'));
  assert.ok(recipeAllergens(byId.get('pasta-milk-salmon')).has('milk'));
  assert.ok(recipeAllergens(byId.get('pasta-milk-salmon')).has('salmon'));
  assert.deepEqual([...recipeAllergens(byId.get('cod-salt-steam'))],[]);
});

test('rice is separate from mains which already include a staple', () => {
  assert.equal(byId.get('plain-rice').role,'staple');
  assert.equal(byId.get('plain-rice').ingredients[0].id,'rice');
  for (const id of ['chicken-rice-bowl','pasta-meat','udon-pork','soba-chicken','chicken-sandwich']) {
    assert.equal(byId.get(id).staple,true,id);
    assert.ok(byId.get(id).ingredients.some(item => INGREDIENTS[item.id].groups.includes('staple')),id);
  }
  assert.equal(byId.get('chicken-teriyaki').staple,false);
});

test('seasonings do not contribute a vegetable or protein serving proxy', () => {
  for (const id of ['soy_sauce','miso','tomato_paste','garlic','ginger','scallion_garnish','sesame']) {
    assert.deepEqual(INGREDIENTS[id].groups,[],id);
  }
});


test('derived ingredients refer to known ingredients without cycles', () => {
  const visit = (id, path = new Set()) => {
    assert.ok(INGREDIENTS[id],id);
    assert.ok(!path.has(id),'cycle: ' + [...path,id].join(' → '));
    const ancestors = INGREDIENTS[id].derivedFrom ?? [];
    assert.ok(Array.isArray(ancestors),id);
    const next = new Set([...path,id]);
    for (const ancestor of ancestors) visit(ancestor,next);
  };
  for (const id of Object.keys(INGREDIENTS)) visit(id);
  assert.deepEqual(INGREDIENTS.tomato_paste.derivedFrom,['tomato']);
  assert.deepEqual(INGREDIENTS.canned_tomato.derivedFrom,['tomato']);
  assert.deepEqual(INGREDIENTS.raisin.derivedFrom,['grape']);
  assert.deepEqual(INGREDIENTS.kiriboshi_daikon.derivedFrom,['daikon']);
  assert.deepEqual(INGREDIENTS.tofu.derivedFrom,['soybeans']);
  assert.deepEqual(INGREDIENTS.cheese.derivedFrom,['milk']);
});

test('instructions use proportions instead of absolute ingredient quantities', () => {
  for (const recipe of RECIPES) {
    for (const step of recipe.steps) {
      assert.ok(!/\d+\s*(?:g|ml|個|枚|皿|人分|つ)/.test(step),recipe.id + ': ' + step);
    }
  }
});

test('the original mood choices are available on mains and have consistent meanings', () => {
  const moodTags = new Set(['さっぱり','ガッツリ','時短','定番']);
  for (const recipe of RECIPES) {
    assert.ok(recipe.tags.every(tag => moodTags.has(tag)),recipe.id);
    assert.equal(new Set(recipe.tags).size,recipe.tags.length,recipe.id);
    if (recipe.role === 'staple') assert.deepEqual(recipe.tags,[],recipe.id);
    else assert.equal(recipe.tags.includes('時短'),recipe.minutes <= 20,recipe.id);
  }
  for (const tag of moodTags) {
    assert.ok(RECIPES.filter(recipe => recipe.role === 'main' && recipe.tags.includes(tag)).length >= 5,tag);
  }
  assert.ok(byId.get('chicken-salt-lemon').tags.includes('さっぱり'));
  assert.ok(byId.get('beef-rice-bowl').tags.includes('ガッツリ'));
  assert.ok(byId.get('pork-ginger').tags.includes('時短'));
  assert.ok(byId.get('chicken-teriyaki').tags.includes('定番'));
  assert.ok(!byId.get('chicken-root-simmer').tags.includes('時短'));
});

test('five cuisine choices include explicitly classified ethnic dishes while retaining other dishes', () => {
  const genres = new Set(['和食','洋食','中華','エスニック','その他']);
  assert.deepEqual(new Set(RECIPES.map(recipe => recipe.genre)),genres);
  assert.ok(RECIPES.filter(recipe => recipe.role === 'main' && recipe.genre === 'エスニック').length >= 5);
  for (const id of ['chicken-curry-yogurt','tomato-chicken-curry','side-019','soup-021']) {
    assert.equal(byId.get(id).genre,'エスニック',id);
  }
  assert.equal(byId.get('side-033').genre,'その他');
  assert.equal(byId.get('soup-032').genre,'その他');
  assert.equal(byId.get('rice-baked-cheese').genre,'洋食');
  assert.equal(byId.get('chicken-teriyaki').genre,'和食');
});
