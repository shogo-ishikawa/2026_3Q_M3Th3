import test from 'node:test';
import assert from 'node:assert/strict';
import {MENU_INTERESTS, menuProposals, readMenuProposalCounts} from '../menu-feedback.js';

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
    where(field, operator, value) {
      assert.equal(field, 'interest');
      assert.equal(operator, '==');
      return value;
    },
    query(collection, value) { return {collection, value}; },
    async getCountFromServer(query) {
      queries.push(query.value);
      return {data: () => ({count: query.value === 'seafood' ? 10 : 0})};
    },
  };
  const counts = await readMenuProposalCounts(db, sdk);
  assert.deepEqual(queries.sort(), MENU_INTERESTS.map(topic => topic.id).sort());
  assert.equal(counts.seafood, 10);
  assert.equal(menuProposals(counts, [])[0].topic, '魚介のおかず');
});
