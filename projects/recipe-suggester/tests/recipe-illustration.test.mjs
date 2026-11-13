import test from 'node:test';
import assert from 'node:assert/strict';
import {RECIPES} from '../data.js';
import {ILLUSTRATION_KINDS,recipeIllustration} from '../recipe-illustration.js';

const recipe=id=>{const value=RECIPES.find(row=>row.id===id);assert.ok(value,id);return value;};

test('984品すべてが対応する分類イラストを返し、料理データを書き換えない',()=>{
  const before=JSON.stringify(RECIPES),kinds=new Set(ILLUSTRATION_KINDS);
  assert.equal(RECIPES.length,984);assert.equal(kinds.size,25);assert.equal(kinds.size,ILLUSTRATION_KINDS.length);
  assert.ok(Object.isFrozen(ILLUSTRATION_KINDS));
  for(const row of RECIPES){
    const choice=recipeIllustration(row);assert.ok(kinds.has(choice.kind),row.id);
    assert.deepEqual(Object.keys(choice).sort(),['kind','label']);
    assert.match(choice.label,/イメージ$/);assert.ok(choice.label.length<32,row.id);assert.ok(!choice.label.includes('http'),row.id);
  }
  assert.equal(JSON.stringify(RECIPES),before);
});

test('主食は既存の大分類を使い、旧主菜扱いの麺・丼も正しく表す',()=>{
  const examples=[['plain-rice','rice'],['daily-onigiri-salmon','onigiri'],
    ['world-naan-cheese','bread'],['udon-pork','noodles'],['pasta-meat','noodles'],
    ['world-massaman-chicken','curry'],['classic-sushi-tuna','sushi'],
    ['varied-yakitori-don','rice']];
  for(const [id,kind] of examples)assert.equal(recipeIllustration(recipe(id)).kind,kind,id);
});

test('調理法と主な分類を参照し、混合料理の鍋や揚げ物を一つの食材へ偏らせない',()=>{
  const examples=[['familiar-yose-nabe','hotpot'],['palette-oden','hotpot'],
    ['classic-croquette-potato','fried'],['classic-sashimi-tuna','sashimi'],
    ['familiar-side-raw-vegetable','salad'],['classic-fried-egg','egg'],
    ['tavern-pork-wood-ear-egg','stir-fry'],['tavern-chive-kimchi-tofu','tofu']];
  for(const [id,kind] of examples)assert.equal(recipeIllustration(recipe(id)).kind,kind,id);
});

test('汁物・飲み物・チーズ・ナッツは写真や商品ブランドを特定しない分類にまとめる',()=>{
  const examples=[['soup-001','soup'],['soup-004','soup'],['drink-coffee','drink'],
    ['palette-cheese-camembert','cheese'],['palette-nuts-pistachio','nuts']];
  for(const [id,kind] of examples)assert.equal(recipeIllustration(recipe(id)).kind,kind,id);
  const bought=recipe('takeaway-yakitori-momo-tare');
  assert.deepEqual(recipeIllustration(bought),{kind:'skewer',label:'串焼きのイメージ'});
  assert.equal(recipeIllustration(recipe('varied-yakitori-tsukune')).kind,'skewer');
});

test('自作の未知の料理名・材料・量から料理や栄養を推定しない',()=>{
  for(const name of ['にぎり寿司','焼き鳥','唐揚げ','トマトサラダ']){
    const source={id:'custom-new',name,custom:true,role:'main',ingredients:[{id:'fish',amount:100}],manualNutrition:{kcal:50}};
    const before=structuredClone(source);
    assert.equal(recipeIllustration(source).kind,'plate');assert.deepEqual(source,before);
  }
  assert.equal(recipeIllustration({id:'custom-new',custom:true,role:'drink',name:'自分の飲み物'}).kind,'drink');
  assert.equal(recipeIllustration({id:'custom-new',custom:true,role:'soup',name:'自分のスープ'}).kind,'soup');
  assert.equal(recipeIllustration({id:'custom-new',custom:true,family:'curry',role:'staple',name:'自分の料理'}).kind,'curry');
  assert.equal(recipeIllustration({...recipe('varied-yakitori-tsukune'),custom:true,family:'meat-main',displayCategory:'meat',displayMethod:'grill'}).kind,'plate');
});

test('未知・不正な分類は中立な皿へ戻し、結果を変更しても次の表示に影響しない',()=>{
  for(const value of [null,undefined,[],42,{}, {custom:true,family:'not-a-family',role:'main'}]){
    assert.deepEqual(recipeIllustration(value),{kind:'plate',label:'食品のイメージ'});
  }
  const first=recipeIllustration(recipe('plain-rice'));first.kind='plate';first.label='変更';
  assert.deepEqual(recipeIllustration(recipe('plain-rice')),{kind:'rice',label:'ご飯・穀類のイメージ'});
});
