import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {RECIPES,INGREDIENTS,ALLERGENS} from '../data.js';
import {BREAD_PRESETS} from '../bread-foods.js';
import {foodComposerDefinition,foodPresetSelection,defaultFoodSelection,buildFoodSelection} from '../food-composer.js';
import {recipeArtwork,liveBreadArtworkRecipe} from '../recipe-illustration.js';
import {itemFromRecipe} from '../nutrition.js';
const data={recipes:RECIPES,ingredients:INGREDIENTS,allergens:ALLERGENS};
const original=id=>{const r=RECIPES.find(r=>r.id===id);assert.ok(r,id);return r;};
const picture=id=>({src:`assets/recipe-art/${id}.webp`,largeSrc:`assets/recipe-art/${id}-large.webp`,name:original(id).name,width:640,height:480});
const fixture=Object.fromEntries(Object.values(BREAD_PRESETS).flat().map(p=>[p.recipeId,picture(p.recipeId)]));
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const build=(kind,id)=>buildFoodSelection(foodPresetSelection(kind,id),data);
const choose=(kind,recipe,options={artwork:fixture})=>liveBreadArtworkRecipe(recipe,foodComposerDefinition(kind),options);

test('パンの全標準組み合わせは同じ種類内の正確な配合の絵だけを見つける',()=>{
 for(const [kind,presets] of Object.entries(BREAD_PRESETS))for(const preset of presets){
  const live=build(kind,preset.id),match=choose(kind,live);
  assert.equal(match?.id,preset.recipeId,`${kind} ${preset.id}`);
  assert.equal(recipeArtwork(match,{artwork:fixture})?.recipeId,preset.recipeId);
  assert.equal(recipeArtwork(live,{artwork:fixture}),null,'strict API still rejects a generated custom recipe');
 }
});

test('トーストからピザへ切り替えた配合に対応し、材料の量変更では隠す',()=>{
 const plain=choose('toast',buildFoodSelection(defaultFoodSelection('toast'),data));assert.equal(plain.id,'bread-toast-custom');
 const pizza=build('toast','pizza');assert.equal(choose('toast',pizza).id,'bread-toast-pizza');
 const changed=structuredClone(pizza);changed.ingredients.find(p=>p.id==='cheese').amount+=.01;
 assert.equal(choose('toast',changed),null);
 const extra=structuredClone(pizza);extra.ingredients.push({id:'pepper',amount:1});assert.equal(choose('toast',extra),null);
 const unknown=structuredClone(pizza);unknown.ingredients[0].id='unknown';assert.equal(choose('toast',unknown),null);
});

test('別の料理・保存済み記録・偽の定義へ絵を推定しない',()=>{
 const live=build('toast','pizza'),definition=foodComposerDefinition('toast');
 assert.equal(liveBreadArtworkRecipe(live,{...definition},{artwork:fixture}),null);
 assert.equal(liveBreadArtworkRecipe(live,foodComposerDefinition('oden'),{artwork:fixture}),null);
 assert.equal(choose('sandwich',build('hot-sandwich','custom')),null,'same bread amounts cannot borrow another bread kind picture');
 for(const invalid of [null,{}, {...live,custom:false}, {...live,servings:2}, {...live,nutrition:{}}, {...live,quantity:1}, itemFromRecipe(live,data)])assert.equal(choose('toast',invalid),null);
});

test('台帳にない配合や外部URLの画像を返さず、料理・配合・台帳を変更しない',()=>{
 const live=build('toast','pizza'),dbBefore=sha(RECIPES),inputBefore=sha(live),artBefore=sha(fixture);
 assert.equal(choose('toast',live,{artwork:{}}),null);
 const broken={...fixture,'bread-toast-pizza':{...fixture['bread-toast-pizza'],src:'https://example.com/food.webp'}};
 assert.equal(choose('toast',live,{artwork:broken}),null);
 const match=choose('toast',live);match.ingredients[0].amount=999;match.name='changed';
 assert.equal(sha(RECIPES),dbBefore);assert.equal(sha(live),inputBefore);assert.equal(sha(fixture),artBefore);
});

test('材料の表示順や集約前の重複、浮動小数点の丸めでは配合の対応を失わない',()=>{
 const live=build('toast','pizza'),split=structuredClone(live),first=split.ingredients.shift();
 split.ingredients.push({...first,amount:first.amount/3},{...first,amount:first.amount*2/3});split.ingredients.reverse();
 assert.equal(choose('toast',split)?.id,'bread-toast-pizza');
 for(const value of [0,-1,NaN,Infinity,'1']){
  const invalid=structuredClone(live);invalid.ingredients[0].amount=value;assert.equal(choose('toast',invalid),null);
 }
});
