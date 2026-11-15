import test from 'node:test';
import assert from 'node:assert/strict';
import {INGREDIENTS} from '../data.js';
import {INGREDIENT_GROUPS} from '../shopping-categories.js';
import {pantryClassification,pantryIngredients,pantrySubgroups} from '../pantry-catalog.js';
import {createPantryExtraIngredients} from '../pantry-extra-ingredients.js';
const extra=createPantryExtraIngredients(INGREDIENTS),data={ingredients:{...INGREDIENTS,...extra}};

test('全食材を重複なくジャンル・種類から呼び出せる',()=>{
  const original=structuredClone(data.ingredients),all=pantryIngredients('all','all','',data),ids=all.map(food=>food.id);
  assert.equal(ids.length,Object.keys(data.ingredients).length);assert.equal(new Set(ids).size,ids.length);
  const nested=[];
  for(const group of INGREDIENT_GROUPS)for(const subgroup of pantrySubgroups(group.id,data)){
    const foods=pantryIngredients(group.id,subgroup.id,'',data);assert.equal(foods.length,subgroup.count);nested.push(...foods.map(food=>food.id));
  }
  assert.deepEqual([...nested].sort(),[...ids].sort());assert.deepEqual(data.ingredients,original);
});

test('肉は牛・豚・鶏・加工肉・合い挽きで分け、一般的な部位を内臓より先に置く',()=>{
  assert.deepEqual(pantrySubgroups('meat',data).map(x=>x.id),['beef','pork','chicken','processed','mixed','other']);
  const beef=pantryIngredients('meat','beef','',data).map(x=>x.id);
  for(const common of ['beef','beef_round_raw','beef_short_rib','beef_minced'])for(const unusual of ['beef_tongue','meat_beef_small_intestine_raw','meat_beef_rumen_boiled'])assert.ok(beef.indexOf(common)<beef.indexOf(unusual));
  assert.equal(pantryClassification('beef_pork_mince_raw',data).subgroup,'mixed');assert.equal(pantryClassification('burger_meat_patty',data).subgroup,'mixed');
  assert.ok(!beef.includes('burger_meat_patty'));assert.match(data.ingredients.burger_meat_patty.name,/調理済み/);
  const chicken=pantryIngredients('meat','chicken','',data).map(x=>x.id);assert.deepEqual(chicken.slice(0,3),['chicken','chicken_breast','chicken_minced']);
  assert.ok(pantryIngredients('meat','processed','',data).some(x=>x.id==='palette_wiener'));
});

test('刺身と加熱用の魚、野菜ときのこを混ぜず、名前や分類ラベルでも検索できる',()=>{
  assert.equal(pantryClassification('salmon',data).subgroup,'fish');assert.equal(pantryClassification('salmon_sashimi',data).subgroup,'sashimi');
  assert.equal(pantryClassification('shimeji',data).subgroup,'mushroom');assert.equal(pantryClassification('simmered_gobomaki',data).group,'fish');
  assert.ok(pantryIngredients('all','all','合い挽き',data).some(x=>x.id==='beef_pork_mince_raw'));
  assert.ok(pantryIngredients('meat','chicken','むね',data).some(x=>x.id==='chicken_breast'));
  assert.ok(pantryIngredients('fish','sashimi','',data).every(x=>pantryClassification(x.id,data).subgroup==='sashimi'));
  assert.deepEqual(pantryIngredients('meat','pork','牛',data),[]);
});

test('将来追加された食材もそのジャンルのその他へ残し、未知IDを別食材として返さない',()=>{
  const future={ingredients:{...data.ingredients,new_cut:{name:'追加した肉',unit:'g',groups:['protein'],proteinSources:['meat']}}};
  assert.equal(pantryClassification('new_cut',future).subgroup,'other');assert.equal(pantryClassification('not-in-db',future),null);
  assert.ok(pantrySubgroups('meat',future).some(x=>x.id==='other'));
  assert.ok(pantryIngredients('meat','other','',future).some(x=>x.id==='new_cut'));
});

test('追加した生肉は出典の生の重量で、合い挽きは明示的な1対1概算として分ける',()=>{
  const original=structuredClone(INGREDIENTS),created=createPantryExtraIngredients(INGREDIENTS);
  assert.deepEqual(created.beef_round_raw.nutritionPerUnit,{kcal:1.33,protein:.2,fat:.067,carbs:.004,fiber:0,salt:.001});
  assert.match(created.beef_round_raw.nutritionSource,/11076/);assert.match(created.beef_round_raw.name,/皮下脂肪なし・生/);
  const mixed=created.beef_pork_mince_raw;
  for(const key of ['kcal','protein','fat','carbs','fiber','salt']){
    assert.equal(mixed.nutritionPerUnit[key],Number(((INGREDIENTS.beef_minced.nutritionPerUnit[key]+INGREDIENTS.pork_minced.nutritionPerUnit[key])/2).toFixed(8)));
    assert.equal(mixed.rawNutritionPerUnit[key],null);
  }
  assert.deepEqual(mixed.allergens,['beef','pork']);assert.equal(mixed.estimatedNutrients.length,6);assert.match(mixed.nutritionSource,/公的な合い挽き肉の成分値ではなく/);
  assert.deepEqual(INGREDIENTS,original);assert.ok(Object.isFrozen(created));assert.ok(Object.isFrozen(mixed.nutritionPerUnit));
  assert.throws(()=>createPantryExtraIngredients({}),/栄養値/);
});
