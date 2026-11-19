import test from 'node:test';
import assert from 'node:assert/strict';
import {MENU_INTERESTS, menuProposals, readMenuProposalCounts, readMenuVotes, updateMenuVote} from '../menu-feedback.js';

test('投票した人が5人に達したテーマだけを希望の多い順に提案する', () => {
  const result = menuProposals({regional: 4, breakfast: 5, noodles: 8, world: '20', secret: 30}, []);
  assert.deepEqual(result, [
    {topic: '麺料理', dish: 'かぼちゃのほうとう', count: 8},
    {topic: '朝ごはん', dish: 'りんごのオーバーナイトオーツ', count: 5},
  ]);
  assert.deepEqual(menuProposals({}), []);
});

test('公開メニューに採用した候補は読みや添え書きが違っても外し、候補が尽きれば掲載しない', () => {
  const recipes = [{name: '冬野菜と牛肉のいも煮（2人分）'}];
  assert.equal(menuProposals({regional: 6}, recipes)[0].dish, '鶏と根菜のせんべい汁');
  recipes.push({name: '南部の煎餅汁'});
  assert.deepEqual(menuProposals({regional: 6}, recipes), []);
});

test('管理者向けの問い合わせはテーマごとの件数だけをサーバーから受け取る', async () => {
  const db = {};
  const queries = [];
  const sdk = {
    collection(actual, name) {
      assert.equal(actual, db);
      assert.equal(name, 'mealPaletteMenuVotes');
      return name;
    },
    where: (field, op, value) => ({field, op, value}),
    or: (...filters) => filters,
    query: (collection, filters) => ({collection, filters}),
    async getCountFromServer({filters}) {
      const [{value}] = filters;
      assert.deepEqual(filters, [{field:'interest', op:'==', value}, {field:'interests', op:'array-contains', value}]);
      queries.push(value);
      return {data: () => ({count: value === 'seafood' ? 10 : 0})};
    },
  };
  const counts = await readMenuProposalCounts(db, sdk);
  assert.deepEqual(queries.sort(), MENU_INTERESTS.map(topic => topic.id).sort());
  assert.equal(counts.seafood, 10);
  assert.equal(menuProposals(counts, [])[0].topic, '魚介のおかず');
});

test('既存の希望と別の端末の送信を保ち、同じテーマを重複させずに1件ずつ追加・変更・取り消しする', async () => {
  let document = {interest: 'seafood'};
  const db = {};
  let writes = 0;
  const sdk = {
    doc: (db, collection, uid) => collection + '/' + uid,
    runTransaction: (db, action) => action({
      get: async ref => {
        assert.equal(ref, 'mealPaletteMenuVotes/member');
        return {exists: () => !!document, data: () => document};
      },
      set: (ref, data) => { writes++; document = data; },
      delete: () => { writes++; document = undefined; },
    }),
  };
  const update = (from, to) => updateMenuVote(db, sdk, 'member', from, to);
  assert.deepEqual(readMenuVotes(document), ['seafood']);
  assert.deepEqual(await update('', 'world'), {status:'saved', topics:['seafood', 'world']});
  assert.deepEqual(document, {interests:['seafood', 'world']});
  await update('', 'regional');
  await update('seafood', 'breakfast');
  assert.deepEqual(document, {interests:['regional', 'breakfast', 'world']});
  assert.equal((await update('seafood', 'noodles')).status, 'missing');
  assert.equal((await update('world', 'regional')).status, 'duplicate');
  assert.equal((await update('', 'regional')).status, 'duplicate');
  assert.equal(writes, 3);
  await update('world', '');
  await update('regional', '');
  assert.deepEqual(document, {interests:['breakfast']});
  await update('breakfast', '');
  assert.equal(document, undefined);
  assert.equal((await update('breakfast', '')).status, 'missing');
  await update('', 'seafood');
  assert.deepEqual(document, {interest:'seafood'});
  for (const params of [['', 'free text'], ['seafood', 'seafood'], [null, 'world'], ['', '']]) {
    assert.throws(() => update(...params));
  }
});

test('不正な保存形式は有効な希望として扱わない', () => {
  assert.deepEqual(readMenuVotes(undefined), []);
  for (const invalid of [null, {other:'fish'}, {interest:'free'}, {interests:[]}, {interests:['world','world']},
    {interest:'regional', interests:['world']}, {interests:['world','name']}, {interests:'world'}]) {
    assert.throws(() => readMenuVotes(invalid));
  }
});
