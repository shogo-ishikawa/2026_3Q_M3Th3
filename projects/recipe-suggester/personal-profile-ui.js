import {ageOnDate, jstDateKey} from './personal-nutrition.js';
import {activeNutritionReference, setNutritionMode} from './journal.js';

const personalInputs = {
  age: 'personal-age', heightCm: 'personal-height', weightKg: 'personal-weight',
  sex: 'personal-sex', activity: 'personal-activity',
};

export function showProfileFields(get) {
  const mode = get('profile-mode').value;
  for (const [id, visible] of [['profile-simple-fields', mode === 'reference'], ['profile-personal-fields', mode === 'personal']]) {
    get(id).hidden = !visible;
    get(id).disabled = !visible;
  }
  get('profile-activity-guide').hidden = mode === 'manual';
}

export function renderNutritionProfile(get, state, today = jstDateKey()) {
  get('birth-date').value = state.birthDate ?? '';
  get('birthday-consent').checked = Boolean(state.birthDate);
  const simple = state.profile, personal = state.personalProfile;
  get('profile-mode').value = simple.mode;
  get('profile-age').value = simple.ageBand;
  get('profile-sex').value = simple.sex;
  get('profile-activity').value = simple.activity;
  for (const [key, id] of Object.entries(personalInputs)) get(id).value = personal?.[key] ?? '';
  get('personal-consent').checked = Boolean(personal);
  showProfileFields(get);
  refreshProfileDateDisplay(get, state, today);
}

/** 日付だけが変わったときは、編集中の入力値や同意欄を維持する。 */
export function refreshProfileDateDisplay(get, state, today) {
  const age = ageOnDate(state.birthDate, today);
  get('birth-date').max = today;
  get('birthday-age').textContent = age === null ? '' : '現在' + age + '歳（日本時間）。' +
    (state.birthDate.endsWith('-02-29') ? '2月29日生まれの方は、平年は3月1日にお祝いします。' : '');
  get('personal-age').readOnly = age !== null;
  if (age !== null) get('personal-age').value = age;
  const simple = state.profile, personal = state.personalProfile;
  const reference = activeNutritionReference(state, today);
  const summary = reference ? reference.label + 'を使用しています。エネルギーの目安は1日 ' + reference.targets.kcal.toLocaleString('ja-JP') + ' kcalです。'
    : '手入力の比較値を使用しています。';
  let detailNote = personal && simple.mode !== 'personal' ? ' 詳細プロフィールは保存済みです。' : '';
  if (age !== null && personal?.ageSource === 'birthDate' && !activeNutritionReference({...state, profile: {mode: 'personal'}}, today)) {
    detailNote += ' 現在の年齢と身体情報は個人の目安の計算対象外です。';
  }
  get('profile-summary').textContent = summary + detailNote;
}

export function applyNutritionProfileForm(get, state) {
  const mode = get('profile-mode').value;
  if (mode === 'personal') {
    if (!get('personal-consent').checked) throw Error('詳細プロフィールを保存して使う場合は、チェックを入れてください。');
    const details = Object.fromEntries(Object.entries(personalInputs).map(([key, id]) =>
      [key, ['age', 'heightCm', 'weightKg'].includes(key) ? get(id).valueAsNumber : get(id).value]));
    if (state.birthDate) {
      delete details.age;
      details.ageSource = 'birthDate';
    }
    setNutritionMode(state, {mode}, details);
  } else {
    const selection = {mode, ageBand: get('profile-age').value, sex: get('profile-sex').value, activity: get('profile-activity').value};
    setNutritionMode(state, selection);
  }
}

/** 開いたままの日付変更と、スリープ・バックグラウンドからの復帰に対応する。 */
export function watchJapanDate(onChange, browser = window) {
  let currentDay = jstDateKey(new browser.Date());
  let timer;
  function check() {
    const now = new browser.Date();
    const day = jstDateKey(now);
    browser.clearTimeout(timer);
    const nextMidnight = Date.parse(day + 'T00:00:00+09:00') + 86400000;
    timer = browser.setTimeout(check, nextMidnight - now.getTime());
    if (day === currentDay) return;
    currentDay = day;
    onChange(day);
  }
  browser.addEventListener('pageshow', check);
  browser.document.addEventListener('visibilitychange', check);
  check();
  return () => {
    browser.clearTimeout(timer);
    browser.removeEventListener('pageshow', check);
    browser.document.removeEventListener('visibilitychange', check);
  };
}
