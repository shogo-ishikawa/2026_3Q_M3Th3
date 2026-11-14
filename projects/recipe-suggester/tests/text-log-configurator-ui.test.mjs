import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {canConfigureTextRecipe, mountTextRecipeConfigurator} from '../text-log-configurator-ui.js';
import {recipeNutrition} from '../nutrition.js';

class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.listeners=new Map();this.textContent='';this.className='';this.dataset={};this.style={};this.value='';}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  setAttribute(key,value){this.attributes[key]=value;}
  getAttribute(key){return this.attributes[key]??null;}
  addEventListener(type,listener){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(listener);}
  dispatchEvent(event){for(const listener of this.listeners.get(event.type)??[])listener(event);return true;}
  emit(type,properties={}){this.dispatchEvent({type,target:this,preventDefault(){},...properties});}
}
const all=root=>[root,...root.children.flatMap(all)];
const find=(root,predicate)=>{const result=all(root).find(predicate);assert.ok(result,'input exists');return result;};
const byClass=(root,value)=>find(root,node=>node.className.split(' ').includes(value));
const amount=(root,id)=>find(root,node=>node.id?.endsWith(`-${id}-amount`));
const weight=(root,id)=>find(root,node=>node.id?.endsWith(`-${id}-weight`));
const checkbox=(root,id)=>find(root,node=>node.id?.endsWith(`-${id}-checked`));
const withDocument=fn=>{const old=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};try{return fn();}finally{if(old===undefined)delete globalThis.document;else globalThis.document=old;}};
const data={allergens:ALLERGENS,ingredients:INGREDIENTS,recipes:RECIPES};
const entry=(root,id,value,event='input')=>{const control=amount(root,id);control.value=value;control.emit(event);return control;};
const meaningful=recipe=>({name:recipe.name,ingredients:recipe.ingredients,manualNutrition:recipe.manualNutrition,portion:recipe.portion,servings:recipe.servings});

// Tests exercise the actual existing UI widgets through a commit-free wrapper.
test('具材・肉・麺・ご飯・汁・種類のある料理を認識し、通常料理には不要な詳細を付けない',()=>{
  for(const id of ['palette-oden','classic-sashimi-assorted','beef-potato','classic-hamburg','daily-ramen-soy','world-saag-paneer','familiar-side-raw-vegetable','soup-001','simmered-ishikari-nabe'])assert.equal(canConfigureTextRecipe(id,data),true,id);
  assert.equal(canConfigureTextRecipe('chicken-teriyaki',data),false);
  assert.equal(canConfigureTextRecipe('missing',data),false);
});

test('刺身3切れ×20gを確定し、再編集でも切れ数と1切れ重量を正確に保つ',()=>withDocument(()=>{
  let current;const root=mountTextRecipeConfigurator({recipeId:'classic-sashimi-assorted',data,onChange:recipe=>{current=recipe;}});
  entry(root,'tuna','3');const grams=weight(root,'tuna');grams.value='20';grams.emit('input');
  assert.equal(current.ingredients.find(part=>part.id==='tuna_lean_sashimi').amount,60);
  assert.equal(current.textConfiguration.kind,'food');
  const initial=structuredClone(current),before=JSON.stringify(initial);let reopened;
  const second=mountTextRecipeConfigurator({recipeId:'classic-sashimi-assorted',data,initialRecipe:initial,onChange:recipe=>{reopened=recipe;}});
  assert.equal(amount(second,'tuna').value,'3');assert.equal(weight(second,'tuna').value,'20');
  assert.deepEqual(meaningful(reopened),meaningful(current));assert.equal(JSON.stringify(initial),before);
  assert.ok(!all(root).some(node=>node.tagName==='FORM'));assert.ok(!all(root).some(node=>/記録に追加|一括登録/.test(node.textContent)));
}));

test('おでんの大根・卵の数量と汁0を保持し、不正な量では反映可能な結果を返さない',()=>withDocument(()=>{
  let current;const root=mountTextRecipeConfigurator({recipeId:'palette-oden',data,onChange:recipe=>{current=recipe;}});
  entry(root,'daikon','2');entry(root,'broth','0');
  assert.ok(current);assert.ok(!current.ingredients.some(part=>part.id==='water'));
  const exact=structuredClone(current),reopened=mountTextRecipeConfigurator({recipeId:'palette-oden',data,initialRecipe:exact,onChange:recipe=>{current=recipe;}});
  assert.equal(amount(reopened,'daikon').value,'2');assert.equal(checkbox(reopened,'broth').checked,false);
  assert.deepEqual(current.manualNutrition,exact.manualNutrition);
  entry(reopened,'daikon','-1');assert.equal(current,null);
  entry(reopened,'daikon','1.5');assert.ok(current);assert.equal(current.textConfiguration.selection.components.find(part=>part.id==='daikon').amount,1.5);
}));

test('鍋の種類と飲む汁の割合を再編集し、種類を往復しても途中の選択を失わない',()=>withDocument(()=>{
  let current;const root=mountTextRecipeConfigurator({recipeId:'simmered-pork-millefeuille-nabe',data,onChange:recipe=>{current=recipe;}});
  const broth=byClass(root,'soup-intake-broth');broth.value='0.25';broth.emit('change');
  const before=structuredClone(current);assert.equal(current.textConfiguration.soupSelection.brothRatio,0.25);
  const variants=byClass(root,'text-config-variant');variants.value='simmered-ishikari-nabe';variants.emit('change');
  assert.equal(current.textConfiguration.recipeId,'simmered-ishikari-nabe');assert.ok(current.ingredients.some(part=>part.id==='salmon'));
  variants.value='simmered-pork-millefeuille-nabe';variants.emit('change');
  assert.equal(byClass(root,'soup-intake-broth').value,'0.25');assert.deepEqual(current.manualNutrition,before.manualNutrition);
  const second=mountTextRecipeConfigurator({recipeId:'simmered-pork-millefeuille-nabe',data,initialRecipe:current,onChange:recipe=>{current=recipe;}});
  assert.equal(byClass(second,'soup-intake-broth').value,'0.25');assert.deepEqual(current.manualNutrition,before.manualNutrition);
}));

test('カレーはご飯0gを保ち、再編集で標準ライスを復活させない',()=>withDocument(()=>{
  let current;const root=mountTextRecipeConfigurator({recipeId:'world-saag-paneer',data,onChange:recipe=>{current=recipe;}});
  const rice=byClass(root,'dish-rice-amount');rice.value='0';rice.emit('input');assert.ok(!current.ingredients.some(part=>part.id==='rice'));
  const first=structuredClone(current),second=mountTextRecipeConfigurator({recipeId:'world-saag-paneer',data,initialRecipe:first,onChange:recipe=>{current=recipe;}});
  assert.equal(byClass(second,'dish-rice-amount').value,'0');assert.deepEqual(current.manualNutrition,first.manualNutrition);
}));

test('ラーメンの麺量とスープ割合は再編集で保持され、追加した味玉も消えない',()=>withDocument(()=>{
  let current;const root=mountTextRecipeConfigurator({recipeId:'daily-ramen-soy',data,onChange:recipe=>{current=recipe;}});
  const noodles=byClass(root,'noodle-amount'),soup=byClass(root,'noodle-soup-intake');noodles.value='180';noodles.emit('input');soup.value='half';soup.emit('change');
  const topping=find(root,node=>node.type==='checkbox'&&node.id?.includes('egg'));topping.checked=true;topping.emit('change');
  assert.ok(current);const before=structuredClone(current),second=mountTextRecipeConfigurator({recipeId:'daily-ramen-soy',data,initialRecipe:before,onChange:recipe=>{current=recipe;}});
  assert.equal(byClass(second,'noodle-amount').value,'180');assert.equal(byClass(second,'noodle-soup-intake').value,'half');
  assert.deepEqual(current.ingredients,before.ingredients);assert.deepEqual(current.manualNutrition,before.manualNutrition);
}));

test('肉のタイプとサラダのドレッシングも再編集で保持する',()=>withDocument(()=>{
  let meat;const root=mountTextRecipeConfigurator({recipeId:'classic-hamburg',data,onChange:recipe=>{meat=recipe;}}),choice=byClass(root,'dish-meat-select');choice.value='chicken';choice.emit('change');
  const before=structuredClone(meat),second=mountTextRecipeConfigurator({recipeId:'classic-hamburg',data,initialRecipe:before,onChange:recipe=>{meat=recipe;}});
  assert.equal(byClass(second,'dish-meat-select').value,'chicken');assert.deepEqual(meat.ingredients,before.ingredients);
  let salad;const s=mountTextRecipeConfigurator({recipeId:'familiar-side-raw-vegetable',data,onChange:recipe=>{salad=recipe;}}),dressing=byClass(s,'salad-dressing-select');dressing.value='mayonnaise';dressing.emit('change');
  const saved=structuredClone(salad),again=mountTextRecipeConfigurator({recipeId:'familiar-side-raw-vegetable',data,initialRecipe:saved,onChange:recipe=>{salad=recipe;}});
  assert.equal(byClass(again,'salad-dressing-select').value,'mayonnaise');assert.deepEqual(salad.ingredients,saved.ingredients);
}));

test('再編集情報がない確定済み配合は標準へ黙って戻さず、明示操作で選び直せる',()=>withDocument(()=>{
  let current;const prior={...structuredClone(RECIPES.find(recipe=>recipe.id==='classic-sashimi-assorted')),id:'custom-prior',custom:true};
  prior.ingredients=[{id:'tuna_lean_sashimi',amount:160}];prior.manualNutrition=recipeNutrition(prior,data);
  const before=JSON.stringify(prior),root=mountTextRecipeConfigurator({recipeId:'classic-sashimi-assorted',data,initialRecipe:prior,onChange:recipe=>{current=recipe;}});
  assert.equal(current.ingredients[0].amount,160/prior.servings);assert.equal(current.servings,1);assert.equal(JSON.stringify(prior),before);
  byClass(root,'text-config-reset').emit('click');assert.ok(all(root).some(node=>node.id?.endsWith('-tuna-checked')));
}));

test('別料理の再編集情報や壊れた選択を引き継がず、エラー時も古い確定結果を返さない',()=>withDocument(()=>{
  assert.throws(()=>mountTextRecipeConfigurator({recipeId:'palette-oden',data,initialRecipe:{textConfiguration:{recipeId:'classic-sashimi-assorted',kind:'food',selection:{kind:'sashimi',components:[]}}}}),/一致/);
  assert.throws(()=>mountTextRecipeConfigurator({recipeId:'soup-001',data,initialRecipe:{textConfiguration:{recipeId:'soup-001',kind:'plain',selection:null,soupSelection:{brothRatio:'0.5',solidRatio:1}}}}),/割合/);
  assert.throws(()=>mountTextRecipeConfigurator({recipeId:'soup-001',data,initialRecipe:{textConfiguration:{recipeId:'soup-001',kind:'plain',selection:{}}}}),/入力内容/);
  let current='old',error='';const root=mountTextRecipeConfigurator({recipeId:'classic-sashimi-assorted',data,initialRecipe:{textConfiguration:{recipeId:'classic-sashimi-assorted',kind:'food',selection:{kind:'sashimi',components:[{id:'bogus',amount:2}]}}},onChange:recipe=>{current=recipe;},onError:value=>{error=value;}});
  assert.equal(current,null);assert.ok(error);assert.ok(byClass(root,'text-config-reset'));
}));
