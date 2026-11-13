import test from 'node:test';
import assert from 'node:assert/strict';
import {nutritionBasisBadge} from '../nutrition-basis-ui.js';

class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.attributes={};this.textContent='';this.className='';}
  setAttribute(key,value){this.attributes[key]=value;}
}
function withDocument(fn){const previous=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};try{return fn();}finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}}
const full={kcal:100,protein:10,fat:2,carbs:10,fiber:0,salt:0};

test('記録の根拠ラベルと説明を表示し、未入力成分を0扱いしない',()=>withDocument(()=>{
  const value={name:'<script>危険な名前</script>',nutrition:{...full,fiber:null},nutritionBasis:'manual'};
  const badge=nutritionBasisBadge(value,{});
  assert.equal(badge.tagName,'SPAN');assert.equal(badge.textContent,'手入力');
  assert.equal(badge.attributes['data-nutrition-basis'],'manual');assert.match(badge.className,/nutrition-basis-manual/);
  assert.match(badge.title,/利用者が入力/);assert.match(badge.title,/食物繊維に未入力/);
  assert.match(badge.attributes['aria-label'],/未入力の成分あり/);assert.ok(!badge.textContent.includes('<script>'));
  assert.equal(value.nutrition.fiber,null);
}));

test('以前の記録には根拠未記録を表示し、公式という説明文から判断しない',()=>withDocument(()=>{
  const badge=nutritionBasisBadge({nutrition:full,sourceNote:'公式 https://example.com',recipeId:'confectionery-pocky'},{});
  assert.equal(badge.textContent,'根拠未記録');assert.match(badge.title,/分類を保存していません/);
}));

test('材料の概算と混合した根拠にも独立したラベルを付ける',()=>withDocument(()=>{
  for(const [kind,label]of [['ingredients','材料から概算'],['estimate','配合・摂取量の概算'],['mixed','表示値＋概算'],['official','公式表示値（参考）']]){
    const badge=nutritionBasisBadge({nutrition:full,nutritionBasis:kind},{});
    assert.equal(badge.textContent,label);assert.ok(badge.title);assert.equal(badge.attributes['aria-label'],label);
  }
}));
