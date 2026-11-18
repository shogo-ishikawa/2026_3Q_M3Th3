/** 外食の実績を献立と別に記録し、次回は同じ料理を履歴から選べるようにします。 */
import {dateIsValid, MEAL_IDS} from './journal.js';
import {recipePortion} from './catalog.js';
import {itemFromRecipe, recipeNutrition, NUTRIENT_KEYS, NUTRIENT_LABELS, NUTRIENT_UNITS} from './nutrition.js';
import {createCatalogEntry} from './record-actions.js';
import {formatNutrient} from './nutrient-format.js';
import {matchesJapaneseQuery} from './japanese-search.js';
import {configureQuantityInput, readQuantityInput} from './quantity-input.js';

const diningNote = '外食';
const newId = () => globalThis.crypto?.randomUUID?.() ?? `dining-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const make = (tag, text = '', className = '') => {
  const element = document.createElement(tag);
  element.textContent = text;
  element.className = className;
  return element;
};

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

function diningChoices(data, entries) {
  const recipes = data.recipes.filter(recipe => recipe.restaurant || recipe.custom ||
    recipe.nature === 'fast-food' || recipe.id.startsWith('takeaway-'));
  const available = new Set(recipes.map(recipe => recipe.id));
  const history = [];
  const seen = new Set();
  // 新しい記録を優先し、現在も登録されている店の表示値は最新の登録から読みます。
  const recent = entries.filter(entry => entry.status === 'eaten' && (entry.note === diningNote || entry.items.some(item => item.restaurant)))
    .reverse().sort((a, b) => b.date.localeCompare(a.date));
  for (const entry of recent) {
    for (const item of entry.items) {
      if ((entry.note !== diningNote && !item.restaurant) || available.has(item.recipeId) || seen.has(item.name)) continue;
      seen.add(item.name);
      history.push({key: `history-${item.id}`, name: item.name, section: '最近の外食', item});
    }
  }
  const priority = recipe => recipe.restaurant ? 0 : recipe.custom ? 1 : recipe.nature === 'fast-food' ? 2 : 3;
  recipes.sort((a, b) => priority(a) - priority(b));
  return [...history, ...recipes.map(recipe => ({
    key: `recipe-${recipe.id}`, name: recipe.name,
    section: recipe.restaurant ? '店別メニュー' : recipe.custom ? 'マイメニュー' : '商品・外食の例', recipe,
  }))];
}

export function mountDiningLog({data, entries = [], date, meal = 'lunch', onSave}) {
  const form = make('form', '', 'restaurant-menu dining-log');
  const when = make('div', '', 'restaurant-fields');
  const day = field(when, '日付', make('input'), 'dining-date');
  day.type = 'date';
  day.min = '2000-01-01';
  day.max = '2100-12-31';
  day.value = date;
  day.required = true;
  const slot = field(when, '食事', make('select'), 'dining-meal');
  for (const [value, name] of Object.entries({breakfast:'朝食', lunch:'昼食', dinner:'夕食', snack:'間食'})) option(slot, value, name);
  slot.value = meal;
  form.append(when);
  const mode = field(form, '記録方法', make('select'), 'dining-mode');
  option(mode, 'manual', '料理名を入力');
  option(mode, 'saved', '履歴・登録メニューから選ぶ');
  mode.value = 'manual';

  const manual = make('div', '', 'restaurant-menu');
  const names = make('div', '', 'restaurant-fields');
  const dish = field(names, '料理名', make('input'), 'dining-dish');
  dish.required = true;
  dish.maxLength = 120;
  dish.placeholder = '例　焼き魚定食';
  const shop = field(names, '店名（任意）', make('input'), 'dining-shop');
  shop.maxLength = 78;
  shop.placeholder = '例　大学食堂';
  const details = make('details', '', 'manual-details');
  const nutrition = make('div', '', 'restaurant-nutrition');
  const values = new Map(NUTRIENT_KEYS.map(key => [
    key, quantity(nutrition, `${NUTRIENT_LABELS[key]}（${NUTRIENT_UNITS[key]}）`, `dining-${key}`, '', 0, 1e7, key === 'kcal' ? 1 : 0.1),
  ]));
  const servings = quantity(nutrition, '食べた量（人前）', 'dining-servings', '1', 0.001, 1000, 0.5);
  details.append(make('summary', '栄養表示・食べた量（任意）'),
    make('p', '料理1人前の表示値を入力します。分からない成分は空欄にしてください。', 'field-note'), nutrition);
  manual.append(names, details);

  const saved = make('div', '', 'restaurant-menu');
  const search = field(saved, '店名・料理名を検索', make('input'), 'dining-search');
  search.type = 'search';
  const select = field(saved, 'メニュー', make('select'), 'dining-choice');
  const note = make('p', '', 'field-note');
  note.setAttribute('role', 'status');
  const amountGroup = make('div', '', 'restaurant-fields');
  const amount = quantity(amountGroup, '食べた量', 'dining-amount', '1', 0.001, 100000, 1);
  const unitText = make('p', '', 'field-note');
  amountGroup.append(unitText);
  saved.append(note, amountGroup);
  const choices = diningChoices(data, entries);
  let selected = null;
  function selectChoice() {
    selected = choices.find(choice => choice.key === select.value) ?? null;
    amountGroup.hidden = !selected;
    amount.disabled = !selected;
    if (!selected) return;
    const portion = selected.recipe ? recipePortion(selected.recipe, data) : selected.item.portion ?? {amount:1, unit:'人分'};
    amount.value = String(selected.item ? Number((selected.item.quantity * portion.amount).toFixed(4)) : portion.amount);
    amount.setCustomValidity?.('');
    amount.setAttribute('aria-label', `食べた量（${portion.unit}）`);
    unitText.textContent = `単位　${portion.unit}`;
    const kcal = selected.recipe ? recipeNutrition(selected.recipe, data).kcal : selected.item.nutrition.kcal;
    const energy = kcal == null ? 'エネルギー不明' : `${formatNutrient(kcal, 'kcal')} kcal`;
    const source = selected.recipe?.restaurant?.inclusion || portion.label;
    note.textContent = [`基準量　${portion.amount}${portion.unit}（${energy}）`, source].filter(Boolean).join('　');
  }
  function filterChoices() {
    const matches = choices.filter(choice => matchesJapaneseQuery([choice.name, choice.recipe?.restaurant?.storeName], search.value));
    const previous = select.value;
    select.replaceChildren();
    option(select, '', matches.length ? 'メニューを選んでください' : '該当するメニューがありません');
    for (const choice of matches) option(select, choice.key, `${choice.section}　${choice.name}`);
    select.value = matches.some(choice => choice.key === previous) ? previous : '';
    if (selected && select.value === selected.key) return;
    note.textContent = matches.length ? '' : '「料理名を入力」に切り替えると、この料理を記録できます。';
    selectChoice();
  }
  search.addEventListener('input', filterChoices);
  select.addEventListener('change', () => {note.textContent = ''; selectChoice();});
  filterChoices();

  const error = make('p', '', 'notice error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  function switchMode() {
    const manualMode = mode.value === 'manual';
    manual.hidden = !manualMode;
    saved.hidden = manualMode;
    // 表示していない側の必須欄・入力エラーで送信が遮られないようにします。
    for (const input of [dish, shop, servings, ...values.values()]) input.disabled = !manualMode;
    select.disabled = manualMode;
    amount.disabled = manualMode || !selected;
    error.hidden = true;
  }
  mode.addEventListener('change', switchMode);
  switchMode();
  const submit = make('button', '食べたものを記録', 'button-primary');
  submit.type = 'submit';
  form.append(manual, saved, error, submit);
  form.addEventListener('submit', event => {
    event.preventDefault();
    try {
      if (!dateIsValid(day.value) || !MEAL_IDS.includes(slot.value)) throw Error('記録する日付と食事を確認してください。');
      const context = {date:day.value, meal:slot.value, status:'eaten', note:diningNote};
      let entry;
      if (mode.value === 'manual') {
        if (!dish.value.trim()) throw Error('料理名を入力してください。');
        const name = [shop.value.trim(), dish.value.trim()].filter(Boolean).join('｜');
        const manualNutrition = Object.fromEntries([...values].map(([key, input]) =>
          [key, readQuantityInput(input, {label:NUTRIENT_LABELS[key], allowEmpty:true})]));
        const hasNutrition = Object.values(manualNutrition).some(value => value !== null);
        const item = itemFromRecipe({name, role:'main', servings:1, custom:true, manualNutrition,
          nutritionBasis:hasNutrition ? 'manual' : 'unknown', ingredientsKnown:false, shoppingKnown:false},
          data, readQuantityInput(servings, {label:'食べた量'}));
        item.portion = {amount:1, unit:'人分'};
        entry = {...context, id:newId(), items:[item]};
      } else {
        if (!selected) throw Error('記録するメニューを選んでください。');
        const eaten = readQuantityInput(amount, {label:'食べた量'});
        if (selected.recipe) {
          entry = createCatalogEntry({...context, recipeId:selected.recipe.id, amount:eaten}, data);
        } else {
          const item = structuredClone(selected.item);
          item.id = newId();
          item.quantity = eaten / (item.portion?.amount ?? 1);
          entry = {...context, id:newId(), items:[item]};
        }
      }
      error.hidden = true;
      onSave(entry);
    } catch (problem) {
      error.textContent = problem.message;
      error.hidden = false;
    }
  });
  return form;
}
