/** 提案した献立のうち、選んだ一食だけを調整する画面です。 */
import {eligiblePlanDishChoices, GENRES} from './planner.js';
import {CATALOG_CATEGORIES, recipeFamily, recipePortion, quantityFromAmount} from './catalog.js';
import {dishClassification} from './dish-hierarchy.js';
import {matchesJapaneseQuery} from './japanese-search.js';
import {normaliseMealPreferences} from './meal-profiles.js';
import {mountMealSettings} from './meal-settings-ui.js';
import {configureQuantityInput, readQuantityInput, setQuantityPresets} from './quantity-input.js';

const MEALS = {breakfast: '朝食', lunch: '昼食', dinner: '夕食'};
const TYPES = [['side', '小鉢・副菜'], ['salad', 'サラダ'], ['yoghurt', 'ヨーグルト'], ['fruit', '果物'], ['main', '主菜'], ['staple', '主食'], ['soup', '汁物'], ['drink', '飲み物'], ['snack', '間食・デザート']];
let mountCount = 0;
const make = (tag, className = '', text = '') => {
  const element = document.createElement(tag); element.className = className;
  if (text) element.textContent = text;
  return element;
};
const field = (text, input) => {const label = make('label', 'plan-editor-field', text); label.htmlFor = input.id; label.append(input); return label;};
const choices = (input, values, selected) => {
  input.replaceChildren(...values.map(([id, text]) => {const option = make('option', '', text); option.value = id; return option;}));
  input.value = selected;
};
const checkDay = day => {
  if (!day || !Object.hasOwn(MEALS, day.meal) || !Array.isArray(day.recipeIds)) throw Error('調整する献立を選んでください。');
};
const callbacks = (...values) => {if (values.some(value => typeof value !== 'function')) throw Error('献立の更新処理を確認してください。');};
function errorHandling(root, onError) {
  const notice = make('p', 'notice error plan-editor-error'); notice.hidden = true; notice.setAttribute('role', 'alert');
  const report = cause => {notice.textContent = cause.message ?? String(cause); notice.hidden = false; onError(notice.textContent);};
  const act = fn => event => {try {fn(event); notice.textContent = ''; notice.hidden = true;} catch (cause) {report(cause);}};
  root.append(notice); return {notice, report, act};
}
const isType = (recipe, type) => {
  const family = recipeFamily(recipe), section = CATALOG_CATEGORIES.find(item => item.id === family)?.role ?? recipe.role;
  if (type === 'salad') return recipe.role === 'side' && dishClassification(recipe).method === 'salad';
  if (type === 'yoghurt' || type === 'fruit') return family === type;
  if (type === 'staple') return section === 'staple' || recipe.staple;
  if (type === 'main') return recipe.role === 'main' && !recipe.staple && section !== 'staple';
  return recipe.role === type;
};
function amountPresets(recipe, portion) {
  const family = recipeFamily(recipe);
  if (family === 'rice' && portion.unit === 'g') return [100, 150, 200].map((value, index) => ({label: `${['小盛り', 'ふつう', '大盛り'][index]} ${value}g`, value}));
  if (portion.unit === '枚') return [{label: '半枚', value: .5}, {label: '1枚', value: 1}, {label: '1枚半', value: 1.5}];
  if (portion.unit === '皿' || portion.unit === '人分') return [{label: '少なめ', value: portion.amount / 2}, {label: 'ふつう', value: portion.amount}, {label: '多め', value: portion.amount * 1.5}];
  if (portion.unit === 'ml') return [100, 150, 200].map(value => ({label: `${value}ml`, value}));
  return [];
}

/** onAdd({recipeId, quantity})のquantityはレシピ1人分に対する倍率です。 */
export function mountPlanDishPicker({settings = {}, data, day, initialCategory = 'side', onAdd = () => {}, onError = () => {}} = {}) {
  checkDay(day); callbacks(onAdd, onError);
  if (!TYPES.some(([id]) => id === initialCategory)) throw Error('追加する料理の種類を確認してください。');
  const prefix = `plan-dish-${++mountCount}`, root = make('form', 'plan-dish-picker');
  root.setAttribute('aria-label', `${MEALS[day.meal]}に料理を追加`);
  const {notice, act} = errorHandling(root, onError);
  const existing = new Set(day.recipeIds.filter(id => !(day.omittedRecipeIds ?? []).includes(id)));
  const available = eligiblePlanDishChoices(settings, day, data).filter(recipe => !existing.has(recipe.id));
  const type = make('select', 'plan-dish-type'); type.id = `${prefix}-type`; choices(type, TYPES, initialCategory);
  const search = make('input', 'plan-dish-search'); search.id = `${prefix}-search`; search.type = 'search'; search.maxLength = 120; search.placeholder = '料理名や食材で検索';
  const menu = make('select', 'plan-dish-menu'); menu.id = `${prefix}-menu`; menu.required = true;
  const controls = make('div', 'plan-editor-fields'); controls.append(field('追加するもの', type), field('検索', search));
  const menuLabel = field('メニュー', menu), amount = make('input', 'plan-dish-amount'); amount.id = `${prefix}-amount`; amount.type = 'number'; amount.required = true; amount.min = '0.001'; amount.step = 'any';
  const amountLabel = field('1人分に追加する量', amount), unit = make('span', 'plan-dish-unit'); amountLabel.append(unit);
  const portionNote = make('p', 'field-note plan-dish-portion'), empty = make('p', 'field-note plan-dish-empty'); empty.hidden = true;
  const submit = make('button', 'button-primary plan-dish-submit', 'この献立に追加'); submit.type = 'submit';
  root.replaceChildren(controls, menuLabel, amountLabel, portionNote, empty, notice, submit);
  function updateAmount() {
    const recipe = available.find(recipe => recipe.id === menu.value), disabled = !recipe;
    submit.disabled = amount.disabled = disabled; amountLabel.hidden = portionNote.hidden = disabled;
    if (!recipe) {unit.textContent = ''; amount.value = ''; setQuantityPresets(amount, []); return;}
    const portion = recipePortion(recipe, data);
    amount.value = String(portion.amount); amount.max = String(portion.amount * 1000);
    amount.setAttribute('aria-label', `1人分に追加する量（${portion.unit}）`);
    unit.textContent = portion.unit;
    configureQuantityInput(amount, {step: portion.unit === 'g' ? 5 : portion.unit === 'ml' ? 50 : .5});
    setQuantityPresets(amount, amountPresets(recipe, portion)); portionNote.textContent = portion.label;
  }
  function updateMenus() {
    const query = search.value ?? '', prior = menu.value;
    const menus = available.filter(recipe => isType(recipe, type.value) && matchesJapaneseQuery([recipe.name, ...(recipe.searchAliases ?? []), ...recipe.ingredients.map(part => part.name ?? part.id)], query));
    const grouped = new Map();
    for (const recipe of menus) {
      const family = recipeFamily(recipe), label = CATALOG_CATEGORIES.find(item => item.id === family)?.label ?? 'その他';
      if (!grouped.has(label)) grouped.set(label, []); grouped.get(label).push(recipe);
    }
    menu.replaceChildren();
    for (const [label, recipes] of grouped) {
      const group = make('optgroup'); group.label = label;
      for (const recipe of recipes) {const option = make('option', '', recipe.name); option.value = recipe.id; group.append(option);} menu.append(group);
    }
    menu.value = menus.some(recipe => recipe.id === prior) ? prior : menus[0]?.id ?? '';
    menu.disabled = !menus.length; empty.hidden = !!menus.length;
    empty.textContent = menus.length ? '' : '候補がありません。種類や検索語を変えてください。';
    updateAmount();
  }
  type.addEventListener('change', act(updateMenus)); search.addEventListener('input', act(updateMenus)); menu.addEventListener('change', act(updateAmount));
  root.addEventListener('submit', act(event => {
    event.preventDefault();
    const recipe = available.find(recipe => recipe.id === menu.value);
    if (!recipe || !isType(recipe, type.value)) throw Error('追加するメニューを選んでください。');
    const quantity = quantityFromAmount(recipe, data, readQuantityInput(amount, {label: '追加する量'}));
    onAdd({recipeId: recipe.id, quantity});
  }));
  updateMenus(); return root;
}

/** 指定した一食の条件を返します。共通設定や元の献立はここでは変更しません。 */
export function mountPlanMealEditor({settings = {}, data, day, mealPreference, onApply = () => {}, onError = () => {}} = {}) {
  checkDay(day); callbacks(onApply, onError);
  const prefix = `plan-meal-${++mountCount}`, root = make('form', 'plan-meal-editor');
  root.setAttribute('aria-label', `${MEALS[day.meal]}の条件を変更`);
  const {notice, report, act} = errorHandling(root, onError);
  const profiles = normaliseMealPreferences(settings.mealPreferences, settings.preferences?.mood ?? 'all', settings);
  profiles[day.meal] = {...profiles[day.meal], ...(day.mealPreference ?? {}), ...(mealPreference ?? {}), enabled: true};
  const local = {...settings, mealPreferences: normaliseMealPreferences(profiles)};
  const genre = make('select', 'plan-meal-genre'); genre.id = `${prefix}-genre`;
  choices(genre, [['all', 'おまかせ'], ...GENRES.map(id => [id, id])], GENRES.includes(day.targetGenre) ? day.targetGenre : 'all');
  const editor = mountMealSettings({settings: local, data, meals: [day.meal], allowEnable: false,
    onChange: (meal, patch) => {local.mealPreferences[meal] = {...local.mealPreferences[meal], ...structuredClone(patch)};},
    onError: message => report(Error(message))});
  const submit = make('button', 'button-primary plan-meal-submit', 'この条件で献立を作り直す'); submit.type = 'submit';
  root.replaceChildren(make('p', 'field-note', 'この一食だけに適用します。'), field('料理のジャンル', genre), editor, notice, submit);
  root.addEventListener('submit', act(event => {
    event.preventDefault();
    if (genre.value !== 'all' && !GENRES.includes(genre.value)) throw Error('料理のジャンルを選んでください。');
    onApply({mealPreference: structuredClone(local.mealPreferences[day.meal]), genre: genre.value});
  }));
  return root;
}
