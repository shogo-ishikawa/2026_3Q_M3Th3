import test from 'node:test';
import assert from 'node:assert/strict';
import {INGREDIENTS,RECIPES} from '../data.js';
import {recipeNutrition,itemFromRecipe} from '../nutrition.js';
import {BREAD_INGREDIENTS,BREAD_NUTRITION,BREAD_RECIPES,BREAD_PRESETS} from '../bread-foods.js';

const ingredients={...INGREDIENTS,...BREAD_INGREDIENTS};
const data={ingredients,recipes:[...RECIPES,...BREAD_RECIPES.filter(r=>!RECIPES.some(old=>old.id===r.id))]};
const byId=id=>BREAD_RECIPES.find(r=>r.id===id);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('ジャム等4品は完成した製品のg数とMEXTの原値で計算する',()=>{
  const expected={
    bread_strawberry_jam:[250,.4,.1,63.3,1.3,0],
    bread_marmalade:[233,.2,.1,63.2,.7,0],
    bread_peanut_butter:[599,20.6,50.4,24.9,7.6,.9],
    bread_ketchup:[116,1.6,.2,27.6,1.7,3.1],
  };
  for(const [id,values]of Object.entries(expected)){
    const item=BREAD_INGREDIENTS[id];
    assert.equal(item.unit,'g');assert.equal(item.gramsPerUnit,1);
    for(const [i,key]of ['kcal','protein','fat','carbs','fiber','salt'].entries())near(item.nutritionPerUnit[key]*100,values[i]);
    assert.deepEqual(item.rawNutritionPerUnit,item.nutritionPerUnit);
    assert.deepEqual(item.estimatedNutrients,[]);
    assert.match(item.nutritionSource,/https:\/\/fooddb\.mext\.go\.jp/);
    assert.equal(item.nutritionSource,item.rawNutritionSource);
    assert.deepEqual(BREAD_NUTRITION[id].nutritionPerUnit,item.nutritionPerUnit);
    assert.equal(item.ingredientsKnown,false);assert.equal(item.allergensKnown,false);
    assert.ok(Object.isFrozen(item.nutritionPerUnit));
  }
});

test('新しい29配合は正の材料を持ち、ホットサンド10種とパンだけの開始点を含む',()=>{
  assert.equal(BREAD_RECIPES.length,29);
  assert.equal(new Set(BREAD_RECIPES.map(r=>r.id)).size,29);
  for(const r of BREAD_RECIPES){
    assert.equal(r.servings,2,r.id);
    assert.ok(r.ingredients.length>0,r.id);
    assert.equal(new Set(r.ingredients.map(p=>p.id)).size,r.ingredients.length,r.id);
    assert.ok(r.ingredients.every(p=>ingredients[p.id]&&Number.isFinite(p.amount)&&p.amount>0),r.id);
    for(const v of Object.values(recipeNutrition(r,data)))assert.ok(Number.isFinite(v),r.id);
    assert.ok(r.steps.length>=3,r.id);
  }
  assert.equal(BREAD_PRESETS['hot-sandwich'].filter(p=>!p.custom).length,10);
  for(const kind of ['english-muffin','sandwich','hot-sandwich','toast']){
    const custom=BREAD_PRESETS[kind].find(p=>p.custom);
    assert.equal(custom.label,'具材を指定する');
    assert.deepEqual(custom.components,[['base',1]]);
  }
});

test('朝食用マフィンのパティ・卵・油を独立した材料で含め、特定店の栄養値としない',()=>{
  const r=byId('bread-english-muffin-sausage-egg-cheese');
  const m=Object.fromEntries(r.ingredients.map(p=>[p.id,p.amount]));
  assert.equal(m.palette_english_muffin,120);assert.equal(m.pork_minced,90);
  assert.equal(m.egg,2);assert.equal(m.oil,4);assert.equal(m.cheese,30);
  near(m.salt,.7);near(m.black_pepper,.1);
  assert.match(r.sourceNote,/店舗の商品配合や公式栄養を再現したものではありません/);
  assert.ok(r.steps.some(s=>s.includes('パティ')&&s.includes('75℃')));
});

test('ピザトーストは食パンと完成製品gのケチャップを計上し、本体ピザとは区別する',()=>{
  const r=byId('bread-toast-pizza'),m=Object.fromEntries(r.ingredients.map(p=>[p.id,p.amount]));
  assert.equal(r.name,'ピザトースト');assert.equal(r.family,'bread');assert.equal(r.role,'staple');
  assert.equal(m.bread,120);assert.equal(m.cheese,50);assert.equal(m.bread_ketchup,32);assert.equal(m.tomato_paste,8);
  assert.equal(m.ready_sliced_ham,30);assert.equal(m.onion,30);assert.equal(m.pepper,20);assert.equal(m.corn,20);
  assert.equal(r.ingredientsKnown,false);assert.equal(r.allergensKnown,false);
});

test('ピーナッツ・オレンジと加工品の不明なアレルゲン状態を保持する',()=>{
  const peanut=itemFromRecipe(byId('bread-toast-peanut-butter'),data);
  assert.ok(peanut.allergens.includes('peanut'));
  const orange=itemFromRecipe(byId('bread-toast-marmalade-butter'),data);
  assert.ok(orange.allergens.includes('orange'));
  for(const item of [peanut,orange]){
    assert.equal(item.allergensKnown,false);assert.equal(item.ingredientsKnown,false);
    assert.ok(Number.isFinite(item.nutrition.kcal));
  }
});
