/** 食事などの変更を端末内のメモリーで取り消します。表示設定は巻き戻しません。 */
const CONTENT_KEYS = ['entries', 'completedDays', 'customRecipes', 'pantry', 'favourites', 'mealSets', 'batches', 'purchaseSettings'];
const content = state => Object.fromEntries(CONTENT_KEYS.filter(key => Object.hasOwn(state, key)).map(key => [key, structuredClone(state[key])]));

export function createJournalHistory({limit = 10} = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 30) throw new Error('取り消せる操作の件数を確認してください。');
  const history = [];
  return {
    record(before, after, label = '記録の変更') {
      const previous = content(before), next = content(after);
      if (JSON.stringify(previous) === JSON.stringify(next)) return false;
      history.push({previous, label: typeof label === 'string' && label.trim() ? label.slice(0, 120) : '記録の変更'});
      if (history.length > limit) history.shift();
      return true;
    },
    undo(current, {validate = value => value} = {}) {
      if (!history.length) return null;
      if (typeof validate !== 'function') throw new Error('取り消す内容の確認方法を指定してください。');
      const {previous} = history.at(-1), next = structuredClone(current);
      for (const key of CONTENT_KEYS) {
        if (Object.hasOwn(previous, key)) next[key] = structuredClone(previous[key]);
        else delete next[key];
      }
      const result = validate(next);
      history.pop();
      return result;
    },
    clear() { history.length = 0; },
    get size() { return history.length; },
    get label() { return history.at(-1)?.label ?? ''; },
  };
}
