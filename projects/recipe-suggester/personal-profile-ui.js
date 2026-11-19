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

export function renderNutritionProfile(get, state) {
  const simple = state.profile, personal = state.personalProfile;
  get('profile-mode').value = simple.mode;
  get('profile-age').value = simple.ageBand;
  get('profile-sex').value = simple.sex;
  get('profile-activity').value = simple.activity;
  for (const [key, id] of Object.entries(personalInputs)) get(id).value = personal?.[key] ?? '';
  get('personal-consent').checked = Boolean(personal);
  showProfileFields(get);
  const reference = activeNutritionReference(state);
  const summary = reference ? reference.label + 'を使用しています。エネルギーの目安は1日 ' + reference.targets.kcal.toLocaleString('ja-JP') + ' kcalです。'
    : '手入力の比較値を使用しています。';
  get('profile-summary').textContent = summary + (personal && simple.mode !== 'personal' ? ' 詳細プロフィールは保存済みです。' : '');
}

export function applyNutritionProfileForm(get, state) {
  const mode = get('profile-mode').value;
  if (mode === 'personal') {
    if (!get('personal-consent').checked) throw Error('詳細プロフィールを保存して使う場合は、チェックを入れてください。');
    const details = Object.fromEntries(Object.entries(personalInputs).map(([key, id]) =>
      [key, ['age', 'heightCm', 'weightKg'].includes(key) ? get(id).valueAsNumber : get(id).value]));
    setNutritionMode(state, {mode}, details);
  } else {
    const selection = {mode, ageBand: get('profile-age').value, sex: get('profile-sex').value, activity: get('profile-activity').value};
    setNutritionMode(state, selection);
  }
}
