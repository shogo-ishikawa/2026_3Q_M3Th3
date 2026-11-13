/** 肉じゃがとお好み焼きの選択画面。配合・栄養・工程は純粋関数で作ります。 */
import {DISH_CUSTOMISERS, defaultDishSelection, buildCustomDish} from './dish-customisation.js';
import {NUTRIENT_KEYS, NUTRIENT_LABELS, NUTRIENT_UNITS, recipeNutrition} from './nutrition.js';
import {configureQuantityInput, readQuantityInput} from './quantity-input.js';

let customiserCount = 0;
const rounded = value => Math.round(value * 100) / 100;
const numericValue = input => {try {return readQuantityInput(input);} catch {return NaN;}};
const make = (tag, className = '', text = '') => {
  const element = document.createElement(tag);
  element.className = className;
  if (text) element.textContent = text;
  return element;
};
const appendOptions = (select, options) => {
  for (const option of options) {
    const element = make('option', '', option.label);
    element.value = option.id;
    select.append(element);
  }
};

/**
 * カレンダー登録のformは呼び出し元が用意します。
 * 生成時・入力変更時に確定したrecipe、不正な入力ではnullを通知します。
 */
export function mountDishCustomiser({kind, data, initial, onChange = () => {}, onError = () => {}} = {}) {
  if (typeof onChange !== 'function' || typeof onError !== 'function') throw Error('料理の表示処理を確認してください。');
  const definition = DISH_CUSTOMISERS.find(dish => dish.kind === kind);
  if (!definition) throw Error('具材を選ぶ料理が見つかりません。');
  const selection = initial === undefined ? defaultDishSelection(kind) : structuredClone(initial);
  if (selection.kind !== kind) throw Error('料理の種類と初期設定が一致しません。');
  // 未知の材料や不正な初期量を画面で黙って削除しません。
  const firstRecipe = buildCustomDish(selection, data);
  const recipeId = firstRecipe.id;
  const prefix = `dish-customiser-${++customiserCount}`;
  const root = make('div', 'dish-customiser');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', `${definition.label}の具材と作り方`);
  root.append(make('h3', 'dish-title', kind === 'nikujaga' ? '肉の種類を選ぶ' : '具材とトッピングを選ぶ'));
  root.append(make('p', 'dish-intro', kind === 'nikujaga'
    ? '牛肉と豚肉を切り替えると、材料・栄養・作り方が変わります。表示量は1皿分です。'
    : 'プリセットから選ぶか、具材と量を調整してください。生地とキャベツに選んだ具材と調味料を加え、1皿分として計算します。'));

  let meat, preset, sauce, sauceAmount, mayonnaiseAmount;
  const components = [];
  if (kind === 'nikujaga') {
    const label = make('label', 'dish-meat-label', '肉の種類');
    meat = make('select', 'dish-meat-select');
    meat.id = `${prefix}-meat`; label.htmlFor = meat.id;
    appendOptions(meat, definition.meatOptions);
    meat.value = selection.meat;
    meat.addEventListener('change', update);
    label.append(meat); root.append(label);
  } else {
    const presetLabel = make('label', 'dish-preset-label', 'お好み焼きの種類');
    preset = make('select', 'dish-preset-select');
    preset.id = `${prefix}-preset`; presetLabel.htmlFor = preset.id;
    appendOptions(preset, [...definition.presets, {id: 'custom', label: '自由に調整'}]);
    preset.value = selection.presetId;
    presetLabel.append(preset); root.append(presetLabel);

    const fieldset = make('fieldset', 'dish-components');
    fieldset.append(make('legend', 'dish-legend', '具材とトッピング'));
    const grid = make('div', 'dish-component-grid');
    const amounts = new Map(selection.components.map(part => [part.id, part.amount]));
    for (const component of definition.components) {
      const row = make('div', 'dish-component');
      const label = make('label', 'dish-component-choice');
      const checked = make('input', 'dish-component-check');
      checked.type = 'checkbox'; checked.id = `${prefix}-${component.id}-checked`;
      checked.checked = amounts.has(component.id); label.htmlFor = checked.id;
      label.append(checked, make('span', 'dish-component-name', component.label));
      const quantityLabel = make('label', 'dish-component-quantity');
      const quantity = make('input', 'dish-component-amount');
      quantity.type = 'number'; quantity.id = `${prefix}-${component.id}-amount`;
      quantity.min = '0'; quantity.max = '300'; quantity.step = 'any';
      quantity.value = String(amounts.get(component.id) ?? component.defaultAmount);
      quantity.disabled = !checked.checked;
      quantity.setAttribute('aria-label', `${component.label}の量（g）`);
      quantityLabel.htmlFor = quantity.id;
      quantityLabel.append(quantity, make('span', 'dish-unit', 'g'));
      configureQuantityInput(quantity);
      row.append(label, quantityLabel);
      if (component.preparation) row.append(make('small', 'dish-preparation', component.preparation));
      let lastPositive = Number(quantity.value);
      const control = {component, checked, quantity, remember: () => {lastPositive = Number(quantity.value);}}; components.push(control);
      checked.addEventListener('change', () => {if (checked.checked && !(numericValue(quantity) > 0 && numericValue(quantity) <= 300)) quantity.value = String(lastPositive); quantity.disabled = !checked.checked; markCustom(); update();});
      quantity.addEventListener('input', () => {const value = numericValue(quantity); if (value === 0) {checked.checked = false; quantity.disabled = true;} else if (Number.isFinite(value) && value > 0 && value <= 300) lastPositive = value; markCustom(); update();});
      grid.append(row);
    }
    fieldset.append(grid); root.append(fieldset);

    const fields = make('div', 'dish-sauce-fields');
    const sauceLabel = make('label', 'dish-sauce-label', 'ソース・たれ');
    sauce = make('select', 'dish-sauce-select'); sauce.id = `${prefix}-sauce`; sauceLabel.htmlFor = sauce.id;
    appendOptions(sauce, definition.sauces); sauce.value = selection.sauceId; sauceLabel.append(sauce);
    const quantityField = (labelText, className, id, value, min) => {
      const label = make('label', `dish-${className}-label`, labelText);
      const input = make('input', `dish-${className}`); input.type = 'number'; input.id = `${prefix}-${id}`;
      input.min = min; input.max = '100'; input.step = 'any'; input.value = String(value);
      input.setAttribute('aria-label', `${labelText}（g）`); label.htmlFor = input.id;
      const wrap = make('span', 'dish-input-unit'); wrap.append(input, make('span', 'dish-unit', 'g')); label.append(wrap);
      configureQuantityInput(input);
      return {label, input};
    };
    const sauceField = quantityField('ソース・たれの量', 'sauce-amount', 'sauce-amount', selection.sauceAmount, '0.1');
    sauceAmount = sauceField.input; sauceAmount.disabled = sauce.value === 'none';
    const mayonnaiseField = quantityField('マヨネーズの量', 'mayonnaise-amount', 'mayonnaise-amount', selection.mayonnaiseAmount, '0');
    mayonnaiseAmount = mayonnaiseField.input;
    fields.append(sauceLabel, sauceField.label, mayonnaiseField.label); root.append(fields);
    root.append(make('p', 'dish-note', 'マヨネーズなしは0gにします。ソースやマヨネーズも栄養と買い物の材料に含めます。市販品の原材料は商品の表示も確認してください。'));
    sauce.addEventListener('change', () => {
      const option = definition.sauces.find(item => item.id === sauce.value);
      sauceAmount.disabled = sauce.value === 'none'; sauceAmount.value = String(option?.defaultAmount ?? 0);
      markCustom(); update();
    });
    sauceAmount.addEventListener('input', () => {markCustom(); update();});
    mayonnaiseAmount.addEventListener('input', () => {markCustom(); update();});
    preset.addEventListener('change', () => {
      if (preset.value !== 'custom') applyPreset(defaultDishSelection(kind, preset.value));
      update();
    });
  }

  const error = make('p', 'dish-error'); error.hidden = true;
  error.setAttribute('role', 'status'); error.setAttribute('aria-live', 'polite');
  const preview = make('div', 'dish-preview');
  const title = make('p', 'dish-preview-title');
  const nutrients = make('dl', 'dish-nutrients'), values = new Map();
  for (const key of NUTRIENT_KEYS) {
    const metric = make('div', 'dish-nutrient');
    const value = make('dd', 'dish-nutrient-value');
    metric.append(make('dt', 'dish-nutrient-label', NUTRIENT_LABELS[key]), value); nutrients.append(metric); values.set(key, value);
  }
  const allergies = make('p', 'dish-allergens');
  const materials = make('details', 'dish-materials'), materialList = make('ul', 'dish-material-list');
  materials.append(make('summary', 'dish-details-summary', '材料と分量'), materialList);
  const instructions = make('details', 'dish-instructions'), steps = make('ol', 'dish-step-list');
  instructions.open = true;
  instructions.append(make('summary', 'dish-details-summary', 'この内容での作り方'), steps);
  preview.append(title, nutrients, allergies, materials, instructions); root.append(error, preview);

  function markCustom() {if (preset) preset.value = 'custom';}
  function applyPreset(config) {
    const amounts = new Map(config.components.map(part => [part.id, part.amount]));
    for (const row of components) {
      row.checked.checked = amounts.has(row.component.id);
      row.quantity.value = String(amounts.get(row.component.id) ?? row.component.defaultAmount);
      row.remember();
      row.quantity.disabled = !row.checked.checked;
    }
    sauce.value = config.sauceId; sauceAmount.value = String(config.sauceAmount); sauceAmount.disabled = sauce.value === 'none';
    mayonnaiseAmount.value = String(config.mayonnaiseAmount);
  }
  function update() {
    try {
      const config = kind === 'nikujaga' ? {id: recipeId, kind, meat: meat.value} : {
        id: recipeId, kind, presetId: preset.value,
        components: components.filter(row => row.checked.checked).map(row => ({id: row.component.id, amount: readQuantityInput(row.quantity,{label:`${row.component.label}の量`})})),
        sauceId: sauce.value, sauceAmount: sauce.value === 'none' ? 0 : readQuantityInput(sauceAmount,{label:'ソースの量'}), mayonnaiseAmount: readQuantityInput(mayonnaiseAmount,{label:'マヨネーズの量'}),
      };
      const recipe = buildCustomDish(config, data), nutrition = recipeNutrition(recipe, data);
      error.hidden = true; error.textContent = ''; preview.hidden = false;
      title.textContent = `${recipe.name} / 1皿`;
      for (const key of NUTRIENT_KEYS) values.get(key).textContent = nutrition[key] === null ? '未入力' : `${rounded(nutrition[key])} ${NUTRIENT_UNITS[key]}`;
      const labels = (recipe.allergens ?? []).map(id => data.allergens?.find(allergen => allergen.id === id)?.label ?? id);
      allergies.textContent = `含まれる登録アレルゲン：${labels.length ? labels.join('、') : '登録なし'}。加工品や調味料は商品の表示も確認してください。`;
      materialList.replaceChildren(...recipe.ingredients.map(part => make('li', 'dish-material', `${data.ingredients[part.id].name} ${rounded(part.amount)} ${data.ingredients[part.id].unit}`)));
      steps.replaceChildren(...recipe.steps.map(step => make('li', 'dish-step', step)));
      onError(''); onChange(recipe);
    } catch (cause) {
      error.hidden = false; error.textContent = cause.message; preview.hidden = true;
      onChange(null); onError(cause.message);
    }
  }
  update();
  return root;
}
