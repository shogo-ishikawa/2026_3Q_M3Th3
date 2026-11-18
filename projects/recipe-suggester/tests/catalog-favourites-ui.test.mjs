import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {createCatalogEntry} from '../record-actions.js';
import {createFavourite} from '../favourites.js';
import {favouriteGenre,mountCatalogFavourites} from '../catalog-favourites-ui.js';

class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.listeners=new Map();this.textContent='';this.className='';this.dataset={};this.value='';}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(type,listener){this.listeners.set(type,listener);}
  emit(type){this.listeners.get(type)?.({type,target:this});}
  set innerHTML(value){throw Error('Do not interpolate saved favourite names as HTML.');}
}
const all=root=>[root,...root.children.flatMap(all)];
const text=root=>all(root).map(node=>node.textContent).join(' ');
const byClass=(root,value)=>all(root).filter(node=>node.className.split(' ').includes(value));
const withDocument=fn=>{const old=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};try{return fn();}finally{if(old===undefined)delete globalThis.document;else globalThis.document=old;}};
const data={allergens:ALLERGENS,ingredients:INGREDIENTS,recipes:RECIPES};
const saved=(recipeId='plain-rice',amount=120)=>createFavourite(createCatalogEntry({recipeId,amount,date:'2026-11-14',meal:'lunch',status:'eaten'},data).items[0],data);
const genreButton=(root,id)=>byClass(root,'catalog-favourites-genre').find(button=>button.dataset.genre===id);

test('ジャンルの件数と見出しを表示し、ジャンルと検索を組み合わせて探せる',()=>withDocument(()=>{
  const rice=saved(),westernRecipe=RECIPES.find(recipe=>recipe.genre==='洋食'&&recipe.role==='main'),western=saved(westernRecipe.id,1),root=mountCatalogFavourites({favourites:[rice,western],data});
  assert.equal(byClass(root,'catalog-favourite-card').length,2);assert.equal(genreButton(root,'和食').textContent,'和食 1件');assert.equal(genreButton(root,'洋食').textContent,'洋食 1件');
  assert.deepEqual(byClass(root,'catalog-favourites-group-title').map(node=>node.textContent),['和食 · 1件','洋食 · 1件']);
  genreButton(root,'和食').emit('click');assert.equal(genreButton(root,'和食').attributes['aria-pressed'],'true');assert.equal(byClass(root,'catalog-favourite-card').length,1);assert.match(text(root),/ご飯/);
  const search=byClass(root,'catalog-favourites-search')[0];search.value='存在しない料理';search.emit('input');assert.equal(byClass(root,'catalog-favourite-card').length,0);assert.match(text(root),/一致するお気に入りがありません/);
  genreButton(root,'all').emit('click');search.value=western.item.name;search.emit('input');assert.equal(byClass(root,'catalog-favourite-card').length,1);assert.match(text(root),new RegExp(western.item.name));
}));

test('削除済み・未保存の元メニューは未分類へ残し、名前や材料からジャンルを推測しない',()=>withDocument(()=>{
  const rice=saved();delete rice.genre;rice.item.recipeId=null;rice.name='和風トースト（独自名）';
  assert.equal(favouriteGenre(rice.item,data),'未分類');
  const root=mountCatalogFavourites({favourites:[rice],data});assert.equal(genreButton(root,'未分類').textContent,'未分類 1件');assert.match(text(root),/推測せず未分類/);
  rice.item.recipeId='deleted-recipe';assert.equal(favouriteGenre(rice.item,data),'未分類');
  const customData={...data,recipes:[...RECIPES,{id:'my-available-recipe',genre:'中華'}]};rice.item.recipeId='my-available-recipe';assert.equal(favouriteGenre(rice.item,customData),'中華');
}));

test('保存した量・材料・不明な栄養を保ち、開く操作と買い物操作へ独立したコピーを渡す',()=>withDocument(()=>{
  const favourite=saved('plain-rice',75.5),original=structuredClone(favourite);favourite.item.nutrition.fiber=null;original.item.nutrition.fiber=null;
  const opened=[],shopping=[],removed=[],root=mountCatalogFavourites({favourites:[favourite],data,onOpen:item=>opened.push(item),onAddShopping:item=>shopping.push(item),onDelete:id=>removed.push(id)});
  assert.match(text(root),/保存した量：75.5g/);byClass(root,'catalog-favourite-open')[0].emit('click');byClass(root,'catalog-favourite-details')[0].emit('click');byClass(root,'catalog-favourite-shopping')[0].emit('click');
  assert.equal(opened.length,2);assert.equal(shopping.length,1);assert.deepEqual(opened[0],original.item);assert.deepEqual(shopping[0],original.item);
  opened[0].ingredients[0].amount=999;shopping[0].nutrition.kcal=1;assert.deepEqual(favourite,original);assert.notEqual(opened[0],opened[1]);
  byClass(root,'catalog-favourite-remove')[0].emit('click');assert.deepEqual(removed,[favourite.id]);assert.deepEqual(favourite,original);
}));

test('現在の除外設定の注意を示し、安全性未確認の保存内容を隠したり書き換えたりしない',()=>withDocument(()=>{
  const favourite=saved(),root=mountCatalogFavourites({favourites:[favourite],data,settings:{allergens:[],excludedIngredients:['rice']}});
  assert.equal(byClass(root,'catalog-favourite-card').length,1);assert.match(text(root),/除外中の食材/);assert.equal(favourite.item.ingredients[0].id,'rice');
}));

test('空の一覧・コールバックの失敗・HTMLに似た名前を安全に表示する',()=>withDocument(()=>{
  const empty=mountCatalogFavourites({data});assert.equal(byClass(empty,'catalog-favourite-card').length,0);assert.match(text(empty),/お気に入りに保存すると/);assert.equal(genreButton(empty,'all').textContent,'すべて 0件');
  const favourite=saved(),errors=[];favourite.name='<img src=x onerror=alert(1)>';
  const root=mountCatalogFavourites({favourites:[favourite],data,onAddShopping(){throw Error('この料理の材料を確認してください。');},onError:message=>errors.push(message)});
  assert.equal(byClass(root,'catalog-favourite-open')[0].textContent,favourite.name);byClass(root,'catalog-favourite-shopping')[0].emit('click');assert.deepEqual(errors,['この料理の材料を確認してください。']);assert.equal(byClass(root,'catalog-favourites-error')[0].hidden,false);assert.equal(all(root).filter(node=>node.tagName==='IMG').length,0);
}));

test('保存したジャンルを元メニューより優先し、元メニューがなくてもジャンルから呼び出せる',()=>withDocument(()=>{
  const favourite=saved();favourite.genre='洋食';favourite.item.recipeId='temporary-bread-recipe';
  assert.equal(favouriteGenre(favourite.item,data,favourite.genre),'洋食');assert.equal(favouriteGenre({...favourite.item,recipeId:'plain-rice'},data,favourite.genre),'洋食');
  const root=mountCatalogFavourites({favourites:[favourite],data});assert.equal(genreButton(root,'洋食').textContent,'洋食 1件');assert.equal(genreButton(root,'未分類').textContent,'未分類 0件');genreButton(root,'洋食').emit('click');assert.equal(byClass(root,'catalog-favourite-card').length,1);
}));

test('登録した材料をかなで検索でき、削除後にも同じジャンルと検索語を保つ',()=>withDocument(()=>{
  const eggs=saved('breakfast-ham-egg',1),rice=saved(),viewState={};
  const root=mountCatalogFavourites({favourites:[rice,eggs],data,viewState});
  const genre=genreButton(root,eggs.genre);
  genre.emit('click');
  assert.equal(genreButton(root,eggs.genre),genre,'キーボードで押したジャンルボタンを置き換えない');
  const search=byClass(root,'catalog-favourites-search')[0];
  search.value='たまご';search.emit('input');
  assert.equal(byClass(root,'catalog-favourite-open')[0].textContent,eggs.name);
  const updated=mountCatalogFavourites({favourites:[rice],data,viewState});
  assert.equal(byClass(updated,'catalog-favourites-search')[0].value,'たまご');
  assert.equal(genreButton(updated,eggs.genre).attributes['aria-pressed'],'true');
  assert.equal(byClass(updated,'catalog-favourite-card').length,0);
  const reset=byClass(updated,'catalog-favourites-clear')[0],updatedSearch=byClass(updated,'catalog-favourites-search')[0];
  let focused=false;updatedSearch.focus=()=>{focused=true;};
  reset.emit('click');
  assert.ok(focused);assert.equal(updatedSearch.value,'');
  assert.equal(genreButton(updated,'all').attributes['aria-pressed'],'true');
  assert.equal(genreButton(updated,eggs.genre).hidden,true);
  assert.equal(byClass(updated,'catalog-favourite-open')[0].textContent,rice.name);
}));
