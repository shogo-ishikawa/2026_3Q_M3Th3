import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {createCatalogEntry} from '../record-actions.js';
import {createFavourite} from '../favourites.js';
import {mountFavourites} from '../favourites-ui.js';
class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.listeners=new Map();this.textContent='';this.className='';this.dataset={};this.style={};}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(type,listener){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(listener);}
  dispatchEvent(event){for(const listener of this.listeners.get(event.type)??[])listener(event);return true;}
  emit(type,properties={}){this.dispatchEvent({type,target:this,preventDefault(){},...properties});}
}
const all=root=>[root,...root.children.flatMap(all)];
const byClass=(root,value)=>{const result=all(root).find(node=>node.className.split(' ').includes(value));assert.ok(result,value);return result;};
const field=(root,suffix)=>{const result=all(root).find(node=>node.id?.endsWith(`-${suffix}`));assert.ok(result,suffix);return result;};
const withDocument=fn=>{const old=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};try{return fn();}finally{if(old===undefined)delete globalThis.document;else globalThis.document=old;}};
const data={allergens:ALLERGENS,ingredients:INGREDIENTS,recipes:RECIPES};
const entry=(amount=120,date='2026-11-10',status='eaten')=>createCatalogEntry({recipeId:'plain-rice',amount,date,meal:'breakfast',status},data);

test('お気に入りを前回のg数で表示し、1刻み・小数と登録先の指定を反映する',()=>withDocument(()=>{
  const original=entry().items[0],favourite=createFavourite(original,data),added=[],removed=[];
  const root=mountFavourites({favourites:[favourite],entries:[],data,date:'2026-11-13',meal:'lunch',status:'planned',onAdd:value=>added.push(value),onDelete:id=>removed.push(id)});
  const quantity=byClass(root,'favourites-amount');assert.equal(quantity.value,'120');assert.equal(quantity.step,'any');quantity.emit('keydown',{key:'ArrowUp'});assert.equal(quantity.value,'121');
  quantity.value='75.5';quantity.emit('input');field(root,'date').value='2026-11-14';byClass(root,'favourites-add').emit('click');
  assert.equal(added.length,1);assert.equal(added[0].date,'2026-11-14');assert.equal(added[0].meal,'lunch');assert.equal(added[0].status,'planned');assert.equal(added[0].items[0].quantity,75.5/150);assert.deepEqual(added[0].items[0].nutrition,original.nutrition);
  byClass(root,'favourites-remove').emit('click');assert.deepEqual(removed,[favourite.id]);assert.equal(original.quantity,.8);
}));

test('最近の実食を選んだ量でお気に入りへ保存し、登録済みの同じ内容を重複させない',()=>withDocument(()=>{
  const saved=[],entries=[entry(100),entry(180),entry(300,'2026-11-14'),entry(200,'2026-11-12','planned')],root=mountFavourites({favourites:[],entries,data,date:'2026-11-13',onSave:value=>saved.push(value)});
  assert.equal(all(root).filter(node=>node.className==='favourites-card').length,1);
  const qty=byClass(root,'favourites-amount');assert.equal(qty.value,'180');qty.value='200';byClass(root,'favourites-save').emit('click');assert.equal(saved.length,1);assert.equal(saved[0].item.quantity,200/150);
  const mounted=mountFavourites({favourites:saved,entries,data,date:'2026-11-13'});assert.equal(byClass(mounted,'favourites-save').disabled,true);
  byClass(mounted,'favourites-search').value='存在しない料理';byClass(mounted,'favourites-search').emit('input');assert.equal(all(mounted).filter(node=>node.className==='favourites-card').length,0);
}));

test('不正な数量で記録せず、作り置きを最近の単品へ混ぜない',()=>withDocument(()=>{
  const source=entry(),batch=entry(50);batch.items[0].batchId='batch-held';const added=[],errors=[];
  const root=mountFavourites({favourites:[],entries:[source,batch],data,date:'2026-11-13',onAdd:value=>added.push(value),onError:value=>errors.push(value)}),qty=byClass(root,'favourites-amount');
  assert.equal(all(root).filter(node=>node.className==='favourites-card').length,1);
  for(const value of ['','0','-1','0x10','1e2','1000001']){qty.value=value;byClass(root,'favourites-add').emit('click');}
  qty.value='';qty.validity={badInput:true};byClass(root,'favourites-add').emit('click');assert.equal(added.length,0);assert.equal(errors.length,7);assert.equal(byClass(root,'favourites-error').hidden,false);
}));
