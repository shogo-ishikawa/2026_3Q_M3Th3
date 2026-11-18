/** 食事ごとの量・主食・朝の定番を、一つの場所で指定します。 */
import {normaliseMealPreferences} from './meal-profiles.js';
import {eligibleRecipes} from './planner.js';
import {recipeFamily, recipePortion, CATALOG_CATEGORIES} from './catalog.js';
import {configureQuantityInput, readQuantityInput, setQuantityPresets} from './quantity-input.js';

const MEALS = [['breakfast', '朝食'], ['lunch', '昼食'], ['dinner', '夕食']];
const VOLUMES = [['light', '軽め'], ['normal', 'ふつう'], ['hearty', 'しっかり']];
const STAPLE_VOLUMES = [['auto', 'おかずの量に合わせる'], ['light', '少なめ'], ['normal', 'ふつう'], ['hearty', '多め']];
const SIDE_COUNTS = [['auto', 'おまかせ'], ['0', '付けない'], ['1', '1品'], ['2', '2品'], ['3', '3品']];
const SIDE_TYPES = [['auto', 'おまかせ'], ['salad', 'サラダ'], ['vegetable', '野菜の小鉢'], ['protein', '卵・豆腐などの小鉢']];
const SOUPS = [['auto', 'おまかせ'], ['none', '付けない'], ['include', '付ける']];
const MOODS = [['all', '指定しない'], ['さっぱり', 'さっぱり'], ['ガッツリ', 'ガッツリ'], ['時短', '時短'], ['定番', '定番']];
const BREAKFAST_STAPLES = [['auto', 'おまかせ'], ['rice', 'ご飯'], ['bread', 'パン'], ['rice-or-bread', 'ご飯かパン'], ['cereal', 'オートミール（シリアル）'], ['none', '主食なし'], ['fixed', 'メニューと量を指定']];
const OTHER_STAPLES = [['auto', 'おまかせ'], ['rice', 'ご飯とおかず'], ['rice-meal', '丼・チャーハンなどのご飯もの'], ['noodle', '麺類'], ['handheld', 'ハンバーガー・サンドイッチ'], ['none', '主食なし'], ['fixed', 'メニューと量を指定']];
let counter = 0;
const make = (tag, className = '', text = '') => {
  const element = document.createElement(tag); element.className = className;
  if (text) element.textContent = text;
  return element;
};
const familyLabel = recipe => CATALOG_CATEGORIES.find(group => group.id === recipeFamily(recipe))?.label ?? 'その他';

export function mountMealSettings({settings = {}, data, meals = MEALS.map(([meal]) => meal), allowEnable = true, onChange = () => {}, onError = () => {}} = {}) {
  if (!data || typeof onChange !== 'function' || typeof onError !== 'function' || !Array.isArray(meals) || !meals.length || new Set(meals).size !== meals.length || meals.some(meal => !MEALS.some(([id]) => id === meal)) || typeof allowEnable !== 'boolean') throw Error('食事ごとの設定を確認してください。');
  let profiles = normaliseMealPreferences(settings.mealPreferences, settings.preferences?.mood ?? 'all', settings);
  const available = eligibleRecipes(settings, data), allRecipes = data.recipes ?? [];
  const staples = available.filter(recipe => recipe.role === 'staple' || recipe.role === 'main' && recipe.staple);
  const drinks = available.filter(recipe => recipe.role === 'drink');
  const prefix = `meal-settings-${++counter}`, root = make('div', 'meal-settings');
  const detailsOpen = new Map(), cards = new Map();
  if (meals.length === 1) root.className += ' meal-settings-single';
  const error = make('p', 'notice error meal-settings-error'); error.hidden = true; error.setAttribute('role', 'alert');
  const report = cause => {error.textContent = cause.message; error.hidden = false; onError(cause.message);};
  const act = action => event => {try {action(event); error.hidden = true; error.textContent = '';} catch (cause) {report(cause);}};
  function update(meal, patch) {
    const next = normaliseMealPreferences({...profiles, [meal]: {...profiles[meal], ...patch}});
    const accepted = onChange(meal, structuredClone(patch)) !== false;
    if (accepted) profiles = next;
    const changesFields = ['enabled', 'staple', 'stapleId', 'drinkId', 'sideCount'].some(key => Object.hasOwn(patch, key));
    if (!accepted || changesFields) render(meal);
  }
  const field = (title, input) => {const label = make('label', 'meal-settings-field', title); label.htmlFor = input.id; label.append(input); return label;};
  const select = (meal, key, choices, value) => {
    const input = make('select', `meal-settings-${key}`); input.id = `${prefix}-${meal}-${key}`;
    for (const [id, label] of choices) {const option = make('option', '', label); option.value = id; input.append(option);}
    input.value = value; input.dataset.meal = meal; return input;
  };
  const toggle = (meal, key, text, value) => {
    const input = make('input', `meal-settings-${key}`); input.id = `${prefix}-${meal}-${key}`; input.type = 'checkbox'; input.checked = value;
    input.addEventListener('change', act(() => update(meal, {[key]: input.checked})));
    const label = make('label', 'meal-settings-toggle'); label.htmlFor = input.id; label.append(input, make('span', '', text)); return label;
  };
  function recipeSelect(meal, kind, choices, selected) {
    const input = select(meal, `${kind}Id`, [], selected), grouped = new Map();
    for (const recipe of choices) {const label = familyLabel(recipe); if (!grouped.has(label)) grouped.set(label, []); grouped.get(label).push(recipe);}
    if (kind === 'drink') {const option = make('option', '', '付けない'); option.value = 'none'; input.append(option);}
    for (const [label, recipes] of grouped) {
      const group = make('optgroup'); group.label = label;
      for (const recipe of recipes) {const option = make('option', '', recipe.name); option.value = recipe.id; group.append(option);} input.append(group);
    }
    if (!['auto', 'none'].includes(selected) && !choices.some(recipe => recipe.id === selected)) {
      const recipe = allRecipes.find(recipe => recipe.id === selected), option = make('option', '', `${recipe?.name ?? '選択済みメニュー'}（除外条件を確認）`);
      option.value = selected; option.disabled = true; input.append(option);
    }
    input.value = selected;
    input.addEventListener('change', act(() => update(meal, {[`${kind}Id`]: input.value, [`${kind}Amount`]: null})));
    return input;
  }
  function quantityField(meal, kind, recipe, value) {
    const portion = recipePortion(recipe, data), input = make('input', `meal-settings-${kind}Amount`);
    input.id = `${prefix}-${meal}-${kind}Amount`; input.type = 'number'; input.required = true; input.min = '0.001'; input.max = '100000'; input.step = 'any';
    input.value = String(value ?? portion.amount); input.setAttribute('aria-label', `${MEALS.find(([id]) => id === meal)[1]}の${kind === 'staple' ? '主食' : '飲み物'}の量（${portion.unit}）`);
    configureQuantityInput(input);
    input.addEventListener('change', act(() => update(meal, {[`${kind}Amount`]: readQuantityInput(input)})));
    const label = field(`量（${portion.unit}）`, input);
    if (portion.unit === 'g' && recipeFamily(recipe) === 'rice') setQuantityPresets(input, [{label: '小盛り 100g', value: 100}, {label: 'ふつう 150g', value: 150}, {label: '大盛り 200g', value: 200}]);
    if (kind === 'drink' && portion.unit === 'ml') setQuantityPresets(input, [100, 150, 200].map(amount => ({label: `${amount}ml`, value: amount})));
    return label;
  }
  function render(targetMeal) {
    // ほかの食事で入力中の量や、キーボードで操作している欄を保ちます。
    const focused = document.activeElement;
    const focusId = focused?.id && cards.get(targetMeal)?.contains?.(focused) ? focused.id : null;
    for (const [meal, title] of MEALS) {
      if (!meals.includes(meal) || (targetMeal && meal !== targetMeal)) continue;
      const choice = profiles[meal];
      let card = cards.get(meal);
      if (!card) {
        card = make('fieldset', 'meal-settings-card'); card.dataset.meal = meal;
        cards.set(meal, card); root.append(card);
      }
      card.replaceChildren();
      card.append(make('legend', '', title));
      if (allowEnable) card.append(toggle(meal, 'enabled', `${title}を提案する`, choice.enabled));
      if (allowEnable && !choice.enabled) continue;
      const pair = make('div', 'meal-settings-pair');
      const volume = select(meal, 'volume', VOLUMES, choice.volume), mood = select(meal, 'mood', MOODS, choice.mood);
      volume.addEventListener('change', act(() => update(meal, {volume: volume.value})));
      mood.addEventListener('change', act(() => update(meal, {mood: mood.value})));
      pair.append(field('おかずの量', volume), field('料理の傾向', mood)); card.append(pair);
      const modes = meal === 'breakfast' ? BREAKFAST_STAPLES : OTHER_STAPLES;
      const choices = modes.some(([id]) => id === choice.staple) ? modes : [...modes, [choice.staple, choice.staple === 'bread' ? 'パン' : choice.staple === 'rice-or-bread' ? 'ご飯かパン' : 'オートミール（シリアル）']];
      const mode = select(meal, 'staple', choices, choice.staple);
      mode.addEventListener('change', act(() => {
        if (mode.value === 'fixed') {
          const recipe = staples.find(recipe => recipe.id === choice.stapleId) ?? staples.find(recipe => recipe.id === 'plain-rice') ?? staples[0];
          if (!recipe) throw Error('条件に合う主食がありません。避ける食材の設定を確認してください。');
          update(meal, {staple: 'fixed', stapleId: recipe.id, stapleAmount: null});
        } else update(meal, {staple: mode.value, stapleId: 'auto', stapleAmount: null});
      }));
      card.append(field('主食の種類', mode));
      if (!['none', 'fixed'].includes(choice.staple)) {
        const stapleVolume = select(meal, 'stapleVolume', STAPLE_VOLUMES, choice.stapleVolume);
        stapleVolume.addEventListener('change', act(() => update(meal, {stapleVolume: stapleVolume.value})));
        card.append(field('主食の量', stapleVolume));
      }
      if (choice.staple === 'fixed') {
        const fixed = make('div', 'meal-settings-fixed'), recipe = allRecipes.find(recipe => recipe.id === choice.stapleId);
        fixed.append(field('具体的なメニュー', recipeSelect(meal, 'staple', staples, choice.stapleId)));
        if (recipe) fixed.append(quantityField(meal, 'staple', recipe, choice.stapleAmount)); card.append(fixed);
      }
      if (meal === 'breakfast' || choice.drinkId !== 'none') {
        const drink = recipeSelect(meal, 'drink', drinks, choice.drinkId); card.append(field('いつもの飲み物', drink));
        const selectedDrink = allRecipes.find(recipe => recipe.id === choice.drinkId);
        if (selectedDrink) card.append(quantityField(meal, 'drink', selectedDrink, choice.drinkAmount));
      }
      if (meal === 'breakfast') {
        const extras = make('div', 'meal-settings-extras'); extras.append(toggle(meal, 'yogurt', 'ヨーグルトを付ける', choice.yogurt), toggle(meal, 'fruit', '果物を付ける', choice.fruit)); card.append(extras);
      }
      const details = make('details', 'meal-settings-details'); details.open = detailsOpen.get(meal) ?? false;
      details.addEventListener('toggle', () => detailsOpen.set(meal, details.open));
      details.append(make('summary', '', '副菜・汁物の詳細設定'));
      const sidePair = make('div', 'meal-settings-pair');
      const sideCount = select(meal, 'sideCount', SIDE_COUNTS, String(choice.sideCount));
      sideCount.addEventListener('change', act(() => update(meal, {sideCount: sideCount.value === 'auto' ? 'auto' : Number(sideCount.value)})));
      const sideType = select(meal, 'sideType', SIDE_TYPES, choice.sideType); sideType.disabled = choice.sideCount === 0;
      sideType.addEventListener('change', act(() => update(meal, {sideType: sideType.value})));
      sidePair.append(field('副菜の数', sideCount), field('1品目の副菜', sideType));
      const soup = select(meal, 'soup', SOUPS, choice.soup);
      soup.addEventListener('change', act(() => update(meal, {soup: soup.value})));
      details.append(sidePair, field('汁物', soup));
      card.append(details);
    }
    if (focusId) document.getElementById(focusId)?.focus({preventScroll: true});
  }
  render(); root.append(error); return root;
}
