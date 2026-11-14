import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {mountFoodComposer} from '../food-composer-ui.js';
import {defaultFoodSelection} from '../food-composer.js';

class Element {
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.listeners=new Map();this.textContent='';}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  setAttribute(key,value){this.attributes[key]=value;}
  getAttribute(key){return this.attributes[key]??null;}
  addEventListener(type,listener){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(listener);}
  dispatchEvent(event){this.emit(event.type,event);return true;}
  emit(type,event={}){for(const listener of this.listeners.get(type)??[])listener({target:this,preventDefault(){},...event,key:event.key});}
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

test('おでんの汁を0mlにすると選択を外し、初期値に戻すと汁量が復帰する',()=>withDocument(()=>{
  let current;const root=mountFoodComposer({kind:'oden',data,onChange:recipe=>{current=recipe;}});
  assert.ok(current.ingredients.some(part=>part.id==='soy_sauce'));
  const broth=amount(root,'飲むおでんの汁','ml');broth.value='0';broth.emit('input');
  assert.equal(checkbox(root,'broth').checked,false);assert.equal(broth.disabled,true);
  assert.ok(current);assert.ok(!current.ingredients.some(part=>part.id==='soy_sauce'));assert.ok(!current.ingredients.some(part=>part.id==='water'));
  byClass(root,'food-composer-reset').emit('click');
  assert.equal(broth.value,'150');assert.equal(current.ingredients.find(part=>part.id==='soy_sauce').amount,6);
}));

test('初期設定で汁が0mlなら外して表示し、再選択時には既定の正の量を使う',()=>withDocument(()=>{
  let current;const root=mountFoodComposer({kind:'oden',data,initial:{kind:'oden',components:[{id:'daikon',amount:1},{id:'broth',amount:0}]},onChange:recipe=>{current=recipe;}}),broth=amount(root,'飲むおでんの汁','ml'),checked=checkbox(root,'broth');
  assert.equal(checked.checked,false);assert.equal(broth.disabled,true);assert.ok(current);
  checked.checked=true;checked.emit('change');assert.equal(broth.value,'150');assert.equal(current.ingredients.find(part=>part.id==='soy_sauce').amount,6);
}));

test('具材の0は選択・栄養・重量欄へ反映し、選び直すと最後の正しい量へ戻る',()=>withDocument(()=>{
  let current;const root=mountFoodComposer({kind:'sashimi',data,onChange:recipe=>{current=recipe;}});
  const tuna=checkbox(root,'tuna'),quantity=amount(root,'まぐろ赤身','切れ'),weight=find(root,element=>element.attributes['aria-label']==='まぐろ赤身の1切れの重さ（g）');
  quantity.value='1.5';quantity.emit('input');const before=current.manualNutrition.kcal;
  assert.equal(current.ingredients.find(part=>part.id==='tuna_lean_sashimi').amount,22.5);
  quantity.value='0.0';quantity.emit('input');
  assert.equal(tuna.checked,false);assert.equal(quantity.disabled,true);assert.equal(weight.disabled,true);
  assert.ok(!current.ingredients.some(part=>part.id==='tuna_lean_sashimi'));assert.ok(current.manualNutrition.kcal<before);
  tuna.checked=true;tuna.emit('change');
  assert.equal(quantity.value,'1.5');assert.equal(quantity.disabled,false);assert.equal(weight.disabled,false);assert.equal(current.manualNutrition.kcal,before);
}));

test('上下キーは貫・mlを1ずつ動かし、小数の手入力を保持する',()=>withDocument(()=>{
  let sushi;const sushiRoot=mountFoodComposer({kind:'sushi',data,onChange:recipe=>{sushi=recipe;}}),pieces=amount(sushiRoot,'まぐろ赤身','貫');
  pieces.value='1.25';pieces.emit('input');assert.ok(sushi);
  pieces.emit('keydown',{key:'ArrowUp'});assert.equal(pieces.value,'2.25');assert.ok(sushi);
  pieces.emit('keydown',{key:'ArrowDown'});assert.equal(pieces.value,'1.25');assert.ok(sushi);
  let oden;const odenRoot=mountFoodComposer({kind:'oden',data,onChange:recipe=>{oden=recipe;}}),broth=amount(odenRoot,'飲むおでんの汁','ml');
  broth.value='0.5';broth.emit('input');assert.ok(oden);
  broth.emit('keydown',{key:'ArrowDown'});assert.equal(broth.value,'0');assert.equal(checkbox(odenRoot,'broth').checked,false);assert.ok(oden);
}));

test('空欄・文字・負数・指数・異常な量は0として外さず、古い結果で登録させない',()=>withDocument(()=>{
  let current;const root=mountFoodComposer({kind:'sushi',data,onChange:recipe=>{current=recipe;}}),tuna=checkbox(root,'tuna'),quantity=amount(root,'まぐろ赤身','貫');
  for(const value of ['', 'abc', '-1', '-0', 'Infinity', 'NaN', '1e2', '0x10', '51']){
    quantity.value=value;quantity.emit('input');assert.equal(tuna.checked,true,value);assert.equal(quantity.disabled,false,value);assert.equal(current,null,value);
    quantity.value='2';quantity.emit('input');assert.ok(current,value);
  }
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

test('マフィンは標準朝食を先に選び、削除・量変更・選んだ標準量への復帰ができる',()=>withDocument(()=>{
 let current;const root=mountFoodComposer({kind:'english-muffin',data,onChange:recipe=>{current=recipe;}}),preset=byClass(root,'food-composer-preset');
 assert.equal(preset.value,'ham-cheese');
 assert.ok(preset.children.some(option=>option.value==='custom'&&option.textContent==='具材を指定する'));
 preset.value='sausage-egg-cheese';preset.emit('change');
 assert.equal(current.ingredients.find(p=>p.id==='pork_minced').amount,45);
 assert.equal(current.ingredients.find(p=>p.id==='egg').amount,1);
 assert.equal(current.ingredients.find(p=>p.id==='oil').amount,2);
 assert.ok(!current.ingredients.some(p=>p.id==='ready_sliced_ham'));
 const cheese=amount(root,'チーズ','g');cheese.value='0';cheese.emit('input');
 assert.equal(preset.value,'');assert.equal(checkbox(root,'cheese').checked,false);
 assert.ok(!current.ingredients.some(p=>p.id==='cheese'));
 byClass(root,'food-composer-reset').emit('click');
 assert.equal(preset.value,'sausage-egg-cheese');assert.equal(cheese.value,'15');assert.equal(checkbox(root,'cheese').checked,true);
}));

test('具材を指定するはパンだけへ戻し、サンドイッチの材料を一から選べる',()=>withDocument(()=>{
 let current;const root=mountFoodComposer({kind:'sandwich',data,onChange:recipe=>{current=recipe;}}),preset=byClass(root,'food-composer-preset');
 preset.value='custom';preset.emit('change');
 assert.deepEqual(current.ingredients,[{id:'bread',amount:60}]);
 assert.equal(preset.value,'custom');
 const tomato=checkbox(root,'tomato');tomato.checked=true;tomato.emit('change');
 assert.equal(current.ingredients.find(p=>p.id==='tomato').amount,30);
 assert.equal(preset.value,'');assert.ok(!current.ingredients.some(p=>p.id==='ready_sliced_ham'));
 const quantity=amount(root,'トマト','g');quantity.value='12.5';quantity.emit('input');
 assert.equal(current.ingredients.find(p=>p.id==='tomato').amount,12.5);
}));

test('トーストの組み合わせは基礎パンも正しく切り替え、ピザ生地を使わない',()=>withDocument(()=>{
 let current;const root=mountFoodComposer({kind:'toast',data,onChange:recipe=>{current=recipe;}}),preset=byClass(root,'food-composer-preset');
 preset.value='legacy-wholegrain-avocado';preset.emit('change');
 assert.equal(current.ingredients.find(p=>p.id==='wholegrain_bread').amount,60);
 assert.equal(checkbox(root,'base-wholegrain').checked,true);assert.equal(checkbox(root,'base').checked,false);
 preset.value='pizza';preset.emit('change');
 assert.equal(current.ingredients.find(p=>p.id==='bread').amount,60);
 assert.ok(!current.ingredients.some(p=>p.id==='wholegrain_bread'||p.id==='pizza_base'));
 assert.equal(checkbox(root,'base').checked,true);assert.equal(checkbox(root,'base-wholegrain').checked,false);
 assert.equal(current.ingredients.find(p=>p.id==='bread_ketchup').amount,16);
 const whole=checkbox(root,'base-wholegrain');whole.checked=true;whole.emit('change');
 assert.equal(checkbox(root,'base').checked,false);assert.equal(current.ingredients.find(p=>p.id==='wholegrain_bread').amount,60);
 assert.equal(preset.value,'');
}));

test('切れ数と1切れ重量の編集状態を確定結果より先に独立したコピーで返す',()=>withDocument(()=>{
 const events=[],configs=[];let current;
 const root=mountFoodComposer({kind:'sashimi',data,onSelectionChange:config=>{events.push('selection');configs.push(config);},onChange:recipe=>{events.push('recipe');current=recipe;}});
 assert.deepEqual(events.slice(0,2),['selection','recipe']);
 const quantity=amount(root,'まぐろ赤身','切れ'),weight=find(root,e=>e.attributes['aria-label']==='まぐろ赤身の1切れの重さ（g）');
 quantity.value='3';quantity.emit('input');weight.value='18';weight.emit('input');
 const draft=configs.at(-1);assert.equal(draft.components.find(p=>p.id==='tuna').amount,3);assert.equal(draft.components.find(p=>p.id==='tuna').gramsPerUnit,18);
 draft.components.find(p=>p.id==='tuna').amount=99;
 assert.equal(current.ingredients.find(p=>p.id==='tuna_lean_sashimi').amount,54);
 quantity.value='';quantity.emit('input');assert.equal(configs.at(-1),null);assert.equal(current,null);
 quantity.value='2';quantity.emit('input');assert.equal(configs.at(-1).components.find(p=>p.id==='tuna').amount,2);
}));

test('手入力が別の標準配合と一致しても、明示して選んだ組み合わせの復帰点を変えない',()=>withDocument(()=>{
 let current;const root=mountFoodComposer({kind:'toast',data,onChange:r=>{current=r;}}),preset=byClass(root,'food-composer-preset');
 preset.value='custom';preset.emit('change');
 const butter=checkbox(root,'butter');butter.checked=true;butter.emit('change');
 assert.equal(current.ingredients.find(p=>p.id==='butter').amount,5);
 assert.equal(preset.value,'');
 byClass(root,'food-composer-reset').emit('click');
 assert.equal(preset.value,'custom');assert.deepEqual(current.ingredients,[{id:'bread',amount:60}]);
}));

test('汎用のトースト画面は食パンのみで開き、明示したバター・ジャム・ピザの入口を変えない',()=>withDocument(()=>{
 let plain;const root=mountFoodComposer({kind:'toast',data,onChange:r=>{plain=r;}});
 const preset=byClass(root,'food-composer-preset');
 assert.equal(preset.value,'custom');
 assert.ok(preset.children.some(o=>o.value==='custom'&&o.textContent==='トーストのみ（具材を指定する）'));
 assert.deepEqual(plain.ingredients,[{id:'bread',amount:60}]);
 for(const id of ['butter','strawberry-jam','cheese','pizza-sauce'])assert.equal(checkbox(root,id).checked,false,id);
 for(const [id,component] of [['staple-butter-toast','butter'],['bread-toast-jam-butter','strawberry-jam'],['bread-toast-pizza','pizza-sauce']]){
  let current;const specific=mountFoodComposer({kind:'toast',data,initial:defaultFoodSelection('toast',{recipeId:id}),onChange:r=>{current=r;}});
  assert.ok(current);assert.equal(checkbox(specific,component).checked,true,id);
 }
}));
