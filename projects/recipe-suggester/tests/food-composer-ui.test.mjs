import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {mountFoodComposer} from '../food-composer-ui.js';

class Element {
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.listeners=new Map();this.textContent='';}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(type,listener){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(listener);}
  emit(type){for(const listener of this.listeners.get(type)??[])listener({target:this});}
}
const data={ingredients:INGREDIENTS,recipes:RECIPES,allergens:ALLERGENS};
const all=root=>[root,...root.children.flatMap(all)];
const find=(root,predicate)=>{const found=all(root).find(predicate);assert.ok(found,'画面の入力が見つかる');return found;};
const checkbox=(root,id)=>find(root,element=>element.id?.endsWith(`-${id}-checked`));
const amount=(root,label,unit)=>find(root,element=>element.attributes['aria-label']===`${label}の量（${unit}）`);
const byClass=(root,name)=>find(root,element=>element.className.split(' ').includes(name));
function withDocument(fn){
  const old=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};
  try{return fn();}finally{if(old===undefined)delete globalThis.document;else globalThis.document=old;}
}

test('寿司は初回に組み合わせを返し、種類ごとの数量入力をカレンダーformへ入れ子にしない',()=>withDocument(()=>{
  const outputs=[],root=mountFoodComposer({kind:'sushi',data,onChange:recipe=>outputs.push(recipe)});
  assert.equal(outputs.length,1);assert.ok(outputs[0]);assert.deepEqual(outputs[0].portion,{amount:1,unit:'皿'});
  assert.equal(checkbox(root,'tuna').checked,true);assert.equal(checkbox(root,'gunkan-ikura').checked,false);
  assert.equal(amount(root,'まぐろ赤身','貫').disabled,false);assert.equal(amount(root,'いくら','貫').disabled,true);
  assert.ok(!all(root).some(element=>element.tagName==='FORM'));
  const second=mountFoodComposer({kind:'sushi',data}),ids=new Set(all(root).map(element=>element.id).filter(Boolean));
  assert.ok(all(second).filter(element=>element.id).every(element=>!ids.has(element.id)));
}));

test('細巻きや軍艦を追加し、チェックを外した種類は配合・栄養から除く',()=>withDocument(()=>{
  let current;const root=mountFoodComposer({kind:'sushi',data,onChange:recipe=>{current=recipe;}}),id=current.id;
  const ikura=checkbox(root,'gunkan-ikura');ikura.checked=true;ikura.emit('change');
  assert.equal(current.ingredients.find(part=>part.id==='ikura_salted').amount,10);
  const quantity=amount(root,'いくら','貫');quantity.value='3';quantity.emit('input');
  assert.equal(current.ingredients.find(part=>part.id==='ikura_salted').amount,30);
  ikura.checked=false;ikura.emit('change');
  assert.ok(!current.ingredients.some(part=>part.id==='ikura_salted'));assert.equal(current.id,id);
  assert.equal(quantity.disabled,true);
  const kappa=checkbox(root,'hosomaki-kappa');kappa.checked=true;kappa.emit('change');
  assert.equal(current.ingredients.find(part=>part.id==='cucumber').amount,20);
}));

test('不正な数量は古い結果で登録できず、修正時に同じ識別子で復帰する',()=>withDocument(()=>{
  const outputs=[],errors=[],root=mountFoodComposer({kind:'yakitori',data,onChange:recipe=>outputs.push(recipe),onError:message=>errors.push(message)});
  const id=outputs[0].id,quantity=amount(root,'もも・塩','本');quantity.value='';quantity.emit('input');
  assert.equal(outputs.at(-1),null);assert.equal(byClass(root,'food-composer-preview').hidden,true);assert.ok(errors.at(-1));
  quantity.value='2';quantity.emit('input');assert.equal(outputs.at(-1).id,id);assert.equal(byClass(root,'food-composer-preview').hidden,false);assert.equal(errors.at(-1),'');
  quantity.value='-2';quantity.emit('input');assert.equal(outputs.at(-1),null);
}));

test('おでんの汁はチェックを残して0mlにもでき、初期値に戻すと汁量が復帰する',()=>withDocument(()=>{
  let current;const root=mountFoodComposer({kind:'oden',data,onChange:recipe=>{current=recipe;}});
  assert.ok(current.ingredients.some(part=>part.id==='soy_sauce'));
  const broth=amount(root,'飲むおでんの汁','ml');broth.value='0';broth.emit('input');
  assert.ok(current);assert.ok(!current.ingredients.some(part=>part.id==='soy_sauce'));assert.ok(!current.ingredients.some(part=>part.id==='water'));
  byClass(root,'food-composer-reset').emit('click');
  assert.equal(broth.value,'150');assert.equal(current.ingredients.find(part=>part.id==='soy_sauce').amount,6);
}));

test('検索は表示だけを絞り選択を失わず、渡された候補外の種類は表示しない',()=>withDocument(()=>{
  let current;const root=mountFoodComposer({kind:'sushi',data,initial:{kind:'sushi',components:[{id:'tuna',amount:2}]},
    allowedRecipeIds:['classic-sushi-tuna'],onChange:recipe=>{current=recipe;}});
  assert.ok(!all(root).some(element=>element.id?.endsWith('-salmon-checked')));
  const before=JSON.stringify(current),search=byClass(root,'food-composer-search');search.value='存在しない種類';search.emit('input');
  assert.equal(byClass(root,'food-composer-option').hidden,true);assert.equal(JSON.stringify(current),before);
  search.value='まぐろ';search.emit('input');assert.equal(byClass(root,'food-composer-option').hidden,false);
  assert.throws(()=>mountFoodComposer({kind:'sushi',data,allowedRecipeIds:['classic-sushi-salmon'],initial:{kind:'sushi',components:[{id:'tuna',amount:1}]}}),/初期値/);
}));

test('ベース1個分を固定し、トッピングだけを増減する',()=>withDocument(()=>{
  let current;const root=mountFoodComposer({kind:'waffle',data,onChange:recipe=>{current=recipe;}});
  assert.equal(checkbox(root,'base').disabled,true);
  assert.equal(amount(root,'プレーンワッフル（約70g）','個').disabled,true);
  const plain=current.manualNutrition.kcal,maple=checkbox(root,'maple');maple.checked=true;maple.emit('change');
  assert.equal(current.ingredients.find(part=>part.id==='palette_maple_syrup').amount,10);assert.ok(current.manualNutrition.kcal>plain);
  maple.checked=false;maple.emit('change');assert.equal(current.manualNutrition.kcal,plain);
}));


test('刺身は切れ数と1切れの重さを表示し、重さ変更・空欄・復帰・リセットを反映する',()=>withDocument(()=>{
  let current;const root=mountFoodComposer({kind:'sashimi',data,onChange:recipe=>{current=recipe;}});
  const pieces=amount(root,'まぐろ赤身','切れ'),weight=find(root,element=>element.attributes['aria-label']==='まぐろ赤身の1切れの重さ（g）');
  assert.equal(pieces.value,'2');assert.equal(weight.value,'15');assert.equal(weight.disabled,false);
  pieces.value='3';pieces.emit('input');assert.equal(current.ingredients.find(part=>part.id==='tuna_lean_sashimi').amount,45);
  weight.value='20';weight.emit('input');assert.equal(current.ingredients.find(part=>part.id==='tuna_lean_sashimi').amount,60);
  assert.match(all(root).filter(element=>element.className==='food-composer-weight-total').map(element=>element.textContent).join(' '),/60g/);
  weight.value='';weight.emit('input');assert.equal(current,null);
  weight.value='12';weight.emit('input');assert.equal(current.ingredients.find(part=>part.id==='tuna_lean_sashimi').amount,36);
  const tuna=checkbox(root,'tuna');tuna.checked=false;tuna.emit('change');assert.equal(weight.disabled,true);assert.ok(!current.ingredients.some(part=>part.id==='tuna_lean_sashimi'));
  byClass(root,'food-composer-reset').emit('click');assert.equal(weight.value,'15');assert.equal(weight.disabled,false);assert.equal(pieces.value,'2');
}));

test('チーズは初期の個数・枚数・重さと選択後のg数を扱う',()=>withDocument(()=>{
  let current;const root=mountFoodComposer({kind:'cheese',data,initial:{kind:'cheese',components:[{id:'processed-cheese',amount:2,gramsPerUnit:10}]},onChange:recipe=>{current=recipe;}});
  assert.equal(amount(root,'プロセスチーズ','個').value,'2');
  const weight=find(root,element=>element.attributes['aria-label']==='プロセスチーズの1個の重さ（g）');assert.equal(weight.value,'10');
  assert.equal(current.ingredients.find(part=>part.id==='palette_processed_cheese').amount,20);
  assert.equal(amount(root,'チェダー','枚').disabled,true);
}));
