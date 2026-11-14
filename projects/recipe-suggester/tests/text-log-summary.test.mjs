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
const materials=root=>byClass(root,'record-summary-material-list').children.map(node=>node.textContent);

test('一括記録の確定具材・外側の量を合算し、取消後も入力と同じ内訳を表示する',()=>withDocument(()=>{
  const requests=[],attempts=[],root=mountTextLog({data,date:'2026-11-14',meal:'breakfast',status:'eaten',
    canConfigure:id=>id==='bread-toast-custom',onConfigure:value=>requests.push(value),
    onAdd:entry=>{attempts.push(entry);return false;}});
  parse(root,'トースト2枚、トースト1枚');const rows=byClasses(root,'text-log-row');
  const toast=buildFoodSelection({kind:'toast',components:[{id:'base',amount:1},{id:'butter',amount:5}]},data);
  for(const row of rows){
    const select=byClass(row,'text-log-recipe');select.value='bread-toast-custom';select.emit('change');
    byClass(row,'text-log-configure').emit('click');assert.equal(requests.at(-1).onConfirm(toast),true);
  }
  assert.equal(byClass(rows[0],'text-log-amount').value,'2');assert.equal(byClass(rows[1],'text-log-amount').value,'1');
  assert.equal(byClass(root,'record-summary-items').children.length,2);
  assert.ok(materials(root).some(value=>value.includes('食パン')&&value.includes('180g')));
  assert.ok(materials(root).some(value=>value==='バター 15g'));
  const amount=byClass(rows[0],'text-log-amount');amount.value='.5';amount.emit('change');
  assert.ok(materials(root).some(value=>value.includes('食パン')&&value.includes('90g')));
  assert.ok(materials(root).some(value=>value==='バター 7.5g'));
  field(root,'date').value='2026-11-15';field(root,'date').emit('change');
  field(root,'meal').value='lunch';field(root,'meal').emit('change');
  field(root,'status').value='planned';field(root,'status').emit('change');
  assert.equal(byClass(root,'record-summary-context').textContent,'2026-11-15 昼食・これからの予定');
  const beforeMaterials=materials(root),beforeEnergy=byClass(root,'record-summary-total').textContent;
  byClass(root,'text-log-submit').emit('click');
  assert.equal(attempts.length,1);assert.equal(attempts[0].date,'2026-11-15');assert.equal(attempts[0].meal,'lunch');assert.equal(attempts[0].status,'planned');
  assert.equal(attempts[0].items.reduce((n,item)=>n+item.ingredients.find(part=>part.id==='butter').amount*item.quantity,0),7.5);
  assert.equal(byClass(root,'text-log-source').value,'トースト2枚、トースト1枚');assert.equal(amount.value,'.5');
  assert.equal(byClass(root,'text-log-submit').disabled,false);assert.equal(byClass(root,'record-summary-content').hidden,false);
  assert.deepEqual(materials(root),beforeMaterials);assert.equal(byClass(root,'record-summary-total').textContent,beforeEnergy);
  byClass(rows[1],'text-log-remove').emit('click');
  assert.ok(materials(root).some(value=>value==='バター 2.5g'));
  assert.equal(byClass(root,'record-summary-items').children.length,1);
}));

test('行や日付が無効になったら古い合計を隠し、修正・再解析で正しい量へ戻す',()=>withDocument(()=>{
  const root=mountTextLog({data,date:'2026-11-14',meal:'breakfast'});parse(root,'ご飯150g');
  const amount=byClass(root,'text-log-amount');amount.value='75';amount.emit('change');
  assert.ok(materials(root).some(value=>value.includes('75g')));
  field(root,'date').value='2026-02-30';field(root,'date').emit('change');
  assert.equal(byClass(root,'record-summary-content').hidden,true);assert.equal(byClass(root,'text-log-submit').disabled,true);
  field(root,'date').value='2026-11-15';field(root,'date').emit('change');assert.equal(byClass(root,'record-summary-content').hidden,false);
  amount.value='';amount.emit('input');assert.equal(byClass(root,'record-summary-content').hidden,true);
  amount.value='100';amount.emit('input');assert.equal(byClass(root,'record-summary-content').hidden,false);
  const source=byClass(root,'text-log-source');source.value='ご飯50g';source.emit('input');
  assert.equal(byClass(root,'text-log-summary').hidden,true);assert.equal(byClass(root,'record-summary-content').hidden,true);
  byClass(root,'text-log-parse').emit('click');assert.equal(byClass(root,'record-summary-content').hidden,false);
  assert.ok(materials(root).some(value=>value.includes('50g')));
  source.value='';byClass(root,'text-log-parse').emit('click');assert.equal(byClass(root,'text-log-summary').hidden,true);
}));

test('一括記録の未入力栄養と未登録材料を、0や空の完全な内訳として表示しない',()=>withDocument(()=>{
  const unknown={id:'manual-unknown',name:'未知の朝食',role:'main',servings:1,minutes:1,staple:false,
    ingredients:[],steps:[],custom:true,manualNutrition:{kcal:null,protein:null,fat:null,carbs:null,fiber:null,salt:null},
    allergens:[],allergensKnown:false,ingredientsKnown:false,groups:[],proteinSources:[],portion:{amount:1,unit:'皿',label:'1皿'}};
  const root=mountTextLog({data:{...data,recipes:[...RECIPES,unknown]},date:'2026-11-14',meal:'breakfast'});
  parse(root,'未知の朝食1皿');assert.equal(byClass(root,'text-log-submit').disabled,false);
  assert.equal(byClass(root,'record-summary-total').textContent,'1品・合計 未入力');
  assert.equal(byClass(root,'record-summary-warning').hidden,false);
  assert.equal(byClass(root,'record-summary-materials').hidden,true);
}));
