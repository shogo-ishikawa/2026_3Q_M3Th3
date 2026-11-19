import {cookingIngredientGuide, portionLabel} from './portion-guide.js';

const element = (tag, text) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};

function hasCookingIngredients(item) {
  return !item.batchId && !item.diningMatch && !item.restaurant && (item.ingredientsKnown || item.shoppingKnown);
}

/** スナップショットの材料は標準1人分。選んだ一皿の量と作る人数を掛けてから合算する。 */
export function cookingIngredients(items, servings) {
  if (!Number.isInteger(servings) || servings < 1 || servings > 8) throw Error('作る人数は1〜8人から選んでください。');
  const totals = new Map();
  for (const item of items) {
    if (!hasCookingIngredients(item)) continue;
    for (const part of item.ingredients) {
      const row = totals.get(part.id) ?? {id: part.id, amount: 0, uses: []};
      const amount = part.amount * item.quantity * servings;
      row.amount += amount;
      row.uses.push({name: item.name, amount});
      totals.set(part.id, row);
    }
  }
  return [...totals.values()];
}

function checklistLine(title, detail) {
  const li = element('li'), label = element('label'), checkbox = element('input');
  checkbox.type = 'checkbox';
  const text = element('span', title);
  if (detail) text.append(element('small', detail));
  label.append(checkbox, text);
  li.append(label);
  return li;
}

function preparedNote(item, data) {
  if (item.batchId) return '作り置きから取り分ける量：' + portionLabel(item, data);
  if (item.diningMatch || item.restaurant) return '外食の予定です。';
  if (!hasCookingIngredients(item) || !item.ingredients.length) return '材料の分量は未確認です。';
  return '';
}

export function mountCookingView({items, servings, data}) {
  const root = element('div');
  root.className = 'cooking-view';
  const toolbar = element('div');
  toolbar.className = 'cooking-toolbar';
  const field = element('label', '作る人数'), people = element('select');
  for (let count = 1; count <= 8; count++) {
    const option = element('option', count + '人分');
    option.value = String(count);
    people.append(option);
  }
  people.value = String(servings);
  field.append(people);
  const materials = element('section'), instructions = element('section');
  const tabs = element('div');
  tabs.className = 'cooking-switch';
  tabs.setAttribute('role', 'group');
  tabs.setAttribute('aria-label', '調理表示の切り替え');
  for (const [title, panel] of [['材料', materials], ['作り方', instructions]]) {
    const button = element('button', title);
    button.type = 'button';
    button.className = 'button-secondary';
    button.setAttribute('aria-pressed', String(panel === materials));
    button.addEventListener('click', () => {
      materials.hidden = panel !== materials;
      instructions.hidden = panel !== instructions;
      for (const other of tabs.children) other.setAttribute('aria-pressed', String(other === button));
    });
    tabs.append(button);
  }
  toolbar.append(tabs, field);
  root.append(toolbar, materials, instructions);
  instructions.hidden = true;
  const heading = element('h3'), list = element('ul');
  list.className = 'cooking-checklist';
  materials.append(heading, list);
  function refreshAmounts() {
    const count = Number(people.value), rows = cookingIngredients(items, count);
    heading.textContent = '用意する材料（' + count + '人分）';
    list.replaceChildren(...rows.map(row => {
      const ingredient = cookingIngredientGuide(row.id, row.amount, data);
      const detail = row.uses.map(use => row.uses.length === 1 ? use.name :
        use.name + ' ' + cookingIngredientGuide(row.id, use.amount, data).amountText).join(' ／ ');
      return checklistLine(ingredient.text, detail);
    }));
  }
  people.addEventListener('change', refreshAmounts);
  refreshAmounts();
  instructions.append(element('h3', '料理ごとの手順'));
  for (const item of items) {
    const note = preparedNote(item, data);
    if (note) materials.append(element('p', item.name + ' ｜ ' + note));
    const dish = element('details');
    dish.open = items.length === 1;
    dish.append(element('summary', item.name));
    if (item.batchId || item.diningMatch || item.restaurant) {
      dish.append(element('p', note));
    } else if (item.steps.length) {
      if (item.ingredientEdit) dish.append(element('p', '材料はこの予定で編集した分量です。手順は元の料理の内容です。'));
      const steps = element('ol');
      steps.className = 'cooking-checklist cooking-steps';
      item.steps.forEach((step, i) => steps.append(checklistLine((i + 1) + '. ' + step)));
      dish.append(steps);
    } else {
      const bought = ['instant', 'retort', 'ready-to-eat', 'fast-food'].includes(item.nature);
      dish.append(element('p', bought ? '調理や温め方は商品の表示を確認してください。' : '作り方は未登録です。'));
    }
    instructions.append(dish);
  }
  return root;
}
