/** 食事などの変更を端末内のメモリーで取り消します。表示設定は巻き戻しません。 */
const CONTENT_KEYS = ['entries', 'completedDays', 'customRecipes', 'pantry', 'favourites', 'mealSets', 'batches', 'purchaseSettings', 'shoppingExtras', 'shoppingList', 'shoppingChecks', 'shoppingCatalog', 'shoppingReceipts'];
/** 手入力で編集中の料理や食事の情報を取り消したときだけ入力欄を閉じます。 */
export function manualEditAffected(before, after, editing) {
  if (!editing) return false;
  const version = state => {
    const entry = state.entries.find(entry => entry.id === editing.entryId);
    const item = entry?.items.find(item => item.id === editing.itemId);
    return item && JSON.stringify([entry.date, entry.meal, entry.status, entry.note, item]);
  };
  const restored = version(after);
  return restored === undefined || restored !== version(before);
}

export function createJournalHistory({limit = 10} = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 30) throw new Error('取り消せる操作の件数を確認してください。');
  const history = [];
  return {
    record(before, after, label = '記録の変更', {invalidatePlan = true} = {}) {
      const keys = CONTENT_KEYS.filter(key => Object.hasOwn(before, key) !== Object.hasOwn(after, key) ||
        JSON.stringify(before[key]) !== JSON.stringify(after[key]));
      if (!keys.length) return false;
      const previous = Object.fromEntries(keys.filter(key => Object.hasOwn(before, key)).map(key => [key, structuredClone(before[key])]));
      history.push({keys, previous, invalidatePlan, label: typeof label === 'string' && label.trim() ? label.slice(0, 120) : '記録の変更'});
      if (history.length > limit) history.shift();
      return true;
    },
    undo(current, {validate = value => value} = {}) {
      if (!history.length) return null;
      if (typeof validate !== 'function') throw new Error('取り消す内容の確認方法を指定してください。');
      const {keys, previous} = history.at(-1), next = structuredClone(current);
      for (const key of keys) {
        if (Object.hasOwn(previous, key)) next[key] = structuredClone(previous[key]);
        else delete next[key];
      }
      const result = validate(next);
      history.pop();
      return result;
    },
    clear() { history.length = 0; },
    get size() { return history.length; },
    get invalidatesPlan() { return history.at(-1)?.invalidatePlan ?? true; },
    get label() { return history.at(-1)?.label ?? ''; },
  };
}
