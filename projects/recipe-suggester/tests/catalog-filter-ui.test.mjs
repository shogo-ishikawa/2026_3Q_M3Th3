import test from 'node:test';
import assert from 'node:assert/strict';
import {renderCatalogFilters} from '../catalog-filter-ui.js';

class Element {
  constructor(tag) { this.tagName=tag.toUpperCase(); this.children=[]; this.attributes={}; this.listeners=new Map(); this.textContent=''; }
  append(...children) { this.children.push(...children); }
  setAttribute(name,value) { this.attributes[name]=value; }
  addEventListener(type,listener) { this.listeners.set(type,listener); }
  click() { this.listeners.get('click')?.({preventDefault(){}}); }
  set innerHTML(value) { throw new Error(`HTML must not be interpolated: ${value}`); }
}
const descendants = root => [root,...root.children.flatMap(descendants)];
const text = root => descendants(root).map(element=>element.textContent).join(' ');
const byClass = (root,name) => descendants(root).filter(element=>element.className?.split(' ').includes(name));
function withDocument(fn) {
  const prior=globalThis.document; globalThis.document={createElement:tag=>new Element(tag)};
  try { return fn(); } finally { if(prior===undefined)delete globalThis.document;else globalThis.document=prior; }
}

test('任意の条件だけを個別に外し、一括解除でもアレルギーと除外食材を保つ',()=>withDocument(()=>{
  const state={query:'トースト',genre:'洋食',allergens:['milk'],excludedIngredients:['tomato']};
  const root=renderCatalogFilters({filters:[
    {id:'query',label:'検索：トースト',onRemove:()=>{state.query='';}},
    {id:'genre',label:'ジャンル：洋食',onRemove:()=>{state.genre='all';}},
  ],protectedLabels:['アレルギー：乳','避ける食材：トマト'],onClear:()=>{state.query='';state.genre='all';}});
  const chips=byClass(root,'catalog-filter-chip');
  assert.equal(chips.length,2);assert.equal(chips[0].type,'button');
  assert.match(chips[0].attributes['aria-label'],/検索：トースト.*外す/);
  chips[0].click();assert.equal(state.query,'');assert.equal(state.genre,'洋食');
  state.query='ご飯';byClass(root,'catalog-filter-clear')[0].click();
  assert.equal(state.query,'');assert.equal(state.genre,'all');
  assert.deepEqual(state.allergens,['milk']);assert.deepEqual(state.excludedIngredients,['tomato']);
  assert.equal(byClass(root,'catalog-protected-filter-list')[0].children.length,2);
  assert.equal(byClass(root,'catalog-filter-settings')[0].attributes.href,'#settings');
}));

test('保護対象や未対応の識別子を任意フィルターとして渡しても解除ボタンを作らない',()=>withDocument(()=>{
  let called=0;
  const root=renderCatalogFilters({filters:[
    {id:'allergens',label:'アレルギー：卵',onRemove:()=>called++},
    {id:'excludedIngredients',label:'避ける食材：生トマト',onRemove:()=>called++},
    {id:'unrecognised',label:'保護された条件',onRemove:()=>called++},
  ],onClear:()=>called++});
  assert.equal(byClass(root,'catalog-filter-chip').length,0);
  assert.equal(byClass(root,'catalog-filter-clear').length,0);
  assert.equal(descendants(root).filter(element=>element.tagName==='BUTTON').length,0);
  assert.equal(byClass(root,'catalog-protected-filter-list')[0].children.length,3);
  assert.equal(called,0);assert.match(text(root),/自動では解除しません/);
}));

test('0件のときは現在の条件を具体的に示し、測定していない原因や候補数を断定しない',()=>withDocument(()=>{
  const root=renderCatalogFilters({filters:[{id:'query',label:'検索：ピザ',onRemove(){}},{id:'illustrated',label:'完成イラスト付き',onRemove(){}}],resultCount:0});
  const explanation=byClass(root,'catalog-filter-empty')[0];
  assert.equal(explanation.attributes.role,'status');
  assert.match(text(explanation),/検索：ピザ.*完成イラスト付き/);
  assert.match(text(explanation),/1つずつ外して/);
  assert.equal(byClass(root,'catalog-filter-alternative').length,0);
  assert.doesNotMatch(text(explanation),/原因です|外すと\d+種類/);
}));

test('単独解除で得られる候補数が測定済みのときだけ、その条件を外す提案を出す',()=>withDocument(()=>{
  const removed=[];
  const root=renderCatalogFilters({filters:[
    {id:'query',label:'検索：ピザ',countWithout:0,onRemove:()=>removed.push('query')},
    {id:'genre',label:'ジャンル：和食',countWithout:4,onRemove:()=>removed.push('genre')},
    {id:'nature',label:'調理形態：そのまま',countWithout:'5',onRemove:()=>removed.push('nature')},
  ],resultCount:0,protectedLabels:['アレルギー：乳']});
  const alternatives=byClass(root,'catalog-filter-alternative');
  assert.equal(alternatives.length,1);assert.match(alternatives[0].textContent,/ジャンル：和食.*4種類/);
  alternatives[0].click();assert.deepEqual(removed,['genre']);
  assert.match(text(root),/除外条件はそのまま保ちます/);
}));

test('検索文字と条件名をHTMLとして解釈せず、渡された配列や条件を変更しない',()=>withDocument(()=>{
  const query='<img src=x onerror=alert(1)>',protectedLabels=['<script>invalid()</script>'];
  const filters=[{id:'query',label:query,onRemove(){}}];
  const before=filters.map(({id,label})=>({id,label}));
  const root=renderCatalogFilters({filters,protectedLabels,resultCount:0});
  assert.ok(text(root).includes(query));assert.ok(text(root).includes(protectedLabels[0]));
  assert.equal(descendants(root).filter(element=>['IMG','SCRIPT'].includes(element.tagName)).length,0);
  assert.deepEqual(filters.map(({id,label})=>({id,label})),before);
  assert.deepEqual(protectedLabels,['<script>invalid()</script>']);
}));

test('条件のない通常表示では非表示にし、0件の案内は条件なしでも表示する',()=>withDocument(()=>{
  assert.equal(renderCatalogFilters({resultCount:12}).hidden,true);
  const empty=renderCatalogFilters({resultCount:0});assert.equal(empty.hidden,false);
  assert.match(text(empty),/別の料理名や種類/);
  const protectedOnly=renderCatalogFilters({protectedLabels:['避ける食材：トマト'],resultCount:2});
  assert.equal(protectedOnly.hidden,false);assert.equal(byClass(protectedOnly,'catalog-filter-clear').length,0);
}));
