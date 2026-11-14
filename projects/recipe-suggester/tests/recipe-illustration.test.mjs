import test from 'node:test';
import assert from 'node:assert/strict';
import {RECIPES,INGREDIENTS,ALLERGENS} from '../data.js';
import {describeRecipe} from '../planner.js';
import {recipeArtwork} from '../recipe-illustration.js';
import {RECIPE_ARTWORK} from '../recipe-artwork-manifest.js';

const recipe=id=>{const value=RECIPES.find(row=>row.id===id);assert.ok(value,id);return value;};
const data={recipes:RECIPES,ingredients:INGREDIENTS,allergens:ALLERGENS};
const artworkFor=id=>({src:`assets/recipe-art/${id}.webp`,largeSrc:`assets/recipe-art/${id}-large.webp`,name:recipe(id).name,width:640,height:480});
const first=recipe('chicken-teriyaki'),second=recipe('chicken-tomato');
const fixture=Object.freeze({[first.id]:Object.freeze(artworkFor(first.id)),[second.id]:Object.freeze(artworkFor(second.id))});
const choose=source=>recipeArtwork(source,{artwork:fixture});

test('個別のレシピIDにだけ完成イメージを対応させ、料理や画像の定義を変更しない',()=>{
  const before=JSON.stringify(RECIPES),source=structuredClone(first),images=structuredClone(fixture);
  const result=choose(source);
  assert.deepEqual(result,{...artworkFor(first.id),recipeId:first.id});
  result.src='changed.webp';assert.equal(choose(source).src,fixture[first.id].src);
  assert.deepEqual(fixture,images);assert.deepEqual(source,first);assert.equal(JSON.stringify(RECIPES),before);
});

test('同じ分類や似た名前の別料理へ絵を使い回さず、画像のない料理はnullにする',()=>{
  assert.equal(choose(recipe('chicken-steam')),null);
  assert.equal(choose({...first,id:'custom-teriyaki'}),null);
  assert.equal(choose({id:'unknown',name:first.name,family:first.family,role:first.role,ingredients:first.ingredients,servings:first.servings}),null);
  for(const input of [null,undefined,[],42,{}, {id:'__proto__'}])assert.equal(choose(input),null);
});

test('アレンジ・手入力・保存済みスナップショットへ標準料理の絵を後付けしない',()=>{
  assert.equal(choose({...first,custom:true}),null);
  assert.equal(choose({...first,nutrition:{kcal:300}}),null);
  assert.equal(choose({...first,quantity:1}),null);
  const changed=structuredClone(first);changed.ingredients[0].amount+=10;
  assert.equal(choose(changed),null);
  assert.equal(choose({...first,servings:first.servings+1}),null);
  assert.equal(choose({...first,name:`${first.name}（アレンジ）`}),null);
  assert.equal(choose({...first,manualNutrition:{kcal:300}}),null);
  assert.equal(choose({...first,manualNutrition:null}),null);
});

test('DB閲覧用の食材名や祖先情報の追加は許容し、表示順で料理の対応を変えない',()=>{
  const described=describeRecipe(first.id,data);
  assert.equal(choose(described).recipeId,first.id);
  const source={...described,ingredients:described.ingredients.map(part=>({...part,name:INGREDIENTS[part.id].name})).reverse()};
  const before=structuredClone(source);assert.equal(choose(source).src,fixture[first.id].src);assert.deepEqual(source,before);
});

test('画像の定義が別料理・外部URL・不正なサイズを指す場合は表示しない',()=>{
  for(const patch of [
    {src:fixture[second.id].src}, {largeSrc:'https://example.com/photo.webp'},
    {name:second.name}, {width:0}, {height:1000}, {src:'assets/recipe-art/../other.webp'},
  ])assert.equal(recipeArtwork(first,{artwork:{[first.id]:{...fixture[first.id],...patch}}}),null);
});

test('全料理を調べても栄養や材料を変えず、実際の画像台帳にある料理だけを返す',()=>{
  const before=JSON.stringify(RECIPES),imageIds=new Set(Object.keys(RECIPE_ARTWORK));
  assert.ok(RECIPES.length>=984);
  for(const source of RECIPES){
    const result=recipeArtwork(source);
    assert.equal(result!==null,imageIds.has(source.id),source.id);
    if(result)assert.equal(result.recipeId,source.id);
  }
  for(const id of imageIds)assert.ok(RECIPES.some(source=>source.id===id),id);
  assert.equal(JSON.stringify(RECIPES),before);
});
