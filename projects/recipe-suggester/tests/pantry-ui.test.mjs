import test from 'node:test';
import assert from 'node:assert/strict';
import {INGREDIENTS} from '../data.js';
import {createPantryExtraIngredients} from '../pantry-extra-ingredients.js';
import {mountPantry} from '../pantry-ui.js';
class Element{
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.listeners=new Map();this.textContent='';this.className='';this.dataset={};this.value='';this.disabled=false;this.hidden=false;}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=[...children];}
 setAttribute(key,value){this.attributes[key]=String(value);}
 getAttribute(key){return this.attributes[key]??null;}
 addEventListener(type,fn){this.listeners.set(type,[...(this.listeners.get(type)??[]),fn]);}
 emit(type){for(const fn of this.listeners.get(type)??[])fn({type,target:this});}
 setCustomValidity(value){this.validationMessage=value;}
 set innerHTML(value){throw Error('Use textContent for food names.');}
}
const all=root=>[root,...root.children.flatMap(all)];
const text=root=>all(root).map(x=>x.textContent).join(' ');
const byClass=(root,value)=>all(root).filter(x=>x.className.split(' ').includes(value));
const withDocument=fn=>{const old=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};try{return fn();}finally{if(old===undefined)delete globalThis.document;else globalThis.document=old;}};
const data={ingredients:{...INGREDIENTS,...createPantryExtraIngredients(INGREDIENTS)}};
const control=(root,value)=>byClass(root,`pantry-browser-${value}`)[0];
const options=element=>all(element).filter(x=>x.tagName==='OPTION').map(x=>({value:x.value,label:x.textContent}));
const select=(element,value)=>{element.value=value;element.emit('change');};

test('ジャンル→種類→具体的な食材を選び、明示した単位の量で登録できる',()=>withDocument(()=>{
 const saved=[],filters=[],source=[],root=mountPantry({data,pantry:source,onSave:(...args)=>saved.push(args),onFilterChange:value=>filters.push(value)});
 assert.equal(control(root,'ingredient').disabled,true);assert.equal(control(root,'save').disabled,true);
 select(control(root,'group'),'meat');assert.ok(options(control(root,'subgroup')).some(x=>x.value==='beef'));assert.equal(control(root,'ingredient').disabled,true);
 select(control(root,'subgroup'),'beef');const foods=options(control(root,'ingredient'));assert.ok(foods.some(x=>x.value==='beef_round_raw'));assert.ok(!foods.some(x=>x.value==='pork'));
 select(control(root,'ingredient'),'beef_round_raw');assert.equal(control(root,'unit').textContent,'単位：g');assert.match(control(root,'quantity').attributes['aria-label'],/牛もも肉.*g/);
 control(root,'quantity').value='200.5';control(root,'quantity').emit('input');assert.equal(control(root,'save').disabled,false);control(root,'save').emit('click');
 assert.deepEqual(saved,[['beef_round_raw',200.5]]);assert.equal(byClass(root,'pantry-browser-stock-row').length,1);assert.match(text(root),/輸入牛もも肉/);assert.deepEqual(source,[]);
 assert.deepEqual(filters.at(-1),{group:'meat',subgroup:'beef',query:''});
}));

test('ジャンル未選択でも検索でき、合い挽きを牛肉へ混ぜずに選べる',()=>withDocument(()=>{
 const root=mountPantry({data}),search=control(root,'search');search.value='合い挽き';search.emit('input');
 assert.ok(options(control(root,'ingredient')).some(x=>x.value==='beef_pork_mince_raw'));assert.ok(all(control(root,'ingredient')).some(x=>x.tagName==='OPTGROUP'&&/合い挽き・混合/.test(x.label)));
 search.value='絶対にない食材';search.emit('input');assert.equal(control(root,'ingredient').disabled,true);assert.match(control(root,'results').textContent,/0種類/);
}));

test('現在の在庫を種類別に表示し、変更と削除の対象を正しく渡す',()=>withDocument(()=>{
 const pantry=[{id:'beef_tongue',amount:10},{id:'beef',amount:200},{id:'pork',amount:100}],original=structuredClone(pantry),saved=[],deleted=[];
 const root=mountPantry({data,pantry,onSave:(...args)=>saved.push(args),onDelete:id=>deleted.push(id)});
 const rows=byClass(root,'pantry-browser-stock-row');assert.deepEqual(rows.map(x=>x.dataset.ingredientId),['beef','beef_tongue','pork']);
 const quantity=byClass(rows[0],'pantry-browser-stock-quantity')[0];quantity.value='0';quantity.emit('change');assert.deepEqual(saved,[['beef',0]]);
 byClass(rows[2],'pantry-browser-delete')[0].emit('click');assert.deepEqual(deleted,['pork']);assert.equal(byClass(root,'pantry-browser-stock-row').length,2);assert.deepEqual(pantry,original);
}));

test('不正な量と保存の失敗で在庫を増やさず、危険な名前は文字として表示する',()=>withDocument(()=>{
 const errors=[],saved=[],future={ingredients:{...data.ingredients,custom_food:{name:'<script>food</script>',unit:'個',groups:[],proteinSources:[]}}};
 const root=mountPantry({data:future,onSave:(...args)=>{saved.push(args);return false;},onError:value=>errors.push(value)});
 control(root,'search').value='custom_food';control(root,'search').emit('input');select(control(root,'ingredient'),'custom_food');
 control(root,'quantity').value='-1';control(root,'quantity').emit('input');assert.equal(control(root,'save').disabled,true);control(root,'save').emit('click');assert.equal(saved.length,0);assert.equal(errors.length,1);
 control(root,'quantity').value='3';control(root,'quantity').emit('input');control(root,'save').emit('click');assert.deepEqual(saved,[['custom_food',3]]);assert.equal(byClass(root,'pantry-browser-stock-row').length,0);
 assert.equal(all(root).filter(x=>x.tagName==='SCRIPT').length,0);assert.match(text(control(root,'ingredient')),/<script>food<\/script>/);
}));

test('再表示時にジャンル・種類・検索を引き継げる',()=>withDocument(()=>{
 const root=mountPantry({data,initialFilter:{group:'meat',subgroup:'chicken',query:'むね'}});
 assert.equal(control(root,'group').value,'meat');assert.equal(control(root,'subgroup').value,'chicken');assert.equal(control(root,'search').value,'むね');
 const foods=options(control(root,'ingredient')).filter(x=>x.value);assert.deepEqual(foods.map(x=>x.value),['chicken_breast']);
}));
