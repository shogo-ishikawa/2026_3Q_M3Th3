import {stockPurchaseId} from './strained-stock.js';
/** 買うもの・献立・購入済みを別々の画面に表示します。 */
import {pendingShopping, shoppingMenuStatuses, visibleReceipts} from './shopping-status.js';
import {INGREDIENT_GROUPS, ingredientGroup} from './shopping-categories.js';
import {derivePurchase, purchasedToPantry, purchaseDefaults} from './purchase-conversion.js';
import {configureQuantityInput, readQuantityInput} from './quantity-input.js';
import {mountPurchaseEditor} from './purchase-conversion-ui.js';
import {formatCookingIngredient, formatPurchaseAmount, portionLabel} from './portion-guide.js';

const make = (tag, className = '', text = '') => {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== '') element.textContent = text;
  return element;
};
const unique = values => [...new Set(values)];
const clone = value => structuredClone(value);
const groupLabel = id => INGREDIENT_GROUPS.find(group => group.id === id)?.label ?? 'その他';
const fullSelection = menu => ({...menu, ingredientIds: unique((menu.item.ingredients ?? []).map(part => part.id))});
const stockQuantity = (value, unit) => value.toLocaleString('ja-JP', {maximumSignificantDigits: 12}) + unit;
const materialAmount = (id, value, data) => formatCookingIngredient(id, value, data, {includeName: false});

function grouped(items, data) {
  const groups = new Map();
  for (const item of items) {
    const id = ingredientGroup(item.id, data);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(item);
  }
  return [...groups].sort(([a], [b]) => INGREDIENT_GROUPS.findIndex(group => group.id === a) - INGREDIENT_GROUPS.findIndex(group => group.id === b));
}

function mergeCatalog(...collections) {
  const menus = new Map();
  for (const collection of collections) for (const menu of collection ?? []) if (!menus.has(menu.id)) {
    menus.set(menu.id, menu.stockScope === 'selected' ? menu : fullSelection(menu));
  }
  return [...menus.values()];
}

function purchaseText(item, purchaseSettings, data) {
  const purchase = derivePurchase(item, purchaseSettings, data);
  const quantity = purchase.packCount === null ? formatPurchaseAmount(purchase.amount, purchase.unit) : `${purchase.packCount}${purchase.packUnit}`;
  // 包装サイズは設定した値を使う。購入量の目安と同じ丸めを使うと別の包装に見える。
  const packLabel = purchase.packCount === null ? '' : `1${purchase.packUnit} ${purchase.packSize.toLocaleString('ja-JP', {maximumSignificantDigits: 15})}${purchase.unit}`;
  return {purchase, quantity, packLabel};
}

/** コピー対象も購入履歴を差し引いた「これから買う分」だけです。 */
export function shoppingChecklistText(prepared, data, {pantry = [], omittedIds = [], receipts = [], purchaseSettings = [], catalog} = {}) {
  if (prepared === null || prepared === undefined) return '';
  const result = pendingShopping(prepared, data, {pantry, omittedIds, receipts, catalog});
  const needed = result.items.filter(item => item.buy > 0);
  if (!needed.length && !result.missingMenus.length) return '';
  const lines = ['買い物リスト'];
  for (const [id, items] of grouped(needed, data)) {
    lines.push(`【${groupLabel(id)}】`);
    for (const item of items) {
      const {purchase, quantity, packLabel} = purchaseText(item, purchaseSettings, data);
      lines.push(`□ ${purchase.name} ${quantity}${packLabel ? `（${packLabel}）` : ''}`);
    }
  }
  if (!needed.length) lines.push('未確認の材料があります。');
  if (result.missingMenus.length) lines.push(`材料未確認：${unique(result.missingMenus.map(menu => menu.name)).join('、')}`);
  return lines.join('\n');
}

export async function copyShoppingChecklist(field, fallback) {
  if (!field.value) return '';
  try {
    await navigator.clipboard.writeText(field.value);
    fallback.hidden = true;
    return '未購入リストをコピーしました。';
  } catch {
    if (!field.value) return '';
    fallback.hidden = false;
    field.focus();
    field.select();
    return '選択した買い物リストを手動でコピーしてください。';
  }
}

/** 選択は献立IDごとの食材ID。[]は明示的な全解除です。 */
export function mountShoppingWorkflow({view = 'checklist', menus = [], catalog = menus, data, pantry = [], omittedIds = [], prepared = null, singleCatalog,
  receipts = [], purchaseSettings = [], selection = {}, now, showPerMenuAdd = true,
  onSelectionChange = () => {}, onPrepare = () => {}, onPurchase = () => {}, onUndoPurchase = () => {}, onStockReceipt, canStockReceipt = () => true,
  onPurchaseSettings = () => {}, onRemoveIngredient, onRemoveExtra, onOpenMenu, onError = () => {}} = {}) {
  if (!['review', 'checklist', 'purchased'].includes(view)) throw Error('買い物の表示先を確認してください。');
  const root = make('div', `shopping-workflow shopping-view-${view}`);
  const error = make('p', 'notice error shopping-workflow-error'); error.hidden = true; error.setAttribute('role', 'alert');
  const report = cause => { error.textContent = cause?.message ?? String(cause); error.hidden = false; onError(error.textContent); };
  const run = action => event => { try { action(event); } catch (cause) { report(cause); } };
  const control = (text, className, action) => {
    const button = make('button', className, text); button.type = 'button'; button.addEventListener('click', run(action)); return button;
  };
  root.append(error);
  const allMenus = mergeCatalog(catalog, menus, prepared);
  if (view === 'review' && !showPerMenuAdd && menus.length === 1) {
    // 以前は一部だけ追加した料理も、詳細の購入状況は今選び直せる全材料で示す。
    const index = allMenus.findIndex(menu => menu.id === menus[0].id);
    allMenus[index] = fullSelection(menus[0]);
  }
  const ledgerOptions = {pantry, omittedIds, receipts, catalog: allMenus};

  function showWarnings(result, container) {
    if (result.missingMenus.length) container.append(make('p', 'notice error shopping-missing-note', `材料未確認：${unique(result.missingMenus.map(menu => menu.name)).join('、')}`));
  }

  function renderReview() {
    const review = make('section', 'shopping-review'); review.setAttribute('aria-label', '買い物に使う献立');
    const toolbar = make('div', 'shopping-selection-actions'), status = make('p', 'shopping-selection-status'); status.setAttribute('role', 'status');
    const cards = make('div', 'shopping-menu-cards'), chosen = clone(selection), omitted = new Set(omittedIds.map(stockPurchaseId));
    const totals = pendingShopping(allMenus, data, ledgerOptions);
    const statuses = new Map(shoppingMenuStatuses(allMenus, data, ledgerOptions).map(item => [item.menuId, item]));
    const pendingByMenu = new Map();
    for (const ingredient of totals.items) for (const source of ingredient.sources) {
      if (!pendingByMenu.has(source.menuId)) pendingByMenu.set(source.menuId, new Map());
      pendingByMenu.get(source.menuId).set(ingredient.id, source);
    }
    const canBuy = menu => !menu.item.batchId && !menu.item.restaurant && !menu.item.diningMatch && (menu.item.ingredientsKnown === true || menu.item.shoppingKnown === true);
    const materialIds = menu => canBuy(menu) ? unique((menu.item.ingredients ?? []).filter(part => data.ingredients[part.id] && !omitted.has(stockPurchaseId(part.id)) && (pendingByMenu.get(menu.id)?.get(stockPurchaseId(part.id))?.buy ?? 0) > 0).map(part => part.id)) : [];
    const weekly = new Map(menus.map(menu => [menu.id, materialIds(menu)]));
    // 単品追加に未選択の別料理の予約を持ち込まない。購入済みと確定した在庫は共用する。
    const singleSources = new Map(), individual = new Map(), available = new Map();
    for (const menu of menus) {
      const additional = pendingShopping([fullSelection(menu)], data,
        {pantry, omittedIds, receipts, catalog:singleCatalog ?? prepared ?? []});
      const byId = new Map(additional.items.map(row => [row.id, row.sources[0]]));
      singleSources.set(menu.id, byId);
      const ids = canBuy(menu) ? unique(menu.item.ingredients.filter(part =>
        (byId.get(stockPurchaseId(part.id))?.buy ?? 0) > 0).map(part => part.id)) : [];
      individual.set(menu.id, ids);
      available.set(menu.id, showPerMenuAdd ? unique([...weekly.get(menu.id), ...ids]) : ids);
    }
    const selectedFor = menu => new Set(Object.hasOwn(chosen, menu.id) ? chosen[menu.id] : available.get(menu.id));
    const selectedIds = (menu, choices = available) => choices.get(menu.id).filter(id => selectedFor(menu).has(id));
    const publish = () => onSelectionChange(clone(chosen));
    function prepareMenus(candidates, single) {
      const selections = candidates.map(({extra, ...menu}) => ({...menu, item: clone(menu.item),
        ingredientIds: selectedIds(menu, single ? individual : weekly)})).filter(menu => menu.ingredientIds.length);
      if (selections.length) onPrepare(selections, {single});
    }
    const refreshChecks = [];
    function updateStatus() {
      const count = menus.filter(menu => selectedIds(menu, showPerMenuAdd ? weekly : individual).length).length;
      status.textContent = `${count}品の材料を選択中`;
      prepare.disabled = !count;
    }
    function changeAll(checked) {
      for (const menu of menus) chosen[menu.id] = checked ? available.get(menu.id) : [];
      publish();
      for (const refresh of refreshChecks) refresh();
      updateStatus();
    }
    toolbar.append(control('すべて選ぶ', 'button-secondary shopping-select-all', () => changeAll(true)),
      control('選択を外す', 'button-secondary shopping-select-none', () => changeAll(false)));
    const prepare = control('選んだ食材を買い物リストに追加', 'button-primary shopping-prepare', () => prepareMenus(menus, !showPerMenuAdd));
    if (showPerMenuAdd || menus.length !== 1) review.append(toolbar, status);
    review.append(cards, prepare); root.append(review);
    function renderCards() {
      cards.replaceChildren();
      if (!menus.length) { cards.append(make('p', 'shopping-empty', 'この期間の献立はありません。')); return; }
      for (const menu of menus) {
        const card = make('article', 'shopping-menu-card'); card.dataset.menuId = menu.id;
        const heading = make('div', 'shopping-menu-heading'), title = make('h4', '', menu.item.name);
        const state = statuses.get(menu.id);
        heading.append(title, make('span', `shopping-menu-status is-${state?.status ?? 'unknown'}`, state?.label ?? '材料を確認'));
        card.append(heading, make('p', 'shopping-menu-context', [menu.label ?? '', `${menu.servings}人分`, `1人あたり ${portionLabel(menu.item, data)}`].filter(Boolean).join(' · ')));
        const actions = make('div', 'shopping-menu-actions');
        if (typeof onOpenMenu === 'function') actions.append(control('レシピを見る', 'button-text shopping-open-menu', () => onOpenMenu(clone(menu))));
        if (menu.extra && typeof onRemoveExtra === 'function') actions.append(control('候補から外す', 'button-text shopping-remove-extra', () => onRemoveExtra(menu.id)));
        if (actions.children.length) card.append(actions);
        if (menu.item.batchId || menu.item.restaurant || menu.item.diningMatch) { card.append(make('p', 'shopping-menu-note', menu.item.batchId ? '作り置き済み' : '外食のため買い物なし')); cards.append(card); continue; }
        const ids = available.get(menu.id), selected = selectedFor(menu), inputs = new Map(), menuToggle = make('label', 'shopping-menu-toggle'), menuCheck = make('input'); menuCheck.type = 'checkbox';
        const addOne = showPerMenuAdd && ids.length
          ? control('この料理の食材だけを追加', 'button-secondary shopping-prepare-menu', () => prepareMenus([menu], true)) : null;
        const updateMenuCheck = () => {
          const selectedCount = selectedIds(menu).length;
          menuCheck.checked = ids.length > 0 && selectedCount === ids.length;
          menuCheck.indeterminate = selectedCount > 0 && !menuCheck.checked;
          if (addOne) addOne.disabled = !selectedIds(menu, individual).length;
        };
        const refresh = () => {
          const selection = selectedFor(menu);
          for (const [id, input] of inputs) input.checked = !input.disabled && selection.has(id);
          updateMenuCheck();
        };
        refreshChecks.push(refresh);
        updateMenuCheck(); menuCheck.disabled = !ids.length; menuCheck.setAttribute('aria-label', `${menu.item.name}の残りの材料をまとめて選ぶ`);
        menuToggle.append(menuCheck, make('span', '', '残りの材料を選ぶ'));
        menuCheck.addEventListener('change', run(() => { chosen[menu.id] = menuCheck.checked ? ids : []; publish(); refresh(); updateStatus(); })); card.append(menuToggle);
        const parts = new Map();
        for (const part of menu.item.ingredients ?? []) if (data.ingredients[part.id]) parts.set(part.id, (parts.get(part.id) ?? 0) + part.amount * menu.item.quantity * menu.servings);
        if (parts.size) {
          const details = make('details', 'shopping-menu-ingredients'); details.append(make('summary', '', `食材 ${parts.size}種類`));
          const ingredients = make('div', 'shopping-menu-materials');
          for (const [id, required] of parts) {
            const ingredient = data.ingredients[id], purchaseId = stockPurchaseId(id);
            const single = singleSources.get(menu.id).get(purchaseId);
            const source = showPerMenuAdd ? pendingByMenu.get(menu.id)?.get(purchaseId) : single;
            const label = make('label', 'shopping-material-choice'), input = make('input'); input.type = 'checkbox';
            inputs.set(id, input); input.checked = selected.has(id) && ids.includes(id); input.disabled = !ids.includes(id); input.setAttribute('aria-label', `${menu.item.name}の${ingredient.name}を買う`);
            const description = make('span'), notes = [];
            if (omitted.has(stockPurchaseId(id))) notes.push('常備品として除外');
            else if (!canBuy(menu)) notes.push('材料未確認');
            else if ((source?.buy ?? 0) === 0) notes.push((source?.purchased ?? 0) > 0 ? '購入済み' : '手持ちで足ります');
            else {
              notes.push(`残り ${materialAmount(id, source.buy, data)}`);
              if ((source?.purchased ?? 0) > 0) notes.push(`購入済み ${materialAmount(id, source.purchased, data)}`);
            }
            if (showPerMenuAdd && canBuy(menu) && (single?.buy ?? 0) !== (source?.buy ?? 0)) {
              notes.push(single?.buy > 0 ? `この料理だけなら ${materialAmount(id, single.buy, data)}` : 'この料理だけなら購入不要');
            }
            description.append(make('strong', '', ingredient.name), make('small', '', notes.join(' · ')));
            label.append(input, description); ingredients.append(label);
            input.addEventListener('change', run(() => {
              const next = selectedFor(menu); if (input.checked) next.add(id); else next.delete(id);
              chosen[menu.id] = [...next]; publish(); updateMenuCheck(); updateStatus();
            }));
          }
          details.append(ingredients); card.append(details);
        }
        if (addOne) {
          addOne.setAttribute('aria-label', [menu.label, menu.item.name, 'この料理の食材だけを追加'].filter(Boolean).join(' '));
          card.append(addOne);
        }
        if (state?.unknown || !menu.item.ingredientsKnown || !parts.size) card.append(make('p', 'shopping-review-warning', '未確認の材料があります。'));
        cards.append(card);
      }
    }
    renderCards(); updateStatus();
  }

  function renderChecklist() {
    const final = make('section', 'shopping-final'); final.setAttribute('aria-label', 'お買い物チェックリスト'); root.append(final);
    if (prepared === null) { final.append(make('p', 'shopping-empty', '献立リストから食材を追加してください。')); return; }
    const result = pendingShopping(prepared, data, ledgerOptions), needed = result.items.filter(item => item.buy > 0);
    const progress = make('p', 'shopping-check-progress'); progress.setAttribute('role', 'status'); progress.setAttribute('aria-live', 'polite');
    const checklist = make('div', 'shopping-checklist'), rows = [];
    final.append(progress, checklist);
    const updateProgress = () => { const count = rows.filter(row => !row.row.hidden).length; progress.textContent = count ? `残り ${count}品目` : result.missingMenus.length ? '未確認の材料があります' : '買うものは揃っています'; for (const group of checklist.children) group.hidden = !rows.some(item => item.group === group && !item.row.hidden); };
    for (const [groupId, items] of grouped(needed, data)) {
      const group = make('section', 'shopping-check-group'); group.append(make('h4', '', groupLabel(groupId)));
      for (const item of items) {
        const row = make('article', 'shopping-check-row'); row.dataset.ingredientId = item.id;
        const check = make('input'); check.type = 'checkbox'; check.checked = false; check.setAttribute('aria-label', `${item.name}を購入済みにする`);
        const {purchase, quantity, packLabel} = purchaseText(item, purchaseSettings, data), label = make('label', 'shopping-check-label'), text = make('span', 'shopping-check-description');
        text.append(make('strong', '', purchase.name), make('span', 'shopping-check-quantity', quantity));
        if (packLabel) text.append(make('small', '', packLabel));
        label.append(check, text); row.append(label);
        const sources = make('details', 'shopping-ingredient-sources'); sources.append(make('summary', '', `使う献立 ${item.sources.length}品`));
        const list = make('ul');
        for (const source of item.sources) {
          const menu = allMenus.find(menu => menu.id === source.menuId);
          const state = source.buy > 0 ? `未購入 ${materialAmount(item.id, source.buy, data)}` : source.purchased > 0 ? '購入済み' : '手持ちで用意済み';
          list.append(make('li', '', `${menu?.label ? `${menu.label} · ` : ''}${source.name}（${source.servings}人分） ${materialAmount(item.id, source.amount, data)} · ${state}`));
        }
        sources.append(list, mountPurchaseEditor({item, settings: purchaseSettings, data, onSave: onPurchaseSettings, onError: message => { if (message) onError(message); }}));
        if (onRemoveIngredient) {
          const remove = control('今回のリストから外す', 'button-text shopping-remove-ingredient', () => {
            const menuIds = item.sources.filter(source => source.buy > 0).map(source => source.menuId);
            if (onRemoveIngredient(item.id, menuIds) === false) return;
            row.hidden = true; updateProgress();
          });
          remove.setAttribute('aria-label', `${item.name}を今回のリストから外す`);
          sources.append(remove);
        }
        row.append(sources);
        check.addEventListener('change', run(() => {
          if (!check.checked) return;
          row.hidden = true; updateProgress();
          try { if (onPurchase(item.id) === false) { row.hidden = false; check.checked = false; updateProgress(); } }
          catch (cause) { row.hidden = false; check.checked = false; updateProgress(); throw cause; }
        }));
        group.append(row); rows.push({item, row, group});
      }
      checklist.append(group);
    }
    updateProgress(); showWarnings(result, final);
  }

  function stockControl(receipt, purchase, foodName) {
    const wrapper = make('div', 'shopping-stock-control');
    const amountLabel = receipt.purchaseSetting ? '実際に買った量' : '手持ちに入れる量';
    const label = make('label', '', `${amountLabel}（${purchase.unit}）`);
    const input = make('input', 'shopping-stock-input');
    input.type = 'number';
    input.min = '0';
    input.required = true;
    input.setAttribute('aria-label', `${purchase.name}の${amountLabel}（${purchase.unit}）`);
    const initial = purchase.packedAmount ?? purchase.amount;
    const initialText = initial.toLocaleString('en-US', {useGrouping: false, maximumSignificantDigits: 12});
    input.value = initialText;
    configureQuantityInput(input);
    label.append(input);
    function stockAmount() {
      const actual = readQuantityInput(input, {label: amountLabel});
      return purchasedToPantry(purchase, input.value === initialText ? initial : actual, data);
    }
    const transfer = control('手持ちに追加', 'button-secondary shopping-stock-receipt', () => onStockReceipt(receipt.id, stockAmount()));
    function update() {
      try {
        const value = stockAmount();
        transfer.textContent = `手持ちに追加（${foodName} ${stockQuantity(value, purchase.sourceUnit)}）`;
        transfer.disabled = false;
      } catch {
        transfer.textContent = '手持ちに追加';
        transfer.disabled = true;
      }
    }
    input.addEventListener('input', update);
    update();
    wrapper.append(label, transfer);
    return wrapper;
  }

  function renderPurchased() {
    const section = make('section', 'shopping-purchased'); section.setAttribute('aria-label', '購入済みの食材'); root.append(section);
    const recent = visibleReceipts(receipts, {now, days: 7});
    if (!recent.length) { section.append(make('p', 'shopping-empty', '最近の購入済み食材はありません。')); return; }
    const count = make('p', 'shopping-purchased-count', `${recent.length}件`), list = make('div', 'shopping-receipt-list'); section.append(count, list);
    for (const receipt of recent) {
      const ingredient = data.ingredients[receipt.ingredientId], row = make('article', 'shopping-receipt-row'); row.dataset.receiptId = receipt.id;
      const foodName = ingredient?.name ?? '現在の一覧にない食材';
      // 過去の購入設定がない履歴は、保存済みの材料単位で扱います。
      let purchase = null;
      if (ingredient) {
        const setting = receipt.purchaseSetting ?? {
          ...purchaseDefaults(receipt.ingredientId, data), mode: 'same', yieldFactor: 1, purchaseName: foodName
        };
        purchase = purchaseText({id: receipt.ingredientId, unit: ingredient.unit, buy: receipt.amount}, [setting], data);
      }
      const heading = make('div', 'shopping-receipt-heading');
      const stocked = receipt.stocked && ingredient;
      heading.append(make('strong', '', stocked ? foodName : purchase?.purchase.name ?? foodName),
        make('span', 'shopping-check-quantity', stocked ? stockQuantity(receipt.stockedAmount ?? receipt.amount, ingredient.unit) : purchase?.quantity ?? String(receipt.amount)));
      const stamp = new Date(receipt.purchasedAt), date = Number.isNaN(stamp.getTime()) ? '' : new Intl.DateTimeFormat('ja-JP', {month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'}).format(stamp);
      row.append(heading, make('p', 'shopping-receipt-date', receipt.legacy ? '旧版から引き継いだ購入チェック' : date));
      const details = make('details', 'shopping-ingredient-sources'); details.append(make('summary', '', `使う献立 ${receipt.allocations.length}品`));
      const sources = make('ul');
      for (const allocation of receipt.allocations) {
        const menu = allMenus.find(menu => menu.id === allocation.menuId);
        sources.append(make('li', '', `${menu?.label ? `${menu.label} · ` : ''}${menu?.item.name ?? '過去の献立'}${ingredient ? ` ${materialAmount(receipt.ingredientId, allocation.amount, data)}` : ''}`));
      }
      details.append(sources); row.append(details);
      if (receipt.stocked) row.append(make('p', 'field-note', '手持ちに追加済み'));
      else if (ingredient && onStockReceipt && canStockReceipt(receipt)) {
        row.append(stockControl(receipt, purchase.purchase, foodName));
      } else if (ingredient && onStockReceipt) {
        row.append(make('p', 'field-note', '食べた分を含みます。余った分は「手持ち食材」に登録できます。'));
      }
      row.append(control('購入チェックを戻す', 'button-secondary shopping-undo-purchase', () => {
        if (onUndoPurchase(receipt.id) === false) return;
        row.hidden = true;
        const remaining = [...list.children].filter(child => !child.hidden).length;
        count.textContent = `${remaining}件`;
      })); list.append(row);
    }
  }

  try { if (view === 'review') renderReview(); else if (view === 'purchased') renderPurchased(); else renderChecklist(); }
  catch (cause) { report(cause); }
  return root;
}
