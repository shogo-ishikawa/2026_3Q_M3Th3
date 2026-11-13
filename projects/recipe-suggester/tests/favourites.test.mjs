import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {createCatalogEntry} from '../record-actions.js';
import {createRepeatedMeal} from '../meal-sets.js';
import {createFavourite,validateFavourites,recentFoods,favouriteKey,MAX_FAVOURITES} from '../favourites.js';
const data={allergens:ALLERGENS,ingredients:INGREDIENTS,recipes:RECIPES};
const entry=(amount=120,date='2026-11-10',status='eaten')=>createCatalogEntry({recipeId:'plain-rice',amount,date,meal:'breakfast',status},data);

test('単品を量つきで保存し、元データとDBの変更から独立した栄養を保持する',()=>{
  const original=entry().items[0],before=structuredClone(original);original.nutrition.fat=null;
  const favourite=createFavourite(original,data,{name:'いつものご飯'});
  assert.equal(favourite.name,'いつものご飯');assert.notEqual(favourite.item.id,original.id);assert.equal(favourite.item.quantity,.8);assert.equal(favourite.item.nutrition.fat,null);
  const reduced={...data,recipes:[],ingredients:{...INGREDIENTS}};delete reduced.ingredients.rice;
  const restored=validateFavourites(JSON.parse(JSON.stringify([favourite])),reduced)[0];
  assert.deepEqual(restored,favourite);restored.item.ingredients[0].amount=999;restored.item.nutrition.kcal=999;
  assert.equal(original.ingredients[0].amount,before.ingredients[0].amount);assert.equal(original.nutrition.kcal,before.nutrition.kcal);
});

test('最近の料理は実食と選択日で絞り、同じ内容では最後の量を一度だけ表示する',()=>{
  const first=entry(100),last=entry(180),planned=entry(250,'2026-11-12','planned'),future=entry(300,'2026-11-15'),batch=entry(400,'2026-11-13');batch.items[0].batchId='batch-held';
  const chicken=createCatalogEntry({recipeId:'chicken-teriyaki',amount:1,date:'2026-11-11',meal:'dinner',status:'eaten'},data);
  const recent=recentFoods([first,last,planned,future,batch,chicken],{date:'2026-11-13'});
  assert.equal(recent.length,2);assert.equal(recent[0].date,'2026-11-11');assert.equal(recent[1].item.quantity,180/150);assert.equal(recent[1].item.name,first.items[0].name);
  assert.equal(recentFoods([first,chicken],{date:'2026-11-13',limit:1}).length,1);
  recent[1].item.ingredients[0].amount=888;assert.notEqual(last.items[0].ingredients[0].amount,888);
});

test('同名の別配合を残し、識別子・量・材料順だけの違いは重複として扱う',()=>{
  const source=entry().items[0],changed={...structuredClone(source),id:'other-id',recipeId:null,quantity:3};
  assert.equal(favouriteKey(source),favouriteKey(changed));
  const materials={...structuredClone(source),ingredients:[{id:'rice',amount:100},{id:'water',amount:10}],allergens:['soy','wheat']};
  assert.equal(favouriteKey(materials),favouriteKey({...materials,ingredients:[...materials.ingredients].reverse(),allergens:[...materials.allergens].reverse()}));
  changed.nutrition.kcal+=1;assert.notEqual(favouriteKey(source),favouriteKey(changed));
  const two=entry();two.items=[source,changed];assert.equal(recentFoods([two],{date:'2026-11-13'}).length,2);
});

test('呼び出しは凍結した単品の栄養を使い、新しい記録IDで登録できる',()=>{
  const favourite=createFavourite(entry(75).items[0],data),copy=createRepeatedMeal({items:[favourite.item],date:'2026-11-14',meal:'lunch',status:'planned'},data);
  assert.notEqual(copy.items[0].id,favourite.item.id);assert.equal(copy.items[0].quantity,.5);assert.deepEqual(copy.items[0].nutrition,favourite.item.nutrition);assert.deepEqual(copy.items[0].ingredients,favourite.item.ingredients);
  const batch={...favourite.item,batchId:'batch-old'};assert.throws(()=>createFavourite(batch,data),/残量画面/);
});

test('根拠の分類が増えた同じ料理も一つにまとめ、最新の分類と量を保つ',()=>{
  const old=entry(90,'2026-11-10'),latest=entry(180,'2026-11-11');
  delete old.items[0].nutritionBasis;
  latest.items[0].nutritionBasis='ingredients';
  assert.equal(favouriteKey(old.items[0]),favouriteKey(latest.items[0]));
  const recent=recentFoods([old,latest],{date:'2026-11-13'});
  assert.equal(recent.length,1);assert.equal(recent[0].item.quantity,1.2);assert.equal(recent[0].item.nutritionBasis,'ingredients');
  const saved=createFavourite(latest.items[0],data);
  assert.equal(saved.item.nutritionBasis,'ingredients');
  assert.throws(()=>validateFavourites([saved,createFavourite(old.items[0],data)],data),/重複/);
});

test('空欄・不正な値・内容の重複・件数超過を保存前に拒否する',()=>{
  const favourite=createFavourite(entry().items[0],data);
  assert.deepEqual(validateFavourites(undefined,data),[]);
  for(const raw of [null,{},[{}],[{...favourite,extra:true}],[favourite,{...favourite,id:'favourite-duplicate'}],Array(MAX_FAVOURITES+1).fill(favourite),[{...favourite,item:{...favourite.item,quantity:0}}],[{...favourite,item:{...favourite.item,nutrition:{...favourite.item.nutrition,kcal:Infinity}}}]])assert.throws(()=>validateFavourites(raw,data));
  for(const name of ['',null,'あ'.repeat(201)])assert.throws(()=>createFavourite(entry().items[0],data,{name}));
  for(const options of [{date:'2026-02-30'},{date:'2101-01-01'},{limit:0},{limit:31},{limit:1.5}])assert.throws(()=>recentFoods([],{date:'2026-11-13',...options}));
});

test('getterや循環を実行せずに拒否する',()=>{
  let reads=0;const item=entry().items[0];Object.defineProperty(item,'name',{enumerable:true,get(){reads++;return '触らない';}});
  assert.throws(()=>createFavourite(item,data));assert.throws(()=>favouriteKey(item));assert.equal(reads,0);
  const raw=[];raw.push(raw);assert.throws(()=>validateFavourites(raw,data));assert.throws(()=>recentFoods(Array(1),{date:'2026-11-13'}));
});
