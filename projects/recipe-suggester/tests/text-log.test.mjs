import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS,INGREDIENTS,RECIPES} from '../data.js';
import {parseTextMeal,textFoodCandidates,textAmountForRecipe,buildTextMeal,createTextMealSelection,TEXT_LOG_MAX_ROWS} from '../text-log.js';
import {buildFoodSelection,defaultFoodSelection} from '../food-composer.js';
import {defaultJournal,parseJournal,validateJournal} from '../journal.js';
import {itemNutrition} from '../nutrition.js';

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

test('刺身の敬称・送り仮名・かな表記を同じ候補として探し、具材を選べる盛り合わせを優先する',()=>{
  const expected=textFoodCandidates('刺身',data).map(item=>item.id);
  assert.equal(expected[0],'classic-sashimi-assorted');
  for(const alias of ['お刺身','お刺し身','御刺身','おさしみ','オサシミ'])assert.deepEqual(textFoodCandidates(alias,data).map(item=>item.id),expected,alias);
  assert.equal(textFoodCandidates('お刺身',data,{limit:1})[0].id,'classic-sashimi-assorted');
  assert.equal(textFoodCandidates('まぐろ赤身',data)[0].id,'classic-sashimi-tuna');
  assert.equal(textFoodCandidates('お寿司',data)[0].id,'classic-sushi-assorted');
  assert.equal(textFoodCandidates('おでん',data)[0].id,'palette-oden');
});

test('一般名のトーストは具材なしを最初にし、バター・ジャム・ピザを指定した検索はその料理を保つ',()=>{
  for(const query of ['トースト','とーすと','ﾄｰｽﾄ',' トースト ']){
    assert.equal(textFoodCandidates(query,data)[0].id,'bread-toast-custom',query);
    assert.equal(textFoodCandidates(query,data,{limit:1})[0].id,'bread-toast-custom',query);
  }
  for(const [query,id] of [['バタートースト','staple-butter-toast'],['いちごジャムバタートースト','bread-toast-jam-butter'],['ジャムバタートースト','bread-toast-jam-butter'],['ピザトースト','bread-toast-pizza']]){
    assert.equal(textFoodCandidates(query,data)[0].id,id,query);
  }
  const [row]=parseTextMeal('トースト2枚',data);
  assert.equal(row.candidates[0].id,'bread-toast-custom');assert.equal(row.rawAmount,'2');assert.equal(row.rawUnit,'枚');
  const plain=recipe(row.candidates[0].id),converted=textAmountForRecipe(plain,row.rawAmount,row.rawUnit,data);
  assert.equal(converted.amount,2);assert.equal(converted.unit,'枚');
  const composed=buildFoodSelection(defaultFoodSelection('toast',{recipeId:plain.id}),data),selection=createTextMealSelection(plain.id,composed,data);
  const item=buildTextMeal({...context,rows:[{recipeId:plain.id,amount:converted.amount,selection}]},data).items[0];
  assert.equal(item.quantity,2);assert.equal(item.ingredients.length,1);assert.equal(item.ingredients[0].id,'bread');assert.equal(item.ingredients[0].amount*item.quantity,120);
});

test('刺身3切れとおでんの具を確定し、外側の皿数だけで倍率を掛けて一括記録する',()=>{
  const sashimi=buildFoodSelection({kind:'sashimi',components:[{id:'tuna',amount:3,gramsPerUnit:20}]},data);
  const oden=buildFoodSelection({kind:'oden',components:[{id:'daikon',amount:2},{id:'egg',amount:1},{id:'broth',amount:0}]},data);
  const fishSelection=createTextMealSelection('classic-sashimi-assorted',sashimi,data),odenSelection=createTextMealSelection('palette-oden',oden,data);
  const input={...context,rows:[{recipeId:'plain-rice',amount:150},{recipeId:'classic-sashimi-assorted',amount:.5,selection:fishSelection},{recipeId:'palette-oden',amount:2,selection:odenSelection}]};
  const entry=buildTextMeal(input,data);assert.equal(entry.items.length,3);
  const [,fish,hotpot]=entry.items;
  assert.equal(fish.quantity,.5);assert.equal(fish.portion.amount,1);assert.equal(fish.portion.unit,'皿');
  assert.equal(fish.ingredients.find(part=>part.id==='tuna_lean_sashimi').amount*fish.quantity,30);
  assert.equal(hotpot.quantity,2);assert.equal(hotpot.ingredients.find(part=>part.id==='daikon').amount*hotpot.quantity,240);
  assert.equal(hotpot.ingredients.find(part=>part.id==='egg').amount*hotpot.quantity,2);
  assert.equal(hotpot.ingredients.some(part=>part.id==='water'||part.id==='soy_sauce'),false);
  assert.equal(itemNutrition(hotpot).kcal,178);assert.equal(itemNutrition(hotpot).fat,10.44);
  assert.ok(fish.name.includes('3切れ'));assert.ok(hotpot.name.includes('卵 1個'));
  const state=defaultJournal(context.date);state.entries=[entry];const saved=validateJournal(state,data),roundtrip=parseJournal(JSON.stringify(saved),data);
  assert.deepEqual(roundtrip.entries[0].items,entry.items);
  assert.equal(Object.hasOwn(entry.items[1],'textConfiguration'),false);
});

test('確定後のレシピやDBの変更から配合・栄養・未確認情報を保ち、再登録には別の項目IDを使う',()=>{
  const source=buildFoodSelection({kind:'oden',components:[{id:'daikon',amount:2},{id:'egg',amount:1}]},data);
  source.allergensKnown=false;source.ingredientsKnown=false;source.shoppingKnown=false;source.manualNutrition.salt=null;
  const selection=createTextMealSelection('palette-oden',source,data);
  source.manualNutrition.kcal=9999;source.ingredients[0].amount=999;source.allergensKnown=true;
  const changed={...data,ingredients:{...data.ingredients,daikon:{...data.ingredients.daikon,nutritionPerUnit:{...data.ingredients.daikon.nutritionPerUnit,kcal:9999}}}};
  const input={...context,rows:[{recipeId:'palette-oden',amount:1,selection}]};
  const first=buildTextMeal(input,changed).items[0],second=buildTextMeal(input,changed).items[0];
  assert.equal(first.nutrition.kcal,89);assert.equal(first.ingredients.find(p=>p.id==='daikon').amount,120);assert.equal(first.nutrition.salt,null);
  assert.equal(first.allergensKnown,false);assert.equal(first.ingredientsKnown,false);assert.equal(first.shoppingKnown,false);
  assert.notEqual(first.id,second.id);first.ingredients[0].amount=1;first.nutrition.kcal=0;assert.equal(second.nutrition.kcal,89);assert.equal(second.ingredients[0].amount,120);
});

test('確定した内容は元の行だけに結び付け、任意のスナップショットや過大な皿数を受け入れない',()=>{
  const built=buildFoodSelection({kind:'oden',components:[{id:'egg',amount:1}]},data),selection=createTextMealSelection('palette-oden',built,data);
  for(const invalid of [null,{},structuredClone(selection),{nutrition:{kcal:0}}])assert.throws(()=>buildTextMeal({...context,rows:[{recipeId:'palette-oden',amount:1,selection:invalid}]},data));
  assert.throws(()=>buildTextMeal({...context,rows:[{recipeId:'classic-sashimi-assorted',amount:1,selection}]},data));
  assert.throws(()=>buildTextMeal({...context,rows:[{recipeId:'palette-oden',amount:1001,selection}]},data));
  assert.throws(()=>createTextMealSelection('missing',built,data));
  assert.throws(()=>createTextMealSelection('palette-oden',{...built,servings:2},data));
  assert.throws(()=>createTextMealSelection('palette-oden',{...built,manualNutrition:{...built.manualNutrition,fat:-1}},data));
  assert.throws(()=>buildTextMeal({...context,date:'2026-02-30',rows:[{recipeId:'palette-oden',amount:1,selection}]},data));
});
