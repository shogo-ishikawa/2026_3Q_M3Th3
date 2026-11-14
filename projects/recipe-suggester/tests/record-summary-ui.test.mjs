import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecordSummary} from '../record-summary-ui.js';

class Element {
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.className='';this.textContent='';this.hidden=false;this.open=false;}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  setAttribute(key,value){this.attributes[key]=value;}
}
const all=root=>[root,...root.children.flatMap(all)];
const byClass=(root,name)=>{const result=all(root).find(node=>node.className.split(' ').includes(name));assert.ok(result,name);return result;};
const withDocument=fn=>{const old=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};try{return fn();}finally{if(old===undefined)delete globalThis.document;else globalThis.document=old;}};
const data={allergens:[],recipes:[],ingredients:{bread:{name:'食パン',unit:'g'},butter:{name:'バター',unit:'g'}}};
const entry=()=>({date:'2026-11-14',meal:'breakfast',status:'eaten',items:[{
  id:'toast',recipeId:null,name:'トースト',quantity:2,nutrition:{kcal:200,protein:6,fat:4,carbs:30,fiber:2,salt:.6},
  ingredients:[{id:'bread',amount:60},{id:'butter',amount:5}],groups:[],proteinSources:[],allergens:[],
  allergensKnown:true,ingredientsKnown:true,steps:[],role:'staple',portion:{amount:1,unit:'枚'},
}]});

test('料理・量・登録先の変更で合計を更新し、材料の開閉状態を保つ',()=>withDocument(()=>{
  const source=entry(),before=structuredClone(source),api=createRecordSummary({getEntry:()=>source,data});
  assert.match(byClass(api.element,'record-summary-context').textContent,/2026-11-14 朝食・食べた/);
  assert.equal(byClass(api.element,'record-summary-total').textContent,'1品・合計 400 kcal');
  assert.match(byClass(api.element,'record-summary-material-preview').textContent,/食パン 120g.*バター 10g/);
  const details=byClass(api.element,'record-summary-materials');details.open=true;
  source.items[0].quantity=.5;source.date='2026-11-15';source.meal='lunch';source.status='planned';
  const summary=api.refresh();
  assert.equal(summary.items[0].amount,.5);assert.equal(byClass(api.element,'record-summary-total').textContent,'1品・合計 100 kcal');
  assert.match(byClass(api.element,'record-summary-material-preview').textContent,/食パン 30g.*バター 2.5g/);
  assert.match(byClass(api.element,'record-summary-context').textContent,/2026-11-15 昼食・これからの予定/);
  assert.equal(details.open,true);assert.deepEqual(source.items[0].nutrition,before.items[0].nutrition);
}));

test('選択途中や不正な分量では以前の合計を隠し、選び直すと復帰する',()=>withDocument(()=>{
  let source=null;const api=createRecordSummary({getEntry:()=>source,data:()=>data});
  assert.equal(byClass(api.element,'record-summary-prompt').hidden,false);
  assert.equal(byClass(api.element,'record-summary-content').hidden,true);
  source=entry();assert.ok(api.refresh());assert.equal(byClass(api.element,'record-summary-content').hidden,false);
  source.items[0].quantity=0;assert.equal(api.refresh(),null);
  assert.equal(byClass(api.element,'record-summary-content').hidden,true);
  assert.equal(byClass(api.element,'record-summary-prompt').hidden,false);
  source.items[0].quantity=1;assert.ok(api.refresh());
  assert.equal(byClass(api.element,'record-summary-prompt').hidden,true);
  assert.equal(byClass(api.element,'record-summary-total').textContent,'1品・合計 200 kcal');
}));

test('栄養の全未入力と一部の不明分を、確認済みの0と区別して表示する',()=>withDocument(()=>{
  const source=entry();source.items[0].nutrition.kcal=null;source.items[0].nutrition.fat=null;
  const api=createRecordSummary({getEntry:()=>source,data});
  assert.equal(byClass(api.element,'record-summary-total').textContent,'1品・合計 未入力');
  const fat=all(api.element).find(node=>node.tagName==='DT'&&node.textContent==='脂質');
  const pair=all(api.element).find(node=>node.children.includes(fat));
  assert.equal(pair.children[1].textContent,'未入力');
  const other=structuredClone(source.items[0]);other.id='other';other.nutrition={...other.nutrition,kcal:0,fat:0};
  source.items.push(other);api.refresh();
  assert.equal(byClass(api.element,'record-summary-total').textContent,'2品・合計 0 kcal ＋不明分');
}));

test('例外がある getter でも登録合計を捏造せず、登録材料の未確認を表示する',()=>withDocument(()=>{
  const source=entry();source.items[0].ingredientsKnown=false;
  const api=createRecordSummary({getEntry:()=>source,data});
  assert.equal(byClass(api.element,'record-summary-warning').hidden,false);
  const incomplete=createRecordSummary({getEntry(){throw Error('quantity invalid');},data});
  assert.equal(incomplete.refresh(),null);assert.equal(byClass(incomplete.element,'record-summary-content').hidden,true);
  assert.throws(()=>createRecordSummary({data}),/登録内容/);
}));
