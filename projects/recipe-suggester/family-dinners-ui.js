/** 家族の夕飯を組み合わせで保存し、日付を選んで再利用します。 */
import {defaultServings} from './household-preferences.js';
import {createFamilyDinner, planFamilyDinner, mealSetWarnings, MAX_MEAL_SETS} from './meal-sets.js';
import {sumNutrition} from './nutrition.js';
import {portionLabel} from './portion-guide.js';
import {formatNutrient} from './nutrient-format.js';

function element(tag, text = '', className = '') {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function select(choices, initial) {
  const input = element('select');
  for (const [value, label] of choices) {
    const option = element('option', label);
    option.value = value;
    input.append(option);
  }
  input.value = initial ?? choices[0]?.[0] ?? '';
  return input;
}
function field(label, control) {
  const wrapper = element('label', label, 'meal-sets-field');
  wrapper.append(control);
  return wrapper;
}
function nameInput(initial = '') {
  const input = element('input');
  input.type = 'text';
  input.maxLength = 200;
  input.value = initial;
  input.placeholder = '例：鮭の塩焼きと豚汁';
  return input;
}
function summary(items, data, describeItem) {
  const box = element('div');
  if (!items.length) return box;
  const list = element('ul', '', 'meal-sets-items');
  for (const item of items) {
    const label = item.name + '　' + portionLabel(item, data);
    const row = element('li');
    if (describeItem) {
      const details = element('details');
      details.append(element('summary', label));
      details.addEventListener('toggle', () => {
        if (details.open && details.children.length === 1) details.append(describeItem(item));
      });
      row.append(details);
    } else row.textContent = label;
    list.append(row);
  }
  const total = sumNutrition(items);
  box.append(list, element('p', '1人分　' + formatNutrient(total.values.kcal, 'kcal') + ' kcal' + (total.complete.kcal ? '' : ' ＋不明分'), 'meal-sets-energy'));
  return box;
}

export function mountFamilyDinners({state, data, date, proposedItems, selectedId, onSave, onRename, onDelete, onSchedule, onBrowse, describeItem}) {
  const sets = state.mealSets.filter(set => set.kind === 'family-dinner');
  const root = element('div');
  const error = element('p', '', 'meal-sets-error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  function action(label, handler, primary = false) {
    const button = element('button', label, primary ? 'button-primary' : 'button-secondary');
    button.type = 'button';
    button.addEventListener('click', () => {
      error.hidden = true;
      try { handler(); }
      catch (cause) { error.textContent = cause.message; error.hidden = false; }
    });
    return button;
  }
  function checkName(value, currentId) {
    const name = value.trim();
    if (!name || name.length > 200) throw Error('定番の名前を1～200文字で入力してください。');
    if (sets.some(set => set.id !== currentId && set.name === name)) throw Error('同じ名前の定番があります。別の名前を付けてください。');
    return name;
  }
  function saveControls(parent, readItems) {
    const name = nameInput();
    const save = action('家族の定番に保存', () => {
      if (state.mealSets.length >= MAX_MEAL_SETS) throw Error('定番セットは合計' + MAX_MEAL_SETS + '件まで保存できます。');
      const items = readItems();
      if (!items.length) throw Error('保存する料理を選んでください。');
      onSave(createFamilyDinner(checkName(name.value), items, data));
    }, true);
    const actions = element('div', '', 'meal-sets-actions');
    actions.append(save);
    parent.append(field('定番の名前', name), actions);
  }
  if (proposedItems) {
    root.append(summary(proposedItems, data));
    saveControls(root, () => proposedItems);
    root.append(error);
    return root;
  }

  if (sets.length) {
    const chosen = select(sets.map(set => [set.id, set.name]), sets.find(set => set.id === selectedId)?.id);
    const detail = element('section');
    const targetDate = element('input');
    targetDate.type = 'date';
    targetDate.min = '2000-01-01';
    targetDate.max = '2100-12-31';
    targetDate.value = date;
    const servings = select(Array.from({length:8}, (_, i) => [String(i + 1), (i + 1) + '人分']), String(defaultServings(state.settings)));
    function showSet() {
      const set = sets.find(set => set.id === chosen.value);
      detail.replaceChildren(summary(set.items, data, describeItem));
      const warnings = mealSetWarnings(set, state.settings, data);
      for (const warning of warnings) detail.append(element('p', warning, 'meal-sets-warning'));
      const restricted = (state.settings.allergens.length || state.settings.excludedIngredients.length) && warnings.length;
      const destination = element('div', '', 'meal-sets-destination');
      destination.append(field('夕飯の日付', targetDate), field('買い物の人数', servings));
      const add = action('この日の夕食予定に追加', () => onSchedule(planFamilyDinner(set, targetDate.value, Number(servings.value), data)), true);
      const actions = element('div', '', 'meal-sets-actions');
      add.disabled = Boolean(restricted);
      actions.append(add);
      detail.append(destination, element('p', '人数は買い物の材料に反映します。栄養記録は1人分です。', 'field-note'), actions);
      if (restricted) detail.append(element('p', '現在の除外条件で食べられることを確認できないため、この夕飯は予定に追加できません。', 'field-note'));
      const manage = element('details', '', 'meal-sets-history');
      const rename = nameInput(set.name);
      const edit = element('div', '', 'meal-sets-actions');
      edit.append(action('名前を変更', () => onRename(set.id, checkName(rename.value, set.id))), action('定番から削除', () => onDelete(set.id, set.name)));
      manage.append(element('summary', '定番の整理'), field('定番の名前', rename), edit);
      detail.append(manage);
      error.hidden = true;
    }
    chosen.addEventListener('change', showSet);
    root.append(field('保存した夕飯', chosen), detail);
    showSet();
  }

  const create = element('details', '', 'meal-sets-history');
  create.open = !sets.length;
  create.append(element('summary', '新しい定番を作る'));
  const dinners = new Map();
  for (const entry of state.entries) {
    if (entry.meal !== 'dinner' || !entry.items.length) continue;
    const key = entry.date + ' ' + (entry.status === 'planned' ? '予定' : '食べた');
    if (!dinners.has(key)) dinners.set(key, []);
    dinners.get(key).push(...entry.items);
  }
  const sources = [];
  if (state.favourites.length) sources.push(['favourites', 'お気に入りの料理']);
  if (dinners.size) sources.push(['history', 'カレンダーの夕飯']);
  if (sources.length) {
    const source = select(sources);
    const selection = element('div');
    let readItems;
    function showSource() {
      selection.replaceChildren();
      if (source.value === 'favourites') {
        const checks = [];
        const group = element('fieldset', '', 'family-favourites');
        group.append(element('legend', '組み合わせる料理'));
        for (const favourite of state.favourites) {
          const check = element('input');
          check.type = 'checkbox';
          const label = element('label', '', 'check-label');
          label.append(check, element('span', favourite.item.name + '　' + portionLabel(favourite.item, data)));
          group.append(label);
          checks.push([check, favourite.item]);
        }
        readItems = () => checks.filter(([check]) => check.checked).map(([, item]) => item);
        selection.append(group);
      } else {
        const keys = [...dinners.keys()].sort().reverse();
        const history = select(keys.map(key => [key, key]));
        const preview = element('div');
        readItems = () => dinners.get(history.value);
        const refresh = () => preview.replaceChildren(summary(readItems(), data));
        history.addEventListener('change', refresh);
        refresh();
        selection.append(field('保存する夕飯', history), preview);
      }
    }
    source.addEventListener('change', showSource);
    create.append(field('料理の選び方', source), selection);
    showSource();
    saveControls(create, () => readItems());
  } else {
    create.append(element('p', '提案された夕食の「家族の定番に保存」から登録できます。メニューで料理をお気に入りにすると、ここで自由に組み合わせられます。', 'field-note'));
    create.append(action('メニューから料理を探す', onBrowse));
  }
  root.append(create, error);
  return root;
}
