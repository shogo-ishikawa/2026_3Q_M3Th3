import test from 'node:test';
import assert from 'node:assert/strict';
import {previewReset, resetEntriesRange, createCatalogEntry} from '../record-actions.js';
import {defaultJournal, validateJournal, MEAL_IDS} from '../journal.js';
import {itemNutrition} from '../nutrition.js';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';

const values = (kcal=0, protein=0, fat=0, carbs=0, fiber=0, salt=0) => ({kcal, protein, fat, carbs, fiber, salt});
const unknown = () => Object.fromEntries(Object.keys(values()).map(key=>[key,null]));
const data = {
  allergens: [{id:'milk'}, {id:'soy'}, {id:'salmon'}],
  ingredients: {
    rice: {name:'ご飯',unit:'g',allergens:[],groups:['staple'],proteinSources:[],nutritionPerUnit:values(1.6,0.025,0.003,0.36,0.015)},
    milk: {name:'牛乳',unit:'ml',allergens:['milk'],groups:['dairy'],proteinSources:[],nutritionPerUnit:values(0.6,0.03,0.04,0.04,0,0.001)},
    salmon: {name:'刺身用サーモン',unit:'g',allergens:['salmon'],groups:['protein'],proteinSources:['fish'],nutritionPerUnit:values(2,0.2,0.12,0,0,0.001)},
  },
  recipes: [
    {id:'rice',name:'白米',role:'staple',family:'rice',minutes:1,servings:1,ingredients:[{id:'rice',amount:150}],steps:['器に盛る。'],staple:true,portion:{amount:150,unit:'g'}},
    {id:'milk',name:'牛乳',role:'drink',family:'milk',minutes:1,servings:1,ingredients:[{id:'milk',amount:200}],steps:['注ぐ。'],staple:false,portion:{amount:200,unit:'ml'}},
    {id:'sushi',name:'サーモンのにぎり',role:'staple',family:'sushi',minutes:10,servings:2,ingredients:[{id:'rice',amount:120},{id:'salmon',amount:80}],steps:['にぎる。'],staple:true,portion:{amount:2,unit:'貫',label:'基準は2貫'}},
    {id:'unconfirmed',name:'商品未確認の牛乳',role:'drink',family:'milk',minutes:1,servings:1,ingredients:[{id:'milk',amount:200}],steps:['商品表示を確認する。'],staple:false,portion:{amount:200,unit:'ml'},allergensKnown:false,ingredientsKnown:false,shoppingKnown:true,nature:'ready-to-eat',sourceNote:'商品ごとに表示を確認。'},
    {id:'custom-unknown',name:'名前だけのマイメニュー',role:'main',family:'main',minutes:1,servings:1,ingredients:[],steps:[],staple:false,custom:true,allergensKnown:false,ingredientsKnown:false,manualNutrition:unknown(),allergens:[],groups:[],proteinSources:[],portion:{amount:1,unit:'皿'}},
  ],
};
const input = (changes={}) => ({recipeId:'rice',date:'2026-11-13',meal:'dinner',status:'eaten',amount:150,note:'夕食',...changes});
const makeEntry = (id,date,meal,status='eaten',count=1) => ({id,date,meal,status,note:'',items:Array.from({length:count},(_,index)=>({id:`${id}-item-${index}`}))});
const state = () => ({...defaultJournal('2026-11-13'),
  entries:[
    makeEntry('before','2026-11-11','dinner'),
    makeEntry('first-breakfast','2026-11-12','breakfast','eaten',2),
    makeEntry('first-plan','2026-11-12','dinner','planned'),
    makeEntry('last-lunch','2026-11-14','lunch','eaten',3),
    {...makeEntry('last-memo','2026-11-14','snack','eaten',0),note:'外で食べた'},
    makeEntry('after','2026-11-15','dinner'),
    makeEntry('future','2100-12-31','dinner','planned'),
  ],completedDays:['2026-11-11','2026-11-12','2026-11-13','2026-11-14','2026-11-15'],
  customRecipes:[{id:'my-recipe'}],pantry:[{id:'rice',amount:200}],shoppingChecks:['rice'],
});
const all = {from:'2026-11-12',to:'2026-11-14',status:'all'};
const deepFreeze = value => {if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))deepFreeze(child);}return value;};

test('リセットの確認件数は期間両端の記録・品数・完了日とメモだけの記録を数える',()=>{
  const source=state(),before=structuredClone(source);deepFreeze(source);
  assert.deepEqual(previewReset(source,all),{entryCount:4,itemCount:6,completedDayCount:3});
  assert.deepEqual(previewReset(source,{...all,from:'2026-11-12',to:'2026-11-12'}),{entryCount:2,itemCount:3,completedDayCount:1});
  assert.deepEqual(source,before);
});

test('範囲内だけを不変更新し、対象外の記録や自分のDB・在庫・設定を保持する',()=>{
  const source=state(),before=structuredClone(source);deepFreeze(source);
  const result=resetEntriesRange(source,all);
  assert.notEqual(result,source);assert.notEqual(result.entries,source.entries);assert.notEqual(result.completedDays,source.completedDays);
  assert.deepEqual(result.entries.map(entry=>entry.id),['before','after','future']);
  assert.deepEqual(result.completedDays,['2026-11-11','2026-11-15']);
  for(const key of ['customRecipes','pantry','settings','shoppingChecks','targets','profile','version'])assert.deepEqual(result[key],before[key],key);
  assert.deepEqual(source,before);
});

test('予定だけをリセットする場合は食べた記録と完了チェックを保持する',()=>{
  const source=state(),filter={...all,status:'planned'};
  assert.deepEqual(previewReset(source,filter),{entryCount:1,itemCount:1,completedDayCount:0});
  const result=resetEntriesRange(source,filter);
  assert.deepEqual(result.completedDays,source.completedDays);
  assert.deepEqual(result.entries.map(entry=>entry.id),['before','first-breakfast','last-lunch','last-memo','after','future']);
});

test('実績や食事区分の指定で記録を絞り、範囲内の完了は記録0件の日も取り消す',()=>{
  const source=state(),filter={...all,status:'eaten',meals:['breakfast','snack']};
  assert.deepEqual(previewReset(source,filter),{entryCount:2,itemCount:2,completedDayCount:3});
  assert.deepEqual(resetEntriesRange(source,filter).entries.map(entry=>entry.id),['before','first-plan','last-lunch','after','future']);
  const emptyDate={from:'2026-11-13',to:'2026-11-13',status:'eaten'};
  assert.deepEqual(previewReset(source,emptyDate),{entryCount:0,itemCount:0,completedDayCount:1});
  assert.ok(!resetEntriesRange(source,emptyDate).completedDays.includes('2026-11-13'));
});

test('2000年から2100年までの日付範囲を日数上限なく処理し将来の予定も含める',()=>{
  const source=state();source.entries.unshift(makeEntry('oldest','2000-01-01','breakfast'));
  source.completedDays.unshift('2000-01-01');
  const filter={from:'2000-01-01',to:'2100-12-31',status:'all',meals:[...MEAL_IDS]};
  assert.equal(previewReset(source,filter).entryCount,8);
  assert.deepEqual(resetEntriesRange(source,filter).entries,[]);
  assert.deepEqual(resetEntriesRange(source,filter).completedDays,[]);
});

test('無効な日付・逆転期間・未対応の状態や食事区分を削除前に拒否する',()=>{
  const source=state(),before=structuredClone(source);
  const invalid=[null,{}, {...all,from:'1999-12-31'},{...all,to:'2101-01-01'},{...all,from:'2026-02-30'},{...all,from:'2026-11-15'}, {...all,status:'consumed'}, {...all,meals:[]}, {...all,meals:['lunch','lunch']}, {...all,meals:['brunch']}, {...all,meals:Array(1)}, {...all,meal:'lunch'}];
  for(const filter of invalid){assert.throws(()=>previewReset(source,filter));assert.throws(()=>resetEntriesRange(source,filter));}
  for(const damaged of [{...source,entries:null},{...source,entries:[{}]},{...source,completedDays:['2026-02-30']},{...source,completedDays:Array(1)}]){
    assert.throws(()=>previewReset(damaged,all));assert.throws(()=>resetEntriesRange(damaged,all));
  }
  assert.deepEqual(source,before);
});

test('表示単位のg・ml・貫を倍率に換算して独立したスナップショットを作る',()=>{
  const source=structuredClone(data);deepFreeze(data);
  const rice=createCatalogEntry(input({amount:100}),data),milk=createCatalogEntry(input({recipeId:'milk',amount:150,meal:'breakfast',status:'planned'}),data),sushi=createCatalogEntry(input({recipeId:'sushi',amount:1,note:''}),data);
  assert.equal(rice.items[0].quantity,2/3);assert.equal(rice.items[0].portion.amount,150);assert.equal(rice.items[0].portion.unit,'g');
  assert.equal(itemNutrition(rice.items[0]).kcal,160);
  assert.equal(milk.items[0].quantity,0.75);assert.equal(milk.items[0].portion.unit,'ml');assert.equal(milk.status,'planned');assert.equal(milk.meal,'breakfast');
  assert.equal(sushi.items[0].quantity,0.5);assert.equal(sushi.items[0].portion.unit,'貫');assert.equal(sushi.items[0].ingredients.find(part=>part.id==='rice').amount,60);
  assert.equal(itemNutrition(sushi.items[0]).kcal,88);
  assert.equal(new Set([rice.id,milk.id,sushi.id]).size,3);
  assert.equal(new Set([rice.items[0].id,milk.items[0].id,sushi.items[0].id]).size,3);
  rice.items[0].portion.amount=99;rice.items[0].ingredients[0].amount=999;rice.items[0].steps.push('記録側の変更');
  assert.deepEqual(data,source);
});

test('未確認の商品と栄養不明のマイメニューも記録でき、確認フラグを勝手に変えない',()=>{
  const unconfirmed=createCatalogEntry(input({recipeId:'unconfirmed',amount:100}),data);
  const item=unconfirmed.items[0];
  assert.equal(item.allergensKnown,false);assert.equal(item.ingredientsKnown,false);assert.equal(item.shoppingKnown,true);
  assert.equal(item.nature,'ready-to-eat');assert.equal(item.sourceNote,'商品ごとに表示を確認。');assert.deepEqual(item.allergens,['milk']);
  const diary=createCatalogEntry(input({recipeId:'custom-unknown',amount:1,status:'planned',note:undefined}),data);
  assert.deepEqual(diary.items[0].nutrition,unknown());assert.deepEqual(diary.items[0].ingredients,[]);
  assert.equal(diary.items[0].allergensKnown,false);assert.equal(diary.items[0].ingredientsKnown,false);assert.equal(diary.note,'');
});

test('メニュー登録時も日付・状態・量・メモを検査して保存形式の上限を守る',()=>{
  for(const changes of [{recipeId:'missing'},{recipeId:''},{recipeId:'constructor'},{date:'2026-02-30'},{date:'2101-01-01'},{meal:'brunch'},{status:'all'},{amount:0},{amount:-1},{amount:'150'},{amount:NaN},{amount:Infinity},{amount:100001},{note:null},{note:'あ'.repeat(2001)},{recipeId:'sushi',amount:2001},{extra:'unknown'}])assert.throws(()=>createCatalogEntry(input(changes),data));
  for(const value of [undefined,null,[]])assert.throws(()=>createCatalogEntry(value,data));
  const source=defaultJournal('2026-11-13');source.entries.push(createCatalogEntry(input(),data));
  assert.doesNotThrow(()=>validateJournal(source,data));
});

test('実際の公開DBから作った記録もv3の保存検査を通り、メニュー以外の内容を変えない',()=>{
  const builtin={allergens:ALLERGENS,ingredients:INGREDIENTS,recipes:RECIPES};
  const recipe=RECIPES.find(recipe=>recipe.id==='familiar-side-sticks-miso-mayo');
  assert.ok(recipe);
  const source=defaultJournal('2026-11-13');source.entries.push(createCatalogEntry(input({recipeId:recipe.id,amount:0.5}),builtin));
  const imported=validateJournal(source,builtin);
  assert.equal(imported.entries[0].items[0].quantity,0.5);assert.equal(imported.entries[0].items[0].portion.unit,'皿');
  assert.ok(imported.entries[0].items[0].allergens.includes('egg'));
});
