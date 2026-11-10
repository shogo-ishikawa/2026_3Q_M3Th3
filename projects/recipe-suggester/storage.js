// 食事の記録は、このブラウザーの中だけに保存します。
export const STORAGE_KEY = 'kondate-note-v1';
export const GROUP_IDS = ['staple', 'vegetable', 'protein', 'dairy', 'fruit'];
export const PROTEIN_IDS = ['meat', 'fish', 'egg', 'soy'];
const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
const MAX_HISTORY = 1000;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateIsValid(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 2000 && year <= 2100 && date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

export function defaultState(today = localDate()) {
  return {version: 1, settings: {startDate: today, days: 3, servings: 2, allergens: [], excludedIngredients: []}, history: []};
}

function selectedIds(value, allowed, label) {
  if (!Array.isArray(value) || value.length > allowed.size || value.some(id => typeof id !== 'string' || !allowed.has(id))) {
    throw new Error(`${label}に、このアプリで扱えない値があります。`);
  }
  return [...new Set(value)];
}

export function validateState(value, data) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1) throw new Error('献立ノートの保存ファイルを選んでください。');
  const source = value.settings;
  if (!source || !dateIsValid(source.startDate) || !Number.isInteger(source.days) || source.days < 1 || source.days > 7 || !Number.isInteger(source.servings) || source.servings < 1 || source.servings > 8) {
    throw new Error('日付・日数・人数の設定を確認してください。');
  }
  const ingredientIds = new Set(Object.keys(data.ingredients));
  const recipeIds = new Set(data.recipes.map(recipe => recipe.id));
  const allergenIds = new Set(data.allergens.map(allergen => allergen.id));
  const settings = {startDate: source.startDate, days: source.days, servings: source.servings,
    allergens: selectedIds(source.allergens, allergenIds, 'アレルギー食材'),
    excludedIngredients: selectedIds(source.excludedIngredients, ingredientIds, '追加の除外食材')};
  if (!Array.isArray(value.history) || value.history.length > MAX_HISTORY) throw new Error(`食事の記録は${MAX_HISTORY}件まで読み込めます。`);
  const ids = new Set();
  const history = value.history.map(entry => {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || entry.id.length < 1 || entry.id.length > 120 || ids.has(entry.id) || !dateIsValid(entry.date) || !MEALS.includes(entry.meal)) throw new Error('食事の記録の日付・食事区分・識別子を確認してください。');
    ids.add(entry.id);
    if (entry.note !== undefined && (typeof entry.note !== 'string' || entry.note.length > 300)) throw new Error('料理名・メモは300文字以内にしてください。');
    const clean = {id: entry.id, date: entry.date, meal: entry.meal,
      recipeIds: selectedIds(entry.recipeIds, recipeIds, '記録したレシピ'),
      groups: selectedIds(entry.groups, new Set(GROUP_IDS), '食事の内容'),
      proteinSources: selectedIds(entry.proteinSources, new Set(PROTEIN_IDS), '主な食材'),
      note: entry.note || ''};
    if (!clean.recipeIds.length && !clean.note.trim()) throw new Error('記録には料理名かレシピを指定してください。');
    return clean;
  });
  return {version: 1, settings, history};
}

export function parseState(text, data) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_TEXT_BYTES) throw new Error('2 MB以下の保存ファイルを選んでください。');
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('保存ファイルを読み取れませんでした。JSON形式を確認してください。'); }
  return validateState(value, data);
}

export function readState(storage, data, today = localDate()) {
  try {
    const text = storage.getItem(STORAGE_KEY);
    return {state: text === null ? defaultState(today) : parseState(text, data), message: ''};
  } catch {
    return {state: defaultState(today), message: '以前の保存内容を読み込めませんでした。アレルギー・除外食材の設定も初期化されています。食材を選び直してください。この画面内では使えますが、保存できない環境では再読み込み後に記録が残りません。保存ファイルがあれば「記録を読み込む」から取り込めます。'};
  }
}

export function writeState(storage, state, data) {
  const clean = validateState(state, data);
  try { storage.setItem(STORAGE_KEY, JSON.stringify(clean)); return true; }
  catch { return false; }
}
