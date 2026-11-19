import {ingredientOptions} from './ingredient-options.js';
import {INGREDIENT_GROUPS} from './shopping-categories.js';
import {pantryClassification} from './pantry-catalog.js';
import {japaneseQueryRank} from './japanese-search.js';

const previousOptions = new WeakMap();
const collator = new Intl.Collator('ja', {numeric:true});

/** Offer the same grouped ingredient choices for setup, meal preferences and shopping. */
export function fillIngredientPicker(picker, data, query, selectedIds) {
  const key = JSON.stringify([query.trim(), ...selectedIds]);
  const previous = previousOptions.get(picker);
  if (previous?.ingredients === data.ingredients && previous.key === key) return;
  const matches = ingredientOptions(data, query, {selectedIds});
  const byGroup = new Map();
  for (const ingredient of matches) {
    const group = pantryClassification(ingredient.id, data).group;
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(ingredient);
  }
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = matches.length ? '食材を選んで追加' : '該当する食材がありません';
  const groups = [];
  for (const {id, label} of INGREDIENT_GROUPS) {
    const items = byGroup.get(id);
    if (!items) continue;
    const group = document.createElement('optgroup');
    group.label = label;
    items.sort((a,b) => collator.compare(a.name,b.name));
    for (const item of items) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      group.append(option);
    }
    groups.push(group);
  }
  picker.replaceChildren(placeholder, ...groups);
  picker.value = '';
  picker.disabled = !matches.length;
  const results = document.getElementById(picker.dataset.matches);
  results.replaceChildren();
  results.hidden = !query.trim();
  if (!results.hidden) {
    const top = matches.map(item => ({item, rank:japaneseQueryRank([item.name], query)}))
      .sort((a,b) => a.rank - b.rank || collator.compare(a.item.name,b.item.name)).slice(0,8);
    if (!top.length) results.textContent = '一致する食材がありません。';
    for (const {item} of top) {
      const add = document.createElement('button');
      add.type = 'button';
      add.textContent = '＋ ' + item.name;
      add.addEventListener('click', () => {
        picker.value = item.id;
        picker.dispatchEvent(new Event('change', {bubbles:true}));
        if (!picker.disabled) picker.focus({preventScroll:true});
      });
      results.append(add);
    }
  }
  previousOptions.set(picker, {ingredients:data.ingredients, key});
}
