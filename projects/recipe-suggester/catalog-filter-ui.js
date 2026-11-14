/** 検索の絞り込みを見えるようにし、除外条件を保ったまま任意の条件を外します。 */
const OPTIONAL_IDS = new Set(['query', 'section', 'category', 'method', 'family', 'genre', 'nature', 'illustrated']);

function make(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function action(label, className, onClick, accessibleLabel = label) {
  const button = make('button', className, label);
  button.type = 'button';
  button.setAttribute('aria-label', accessibleLabel);
  button.addEventListener('click', event => { event.preventDefault(); onClick(); });
  return button;
}

/**
 * filters: [{id, label, onRemove, countWithout?}]
 * countWithout is optional evidence supplied by the caller, never an estimate.
 * onClear must clear optional controls only, leaving dietary settings unchanged.
 */
export function renderCatalogFilters({filters = [], protectedLabels = [], resultCount = null, onClear} = {}) {
  const labelled = filters.filter(filter => filter && typeof filter.label === 'string' && filter.label.trim());
  const optional = labelled.filter(filter => OPTIONAL_IDS.has(filter.id));
  const protectedConditions = [
    ...protectedLabels.filter(label => typeof label === 'string' && label.trim()),
    ...labelled.filter(filter => !OPTIONAL_IDS.has(filter.id)).map(filter => filter.label),
  ];
  const protectedText = [...new Set(protectedConditions)];
  const empty = resultCount === 0;
  const root = make('section', 'catalog-filter-panel');
  root.setAttribute('aria-label', '現在の検索条件');
  root.hidden = !optional.length && !protectedText.length && !empty;

  if (optional.length) {
    const heading = make('div', 'catalog-filter-heading');
    heading.append(make('h3', '', '現在の絞り込み'));
    if (typeof onClear === 'function') heading.append(action('絞り込みをすべて外す', 'catalog-filter-clear', onClear, '検索や種類などの絞り込みをすべて外す。アレルギーと避ける食材の条件は残します'));
    root.append(heading);
    const list = make('ul', 'catalog-active-filter-list');
    for (const filter of optional) {
      const row = make('li');
      if (typeof filter.onRemove === 'function') {
        const button = action('', 'catalog-filter-chip', filter.onRemove, `${filter.label}の条件を外す`);
        const cross = make('span', 'catalog-filter-cross', '×');
        cross.setAttribute('aria-hidden', 'true');
        button.append(make('span', 'catalog-filter-label', filter.label), cross);
        row.append(button);
      } else row.append(make('span', 'catalog-filter-chip catalog-filter-readonly', filter.label));
      list.append(row);
    }
    root.append(list);
  }

  if (protectedText.length) {
    const protection = make('div', 'catalog-protected-filters');
    const list = make('ul', 'catalog-protected-filter-list');
    for (const label of protectedText) list.append(make('li', '', label));
    const note = make('p', '', 'アレルギーと避ける食材の条件は、自動では解除しません。');
    const settings = make('a', 'catalog-filter-settings', '除外条件を設定で確認');
    settings.setAttribute('href', '#settings');
    protection.append(list, note, settings);
    root.append(protection);
  }

  if (empty) {
    const explanation = make('div', 'catalog-filter-empty');
    explanation.setAttribute('role', 'status');
    explanation.append(make('h3', '', '条件に合う料理がありません'));
    if (optional.length) {
      explanation.append(make('p', '', `現在の条件：${optional.map(filter => filter.label).join(' ／ ')}。`));
      explanation.append(make('p', '', '別の料理名で探すか、絞り込みを1つずつ外してみてください。'));
      const alternatives = optional.filter(filter => typeof filter.onRemove === 'function' && Number.isInteger(filter.countWithout) && filter.countWithout > 0);
      if (alternatives.length) {
        const choices = make('div', 'catalog-filter-alternatives');
        for (const filter of alternatives) choices.append(action(`「${filter.label}」を外すと${filter.countWithout}種類`, 'catalog-filter-alternative', filter.onRemove));
        explanation.append(choices);
      }
    } else explanation.append(make('p', '', '別の料理名や種類でも探してみてください。'));
    if (protectedText.length) explanation.append(make('p', 'catalog-filter-protection-note', '上の除外条件はそのまま保ちます。'));
    root.append(explanation);
  }
  return root;
}
