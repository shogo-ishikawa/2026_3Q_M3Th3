/** サラダの選択画面。計算と入力検査は salad-builder.js にまとめています。 */
import {SALAD_COMPONENTS, SALAD_DRESSINGS, buildSaladRecipe} from './salad-builder.js';
import {NUTRIENT_KEYS, NUTRIENT_LABELS, NUTRIENT_UNITS, recipeNutrition} from './nutrition.js';
import {configureQuantityInput, readQuantityInput} from './quantity-input.js';

let builderCount = 0;
const rounded = value => Math.round(value * 100) / 100;
const make = (tag, className = '', text = '') => {
  const element = document.createElement(tag);
  element.className = className;
  if (text) element.textContent = text;
  return element;
};

/** 初期値は既存の生野菜サラダと同じ1人分。配合をDBの別メニューへ列挙しません。 */
export function defaultSaladSelection() {
  return {
    components: [
      {id: 'lettuce', amount: 50}, {id: 'cabbage', amount: 50},
      {id: 'cucumber', amount: 30}, {id: 'tomato', amount: 50},
      {id: 'carrot', amount: 15},
    ],
    dressingId: 'none', dressingAmount: 0,
  };
}

/**
 * 独自のformは作らず、料理詳細のカレンダー登録フォームと共存します。
 * onChange は生成時と入力変更時に呼び、入力不備があればnullを渡します。
 */
export function mountSaladBuilder({data, initial, onChange = () => {}, onError = () => {}, onSelectionChange = () => {}} = {}) {
  if (typeof onChange !== 'function' || typeof onError !== 'function' || typeof onSelectionChange !== 'function') throw Error('サラダの表示処理を確認してください。');
  const prefix = `salad-builder-${++builderCount}`;
  const selection = initial === undefined ? defaultSaladSelection() : initial;
  // 初期設定に未知の材料や重複があっても、画面で黙って捨てません。
  const firstRecipe = buildSaladRecipe(selection, data);
  const recipeId = firstRecipe.id;
  const amounts = new Map(selection.components.map(part => [part.id, part.amount]));
  const root = make('div', 'salad-builder');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'サラダの材料とドレッシング');
  root.append(make('h3', 'salad-title', '材料とドレッシングを選ぶ'));
  root.append(make('p', 'salad-intro', '各材料は1皿分です。ブロッコリーはゆでて水気を切った後の重さで入力します。選んだ材料から栄養と買い物の量を計算します。'));

  const vegetables = make('fieldset', 'salad-vegetables');
  vegetables.append(make('legend', 'salad-legend', '野菜'));
  const grid = make('div', 'salad-component-grid');
  const controls = [];
  for (const component of SALAD_COMPONENTS) {
    const row = make('div', 'salad-component');
    const choice = make('label', 'salad-component-choice');
    const checked = make('input', 'salad-component-check');
    checked.type = 'checkbox';
    checked.id = `${prefix}-${component.id}-checked`;
    checked.checked = amounts.has(component.id);
    choice.htmlFor = checked.id;
    choice.append(checked, make('span', 'salad-component-name', component.label));
    const quantityLabel = make('label', 'salad-component-quantity');
    const quantity = make('input', 'salad-component-amount');
    quantity.type = 'number';
    quantity.id = `${prefix}-${component.id}-amount`;
    quantity.min = '0'; quantity.max = '1000'; quantity.step = 'any';
    quantity.value = String(amounts.get(component.id) ?? component.defaultAmount);
    quantity.disabled = !checked.checked;
    quantity.setAttribute('aria-label', `${component.label}の量（g）`);
    quantityLabel.htmlFor = quantity.id;
    quantityLabel.append(quantity, make('span', 'salad-unit', 'g'));
    row.append(choice, quantityLabel);
    if (component.preparation) row.append(make('small', 'salad-preparation', component.preparation));
    const control = {component, checked, quantity, lastPositive: quantity.value};
    controls.push(control);
    checked.addEventListener('change', () => {
      if (checked.checked) {try {if (readQuantityInput(quantity) <= 0) quantity.value = control.lastPositive;} catch {quantity.value = control.lastPositive;}}
      quantity.disabled = !checked.checked; update();
    });
    quantity.addEventListener('input', () => {
      try {
        const value = readQuantityInput(quantity, {label: `${component.label}の量`});
        if (value === 0) {checked.checked = false; quantity.disabled = true;}
        else control.lastPositive = quantity.value;
      } catch {/* 空欄や不正値は選択解除せず、登録できない状態を表示します。 */}
      update();
    });
    grid.append(row);
    configureQuantityInput(quantity);
  }
  vegetables.append(grid);
  root.append(vegetables);

  const dressingFields = make('div', 'salad-dressing-fields');
  const dressingLabel = make('label', 'salad-dressing-label', 'ドレッシング');
  const dressing = make('select', 'salad-dressing-select');
  dressing.id = `${prefix}-dressing`;
  dressingLabel.htmlFor = dressing.id;
  for (const option of SALAD_DRESSINGS) {
    const element = make('option', '', option.label);
    element.value = option.id; dressing.append(element);
  }
  dressing.value = selection.dressingId;
  dressingLabel.append(dressing);
  const dressingAmountLabel = make('label', 'salad-dressing-quantity', 'ドレッシングの量');
  const dressingAmount = make('input', 'salad-dressing-amount');
  dressingAmount.type = 'number';
  dressingAmount.id = `${prefix}-dressing-amount`;
  dressingAmount.min = '0'; dressingAmount.max = '300'; dressingAmount.step = 'any';
  dressingAmount.value = String(selection.dressingAmount);
  dressingAmount.disabled = dressing.value === 'none';
  dressingAmount.setAttribute('aria-label', 'ドレッシングの量（g）');
  dressingAmountLabel.htmlFor = dressingAmount.id;
  const dressingInputUnit = make('span', 'salad-input-unit');
  dressingInputUnit.append(dressingAmount, make('span', 'salad-unit', 'g'));
  dressingAmountLabel.append(dressingInputUnit);
  dressingFields.append(dressingLabel, dressingAmountLabel);
  root.append(dressingFields);
  configureQuantityInput(dressingAmount);
  root.append(make('p', 'salad-note', 'ドレッシングは家庭用の配合です。市販品は原材料や栄養が異なるため、商品の表示に合わせて別途登録してください。'));

  const error = make('p', 'salad-error');
  error.setAttribute('role', 'status'); error.setAttribute('aria-live', 'polite'); error.hidden = true;
  const preview = make('div', 'salad-preview');
  const previewTitle = make('p', 'salad-preview-title');
  const nutrients = make('dl', 'salad-nutrients');
  const nutrientValues = new Map();
  for (const key of NUTRIENT_KEYS) {
    const metric = make('div', 'salad-nutrient');
    const value = make('dd', 'salad-nutrient-value');
    metric.append(make('dt', 'salad-nutrient-label', NUTRIENT_LABELS[key]), value);
    nutrients.append(metric); nutrientValues.set(key, value);
  }
  const allergies = make('p', 'salad-allergens');
  const details = make('details', 'salad-composition');
  const materialList = make('ul', 'salad-material-list');
  details.append(make('summary', 'salad-composition-summary', '選んだ材料と分量'), materialList);
  preview.append(previewTitle, nutrients, allergies, details);
  root.append(error, preview);
  dressing.addEventListener('change', () => {
    const selected = SALAD_DRESSINGS.find(option => option.id === dressing.value);
    dressingAmount.disabled = dressing.value === 'none';
    dressingAmount.value = String(selected?.defaultAmount ?? 0);
    update();
  });
  dressingAmount.addEventListener('input', () => {
    try {if (readQuantityInput(dressingAmount, {label: 'ドレッシングの量'}) === 0) {dressing.value = 'none'; dressingAmount.disabled = true;}} catch {}
    update();
  });

  function update() {
    try {
      const config = {
        id: recipeId,
        components: controls.filter(row => row.checked.checked)
          .map(row => ({id: row.component.id, amount: readQuantityInput(row.quantity, {label: `${row.component.label}の量`})})),
        dressingId: dressing.value,
        dressingAmount: dressing.value === 'none' ? 0 : readQuantityInput(dressingAmount, {label: 'ドレッシングの量'}),
      };
      const recipe = buildSaladRecipe(config, data);
      const values = recipeNutrition(recipe, data);
      error.textContent = ''; error.hidden = true; preview.hidden = false;
      previewTitle.textContent = `${recipe.name} / 1皿`;
      for (const key of NUTRIENT_KEYS) nutrientValues.get(key).textContent = values[key] === null ? '未入力' : `${rounded(values[key])} ${NUTRIENT_UNITS[key]}`;
      const allergenLabels = (recipe.allergens ?? []).map(id => data.allergens?.find(allergen => allergen.id === id)?.label ?? id);
      allergies.textContent = `含まれる登録アレルゲン：${allergenLabels.length ? allergenLabels.join('、') : '登録なし'}。調味料の原材料は商品表示も確認してください。`;
      materialList.replaceChildren(...recipe.ingredients.map(part => make('li', 'salad-material', `${data.ingredients[part.id].name} ${rounded(part.amount)} ${data.ingredients[part.id].unit}`)));
      onError(''); onSelectionChange(structuredClone(config));onChange(recipe);
    } catch (cause) {
      error.textContent = cause.message; error.hidden = false; preview.hidden = true;
      onSelectionChange(null);onChange(null); onError(cause.message);
    }
  }
  update();
  return root;
}
