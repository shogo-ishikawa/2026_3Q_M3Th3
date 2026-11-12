import test from 'node:test';
import assert from 'node:assert/strict';
import {shoppingForEntries} from '../shopping.js';

const data={ingredients:{
  rice:{name:'ご飯',unit:'g'}, milk:{name:'牛乳',unit:'ml'}, egg:{name:'卵',unit:'個'}, salt:{name:'塩',unit:'g'},
}};
const item=(name,ingredients,quantity=1,ingredientsKnown=true)=>({id:name,recipeId:null,name,ingredients,quantity,ingredientsKnown});
const entry=(id,date,status,items)=>({id,date,meal:'dinner',status,items});
const options={from:'2026-11-10',to:'2026-11-11',servings:2};

test('複数日の必要量を合計してから在庫を一度だけ引く',()=>{
  const entries=[
    entry('one','2026-11-10','planned',[item('1日目',[{id:'rice',amount:100},{id:'egg',amount:0.5}])]),
    entry('two','2026-11-11','planned',[item('2日目',[{id:'rice',amount:50}],2)]),
  ];
  const result=shoppingForEntries(entries,data,{...options,pantry:[{id:'rice',amount:150},{id:'egg',amount:3}]});
  const byId=Object.fromEntries(result.items.map(x=>[x.id,x]));
  assert.deepEqual(byId.rice,{id:'rice',name:'ご飯',unit:'g',required:400,stock:150,buy:250});
  assert.deepEqual(byId.egg,{id:'egg',name:'卵',unit:'個',required:1,stock:3,buy:0});
  assert.equal(result.entryCount,2);
  assert.deepEqual(result.missingMenus,[]);
});

test('実食と期間外の予定を除き主食・飲料・調味料の単位を保つ',()=>{
  const entries=[
    entry('before','2026-11-09','planned',[item('対象外',[{id:'rice',amount:999}])]),
    entry('first','2026-11-10','planned',[item('主食',[{id:'rice',amount:75}]),item('飲料',[{id:'milk',amount:200}],0.5)]),
    entry('last','2026-11-11','planned',[item('調味料',[{id:'salt',amount:1.25}])]),
    entry('eaten','2026-11-10','eaten',[item('食べた',[{id:'rice',amount:999}])]),
    entry('after','2026-11-12','planned',[item('対象外',[{id:'rice',amount:999}])]),
  ];
  const result=shoppingForEntries(entries,data,{...options,servings:3});
  const byId=Object.fromEntries(result.items.map(x=>[x.id,x]));
  assert.equal(byId.rice.required,225);
  assert.equal(byId.milk.required,300);
  assert.equal(byId.milk.unit,'ml');
  assert.equal(byId.salt.required,3.75);
  assert.equal(byId.salt.unit,'g');
  assert.equal(result.entryCount,2);
});

test('手入力で材料不明の料理は買い物不要とせず未集計として返す',()=>{
  const entries=[entry('manual','2026-11-10','planned',[
    item('材料不明',[],1,false),
    item('空欄',[],1,true),
    item('確認済み',[{id:'rice',amount:50}]),
  ])];
  const result=shoppingForEntries(entries,data,options);
  assert.equal(result.items.length,1);
  assert.equal(result.items[0].buy,100);
  assert.deepEqual(result.missingMenus,[{name:'材料不明',entryId:'manual'},{name:'空欄',entryId:'manual'}]);
});

test('買い物用の人数変更は予定スナップショットや在庫を書き換えない',()=>{
  const entries=[entry('one','2026-11-10','planned',[item('主食',[{id:'rice',amount:80}],1.5)])];
  const pantry=[{id:'rice',amount:30}];
  const before=structuredClone({entries,pantry});
  assert.equal(shoppingForEntries(entries,data,{...options,servings:1,pantry}).items[0].buy,90);
  assert.equal(shoppingForEntries(entries,data,{...options,servings:4,pantry}).items[0].buy,450);
  assert.deepEqual({entries,pantry},before);
});

test('過去の材料IDがDBから削除されても分かる材料を集計し不足情報を知らせる',()=>{
  const unknown=[entry('bad','2026-11-10','planned',[item('不明ID',[{id:'not-in-table',amount:10}])])];
  const result=shoppingForEntries(unknown,data,options);
  assert.deepEqual(result.items,[]);
  assert.deepEqual(result.missingMenus,[{name:'不明ID',entryId:'bad'}]);
  const mixed=[entry('mixed','2026-11-10','planned',[item('一部不明',[{id:'not-in-table',amount:10},{id:'rice',amount:50},{id:'also-removed',amount:30}])])];
  const partial=shoppingForEntries(mixed,data,options);
  assert.equal(partial.items[0].buy,100);
  assert.deepEqual(partial.missingMenus,[{name:'一部不明',entryId:'mixed'}]);
});

test('分量や在庫が不正な場合に計算を黙って続けない',()=>{
  for(const amount of [-1,NaN,Infinity,'10']) assert.throws(()=>shoppingForEntries([],data,{...options,pantry:[{id:'rice',amount}]}));
  assert.throws(()=>shoppingForEntries([],data,{...options,pantry:[{id:'constructor',amount:1}]}));
  assert.throws(()=>shoppingForEntries([],data,{...options,pantry:[{id:'rice',amount:1},{id:'rice',amount:2}]}));
  assert.throws(()=>shoppingForEntries([],data,{...options,servings:0}));
  assert.throws(()=>shoppingForEntries([],data,{...options,servings:1.5}));
  assert.throws(()=>shoppingForEntries([entry('bad','2026-11-10','planned',[item('不正な分量',[{id:'rice',amount:0}])])],data,options));
});

test('存在しない日付や逆転した期間の買い物計算を拒否する',()=>{
  for(const from of ['2026-02-30','2026-11-99','2026-11','not-a-date','1999-12-31']) assert.throws(()=>shoppingForEntries([],data,{...options,from}));
  assert.throws(()=>shoppingForEntries([],data,{...options,from:'2026-11-12'}));
});
