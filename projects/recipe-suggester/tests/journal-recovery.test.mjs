import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {STORAGE_KEY, defaultState} from '../storage.js';
import {itemFromRecipe} from '../nutrition.js';
import {JOURNAL_KEY, PREVIOUS_JOURNAL_KEY, JOURNAL_BACKUP_KEY, JOURNAL_EXPORT_KEY,
  defaultJournal, parseJournal, readJournal, writeJournal, replaceJournal,
  readJournalBackup, readJournalBackups, markJournalExport, readJournalExportTime} from '../journal.js';

const data = {allergens: ALLERGENS, ingredients: INGREDIENTS, recipes: RECIPES};
const day = '2026-11-14';
const state = () => {
  const value = defaultJournal(day);
  value.entries = [{id:'breakfast', date:day, meal:'breakfast', status:'eaten', note:'量を調整した記録',
    items:[itemFromRecipe(RECIPES.find(recipe => recipe.id === 'plain-rice'), data, 1.25)]}];
  return value;
};
function memoryStorage(pairs = [], failKeys = []) {
  const memory = new Map(pairs), writes = [], blocked = new Set(failKeys);
  return {memory, writes, blocked, getItem:key => memory.get(key) ?? null,
    setItem(key, raw) {writes.push(key); if (blocked.has(key)) throw Error('quota'); memory.set(key, raw);}};
}

test('current and both legacy unreadable sources remain recoverable after ordinary setting saves', () => {
  for (const key of [JOURNAL_KEY, PREVIOUS_JOURNAL_KEY, STORAGE_KEY]) {
    for (const raw of ['{broken original', JSON.stringify({version:999, note:'unknown format'})]) {
      const storage = memoryStorage([[key, raw]]);
      const loaded = readJournal(storage, data, day);
      assert.deepEqual(loaded.recovery, {key, raw});
      assert.match(loaded.message, /元の保存データ/);
      loaded.state.settings.textSize = 'large';
      loaded.state.settings.recordView = 'simple';
      assert.equal(writeJournal(storage, loaded.state, data), false);
      assert.equal(storage.memory.get(key), raw);
      assert.deepEqual(storage.writes, []);
      if (key !== JOURNAL_KEY) assert.equal(storage.memory.has(JOURNAL_KEY), false);
      assert.deepEqual(readJournal(storage, data, day).recovery, {key, raw});
    }
  }
});

test('a valid current journal keeps ignored legacy raw data and saves normal changes', () => {
  const source = state(), storage = memoryStorage([[JOURNAL_KEY, JSON.stringify(source)], [STORAGE_KEY, '{old broken']]);
  const loaded = readJournal(storage, data, day);
  assert.equal(loaded.recovery, null);
  loaded.state.settings.recordView = 'simple';
  assert.equal(writeJournal(storage, loaded.state, data), true);
  assert.equal(storage.memory.get(STORAGE_KEY), '{old broken');
  assert.deepEqual(readJournal(storage, data, day).state.entries, source.entries);
});

test('explicit replacement archives the exact original before replacing the journal', () => {
  const raw = '{raw original \u65e5\u672c\u8a9e', storage = memoryStorage([[JOURNAL_KEY, raw]]), next = state();
  assert.equal(replaceJournal(storage, next, data), true);
  assert.deepEqual(storage.writes, [JOURNAL_BACKUP_KEY, JOURNAL_KEY]);
  const backup = readJournalBackup(storage);
  assert.equal(backup.key, JOURNAL_KEY); assert.equal(backup.raw, raw);
  assert.equal(new Date(backup.savedAt).toISOString(), backup.savedAt);
  assert.deepEqual(readJournal(storage, data, day).state, next);
  assert.equal(readJournal(storage, data, day).recovery, null);
});

test('explicit replacement also archives an unreadable selected legacy source without deleting it', () => {
  for (const key of [PREVIOUS_JOURNAL_KEY, STORAGE_KEY]) {
    const raw = '{legacy original', storage = memoryStorage([[key, raw]]);
    assert.equal(replaceJournal(storage, state(), data), true);
    assert.equal(storage.memory.get(key), raw);
    assert.equal(readJournalBackup(storage).raw, raw);
    assert.equal(readJournalBackup(storage).key, key);
    assert.deepEqual(storage.writes, [JOURNAL_BACKUP_KEY, JOURNAL_KEY]);
  }
});

test('a backup quota failure prevents every canonical write and retains the original', () => {
  const raw = '{cannot lose this', storage = memoryStorage([[JOURNAL_KEY, raw]], [JOURNAL_BACKUP_KEY]);
  assert.equal(replaceJournal(storage, state(), data), false);
  assert.equal(storage.memory.get(JOURNAL_KEY), raw);
  assert.deepEqual(storage.writes, [JOURNAL_BACKUP_KEY]);
  assert.equal(readJournalBackup(storage), null);
});

test('a canonical write failure retains both the original and its recoverable archive', () => {
  const raw = '{still original', storage = memoryStorage([[JOURNAL_KEY, raw]], [JOURNAL_KEY]);
  assert.equal(replaceJournal(storage, state(), data), false);
  assert.equal(storage.memory.get(JOURNAL_KEY), raw);
  assert.deepEqual(storage.writes, [JOURNAL_BACKUP_KEY, JOURNAL_KEY]);
  assert.equal(readJournalBackup(storage).raw, raw);
  assert.deepEqual(readJournal(storage, data, day).recovery, {key:JOURNAL_KEY, raw});
});

test('invalid replacement input throws before any archive or canonical write', () => {
  const raw = '{original', storage = memoryStorage([[JOURNAL_KEY, raw]]), next = state();
  next.settings.recordView = 'invalid';
  assert.throws(() => replaceJournal(storage, next, data), /記録の表示方法/);
  assert.equal(storage.memory.get(JOURNAL_KEY), raw);
  assert.deepEqual(storage.writes, []);
});

test('unreadable backup metadata is preserved and blocks a new replacement', () => {
  const raw = JSON.stringify(state()), archive = '{corrupt backup metadata';
  const storage = memoryStorage([[JOURNAL_KEY, raw], [JOURNAL_BACKUP_KEY, archive]]);
  assert.equal(replaceJournal(storage, defaultJournal(day), data), false);
  assert.equal(storage.memory.get(JOURNAL_KEY), raw);
  assert.equal(storage.memory.get(JOURNAL_BACKUP_KEY), archive);
  assert.deepEqual(storage.writes, []);
});

test('subsequent replacements preserve older distinct backups and can restore a valid one', () => {
  const original = state(), raw = JSON.stringify(original), storage = memoryStorage([[JOURNAL_KEY, raw]]);
  const second = state(); second.entries[0].note = 'second';
  assert.equal(replaceJournal(storage, second, data), true);
  const firstBackup = readJournalBackup(storage);
  const secondRaw = storage.memory.get(JOURNAL_KEY);
  assert.equal(replaceJournal(storage, defaultJournal(day), data), true);
  assert.deepEqual(readJournalBackups(storage).map(backup => backup.raw), [raw, secondRaw]);
  assert.deepEqual(parseJournal(secondRaw, data), second);
  assert.equal(replaceJournal(storage, parseJournal(firstBackup.raw, data), data), true);
  assert.deepEqual(readJournal(storage, data, day).state, original);
  assert.equal(readJournalBackups(storage).length, 3);
  assert.equal(readJournalBackups(storage)[0].raw, raw);
});

test('the last export operation is separate metadata and does not alter saved meals or settings', () => {
  const raw = JSON.stringify(state()), storage = memoryStorage([[JOURNAL_KEY, raw]]), at = '2026-11-14T05:30:00.000Z';
  assert.equal(readJournalExportTime(storage), null);
  assert.equal(markJournalExport(storage, at), true);
  assert.equal(readJournalExportTime(storage), at);
  assert.equal(storage.memory.get(JOURNAL_KEY), raw);
  assert.deepEqual(storage.writes, [JOURNAL_EXPORT_KEY]);
  for (const invalid of ['yesterday', '2026-11-14', null, 0, '2026-02-30T00:00:00.000Z']) {
    assert.equal(markJournalExport(storage, invalid), false);
    assert.equal(readJournalExportTime(storage), at);
  }
});

test('metadata read/write failures are contained and never modify the journal', () => {
  const raw = JSON.stringify(state()), storage = memoryStorage([[JOURNAL_KEY, raw]], [JOURNAL_EXPORT_KEY]);
  assert.equal(markJournalExport(storage), false);
  assert.equal(storage.memory.get(JOURNAL_KEY), raw);
  const blocked = {getItem() {throw Error('blocked');}, setItem() {throw Error('blocked');}};
  assert.equal(readJournal(blocked, data, day).recovery, null);
  assert.equal(writeJournal(blocked, state(), data), false);
  assert.equal(replaceJournal(blocked, state(), data), false);
  assert.equal(readJournalBackup(blocked), null);
  assert.equal(readJournalExportTime(blocked), null);
});

test('simple and detailed record views round-trip without changing historical snapshots', () => {
  const source = state(), before = structuredClone(source);
  for (const recordView of ['simple', 'detailed']) {
    const expected = {...source, settings:{...source.settings, recordView}}, storage = memoryStorage();
    assert.equal(writeJournal(storage, expected, data), true);
    assert.deepEqual(readJournal(storage, data, day).state, expected);
    assert.deepEqual(parseJournal(JSON.stringify(expected), data).entries, before.entries);
  }
  assert.deepEqual(source, before);
});

test('old v1/v2/v3 data defaults to detailed view and preserves old source data', () => {
  const legacy1 = defaultState(day), legacy2 = {...defaultJournal(day), version:2};
  for (const key of ['profile', 'completedDays', 'mealSets', 'purchaseSettings', 'batches', 'favourites']) delete legacy2[key];
  for (const key of ['stapleAmount', 'drinkAmount', 'stapleMode', 'hideRecipeIllustrations', 'textSize', 'recordView']) delete legacy2.settings[key];
  const legacy3 = state(); delete legacy3.settings.recordView;
  for (const source of [legacy1, legacy2, legacy3]) {
    const raw = JSON.stringify(source), migrated = parseJournal(raw, data);
    assert.equal(migrated.settings.recordView, 'detailed');
    assert.equal(migrated.version, 3);
    if (source.version === 3) assert.deepEqual(migrated.entries, source.entries);
    assert.equal(JSON.stringify(source), raw);
  }
});

test('unsupported record view settings are rejected before storage changes', () => {
  for (const recordView of [null, true, 0, '', 'compact', [], {}]) {
    const source = state(); source.settings.recordView = recordView;
    const storage = memoryStorage();
    assert.throws(() => writeJournal(storage, source, data), /記録の表示方法/);
    assert.deepEqual(storage.writes, []);
  }
});
