import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {RECIPES,INGREDIENTS} from '../data.js';
import {BREAD_RECIPES,BREAD_INGREDIENTS} from '../bread-foods.js';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/meal319-data-contract.json',import.meta.url),'utf8'));
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

test('公開済みv3.19の984料理・452食材の全項目と順序を保持する',()=>{
  assert.equal(fixture.recipeIds.length,984);assert.equal(fixture.ingredientIds.length,452);
  const ids=new Set(fixture.recipeIds),old=RECIPES.filter(recipe=>ids.has(recipe.id));
  assert.deepEqual(old.map(recipe=>recipe.id),fixture.recipeIds);
  assert.equal(hash(old),fixture.recipeHash);
  const foods=Object.fromEntries(fixture.ingredientIds.map(id=>[id,INGREDIENTS[id]]));
  assert.equal(hash(foods),fixture.ingredientHash);
  assert.equal(RECIPES.length,984+BREAD_RECIPES.length);
  assert.equal(Object.keys(INGREDIENTS).length,452+Object.keys(BREAD_INGREDIENTS).length);
  assert.equal(new Set(RECIPES.map(recipe=>recipe.id)).size,RECIPES.length);
  assert.equal(new Set(RECIPES.map(recipe=>recipe.name)).size,RECIPES.length);
});

test('新しいジャム等の原値・計算値・確認状況が栄養統合時に欠損へ置き換わらない',()=>{
  for(const [id,original] of Object.entries(BREAD_INGREDIENTS)){
    assert.ok(!fixture.ingredientIds.includes(id));
    const integrated=INGREDIENTS[id];
    for(const field of ['nutritionPerUnit','rawNutritionPerUnit','nutritionSource','rawNutritionSource','estimatedNutrients','allergensKnown','ingredientsKnown','derivedFrom'])assert.deepEqual(integrated[field],original[field],`${id}.${field}`);
  }
});
