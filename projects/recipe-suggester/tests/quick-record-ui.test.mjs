import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {createCatalogEntry} from '../record-actions.js';
import {createFavourite} from '../favourites.js';
import {quickRecipeChoices,mountQuickRecord} from '../quick-record-ui.js';

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
const classes=(root,value)=>all(root).filter(node=>node.className.split(' ').includes(value));
const byClass=(root,value)=>{const node=classes(root,value)[0];assert.ok(node,value);return node;};
const withDocument=fn=>{const old=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};try{return fn();}finally{if(old===undefined)delete globalThis.document;else globalThis.document=old;}};
const data={allergens:ALLERGENS,ingredients:INGREDIENTS,recipes:RECIPES};
const entry=(amount=120,date='2026-11-10',status='eaten',meal='breakfast')=>createCatalogEntry({recipeId:'plain-rice',amount,date,meal,status},data);
const mounted=options=>mountQuickRecord({data,date:'2026-11-13',meal:'breakfast',status:'eaten',...options});

test('かんたん検索も既存の読みと種類の標準値を使い、料理データを変更しない',()=>{
  const before=JSON.stringify(RECIPES);
  assert.equal(quickRecipeChoices(data,'トースト').find(choice=>choice.label==='トースト').recipeId,'bread-toast-custom');
  assert.equal(quickRecipeChoices(data,'ピザトースト').find(choice=>choice.label==='トースト').recipeId,'bread-toast-pizza');
  assert.ok(quickRecipeChoices(data,'からあげ').some(choice=>choice.recipeId==='classic-karaage-thigh'));
  assert.deepEqual(quickRecipeChoices(data,''),[]);assert.deepEqual(quickRecipeChoices(data,'未登録の宇宙料理'),[]);
  assert.equal(JSON.stringify(RECIPES),before);
});

test('保存済みの栄養・材料を保ち、変更した量と登録先を一度だけ渡す',()=>withDocument(()=>{
  const original=entry().items[0];original.nutrition.kcal=321;original.nutrition.fiber=null;
  const favourite=createFavourite(original,data),before=structuredClone(favourite),added=[],contexts=[];
  const root=mounted({favourites:[favourite],onAddEntry:value=>added.push(value),onContextChange:value=>contexts.push(value)});
  const quantity=byClass(root,'quick-record-amount');assert.equal(quantity.value,'120');quantity.value='75.5';quantity.emit('input');
  const targetDate=byClass(root,'quick-record-date');targetDate.value='2026-11-14';targetDate.emit('change');
  classes(root,'quick-record-meal').find(node=>node.dataset.meal==='lunch').emit('click');
  const status=byClass(root,'quick-record-status');status.value='planned';status.emit('change');
  const currentQuantity=byClass(root,'quick-record-amount');assert.equal(currentQuantity.value,'75.5');
  byClass(root,'quick-record-add').emit('click');assert.equal(added.length,1);
  assert.equal(added[0].date,'2026-11-14');assert.equal(added[0].meal,'lunch');assert.equal(added[0].status,'planned');
  assert.equal(added[0].items[0].quantity,75.5/150);assert.deepEqual(added[0].items[0].nutrition,favourite.item.nutrition);
  assert.deepEqual(added[0].items[0].ingredients,favourite.item.ingredients);assert.notEqual(added[0].items[0].id,favourite.item.id);
  assert.deepEqual(favourite,before);assert.deepEqual(contexts.at(-1),{date:'2026-11-14',meal:'lunch',status:'planned'});
}));

test('確認を取り消しても数量を保ち、不正な数量や日付を保存側へ渡さない',()=>withDocument(()=>{
  const favourite=createFavourite(entry().items[0],data),attempts=[],errors=[];
  const root=mounted({favourites:[favourite],onAddEntry:value=>{attempts.push(value);return false;},onError:value=>errors.push(value)});
  const quantity=byClass(root,'quick-record-amount');quantity.value='75.25';byClass(root,'quick-record-add').emit('click');
  assert.equal(attempts.length,1);assert.equal(quantity.value,'75.25');
  for(const value of ['','0','-1','0x10','1e2','1000001']){quantity.value=value;byClass(root,'quick-record-add').emit('click');}
  quantity.value='120';byClass(root,'quick-record-date').value='2026-02-30';byClass(root,'quick-record-add').emit('click');
  assert.equal(attempts.length,1);assert.equal(errors.length,7);assert.equal(byClass(root,'quick-record-error').hidden,false);
}));

test('最近の料理は実食・指定日以前のみで、お気に入りと作り置きを重複表示しない',()=>withDocument(()=>{
  const saved=entry(100),favourite=createFavourite(saved.items[0],data);
  const newer=entry(180),future=entry(300,'2026-11-14'),planned=entry(200,'2026-11-12','planned'),batch=entry(50);batch.items[0].batchId='batch-held';
  const root=mounted({favourites:[favourite],entries:[saved,newer,future,planned,batch]});
  assert.equal(classes(root,'quick-record-food').length,1);
  const noFavourites=mounted({entries:[saved,newer,future,planned,batch]});
  assert.equal(classes(noFavourites,'quick-record-food').length,1);assert.equal(byClass(noFavourites,'quick-record-amount').value,'180');
}));

test('検索候補は保存せず既存の詳細へ記録先を渡し、記録の詳細は独立したコピーを渡す',()=>withDocument(()=>{
  const entries=[entry(150,'2026-11-13'),entry(100,'2026-11-13','planned'),entry(50,'2026-11-13','eaten','lunch')],opened=[],items=[],added=[];
  const root=mounted({entries,onOpenRecipe:(...values)=>opened.push(values),onOpenItem:item=>items.push(item),onAddEntry:item=>added.push(item)});
  byClass(root,'quick-record-search').value='トースト';byClass(root,'quick-record-search').emit('input');
  const firstChoice=classes(root,'quick-record-choice')[0];firstChoice.emit('click');
  assert.equal(opened[0][0],'bread-toast-custom');assert.deepEqual(opened[0][1],{date:'2026-11-13',meal:'breakfast',status:'eaten'});assert.equal(added.length,0);
  assert.equal(byClass(root,'quick-record-entry-list').children.length,1);
  byClass(root,'quick-record-item-name').emit('click');assert.deepEqual(items[0],entries[0].items[0]);
  items[0].quantity=999;assert.equal(entries[0].items[0].quantity,1);
}));

test('避ける食材の警告と未知の栄養を保持し、名前をHTMLとして挿入しない',()=>withDocument(()=>{
  const item=entry().items[0];item.name='<img src=x onerror=alert(1)>';item.nutrition.kcal=null;
  const favourite=createFavourite(item,data),ingredient=item.ingredients[0].id;
  const root=mounted({favourites:[favourite],settings:{excludedIngredients:[ingredient]}});
  assert.equal(byClass(root,'quick-record-food-name').textContent,item.name);
  assert.equal(byClass(root,'quick-record-energy').textContent,'エネルギー未入力');
  assert.ok(classes(root,'quick-record-warning').some(node=>node.textContent.includes('除外中の食材')));
  assert.equal(all(root).some(node=>node.tagName==='IMG'),false);
}));

test('かんたん料理の詳細へ現在の編集量を渡し、元のお気に入りを変更しない',()=>withDocument(()=>{
  const favourite=createFavourite(entry(120).items[0],data),before=structuredClone(favourite),opened=[];
  const root=mounted({favourites:[favourite],onOpenItem:item=>opened.push(item)});
  const quantity=byClass(root,'quick-record-amount');quantity.value='75.5';quantity.emit('input');
  byClass(root,'quick-record-food-name').emit('click');assert.equal(opened.length,1);
  assert.equal(opened[0].quantity,75.5/150);assert.deepEqual(opened[0].nutrition,favourite.item.nutrition);
  opened[0].ingredients[0].amount=999;assert.deepEqual(favourite,before);
  quantity.value='';byClass(root,'quick-record-food-name').emit('click');assert.equal(opened.length,1);
}));

test('お気に入りと最近の直接登録も、実際の量と材料の合計を開いて確認できる',()=>withDocument(()=>{
  const favourite=createFavourite(entry(120).items[0],data),before=structuredClone(favourite),root=mounted({favourites:[favourite]});
  const disclosure=byClass(root,'quick-record-summary');assert.equal(disclosure.tagName,'DETAILS');assert.equal(disclosure.open,false);
  assert.match(byClass(disclosure,'record-summary-material-preview').textContent,/120g/);
  const quantity=byClass(root,'quick-record-amount');quantity.value='75.5';quantity.emit('change');
  assert.match(byClass(disclosure,'record-summary-material-preview').textContent,/75.5g/);
  byClass(root,'quick-record-date').value='2026-11-14';byClass(root,'quick-record-date').emit('change');
  classes(root,'quick-record-meal').find(node=>node.dataset.meal==='lunch').emit('click');
  const status=byClass(root,'quick-record-status');status.value='planned';status.emit('change');
  assert.match(byClass(root,'record-summary-context').textContent,/2026-11-14 昼食・これからの予定/);
  assert.match(byClass(root,'record-summary-material-preview').textContent,/75.5g/);
  const currentQuantity=byClass(root,'quick-record-amount');currentQuantity.value='';currentQuantity.emit('input');
  assert.equal(byClass(root,'record-summary-content').hidden,true);assert.equal(byClass(root,'record-summary-prompt').hidden,false);
  assert.deepEqual(favourite,before);
  const recentRoot=mounted({entries:[entry(180)]});assert.match(byClass(recentRoot,'record-summary-material-preview').textContent,/180g/);
}));
