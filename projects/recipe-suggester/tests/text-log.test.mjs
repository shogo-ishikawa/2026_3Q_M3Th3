import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {parseTextMeal,textFoodCandidates,textAmountForRecipe,buildTextMeal,TEXT_LOG_MAX_ROWS} from '../text-log.js';

const data={allergens:ALLERGENS,ingredients:INGREDIENTS,recipes:RECIPES};
const recipe=id=>{const value=RECIPES.find(row=>row.id===id);assert.ok(value,id);return value;};
const context={date:'2026-11-13',meal:'breakfast',status:'eaten'};

test('文章の全項目を残し、ご飯は解決・パック換算とみそ汁の種類は確認を求める',()=>{
  const rows=parseTextMeal('ご飯150g、納豆1パック、みそ汁1杯',data);
  assert.equal(rows.length,3);
  assert.deepEqual(rows.map(row=>[row.name,row.rawAmount,row.rawUnit]),[['ご飯','150','g'],['納豆','1','パック'],['みそ汁','1','杯']]);
  assert.equal(rows[0].recipeId,'plain-rice');assert.equal(rows[0].amount,150);assert.equal(rows[0].unit,'g');
  assert.equal(rows[1].recipeId,'classic-natto-plain');assert.equal(rows[1].amount,null);assert.match(rows[1].note,/換算は未登録/);
  assert.equal(rows[2].recipeId,'');assert.ok(rows[2].candidates.length>1);assert.match(rows[2].note,/種類を選んで/);
});

test('読み・全角・改行などを扱い、未知の料理も黙って捨てない',()=>{
  const rows=parseTextMeal('ごはん１５０ｇ\n ゆで卵１個；未登録の宇宙料理2皿。',data);
  assert.equal(rows.length,3);assert.equal(rows[0].recipeId,'plain-rice');assert.equal(rows[0].amount,150);
  assert.equal(rows[1].recipeId,'classic-boiled-egg');assert.equal(rows[1].amount,1);
  assert.equal(rows[2].source,'未登録の宇宙料理2皿');assert.deepEqual(rows[2].candidates,[]);assert.equal(rows[2].recipeId,'');assert.match(rows[2].note,/一致する料理がありません/);
  assert.ok(textFoodCandidates('ごはん',data).some(row=>row.id==='plain-rice'));
  assert.ok(textFoodCandidates('ラーメン',data).length<=24);
  assert.ok(parseTextMeal('ご飯',data)[0].note.includes('基準量'));
});

test('負数・指数表記・16進数・異常値も行を残して登録不可にする',()=>{
  for(const value of ['-10','+10','1e2','0x10','Infinity','NaN','0','100001']){
    const [row]=parseTextMeal(`ご飯${value}g`,data);
    assert.equal(row.recipeId,'',value);assert.equal(row.amount,null,value);assert.ok(row.error,value);assert.equal(row.candidates[0].id,'plain-rice',value);
  }
  const [malformed]=parseTextMeal('ご飯1.2.3g',data);assert.ok(malformed.error);assert.equal(malformed.amount,null);
  const [unsupported]=parseTextMeal('ご飯150kg',data);assert.equal(unsupported.recipeId,'');assert.match(unsupported.note,/一致する料理/);
  assert.throws(()=>parseTextMeal('',data));assert.throws(()=>parseTextMeal('ご飯'.repeat(1001),data));
  assert.throws(()=>parseTextMeal(Array(TEXT_LOG_MAX_ROWS+1).fill('ご飯').join('、'),data));
});

test('登録済みの基準量だけを換算し、不明な重量や調理後の完成重量は作らない',()=>{
  assert.equal(textAmountForRecipe(recipe('plain-rice'),2,'人分',data).amount,300);
  assert.equal(textAmountForRecipe(recipe('classic-boiled-egg'),100,'g',data).amount,2);
  assert.equal(textAmountForRecipe(recipe('classic-natto-plain'),1,'パック',data).amount,null);
  assert.equal(textAmountForRecipe(recipe('classic-natto-plain'),50,'g',data).amount,null);
  assert.equal(textAmountForRecipe(recipe('plain-rice'),1,'どんぶり',data).amount,null);
  assert.equal(textAmountForRecipe(recipe('plain-rice'),1,'大さじ',data).amount,null);
  assert.equal(textAmountForRecipe(recipe('plain-rice'),150,'',data).amount,null);
  assert.equal(textAmountForRecipe(recipe('confectionery-bisco'),1,'パック',data).amount,21.5);
  const drink=recipe('performance-beer');
  assert.equal(textAmountForRecipe(drink,2,'大さじ',data).amount,30);
  assert.equal(textAmountForRecipe(drink,1.5,'小さじ',data).amount,7.5);
  assert.equal(textAmountForRecipe(drink,20,'cc',data).amount,20);
  assert.ok(Math.abs(textAmountForRecipe(drink,1,'g',data).amount-1/1.008)<1e-12);
  const withoutDensity={...data,ingredients:{...data.ingredients,perf_beer:{...data.ingredients.perf_beer,gramsPerUnit:undefined}}};
  assert.equal(textAmountForRecipe(drink,1,'g',withoutDensity).amount,null);
});

test('全行を確認してから独立した料理スナップショットを1件にまとめる',()=>{
  const source={...context,note:'朝食のまとめ',rows:[{recipeId:'plain-rice',amount:150},{recipeId:'classic-natto-plain',amount:1},{recipeId:'classic-boiled-egg',amount:.5}]};
  const before=structuredClone(source),value=buildTextMeal(source,data),again=buildTextMeal(source,data);
  assert.deepEqual(source,before);assert.equal(value.items.length,3);assert.equal(value.note,'朝食のまとめ');assert.equal(value.meal,'breakfast');assert.notEqual(value.id,again.id);
  assert.equal(new Set(value.items.map(item=>item.id)).size,3);assert.notEqual(value.items[0].id,again.items[0].id);
  assert.equal(value.items[0].quantity,1);assert.equal(value.items[0].portion.amount,150);assert.equal(value.items[2].quantity,.5);
  assert.notEqual(value.items[0].nutrition,again.items[0].nutrition);assert.notEqual(value.items[0].ingredients,recipe('plain-rice').ingredients);
  value.items[0].portion.amount=1;assert.equal(again.items[0].portion.amount,150);
});

test('未解決の行・数量・日付に問題がある時は一部だけの記録を返さない',()=>{
  const valid={recipeId:'plain-rice',amount:150};
  for(const invalid of [{recipeId:'',amount:1},{recipeId:'missing-id',amount:1},{recipeId:'plain-rice',amount:'150'},{recipeId:'plain-rice',amount:-1},{recipeId:'plain-rice',amount:NaN},{recipeId:'plain-rice',amount:0},{recipeId:'plain-rice',amount:Infinity},{recipeId:'plain-rice',amount:150,nutrition:{kcal:0}}]){
    const source={...context,rows:[valid,invalid]},before=structuredClone(source);assert.throws(()=>buildTextMeal(source,data));assert.deepEqual(source,before);
  }
  assert.throws(()=>buildTextMeal({...context,date:'2026-02-30',rows:[valid]},data));
  assert.throws(()=>buildTextMeal({...context,rows:[]},data));
  assert.throws(()=>buildTextMeal({...context,rows:[,valid]},data));
  assert.throws(()=>buildTextMeal({...context,rows:[{recipeId:'classic-boiled-egg',amount:1001}]},data));
  assert.throws(()=>buildTextMeal({...context,rows:[valid],surprise:true},data));
});
