import test from 'node:test';
import assert from 'node:assert/strict';
import {NOODLE_INGREDIENTS,NOODLE_NUTRITION,NOODLE_RECIPES,NOODLE_STYLES,NOODLE_TOPPINGS} from '../noodle-foods.js';
import {INGREDIENTS,RECIPES,ALLERGENS} from '../data.js';
import {recipeNutrition,NUTRIENT_KEYS} from '../nutrition.js';

const ingredients=Object.fromEntries(Object.entries({...INGREDIENTS,...NOODLE_INGREDIENTS}).map(([id,ingredient])=>[id,{...ingredient,...NOODLE_NUTRITION[id]}]));
const data={ingredients,recipes:NOODLE_RECIPES,allergens:ALLERGENS};
const near=(actual,expected)=>assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
const total=rows=>recipeNutrition({servings:1,ingredients:rows},data);
const sumRows=rows=>Object.fromEntries([...new Set(rows.map(r=>r.id))].sort().map(id=>[id,rows.filter(r=>r.id===id).reduce((sum,r)=>sum+r.amount,0)]));

test('新7食材は抽出液と濃縮品を区別し、脂質・塩分と未掲載値を保持する',()=>{
  assert.equal(Object.keys(NOODLE_INGREDIENTS).length,7);
  assert.deepEqual(Object.keys(NOODLE_NUTRITION),Object.keys(NOODLE_INGREDIENTS));
  near(NOODLE_NUTRITION.noodle_tonkotsu_concentrate.nutritionPerUnit.fat*30,9.06);
  near(NOODLE_NUTRITION.noodle_tonkotsu_concentrate.nutritionPerUnit.salt*30,4.11);
  near(NOODLE_NUTRITION.noodle_pork_fat.nutritionPerUnit.fat*25,17.675);
  near(NOODLE_NUTRITION.noodle_chicken_oil.nutritionPerUnit.fat*10,9.99);
  assert.equal(NOODLE_INGREDIENTS.noodle_chinese_stock.unit,'ml');
  assert.equal(NOODLE_INGREDIENTS.noodle_tonkotsu_concentrate.unit,'g');
  assert.equal(NOODLE_NUTRITION.noodle_chinese_stock.rawNutritionPerUnit.carbs,null);
  assert.equal(NOODLE_NUTRITION.noodle_chinese_stock.rawNutritionPerUnit.fiber,null);
  assert.deepEqual(NOODLE_NUTRITION.noodle_chinese_stock.estimatedNutrients,['carbs','fiber']);
  assert.equal(NOODLE_NUTRITION.noodle_tonkotsu_concentrate.rawNutritionPerUnit.fiber,null);
  near(NOODLE_NUTRITION.noodle_niboshi_stock.nutritionPerUnit.carbs*400,.12);
  assert.match(NOODLE_INGREDIENTS.noodle_niboshi_stock.note,/丸ごと食べる栄養とは区別/);
  assert.match(NOODLE_INGREDIENTS.noodle_pork_fat.note,/専用の分析値ではなく/);
});

test('チャーシュー枚数・小さじ・メンマの繊維と調味料を食材のg等へ換算する',()=>{
  const chashu=NOODLE_TOPPINGS.find(t=>t.id==='chashu');
  assert.equal(chashu.unit,'枚');assert.deepEqual(chashu.ingredients,[{id:'noodle_chashu',amount:20}]);
  const values=total(chashu.ingredients.map(r=>({...r,amount:r.amount*2})));
  near(values.kcal,66.4);near(values.fat,3.28);near(values.salt,.96);
  const garlic=NOODLE_TOPPINGS.find(t=>t.id==='garlic');
  assert.equal(garlic.unit,'小さじ');assert.deepEqual(garlic.ingredients,[{id:'garlic',amount:3}]);
  const menma=NOODLE_TOPPINGS.find(t=>t.id==='menma');
  const menmaValues=total(menma.ingredients.map(r=>({...r,amount:r.amount*20})));
  assert.ok(menmaValues.salt>.1,'水煮の低塩分だけで味付けメンマを計算しない');
  near(menmaValues.fiber,.408+ingredients.soy_sauce.nutritionPerUnit.fiber*1.2);
  const ajitama=NOODLE_TOPPINGS.find(t=>t.id==='ajitama');
  assert.equal(ajitama.ingredients[0].amount,1);assert.ok(total(ajitama.ingredients).salt>total([{id:'egg',amount:1}]).salt);
  assert.match(ajitama.note,/漬け汁の全量ではなく/);
});

test('10新レシピは2人分で全材料が判明し、既定の麺・スープ・具・トッピングを重複なく含む',()=>{
  assert.equal(NOODLE_RECIPES.length,10);assert.equal(NOODLE_STYLES.length,14);
  const toppingById=new Map(NOODLE_TOPPINGS.map(t=>[t.id,t]));
  for(const recipe of NOODLE_RECIPES){
    const model=NOODLE_STYLES.find(m=>m.recipeId===recipe.id);
    assert.equal(recipe.servings,2);assert.equal(model.noodleIngredientId,'ramen_noodles');
    assert.equal(model.noodleAmount,recipe.id==='noodle-ramen-jiro'?400:250);
    assert.equal(new Set(recipe.ingredients.map(r=>r.id)).size,recipe.ingredients.length,recipe.id);
    for(const row of recipe.ingredients){assert.ok(ingredients[row.id],`${recipe.id}/${row.id}`);assert.ok(row.amount>0);}
    const oneBowl=[{id:model.noodleIngredientId,amount:model.noodleAmount},...model.soup,...model.solids,...model.defaultToppings.flatMap(t=>toppingById.get(t.id).ingredients.map(r=>({...r,amount:r.amount*t.amount})))];
    const expected=sumRows(oneBowl),actual=sumRows(recipe.ingredients);
    assert.deepEqual(Object.keys(actual),Object.keys(expected));
    for(const id of Object.keys(expected))near(actual[id],expected[id]*2);
    for(const key of NUTRIENT_KEYS)assert.ok(Number.isFinite(recipeNutrition(recipe,data)[key]),`${recipe.id}.${key}`);
    assert.ok(recipe.steps.length>=3);assert.ok(recipe.steps.every(step=>!/[0-9]+\s*(?:g|ml|個|枚|皿|人分|つ)/.test(step)),recipe.id);
  }
});

test('元の4家庭ラーメンを全量飲用で正確に復元し、完成品やインスタントは混ぜない',()=>{
  const legacy=NOODLE_STYLES.filter(model=>model.recipeId.startsWith('daily-'));
  assert.equal(legacy.length,4);
  for(const model of legacy){
    const original=RECIPES.find(recipe=>recipe.id===model.recipeId);assert.ok(original);
    assert.deepEqual(model.defaultToppings,[]);assert.equal(model.soupVolumeMl,350);
    const rows=[{id:model.noodleIngredientId,amount:model.noodleAmount*2},...[...model.soup,...model.solids].map(r=>({...r,amount:r.amount*2}))];
    assert.deepEqual(sumRows(rows),sumRows(original.ingredients));
  }
  assert.ok(NOODLE_STYLES.every(model=>!/(instant|takeaway|ready)/.test(model.recipeId)));
});

test('名称を決めるバター・コーン・背脂・肉そぼろを固定し、汁なしのたれは固形側へ置く',()=>{
  const byId=id=>NOODLE_STYLES.find(s=>s.recipeId===id);
  const miso=byId('noodle-ramen-miso-butter-corn');
  assert.ok(miso.soup.some(r=>r.id==='butter'&&r.amount===10));assert.ok(miso.solids.some(r=>r.id==='corn'&&r.amount===50));
  for(const id of ['noodle-ramen-jiro','noodle-ramen-seabura']){
    assert.ok(byId(id).soup.some(r=>r.id==='noodle_pork_fat'));assert.ok(!byId(id).solids.some(r=>r.id==='noodle_pork_fat'));
  }
  const tantan=byId('noodle-ramen-tantan');
  assert.ok(tantan.solids.some(r=>r.id==='pork_minced'));assert.ok(tantan.soup.some(r=>r.id==='ground_sesame'));
  for(const id of ['noodle-aburasoba','noodle-hiyashi-chuka','noodle-soupless-tantan']){
    const model=byId(id);assert.equal(model.kind,'soupless');assert.deepEqual(model.soup,[]);assert.equal(model.soupVolumeMl,0);
    assert.ok(model.solids.some(r=>['oil','sesame_oil','mapo_chilli_oil'].includes(r.id)));
  }
});

test('一次資料URL・アレルゲン・凍結された概算プロファイルを保持する',()=>{
  const allowed=new Set(ALLERGENS.map(a=>a.id));
  for(const [id,ingredient]of Object.entries(NOODLE_INGREDIENTS)){
    assert.ok(ingredient.allergens.every(a=>allowed.has(a)),id);
    assert.ok(Object.isFrozen(ingredient));assert.ok(Object.isFrozen(NOODLE_NUTRITION[id].nutritionPerUnit));
    assert.match(NOODLE_NUTRITION[id].nutritionSource,/https:\/\//);
    assert.ok(Object.values(NOODLE_NUTRITION[id].nutritionPerUnit).every(n=>Number.isFinite(n)&&n>=0));
  }
  assert.deepEqual(NOODLE_INGREDIENTS.noodle_tonkotsu_concentrate.allergens,['sesame','soy','pork']);
  assert.deepEqual(NOODLE_INGREDIENTS.noodle_chicken_oil.allergens,['soy','chicken','sesame']);
  assert.deepEqual(NOODLE_INGREDIENTS.noodle_chashu.allergens,['wheat','soy','pork']);
});
