import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {mountRecipeArrangement} from '../recipe-arrangement-ui.js';

class Element {
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.listeners=new Map();this.textContent='';}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(type,listener){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(listener);}
  emit(type){for(const listener of this.listeners.get(type)??[])listener({target:this});}
}
const data={ingredients:INGREDIENTS,recipes:RECIPES,allergens:ALLERGENS},baseRecipe=RECIPES.find(recipe=>recipe.id==='chicken-teriyaki');
const all=root=>[root,...root.children.flatMap(all)];
const find=(root,className)=>{const element=all(root).find(element=>element.className.split(' ').includes(className));assert.ok(element,className);return element;};
function withDocument(fn){const old=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};try{return fn();}finally{if(old===undefined)delete globalThis.document;else globalThis.document=old;}}
function add(root,id,amount){const choice=find(root,'arrangement-choice');choice.value=id;choice.emit('change');find(root,'arrangement-amount').value=String(amount);find(root,'arrangement-add').emit('click');}

test('元レシピの1人分へ食材を追加し、空欄・負数では古い結果で登録できない',()=>withDocument(()=>{
  const outputs=[],root=mountRecipeArrangement({baseRecipe,data,onChange:recipe=>outputs.push(recipe)});
  assert.equal(outputs[0],null);assert.ok(!all(root).some(element=>element.tagName==='FORM'));
  assert.equal(find(root,'arrangement-choice').value,'');assert.equal(find(root,'arrangement-add').disabled,true);assert.equal(find(root,'arrangement-amount').disabled,true);
  add(root,'shimeji',60);assert.ok(outputs.at(-1));const id=outputs.at(-1).id;
  const input=find(root,'arrangement-added-amount');input.value='';input.emit('input');assert.equal(outputs.at(-1),null);assert.equal(find(root,'arrangement-preview').hidden,true);
  input.value='-1';input.emit('input');assert.equal(outputs.at(-1),null);
  input.value='30';input.emit('input');assert.equal(outputs.at(-1).id,id);assert.equal(outputs.at(-1).ingredients.find(part=>part.id==='shimeji').amount,30);
}));

test('料理名・区分・作り方とg量からオリジナルレシピを作る',()=>withDocument(()=>{
  let recipe;const root=mountRecipeArrangement({data,onChange:value=>{recipe=value;}});
  find(root,'arrangement-name').value='私の卵料理';find(root,'arrangement-name').emit('input');find(root,'arrangement-role').value='side';find(root,'arrangement-role').emit('change');find(root,'arrangement-steps').value='卵を十分に加熱する。\n盛り付ける。';find(root,'arrangement-steps').emit('input');
  add(root,'egg',25);assert.equal(recipe.name,'私の卵料理');assert.equal(recipe.role,'side');assert.equal(recipe.ingredients.find(part=>part.id==='egg').amount,.5);assert.equal(recipe.steps.length,2);
  assert.match(find(root,'arrangement-equivalent').textContent,/0.5 個/);
  find(root,'arrangement-name').value='';find(root,'arrangement-name').emit('input');assert.equal(recipe,null);
}));

test('同じ食材を追加すると量をまとめ、削除した食材は栄養から外す',()=>withDocument(()=>{
  let recipe;const root=mountRecipeArrangement({baseRecipe,data,onChange:value=>{recipe=value;}});
  add(root,'shimeji',20);add(root,'shimeji',30);assert.equal(recipe.ingredients.find(part=>part.id==='shimeji').amount,50);assert.equal(all(root).filter(element=>element.className==='arrangement-selected-row').length,1);
  const kcal=recipe.manualNutrition.kcal;add(root,'cheese',10);assert.ok(recipe.manualNutrition.kcal>kcal);
  const remove=all(root).find(element=>element.attributes['aria-label']==='追加したナチュラルチーズを削除');assert.ok(remove);remove.emit('click');assert.equal(recipe.manualNutrition.kcal,kcal);
}));

test('カテゴリ・ひらがな検索は候補だけを絞り、追加済み食材を消さない',()=>withDocument(()=>{
  let recipe;const root=mountRecipeArrangement({baseRecipe,data,onChange:value=>{recipe=value;}});add(root,'shimeji',40);const before=JSON.stringify(recipe);
  const category=find(root,'arrangement-category');category.value='meat';category.emit('change');assert.ok(find(root,'arrangement-choice').children.filter(option=>option.value).every(option=>INGREDIENTS[option.value].proteinSources.includes('meat')));assert.equal(find(root,'arrangement-add').disabled,true);
  category.value='all';category.emit('change');const search=find(root,'arrangement-search');search.value='ちーず';search.emit('input');assert.ok(find(root,'arrangement-choice').children.some(option=>option.value==='cheese'));
  search.value='該当しない食品';search.emit('input');assert.equal(find(root,'arrangement-add').disabled,true);assert.equal(JSON.stringify(recipe),before);
}));

test('製品の本数と未登録重量を混同せず、選んだ時点で元の単位を表示する',()=>withDocument(()=>{
  let recipe;const root=mountRecipeArrangement({baseRecipe,data,onChange:value=>{recipe=value;}});
  add(root,'perf_bar_manzoku',1);assert.ok(recipe);assert.equal(find(root,'arrangement-input-unit').textContent,'本');assert.match(find(root,'arrangement-conversion').textContent,/g換算は未登録/);
  assert.equal(recipe.ingredients.find(part=>part.id==='perf_bar_manzoku').amount,1);assert.equal(recipe.manualNutrition.kcal,null);
}));
