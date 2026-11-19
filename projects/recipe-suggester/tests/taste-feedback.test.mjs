import test from 'node:test';
import assert from 'node:assert/strict';
import {inferTasteReport, readTasteCounts} from '../taste-feedback.js';

test('個人情報を除き、保存した献立と下書きの同じ一品を重ねて数えない', () => {
  const recipes = [{id:'a', genre:'洋食'}, {id:'b', genre:'中華'}];
  const journal = {
    birthDate:'1980-04-01', favourites:[{item:{recipeId:'a'}}, {genre:'和食',item:{}}, {genre:'和食',item:{}}],
    entries:[{date:'2026-05-05',meal:'dinner',status:'planned', items:[{recipeId:'a'}, {recipeId:'b'}]},
      {date:'2026-05-05',meal:'lunch',status:'eaten',items:[{recipeId:'a'}]}],
    draftPlan:{days:[{date:'2026-05-05', meal:'dinner',recipeIds:['a','b']},
      {date:'2026-05-06',meal:'dinner',recipeIds:['a','b'],omittedRecipeIds:['a']}]},
  };
  assert.deepEqual(inferTasteReport(journal, recipes), {favoriteGenre:'和食',planGenre:'中華'});
  assert.deepEqual(inferTasteReport({...journal, draftPlan:null}, recipes), {favoriteGenre:'和食',planGenre:'未共有'});
  assert.deepEqual(inferTasteReport(null, recipes), {favoriteGenre:'未共有',planGenre:'未共有'});
});

test('集計には個票を読まず各ジャンルの人数だけを照会し、5人に達した項目だけを返す', async () => {
  const calls=[];
  const sdk={collection:(_,path)=>path, where:(field,op,genre)=>({field,op,genre}), query:(_,filter)=>filter,
    getCountFromServer: async q => { calls.push(q); return {data:()=>({count:q.genre==='和食'?(q.field==='planGenre'?8:5):4})}; }};
  assert.deepEqual(await readTasteCounts({},sdk), [{label:'保存した献立',genre:'和食',count:8},{label:'お気に入りの料理',genre:'和食',count:5}]);
  assert.equal(calls.length,10);
  assert.ok(calls.every(q=>q.op==='=='));
});
