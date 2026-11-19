import test from 'node:test';
import assert from 'node:assert/strict';
import {ageOnDate, derivePersonalNutrition, isBirthdayOnDate, jstDateKey} from '../personal-nutrition.js';
import {clearArchivedBirthDates, clearBirthDate, clearPersonalProfile, defaultJournal, hasArchivedBirthDate,
  JOURNAL_BACKUP_KEY, JOURNAL_KEY, parseJournal, readJournalBackup, replaceJournal, setBirthDate,
  setNutritionMode, validateJournal, writeJournal} from '../journal.js';
import {applyNutritionProfileForm, renderNutritionProfile, watchJapanDate} from '../personal-profile-ui.js';
import {generateCalendarPlan, toggleDish} from '../planner.js';
import {capturePlan, draftDishKey, restorePlan} from '../saved-plan.js';
import {UNAVAILABLE_OCCASION_REASON} from '../planner-personalization.js';
import {ALLERGENS, INGREDIENTS, RECIPES} from '../data.js';

const data = {allergens: ALLERGENS, ingredients: INGREDIENTS, recipes: RECIPES};
const body = {heightCm: 168, weightKg: 62, sex: 'male', activity: 'moderate'};
const today = jstDateKey();
const year = Number(today.slice(0, 4));
const start = () => defaultJournal('2026-10-17');
const manualTargets = {...start().targets, kcal: 1899};
const memory = () => {
  const values = new Map();
  return {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)};
};
const stubFields = () => {
  const fields = new Map();
  return id => { if (!fields.has(id)) fields.set(id, {}); return fields.get(id); };
};

test('日本の日付が切り替わる瞬間に年齢が増え、誕生日の判定も同じ日付を使う', () => {
  const birth = '1980-12-31';
  const before = jstDateKey(new Date('2026-12-30T14:59:59.999Z'));
  const after = jstDateKey(new Date('2026-12-30T15:00:00.000Z'));
  assert.equal(before, '2026-12-30');
  assert.equal(after, '2026-12-31');
  assert.equal(ageOnDate(birth, before), 45);
  assert.equal(ageOnDate(birth, after), 46);
  assert.equal(isBirthdayOnDate(birth, before), false);
  assert.equal(isBirthdayOnDate(birth, after), true);
  assert.equal(isBirthdayOnDate('2026-12-31', after), true);
});

test('2月29日は平年の3月1日に祝い、うるう年には2月29日に祝う。不正日・未来日は使わない', () => {
  for (const [date, age, birthday] of [
    ['2026-02-28', 25, false], ['2026-03-01', 26, true], ['2028-02-29', 28, true], ['2028-03-01', 28, false],
    ['2100-02-28', 99, false], ['2100-03-01', 100, true],
  ]) {
    assert.equal(ageOnDate('2000-02-29', date), age);
    assert.equal(isBirthdayOnDate('2000-02-29', date), birthday);
  }
  for (const date of [null, 123, '1980-2-3', '2001-02-29', '2000-04-31', '1900-02-29', '2026-03-02']) {
    assert.equal(ageOnDate(date, '2026-03-01'), null);
    assert.equal(isBirthdayOnDate(date, '2026-03-01'), false);
  }
});

test('詳細プロフィールを登録しない場合も、生年月日だけを任意で登録・削除できる', () => {
  const state = start();
  const date = (year - 8) + '-01-01';
  const targets = {...state.targets};
  setBirthDate(state, date);
  const saved = parseJournal(JSON.stringify(state), data);
  assert.equal(saved.birthDate, date);
  assert.equal(saved.personalProfile, undefined);
  assert.deepEqual(saved.targets, targets);
  assert.throws(() => setBirthDate(saved, (year + 1) + '-02-01'));
  assert.throws(() => validateJournal({...saved, birthDate: null}, data));
  clearBirthDate(saved);
  assert.equal(saved.birthDate, undefined);
  assert.equal(saved.draftPlan, undefined);
  assert.deepEqual(validateJournal(saved, data), start());
});

test('旧版の数値年齢を自動更新に切り替え、以前の年齢で保存した比較値は開いた日の年齢で再計算する', () => {
  const state = start();
  state.targets = {...manualTargets};
  setNutritionMode(state, {mode: 'personal'}, {...body, age: 57});
  setBirthDate(state, (year - 65) + '-01-01', (year - 1) + '-12-31');
  assert.equal(state.draftPlan, undefined);
  assert.deepEqual(state.personalProfile, {...body, ageSource: 'birthDate'});
  assert.deepEqual(state.targets, derivePersonalNutrition({...body, age: 64}).targets);
  const reopened = validateJournal(state, data);
  assert.deepEqual(reopened.targets, derivePersonalNutrition({...body, age: 65}).targets);
  assert.deepEqual(reopened.manualTargets, manualTargets);
  assert.throws(() => validateJournal({...state, personalProfile: {...state.personalProfile, age: 65}}, data));
  assert.throws(() => validateJournal({...state, personalProfile: {...state.personalProfile, heightCm: '168'}}, data));
  clearPersonalProfile(reopened);
  assert.equal(reopened.birthDate, state.birthDate);
});

test('75歳で高活動量の設定・80歳で推定の対象外になっても、記録と身体情報を保持し以前の比較値で開く', () => {
  for (const [turns, activity, previousMode] of [[75, 'high', 'manual'], [80, 'moderate', 'reference']]) {
    const state = start();
    state.entries = [{id: 'lunch', date: '2026-10-17', meal: 'lunch', status: 'eaten', note: 'いつもの昼食', items: []}];
    state.targets = {...manualTargets};
    if (previousMode === 'reference') setNutritionMode(state, {mode: 'reference', ageBand: '75-plus', sex: 'male', activity: 'low'});
    const originalTargets = {...state.targets};
    setNutritionMode(state, {mode: 'personal'}, {...body, activity, age: turns - 1});
    setBirthDate(state, (year - turns) + '-01-01', (year - 1) + '-12-31');
    const reopened = parseJournal(JSON.stringify(state), data);
    assert.equal(reopened.profile.mode, previousMode);
    assert.equal(reopened.birthDate, state.birthDate);
    assert.deepEqual(reopened.targets, originalTargets);
    assert.deepEqual(reopened.entries, state.entries);
    assert.deepEqual(reopened.personalProfile, {...body, activity, ageSource: 'birthDate'});
    assert.throws(() => setNutritionMode(reopened, {mode: 'personal'}), /計算できません/);
  }
});

test('保存日は手入力の年齢欄にも表示され、生年月日の削除後は年齢を自分で入力できる', () => {
  const state = start(), get = stubFields();
  setBirthDate(state, (year - 40) + '-01-01');
  renderNutritionProfile(get, state);
  assert.equal(get('personal-age').readOnly, true);
  assert.equal(get('personal-age').value, 40);
  get('profile-mode').value = 'personal';
  get('personal-consent').checked = true;
  get('personal-height').valueAsNumber = body.heightCm;
  get('personal-weight').valueAsNumber = body.weightKg;
  get('personal-sex').value = body.sex;
  get('personal-activity').value = body.activity;
  get('personal-age').valueAsNumber = 99;
  applyNutritionProfileForm(get, state);
  assert.deepEqual(state.personalProfile, {...body, ageSource: 'birthDate'});
  clearBirthDate(state);
  renderNutritionProfile(get, state);
  assert.equal(get('personal-age').readOnly, false);
  assert.equal(get('personal-age').value, '');
  assert.equal(state.profile.mode, 'manual');
  get('profile-mode').value = 'personal';
  get('personal-age').valueAsNumber = 45;
  applyNutritionProfileForm(get, state);
  assert.deepEqual(state.personalProfile, {...body, age: 45});
});

test('生年月日を登録・変更・削除しても編集済みの下書きを保ち、古い誕生日理由だけを消去する', () => {
  const state = start();
  const plan = generateCalendarPlan({...state.settings, days: 1, meal: 'dinner', seed: 177},
    data, {personalization: {birthDate: '1990-10-17'}});
  const dish = plan.days[0].recipeIds[0];
  const ids = new Map([[draftDishKey('2026-10-17', 'dinner', dish), 'shopping-dish-1']]);
  const edited = toggleDish(plan, {dayIndex: 0, recipeId: dish}, data);
  state.draftPlan = capturePlan(edited, ids);
  const old = structuredClone(state.draftPlan);
  assert.match(JSON.stringify(old.days[0].dishReasons), /誕生日の料理/);
  setBirthDate(state, '1990-10-17');
  assert.deepEqual(state.draftPlan, old);
  setBirthDate(state, '1990-11-18');
  const saved = validateJournal(state, data).draftPlan;
  assert.doesNotMatch(JSON.stringify(saved.days[0].dishReasons), /誕生日の料理/);
  const oldDay = old.days[0], newDay = saved.days[0];
  for (const key of ['recipeIds', 'omittedRecipeIds', 'quantities', 'itemIds', 'reasons', 'warnings']) {
    assert.deepEqual(newDay[key], oldDay[key]);
  }
  for (const [id, labels] of Object.entries(oldDay.dishReasons)) {
    assert.deepEqual(newDay.dishReasons[id], labels.filter(label => label !== '誕生日の料理'));
  }
  clearBirthDate(state);
  assert.deepEqual(validateJournal(state, data).draftPlan, saved);
  assert.deepEqual(restorePlan(saved, state.settings, data).shoppingIds, ids);
});

test('本人の書き出しは登録情報を含み、自動退避の既存・新規コピーからは誕生日の理由だけも取り除く', () => {
  const storage = memory(), original = start();
  setBirthDate(original, '2000-02-29');
  assert.equal(writeJournal(storage, original, data), true);
  assert.equal(parseJournal(storage.getItem(JOURNAL_KEY), data).birthDate, '2000-02-29');
  const draft = {days: [{date: '2026-03-01', recipeIds: ['birthday-beef-rolls'], quantities: {'birthday-beef-rolls': 1.5},
    dishReasons: {'birthday-beef-rolls': ['誕生日の料理', 'お気に入りの料理']}, reasons: [UNAVAILABLE_OCCASION_REASON], proposedReasons: [UNAVAILABLE_OCCASION_REASON]}]};
  const expected = structuredClone(draft);
  expected.days[0].dishReasons['birthday-beef-rolls'].shift();
  expected.days[0].reasons = [];
  expected.days[0].proposedReasons = [];
  original.draftPlan = draft;
  storage.setItem(JOURNAL_KEY, JSON.stringify(original));
  assert.equal(replaceJournal(storage, start(), data), true);
  const backup = readJournalBackup(storage);
  assert.deepEqual(JSON.parse(backup.raw).draftPlan, expected);
  assert.equal(JSON.parse(backup.raw).birthDate, undefined);
  const stale = {...original, personalProfile: {...body, age: 21}};
  delete stale.birthDate;
  storage.setItem(JOURNAL_BACKUP_KEY, JSON.stringify([{...backup, raw: JSON.stringify(stale)}]));
  assert.equal(hasArchivedBirthDate(storage), true);
  // 旧退避の書き出し・復元も、日付欄だけが消えて理由の残った状態を表示しない。
  assert.deepEqual(JSON.parse(readJournalBackup(storage).raw).draftPlan, expected);
  clearArchivedBirthDates(storage);
  assert.equal(hasArchivedBirthDate(storage), false);
  const cleaned = JSON.parse(JSON.parse(storage.getItem(JOURNAL_BACKUP_KEY))[0].raw);
  assert.deepEqual(cleaned.draftPlan, expected);
  assert.deepEqual(cleaned.personalProfile, stale.personalProfile);
});

test('日付変更タイマーとスリープ復帰イベントで日本の日付を追跡し、同日には重複通知しない', () => {
  let now = Date.parse('2026-12-30T14:59:59Z'), timer;
  const events = new EventTarget(), doc = new EventTarget(), days = [];
  const browser = {
    Date: class extends Date { constructor() { super(now); } },
    document: doc,
    setTimeout: (callback, delay) => { timer = {callback, delay}; return 1; },
    clearTimeout: () => { timer = undefined; },
    addEventListener: (...args) => events.addEventListener(...args),
    removeEventListener: (...args) => events.removeEventListener(...args),
  };
  const dispose = watchJapanDate(day => days.push(day), browser);
  assert.equal(timer.delay, 1000);
  now += 1000;
  timer.callback();
  doc.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(days, ['2026-12-31']);
  now += 3 * 86400000;
  events.dispatchEvent(new Event('pageshow'));
  assert.deepEqual(days, ['2026-12-31', '2027-01-03']);
  dispose();
  events.dispatchEvent(new Event('pageshow'));
  assert.equal(timer, undefined);
});
