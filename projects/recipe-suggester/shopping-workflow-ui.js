/** メニューごとに必要な材料を選び、外出先で使う一覧へまとめます。 */
import {buildShoppingChecklist} from './shopping-workflow.js';
import {INGREDIENT_GROUPS, ingredientGroup} from './shopping-categories.js';
import {derivePurchase} from './purchase-conversion.js';
import {mountPurchaseEditor} from './purchase-conversion-ui.js';

const make = (tag, className = '', text = '') => {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== '') element.textContent = text;
  return element;
};
const format = value => Number(value.toFixed(3)).toLocaleString('ja-JP');
const amount = (value, unit) => `${format(value)}${unit}`;
const unique = values => [...new Set(values)];
const clone = value => structuredClone(value);
const groupLabel = id => INGREDIENT_GROUPS.find(group => group.id === id)?.label ?? 'その他';

function grouped(items, data) {
  const groups = new Map();
  for (const item of items) {
    const id = ingredientGroup(item.id, data);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(item);
  }
  return [...groups].sort(([a], [b]) => INGREDIENT_GROUPS.findIndex(group => group.id === a) - INGREDIENT_GROUPS.findIndex(group => group.id === b));
}

/** コピー用も、画面と同じ選択済みスナップショットから作ります。 */
export function shoppingChecklistText(prepared, data, {pantry = [], omittedIds = [], checks = [], purchaseSettings = []} = {}) {
  if (prepared === null || prepared === undefined) return '';
  const result = buildShoppingChecklist(prepared, data, {pantry, omittedIds});
  const lines = ['買い物リスト'];
  for (const [id, items] of grouped(result.items.filter(item => item.buy > 0), data)) {
    lines.push(`【${groupLabel(id)}】`);
    for (const item of items) lines.push(`${checks.includes(item.id) ? '✓' : '□'} ${derivePurchase(item, purchaseSettings, data).text}`);
  }
  if (!result.items.some(item => item.buy > 0)) lines.push(result.missingMenus.length ? '確認できた材料の購入はありません。未確認のメニューは別途確認してください。' : '購入する材料はありません。');
  if (result.missingMenus.length) lines.push(`材料未確認：${unique(result.missingMenus.map(menu => menu.name)).join('、')}`);
  return lines.join('\n');
}

/** selectionはメニューIDごとの材料ID。未指定は除外設定以外を選び、[]は明示的な全解除です。 */
export function mountShoppingWorkflow({menus = [], data, pantry = [], omittedIds = [], prepared = null,
  checks = [], purchaseSettings = [], selection = {}, hidePurchased = false,
  onSelectionChange = () => {}, onPrepare = () => {}, onCheck = () => {}, onPurchaseSettings = () => {},
  onHidePurchasedChange = () => {}, onRemoveExtra, onError = () => {}} = {}) {
  const root = make('div', 'shopping-workflow');
  const error = make('p', 'notice error shopping-workflow-error');
  error.hidden = true;
  error.setAttribute('role', 'alert');
  const report = cause => { error.textContent = cause?.message ?? String(cause); error.hidden = false; onError(error.textContent); };
  const run = action => event => { try { action(event); } catch (cause) { report(cause); } };
  const control = (text, className, action) => {
    const button = make('button', className, text); button.type = 'button'; button.addEventListener('click', run(action)); return button;
  };
  const omitted = new Set(omittedIds), chosen = clone(selection);
  const canBuyMaterials = menu => !menu.item.batchId && !menu.item.restaurant && (menu.item.ingredientsKnown === true || menu.item.shoppingKnown === true);
  const materialIds = menu => canBuyMaterials(menu) ? unique((menu.item.ingredients ?? []).filter(part => data.ingredients[part.id] && !omitted.has(part.id)).map(part => part.id)) : [];
  const selectedFor = menu => new Set(Object.hasOwn(chosen, menu.id) ? chosen[menu.id] : materialIds(menu));
  const publishSelection = () => onSelectionChange(clone(chosen));
  const review = make('details', 'shopping-review');
  review.open = prepared === null;
  const reviewSummary = make('summary', 'shopping-review-title', '1. メニューごとに買う食材を選ぶ');
  const reviewBody = make('div', 'shopping-review-body');
  review.append(reviewSummary, reviewBody);
  reviewBody.append(make('p', 'field-note', '必要な材料にチェックを入れてから一覧にまとめます。手持ちの量は、同じ食材を合計した後に1回だけ差し引きます。'));
  const toolbar = make('div', 'shopping-selection-actions');
  const cards = make('div', 'shopping-menu-cards');
  const status = make('p', 'shopping-selection-status');
  status.setAttribute('role', 'status');
  const eligibleMenus = menus.filter(menu => !menu.item.batchId && !menu.item.restaurant);
  const candidateSelections = () => menus.map(menu => ({id: menu.id, item: clone(menu.item), servings: menu.servings,
    ingredientIds: [...selectedFor(menu)].filter(id => materialIds(menu).includes(id))}));
  function updateSelectionStatus() {
    const selections = candidateSelections();
    const count = selections.reduce((total, menu) => total + menu.ingredientIds.length, 0);
    status.textContent = `${menus.length}メニューから${count}件の材料を選択中（同じ食材は次で合算します）`;
  }
  function changeAll(checked) {
    for (const menu of eligibleMenus) chosen[menu.id] = checked ? materialIds(menu) : [];
    publishSelection(); renderMenuCards(); updateSelectionStatus();
  }
  toolbar.append(control('材料をすべて選ぶ', 'button-secondary shopping-select-all', () => changeAll(true)),
    control('材料の選択をすべて外す', 'button-secondary shopping-select-none', () => changeAll(false)));
  reviewBody.append(toolbar, status, cards);

  function renderMenuCards() {
    cards.replaceChildren();
    if (!menus.length) { cards.append(make('p', 'field-note', '献立を選ぶか、メニューの詳細から買い物に追加してください。')); return; }
    for (const menu of menus) {
      const card = make('article', 'shopping-menu-card'); card.dataset.menuId = menu.id;
      const heading = make('div', 'shopping-menu-heading');
      heading.append(make('h4', '', menu.item.name));
      if (menu.extra && typeof onRemoveExtra === 'function') heading.append(control('候補から外す', 'button-text shopping-remove-extra', () => onRemoveExtra(menu.id)));
      card.append(heading, make('p', 'shopping-menu-context', `${menu.label ? `${menu.label} · ` : ''}${menu.servings}人分${menu.item.portion ? ` · 1人あたり${amount(menu.item.portion.amount * menu.item.quantity, menu.item.portion.unit)}` : ''}`));
      if (menu.item.batchId || menu.item.restaurant) {
        card.append(make('p', 'field-note', menu.item.batchId ? '作り置きの取り分けは調理済みのため、材料を買い足しません。' : '外食の記録は、調理用の材料を買う対象に含めません。'));
        cards.append(card); continue;
      }
      const ids = materialIds(menu), selected = selectedFor(menu);
      const menuToggle = make('label', 'shopping-menu-toggle');
      const menuCheck = make('input'); menuCheck.type = 'checkbox';
      menuCheck.checked = ids.length > 0 && ids.every(id => selected.has(id));
      menuCheck.indeterminate = ids.some(id => selected.has(id)) && !menuCheck.checked;
      menuCheck.disabled = !ids.length;
      menuCheck.setAttribute('aria-label', `${menu.item.name}の材料をまとめて選ぶ`);
      menuToggle.append(menuCheck, make('span', '', 'このメニューの材料をまとめて選ぶ'));
      menuCheck.addEventListener('change', run(() => { chosen[menu.id] = menuCheck.checked ? ids : []; publishSelection(); renderMenuCards(); updateSelectionStatus(); }));
      card.append(menuToggle);
      const parts = new Map();
      for (const part of menu.item.ingredients ?? []) if (data.ingredients[part.id]) parts.set(part.id, (parts.get(part.id) ?? 0) + part.amount * menu.item.quantity * menu.servings);
      const ingredients = make('div', 'shopping-menu-materials');
      for (const [id, required] of parts) {
        const ingredient = data.ingredients[id], label = make('label', 'shopping-material-choice'), input = make('input');
        input.type = 'checkbox'; input.checked = selected.has(id) && !omitted.has(id) && canBuyMaterials(menu); input.disabled = omitted.has(id) || !canBuyMaterials(menu);
        input.setAttribute('aria-label', `${menu.item.name}の${ingredient.name}を買う`);
        const description = make('span'); description.append(make('strong', '', ingredient.name),
          make('small', '', `${amount(required, ingredient.unit)}${omitted.has(id) ? ' · 買い物に含めない設定' : !canBuyMaterials(menu) ? ' · 材料未確認のため集計対象外' : ''}`));
        label.append(input, description);
        input.addEventListener('change', run(() => {
          const next = selectedFor(menu); if (input.checked) next.add(id); else next.delete(id);
          chosen[menu.id] = [...next]; publishSelection();
          menuCheck.checked = ids.every(value => next.has(value)); menuCheck.indeterminate = ids.some(value => next.has(value)) && !menuCheck.checked;
          updateSelectionStatus();
        })); ingredients.append(label);
      }
      if (parts.size) card.append(ingredients);
      if (!menu.item.ingredientsKnown || !parts.size || (menu.item.ingredients ?? []).some(part => !data.ingredients[part.id])) card.append(make('p', 'shopping-review-warning', canBuyMaterials(menu) ? '材料が未登録・未確認の部分があります。表示された材料だけで全部とは限らないため、実際の商品や材料も確認してください。' : '材料や買う商品の量が未確認のため、この料理の購入量は集計しません。実際の商品や材料を確認してください。'));
      cards.append(card);
    }
  }
  renderMenuCards(); updateSelectionStatus();
  const prepare = control(prepared === null ? '選んだ食材で買い物リストを作る' : '選んだ食材でリストを作り直す', 'button-primary shopping-prepare', () => onPrepare(candidateSelections()));
  prepare.disabled = !menus.length;
  reviewBody.append(prepare, make('p', 'field-note', '一覧を作り直すと購入済みのチェックをリセットします。献立を変えただけでは、下の買い物リストは変わりません。'));
  root.append(review, error);

  const final = make('section', 'shopping-final');
  final.setAttribute('aria-label', '外出用の買い物リスト');
  final.append(make('h3', '', '2. 買い物チェックリスト'));
  if (prepared === null) {
    final.append(make('p', 'shopping-final-prompt', '上で買う材料を選び、「買い物リストを作る」を押してください。完成した一覧はこの端末に保存されます。'));
    root.append(final); return root;
  }
  final.append(make('p', 'shopping-final-note', '最後にまとめた食材の一覧です。材料名の下から、使うメニューと必要量を確認できます。'));
  try {
    const result = buildShoppingChecklist(prepared, data, {pantry, omittedIds});
    const needed = result.items.filter(item => item.buy > 0), inStock = result.items.filter(item => item.buy === 0), bought = new Set(checks);
    const progress = make('p', 'shopping-check-progress'); progress.setAttribute('role', 'status'); progress.setAttribute('aria-live', 'polite');
    const hideLabel = make('label', 'shopping-hide-purchased'), hide = make('input'); hide.type = 'checkbox'; hide.checked = hidePurchased;
    hideLabel.append(hide, make('span', '', '購入済みを隠す')); final.append(progress, hideLabel);
    const checklist = make('div', 'shopping-checklist'); final.append(checklist);
    const rows = [];
    function refreshProgress() {
      const done = needed.filter(item => bought.has(item.id)).length;
      progress.textContent = `${needed.length}品目中 ${done}品目を購入済み${needed.length && done === needed.length ? ' · すべて揃いました' : ''}`;
      for (const {item, row} of rows) { row.className = `shopping-check-row${bought.has(item.id) ? ' is-purchased' : ''}`; row.hidden = hide.checked && bought.has(item.id); }
      for (const group of checklist.children) group.hidden = !rows.some(row => row.group === group && !row.row.hidden);
    }
    hide.addEventListener('change', run(() => { refreshProgress(); onHidePurchasedChange(hide.checked); }));
    for (const [groupId, items] of grouped(needed, data)) {
      const group = make('section', 'shopping-check-group'); group.append(make('h4', '', groupLabel(groupId)));
      for (const item of items) {
        const row = make('article', 'shopping-check-row'); row.dataset.ingredientId = item.id;
        const check = make('input'); check.type = 'checkbox'; check.checked = bought.has(item.id); check.setAttribute('aria-label', `${item.name}を購入済みにする`);
        const purchase = derivePurchase(item, purchaseSettings, data), label = make('label', 'shopping-check-label'), text = make('span', 'shopping-check-description');
        text.append(make('strong', '', purchase.name), make('span', 'shopping-check-quantity', `${purchase.packCount === null ? amount(purchase.amount, purchase.unit) : `${purchase.packCount}${purchase.packUnit}`}必要`));
        if (purchase.packCount !== null) text.append(make('small', '', `1${purchase.packUnit} ${amount(purchase.packSize, purchase.unit)} · 計${amount(purchase.packedAmount, purchase.unit)}`));
        label.append(check, text); row.append(label);
        const sources = make('details', 'shopping-ingredient-sources'); sources.append(make('summary', '', `使うメニュー（${item.sources.length}件）・必要量`));
        sources.append(make('p', 'shopping-source-total', `材料の状態：合計 ${amount(item.required, item.unit)} ／ 手持ち ${amount(item.stock, item.unit)} ／ 不足 ${amount(item.buy, item.unit)}`));
        const sourceList = make('ul');
        for (const source of item.sources) sourceList.append(make('li', '', `${source.name}（${source.servings}人分） ${amount(source.amount, source.unit)}`));
        sources.append(sourceList); row.append(sources);
        row.append(mountPurchaseEditor({item, settings: purchaseSettings, data, onSave: onPurchaseSettings, onError: message => { if (message) onError(message); }}));
        check.addEventListener('change', run(() => {
          const wasChecked = bought.has(item.id);
          if (check.checked) bought.add(item.id); else bought.delete(item.id);
          refreshProgress();
          try { if (onCheck(item.id, check.checked) === false) { check.checked = wasChecked; if (wasChecked) bought.add(item.id); else bought.delete(item.id); refreshProgress(); } }
          catch (cause) { check.checked = wasChecked; if (wasChecked) bought.add(item.id); else bought.delete(item.id); refreshProgress(); throw cause; }
        }));
        group.append(row); rows.push({item, row, group});
      }
      checklist.append(group);
    }
    if (!needed.length) final.append(make('p', 'shopping-nothing-needed', result.missingMenus.length ? '確認できた材料の購入はありません。未確認のメニューは別途確認してください。' : '購入する材料はありません。手持ちで足りる材料や、選択しなかった材料は購入一覧に含めません。'));
    if (inStock.length) {
      const stock = make('details', 'shopping-stock-summary'); stock.append(make('summary', '', `手持ちで足りる材料（${inStock.length}品目）`));
      const list = make('ul'); inStock.forEach(item => list.append(make('li', '', `${item.name}：必要 ${amount(item.required, item.unit)} ／ 手持ち ${amount(item.stock, item.unit)}`))); stock.append(list); final.append(stock);
    }
    if (result.omittedItems.length) final.append(make('p', 'field-note shopping-omitted-note', `買い物に含めない設定：${result.omittedItems.map(item => item.name).join('、')}`));
    if (result.missingMenus.length) final.append(make('p', 'notice error shopping-missing-note', `材料が未登録・未確認のメニュー：${unique(result.missingMenus.map(menu => menu.name)).join('、')}。表示された食材だけで全部とは限りません。`));
    refreshProgress();
  } catch (cause) { report(cause); }
  root.append(final); return root;
}
