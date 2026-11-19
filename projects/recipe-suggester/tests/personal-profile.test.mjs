import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeNutritionReference, clearArchivedPersonalProfiles, clearPersonalProfile, defaultJournal,
  hasArchivedPersonalProfile, JOURNAL_BACKUP_KEY, JOURNAL_KEY, parseJournal, readJournalBackup,
  replaceJournal, setNutritionMode, validateJournal, writeJournal,
} from '../journal.js';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';
import {applyQuickSetup} from '../onboarding.js';
import {applyNutritionProfileForm, renderNutritionProfile, showProfileFields} from '../personal-profile-ui.js';

const data = {allergens: ALLERGENS, ingredients: INGREDIENTS, recipes: RECIPES};
const details = {age: 42, heightCm: 168.5, weightKg: 62.4, sex: 'female', activity: 'moderate'};
const simple = {ageBand: '65-74', sex: 'male', activity: 'low', mode: 'reference'};
const make = () => defaultJournal('2026-10-17');
const manual = () => ({...make().profile, mode: 'manual'});
const asPersonal = state => setNutritionMode(state, {mode: 'personal'}, details);
const roundTrip = state => parseJournal(JSON.stringify(state), data);
function memory() {
  const values = new Map();
  return {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)};
}

test('手入力値は個人の目安の使用中にも残り、削除すると元の値で再開する', () => {
  let state = make();
  const saved = {...state.targets, kcal: 1957, protein: 65.5};
  state.targets = {...saved};
  asPersonal(state);
  state = roundTrip(state);
  assert.deepEqual(state.personalProfile, details);
  assert.deepEqual(state.manualTargets, saved);
  assert.equal(state.targets.kcal, activeNutritionReference(state).targets.kcal);
  assert.notEqual(state.targets.kcal, saved.kcal);
  assert.equal(state.profile.previousMode, 'manual');
  clearPersonalProfile(state);
  assert.deepEqual(state.targets, saved);
  assert.equal(state.profile.mode, 'manual');
  assert.equal(activeNutritionReference(state), null);
  assert.ok(!('personalProfile' in roundTrip(state)));
  assert.ok(!('manualTargets' in state));
});

test('以前の年代設定と手入力の値は別々に保持し、無関係のかんたん設定でもモードを維持する', () => {
  const state = make();
  state.targets.kcal = 2207;
  setNutritionMode(state, simple);
  const before = {...state.targets};
  asPersonal(state);
  const draft = {allergens: new Set(), excluded: new Set(), omitCommon: null, profile: null};
  applyQuickSetup(state, draft, data);
  assert.equal(state.profile.mode, 'personal');
  assert.deepEqual(state.personalProfile, details);
  asPersonal(state);
  clearPersonalProfile(state);
  assert.deepEqual(state.profile, simple);
  assert.deepEqual(state.targets, before);
  setNutritionMode(state, manual());
  assert.equal(state.targets.kcal, 2207);
  asPersonal(state);
  applyQuickSetup(state, {...draft, profile: simple}, data);
  assert.deepEqual(state.profile, simple);
  assert.deepEqual(state.personalProfile, details);
  clearPersonalProfile(state);
  assert.deepEqual(state.targets, before);
});

test('旧版の年代設定はそのまま開け、詳細プロフィールの不整合は読み込み時に拒否する', () => {
  const legacy = make();
  legacy.profile = simple;
  legacy.targets = activeNutritionReference(legacy).targets;
  assert.deepEqual(roundTrip(legacy), legacy);
  const state = roundTrip(legacy);
  asPersonal(state);
  for (const corrupt of [
    value => { delete value.personalProfile; },
    value => { value.personalProfile.age = '42'; },
    value => { value.personalProfile.extra = true; },
    value => { value.targets.kcal++; },
    value => { value.profile.previousMode = 'personal'; },
    value => { value.personalProfile.activity = 'unset'; },
  ]) {
    const copy = structuredClone(state);
    corrupt(copy);
    assert.throws(() => validateJournal(copy, data));
  }
  clearPersonalProfile(state);
  assert.deepEqual(roundTrip(state), legacy);
});

test('端末内の自動退避に詳細項目を残さず、古い退避でも食事や手入力の比較値を保ったまま消去できる', () => {
  const storage = memory(), state = make();
  state.targets.kcal = 1889;
  state.entries.push({id: 'lunch-note', date: '2026-10-17', meal: 'lunch', status: 'eaten', note: '昼食', items: []});
  asPersonal(state);
  assert.equal(writeJournal(storage, state, data), true);
  assert.equal(replaceJournal(storage, make(), data), true);
  const backup = readJournalBackup(storage);
  const restore = parseJournal(backup.raw, data);
  assert.equal(restore.profile.mode, 'manual');
  assert.equal(restore.targets.kcal, 1889);
  assert.equal(restore.entries[0].note, '昼食');
  assert.ok(!('personalProfile' in restore));
  assert.equal(hasArchivedPersonalProfile(storage), false);
  storage.setItem(JOURNAL_BACKUP_KEY, JSON.stringify([backup, {...backup, raw: JSON.stringify(state)}]));
  assert.equal(hasArchivedPersonalProfile(storage), true);
  clearArchivedPersonalProfiles(storage);
  assert.equal(hasArchivedPersonalProfile(storage), false);
  assert.deepEqual(parseJournal(readJournalBackup(storage).raw, data), restore);
  assert.deepEqual(JSON.parse(storage.getItem(JOURNAL_KEY)), make());
});

test('表示切り替えは保存せず、詳細モードだけ同意と数値入力を求める', () => {
  const nodes = new Map(), get = id => {
    if (!nodes.has(id)) nodes.set(id, {});
    return nodes.get(id);
  };
  const state = make();
  renderNutritionProfile(get, state);
  assert.equal(get('profile-personal-fields').disabled, true);
  get('profile-mode').value = 'personal';
  showProfileFields(get);
  assert.equal(get('profile-simple-fields').disabled, true);
  assert.equal(get('profile-personal-fields').disabled, false);
  assert.equal(state.profile.mode, 'manual');
  assert.throws(() => applyNutritionProfileForm(get, state), /チェック/);
  get('personal-consent').checked = true;
  get('personal-age').valueAsNumber = details.age;
  get('personal-height').valueAsNumber = details.heightCm;
  get('personal-weight').valueAsNumber = details.weightKg;
  get('personal-activity').value = details.activity;
  get('personal-sex').value = details.sex;
  applyNutritionProfileForm(get, state);
  renderNutritionProfile(get, roundTrip(state));
  assert.equal(get('personal-height').value, details.heightCm);
  assert.match(get('profile-summary').textContent, /身長・体重を使った目安/);
  setNutritionMode(state, manual());
  clearPersonalProfile(state);
  renderNutritionProfile(get, state);
  assert.equal(get('personal-height').value, '');
  assert.equal(get('personal-consent').checked, false);
});
