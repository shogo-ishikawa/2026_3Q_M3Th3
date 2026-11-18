import test from 'node:test';
import assert from 'node:assert/strict';
import {createJournalHistory, manualEditAffected} from '../journal-history.js';

const state = () => ({version:3, settings:{textSize:'standard',recordView:'detailed',allergens:['milk']}, entries:[{id:'meal',items:[{id:'toast',quantity:1,nutrition:{kcal:150,fiber:null},ingredients:[{id:'bread',amount:60}]}]}],completedDays:['2026-11-14'],customRecipes:[],pantry:[],favourites:[],mealSets:[],batches:[],purchaseSettings:[]});

test('量の変更と削除を順に戻し、保存時の材料・不明な栄養をそのまま復元する', () => {
  const history=createJournalHistory(),original=state(),changed=structuredClone(original);
  changed.entries[0].items[0].quantity=2;
  assert.equal(history.record(original,changed,'量を変更'),true);
  const deleted=structuredClone(changed);deleted.entries=[];deleted.completedDays=[];
  history.record(changed,deleted,'料理を削除');
  assert.deepEqual(history.undo(deleted),changed);
  assert.deepEqual(history.undo(changed),original);
  assert.equal(history.undo(original),null);
  assert.equal(original.entries[0].items[0].quantity,1);
});

test('表示設定の変更を履歴に数えず、取り消しても現在の文字・除外条件を維持する', () => {
  const history=createJournalHistory(),original=state(),display=structuredClone(original);
  display.settings.textSize='largest';display.settings.recordView='simple';display.settings.allergens=['egg'];
  assert.equal(history.record(original,display),false);
  const deleted=structuredClone(original);deleted.entries=[];
  history.record(original,deleted);
  deleted.settings=display.settings;
  const result=history.undo(deleted);
  assert.deepEqual(result.entries,original.entries);
  assert.deepEqual(result.settings,display.settings);
});

test('履歴は独立した上限付きのコピーで、取り消し対象を消して再利用できる', () => {
  const history=createJournalHistory({limit:2}),one=state(),two=state(),three=state(),four=state();
  two.entries[0].items[0].quantity=2;three.entries[0].items[0].quantity=3;four.entries[0].items[0].quantity=4;
  history.record(one,two,'1');history.record(two,three,'2');history.record(three,four,'3');
  two.entries=[];three.entries=[];
  assert.equal(history.size,2);assert.equal(history.label,'3');
  const restored=history.undo(four);assert.equal(restored.entries[0].items[0].quantity,3);
  assert.equal(history.undo(restored).entries[0].items[0].quantity,2);
  assert.equal(history.size,0);
  history.record(one,four);history.clear();assert.equal(history.size,0);
  for(const limit of [0,-1,1.5,31])assert.throws(()=>createJournalHistory({limit}));
});

test('取り消し内容の検証に失敗しても履歴を消費せず、後で再試行できる', () => {
  const history=createJournalHistory(),before=state(),after=state();after.entries=[];
  history.record(before,after);
  assert.throws(()=>history.undo(after,{validate:()=>{throw Error('選択先を確認');}}),/選択先/);
  assert.equal(history.size,1);assert.deepEqual(after.entries,[]);
  assert.deepEqual(history.undo(after,{validate:next=>next}),before);
  assert.equal(history.size,0);
});

test('お気に入り追加後に作った別の献立や買い物一覧を取り消しで巻き戻さない', () => {
  const before = state(), after = structuredClone(before), history = createJournalHistory();
  after.favourites = [{id: 'favourite'}];
  history.record(before, after, 'お気に入りに保存', {invalidatePlan: false});
  after.shoppingCatalog = [{id: 'new-plan', item: {id: 'salad'}}];
  after.shoppingList = [{id: 'salad', ingredientIds: ['cabbage']}];
  const removed = {...after, shoppingList: null};
  history.record(after, removed, '今回の買い物リストから外しました', {invalidatePlan: false});
  assert.equal(history.invalidatesPlan, false);
  const restored = history.undo(removed);
  assert.deepEqual(restored, after);
  assert.equal(history.invalidatesPlan, false);
  const unfavourited = history.undo(restored);
  assert.deepEqual(unfavourited, {...after, favourites: []});
});

test('取り消す操作に応じて献立の再作成が必要かを記憶し、失敗時にも保持する', () => {
  const before = state(), after = {...before, entries: []}, history = createJournalHistory();
  history.record(before, after);
  const purchased = {...after, shoppingReceipts: [{id: 'rice'}]};
  history.record(after, purchased, '購入済み', {invalidatePlan: false});
  assert.equal(history.invalidatesPlan, false);
  assert.throws(() => history.undo(purchased, {validate: () => { throw Error('invalid'); }}));
  assert.equal(history.invalidatesPlan, false);
  assert.deepEqual(history.undo(purchased), after);
  assert.equal(history.invalidatesPlan, true);
  assert.deepEqual(history.undo(after), before);
});

test('手入力は編集中の料理かその食事情報が変わったときだけ解除する', () => {
  const before = state(), after = structuredClone(before), editing = {entryId: 'meal', itemId: 'toast'};
  after.entries[0].items.push({id: 'unrelated'});
  assert.equal(manualEditAffected(before, after, null), false);
  assert.equal(manualEditAffected(before, after, editing), false);
  after.entries[0].items[0].quantity = 2;
  assert.equal(manualEditAffected(before, after, editing), true);
  after.entries[0].items[0].quantity = 1; after.entries[0].note = 'メモ';
  assert.equal(manualEditAffected(before, after, editing), true);
  after.entries = [];
  assert.equal(manualEditAffected(before, after, editing), true);
});
