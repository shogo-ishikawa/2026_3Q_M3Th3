/** カレーのご飯量と、選んだ1人分の栄養・材料を表示します。 */
import {curryRiceFor, defaultCurryRiceSelection, buildCurryRiceSelection} from './curry-rice.js';
import {NUTRIENT_KEYS, NUTRIENT_LABELS, NUTRIENT_UNITS} from './nutrition.js';
import {configureQuantityInput, readQuantityInput} from './quantity-input.js';

let count = 0;
const rounded = value => Math.round(value * 100) / 100;
const make = (tag, className = '', text = '') => {
  const element = document.createElement(tag); element.className = className;
  if (text) element.textContent = text;
  return element;
};

export function mountCurryRice({recipeId, data, initial, onChange = () => {}, onError = () => {}} = {}) {
  if (typeof onChange !== 'function' || typeof onError !== 'function') throw Error('ご飯の選択画面の処理を確認してください。');
  const definition = curryRiceFor(recipeId, data);
  if (!definition) throw Error('ご飯の量を変更できるカレーが見つかりません。');
  const selection = initial === undefined ? defaultCurryRiceSelection(recipeId, data) : structuredClone(initial);
  if (selection?.recipeId !== recipeId) throw Error('料理とご飯の初期設定が一致しません。');
  const first = buildCurryRiceSelection(selection, data), stableId = first.id;
  const root = make('div', 'dish-customiser curry-rice'); root.setAttribute('role', 'group'); root.setAttribute('aria-label', 'カレーのご飯の量を選ぶ');
  root.append(make('h3', 'dish-title', 'ご飯の量を選ぶ'), make('p', 'dish-intro', 'カレーの具・ルーは1人分のまま、炊いたご飯の量を変更できます。0gはルーのみ。ナンなどは主食から別に追加してください。'));
  const label = make('label', 'dish-rice-label', '1人分のご飯（炊飯済み）');
  const inputLine = make('span', 'dish-input-unit'), input = make('input', 'dish-rice-amount');
  input.id = `curry-rice-${++count}`; label.htmlFor = input.id;
  input.type = 'number'; input.min = String(definition.minRiceGrams); input.max = String(definition.maxRiceGrams); input.step = 'any'; input.inputMode = 'decimal'; input.required = true; input.value = String(selection.riceGrams);
  input.setAttribute('aria-describedby', `${input.id}-note`);
  inputLine.append(input, make('span', 'dish-unit', 'g')); label.append(inputLine); root.append(label);
  configureQuantityInput(input);
  const note = make('p', 'dish-note', `入力範囲：0〜${definition.maxRiceGrams}g。炊く前のお米の重さとは異なります。買い物リストにも選んだ炊飯済みのg数を反映します。`); note.id = `${input.id}-note`; root.append(note);
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
      if (typeof input.value !== 'string' || !input.value.trim()) throw Error('ご飯のg数を入力してください。ルーのみの場合は0を入力します。');
      const recipe = buildCurryRiceSelection({id:stableId, recipeId, riceGrams:readQuantityInput(input,{label:'ご飯のg数'})}, data);
      title.textContent = `${recipe.name} / 1人分`;
      for (const key of NUTRIENT_KEYS) values.get(key).textContent = recipe.manualNutrition[key] === null ? '未入力' : `${rounded(recipe.manualNutrition[key])} ${NUTRIENT_UNITS[key]}`;
      const labels = recipe.allergens.map(id => data.allergens?.find(allergen => allergen.id === id)?.label ?? id);
      allergens.textContent = `含まれる登録アレルゲン：${labels.length ? labels.join('、') : '登録なし'}。${recipe.allergensKnown ? '' : '商品ごとのアレルギー表示を確認してください。'}`;
      materialList.replaceChildren(...recipe.ingredients.map(part => make('li', 'dish-material', `${data.ingredients[part.id].name} ${rounded(part.amount)} ${data.ingredients[part.id].unit}`)));
      steps.replaceChildren(...recipe.steps.map(step => make('li', 'dish-step', step)));
      input.setAttribute('aria-invalid', 'false'); error.hidden = true; error.textContent = ''; preview.hidden = false; onError(''); onChange(recipe);
    } catch (cause) {
      input.setAttribute('aria-invalid', 'true'); error.hidden = false; error.textContent = cause.message; preview.hidden = true; onChange(null); onError(cause.message);
    }
  }
  input.addEventListener('input', update); input.addEventListener('change', update); update();
  return root;
}
