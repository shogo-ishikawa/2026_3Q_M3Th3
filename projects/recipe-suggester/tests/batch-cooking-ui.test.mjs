import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {createBatch} from '../batch-cooking.js';
import {mountBatchCooking} from '../batch-cooking-ui.js';
class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.listeners=new Map();this.textContent='';}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(type,listener){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(listener);}
  emit(type){for(const listener of this.listeners.get(type)??[])listener({target:this,preventDefault(){}});}
}
const data={ingredients:INGREDIENTS,recipes:RECIPES,allergens:ALLERGENS};
const all=root=>[root,...root.children.flatMap(all)];
const find=(root,className)=>{const result=all(root).find(element=>element.className.split(' ').includes(className));assert.ok(result,className);return result;};
function withDocument(fn){const previous=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};try{return fn();}finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}}

test('調理した人数分と完成重量から登録し、空欄・負数は古い値で登録しない',()=>withDocument(()=>{
  const created=[],errors=[],root=mountBatchCooking({data,selectedDate:'2026-11-13',onCreate:batch=>created.push(batch),onError:message=>errors.push(message)});
  const recipe=find(root,'batch-recipe');recipe.value='chicken-teriyaki';recipe.emit('change');
  find(root,'batch-source-quantity').value='4';find(root,'batch-total-grams').value='1200';find(root,'batch-create-form').emit('submit');
  assert.equal(created.length,1);assert.equal(created[0].totalGrams,1200);assert.equal(created[0].sourceQuantity,4);
  find(root,'batch-total-grams').value='';find(root,'batch-create-form').emit('submit');assert.equal(created.length,1);assert.ok(errors.at(-1));
  find(root,'batch-total-grams').value='-1';find(root,'batch-create-form').emit('submit');assert.equal(created.length,1);
}));

test('残量と材料を表示し、gで取り分けて終了できる',()=>withDocument(()=>{
  const batch=createBatch({recipe:RECIPES.find(candidate=>candidate.id==='chicken-teriyaki'),sourceQuantity:4,totalGrams:1200,preparedDate:'2026-11-13'},data),entries=[],archived=[];
  const root=mountBatchCooking({data,batches:[batch],entries:[],selectedDate:'2026-11-14',onRecord:entry=>entries.push(entry),onArchive:id=>archived.push(id)});
  assert.match(find(root,'batch-balance').textContent,/1,200g/);assert.ok(find(root,'batch-material-list').children.length>0);
  find(root,'batch-take-grams').value='150';find(root,'batch-take-form').emit('submit');
  assert.equal(entries[0].items[0].quantity,1.5);assert.equal(entries[0].date,'2026-11-14');
  find(root,'batch-take-grams').value='1201';find(root,'batch-take-form').emit('submit');assert.equal(entries.length,1);
  find(root,'batch-archive').emit('click');assert.deepEqual(archived,[batch.id]);
}));
