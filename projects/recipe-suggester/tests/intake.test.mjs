import test from 'node:test';
import assert from 'node:assert/strict';
import {analyseIntake,compareIntake} from '../intake.js';
const food=(kcal,protein=10)=>({quantity:1,nutrition:{kcal,protein,fat:2,carbs:40,fiber:3,salt:1}});
const entry=(date,items,status='eaten')=>({date,status,meal:'dinner',items});
test('最近の平均は完了日だけを使い、空白の日と予定を0扱いしない',()=>{
 const entries=[entry('2026-11-11',[food(600)]),entry('2026-11-12',[food(900)]),entry('2026-11-10',[food(2000)],'planned')];
 const result=analyseIntake(entries,{to:'2026-11-12',days:7,completedDays:['2026-11-11','2026-11-12']});
 assert.equal(result.completedCount,2);assert.equal(result.mean.kcal,750);assert.equal(result.totals.values.kcal,1500);
});
test('完了しても値が不明の成分はその日の平均から除き、既知の日数を返す',()=>{
 const result=analyseIntake([entry('2026-11-11',[food(600,null)]),entry('2026-11-12',[food(900,30)])],{to:'2026-11-12',days:7,completedDays:['2026-11-11','2026-11-12']});
 assert.equal(result.knownDays.protein,1);assert.equal(result.mean.protein,30);assert.equal(result.knownDays.kcal,2);
});
test('未完了しかなければ平均は不明のまま、重複完了日は1日だけ',()=>{
 assert.equal(analyseIntake([],{to:'2026-11-12',days:1}).mean.kcal,null);
 assert.equal(analyseIntake([],{to:'2026-11-12',days:1,completedDays:['2026-11-12','2026-11-12']}).completedCount,1);
});
test('食塩の未満・脂質の範囲・不明・単なるエネルギー差を区別する',()=>{
 const reference={ranges:{fat:{min:40,max:60}}};
 assert.equal(compareIntake('salt',6.5,{target:6.5,reference}).kind,'above');
 assert.equal(compareIntake('salt',6.4,{target:6.5,reference}).kind,'within');
 assert.equal(compareIntake('fat',40,{target:50,reference}).kind,'within');
 assert.equal(compareIntake('fat',61,{target:50,reference}).kind,'above');
 assert.equal(compareIntake('kcal',2000,{target:2000,reference}).kind,'comparison');
 assert.equal(compareIntake('protein',0,{target:65,reference,complete:false}).kind,'unknown');
});
