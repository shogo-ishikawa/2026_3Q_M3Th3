import {ALLERGENS, INGREDIENTS, RECIPES} from './data.js';
import {generatePlan, replaceRecipe, toggleDish, describeRecipe, eligibleRecipes, shoppingList, analyseHistory} from './planner.js';
import {GROUP_IDS, GENRES, STORAGE_KEY, localDate, rebalanceGenreRatios, validateState, parseState, readState, writeState} from './storage.js';

const data = {recipes: RECIPES, ingredients: INGREDIENTS, allergens: ALLERGENS};
const GROUP_NAMES = {staple: '主食', vegetable: '野菜などの副菜', protein: '肉・魚・卵・大豆', dairy: '牛乳・乳製品', fruit: '果物'};
const SHORT_GROUP_NAMES = {staple: '主食', vegetable: '副菜', protein: '主菜', dairy: '乳製品', fruit: '果物'};
const PROTEIN_NAMES = {meat: '肉', fish: '魚介', egg: '卵', soy: '大豆製品'};
const ROLE_NAMES = {main: '主菜', side: '副菜', soup: '汁物', staple: '主食'};
const MEAL_NAMES = {breakfast: '朝食', lunch: '昼食', dinner: '夕食', snack: '間食'};
const allergenNames = new Map(ALLERGENS.map(item => [item.id, item.label]));
const recipesById = new Map(RECIPES.map(recipe => [recipe.id, recipe]));
const $ = id => document.getElementById(id);

let storage;
try { storage = window.localStorage; }
catch { storage = {getItem() { throw new Error('unavailable'); }, setItem() { throw new Error('unavailable'); }}; }
const loaded = readState(storage, data);
let state = loaded.state;
let plan = null;
let roleFilter = 'all';
let recipeLimit = 12;
let historyLimit = 8;
let currentDialogId = null;
let shoppingText = '';
let toastTimer;
let storageWarning = '';
let previousHistoryRecipeName = '';
let pantryIds = new Set();
let showPantry = false;
const toast = document.createElement('div');
toast.className = 'toast';
toast.hidden = true;
toast.setAttribute('aria-hidden', 'true');
document.body.append(toast);

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function tell(message, error = false) {
  const complete = [...new Set([message, storageWarning].filter(Boolean))].join(' ');
  $('app-message').textContent = complete;
  $('app-message').className = `notice${error || storageWarning ? ' error' : ''}`;
  $('app-message').hidden = !complete;
  if (!complete) return;
  toast.textContent = complete;
  toast.classList.toggle('error', Boolean(error || storageWarning));
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 6500);
}

function persist() {
  try {
    storageWarning = writeState(storage, state, data) ? '' : 'このブラウザーでは保存できません。この画面内では使えますが、再読み込み後に変更が残らない場合があります。「記録を保存する」で手元に残してください。';
    if (storageWarning) tell('', true);
  } catch (error) { tell(error.message, true); }
}

function closeRecipe() {
  if ($('recipe-dialog').open) $('recipe-dialog').close();
  currentDialogId = null;
}

function invalidatePlan() {
  plan = null;
  pantryIds = new Set();
  showPantry = false;
  $('show-pantry').checked = false;
  closeRecipe();
  $('shopping-section').hidden = true;
  $('plan-date-label').textContent = '夕食の提案';
  renderEmptyPlan();
}

function engineSettings() {
  return {...state.settings, meal: 'dinner', history: state.history, seed: Math.floor(Math.random() * 2147483647)};
}

function formatDate(value, includeYear = false) {
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat('ja-JP', {year: includeYear ? 'numeric' : undefined, month: 'long', day: 'numeric', weekday: 'short'}).format(date);
}

function amountText(value, unit) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '分量を確認';
  const rounded = Math.round(value * 10) / 10;
  return `${rounded}${unit ? ` ${unit}` : ''}`;
}

function checkLabel(id, label, selected, change) {
  const wrapper = node('label', 'choice-label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.value = id;
  input.checked = selected;
  input.addEventListener('change', () => change(input.checked));
  wrapper.append(input, node('span', '', label));
  return wrapper;
}

function renderSettings() {
  $('start-date').value = state.settings.startDate;
  $('plan-days').value = state.settings.days;
  $('servings').value = state.settings.servings;
  $('genre-mode').value = state.settings.preferences.genreMode;
  $('single-genre').value = state.settings.preferences.genre === 'all' ? '和食' : state.settings.preferences.genre;
  $('meal-mood').value = state.settings.preferences.mood;
  renderGenrePreferences();
  $('required-allergens').replaceChildren();
  $('other-allergens').replaceChildren();
  for (const allergen of ALLERGENS) {
    const selected = state.settings.allergens.includes(allergen.id);
    const label = checkLabel(allergen.id, allergen.label, selected, checked => {
      state.settings.allergens = checked ? [...new Set([...state.settings.allergens, allergen.id])] : state.settings.allergens.filter(id => id !== allergen.id);
      settingsChanged();
    });
    (allergen.category === 'required' ? $('required-allergens') : $('other-allergens')).append(label);
  }
  $('allergen-count').textContent = `${state.settings.allergens.length}件`;
  renderIngredientChoices();
  renderPreferredChoices();
}

function renderGenrePreferences() {
  const preferences = state.settings.preferences;
  $('single-genre-field').hidden = preferences.genreMode !== 'single';
  $('genre-ratio-field').hidden = preferences.genreMode !== 'ratio';
  const box = $('genre-ratios');
  box.replaceChildren();
  for (const genre of GENRES) {
    const label = node('label', 'ratio-input-label', genre);
    const input = document.createElement('input');
    input.type = 'number'; input.min = '0'; input.max = '100'; input.step = '1';
    input.value = preferences.genreRatios[genre];
    input.setAttribute('aria-label', `${genre}の割合`);
    input.addEventListener('change', () => {
      try {
        state.settings.preferences.genreRatios = rebalanceGenreRatios(state.settings.preferences.genreRatios, genre, Number(input.value));
        renderGenrePreferences(); settingsChanged();
      } catch (error) { input.value = state.settings.preferences.genreRatios[genre]; tell(error.message, true); }
    });
    label.append(input, node('span', '', '%'));
    box.append(label);
  }
  $('ratio-total').textContent = `${Math.round(Object.values(preferences.genreRatios).reduce((sum, value) => sum + value, 0) * 100) / 100}%`;
}

function changePreferences() {
  const mode = $('genre-mode').value;
  state.settings.preferences.genreMode = mode;
  state.settings.preferences.genre = mode === 'single' ? $('single-genre').value : 'all';
  state.settings.preferences.mood = $('meal-mood').value;
  renderGenrePreferences();
  settingsChanged();
}

function renderPreferredChoices() {
  const values = state.settings.preferences.preferredIngredients;
  const selected = $('preferred-selections');
  selected.replaceChildren();
  for (const id of values) {
    const button = node('button', '', `${INGREDIENTS[id].name} ×`);
    button.type = 'button';
    button.setAttribute('aria-label', `${INGREDIENTS[id].name}の優先を取り消す`);
    button.addEventListener('click', () => {
      state.settings.preferences.preferredIngredients = state.settings.preferences.preferredIngredients.filter(value => value !== id);
      settingsChanged();
    });
    selected.append(button);
  }
  const query = $('preferred-search').value.trim();
  const options = $('preferred-options');
  options.replaceChildren();
  if (!query) return;
  const matches = Object.entries(INGREDIENTS).filter(([id, ingredient]) => ingredient.name.includes(query) && !values.includes(id)).slice(0, 20);
  for (const [id, ingredient] of matches) {
    const button = node('button', '', `＋ ${ingredient.name}`);
    button.type = 'button';
    button.addEventListener('click', () => {
      if (state.settings.excludedIngredients.includes(id)) {
        tell(`${ingredient.name}は除外中です。優先したい場合は、先に追加の除外食材から外してください。`, true);
        return;
      }
      state.settings.preferences.preferredIngredients.push(id);
      $('preferred-search').value = '';
      settingsChanged();
    });
    options.append(button);
  }
  if (!matches.length) options.append(node('p', 'field-note', '一致する登録食材がありません。別の名前で検索してください。'));
}

function renderIngredientChoices() {
  const selected = $('ingredient-selections');
  selected.replaceChildren();
  for (const id of state.settings.excludedIngredients) {
    const button = node('button', '', `${INGREDIENTS[id].name} ×`);
    button.type = 'button';
    button.setAttribute('aria-label', `${INGREDIENTS[id].name}の除外を取り消す`);
    button.addEventListener('click', () => {
      state.settings.excludedIngredients = state.settings.excludedIngredients.filter(value => value !== id);
      settingsChanged();
    });
    selected.append(button);
  }
  const query = $('ingredient-search').value.trim();
  const options = $('ingredient-options');
  options.replaceChildren();
  if (!query) return;
  const matches = Object.entries(INGREDIENTS).filter(([id, ingredient]) => ingredient.name.includes(query) && !state.settings.excludedIngredients.includes(id)).slice(0, 20);
  for (const [id, ingredient] of matches) {
    const button = node('button', '', `＋ ${ingredient.name}`);
    button.type = 'button';
    button.addEventListener('click', () => {
      state.settings.excludedIngredients.push(id);
      const wasPreferred = state.settings.preferences.preferredIngredients.includes(id);
      state.settings.preferences.preferredIngredients = state.settings.preferences.preferredIngredients.filter(value => value !== id);
      $('ingredient-search').value = '';
      settingsChanged();
      if (wasPreferred) tell(`${ingredient.name}を除外し、優先する食材から外しました。`);
    });
    options.append(button);
  }
  if (!matches.length) options.append(node('p', 'field-note', '一致する登録食材がありません。別の名前で検索してください。'));
}

function settingsChanged() {
  invalidatePlan();
  $('allergen-count').textContent = `${state.settings.allergens.length}件`;
  renderIngredientChoices();
  renderPreferredChoices();
  renderRecipeCatalog();
  renderHistorySummary();
  persist();
  tell('条件を更新しました。更新した条件で献立を作成できます。');
}

function renderEmptyPlan() {
  const box = node('div', 'empty-plan');
  box.append(node('span', 'empty-mark', '◒'), node('h3', '', '次のごはんを、ここから。'), node('p', '', '条件を確認して「献立を作る」を押してください。食事の記録があれば、主な食材や料理の重複も考慮します。'));
  const parts = node('div', 'meal-parts');
  for (const label of ['主菜', '副菜', '汁物', '必要に応じて主食']) parts.append(node('span', '', label));
  box.append(parts);
  $('plan-output').replaceChildren(box);
}

function renderHistorySummary() {
  let summary;
  try { summary = analyseHistory(state.history, {beforeDate: state.settings.startDate, days: 7, beforeMeal: 'dinner'}, data); }
  catch (error) { $('history-summary-text').textContent = error.message; return; }
  if (!summary.hasHistory) $('history-summary-text').textContent = '対象期間に食事の記録がありません。記録なしでも献立を作れます。';
  else if (!summary.hasTaggedData) $('history-summary-text').textContent = `${summary.mealCount}食の記録があります。内容の分類がないため、食品群の偏りは判断せず、料理の重複だけを参考にします。`;
  else $('history-summary-text').textContent = `${summary.mealCount}食の記録を参考にします。献立の最初の日より前の7日間と、当日の夕食前の記録が対象です。`;
  const groupBox = $('group-summary');
  groupBox.replaceChildren();
  if (summary.hasTaggedData) {
    for (const id of GROUP_IDS) {
      const item = node('span', '', SHORT_GROUP_NAMES[id]);
      item.append(node('strong', '', `${summary.groups[id] || 0}回`));
      groupBox.append(item);
    }
  }
}

function renderPlan() {
  const output = $('plan-output');
  output.replaceChildren();
  if (!plan || !plan.ok) {
    const warnings = plan?.warnings || [];
    const missing = plan?.missingRoles || [];
    const title = 'この条件では献立をそろえられませんでした。';
    const box = node('div', 'plan-warning');
    box.append(node('strong', '', title));
    box.append(node('p', '', 'アレルギー食材の除外条件は維持しています。追加の除外食材を見直すか、条件に合うレシピを追加してください。'));
    for (const warning of warnings) box.append(node('p', '', String(warning)));
    if (!warnings.length && missing.length) box.append(node('p', '', `候補が足りない区分：${missing.map(role => ROLE_NAMES[role] || role).join('、')}`));
    output.append(box);
    $('shopping-section').hidden = true;
    return;
  }
  const first = plan.days[0];
  const last = plan.days[plan.days.length - 1];
  $('plan-date-label').textContent = `${formatDate(first.date)}${plan.days.length > 1 ? `〜${formatDate(last.date)}` : ''} · ${state.settings.servings}人分`;
  if (plan.warnings?.length) {
    const note = node('div', 'plan-warning');
    for (const text of plan.warnings) note.append(node('p', '', String(text)));
    output.append(note);
  }
  const toolbar = node('div', 'plan-toolbar');
  const shopping = node('button', 'button-secondary', '買い物リストを見る');
  shopping.type = 'button';
  shopping.addEventListener('click', () => {
    $('shopping-section').open = true;
    $('shopping-section').scrollIntoView({behavior: 'smooth', block: 'start'});
  });
  toolbar.append(node('p', '', '料理名からレシピを開けます。作らない料理は、今回の献立から外せます。'), shopping);
  output.append(toolbar);
  if (plan.genreSummary?.mode === 'ratio') {
    const summary = node('div', 'genre-summary');
    const actual = GENRES.filter(genre => plan.genreSummary.actual?.[genre]).map(genre => `${genre}${plan.genreSummary.actual[genre]}日`).join('・');
    summary.append(node('p', '', `作る主菜のジャンル：${actual || '主菜をすべて除外しています'}`));
    if (plan.genreSummary.note) summary.append(node('p', 'field-note', plan.genreSummary.note));
    output.append(summary);
  }
  plan.days.forEach((day, dayIndex) => {
    const article = node('article', 'day-card');
    const heading = node('div', 'day-heading');
    heading.append(node('h3', '', `${formatDate(day.date)}の夕食`));
    const record = node('button', 'button-secondary', '食べた記録へ');
    record.type = 'button';
    const activeIds = day.recipeIds.filter(id => !(day.omittedRecipeIds || []).includes(id));
    record.disabled = day.date > localDate() || !activeIds.length;
    if (record.disabled) record.title = '食べた日になったら記録できます。';
    if (!activeIds.length) record.title = '料理をすべて除外しているため、記録する料理がありません。';
    record.addEventListener('click', () => addDayToHistory(day));
    heading.append(record);
    article.append(heading);
    const dishes = node('div', 'day-dishes');
    for (const id of day.recipeIds) {
      const recipe = describeRecipe(id, data);
      const omitted = (day.omittedRecipeIds || []).includes(id);
      const row = node('div', `dish-row${omitted ? ' omitted' : ''}`);
      const content = node('div');
      content.append(node('span', 'dish-role', ROLE_NAMES[recipe.role] || recipe.role));
      const open = node('button', 'dish-name', recipe.name);
      open.type = 'button';
      open.addEventListener('click', () => openRecipe(id));
      content.append(open, node('p', 'dish-info', `${recipe.genre} · 目安${recipe.minutes}分 · 材料と作り方を見る`));
      if (omitted) content.append(node('p', 'omitted-label', '今回は作りません（買い物リストと記録の対象外）'));
      row.append(content);
      const controls = node('div', 'dish-controls');
      if (recipe.role !== 'staple') {
        const swap = node('button', 'swap-button', '差し替え');
        swap.type = 'button';
        swap.setAttribute('aria-label', `${recipe.name}を差し替える`);
        swap.disabled = omitted;
        swap.addEventListener('click', () => swapDish(dayIndex, id));
        controls.append(swap);
      }
      const omit = node('button', `omit-button${omitted ? ' restore-button' : ''}`, omitted ? '戻す' : '今回は除外');
      omit.type = 'button';
      omit.setAttribute('aria-label', omitted ? `${recipe.name}を献立に戻す` : `${recipe.name}を今回は除外する`);
      omit.addEventListener('click', () => {
        try {
          plan = toggleDish(plan, {dayIndex, recipeId: id}, data);
          renderPlan();
          if (!plan.ok) { tell((plan.warnings || []).join(' ') || '献立を作り直してください。', true); return; }
          tell(omitted ? `${recipe.name}を今回の献立に戻しました。` : `${recipe.name}を今回の献立から外しました。材料も買い物リストから除きます。`);
        } catch (error) { tell(error.message, true); }
      });
      controls.append(omit);
      row.append(controls);
      dishes.append(row);
    }
    article.append(dishes);
    if (day.reasons?.length || day.warnings?.length) {
      const notes = node('div', 'day-notes');
      for (const reason of [...(day.reasons || []), ...(day.warnings || [])]) notes.append(node('p', '', String(reason)));
      article.append(notes);
    }
    output.append(article);
  });
  renderShoppingList();
}

function swapDish(dayIndex, recipeId) {
  try {
    const next = replaceRecipe(plan, {dayIndex, recipeId, allergens: state.settings.allergens, excludedIngredients: state.settings.excludedIngredients, history: state.history, seed: Math.floor(Math.random() * 2147483647)}, data);
    if (!next.ok) { tell((next.warnings || []).join(' ') || '除外条件に合う別の候補がありません。元の献立を残しました。', true); return; }
    const before = plan.days[dayIndex].recipeIds.join('|');
    plan = next;
    renderPlan();
    tell(before === plan.days[dayIndex].recipeIds.join('|') ? '除外条件に合う別の候補がないため、元の料理を残しました。' : '除外条件を確認して、料理を差し替えました。');
  } catch (error) { tell(error.message, true); }
}

function renderShoppingList() {
  const ingredients = shoppingList(plan, state.settings.servings, data);
  const grid = node('div', 'shopping-list-grid');
  const lines = [`献立ノート · ${state.settings.servings}人分`];
  let inPantry = 0;
  let toBuy = 0;
  for (const item of ingredients) {
    const owned = pantryIds.has(item.id);
    if (owned) inPantry++; else {
      toBuy++;
      lines.push(`${item.name}：${amountText(item.amount, item.unit)}`);
    }
    if (!owned || showPantry) {
      const row = node('div', `shopping-item${owned ? ' in-pantry' : ''}`);
      const label = node('label', 'pantry-choice');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox'; checkbox.checked = owned;
      checkbox.setAttribute('aria-label', `${item.name}は家にある`);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) pantryIds.add(item.id); else pantryIds.delete(item.id);
        renderShoppingList();
      });
      label.append(checkbox, node('span', '', '家にある'));
      const name = node('div', 'shopping-name');
      name.append(node('span', '', item.name), node('small', '', amountText(item.amount, item.unit)));
      row.append(name, label);
      grid.append(row);
    }
  }
  if (!ingredients.length) grid.append(node('p', 'field-note', '今回作る料理がないため、買い物リストは空です。「戻す」で料理を戻せます。'));
  else if (!toBuy && !showPantry) grid.append(node('p', 'field-note', '買う食材はありません。「家にある食材も表示する」でチェックを取り消せます。'));
  $('shopping-list').replaceChildren(grid);
  shoppingText = toBuy ? lines.join('\n') : '';
  $('show-pantry').checked = showPantry;
  $('pantry-status').textContent = `買う食材 ${toBuy}品 · 家にある食材 ${inPantry}品${!showPantry && inPantry ? '（非表示）' : ''}。コピーには買う食材だけを含めます。`;
  $('reset-pantry').disabled = !pantryIds.size;
  $('copy-shopping').disabled = !toBuy;
  $('copy-status').textContent = '';
  $('shopping-section').hidden = false;
}

function visibleRecipes() {
  const query = $('recipe-search').value.trim().toLocaleLowerCase('ja-JP');
  return eligibleRecipes(engineSettings(), data, {role: roleFilter === 'all' ? null : roleFilter}).filter(recipe => {
    if (!query) return true;
    return [recipe.name, recipe.genre, ...recipe.ingredients.map(ingredient => INGREDIENTS[ingredient.id]?.name || '')].join(' ').toLocaleLowerCase('ja-JP').includes(query);
  });
}

function renderRecipeCatalog() {
  const grid = $('recipe-grid');
  grid.replaceChildren();
  let list;
  try { list = visibleRecipes(); }
  catch (error) { grid.append(node('p', 'field-note', error.message)); return; }
  const totalEligible = eligibleRecipes(engineSettings(), data).length;
  $('eligible-count').textContent = `除外条件に合う ${totalEligible}品 / 全${RECIPES.length}品`;
  if (!list.length) grid.append(node('p', 'section-copy', 'この条件に合うレシピがありません。検索語や追加の除外食材を確認してください。アレルギー食材の条件は自動で外しません。'));
  for (const recipe of list.slice(0, recipeLimit)) {
    const button = node('button', 'recipe-card');
    button.type = 'button';
    button.append(node('span', 'dish-role', ROLE_NAMES[recipe.role] || recipe.role), node('strong', '', recipe.name), node('span', 'recipe-meta', `${recipe.genre} · 目安${recipe.minutes}分`), node('span', 'recipe-arrow', '↗'));
    button.addEventListener('click', () => openRecipe(recipe.id));
    grid.append(button);
  }
  $('more-recipes').hidden = list.length <= recipeLimit;
}

function openRecipe(id) {
  try {
    if (!eligibleRecipes(engineSettings(), data).some(recipe => recipe.id === id)) { tell('現在の除外条件に合わないため、この料理を提案できません。', true); return; }
    const recipe = describeRecipe(id, data);
    currentDialogId = id;
    $('dialog-title').textContent = recipe.name;
    $('dialog-meta').textContent = `${ROLE_NAMES[recipe.role]} · ${recipe.genre} · 目安${recipe.minutes}分`;
    const content = $('dialog-content');
    content.replaceChildren();
    content.append(node('p', 'dialog-allergens', recipe.allergens.length ? `登録材料に含むアレルギー食材：${recipe.allergens.map(value => allergenNames.get(value) || value).join('、')}` : '登録材料では、一覧のアレルギー食材を含みません。商品ごとの原材料表示も確認してください。'));
    content.append(node('h3', 'dialog-subheading', `材料（${state.settings.servings}人分）`));
    const table = node('table', 'ingredient-table');
    const body = node('tbody');
    const notes = new Set();
    for (const ingredient of recipe.ingredients) {
      const row = node('tr');
      const name = node('td', '', ingredient.name);
      if (ingredient.allergens.length) name.append(node('small', '', ingredient.allergens.map(value => allergenNames.get(value) || value).join('・')));
      row.append(name, node('td', '', amountText(ingredient.amount * state.settings.servings / recipe.servings, ingredient.unit)));
      body.append(row);
      if (INGREDIENTS[ingredient.id].note) notes.add(INGREDIENTS[ingredient.id].note);
    }
    table.append(body);
    content.append(table);
    for (const note of notes) content.append(node('p', 'dialog-notes', note));
    content.append(node('h3', 'dialog-subheading', '作り方'));
    const steps = node('ol', 'recipe-steps');
    for (const step of recipe.steps) steps.append(node('li', '', step));
    content.append(steps);
    content.append(node('p', 'dialog-notes', '調理時間は目安です。人数や食材の状態によって変わります。肉・魚・卵などは十分に加熱し、加工品や調味料の原材料表示と、調理器具への混入にも気を付けてください。'));
    const actions = node('div', 'dialog-actions');
    actions.append(node('p', '', '食べた料理は記録して、次の献立の参考に。'));
    const record = node('button', 'button-secondary', 'この料理を記録欄へ');
    record.type = 'button';
    record.addEventListener('click', () => {
      selectHistoryRecipe(id);
      closeRecipe();
      $('history').scrollIntoView({behavior: 'smooth', block: 'start'});
      $('history-note').focus({preventScroll: true});
    });
    actions.append(record);
    content.append(actions);
    $('recipe-dialog').showModal();
  } catch (error) { tell(error.message, true); }
}

function fillHistoryChoices() {
  for (const [id, label] of Object.entries(GROUP_NAMES)) $('history-groups').append(checkLabel(id, label, false, () => {}));
  for (const [id, label] of Object.entries(PROTEIN_NAMES)) $('history-proteins').append(checkLabel(id, label, false, () => {}));
  for (const recipe of [...RECIPES].sort((a, b) => a.name.localeCompare(b.name, 'ja'))) {
    const option = document.createElement('option');
    option.value = recipe.id;
    option.textContent = `${recipe.name}（${ROLE_NAMES[recipe.role]}）`;
    $('history-recipe').append(option);
  }
  $('history-date').value = localDate();
  $('history-date').max = localDate();
}

function selectedHistoryValues(container) {
  return [...$(container).querySelectorAll('input:checked')].map(input => input.value);
}

function selectHistoryRecipe(id) {
  $('history-recipe').value = id;
  const recipe = id ? describeRecipe(id, data) : null;
  if (!$('history-note').value || $('history-note').value === previousHistoryRecipeName) $('history-note').value = recipe?.name || '';
  previousHistoryRecipeName = recipe?.name || '';
  for (const checkbox of $('history-groups').querySelectorAll('input')) checkbox.checked = Boolean(recipe?.groups.includes(checkbox.value));
  for (const checkbox of $('history-proteins').querySelectorAll('input')) checkbox.checked = Boolean(recipe?.proteinSources.includes(checkbox.value));
}

function newRecordId() {
  return window.crypto?.randomUUID?.() || `entry-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function addHistory(entry) {
  const candidate = validateState({...state, history: [...state.history, entry]}, data);
  state = candidate;
  invalidatePlan();
  renderHistory();
  renderHistorySummary();
  persist();
}

function addDayToHistory(day) {
  if (day.date > localDate()) { tell('未来の食事はまだ記録できません。食べた日に追加してください。', true); return; }
  const activeIds = day.recipeIds.filter(id => !(day.omittedRecipeIds || []).includes(id));
  if (!activeIds.length) { tell('料理をすべて除外しているため、記録する料理がありません。', true); return; }
  const identical = state.history.some(entry => entry.date === day.date && entry.meal === day.meal && [...entry.recipeIds].sort().join('|') === [...activeIds].sort().join('|'));
  if (identical) { tell('この献立は食事の記録に追加済みです。'); return; }
  try {
    addHistory({id: newRecordId(), date: day.date, meal: day.meal || 'dinner', recipeIds: [...activeIds], groups: [], proteinSources: [], note: ''});
    tell('食事の記録に追加しました。次の献立は、更新した記録をもとに作成できます。');
  } catch (error) { tell(error.message, true); }
}

function renderHistory() {
  $('history-count').textContent = `${state.history.length}件の記録`;
  $('history-list').replaceChildren();
  const sorted = [...state.history].sort((a, b) => b.date.localeCompare(a.date) || MEALS_SORT.indexOf(b.meal) - MEALS_SORT.indexOf(a.meal));
  if (!sorted.length) $('history-list').append(node('p', 'history-empty', 'まだ記録がありません。\n覚えている食事から、気軽に残してみましょう。'));
  for (const entry of sorted.slice(0, historyLimit)) {
    const article = node('article', 'history-record');
    const content = node('div');
    content.append(node('p', '', `${formatDate(entry.date, true)} · ${MEAL_NAMES[entry.meal]}`));
    const recipeNames = entry.recipeIds.map(id => recipesById.get(id)?.name || 'レシピ');
    const title = entry.note || recipeNames.join('、');
    content.append(node('h3', '', title));
    if (entry.note && recipeNames.length && title !== recipeNames.join('、')) content.append(node('p', '', recipeNames.join('、')));
    const groups = new Set(entry.groups);
    const proteins = new Set(entry.proteinSources);
    for (const id of entry.recipeIds) {
      const recipe = describeRecipe(id, data);
      recipe.groups.forEach(group => groups.add(group));
      recipe.proteinSources.forEach(protein => proteins.add(protein));
    }
    const details = [...groups].map(id => SHORT_GROUP_NAMES[id]).concat([...proteins].map(id => PROTEIN_NAMES[id]));
    content.append(node('p', '', details.length ? details.join('・') : '内容の分類なし（料理名のみの記録）'));
    const remove = node('button', 'delete-record', '削除');
    remove.type = 'button';
    remove.setAttribute('aria-label', `${formatDate(entry.date)}の${MEAL_NAMES[entry.meal]}の記録を削除`);
    remove.addEventListener('click', () => {
      state.history = state.history.filter(item => item.id !== entry.id);
      invalidatePlan(); renderHistory(); renderHistorySummary(); persist();
      tell('この食事の記録を削除しました。');
    });
    article.append(content, remove);
    $('history-list').append(article);
  }
  $('more-history').hidden = sorted.length <= historyLimit;
}
const MEALS_SORT = ['breakfast', 'lunch', 'dinner', 'snack'];

$('planner-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    if ($('ingredient-search').value.trim()) throw new Error('追加で避ける食材は、検索結果の候補を押して選択してください。入力しただけでは除外条件に入りません。');
    if ($('preferred-search').value.trim()) throw new Error('できれば使いたい食材は、検索結果の候補を押して選択してください。入力しただけでは優先する食材に入りません。');
    state.settings.startDate = $('start-date').value;
    state.settings.days = Number($('plan-days').value);
    state.settings.servings = Number($('servings').value);
    state = validateState(state, data);
    plan = generatePlan(engineSettings(), data);
    pantryIds = new Set(); showPantry = false;
    renderPlan(); renderHistorySummary(); persist();
    tell(plan.ok ? `${plan.days.length}日分の献立を作成しました。料理名から材料と作り方を開けます。` : '除外条件を維持したままでは、必要な料理の候補が足りません。', !plan.ok);
  } catch (error) { invalidatePlan(); tell(error.message, true); }
});

for (const [element, setting] of [['start-date', 'startDate'], ['plan-days', 'days'], ['servings', 'servings']]) {
  $(element).addEventListener('change', () => {
    const value = setting === 'startDate' ? $(element).value : Number($(element).value);
    try { state = validateState({...state, settings: {...state.settings, [setting]: value}}, data); settingsChanged(); }
    catch (error) { invalidatePlan(); tell(error.message, true); }
  });
}
$('ingredient-search').addEventListener('input', renderIngredientChoices);
$('preferred-search').addEventListener('input', renderPreferredChoices);
for (const id of ['genre-mode', 'single-genre', 'meal-mood']) $(id).addEventListener('change', changePreferences);
$('ratio-equal').addEventListener('click', () => {
  state.settings.preferences.genreRatios = Object.fromEntries(GENRES.map(genre => [genre, 20]));
  renderGenrePreferences(); settingsChanged();
});
$('ratio-japanese').addEventListener('click', () => {
  state.settings.preferences.genreRatios = {'和食': 60, '洋食': 20, '中華': 10, 'エスニック': 10, 'その他': 0};
  renderGenrePreferences(); settingsChanged();
});
$('preferred-search').addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); tell('検索結果の候補を押して、優先したい食材を選択してください。'); }
});
$('ingredient-search').addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    tell('検索結果の候補を押して、避ける食材を選択してください。');
  }
});
$('recipe-search').addEventListener('input', () => { recipeLimit = 12; renderRecipeCatalog(); });
$('more-recipes').addEventListener('click', () => { recipeLimit += 12; renderRecipeCatalog(); });
for (const button of $('role-filters').querySelectorAll('button')) button.addEventListener('click', () => {
  roleFilter = button.dataset.role;
  for (const filter of $('role-filters').querySelectorAll('button')) filter.setAttribute('aria-pressed', String(filter === button));
  recipeLimit = 12; renderRecipeCatalog();
});
$('close-dialog').addEventListener('click', closeRecipe);
$('recipe-dialog').addEventListener('click', event => { if (event.target === $('recipe-dialog')) closeRecipe(); });
$('recipe-dialog').addEventListener('close', () => { currentDialogId = null; });
$('history-recipe').addEventListener('change', () => selectHistoryRecipe($('history-recipe').value));
$('history-form').addEventListener('submit', event => {
  event.preventDefault();
  const date = $('history-date').value;
  if (date > localDate()) { tell('食べた日には今日以前の日付を指定してください。', true); return; }
  try {
    const recipeId = $('history-recipe').value;
    addHistory({id: newRecordId(), date, meal: $('history-meal').value, recipeIds: recipeId ? [recipeId] : [], groups: selectedHistoryValues('history-groups'), proteinSources: selectedHistoryValues('history-proteins'), note: $('history-note').value.trim()});
    $('history-note').value = ''; selectHistoryRecipe('');
    tell('食事の記録を追加しました。次の献立づくりで参考にします。');
  } catch (error) { tell(error.message, true); }
});
$('more-history').addEventListener('click', () => { historyLimit += 8; renderHistory(); });
$('copy-shopping').addEventListener('click', async () => {
  if (!shoppingText) { $('copy-status').textContent = 'コピーする買い物リストがありません。'; return; }
  try {
    await navigator.clipboard.writeText(shoppingText);
    $('copy-status').textContent = '買い物リストをコピーしました。';
  } catch {
    $('copy-status').textContent = '自動コピーを利用できません。表示されているリストを選択してコピーしてください。';
  }
});
$('show-pantry').addEventListener('change', () => { showPantry = $('show-pantry').checked; if (plan?.ok) renderShoppingList(); });
$('reset-pantry').addEventListener('click', () => {
  pantryIds = new Set();
  if (plan?.ok) renderShoppingList();
  $('copy-status').textContent = '家にある食材のチェックをすべて取り消しました。';
});
$('export-records').addEventListener('click', () => {
  try {
    const clean = validateState(state, data);
    const blob = new Blob([JSON.stringify(clean, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `kondate-note_${localDate()}.json`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    tell('設定と食事の記録を保存しました。アレルギーの設定も含まれます。');
  } catch (error) { tell(error.message, true); }
});
$('import-records').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('2 MB以下のJSONファイルを選んでください。');
    const next = parseState(await file.text(), data);
    if (state.history.length && !window.confirm('現在の設定と食事の記録を、ファイルの内容で置き換えます。読み込みますか？')) return;
    state = next; invalidatePlan(); renderSettings(); renderRecipeCatalog(); renderHistory(); renderHistorySummary(); persist();
    tell(`${state.history.length}件の記録と設定を読み込みました。アレルギー食材の設定も確認してください。`);
  } catch (error) { tell(`${error.message} 現在の記録は変更していません。`, true); }
  finally { event.target.value = ''; }
});
$('clear-history').addEventListener('click', () => {
  if (!state.history.length) { tell('削除する食事の記録はありません。'); return; }
  if (!window.confirm('このブラウザーの食事の記録をすべて削除します。必要な場合は先に「記録を保存する」で残してください。削除しますか？')) return;
  state.history = []; invalidatePlan(); renderHistory(); renderHistorySummary(); persist();
  tell('食事の記録をすべて削除しました。アレルギーなどの設定は残しています。');
});
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY) return;
  const refreshed = readState(storage, data);
  state = refreshed.state; invalidatePlan(); renderSettings(); renderRecipeCatalog(); renderHistory(); renderHistorySummary();
  tell(refreshed.message || '別のタブで更新された設定と記録を反映しました。');
});

$('recipe-total').textContent = RECIPES.length;
fillHistoryChoices();
renderSettings();
renderHistory();
renderHistorySummary();
renderRecipeCatalog();
if (loaded.message) tell(loaded.message, true);
