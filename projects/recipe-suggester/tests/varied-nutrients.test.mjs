import test from 'node:test';
import assert from 'node:assert/strict';
import { INGREDIENT_NUTRITION } from '../ingredient-nutrients.js';

const keys=['kcal','protein','fat','carbs','fiber','salt'];
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-7,`${actual} != ${expected}`);
const amount=(id,quantity)=>Object.fromEntries(keys.map(key=>[key,INGREDIENT_NUTRITION[id].nutritionPerUnit[key]===null?null:INGREDIENT_NUTRITION[id].nutritionPerUnit[key]*quantity]));

test('春巻きの皮と生唐辛子は食べる状態に対応した成分表を使う',()=>{
  const wrapper=amount('spring_roll_wrappers',100);
  for(const [key,value]of Object.entries({kcal:288,protein:8.3,fat:1.6,carbs:62.2,fiber:4.5,salt:1.1}))close(wrapper[key],value);
  assert.match(INGREDIENT_NUTRITION.spring_roll_wrappers.nutritionSource,/食品番号01179/);
  assert.match(INGREDIENT_NUTRITION.spring_roll_wrappers.nutritionSource,/揚げ油は別材料/);
  const chilli=amount('green_chilli',10);
  close(chilli.kcal,7.2);close(chilli.fiber,1.03);assert.equal(chilli.salt,0);
  assert.match(INGREDIENT_NUTRITION.green_chilli.nutritionSource,/食品番号06171/);
  assert.match(INGREDIENT_NUTRITION.green_chilli.nutritionSource,/青い品種専用の分析値ではなく/);
});

test('ナンプラー15mlは原表の密度で18.315gへ換算し食塩を二重補正しない',()=>{
  const sauce=amount('fish_sauce',15);
  close(sauce.kcal,8.60805);close(sauce.protein,1.666665);close(sauce.salt,4.194135);
  assert.equal(sauce.fiber,0);
  assert.match(INGREDIENT_NUTRITION.fish_sauce.nutritionSource,/食品番号17107/);
  assert.match(INGREDIENT_NUTRITION.fish_sauce.nutritionSource,/1ml＝1.221g/);
});

test('うなぎは調理済み白焼き、焼肉と牛舌と鶏皮は加熱前の可食重量に合わせる',()=>{
  for(const [id,code,values]of [
    ['eel_shirayaki','10069',[300,20.7,25.8,0.1,0,0.3]],
    ['beef_short_rib','11074',[338,14.4,32.9,0.2,0,0.1]],
    ['beef_tongue','11090',[318,13.3,31.8,0.2,0,0.2]],
    ['chicken_skin','11235',[474,6.6,51.6,0,0,0.1]],
  ]){
    const actual=amount(id,100);for(let i=0;i<keys.length;i++)close(actual[keys[i]],values[i]);
    assert.match(INGREDIENT_NUTRITION[id].nutritionSource,new RegExp(`食品番号${code}`));
  }
  assert.match(INGREDIENT_NUTRITION.eel_shirayaki.nutritionSource,/生のうなぎやたれ付き/);
  assert.match(INGREDIENT_NUTRITION.beef_short_rib.nutritionSource,/輸入牛ばら/);
  assert.match(INGREDIENT_NUTRITION.chicken_skin.nutritionSource,/もも皮.*皮下脂肪/);
});

test('完成品28種の材料プロフィールは不明を保ち公式表示の基準をメニューと区別する',()=>{
  const products=Object.entries(INGREDIENT_NUTRITION).filter(([id])=>id.startsWith('takeaway_'));
  assert.equal(products.length,28);
  for(const [id,metadata]of products){
    assert.deepEqual(metadata.nutritionPerUnit,Object.fromEntries(keys.map(key=>[key,null])),id);
    assert.match(metadata.nutritionSource,/https:\/\//,id);
    assert.match(metadata.nutritionSource,/2026-11-13/,id);
  }
  assert.match(INGREDIENT_NUTRITION.takeaway_frozen_suigyoza.nutritionSource,/栄養表示が掲載されていない/);
});
