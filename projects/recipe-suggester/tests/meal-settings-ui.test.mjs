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

test('staple amount can stay small while main dishes are hearty without overwriting either choice',()=>withDocument(()=>{
 const source=settings(),before=structuredClone(source),changes=[];
 const root=mountMealSettings({settings:source,data,onChange:(meal,patch)=>changes.push({meal,patch})});
 const volume=field(root,'dinner','volume');volume.value='hearty';volume.emit('change');
 const stapleVolume=field(root,'dinner','stapleVolume');stapleVolume.value='light';stapleVolume.emit('change');
 assert.equal(field(root,'dinner','volume').value,'hearty');
 assert.equal(field(root,'dinner','stapleVolume').value,'light');
 assert.deepEqual(changes,[{meal:'dinner',patch:{volume:'hearty'}},{meal:'dinner',patch:{stapleVolume:'light'}}]);
 assert.deepEqual(source,before);
 const mode=field(root,'dinner','staple');mode.value='none';mode.emit('change');
 assert.ok(!all(root).some(node=>node.id?.endsWith('-dinner-stapleVolume')));
 field(root,'dinner','staple').value='fixed';field(root,'dinner','staple').emit('change');
 assert.ok(field(root,'dinner','stapleAmount'));
 assert.ok(!all(root).some(node=>node.id?.endsWith('-dinner-stapleVolume')));
}));

test('side detail controls retain numeric counts and the open disclosure across edits',()=>withDocument(()=>{
 const changes=[],root=mountMealSettings({settings:settings(),data,onChange:(meal,patch)=>changes.push({meal,patch})});
 let card=all(root).find(node=>node.tagName==='FIELDSET'&&node.dataset.meal==='breakfast');
 let details=all(card).find(node=>node.tagName==='DETAILS');assert.equal(details.open,false);
 details.open=true;details.emit('toggle');
 const count=field(root,'breakfast','sideCount');count.value='2';count.emit('change');
 const type=field(root,'breakfast','sideType');type.value='salad';type.emit('change');
 const soup=field(root,'breakfast','soup');soup.value='include';soup.emit('change');
 card=all(root).find(node=>node.tagName==='FIELDSET'&&node.dataset.meal==='breakfast');
 details=all(card).find(node=>node.tagName==='DETAILS');assert.equal(details.open,true);
 assert.deepEqual(changes,[{meal:'breakfast',patch:{sideCount:2}},{meal:'breakfast',patch:{sideType:'salad'}},{meal:'breakfast',patch:{soup:'include'}}]);
 const off=field(root,'breakfast','sideCount');off.value='0';off.emit('change');
 assert.equal(field(root,'breakfast','sideType').disabled,true);
 assert.equal(field(root,'breakfast','sideType').value,'salad');
 assert.equal(changes.at(-1).patch.sideCount,0);
 const auto=field(root,'breakfast','sideCount');auto.value='auto';auto.emit('change');
 assert.equal(field(root,'breakfast','sideType').disabled,false);
 assert.equal(changes.at(-1).patch.sideCount,'auto');
}));

test('a day editor can show one complete meal profile without enabling or changing other days',()=>withDocument(()=>{
 const source=settings();source.mealPreferences.breakfast.enabled=false;const before=structuredClone(source),changes=[];
 const root=mountMealSettings({settings:source,data,meals:['breakfast'],allowEnable:false,onChange:(meal,patch)=>changes.push({meal,patch})});
 assert.equal(all(root).filter(node=>node.tagName==='FIELDSET').length,1);
 assert.ok(field(root,'breakfast','staple'));assert.ok(field(root,'breakfast','sideCount'));
 assert.ok(!all(root).some(node=>node.id?.endsWith('-breakfast-enabled')));
 assert.ok(!all(root).some(node=>node.id?.includes('-dinner-')));
 const fruit=field(root,'breakfast','fruit');fruit.checked=true;fruit.emit('change');
 assert.deepEqual(changes,[{meal:'breakfast',patch:{fruit:true}}]);
 assert.deepEqual(source,before);
}));

test('invalid day-editor meal lists fail before rendering a misleading profile',()=>withDocument(()=>{
 for(const meals of [[],['snack'],['breakfast','breakfast'],'breakfast'])assert.throws(()=>mountMealSettings({settings:settings(),data,meals}),/設定/);
}));

test('fixed menu quantities remain authoritative when an earlier automatic staple volume was small',()=>withDocument(()=>{
 const source=settings();Object.assign(source.mealPreferences.breakfast,{staple:'fixed',stapleId:'plain-rice',stapleAmount:172.5,stapleVolume:'light'});
 const changes=[],root=mountMealSettings({settings:source,data,onChange:(meal,patch)=>changes.push({meal,patch})});
 assert.equal(field(root,'breakfast','stapleAmount').value,'172.5');
 assert.ok(!all(root).some(node=>node.id?.endsWith('-breakfast-stapleVolume')));
 const volume=field(root,'breakfast','volume');volume.value='hearty';volume.emit('change');
 assert.equal(field(root,'breakfast','stapleAmount').value,'172.5');
 assert.deepEqual(changes,[{meal:'breakfast',patch:{volume:'hearty'}}]);
 assert.equal(source.mealPreferences.breakfast.stapleAmount,172.5);
}));

test('changing one meal keeps unrelated controls and unfinished quantities in place', () => withDocument(() => {
  const source = settings();
  Object.assign(source.mealPreferences.breakfast, {staple:'fixed', stapleId:'plain-rice'});
  const root = mountMealSettings({settings:source, data});
  const quantity = field(root, 'breakfast', 'stapleAmount');
  assert.equal(quantity.required, true);
  quantity.value = '';
  const volume = field(root, 'dinner', 'volume');
  volume.value = 'light'; volume.emit('change');
  assert.equal(field(root, 'dinner', 'volume'), volume);
  const staple = field(root, 'dinner', 'staple');
  staple.value = 'fixed'; staple.emit('change');
  assert.ok(field(root, 'dinner', 'stapleAmount'));
  assert.equal(field(root, 'breakfast', 'stapleAmount'), quantity);
  assert.equal(quantity.value, '');
}));

test('the evening dish preference is available in dinner settings and the editor for a single dinner', () => withDocument(() => {
  for (const display of [{}, {meals: ['dinner'], allowEnable: false}]) {
    const changes = [];
    const root = mountMealSettings({settings: settings(), data, ...display, onChange: (meal, patch) => changes.push({meal, patch})});
    const control = field(root, 'dinner', 'banshaku');
    assert.deepEqual(all(root).filter(node => node.id?.endsWith('-banshaku')), [control]);
    assert.equal(control.checked, false);
    control.checked = true;
    control.emit('change');
    assert.deepEqual(changes, [{meal: 'dinner', patch: {banshaku: true}}]);
  }
}));
