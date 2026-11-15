import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {defaultJournal} from '../journal.js';
import {mountMealSettings} from '../meal-settings-ui.js';

class Element {
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.listeners=new Map();this.textContent='';this.className='';this.dataset={};this.style={};}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=[...children];}
 setAttribute(key,value){this.attributes[key]=value;}
 getAttribute(key){return this.attributes[key]??null;}
 addEventListener(type,listener){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(listener);}
 dispatchEvent(event){for(const listener of this.listeners.get(event.type)??[])listener(event);return true;}
 emit(type,properties={}){this.dispatchEvent({type,target:this,preventDefault(){},...properties});}
}
const all=root=>[root,...root.children.flatMap(all)];
const field=(root,meal,key)=>{const value=all(root).find(node=>node.id?.endsWith(`-${meal}-${key}`));assert.ok(value,`${meal}/${key}`);return value;};
const options=select=>all(select).filter(node=>node.tagName==='OPTION');
const text=root=>[root.textContent,...root.children.map(text)].join(' ');
const withDocument=fn=>{const before=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};try{return fn();}finally{if(before===undefined)delete globalThis.document;else globalThis.document=before;}};
const data={allergens:ALLERGENS,ingredients:INGREDIENTS,recipes:RECIPES};
const settings=()=>defaultJournal('2026-11-15').settings;

test('meal controls combine each meal with its own staple and keep morning drinks and extras together',()=>withDocument(()=>{
 const source=settings(),before=structuredClone(source),changes=[],root=mountMealSettings({settings:source,data,onChange:(meal,patch)=>changes.push({meal,patch})});
 const breakfast=field(root,'breakfast','staple'),lunch=field(root,'lunch','staple');
 assert.ok(options(breakfast).some(option=>option.value==='rice-or-bread'));
 assert.ok(options(breakfast).some(option=>option.value==='cereal'&&option.textContent.includes('オートミール')));
 assert.ok(options(lunch).some(option=>option.value==='rice-meal'));assert.ok(options(lunch).some(option=>option.value==='handheld'));
 assert.ok(field(root,'breakfast','drinkId'));assert.ok(field(root,'breakfast','yogurt'));assert.ok(field(root,'breakfast','fruit'));
 assert.ok(!all(root).some(node=>node.id?.endsWith('-lunch-drinkId')));
 breakfast.value='rice-or-bread';breakfast.emit('change');
 field(root,'breakfast','yogurt').checked=true;field(root,'breakfast','yogurt').emit('change');
 field(root,'breakfast','fruit').checked=true;field(root,'breakfast','fruit').emit('change');
 assert.deepEqual(changes,[{meal:'breakfast',patch:{staple:'rice-or-bread',stapleId:'auto',stapleAmount:null}},{meal:'breakfast',patch:{yogurt:true}},{meal:'breakfast',patch:{fruit:true}}]);
 assert.deepEqual(source,before);
}));

test('fixed portions and morning coffee preserve exact user values rather than applying an automatic scale',()=>withDocument(()=>{
 const changes=[],root=mountMealSettings({settings:settings(),data,onChange:(meal,patch)=>changes.push({meal,patch})});
 const mode=field(root,'breakfast','staple');mode.value='fixed';mode.emit('change');
 assert.equal(changes[0].patch.stapleId,'plain-rice');
 const quantity=field(root,'breakfast','stapleAmount');quantity.value='172.5';quantity.emit('change');
 const drink=field(root,'breakfast','drinkId');drink.value='drink-coffee';drink.emit('change');
 const drinkAmount=field(root,'breakfast','drinkAmount');drinkAmount.value='180.25';drinkAmount.emit('change');
 assert.ok(changes.some(change=>change.patch.stapleAmount===172.5));
 assert.ok(changes.some(change=>change.patch.drinkAmount===180.25));
 assert.equal(field(root,'breakfast','drinkAmount').value,'180.25');
}));

test('skipping one meal leaves the other settings available and a rejected change returns the previous control value',()=>withDocument(()=>{
 const changes=[],root=mountMealSettings({settings:settings(),data,onChange:(meal,patch)=>{changes.push({meal,patch});return patch.volume==='hearty'?false:true;}});
 const volume=field(root,'breakfast','volume');volume.value='hearty';volume.emit('change');assert.equal(field(root,'breakfast','volume').value,'normal');
 const enabled=field(root,'lunch','enabled');enabled.checked=false;enabled.emit('change');
 assert.ok(!all(root).some(node=>node.id?.endsWith('-lunch-staple')));assert.ok(field(root,'dinner','staple'));
 assert.deepEqual(changes.at(-1),{meal:'lunch',patch:{enabled:false}});
}));

test('allergy-excluded fixed choices are identified without silently choosing or clearing another recipe',()=>withDocument(()=>{
 const source=settings();source.allergens=['milk'];source.mealPreferences.breakfast.drinkId='drink-milk';source.mealPreferences.breakfast.drinkAmount=200;
 const root=mountMealSettings({settings:source,data}),drink=field(root,'breakfast','drinkId');
 const legacy=options(drink).find(option=>option.value==='drink-milk');assert.ok(legacy);assert.equal(legacy.disabled,true);
 assert.equal(drink.value,'drink-milk');assert.ok(legacy.textContent.includes('除外条件を確認'));
 assert.ok(!options(drink).some(option=>option.value.includes('beer')));
 const errors=[],reject=mountMealSettings({settings:{...settings(),allergens:ALLERGENS.map(a=>a.id),excludedIngredients:Object.keys(INGREDIENTS)},data,onError:value=>errors.push(value)});
 const mode=field(reject,'breakfast','staple');mode.value='fixed';mode.emit('change');assert.equal(errors.length,1);assert.ok(text(reject).includes('条件に合う主食がありません'));
}));
