/** 手持ち食材をジャンル・種類・食材の3段階で選ぶ小さな画面。 */
import {INGREDIENT_GROUPS} from './shopping-categories.js';
import {pantryClassification,pantryIngredients,pantrySubgroups,comparePantryIngredients} from './pantry-catalog.js';
import {configureQuantityInput,readQuantityInput} from './quantity-input.js';

let instance = 0;
const make = (tag, className = '', text = '') => {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== '') element.textContent = text;
  return element;
};
const cleanFilter = (value = {}) => ({group: typeof value.group === 'string' ? value.group : '',
  subgroup: typeof value.subgroup === 'string' ? value.subgroup : '', query: typeof value.query === 'string' ? value.query : ''});

export function mountPantry({data, pantry = [], onSave = () => {}, onDelete = () => {}, onError = () => {},
  initialFilter = {}, onFilterChange = () => {}} = {}) {
  if (!data?.ingredients || !Array.isArray(pantry)) throw Error('手持ち食材の一覧を確認してください。');
  const root = make('div', 'pantry-browser'), prefix = `pantry-browser-${++instance}`;
  let stock = pantry.map(part => ({...part}));
  const filters = cleanFilter(initialFilter);
  if (!INGREDIENT_GROUPS.some(group => group.id === filters.group)) filters.group = '';
  const errors = make('p', 'notice error pantry-browser-error'); errors.hidden = true; errors.setAttribute('role', 'alert');
  const run = action => event => {
    try {action(event); errors.hidden = true; errors.textContent = '';}
    catch (error) {errors.textContent = error.message; errors.hidden = false; onError(error.message);}
  };
  const field = (name, input) => {
    const label = make('label', 'pantry-browser-field', name); label.htmlFor = input.id; label.append(input); return label;
  };
  const option = (value, label) => {const element = make('option', '', label); element.value = value; return element;};
  const group = make('select', 'pantry-browser-group'); group.id = `${prefix}-group`;
  const subgroup = make('select', 'pantry-browser-subgroup'); subgroup.id = `${prefix}-subgroup`;
  const query = make('input', 'pantry-browser-search'); query.id = `${prefix}-search`; query.type = 'search'; query.placeholder = '食材名でも探せます'; query.value = filters.query;
  const ingredient = make('select', 'pantry-browser-ingredient'); ingredient.id = `${prefix}-ingredient`;
  const quantity = make('input', 'pantry-browser-quantity'); quantity.id = `${prefix}-quantity`; quantity.type = 'number'; quantity.min = '0'; quantity.max = '1000000'; quantity.required = true; quantity.value = '';
  const quantityLabel = field('登録する量', quantity), unit = make('span', 'pantry-browser-unit'); unit.setAttribute('aria-live', 'polite'); quantityLabel.append(unit);
  configureQuantityInput(quantity);
  const add = make('button', 'button-primary pantry-browser-save', '手持ちに登録'); add.type = 'button'; add.disabled = true;
  const controls = make('div', 'pantry-browser-controls');
  controls.append(field('ジャンル', group), field('食材の種類', subgroup), field('名前で検索', query), field('具体的な食材', ingredient));
  const amountControls = make('div', 'pantry-browser-amount'); amountControls.append(quantityLabel, add);
  const found = make('p', 'pantry-browser-results'); found.setAttribute('role', 'status');
  const list = make('div', 'pantry-browser-stock');
  root.append(controls, found, amountControls, errors, list);

  group.append(option('', 'ジャンルを選ぶ'), ...INGREDIENT_GROUPS.map(value => option(value.id, value.label)));
  group.value = filters.group;
  const publishFilters = () => onFilterChange({...filters});
  const updateAdd = () => {
    try {readQuantityInput(quantity); add.disabled = !Object.hasOwn(data.ingredients, ingredient.value);}
    catch {add.disabled = true;}
  };
  function updateAmount({reset = false} = {}) {
    const food = data.ingredients[ingredient.value];
    unit.textContent = food ? `単位：${food.unit}` : '';
    quantity.setAttribute('aria-label', food ? `${food.name}の手持ち量（${food.unit}）` : '登録する手持ち量');
    quantity.placeholder = food?.unit === 'g' || food?.unit === 'ml' ? '例：200' : '例：2';
    quantity.disabled = !food;
    if (reset) quantity.value = food ? String(stock.find(part => part.id === ingredient.value)?.amount ?? '') : '';
    updateAdd();
  }
  function renderSubgroups() {
    const choices = pantrySubgroups(filters.group, data);
    if (!choices.some(choice => choice.id === filters.subgroup) && filters.subgroup !== 'all') filters.subgroup = '';
    if (choices.length === 1 && !filters.subgroup) filters.subgroup = choices[0].id;
    subgroup.replaceChildren(option('', '種類を選ぶ'), option('all', 'すべての種類'), ...choices.map(value => option(value.id, value.label)));
    subgroup.disabled = !filters.group;
    subgroup.value = filters.subgroup;
  }
  function renderIngredients() {
    const current = ingredient.value;
    const canBrowse = !!filters.query.trim() || !!filters.group && !!filters.subgroup;
    const matches = canBrowse ? pantryIngredients(filters.group || 'all', filters.subgroup || 'all', filters.query.trim(), data) : [];
    ingredient.replaceChildren(option('', matches.length ? '食材を選ぶ' : canBrowse ? '一致する食材がありません' : 'ジャンルと種類を選んでください'));
    if ((!filters.group || filters.subgroup === 'all') && matches.length) {
      let currentPath = '', currentGroup;
      for (const food of matches) {
        const category = pantryClassification(food.id, data), path = `${category.groupLabel} / ${category.subgroupLabel}`;
        if (path !== currentPath) {currentPath = path; currentGroup = make('optgroup'); currentGroup.label = path; ingredient.append(currentGroup);}
        currentGroup.append(option(food.id, `${food.name}（${food.unit}）`));
      }
    } else ingredient.append(...matches.map(food => option(food.id, `${food.name}（${food.unit}）`)));
    ingredient.value = matches.some(food => food.id === current) ? current : '';
    ingredient.disabled = !matches.length;
    found.textContent = canBrowse ? `${matches.length}種類の食材` : 'ジャンルと種類を選ぶか、食材名で検索できます。';
    updateAmount();
  }
  function renderStock() {
    list.replaceChildren();
    const visibleIds = new Set(pantryIngredients(filters.group || 'all', filters.subgroup || 'all', filters.query, data).map(food => food.id));
    const visible = stock.filter(part => Object.hasOwn(data.ingredients, part.id) && visibleIds.has(part.id))
      .sort((a,b) => comparePantryIngredients(a.id,b.id,data));
    if (!visible.length) {list.append(make('p', 'pantry-browser-empty', stock.length ? '条件に合う手持ち食材がありません。' : '手持ちの食材はまだありません。')); return;}
    let currentPath = '', section;
    for (const part of visible) {
      const food = data.ingredients[part.id], category = pantryClassification(part.id,data), path = `${category.groupLabel} / ${category.subgroupLabel}`;
      if (path !== currentPath) {currentPath = path; section = make('section', 'pantry-browser-stock-group'); section.append(make('h3','',path)); list.append(section);}
      const row = make('div', 'pantry-browser-stock-row'); row.dataset.ingredientId = part.id;
      const title = make('span','pantry-browser-stock-name',food.name), input = make('input','pantry-browser-stock-quantity');
      input.type='number'; input.min='0'; input.max='1000000'; input.required=true; input.value=String(part.amount);
      input.setAttribute('aria-label',`${food.name}の手持ち量（${food.unit}）`); configureQuantityInput(input);
      input.addEventListener('change',run(()=>{const value=readQuantityInput(input);if(onSave(part.id,value)===false){input.value=String(part.amount);return;}part.amount=value;}));
      const remove = make('button','button-text pantry-browser-delete','削除'); remove.type='button'; remove.setAttribute('aria-label',`${food.name}を手持ちから削除`);
      remove.addEventListener('click',run(()=>{if(onDelete(part.id)===false)return;stock=stock.filter(saved=>saved.id!==part.id);renderStock();if(ingredient.value===part.id)updateAmount({reset:true});}));
      const quantityWrap=make('div','pantry-browser-stock-amount');quantityWrap.append(input,make('span','',food.unit));
      row.append(title,quantityWrap,remove);section.append(row);
    }
  }
  group.addEventListener('change',run(()=>{filters.group=group.value;filters.subgroup='';renderSubgroups();renderIngredients();renderStock();publishFilters();}));
  subgroup.addEventListener('change',run(()=>{filters.subgroup=subgroup.value;renderIngredients();renderStock();publishFilters();}));
  query.addEventListener('input',run(()=>{filters.query=query.value;renderIngredients();renderStock();publishFilters();}));
  ingredient.addEventListener('change',run(()=>updateAmount({reset:true})));
  quantity.addEventListener('input',updateAdd);quantity.addEventListener('change',updateAdd);
  add.addEventListener('click',run(()=>{
    const id=ingredient.value;
    if (!Object.hasOwn(data.ingredients,id)) throw Error('手持ちに登録する食材を選んでください。');
    const value=readQuantityInput(quantity);
    if(onSave(id,value)===false)return;
    const prior=stock.find(part=>part.id===id);if(prior)prior.amount=value;else stock.push({id,amount:value});
    renderStock();
  }));
  renderSubgroups();renderIngredients();renderStock();
  return root;
}
