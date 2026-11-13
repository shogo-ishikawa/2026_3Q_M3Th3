import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {itemFromRecipe,NUTRIENT_KEYS} from '../nutrition.js';
import {recipePortion} from '../catalog.js';
import {mealOverlapWarnings} from '../meal-overlap.js';

const data={allergens:ALLERGENS,ingredients:INGREDIENTS,recipes:RECIPES};
let sequence=0;
const recipe=id=>{const found=RECIPES.find(r=>r.id===id);assert.ok(found,id);return found;};
const item=(id,quantity=1)=>{const found=recipe(id);return {...itemFromRecipe(found,data,quantity),portion:recipePortion(found,data)};};
const entry=(items,changes={})=>({id:`overlap-entry-${++sequence}`,date:'2026-11-14',meal:'dinner',status:'eaten',note:'',items,...changes});
const rice=()=>item('plain-rice');
const curry=()=>item('tomato-chicken-curry');
const newItem=source=>({...structuredClone(source),id:`overlap-item-${++sequence}`});
const frozen=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))frozen(child);Object.freeze(value);}return value;};

test('ご飯込みのカレーと単品ご飯は追加の順序を問わず確認を返す',()=>{
  const a=entry([rice()]),b=entry([curry()]);
  for(const [incoming,previous]of [[a,b],[b,a]]){
    const warnings=mealOverlapWarnings(incoming,[previous],data);
    assert.equal(warnings.length,1);assert.equal(warnings[0].code,'rice-included');
    assert.equal(warnings[0].actionLabel,'追加のご飯として登録');
    assert.match(warnings[0].message,/にはご飯が含まれています/);
    assert.deepEqual(warnings[0].entryIds,[incoming.id,previous.id]);
  }
});

test('一括登録の中のご飯込み料理とご飯も確認し、食事セット自体は変更しない',()=>{
  const incoming=entry([rice(),curry()]),before=JSON.stringify(incoming);frozen(incoming);
  const warnings=mealOverlapWarnings(incoming,[],data);
  assert.equal(warnings.length,1);assert.equal(warnings[0].code,'rice-included');
  assert.deepEqual(warnings[0].entryIds,[incoming.id,incoming.id]);
  assert.equal(JSON.stringify(incoming),before);
});

test('ご飯を含む外食定食は表示範囲の明示を使い、含まない登録からは推測しない',()=>{
  const restaurant={genericRecipeId:'chicken-teriyaki',storeName:'確認用店舗',sizeName:'普通',inclusion:'主菜とご飯',riceIncluded:true,sidesIncluded:true,basis:'portion',basisAmount:1,basisUnit:'食',sourceUrl:'https://example.com/menu',checkedDate:'2026-11-14'};
  const set={...curry(),recipeId:null,name:'確認用店舗の定食',ingredients:[],ingredientsKnown:false,restaurant};
  assert.equal(mealOverlapWarnings(entry([rice()]),[entry([set])],data)[0].code,'rice-included');
  assert.deepEqual(mealOverlapWarnings(entry([rice()]),[entry([{...set,restaurant:{...restaurant,riceIncluded:false}}])],data),[]);
});

test('ルーのみ・主菜とご飯・ご飯を含まない麺とご飯には注意を出さない',()=>{
  const sauce=curry();sauce.name='カレー（ルーのみ）';sauce.ingredients=sauce.ingredients.filter(part=>part.id!=='rice');
  const main=item(RECIPES.find(r=>r.role==='main'&&!r.ingredients.some(p=>p.id==='rice')).id);
  const noodleRecipe=RECIPES.find(r=>r.family==='ramen'&&!r.ingredients.some(p=>['rice','brown_rice','cooked_barley','uncooked_rice'].includes(p.id)));
  assert.ok(noodleRecipe);const noodle=item(noodleRecipe.id);
  for(const other of [sauce,main,noodle])assert.deepEqual(mealOverlapWarnings(entry([rice()]),[entry([other])],data),[]);
});

test('日付・食事区分・予定実績が異なる記録は比較せず、編集中の旧記録も除外できる',()=>{
  const incoming=entry([rice()]);
  for(const changes of [{date:'2026-11-13'},{meal:'lunch'},{status:'planned'}])assert.deepEqual(mealOverlapWarnings(incoming,[entry([curry()],changes)],data),[]);
  const previous=entry([rice()]);
  assert.equal(mealOverlapWarnings(incoming,[previous],data)[0].code,'duplicate-dish');
  assert.deepEqual(mealOverlapWarnings(incoming,[previous],data,{excludeEntryId:previous.id}),[]);
  assert.deepEqual(mealOverlapWarnings(previous,[previous],data),[]);
});

test('同じ凍結内容の料理は数量が異なっても確認し、材料・栄養の異なる配合は同一視しない',()=>{
  const original=curry(),repeat=newItem(original);repeat.quantity=.5;repeat.sourceNote='別の記録のメモ';repeat.ingredients.reverse();
  const warnings=mealOverlapWarnings(entry([repeat]),[entry([original])],data);
  assert.equal(warnings.length,1);assert.equal(warnings[0].code,'duplicate-dish');
  const modified=newItem(original);modified.nutrition.fat+=1;
  assert.deepEqual(mealOverlapWarnings(entry([modified]),[entry([original])],data),[]);
  const changed=newItem(original);changed.ingredients[0].amount+=1;
  assert.deepEqual(mealOverlapWarnings(entry([changed]),[entry([original])],data),[]);
});

test('名前だけが同じ未入力料理やご飯の説明文からは重複・包含を断定しない',()=>{
  const unknown={...rice(),recipeId:null,name:'ご飯付きかもしれない料理',nutrition:Object.fromEntries(NUTRIENT_KEYS.map(key=>[key,null])),ingredients:[],ingredientsKnown:false};
  assert.deepEqual(mealOverlapWarnings(entry([newItem(unknown)]),[entry([unknown])],data),[]);
  assert.deepEqual(mealOverlapWarnings(entry([rice()]),[entry([unknown])],data),[]);
  const unconfirmed={...curry(),recipeId:null,ingredientsKnown:false};
  assert.deepEqual(mealOverlapWarnings(entry([rice()]),[entry([unconfirmed])],data),[]);
});

test('登録元に明示された米は未確認商品でも使えるが、凍結材料から消えていれば使わない',()=>{
  const known={...curry(),ingredientsKnown:false};
  assert.equal(mealOverlapWarnings(entry([rice()]),[entry([known])],data)[0].code,'rice-included');
  const changed={...known,ingredients:known.ingredients.filter(part=>part.id!=='rice')};
  assert.deepEqual(mealOverlapWarnings(entry([rice()]),[entry([changed])],data),[]);
});

test('玄米・麦ご飯と材料が分かる自作料理にも対応し、米粉を米飯と混同しない',()=>{
  const plain={...rice(),recipeId:null,name:'自分の玄米',ingredients:[{id:'brown_rice',amount:150}],ingredientsKnown:true};
  const bundle={...curry(),recipeId:null,ingredientsKnown:true};
  assert.equal(mealOverlapWarnings(entry([plain]),[entry([bundle])],data)[0].code,'rice-included');
  const flour={...bundle,ingredients:bundle.ingredients.map(part=>part.id==='rice'?{...part,id:'rice_flour'}:part)};
  assert.deepEqual(mealOverlapWarnings(entry([plain]),[entry([flour])],data),[]);
});

test('同じ内容の多数追加は同じ警告へまとめ、入力を変更せず戻す',()=>{
  const source=curry(),incoming=entry(Array.from({length:20},()=>newItem(source))),before=JSON.stringify(incoming);
  assert.equal(mealOverlapWarnings(incoming,[],data).length,1);
  assert.equal(JSON.stringify(incoming),before);
  const numberNoise=newItem(source);numberNoise.nutrition.protein+=1e-12;
  assert.equal(mealOverlapWarnings(entry([numberNoise]),[entry([source])],data)[0].code,'duplicate-dish');
});

test('既存の同一料理2皿へ3皿目を加えても、追加料理の警告を重複排除で失わない',()=>{
  const source=curry(),oldOne=newItem(source),oldTwo=newItem(source),added=newItem(source);
  const incoming=entry([oldOne,oldTwo,added]);
  const warnings=mealOverlapWarnings(incoming,[],data,{focusItemIds:[added.id]});
  assert.equal(warnings.length,1);assert.equal(warnings[0].code,'duplicate-dish');
  assert.ok(warnings[0].itemIds.includes(added.id));
  assert.deepEqual(mealOverlapWarnings(incoming,[],data,{focusItemIds:[]}),[]);
});

test('以前の料理だけの警告が20件以上あっても、新しい料理の確認が件数上限に隠れない',()=>{
  const old=[];
  for(let i=0;i<21;i++){
    const source=curry();source.name=`確認済み料理${i}`;
    old.push(newItem(source),newItem(source));
  }
  const added=newItem(old[0]),incoming=entry([...old,added]);
  const before=JSON.stringify(incoming);
  const general=mealOverlapWarnings(incoming,[],data);
  assert.equal(general.length,20);assert.ok(general.every(warning=>!warning.itemIds.includes(added.id)));
  const focused=mealOverlapWarnings(incoming,[],data,{focusItemIds:[added.id]});
  assert.equal(focused.length,1);assert.ok(focused[0].itemIds.includes(added.id));
  assert.equal(JSON.stringify(incoming),before);
});

test('注目IDは新しい食事の中の料理にだけ適用し、不正な注目ID入力を拒否する',()=>{
  const one=entry([rice()]),two=entry([rice()]);
  assert.deepEqual(mealOverlapWarnings(one,[two],data,{focusItemIds:[two.items[0].id]}),[]);
  assert.equal(mealOverlapWarnings(one,[two],data,{focusItemIds:[one.items[0].id]})[0].code,'duplicate-dish');
  for(const focusItemIds of ['item',new Set(['item']),[null],Array(1),Array(101).fill('item')])assert.throws(()=>mealOverlapWarnings(one,[],data,{focusItemIds}));
});

test('壊れた入力や不正数量を確認済み扱いにしない',()=>{
  const valid=entry([rice()]);
  for(const incoming of [null,{...valid,date:'2026-02-30'},{...valid,status:'unknown'},{...valid,items:[{...rice(),quantity:0}]},{...valid,items:[{...rice(),quantity:NaN}]},{...valid,items:[{...rice(),ingredients:[{id:'rice',amount:-1}]}]}])assert.throws(()=>mealOverlapWarnings(incoming,[],data));
  assert.throws(()=>mealOverlapWarnings(valid,null,data));
  assert.throws(()=>mealOverlapWarnings(valid,[],{},{}));
});
