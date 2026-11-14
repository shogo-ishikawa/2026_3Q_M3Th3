/** 肉の選択と1人分の栄養・材料・作り方の表示。登録用formは呼び出し元で用意します。 */
import {meatChoiceFor, defaultMeatSelection, buildMeatSelection} from './meat-choices.js';
import {NUTRIENT_KEYS, NUTRIENT_LABELS, NUTRIENT_UNITS, recipeNutrition} from './nutrition.js';

let count = 0;
const rounded = value => Math.round(value * 100) / 100;
const make = (tag, className = '', text = '') => {
  const element = document.createElement(tag); element.className = className;
  if (text) element.textContent = text;
  return element;
};

export function mountMeatChoice({recipeId, data, initial, allowedMeatIds, onChange = () => {}, onError = () => {}, onSelectionChange = () => {}} = {}) {
  if (typeof onChange !== 'function' || typeof onError !== 'function' || typeof onSelectionChange !== 'function') throw Error('肉の選択画面の処理を確認してください。');
  const definition = meatChoiceFor(recipeId);
  if (!definition) throw Error('肉を選ぶ料理が見つかりません。');
  const selection = initial === undefined ? defaultMeatSelection(recipeId) : structuredClone(initial);
  if (selection.recipeId !== recipeId) throw Error('料理と肉の初期設定が一致しません。');
  if (allowedMeatIds !== undefined && (!Array.isArray(allowedMeatIds) || allowedMeatIds.some(id => !definition.options.some(option => option.id === id)))) throw Error('選べる肉の種類を確認してください。');
  const allowed = allowedMeatIds === undefined ? definition.options : definition.options.filter(option => allowedMeatIds.includes(option.id));
  if (!allowed.some(option => option.id === selection.meatId)) throw Error('現在の条件に合う肉を選び直してください。');
  const first = buildMeatSelection(selection, data), stableId = first.id;
  const root = make('div', 'dish-customiser meat-choice'); root.setAttribute('role', 'group'); root.setAttribute('aria-label', `${definition.label}の肉を選ぶ`);
  root.append(make('h3', 'dish-title', '肉の種類を選ぶ'), make('p', 'dish-intro', '肉の合計g数は同じまま、種類を切り替えます。材料・栄養・作り方は選んだ肉に合わせた1人分です。'));
  const label = make('label', 'dish-meat-label', '肉の種類'), select = make('select', 'dish-meat-select'); select.id = `meat-choice-${++count}`; label.htmlFor = select.id;
  for (const option of allowed) {const node = make('option', '', option.label); node.value = option.id; select.append(node);}
  select.value = selection.meatId; label.append(select); root.append(label);
  const note = make('p', 'dish-note'); root.append(note);
  const error = make('p', 'dish-error'); error.hidden = true; error.setAttribute('role', 'status'); error.setAttribute('aria-live', 'polite');
  const preview = make('div', 'dish-preview'), title = make('p', 'dish-preview-title'), nutrients = make('dl', 'dish-nutrients'), values = new Map();
  for (const key of NUTRIENT_KEYS) {
    const row = make('div', 'dish-nutrient'), value = make('dd', 'dish-nutrient-value');
    row.append(make('dt', 'dish-nutrient-label', NUTRIENT_LABELS[key]), value); nutrients.append(row); values.set(key, value);
  }
  const allergens = make('p', 'dish-allergens');
  const materials = make('details', 'dish-materials'), materialList = make('ul', 'dish-material-list'); materials.append(make('summary', 'dish-details-summary', '材料と分量'), materialList);
  const instructions = make('details', 'dish-instructions'), steps = make('ol', 'dish-step-list'); instructions.append(make('summary', 'dish-details-summary', 'この内容での作り方'), steps);
  preview.append(title, nutrients, allergens, materials, instructions); root.append(error, preview);
  function update() {
    try {
      if (!allowed.some(option => option.id === select.value)) throw Error('現在の条件に合う肉を選んでください。');
      const config = {id:stableId, recipeId, meatId:select.value};
      const recipe = buildMeatSelection(config, data), nutrition = recipeNutrition(recipe, data);
      const option = definition.options.find(option => option.id === select.value);
      note.textContent = option.note ?? 'ひき肉・薄切り肉は加熱前の可食部重量です。焼く・煮る際に流れ出る脂は差し引かない概算です。';
      title.textContent = `${recipe.name} / 1人分`;
      for (const key of NUTRIENT_KEYS) values.get(key).textContent = nutrition[key] === null ? '未入力' : `${rounded(nutrition[key])} ${NUTRIENT_UNITS[key]}`;
      const labels = recipe.allergens.map(id => data.allergens?.find(allergen => allergen.id === id)?.label ?? id);
      allergens.textContent = `含まれる登録アレルゲン：${labels.length ? labels.join('、') : '登録なし'}。`;
      materialList.replaceChildren(...recipe.ingredients.map(part => make('li', 'dish-material', `${data.ingredients[part.id].name} ${rounded(part.amount)} ${data.ingredients[part.id].unit}`)));
      steps.replaceChildren(...recipe.steps.map(step => make('li', 'dish-step', step)));
      error.hidden = true; error.textContent = ''; preview.hidden = false; onError(''); onSelectionChange(structuredClone(config));onChange(recipe);
    } catch (cause) {
      error.hidden = false; error.textContent = cause.message; preview.hidden = true; onSelectionChange(null);onChange(null); onError(cause.message);
    }
  }
  select.addEventListener('change', update); update();
  return root;
}
