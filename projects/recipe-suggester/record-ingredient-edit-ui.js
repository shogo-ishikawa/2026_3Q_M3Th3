import {recordIngredientDraft, editRecordIngredients} from './record-ingredient-edit.js';
import {ARRANGEMENT_CATEGORIES, arrangementIngredientOptions} from './recipe-arrangement.js';
import {matchesJapaneseQuery, normaliseJapaneseSearch} from './japanese-search.js';
import {configureQuantityInput, readQuantityInput} from './quantity-input.js';
import {itemNutrition, NUTRIENT_KEYS, NUTRIENT_LABELS, NUTRIENT_UNITS} from './nutrition.js';
import {formatNutrient} from './nutrient-format.js';
import {portionLabel} from './portion-guide.js';

const node = (tag, className = '', text = '') => {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
};
function button(text, className) {
  const element = node('button', className, text);
  element.type = 'button';
  return element;
}
function option(value, text) {
  const element = node('option', '', text);
  element.value = value;
  return element;
}
function field(text, control) {
  const label = node('label', 'record-ingredient-label', text);
  label.append(control);
  return label;
}
const amountFormatter = new Intl.NumberFormat('ja-JP', {useGrouping:false, maximumSignificantDigits:6});
const displayAmount = amount => amountFormatter.format(amount);

/** 材料の操作はこの食事の量に対して行い、反映ボタンを押すまで元の記録を保ちます。 */
export function mountRecordIngredientEditor({item, data, onApply, onCancel, applyLabel = 'この内容を反映'}) {
  const draft = recordIngredientDraft(item, data);
  const options = arrangementIngredientOptions(data);
  const byId = new Map(options.map(part => [part.id, part]));
  const originals = draft.ingredients.map(part => ({...part}));
  const added = draft.additions.map(part => ({...part}));
  const addedInputs = new Map();
  let changedItem = null;

  const root = node('section', 'record-ingredient-editor');
  root.setAttribute('aria-label', item.name + 'の材料を編集');
  // 外食フォームの中でも、入力を確定しただけで食事全体を登録しないようにします。
  root.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target?.tagName === 'INPUT' && !event.isComposing) {
      event.preventDefault();
      event.stopPropagation?.();
    }
  });
  root.append(node('p', 'field-note', '今回の量：' + portionLabel(item, data) + '。この量に使った材料を入力します。'));

  const category = node('select', 'record-ingredient-category');
  category.append(option('all', 'すべて'), ...ARRANGEMENT_CATEGORIES.map(({id, label}) => option(id, label)));
  category.value = 'all';
  const search = node('input', 'record-ingredient-search');
  search.type = 'search';
  search.value = '';
  search.placeholder = '例　卵、きのこ';
  const choice = node('select', 'record-ingredient-choice');
  const add = button('食材を追加', 'button-secondary record-ingredient-add');
  const picker = node('div', 'record-ingredient-picker');
  picker.append(field('食材の種類', category), field('追加する食材を検索', search),
    field('追加する食材', choice), add);
  root.append(picker);

  const addedSection = node('div', 'record-ingredient-additions');
  const addedList = node('div', 'record-ingredient-list');
  addedSection.append(node('h4', '', '追加した食材'), addedList);
  const baseSection = node('details', 'record-ingredient-base');
  const baseList = node('div', 'record-ingredient-list');
  baseSection.open = draft.editableBase && originals.length <= 5;
  const baseHeading = node('summary');
  baseSection.append(baseHeading, baseList);
  root.append(addedSection);
  if (draft.reason) root.append(node('p', 'field-note', draft.reason));
  root.append(baseSection);

  const preview = node('section', 'record-summary record-ingredient-preview');
  preview.setAttribute('aria-label', 'この料理の栄養');
  preview.append(node('h4', 'record-summary-heading', 'この料理の栄養'));
  const nutrients = node('dl', 'record-summary-nutrients');
  const values = new Map();
  for (const key of NUTRIENT_KEYS) {
    const pair = node('div', 'record-summary-nutrient');
    const value = node('dd');
    values.set(key, value);
    pair.append(node('dt', '', NUTRIENT_LABELS[key]), value);
    nutrients.append(pair);
  }
  preview.append(nutrients);
  const error = node('p', 'food-composer-error record-ingredient-error');
  error.setAttribute('role', 'status');
  const actions = node('div', 'record-ingredient-actions');
  const apply = button(applyLabel, 'button-primary record-ingredient-apply');
  const cancel = button('キャンセル', 'button-secondary record-ingredient-cancel');
  actions.append(apply, cancel);
  root.append(preview, error, actions);

  function refreshNutrition() {
    try {
      const parts = rows => rows.map(({id, amount, inputValue}) => {
        if (inputValue !== undefined && !(amount > 0)) throw Error('食材の量を0より大きい数値で入力してください。取り除くには「外す」を押してください。');
        return {id, amount};
      });
      changedItem = editRecordIngredients(item, {ingredients: parts(originals), additions: parts(added)}, data);
      const amounts = itemNutrition(changedItem);
      for (const key of NUTRIENT_KEYS) {
        values.get(key).textContent = amounts[key] == null ? '不明' : formatNutrient(amounts[key], key) + ' ' + NUTRIENT_UNITS[key];
      }
      preview.hidden = false;
      error.hidden = true;
      error.textContent = '';
      apply.disabled = false;
    } catch (cause) {
      changedItem = null;
      preview.hidden = true;
      error.hidden = false;
      error.textContent = cause.message;
      apply.disabled = true;
    }
  }

  function renderList(list, parts, kind, editable) {
    const rows = parts.map((part, index) => {
      const ingredient = byId.get(part.id);
      const name = ingredient?.name ?? part.id;
      const unit = ingredient?.nativeUnit ?? '';
      const row = node('div', 'record-ingredient-row');
      row.setAttribute('data-kind', kind);
      row.setAttribute('data-ingredient', part.id);
      if (!editable) {
        row.append(node('span', '', name), node('span', '', displayAmount(part.amount) + unit));
        return row;
      }
      const input = node('input', 'record-ingredient-amount');
      if (kind === 'addition') addedInputs.set(part.id, input);
      input.type = 'number';
      input.min = '0';
      input.value = part.inputValue ?? displayAmount(part.amount);
      input.setAttribute('aria-label', name + 'の量（' + unit + '）');
      const label = field(name + '（' + unit + '）', input);
      configureQuantityInput(input);
      input.addEventListener('input', () => {
        part.inputValue = input.value;
        try { part.amount = readQuantityInput(input); } catch { part.amount = null; }
        refreshNutrition();
      });
      const remove = button('外す', 'button-secondary record-ingredient-remove');
      remove.setAttribute('aria-label', name + 'を外す');
      remove.addEventListener('click', () => {
        parts.splice(index, 1);
        renderRows();
        refreshNutrition();
        (list.querySelector?.('input') ?? search).focus?.();
      });
      row.append(label, remove);
      return row;
    });
    list.replaceChildren(...rows);
  }

  function renderRows() {
    addedInputs.clear();
    renderList(baseList, originals, 'base', draft.editableBase);
    renderList(addedList, added, 'addition', true);
    addedSection.hidden = !added.length;
    baseHeading.textContent = (draft.editableBase ? '料理の材料' : '参考にした材料') + '（' + originals.length + '種類）';
    baseSection.hidden = !originals.length;
  }

  function filterChoices() {
    const candidates = options.filter(part => (category.value === 'all' || part.category === category.value)
      && matchesJapaneseQuery([part.name], search.value));
    const query = normaliseJapaneseSearch(search.value.trim());
    const exact = query && candidates.find(part => normaliseJapaneseSearch(part.name) === query);
    const selected = exact || (candidates.length === 1 ? candidates[0] : null);
    choice.replaceChildren(option('', candidates.length ? '食材を選ぶ' : '該当する食材がありません'),
      ...candidates.map(part => option(part.id, part.name)));
    choice.value = selected?.id ?? '';
    add.disabled = !choice.value;
  }

  search.addEventListener('input', filterChoices);
  category.addEventListener('change', filterChoices);
  choice.addEventListener('change', () => { add.disabled = !choice.value; });
  add.addEventListener('click', () => {
    const ingredient = byId.get(choice.value);
    if (!ingredient) return;
    const amount = ['g','ml'].includes(ingredient.nativeUnit) ? 10 : 1;
    const existing = added.find(part => part.id === ingredient.id);
    if (existing) {
      if (!(existing.amount > 0)) {
        addedInputs.get(ingredient.id)?.focus?.();
        return;
      }
      existing.amount += amount;
      delete existing.inputValue;
    } else added.push({id:ingredient.id, amount});
    renderRows();
    refreshNutrition();
    addedInputs.get(ingredient.id)?.focus?.();
  });
  apply.addEventListener('click', () => {
    if (changedItem) onApply(changedItem);
  });
  cancel.addEventListener('click', () => onCancel());
  filterChoices();
  renderRows();
  refreshNutrition();
  return root;
}
