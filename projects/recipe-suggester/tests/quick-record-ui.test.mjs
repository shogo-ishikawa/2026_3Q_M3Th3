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
  assert.match(byClass(disclosure,'record-summary-material-preview').textContent,/約75g/);
  byClass(root,'quick-record-date').value='2026-11-14';byClass(root,'quick-record-date').emit('change');
  classes(root,'quick-record-meal').find(node=>node.dataset.meal==='lunch').emit('click');
  const status=byClass(root,'quick-record-status');status.value='planned';status.emit('change');
  assert.match(byClass(root,'record-summary-context').textContent,/2026-11-14 昼食・これからの予定/);
  assert.match(byClass(root,'record-summary-material-preview').textContent,/約75g/);
  const currentQuantity=byClass(root,'quick-record-amount');currentQuantity.value='';currentQuantity.emit('input');
  assert.equal(byClass(root,'record-summary-content').hidden,true);assert.equal(byClass(root,'record-summary-prompt').hidden,false);
  assert.deepEqual(favourite,before);
  const recentRoot=mounted({entries:[entry(180)]});assert.match(byClass(recentRoot,'record-summary-material-preview').textContent,/180g/);
}));

const change=(control,value,event='change')=>{control.value=value;control.emit(event);};
const switchTo=(root,mode)=>classes(root,'record-search-mode').find(button=>button.dataset.mode===mode).emit('click');

test('順に選ぶ範囲内に該当がなくても分類を保ち、全体検索を切り替えても各検索語を保つ',()=>withDocument(()=>{
  const saves=[],opened=[];
  const root=mounted({onSearchStateChange:value=>saves.push(value),onOpenRecipe:(...args)=>opened.push(args)});
  const query=byClass(root,'record-search-query');
  change(query,'からあげ','input');assert.ok(classes(root,'record-search-choice').some(node=>node.dataset.recipeId==='classic-karaage-thigh'));
  switchTo(root,'guided');change(byClass(root,'record-search-family'),'rice');
  change(query,'からあげ','input');assert.equal(classes(root,'record-search-choice').length,0);
  assert.equal(byClass(root,'record-search-family').value,'rice');assert.match(byClass(root,'record-search-count').textContent,/ありません/);
  change(query,'玄米','input');assert.ok(classes(root,'record-search-choice').length>0);
  switchTo(root,'keyword');assert.equal(query.value,'からあげ');assert.ok(classes(root,'record-search-choice').length>0);
  switchTo(root,'guided');assert.equal(query.value,'玄米');assert.equal(byClass(root,'record-search-family').value,'rice');
  const restored=mounted({searchState:saves.at(-1)});assert.equal(byClass(restored,'record-search-query').value,'玄米');
  byClass(root,'record-search-choice').emit('click');assert.equal(opened.length,1);assert.equal(opened[0][2],'玄米');
  assert.ok(opened[0][3].includes(opened[0][0]));assert.ok(!opened[0][3].includes('classic-karaage-thigh'));
}));

test('主菜の食材・調理法・形態を保ったままレシピ名をかなで探し、材料からも検索できる',()=>withDocument(()=>{
  const captured=[];
  const root=mounted({onOpenRecipe:(...args)=>captured.push(args)});switchTo(root,'guided');
  change(byClass(root,'record-search-section'),'main');change(byClass(root,'record-search-category'),'fish');
  change(byClass(root,'record-search-method'),'grill');change(byClass(root,'record-search-nature'),'home-cooked');
  const query=byClass(root,'record-search-query');change(query,'さけのしおやき','input');
  const result=classes(root,'record-search-choice').find(node=>node.dataset.recipeId==='classic-grilled-salmon');assert.ok(result);
  result.emit('click');assert.ok(captured[0][3].includes('classic-grilled-salmon'));
  change(query,'とりのからあげ','input');assert.equal(classes(root,'record-search-choice').length,0);
  assert.equal(byClass(root,'record-search-method').value,'grill');assert.equal(byClass(root,'record-search-category').value,'fish');
  switchTo(root,'keyword');change(query,'れんこん','input');assert.ok(classes(root,'record-search-choice').length>0);
  const actualConfirmations=[];query.emit('keydown',{key:'Enter',isComposing:true,preventDefault:()=>actualConfirmations.push('IME')});
  query.emit('keydown',{key:'Enter',preventDefault:()=>actualConfirmations.push('submit')});assert.deepEqual(actualConfirmations,['submit']);
}));

test('料理の種類から選び直したバリエーションを詳細へ渡し、検索結果を超えて補わない',()=>withDocument(()=>{
  const opened=[],root=mounted({onOpenRecipe:(...args)=>opened.push(args)});
  const query=byClass(root,'record-search-query');change(query,'トースト','input');
  const card=classes(root,'record-search-result').find(node=>classes(node,'record-search-choice')[0].dataset.recipeId==='bread-toast-custom');
  const select=byClass(card,'record-search-variant');assert.ok(select.children.some(option=>option.value==='bread-toast-pizza'));
  change(select,'bread-toast-pizza');byClass(card,'record-search-choice').emit('click');assert.equal(opened[0][0],'bread-toast-pizza');
  change(query,'ピザトースト','input');assert.ok(classes(root,'record-search-choice').some(node=>node.dataset.recipeId==='bread-toast-pizza'));
  assert.ok(classes(root,'record-search-variant').every(node=>node.children.every(option=>option.value!=='bread-toast-custom')));
}));

test('簡単記録の材料編集はお気に入りと実食を区別し、選んだ分量と記録のIDを渡す',()=>withDocument(()=>{
  const added=entry(120,'2026-11-13'), favourite=createFavourite(added.items[0],data), changes=[];
  const root=mounted({favourites:[favourite],entries:[added],onEditItem:(...args)=>changes.push(args)});
  change(byClass(root,'quick-record-amount'),'100','input');classes(root,'quick-record-edit')[0].emit('click');
  assert.equal(changes[0][0].quantity,100/150);assert.equal(changes[0][2],undefined);assert.deepEqual(changes[0][1],{date:'2026-11-13',meal:'breakfast',status:'eaten'});
  const last=classes(root,'quick-record-edit').at(-1);last.emit('click');assert.equal(changes[1][2],added.id);
  changes[1][0].ingredients[0].amount=12345;assert.notEqual(added.items[0].ingredients[0].amount,12345);
}));

test('焼き鮭の別名は料理全体と魚介の焼き物に共通し、選択中の肉料理や煮物には含めない',()=>withDocument(()=>{
  const root=mounted({});
  const query=byClass(root,'record-search-query');
  const salmon=()=>classes(root,'record-search-choice').some(node=>node.dataset.recipeId==='classic-grilled-salmon');
  change(query,'焼き鮭','input');assert.ok(salmon());
  switchTo(root,'guided');change(byClass(root,'record-search-section'),'main');
  change(byClass(root,'record-search-category'),'fish');change(byClass(root,'record-search-method'),'grill');
  for(const term of ['さけ','焼き鮭','焼きしゃけ']){change(query,term,'input');assert.ok(salmon(),term);}
  change(byClass(root,'record-search-method'),'simmer');assert.equal(classes(root,'record-search-choice').length,0);
  change(byClass(root,'record-search-category'),'meat');change(byClass(root,'record-search-method'),'grill');
  assert.equal(classes(root,'record-search-choice').length,0);
}));
