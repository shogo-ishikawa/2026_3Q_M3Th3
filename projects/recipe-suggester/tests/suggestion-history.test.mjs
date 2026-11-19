import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {defaultJournal, parseJournal, readJournal, readJournalBackup, rememberSuggestionDays,
  replaceJournal, shiftDate, validateJournal, writeJournal} from '../journal.js';
import {resetEntriesRange} from '../record-actions.js';

const data = {recipes: RECIPES, ingredients: INGREDIENTS, allergens: ALLERGENS};
const first = '2026-06-01';
const second = '2026-06-02';

test('同日内の複数の食事と再提案をまとめ、重なる週を作り直しても二重に記録しない', () => {
  const plan = {days: [
    {date: first, recipeIds: ['a', 'b']},
    {date: first, recipeIds: ['a', 'c', 'excluded'], omittedRecipeIds: ['excluded']},
    {date: second, recipeIds: ['a']},
  ]};
  const previous = rememberSuggestionDays(undefined, plan);
  assert.deepEqual(previous, [{date: first, recipeIds: ['a', 'b', 'c']}, {date: second, recipeIds: ['a']}]);
  const after = rememberSuggestionDays(previous, {days: [
    {date: second, recipeIds: ['a', 'd']}, ...plan.days,
    {date: '2026-06-03', recipeIds: ['off'], omittedRecipeIds: ['off']},
  ]});
  assert.deepEqual(after, [previous[0], {date: second, recipeIds: ['a', 'd']}]);
  assert.deepEqual(previous[1].recipeIds, ['a']);
  assert.deepEqual(rememberSuggestionDays(after, plan), after);
});

test('保存・再起動とJSON復元で提案日を保ち、旧形式の日付を作り出さない', () => {
  const journal = {...defaultJournal(first), suggestedRecipeIds: ['legacy']};
  const dated = {...journal, suggestionHistory: [{date: second, recipeIds: ['former-recipe']}, {date: first, recipeIds: ['a']}]};
  const expected = [...dated.suggestionHistory].reverse();
  const values = new Map();
  const storage = {getItem: key => values.get(key) ?? null, setItem: (key, raw) => values.set(key, raw)};
  assert.ok(writeJournal(storage, dated, data));
  const loaded = readJournal(storage, data).state;
  assert.deepEqual(loaded.suggestionHistory, expected);
  assert.deepEqual(resetEntriesRange(loaded, {from: first, to: second, status: 'all'}).suggestionHistory, expected);
  assert.ok(replaceJournal(storage, journal, data));
  const legacy = readJournal(storage, data).state;
  assert.deepEqual(legacy.suggestedRecipeIds, ['legacy']);
  assert.equal(legacy.suggestionHistory, undefined);
  const backup = parseJournal(readJournalBackup(storage).raw, data);
  assert.ok(replaceJournal(storage, backup, data));
  assert.deepEqual(readJournal(storage, data).state.suggestionHistory, expected);
});

test('履歴を日付・一日・全体で上限内に収め、新しい日付の提案を優先する', () => {
  const days = Array.from({length: 100}, (_, i) => ({date: shiftDate(first, i), recipeIds: ['a']}));
  const countLimited = rememberSuggestionDays(undefined, {days});
  assert.deepEqual(countLimited, days.slice(-90));
  const busyDays = days.map(day => ({...day, recipeIds: Array.from({length: 130}, (_, i) => 'dish-' + i)}));
  const recent = rememberSuggestionDays([], {days: busyDays});
  assert.equal(recent.at(-1).date, days.at(-1).date);
  assert.equal(recent.reduce((count, day) => count + day.recipeIds.length, 0), 2048);
  assert.deepEqual(recent[0].recipeIds, busyDays[0].recipeIds.slice(-128));
  assert.deepEqual(validateJournal({...defaultJournal(first), suggestionHistory: recent}, data).suggestionHistory, recent);
});

test('不正日付・識別子・重複・上限超過を含む日付別の提案履歴を読み込まない', () => {
  const day = {date: first, recipeIds: ['a']};
  for (const value of [null, [day, day], [{...day, date: '2026-02-31'}], [{...day, raw: 'unexpected'}],
    [{...day, recipeIds: []}], [{...day, recipeIds: ['a', 'a']}], [{...day, recipeIds: [null]}],
    [{...day, recipeIds: Array.from({length: 129}, (_, i) => 'dish-' + i)}]]) {
    assert.throws(() => validateJournal({...defaultJournal(first), suggestionHistory: value}, data));
  }
});
