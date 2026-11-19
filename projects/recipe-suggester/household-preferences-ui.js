import {HOUSEHOLD_AGES, MAX_PLAN_SERVINGS, householdSize, validateHousehold} from './household-preferences.js';
import {matchesJapaneseQuery} from './japanese-search.js';
import {configureQuantityInput, readQuantityInput} from './quantity-input.js';

/** 家族人数の編集中に、別の設定の保存でフォームを上書きしない。 */
export function setupHouseholdPreferences({ingredients, getSettings, commit, guard}) {
  const find = id => document.getElementById(id);
  const counts = {};
  const form = find('household-form'), use = find('household-use-servings');
  const ingredientsByName = Object.entries(ingredients);
  const search = find('disliked-search'), results = find('disliked-matches'), selected = find('disliked-selections');
  let savedHousehold;

  function inputCounts() {
    return Object.fromEntries(Object.entries(counts).map(([key, input]) =>
      [key, readQuantityInput(input, {allowEmpty: true, label: HOUSEHOLD_AGES[key] + 'の人数'}) ?? 0]));
  }

  function showTotal() {
    let size;
    try { size = householdSize({counts: inputCounts()}); }
    catch { find('household-total').textContent = '人数を確認してください。'; return; }
    use.disabled = size > MAX_PLAN_SERVINGS;
    if (use.disabled) use.checked = false;
    find('household-total').textContent = size > MAX_PLAN_SERVINGS
      ? `合計${size}人。1回に作れる分量は1〜8人分です。献立画面で1回に作る人数を選び、分けて調理してください。`
      : `合計${size}人`;
  }

  for (const [key, title] of Object.entries(HOUSEHOLD_AGES)) {
    const input = document.createElement('input'), label = document.createElement('label');
    input.id = 'household-count-' + key;
    input.type = 'number'; input.min = '0'; input.max = '99'; input.step = '1'; input.placeholder = '0';
    label.htmlFor = input.id;
    label.append(title, input);
    find('household-counts').append(label);
    counts[key] = input;
    configureQuantityInput(input, {integerOnly: true});
  }
  form.addEventListener('input', showTotal);
  form.addEventListener('submit', guard(event => {
    event.preventDefault();
    const household = validateHousehold({counts: inputCounts(), useForServings: use.checked});
    commit(next => { next.settings.household = household; }, {message: '家族構成を保存しました。'});
  }));
  find('clear-household').addEventListener('click', guard(() => {
    commit(next => { delete next.settings.household; }, {message: '家族構成を解除しました。'});
  }));

  function button(label, action) {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.addEventListener('click', guard(action));
    return element;
  }
  function matches() {
    const query = search.value.trim(), ids = getSettings().dislikedIngredients ?? [];
    results.replaceChildren();
    if (!query) return;
    const found = ingredientsByName.filter(([id, item]) => !ids.includes(id) && matchesJapaneseQuery([item.name, id], query));
    if (!found.length) results.textContent = '追加できる食材が見つかりません。別の名前で探してください。';
    for (const [id, item] of found.slice(0, 20)) {
      results.append(button('＋ ' + item.name, () => {
        const saved = commit(next => {
          next.settings.dislikedIngredients = [...new Set([...(next.settings.dislikedIngredients ?? []), id])];
        }, {message: item.name + 'を苦手な食材に登録しました。'});
        if (saved) { search.value = ''; matches(); search.focus(); }
      }));
    }
    if (found.length > 20) results.append('ほかにも候補があります。食材名をもう少し入力してください。');
  }
  search.addEventListener('input', matches);
  function update(settings) {
    const saved = settings.household ?? null;
    const signature = JSON.stringify(saved);
    if (signature !== savedHousehold) {
      for (const [key, input] of Object.entries(counts)) input.value = String(saved?.counts[key] || '');
      use.checked = saved?.useForServings ?? true;
      find('clear-household').hidden = !saved;
      savedHousehold = signature;
      showTotal();
    }
    const ids = settings.dislikedIngredients ?? [];
    selected.replaceChildren();
    if (!ids.length) selected.textContent = '登録した食材はありません。';
    for (const id of ids) {
      const name = ingredients[id].name;
      const remove = button(name + ' ×', () => {
        commit(next => {
          next.settings.dislikedIngredients = next.settings.dislikedIngredients.filter(item => item !== id);
        }, {message: name + 'を苦手な食材から外しました。'});
      });
      remove.setAttribute('aria-label', name + 'を苦手な食材から外す');
      selected.append(remove);
    }
    matches();
  }
  return {update};
}
