import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {mountRecipeArrangement} from '../recipe-arrangement-ui.js';

class Element {
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.listeners=new Map();this.textContent='';this.className='';this.dataset={};this.style={};}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(type,listener){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(listener);}
  dispatchEvent(event){for(const listener of this.listeners.get(event.type)??[])listener(event);return true;}
  emit(type,properties={}){this.dispatchEvent({type,target:this,preventDefault(){},...properties});}
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

test('元の材料の量を変更し、空欄時は登録を無効にし、削除と元に戻す操作ができる',()=>withDocument(()=>{
  const base={name:'卵とチーズ',role:'main',servings:2,ingredients:[{id:'egg',amount:2},{id:'cheese',amount:40}],steps:[]};
  let recipe;const root=mountRecipeArrangement({baseRecipe:base,data,onChange:value=>{recipe=value;}});
  const input=find(root,'arrangement-original-amount');assert.equal(input.value,'50');input.value='25';input.emit('input');assert.equal(recipe.ingredients.find(part=>part.id==='egg').amount,.5);
  input.value='';input.emit('input');assert.equal(recipe,null);input.value='25';input.emit('input');assert.ok(recipe);
  const rows=all(root).filter(element=>element.className.includes('arrangement-original-row'));
  find(rows[1],'arrangement-original-remove').emit('click');assert.ok(!recipe.ingredients.some(part=>part.id==='cheese'));assert.ok(!recipe.allergens.includes('milk'));
  const updatedRows=all(root).filter(element=>element.className.includes('arrangement-original-row'));
  find(updatedRows[1],'arrangement-original-restore').emit('click');assert.ok(recipe.ingredients.some(part=>part.id==='cheese'));
}));

test('元の食材を選択中は追加ピッカーが置き換えとなり、肉の種類と量を変更する',()=>withDocument(()=>{
  let recipe;const root=mountRecipeArrangement({baseRecipe,data,onChange:value=>{recipe=value;}});
  find(root,'arrangement-original-replace').emit('click');assert.match(find(root,'arrangement-replacement-note').textContent,/置き換えます/);assert.match(find(root,'arrangement-add').textContent,/置き換える/);
  add(root,'chicken_breast',120);assert.ok(recipe);assert.equal(recipe.ingredients.find(part=>part.id==='chicken_breast').amount,120);assert.ok(!recipe.ingredients.some(part=>part.id===baseRecipe.ingredients[0].id));assert.equal(find(root,'arrangement-replacement-note').hidden,true);
}));

test('集計された商品表示の材料編集は無効にして理由を表示し、追加操作は使える',()=>withDocument(()=>{
  let recipe;const root=mountRecipeArrangement({baseRecipe:{...baseRecipe,manualNutrition:{kcal:500,protein:25,fat:20,carbs:30,fiber:1,salt:2}},data,onChange:value=>{recipe=value;}});
  assert.equal(find(root,'arrangement-original-amount').disabled,true);assert.match(find(root,'arrangement-edit-note').textContent,/材料との対応が確定できない/);
  add(root,'shimeji',20);assert.ok(recipe);assert.ok(recipe.manualNutrition.kcal>500);
}));

test('元材料と追加材料の上下操作は1g刻みで、小数の手入力を保持する',()=>withDocument(()=>{
  let recipe;const root=mountRecipeArrangement({baseRecipe,data,onChange:value=>{recipe=value;}});
  const oil=all(root).find(element=>element.id?.endsWith('-original-oil'));assert.ok(oil);oil.value='0.5';oil.emit('input');assert.ok(recipe);
  const before=recipe.manualNutrition.kcal;oil.emit('keydown',{key:'ArrowUp'});assert.equal(Number(oil.value),1.5);assert.ok(recipe.manualNutrition.kcal>before);
  oil.emit('keydown',{key:'ArrowDown'});assert.equal(Number(oil.value),.5);assert.ok(Math.abs(recipe.manualNutrition.kcal-before)<1e-9);
  add(root,'shimeji',.25);const added=find(root,'arrangement-added-amount');assert.equal(recipe.ingredients.find(part=>part.id==='shimeji').amount,.25);
  added.emit('keydown',{key:'ArrowUp'});assert.equal(Number(added.value),1.25);assert.equal(recipe.ingredients.find(part=>part.id==='shimeji').amount,1.25);
  added.value='0x10';added.emit('input');assert.equal(recipe,null);
  oil.value='-1';oil.emit('input');assert.equal(recipe,null);
}));
