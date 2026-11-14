import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {mountTextLog} from '../text-log-ui.js';
import {buildFoodSelection} from '../food-composer.js';

class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.listeners=new Map();this.textContent='';this.className='';this.dataset={};this.style={};this.value='';}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(type,listener){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(listener);}
  dispatchEvent(event){for(const listener of this.listeners.get(event.type)??[])listener(event);return true;}
  emit(type,properties={}){this.dispatchEvent({type,target:this,preventDefault(){},...properties});}
}
const all=root=>[root,...root.children.flatMap(all)];
const byClass=(root,value)=>{const result=all(root).find(node=>node.className.split(' ').includes(value));assert.ok(result,value);return result;};
const byClasses=(root,value)=>all(root).filter(node=>node.className.split(' ').includes(value));
const field=(root,suffix)=>{const result=all(root).find(node=>node.id?.endsWith(`-${suffix}`));assert.ok(result,suffix);return result;};
const withDocument=fn=>{const old=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};try{return fn();}finally{if(old===undefined)delete globalThis.document;else globalThis.document=old;}};
const data={allergens:ALLERGENS,ingredients:INGREDIENTS,recipes:RECIPES};
const parse=(root,value)=>{byClass(root,'text-log-source').value=value;byClass(root,'text-log-parse').emit('click');};
const mounted=options=>mountTextLog({data,date:'2026-11-13',meal:'breakfast',status:'eaten',...options});

test('全行の料理と量が揃ったプレビューだけを一括確認して登録する',()=>withDocument(()=>{
  const added=[],root=mounted({onAdd:entry=>added.push(entry)});parse(root,'ご飯150g、納豆1パック、みそ汁1杯');
  assert.equal(byClasses(root,'text-log-row').length,3);assert.equal(byClass(root,'text-log-submit').disabled,true);
  assert.ok(!all(root).some(node=>node.type==='checkbox'));assert.ok(!all(root).some(node=>node.tagName==='FORM'));
  const rows=byClasses(root,'text-log-row'),natto=byClass(rows[1],'text-log-amount');assert.equal(natto.value,'');assert.match(byClass(rows[1],'text-log-row-note').textContent,/換算は未登録/);
  assert.ok(all(byClass(rows[1],'text-log-standard')).some(node=>node.textContent.includes('納豆')&&node.textContent.includes('45g')));
  natto.value='1';natto.emit('input');
  const soup=byClass(rows[2],'text-log-recipe');assert.equal(soup.value,'');soup.value=soup.children.find(option=>option.value).value;soup.emit('change');
  const soupAmount=byClass(rows[2],'text-log-amount');if(!soupAmount.value){soupAmount.value='1';soupAmount.emit('input');}
  assert.equal(byClass(root,'text-log-submit').disabled,false);assert.equal(added.length,0);assert.ok(byClasses(root,'text-log-preview-items')[0].children.length===3);
  field(root,'date').value='2026-11-14';field(root,'meal').value='lunch';field(root,'status').value='planned';field(root,'status').emit('change');
  byClass(root,'text-log-submit').emit('click');assert.equal(added.length,1);assert.equal(added[0].items.length,3);assert.equal(added[0].date,'2026-11-14');assert.equal(added[0].meal,'lunch');assert.equal(added[0].status,'planned');
  assert.equal(byClasses(root,'text-log-row').length,0);assert.equal(byClass(root,'text-log-source').value,'');assert.equal(byClass(root,'text-log-submit').disabled,true);
}));

test('未知の行は削除するまで残り、料理名を検索し直して選べる',()=>withDocument(()=>{
  const added=[],root=mounted({onAdd:entry=>added.push(entry)});parse(root,'ご飯150g、未登録の宇宙料理2皿');
  let rows=byClasses(root,'text-log-row');assert.equal(rows.length,2);assert.equal(byClass(root,'text-log-submit').disabled,true);assert.equal(byClass(rows[1],'text-log-amount').disabled,true);
  const search=byClass(rows[1],'text-log-search');search.value='ゆで卵';search.emit('input');const select=byClass(rows[1],'text-log-recipe');assert.equal(select.value,'');assert.ok(select.children.some(option=>option.value==='classic-boiled-egg'));
  select.value='classic-boiled-egg';select.emit('change');assert.equal(byClass(rows[1],'text-log-amount').value,'');
  byClass(rows[1],'text-log-amount').value='2';byClass(rows[1],'text-log-amount').emit('input');assert.equal(byClass(root,'text-log-submit').disabled,false);
  byClass(rows[1],'text-log-remove').emit('click');rows=byClasses(root,'text-log-row');assert.equal(rows.length,1);byClass(root,'text-log-submit').emit('click');assert.equal(added.length,1);assert.equal(added[0].items.length,1);
}));

test('文章の変更・入力失敗は前の確定プレビューを無効にする',()=>withDocument(()=>{
  const added=[],root=mounted({onAdd:entry=>added.push(entry)});parse(root,'ご飯150g');assert.equal(byClass(root,'text-log-submit').disabled,false);
  const text=byClass(root,'text-log-source');text.value='ご飯100g';text.emit('input');assert.equal(byClass(root,'text-log-submit').disabled,true);assert.equal(byClasses(root,'text-log-row').length,0);
  byClass(root,'text-log-submit').emit('click');assert.equal(added.length,0);
  byClass(root,'text-log-parse').emit('click');assert.equal(byClass(root,'text-log-submit').disabled,false);
  text.value='';byClass(root,'text-log-parse').emit('click');assert.equal(byClass(root,'text-log-submit').disabled,true);assert.equal(byClasses(root,'text-log-row').length,0);assert.equal(added.length,0);
}));

test('入力した量を厳密に検査し、小数を保ったまま上下操作は1刻みにする',()=>withDocument(()=>{
  const added=[],root=mounted({onAdd:entry=>added.push(entry)});parse(root,'ご飯150.5g');const amount=byClass(root,'text-log-amount');
  amount.emit('keydown',{key:'ArrowUp'});assert.equal(amount.value,'151.5');amount.emit('keydown',{key:'ArrowDown'});assert.equal(amount.value,'150.5');
  for(const value of ['','-1','1e2','0x10','NaN','Infinity','0','100001']){amount.value=value;amount.emit('input');assert.equal(byClass(root,'text-log-submit').disabled,true,value);byClass(root,'text-log-submit').emit('click');assert.equal(added.length,0,value);}
  amount.value='75.25';amount.emit('input');assert.equal(byClass(root,'text-log-submit').disabled,false);byClass(root,'text-log-submit').emit('click');assert.equal(added.length,1);assert.equal(added[0].items[0].quantity,75.25/150);
}));

test('保存側が確認を取り消した場合は入力もプレビューも残す',()=>withDocument(()=>{
  const attempts=[],root=mounted({onAdd:entry=>{attempts.push(entry);return false;}});parse(root,'ご飯150g、ゆで卵1個');byClass(root,'text-log-submit').emit('click');
  assert.equal(attempts.length,1);assert.equal(byClasses(root,'text-log-row').length,2);assert.equal(byClass(root,'text-log-source').value,'ご飯150g、ゆで卵1個');assert.equal(byClass(root,'text-log-submit').disabled,false);
  byClass(root,'text-log-submit').emit('click');assert.equal(attempts.length,2);assert.notEqual(attempts[0].id,attempts[1].id);
}));

test('未登録の数量表記は手で直すまで記録せず、日付の異常も防ぐ',()=>withDocument(()=>{
  const added=[],root=mounted({onAdd:entry=>added.push(entry)});parse(root,'ご飯-5g');const row=byClass(root,'text-log-row'),select=byClass(row,'text-log-recipe');
  assert.equal(select.value,'');select.value='plain-rice';select.emit('change');assert.equal(byClass(row,'text-log-amount').value,'');assert.equal(byClass(root,'text-log-submit').disabled,true);
  const amount=byClass(row,'text-log-amount');amount.value='100';amount.emit('input');assert.equal(byClass(root,'text-log-submit').disabled,false);
  field(root,'date').value='2026-02-30';field(root,'date').emit('change');assert.equal(byClass(root,'text-log-submit').disabled,true);byClass(root,'text-log-submit').emit('click');assert.equal(added.length,0);
}));

test('文章の刺身とおでんの行から具材を確定し、全行を一度だけまとめて登録する',()=>withDocument(()=>{
  const added=[],requests=[],root=mounted({onAdd:entry=>added.push(entry),canConfigure:id=>['classic-sashimi-assorted','palette-oden'].includes(id),onConfigure:request=>requests.push(request)});
  parse(root,'ご飯150g、お刺身、おでん1皿');const rows=byClasses(root,'text-log-row');
  const fishSelect=byClass(rows[1],'text-log-recipe');assert.equal(fishSelect.children[1].value,'classic-sashimi-assorted');
  fishSelect.value='classic-sashimi-assorted';fishSelect.emit('change');
  assert.equal(byClass(rows[0],'text-log-configure').hidden,true);assert.equal(byClass(rows[1],'text-log-configure').hidden,false);
  byClass(rows[1],'text-log-configure').emit('click');assert.equal(requests.length,1);assert.equal(added.length,0);assert.equal(requests[0].initialRecipe,null);
  const fish=buildFoodSelection({kind:'sashimi',components:[{id:'tuna',amount:3,gramsPerUnit:20}]},data);
  fish.textConfiguration={recipeId:'classic-sashimi-assorted',selection:{kind:'sashimi',components:[{id:'tuna',amount:3,gramsPerUnit:20}]}};
  assert.equal(requests[0].onConfirm(fish),true);assert.match(byClass(rows[1],'text-log-configured').textContent,/3切れ/);
  assert.ok(all(byClass(rows[1],'text-log-standard')).some(node=>node.textContent.includes('まぐろ')&&node.textContent.includes('60g')));
  const fishAmount=byClass(rows[1],'text-log-amount');fishAmount.value='.5';fishAmount.emit('input');
  byClass(rows[1],'text-log-configure').emit('click');assert.deepEqual(requests[1].initialRecipe.textConfiguration,fish.textConfiguration);
  // 確認を取り消した場合はonConfirmを呼ばず、先の内訳と外側の量を保つ。
  assert.equal(fishAmount.value,'.5');
  byClass(rows[2],'text-log-configure').emit('click');
  const oden=buildFoodSelection({kind:'oden',components:[{id:'daikon',amount:2},{id:'egg',amount:1},{id:'broth',amount:0}]},data);
  assert.equal(requests[2].onConfirm(oden),true);
  const odenAmount=byClass(rows[2],'text-log-amount');odenAmount.value='2';odenAmount.emit('input');
  assert.equal(added.length,0);assert.equal(byClass(root,'text-log-submit').disabled,false);
  byClass(root,'text-log-submit').emit('click');assert.equal(added.length,1);assert.equal(added[0].items.length,3);
  const [,savedFish,savedOden]=added[0].items;
  assert.equal(savedFish.ingredients.find(p=>p.id==='tuna_lean_sashimi').amount*savedFish.quantity,30);
  assert.equal(savedOden.ingredients.find(p=>p.id==='daikon').amount*savedOden.quantity,240);
  assert.equal(savedOden.ingredients.some(p=>p.id==='soy_sauce'),false);
  assert.equal(Object.hasOwn(savedFish,'textConfiguration'),false);assert.equal(byClasses(root,'text-log-row').length,0);
}));

test('具材確定でgから皿へ変わる際は基準量へ戻し、再編集・標準復帰・料理変更を区別する',()=>withDocument(()=>{
  const added=[],requests=[],root=mounted({onAdd:entry=>added.push(entry),canConfigure:id=>id==='classic-sashimi-tuna',onConfigure:request=>requests.push(request)});
  parse(root,'まぐろ赤身の刺身100g');const row=byClass(root,'text-log-row'),amount=byClass(row,'text-log-amount');
  assert.equal(amount.value,'100');assert.equal(byClass(row,'text-log-unit').textContent,'g');
  const fish=buildFoodSelection({kind:'sashimi',components:[{id:'tuna',amount:3,gramsPerUnit:20}]},data);
  byClass(row,'text-log-configure').emit('click');assert.equal(requests[0].onConfirm(fish),true);
  assert.equal(amount.value,'1');assert.equal(byClass(row,'text-log-unit').textContent,'皿');assert.match(byClass(row,'text-log-row-note').textContent,/単位が変わった/);
  amount.value='2';amount.emit('input');byClass(row,'text-log-configure').emit('click');
  assert.equal(requests[1].onConfirm(fish),true);assert.equal(amount.value,'2');
  byClass(row,'text-log-config-reset').emit('click');assert.equal(amount.value,'100');assert.equal(byClass(row,'text-log-unit').textContent,'g');assert.equal(byClass(row,'text-log-configured').textContent,'');
  byClass(row,'text-log-configure').emit('click');assert.equal(requests[2].initialRecipe,null);assert.equal(requests[2].onConfirm(fish),true);
  const search=byClass(row,'text-log-search');search.value='ゆで卵';search.emit('input');const select=byClass(row,'text-log-recipe');select.value='classic-boiled-egg';select.emit('change');
  assert.equal(byClass(row,'text-log-configure').hidden,true);assert.equal(byClass(row,'text-log-configured').textContent,'');
  amount.value='1';amount.emit('input');byClass(root,'text-log-submit').emit('click');assert.equal(added.length,1);assert.equal(added[0].items[0].recipeId,'classic-boiled-egg');assert.equal(added[0].items[0].quantity,1);
}));

test('削除・検索変更・文章の再解析後に届いた詳細の確定を前の行へ適用しない',()=>withDocument(()=>{
  const requests=[],root=mounted({canConfigure:id=>id==='palette-oden',onConfigure:request=>requests.push(request)});
  const oden=buildFoodSelection({kind:'oden',components:[{id:'egg',amount:1}]},data);
  parse(root,'おでん');let row=byClass(root,'text-log-row');byClass(row,'text-log-configure').emit('click');
  byClass(row,'text-log-search').value='ご飯';byClass(row,'text-log-search').emit('input');assert.equal(requests[0].onConfirm(oden),false);
  parse(root,'おでん');row=byClass(root,'text-log-row');byClass(row,'text-log-configure').emit('click');
  parse(root,'おでん');assert.equal(requests[1].onConfirm(oden),false);
  row=byClass(root,'text-log-row');byClass(row,'text-log-configure').emit('click');byClass(row,'text-log-remove').emit('click');assert.equal(requests[2].onConfirm(oden),false);assert.equal(byClass(root,'text-log-submit').disabled,true);
}));

test('詳細の不正な内容は前の確定を壊さず、先に開いた編集の遅い確定も拒否する',()=>withDocument(()=>{
  const added=[],requests=[],root=mounted({onAdd:entry=>added.push(entry),canConfigure:id=>id==='palette-oden',onConfigure:request=>requests.push(request)});
  parse(root,'おでん');const row=byClass(root,'text-log-row'),oden=buildFoodSelection({kind:'oden',components:[{id:'egg',amount:1}]},data);
  byClass(row,'text-log-configure').emit('click');assert.equal(requests[0].onConfirm(oden),true);
  byClass(row,'text-log-configure').emit('click');byClass(row,'text-log-configure').emit('click');assert.equal(requests[1].onConfirm(oden),false);
  assert.equal(requests[2].onConfirm({...oden,servings:2}),false);
  byClass(root,'text-log-submit').emit('click');assert.equal(added.length,1);assert.equal(added[0].items[0].ingredients.length,1);assert.equal(added[0].items[0].ingredients[0].id,'egg');
}));

test('マフィン2個の外側の個数は、1個の具材を確定して皿表示へ変わっても保持する',()=>withDocument(()=>{
  const added=[],requests=[],root=mounted({onAdd:entry=>added.push(entry),canConfigure:id=>id==='palette-english-muffin',onConfigure:request=>requests.push(request)});
  parse(root,'イングリッシュマフィン2個');const row=byClass(root,'text-log-row'),amount=byClass(row,'text-log-amount');assert.equal(amount.value,'2');
  const muffin=buildFoodSelection({kind:'english-muffin',components:[{id:'base',amount:1},{id:'cheese',amount:20}]},data);
  byClass(row,'text-log-configure').emit('click');assert.equal(requests[0].onConfirm(muffin),true);assert.equal(amount.value,'2');assert.equal(byClass(row,'text-log-unit').textContent,'皿');
  byClass(root,'text-log-submit').emit('click');assert.equal(added.length,1);assert.equal(added[0].items[0].quantity,2);
  assert.equal(added[0].items[0].ingredients.find(p=>p.id==='palette_english_muffin').amount*added[0].items[0].quantity,120);
  assert.equal(added[0].items[0].ingredients.find(p=>p.id==='cheese').amount*added[0].items[0].quantity,40);
}));
