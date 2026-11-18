/** 外で食べた料理を献立と同じ料理台帳から選び、一食分の実績にまとめます。 */
import {recipePortion} from './catalog.js';
import {recordPortionPresets} from './portion-guide.js';
import {createDiningSearch} from './dining-search.js';
import {createDiningEntry, createDiningItem, diningMatchMode} from './dining-meal.js';
import {itemFromRecipe, recipeNutrition, sumNutrition, NUTRIENT_KEYS, NUTRIENT_LABELS, NUTRIENT_UNITS} from './nutrition.js';
import {classifyNutritionBasis} from './nutrition-basis.js';
import {formatNutrient} from './nutrient-format.js';
import {configureQuantityInput, readQuantityInput, setQuantityPresets} from './quantity-input.js';

const MEALS = {breakfast:'朝食', lunch:'昼食', dinner:'夕食', snack:'間食'};
const numberText = n => String(Number(n.toFixed(4)));
const newId = () => globalThis.crypto?.randomUUID?.() ?? `dining-${Date.now()}-${Math.random().toString(36).slice(2)}`;
function make(tag, text = '', className = '') {
  const element = document.createElement(tag);
  element.textContent = text;
  element.className = className;
  return element;
}

function button(text, className, onClick) {
  const element = make('button', text, className);
  element.type = 'button';
  element.addEventListener('click', onClick);
  return element;
}

function field(container, title, control, id) {
  const label = make('label', title, 'restaurant-label');
  control.id = id;
  label.htmlFor = id;
  label.append(control);
  container.append(label);
  return control;
}

function option(select, value, name) {
  const element = make('option', name);
  element.value = value;
  select.append(element);
}

function quantity(container, name, id, value, min, max, step) {
  const input = make('input');
  input.type = 'number';
  input.value = value;
  input.min = String(min);
  input.max = String(max);
  input.required = value !== '';
  field(container, name, input, id);
  configureQuantityInput(input, {step});
  return input;
}

export function mountDiningLog({data, entries = [], date, meal = 'lunch', initialEntry = null, onSave}) {
  const searchIndex = createDiningSearch(data, entries);
  const form = make('form', '', 'restaurant-menu dining-log');
  // 閉じた手入力欄の編集中の値で食事全体の保存が妨げられないよう、それぞれ確定時に検証します。
  form.noValidate = true;
  const search = field(form, '食べた料理を検索', make('input'), 'dining-search');
  search.type = 'search';
  search.placeholder = '例　唐揚げ、焼き鮭、ご飯';
  search.maxLength = 200;
  const found = make('div', '', 'dining-found');
  const feedback = make('p', '', 'field-note');
  feedback.setAttribute('role', 'status');
  const results = make('div', '', 'dining-results');
  results.id = 'dining-results';
  const more = button('候補をもっと見る', 'button-text', () => {limit += 8; showResults();});
  more.id = 'dining-more';
  const cancelReplace = button('置き換えを取り消す', 'button-text', () => {
    replacing = null;
    search.value = '';
    showResults();
    search.focus?.();
  });
  found.append(feedback, results, more, cancelReplace);
  form.append(found);

  const selectedBox = make('section', '', 'dining-selected');
  selectedBox.append(make('h3', '食べた料理'));
  const empty = make('p', '料理を選ぶと量を調整できます。定食は主菜やご飯を一品ずつ追加できます。', 'field-note');
  const itemList = make('ul', '', 'dining-items');
  itemList.id = 'dining-items';
  selectedBox.append(empty, itemList);
  form.append(selectedBox);

  const context = make('div', '', 'restaurant-fields');
  const day = field(context, '日付', make('input'), 'dining-date');
  day.type = 'date';
  day.min = '2000-01-01';
  day.max = '2100-12-31';
  day.value = initialEntry?.date ?? date;
  day.required = true;
  const slot = field(context, '食事', make('select'), 'dining-meal');
  for (const [value, name] of Object.entries(MEALS)) option(slot, value, name);
  slot.value = initialEntry?.meal ?? meal;
  const shop = field(context, '店名（任意）', make('input'), 'dining-shop');
  shop.maxLength = 78;
  shop.placeholder = '例　大学食堂';
  const previousStores = [...new Set(initialEntry?.items.map(item => item.diningMatch?.storeName || '') ?? [])];
  shop.value = previousStores.length === 1 ? previousStores[0] : '';
  let shopEdited = false;
  shop.addEventListener('input', () => {
    shopEdited = true;
    for (const row of rows.values()) row.showBasis();
  });
  form.append(context);

  const total = make('section', '', 'record-summary');
  total.id = 'dining-total';
  total.setAttribute('aria-label', 'この食事の栄養');
  const totalHeading = make('h3', 'この食事の栄養', 'record-summary-heading');
  const totalText = make('p', '', 'record-summary-total');
  totalText.setAttribute('role', 'status');
  const nutrients = make('dl', '', 'record-summary-nutrients');
  total.append(totalHeading, totalText, nutrients);
  const problem = make('p', '', 'notice error');
  problem.setAttribute('role', 'alert');
  problem.hidden = true;
  const submit = make('button', initialEntry ? '変更を保存' : 'この食事を記録', 'button-primary');
  submit.type = 'submit';
  submit.id = 'dining-submit';
  form.append(total, problem, submit);

  const rows = new Map();
  let rowNumber = 0, limit = 6, replacing = null;

  function reportError(error) {
    problem.textContent = error.message;
    problem.hidden = false;
  }

  function updateTotals() {
    empty.hidden = rows.size > 0;
    total.hidden = !rows.size;
    submit.disabled = !rows.size;
    nutrients.replaceChildren();
    if (!rows.size) return;
    const items = [];
    for (const row of rows.values()) {
      try {
        const amount = readQuantityInput(row.amount, {label:'食べた量'});
        items.push({nutrition:row.nutrition, quantity:amount / row.portion.amount});
      } catch {
        totalText.textContent = '各料理の食べた量を入力すると合計が表示されます。';
        return;
      }
    }
    const summary = sumNutrition(items);
    const display = key => summary.knownCounts[key] ? formatNutrient(summary.values[key], key) + ' ' + NUTRIENT_UNITS[key] +
      (summary.complete[key] ? '' : ' ＋不明分') : '不明';
    totalText.textContent = rows.size + '品　' + display('kcal');
    for (const key of NUTRIENT_KEYS.filter(key => key !== 'kcal')) {
      const pair = make('div', '', 'record-summary-nutrient');
      pair.append(make('dt', NUTRIENT_LABELS[key]), make('dd', display(key)));
      nutrients.append(pair);
    }
  }

  function addRow(choice, {original = null, manual = false, replacement = null} = {}) {
    if (rows.size >= 100 && !replacement) throw Error('1回の食事に登録できる料理は100品までです。');
    const index = ++rowNumber;
    const item = choice.item;
    const frozenMatch = item?.diningMatch;
    const portion = choice.recipe ? recipePortion(choice.recipe, data) : item.portion ?? {amount:1, unit:'人分'};
    const nutrition = choice.recipe ? recipeNutrition(choice.recipe, data) : item.nutrition;
    const name = frozenMatch?.referenceName ?? choice.name;
    let defaultAmount = portion.amount * (item?.quantity ?? 1);
    if (replacement && replacement.amount > 0) {
      if (replacement.portion.unit === portion.unit) defaultAmount = replacement.amount;
      else if (['人分','食','皿'].includes(replacement.portion.unit)) {
        defaultAmount = portion.amount * replacement.amount / replacement.portion.amount;
      }
    }
    const row = make('li', '', 'dining-item-row');
    const header = make('div', '', 'dining-item-heading');
    const heading = make('strong', item?.name ?? choice.name);
    const remove = button('外す', 'button-text', () => {
      row.remove();
      rows.delete(index);
      if (replacing === index) {replacing = null; search.value = '';}
      showResults();
      problem.hidden = true;
      updateTotals();
      search.focus?.();
    });
    remove.setAttribute('aria-label', (item?.name ?? choice.name) + 'を外す');
    header.append(heading, remove);
    row.append(header);
    const note = make('p', '', 'field-note');
    const amount = quantity(row, '食べた量（' + portion.unit + '）', 'dining-amount-' + index,
      numberText(defaultAmount), 0.001, Math.min(100000, portion.amount * 1000), ['g','ml'].includes(portion.unit) ? 10 : 0.5);
    const referenceRecipe = choice.recipe ?? (item?.recipeId ? data.recipes.find(recipe => recipe.id === item.recipeId) : null);
    setQuantityPresets(amount, recordPortionPresets(referenceRecipe, portion));
    const settings = make('details', '', 'dining-row-settings');
    const source = frozenMatch ? {...item, diningMatch:undefined, nutritionBasis:frozenMatch.referenceBasis} : choice.recipe ?? item;
    const basis = classifyNutritionBasis(source, data, {snapshot:!choice.recipe});
    const canMatch = Boolean(choice.recipe || item?.recipeId || frozenMatch);
    let match, actualName;
    if (canMatch) {
      settings.append(make('summary', '店の料理名・栄養の根拠'));
      const fields = make('div', '', 'restaurant-fields');
      match = field(fields, '選んだ料理との関係', make('select'), 'dining-match-' + index);
      option(match, 'similar', '似た料理から概算');
      option(match, 'menu', '同じメニューを食べた');
      const sameMenu = Boolean(choice.recipe?.restaurant || basis.kind === 'official');
      match.value = frozenMatch?.mode ?? (choice.approximate || !sameMenu ? 'similar' : 'menu');
      actualName = field(fields, '店での料理名（任意）', make('input'), 'dining-name-' + index);
      actualName.maxLength = 120;
      actualName.placeholder = name;
      actualName.value = replacement?.dishName ?? frozenMatch?.actualName ?? '';
      if (replacement && actualName.value !== name) match.value = 'similar';
      settings.append(fields);
    }
    const showBasis = () => {
      const part = portion.label || ('基準量 ' + numberText(portion.amount) + portion.unit);
      const effectiveMode = match && diningMatchMode(choice, match.value, shop.value.trim() || (shopEdited ? '' : undefined));
      const label = effectiveMode === 'similar' ? '「' + name + '」から概算' : basis.label;
      const otherStore = match?.value === 'menu' && effectiveMode === 'similar';
      note.textContent = label + ' ／ ' + part + (otherStore ? '。店名が異なるため参考値を使います。' : '');
      heading.textContent = actualName?.value.trim() || (canMatch ? name : choice.name);
      remove.setAttribute('aria-label', heading.textContent + 'を外す');
    };
    match?.addEventListener('change', showBasis);
    actualName?.addEventListener('input', showBasis);
    showBasis();
    row.append(note);
    if (canMatch) row.append(settings);
    const replace = button('料理を探して置き換える', 'button-text dining-replace', () => {
      replacing = index;
      const dish = actualName?.value.trim() || item?.name || choice.name;
      search.value = dish.split('｜').at(-1);
      limit = 6;
      showResults();
      search.focus?.();
      search.select?.();
    });
    row.append(replace);
    rows.set(index, {choice, portion, nutrition, amount, match, actualName, original, manual, element:row, showBasis});
    itemList.append(row);
    amount.addEventListener('input', updateTotals);
    updateTotals();
  }

  function showResults() {
    const hasQuery = Boolean(search.value.trim());
    const waiting = !hasQuery && rows.size > 0 && replacing === null;
    const oldRow = rows.get(replacing);
    const matches = waiting ? [] : searchIndex(search.value, {limit:limit + 2}).filter(choice =>
      !oldRow || !(choice.item && (choice.item.id === oldRow.choice.item?.id || choice.key === oldRow.choice.key)));
    results.replaceChildren();
    cancelReplace.hidden = replacing === null;
    if (waiting) feedback.textContent = rows.size + '品を選択中。続けて料理を検索できます。';
    else if (!matches.length && hasQuery) feedback.textContent = '候補がありません。主菜の名前や材料を試してください。';
    else if (replacing !== null) feedback.textContent = '置き換える料理を選んでください。';
    else feedback.textContent = hasQuery ? '料理を選んで一食に追加' : '最近の外食・よく使う料理';
    more.hidden = matches.length <= limit;
    for (const choice of matches.slice(0, limit)) {
      const pick = button('', 'dining-pick', () => {
        try {
          const old = rows.get(replacing);
          if (old) {
            const title = old.actualName?.value.trim() || old.choice.item?.name || old.choice.name;
            const pieces = title.split('｜');
            addRow(choice, {original:old.original, replacement:{
              dishName:pieces.at(-1), amount:Number(old.amount.value), portion:old.portion,
            }});
            if (!shop.value && pieces.length > 1) shop.value = pieces.slice(0,-1).join('｜');
            old.element.remove();
            rows.delete(replacing);
            replacing = null;
            updateTotals();
          } else addRow(choice);
          problem.hidden = true;
          search.value = '';
          limit = 6;
          showResults();
          search.focus?.();
        } catch (error) { reportError(error); }
      });
      pick.setAttribute('data-choice', choice.key);
      pick.append(make('span', choice.name), make('small', choice.approximate ? choice.section + '・近い料理' : choice.section));
      results.append(pick);
    }
  }
  search.addEventListener('input', () => {limit = 6; showResults();});
  search.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      results.querySelector?.('button')?.focus();
    }
  });
  showResults();

  const manual = make('details', '', 'manual-details');
  manual.id = 'dining-manual-toggle';
  manual.append(make('summary', '見つからない料理を手入力'));
  const fields = make('div', '', 'restaurant-menu');
  const dish = field(fields, '料理名', make('input'), 'dining-dish');
  dish.maxLength = 120;
  const grid = make('div', '', 'restaurant-nutrition');
  const values = new Map(NUTRIENT_KEYS.map(key => [key, quantity(grid,
    NUTRIENT_LABELS[key] + '（' + NUTRIENT_UNITS[key] + '）', 'dining-' + key, '', 0, 1e7, key === 'kcal' ? 1 : 0.1)]));
  const manualError = make('p', '', 'notice error');
  manualError.setAttribute('role', 'alert');
  manualError.hidden = true;
  const addManual = button('この料理を追加', 'button-secondary', () => {
    try {
      if (!dish.value.trim()) throw Error('料理名を入力してください。');
      const manualNutrition = Object.fromEntries([...values].map(([key,input]) =>
        [key, readQuantityInput(input, {allowEmpty:true,label:NUTRIENT_LABELS[key]})]));
      const nutritionBasis = Object.values(manualNutrition).some(value => value !== null) ? 'manual' : 'unknown';
      const item = itemFromRecipe({name:dish.value.trim(), role:'main', servings:1, custom:true, manualNutrition,
        nutritionBasis, ingredientsKnown:false, shoppingKnown:false}, data);
      item.portion = {amount:1,unit:'人分'};
      addRow({key:item.id,name:item.name,item}, {manual:true});
      dish.value = '';
      for (const input of values.values()) input.value = '';
      manualError.hidden = true;
      problem.hidden = true;
      manual.open = false;
      showResults();
      search.focus?.();
    } catch (error) { manualError.textContent = error.message; manualError.hidden = false; }
  });
  addManual.id = 'dining-manual-add';
  fields.append(make('p', '店が表示している1人前の値を入力できます。空欄の成分は「不明」として扱います。', 'field-note'), grid, manualError, addManual);
  manual.append(fields);
  found.append(manual);

  for (const item of initialEntry?.items ?? []) addRow({key:item.id,name:item.name, item}, {original:item});
  updateTotals();
  showResults();
  form.addEventListener('submit', event => {
    event.preventDefault();
    try {
      if (!rows.size) throw Error('食べた料理を1品以上追加してください。');
      if (manual.open && (dish.value.trim() || [...values.values()].some(input => input.value.trim()))) {
        throw Error('入力中の料理は「この料理を追加」で食事に加えてください。');
      }
      const items = [...rows.values()].map(row => {
        const amount = readQuantityInput(row.amount, {label:row.choice.name + 'の食べた量'});
        if (row.manual || !row.match) {
          const item = structuredClone(row.choice.item);
          item.quantity = amount / row.portion.amount;
          if (row.manual && shop.value.trim()) item.name = shop.value.trim() + '｜' + item.name;
          if (!row.original && !row.manual) item.id = newId();
          return item;
        }
        const item = createDiningItem(row.choice, {amount, mode:row.match.value,
          actualName:row.actualName.value.trim(), storeName:shop.value.trim() || (shopEdited ? '' : undefined)}, data);
        if (row.original) item.id = row.original.id;
        return item;
      });
      const entry = createDiningEntry({date:day.value, meal:slot.value, items}, data);
      if (initialEntry) entry.id = initialEntry.id;
      problem.hidden = true;
      onSave(entry);
    } catch (error) { reportError(error); }
  });
  return form;
}
