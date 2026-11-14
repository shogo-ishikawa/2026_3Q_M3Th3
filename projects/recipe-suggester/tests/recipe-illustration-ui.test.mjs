import test from 'node:test';
import assert from 'node:assert/strict';
import {RECIPES} from '../data.js';
import {recipeIllustrationElement} from '../recipe-illustration-ui.js';

const recipe=RECIPES.find(value=>value.id==='chicken-teriyaki');
class Element {
  constructor(tag,requests){this.tagName=tag.toUpperCase();this.children=[];this.requests=requests;}
  append(...children){this.children.push(...children);}
  addEventListener(){}
  set src(value){this.requests.push(value);this.source=value;}
  get src(){return this.source;}
}
function withDocument(fn){
  const original=globalThis.document,created=[],requests=[];
  globalThis.document={createElement(tag){created.push(tag);return new Element(tag,requests);}};
  try{return fn({created,requests});}finally{if(original===undefined)delete globalThis.document;else globalThis.document=original;}
}
const descendants=root=>[root,...root.children.flatMap(descendants)];

test('非表示設定ではカード・詳細とも画像やその他のDOMを作成せず、読み込みを開始しない',()=>withDocument(({created,requests})=>{
  const before=structuredClone(recipe);
  for(const options of [{hidden:true},{hidden:true,detail:true},{hidden:true,detail:true,standard:true}])assert.equal(recipeIllustrationElement(recipe,options),null);
  assert.deepEqual(created,[]);assert.deepEqual(requests,[]);assert.deepEqual(recipe,before);
}));

test('従来の呼び出しは画像を表示し、非表示から戻すとカードと詳細の画像を作成できる',()=>withDocument(({requests})=>{
  const card=recipeIllustrationElement(recipe),image=descendants(card).find(element=>element.tagName==='IMG');
  assert.ok(card.className.includes('recipe-art-card'));
  assert.equal(image.src,'assets/recipe-art/chicken-teriyaki.webp');assert.equal(image.loading,'lazy');
  assert.equal(image.alt,`${recipe.name}の完成イメージ`);
  assert.equal(recipeIllustrationElement(recipe,{hidden:true,detail:true}),null);
  const detail=recipeIllustrationElement(recipe,{hidden:false,detail:true,standard:true});
  const large=descendants(detail).find(element=>element.tagName==='IMG');
  assert.ok(detail.className.includes('recipe-art-detail'));
  assert.equal(large.src,'assets/recipe-art/chicken-teriyaki-large.webp');assert.equal(large.loading,'eager');
  assert.deepEqual(requests,['assets/recipe-art/chicken-teriyaki.webp','assets/recipe-art/chicken-teriyaki-large.webp']);
  assert.match(descendants(detail).find(element=>element.className==='recipe-art-note').textContent,/標準の組み合わせ/);
}));

test('画像のない料理は表示設定がオフでも画像を作成しない',()=>withDocument(({created,requests})=>{
  assert.equal(recipeIllustrationElement({...recipe,id:'custom-no-art',custom:true},{hidden:false}),null);
  assert.deepEqual(created,[]);assert.deepEqual(requests,[]);
}));
