import test from 'node:test';
import assert from 'node:assert/strict';
import {MAPO_INGREDIENTS, MAPO_NUTRITION} from '../mapo-nutrition.js';
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);

test('にんにくの芽・豆板醤・甜麺醤を食べるg数から換算する',()=>{
  const shoots=MAPO_NUTRITION.mapo_garlic_shoots.nutritionPerUnit;
  near(shoots.kcal*40,17.6);near(shoots.fiber*40,1.52);near(shoots.fat*40,.12);
  const beanPaste=MAPO_NUTRITION.mapo_doubanjiang.nutritionPerUnit;
  near(beanPaste.salt*18,3.204);near(beanPaste.fat*18,.414);
  const sweetPaste=MAPO_NUTRITION.mapo_tianmianjiang.nutritionPerUnit;
  near(sweetPaste.kcal*18,44.82);near(sweetPaste.salt*18,1.314);
  assert.match(MAPO_INGREDIENTS.mapo_garlic_shoots.name,/茎にんにく/);
});

test('豆豉の糖質を総炭水化物と混同せず、不明値と補完を分ける',()=>{
  const profile=MAPO_NUTRITION.mapo_douchi;
  assert.equal(profile.rawNutritionPerUnit.carbs,null);assert.equal(profile.rawNutritionPerUnit.fiber,null);
  assert.deepEqual(profile.estimatedNutrients,['carbs','fiber']);
  near(profile.nutritionPerUnit.kcal*15,42);near(profile.nutritionPerUnit.protein*15,3.8);
  near(profile.nutritionPerUnit.fat*15,1.7);near(profile.nutritionPerUnit.salt*15,1.5);
  near(profile.nutritionPerUnit.carbs*15,2.9+7.6*.15);
  near(profile.nutritionPerUnit.fiber*10,.76);
  assert.match(profile.nutritionSource,/寺納豆/);assert.match(MAPO_INGREDIENTS.mapo_douchi.note,/豆豉醤/);
});

test('花椒の脂質を0にせず、未掲載の繊維だけを明示して近似する',()=>{
  const profile=MAPO_NUTRITION.mapo_huajiao;
  near(profile.nutritionPerUnit.kcal*.5,1.83);near(profile.nutritionPerUnit.fat*.5,.0305);
  assert.equal(profile.rawNutritionPerUnit.fiber,null);assert.deepEqual(profile.estimatedNutrients,['fiber']);
  near(profile.nutritionPerUnit.fiber*.5,.1265);
  assert.match(profile.nutritionSource,/花椒の実測値ではなく/);assert.match(MAPO_INGREDIENTS.mapo_huajiao.note,/花椒塩/);
});

test('ラー油は調理油と別に加算し、微量炭水化物の原表と概算を区別する',()=>{
  const profile=MAPO_NUTRITION.mapo_chilli_oil;
  near(profile.nutritionPerUnit.kcal*10,88.7);near(profile.nutritionPerUnit.fat*10,9.98);
  assert.equal(profile.rawNutritionPerUnit.carbs,null);assert.equal(profile.rawNutritionPerUnit.fiber,null);
  assert.deepEqual(profile.estimatedNutrients,['carbs','fiber']);near(profile.nutritionPerUnit.carbs*10,.003);
  assert.deepEqual(MAPO_INGREDIENTS.mapo_chilli_oil.allergens,['sesame']);
});

test('新6食材は既存の単位・アレルゲン規則へ追加でき、定数を変更できない',()=>{
  assert.equal(Object.keys(MAPO_INGREDIENTS).length,6);
  assert.deepEqual(Object.keys(MAPO_NUTRITION),Object.keys(MAPO_INGREDIENTS));
  for(const [id,ingredient]of Object.entries(MAPO_INGREDIENTS)){
    assert.equal(ingredient.unit,'g');assert.equal(MAPO_NUTRITION[id].gramsPerUnit,1);
    assert.deepEqual(ingredient.proteinSources,[]);
    assert.ok(Object.isFrozen(ingredient));assert.ok(Object.isFrozen(MAPO_NUTRITION[id].nutritionPerUnit));
    assert.ok(Object.values(MAPO_NUTRITION[id].nutritionPerUnit).every(value=>typeof value==='number'&&Number.isFinite(value)&&value>=0));
  }
  assert.deepEqual(MAPO_INGREDIENTS.mapo_doubanjiang.allergens,['wheat','soy','sesame']);
  assert.deepEqual(MAPO_INGREDIENTS.mapo_tianmianjiang.allergens,['wheat','soy']);
  assert.deepEqual(MAPO_INGREDIENTS.mapo_douchi.allergens,['soy']);
});
