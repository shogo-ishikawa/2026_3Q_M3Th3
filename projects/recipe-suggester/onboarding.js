// お試しはページを開くたびに新しい記録を作り、端末の保存領域に触れません。
import {dateKey, defaultJournal, JOURNAL_KEY, PREVIOUS_JOURNAL_KEY, setNutritionMode, shiftDate} from './journal.js';
import {STORAGE_KEY} from './storage.js';
import {recipePortion} from './catalog.js';
import {itemFromRecipe} from './nutrition.js';
import {commonPantryIds} from './shopping-categories.js';
import {shoppingMenusFromEntries} from './shopping-workflow.js';
import {matchesJapaneseQuery} from './japanese-search.js';

const WELCOME_KEY = 'meal-palette-welcome-v4';
const BREAKFAST = ['staple-cheese-toast', 'staple-oatmeal-milk', 'savoury-french-toast'];
const LUNCH = ['udon-egg', 'chicken-rice-bowl', 'pasta-meat', 'pork-rice-bowl', 'pasta-mushroom', 'egg-fried-rice', 'udon-pork'];
const DINNER = ['chicken-teriyaki', 'salmon-miso', 'pork-ginger', 'tofu-steak', 'mackerel-miso', 'beef-potato', 'chicken-tomato'];

export function demoStorage(data, today = dateKey()) {
  const journal = defaultJournal(today);
  const recipes = new Map(data.recipes.map(recipe => [recipe.id, recipe]));
  function meal(day, slot, ids, status = 'eaten') {
    const items = ids.map(id => {
      const recipe = recipes.get(id);
      return {...itemFromRecipe(recipe, data), portion: recipePortion(recipe, data)};
    });
    journal.entries.push({id: 'demo-' + day + '-' + slot, date: day, meal: slot, status, items, note: ''});
  }
  for (let i = 0; i < 7; i++) {
    const day = shiftDate(today, i - 6);
    meal(day, 'breakfast', [BREAKFAST[i % BREAKFAST.length]]);
    meal(day, 'lunch', [LUNCH[i]]);
    meal(day, 'dinner', ['plain-rice', DINNER[i], i % 2 ? 'side-002' : 'soup-013']);
    journal.completedDays.push(day);
  }
  const tomorrow = shiftDate(today, 1);
  meal(tomorrow, 'dinner', ['plain-rice', 'beef-onion', 'side-003'], 'planned');
  journal.pantry = [{id: 'onion', amount: 100}, {id: 'carrot', amount: 50}, {id: 'egg', amount: 3}];
  journal.settings.shoppingOmittedIds = commonPantryIds(data);
  journal.shoppingList = shoppingMenusFromEntries(journal.entries, data, {
    from: tomorrow, to: tomorrow, servings: journal.settings.servings,
  }).map(menu => ({...menu, origin: 'calendar', ingredientIds: menu.item.ingredients.map(part => part.id)}));
  const memory = new Map([[JOURNAL_KEY, JSON.stringify(journal)]]);
  return {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, String(value)),
  };
}

export function showFirstVisit(storage) {
  try {
    return [WELCOME_KEY, JOURNAL_KEY, PREVIOUS_JOURNAL_KEY, STORAGE_KEY].every(key => storage.getItem(key) === null);
  } catch { return false; }
}

export function applyQuickSetup(next, draft, data) {
  next.settings.allergens = [...draft.allergens];
  next.settings.excludedIngredients = [...draft.excluded];
  next.settings.preferences.preferredIngredients = next.settings.preferences.preferredIngredients.filter(id => !draft.excluded.has(id));
  if (draft.omitCommon !== null) {
    const common = commonPantryIds(data);
    const saved = next.settings.shoppingOmittedIds;
    next.settings.shoppingOmittedIds = draft.omitCommon ? [...new Set([...saved, ...common])] : saved.filter(id => !common.includes(id));
  }
  if (draft.profile) setNutritionMode(next, draft.profile);
}

export function setupWelcome({demo, storage, initialError, data, getState, canEdit, onSave}) {
  const byId = id => document.getElementById(id);
  const welcome = byId('first-visit');
  if (demo) {
    byId('sample-session').hidden = false;
    byId('setup-actions').hidden = true;
    document.querySelector('.data-section').hidden = true;
    document.querySelector('.local-note').textContent = 'お試し中';
    byId('nutrition-period').value = '7';
    return;
  }
  welcome.hidden = Boolean(initialError) || !showFirstVisit(storage);
  function dismiss() {
    welcome.hidden = true;
    try { storage.setItem(WELCOME_KEY, 'done'); } catch { /* 保存不可のときもこの画面では閉じる */ }
  }
  byId('dismiss-first-visit').addEventListener('click', dismiss);

  const dialog = byId('quick-setup');
  const common = byId('setup-omit-common');
  let draft;
  const addChip = (list, label, handler) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button-text';
    button.textContent = label;
    button.addEventListener('click', handler);
    list.append(button);
  };
  function ingredients() {
    const picked = byId('setup-picked');
    const results = byId('setup-matches');
    picked.replaceChildren();
    results.replaceChildren();
    for (const id of draft.excluded) {
      addChip(picked, data.ingredients[id].name + ' を外す', () => { draft.excluded.delete(id); ingredients(); });
    }
    const query = byId('setup-search').value.trim();
    if (!query) return;
    const matches = Object.entries(data.ingredients)
      .filter(([id, item]) => !draft.excluded.has(id) && matchesJapaneseQuery([item.name, id], query)).slice(0, 10);
    for (const [id, item] of matches) {
      addChip(results, '＋ ' + item.name, () => {
        draft.excluded.add(id);
        byId('setup-search').value = '';
        ingredients();
        byId('setup-search').focus();
      });
    }
    if (!matches.length) results.textContent = '一致する食材がありません。';
  }
  function open() {
    if (!canEdit()) return;
    const state = getState();
    draft = {excluded: new Set(state.settings.excludedIngredients), allergens: new Set(state.settings.allergens), omitCommon: null, profile: null};
    const ids = commonPantryIds(data);
    common.checked = ids.every(id => state.settings.shoppingOmittedIds.includes(id));
    common.indeterminate = !common.checked && ids.some(id => state.settings.shoppingOmittedIds.includes(id));
    byId('setup-common-names').textContent = ids.map(id => data.ingredients[id].name).join('、');
    byId('setup-allergens').replaceChildren();
    byId('setup-more-allergens').replaceChildren();
    for (const item of data.allergens) {
      const label = document.createElement('label');
      label.className = 'choice-label';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = draft.allergens.has(item.id);
      input.addEventListener('change', () => input.checked ? draft.allergens.add(item.id) : draft.allergens.delete(item.id));
      label.append(input, item.label);
      byId(item.category === 'required' ? 'setup-allergens' : 'setup-more-allergens').append(label);
    }
    byId('setup-search').value = '';
    ingredients();
    byId('setup-reference').checked = false;
    byId('setup-profile').hidden = true;
    for (const field of ['age', 'sex', 'activity']) {
      const source = byId('profile-' + field);
      const target = byId('setup-' + field);
      target.replaceChildren(...Array.from(source.options, option => option.cloneNode(true)));
      target.value = state.profile[{age: 'ageBand', sex: 'sex', activity: 'activity'}[field]];
    }
    byId('setup-error').textContent = '';
    for (const details of dialog.querySelectorAll('details')) details.open = false;
    dialog.showModal();
  }
  byId('first-setup').addEventListener('click', open);
  byId('settings-setup').addEventListener('click', open);
  byId('setup-cancel').addEventListener('click', () => dialog.close());
  byId('setup-search').addEventListener('input', ingredients);
  byId('setup-search').addEventListener('keydown', event => { if (event.key === 'Enter') event.preventDefault(); });
  common.addEventListener('change', () => { draft.omitCommon = common.checked; });
  byId('setup-reference').addEventListener('change', event => { byId('setup-profile').hidden = !event.target.checked; });
  byId('quick-setup-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!canEdit()) return;
    draft.profile = byId('setup-reference').checked ? {
      mode: 'reference', ageBand: byId('setup-age').value, sex: byId('setup-sex').value, activity: byId('setup-activity').value,
    } : null;
    try {
      if (!onSave(draft)) return;
      dialog.close();
      dismiss();
    } catch (error) { byId('setup-error').textContent = error.message; }
  });
}
