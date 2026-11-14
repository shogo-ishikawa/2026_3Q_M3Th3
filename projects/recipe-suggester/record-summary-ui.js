/** 保存前に、その量で登録する食事の合計を表示します。保存処理は持ちません。 */
import {describeRegistration} from './record-summary.js';
import {NUTRIENT_KEYS, NUTRIENT_LABELS, NUTRIENT_UNITS} from './nutrition.js';

const make = (tag, className='', text='') => {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== '') element.textContent = text;
  return element;
};
const format = value => Number(value.toFixed(3)).toLocaleString('ja-JP');
const materialText = part => `${part.name} ${format(part.amount)}${part.unit ?? '（単位未登録）'}`;

/** data は最新のマイメニューも参照できるよう、オブジェクトか getter を受け付けます。 */
export function createRecordSummary({getEntry, data}={}) {
  if (typeof getEntry !== 'function') throw Error('登録内容を読み取る処理を確認してください。');
  const element = make('section', 'record-summary');
  element.setAttribute('aria-label', '登録する内容');
  const heading = make('h4', 'record-summary-heading', '登録する内容');
  const prompt = make('p', 'record-summary-prompt', '料理と量を選ぶと、登録する合計を確認できます。');
  const content = make('div', 'record-summary-content');
  const context = make('p', 'record-summary-context');
  const items = make('ul', 'record-summary-items');
  const total = make('p', 'record-summary-total');
  total.setAttribute('role', 'status');
  total.setAttribute('aria-live', 'polite');
  const nutrients = make('dl', 'record-summary-nutrients');
  const materialPreview = make('p', 'record-summary-material-preview');
  const materialDetails = make('details', 'record-summary-materials');
  const materialHeading = make('summary');
  const materialList = make('ul', 'record-summary-material-list');
  const materialNote = make('p', 'record-summary-note', '材料は記録に残す内訳です。汁や具を残す設定では、栄養は摂取割合を反映し、材料は用意する全量です。');
  const incomplete = make('p', 'record-summary-warning', '材料が未登録・未確認の料理を含みます。表示された材料だけで全量とは限りません。');
  materialDetails.append(materialHeading, materialList, materialNote);
  content.append(context, items, total, nutrients, materialPreview, materialDetails, incomplete);
  element.append(heading, prompt, content);

  function nutritionText(summary, key) {
    if (!summary.items.some(item => item.nutrition[key] !== null)) return '未入力';
    return `${format(summary.nutrition.values[key])} ${NUTRIENT_UNITS[key]}${summary.nutrition.complete[key] ? '' : ' ＋不明分'}`;
  }
  function refresh() {
    try {
      const entry = getEntry();
      if (entry == null) throw Error('未選択');
      const summary = describeRegistration(entry, typeof data === 'function' ? data() : data);
      context.textContent = `${summary.date} ${summary.mealLabel}・${summary.statusLabel}`;
      items.replaceChildren(...summary.items.map(item => make('li', '', `${item.name} ${format(item.amount)}${item.unit}`)));
      total.textContent = `${summary.items.length}品・合計 ${nutritionText(summary, 'kcal')}`;
      nutrients.replaceChildren(...NUTRIENT_KEYS.filter(key => key !== 'kcal').map(key => {
        const pair = make('div', 'record-summary-nutrient');
        pair.append(make('dt', '', NUTRIENT_LABELS[key]), make('dd', '', nutritionText(summary, key)));
        return pair;
      }));
      materialPreview.textContent = summary.ingredients.slice(0, 3).map(materialText).join(' ／ ');
      materialPreview.hidden = !summary.ingredients.length;
      materialHeading.textContent = `材料の合計（${summary.ingredients.length}種類）`;
      materialList.replaceChildren(...summary.ingredients.map(part => make('li', '', materialText(part))));
      materialDetails.hidden = !summary.ingredients.length;
      incomplete.hidden = summary.ingredientsComplete;
      prompt.hidden = true;
      content.hidden = false;
      return summary;
    } catch {
      // 一時的に空欄や選択途中になったときも、以前の合計を表示し続けません。
      prompt.hidden = false;
      content.hidden = true;
      return null;
    }
  }
  refresh();
  return {element, refresh};
}
