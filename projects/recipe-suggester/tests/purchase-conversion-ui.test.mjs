import test from 'node:test';
import assert from 'node:assert/strict';
import {INGREDIENTS} from '../data.js';
import {mountPurchaseEditor} from '../purchase-conversion-ui.js';
class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.listeners=new Map();this.textContent='';this.className='';this.dataset={};this.style={};}
  append(...children){this.children.push(...children);}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(type,fn){this.listeners.set(type,[...(this.listeners.get(type)??[]),fn]);}
  dispatchEvent(event){for(const fn of this.listeners.get(event.type)??[])fn(event);return true;}
  emit(type,properties={}){this.dispatchEvent({type,target:this,preventDefault(){},...properties});}
}
const all=root=>[root,...root.children.flatMap(all)],find=(root,name)=>{const value=all(root).find(element=>element.className.split(' ').includes(name));assert.ok(value,name);return value;};
const data={ingredients:INGREDIENTS},item={id:'rice',unit:'g',required:460,stock:230,buy:230};
function doc(fn){const old=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};try{fn();}finally{if(old===undefined)delete globalThis.document;else globalThis.document=old;}}
test('購入量のライブ表示は保存するまで設定を変更せず、包装をまとめて保存する',()=>doc(()=>{
  const saved=[],settings=[],root=mountPurchaseEditor({item,data,settings,onSave:value=>saved.push(value)});
  assert.equal(root.tagName,'DETAILS');assert.match(find(root,'purchase-preview').textContent,/生米.*100g/);assert.equal(saved.length,0);
  find(root,'purchase-pack-size').value='80';find(root,'purchase-pack-size').emit('input');assert.match(find(root,'purchase-preview').textContent,/2パック/);assert.equal(saved.length,0);assert.deepEqual(settings,[]);
  find(root,'purchase-save').emit('click');assert.equal(saved.length,1);assert.equal(saved[0][0].yieldFactor,2.3);assert.equal(saved[0][0].packSize,80);
  assert.ok(!all(root).some(element=>element.tagName==='FORM'));
}));
test('空欄や0係数で以前の結果を保存できず、同じ状態へ戻すと元の単位で扱う',()=>doc(()=>{
  const root=mountPurchaseEditor({item,data});const factor=find(root,'purchase-factor');factor.value='';factor.emit('input');assert.equal(find(root,'purchase-save').disabled,true);assert.equal(find(root,'purchase-preview').textContent,'');
  factor.value='0';factor.emit('input');assert.equal(find(root,'purchase-save').disabled,true);
  const mode=find(root,'purchase-mode');mode.value='same';mode.emit('change');assert.equal(find(root,'purchase-save').disabled,false);assert.equal(factor.value,'1');assert.equal(factor.disabled,true);assert.match(find(root,'purchase-explanation').textContent,/不足 230gを同じ状態/);
  assert.equal(find(root,'purchase-name').value,INGREDIENTS.rice.name);
}));
test('ゆでうどんの参考設定は明示的に選び、乾重量と生麺の違いを表示する',()=>doc(()=>{
  const root=mountPurchaseEditor({item:{id:'udon',unit:'g',buy:300},data});assert.match(find(root,'purchase-preview').textContent,/300g/);
  const preset=find(root,'purchase-preset'),choice=preset.children.find(option=>option.textContent.includes('ゆで上がり3倍'));assert.ok(choice);preset.value=choice.value;preset.emit('change');
  assert.match(find(root,'purchase-preview').textContent,/干しうどん（乾） 約100g/);assert.match(find(root,'purchase-basis').textContent,/生麺・冷凍麺・乾麺/);
}));

test('1包装の量は1刻みで小数入力を保ち、不正入力を空欄扱いで保存しない',()=>doc(()=>{
  const saved=[],root=mountPurchaseEditor({item,data,onSave:value=>saved.push(value)}),pack=find(root,'purchase-pack-size');
  pack.value='80.5';pack.emit('keydown',{key:'ArrowUp'});assert.equal(Number(pack.value),81.5);find(root,'purchase-save').emit('click');assert.equal(saved[0][0].packSize,81.5);
  pack.value='';pack.validity={badInput:true};pack.emit('input');assert.equal(find(root,'purchase-save').disabled,true);find(root,'purchase-save').emit('click');assert.equal(saved.length,1);
  pack.validity={badInput:false};pack.emit('input');assert.equal(find(root,'purchase-save').disabled,false);find(root,'purchase-save').emit('click');assert.equal(saved[1][0].packSize,null);
}));
