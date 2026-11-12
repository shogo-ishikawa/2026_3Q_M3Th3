/** 記録のプレビューと不変更新。確認ダイアログと保存は呼び出し元が担当します。 */
import {dateIsValid, MEAL_IDS} from './journal.js';
import {recipePortion, quantityFromAmount} from './catalog.js';
import {describeRecipe} from './planner.js';
import {itemFromRecipe} from './nutrition.js';

const statuses = new Set(['planned', 'eaten']);
const resetStatuses = new Set(['all', ...statuses]);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const dateInRange = (date, filter) => date >= filter.from && date <= filter.to;
const newId = () => globalThis.crypto?.randomUUID?.() ?? `entry-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function checkedFilter(filter) {
  if (!isRecord(filter) || Object.keys(filter).some(key => !['from', 'to', 'status', 'meals'].includes(key))) {
    throw new Error('リセットする条件を確認してください。');
  }
  const {from, to, status, meals = MEAL_IDS} = filter;
  if (!dateIsValid(from) || !dateIsValid(to) || from > to) {
    throw new Error('リセットの期間は2000年から2100年までの日付を開始日から順に指定してください。');
  }
  if (!resetStatuses.has(status)) throw new Error('リセットする記録の種類を選んでください。');
  if (!Array.isArray(meals) || !meals.length || meals.length > MEAL_IDS.length ||
      Array.from(meals).some(meal => !MEAL_IDS.includes(meal)) || new Set(meals).size !== meals.length) {
    throw new Error('リセットする食事区分を選んでください。');
  }
  return {from, to, status, meals: new Set(meals)};
}

function checkedState(state) {
  if (!isRecord(state) || !Array.isArray(state.entries) || !Array.isArray(state.completedDays)) {
    throw new Error('食事の記録と完了した日の一覧を確認してください。');
  }
  for (const entry of state.entries) {
    if (!isRecord(entry) || !dateIsValid(entry.date) || !MEAL_IDS.includes(entry.meal) ||
        !statuses.has(entry.status) || !Array.isArray(entry.items) || Array.from(entry.items).some(item => !isRecord(item))) {
      throw new Error('食事の記録の日付・食事区分・状態・内容を確認してください。');
    }
  }
  if (Array.from(state.completedDays).some(date => !dateIsValid(date)) || new Set(state.completedDays).size !== state.completedDays.length) {
    throw new Error('記録を完了した日付を確認してください。');
  }
  return state;
}

const matchesEntry = (entry, filter) => dateInRange(entry.date, filter) &&
  (filter.status === 'all' || entry.status === filter.status) && filter.meals.has(entry.meal);
const clearsCompletion = (date, filter) => filter.status !== 'planned' && dateInRange(date, filter);

/** 範囲の両端を含む対象件数。メモだけの記録は entryCount にだけ含めます。 */
export function previewReset(state, filter) {
  const selected = checkedFilter(filter);
  checkedState(state);
  const entries = state.entries.filter(entry => matchesEntry(entry, selected));
  return {
    entryCount: entries.length,
    itemCount: entries.reduce((count, entry) => count + entry.items.length, 0),
    completedDayCount: state.completedDays.filter(date => clearsCompletion(date, selected)).length,
  };
}

/**
 * 記録の配列を置き換えた新しい state を返し、入力オブジェクトは変更しません。
 * 予定だけを消す場合は完了日を保持。実績を含む場合は範囲内の完了を取り消します。
 */
export function resetEntriesRange(state, filter) {
  const selected = checkedFilter(filter);
  checkedState(state);
  return {
    ...state,
    entries: state.entries.filter(entry => !matchesEntry(entry, selected)),
    completedDays: state.completedDays.filter(date => !clearsCompletion(date, selected)),
  };
}

/**
 * amount はメニューに表示する g・ml・個・貫などの量です。保存する quantity へ換算します。
 * 自動提案に使えない未確認メニューも、食べた事実や予定として記録できます。
 */
export function createCatalogEntry(input, data) {
  if (!isRecord(input) || Object.keys(input).some(key => !['recipeId', 'date', 'meal', 'status', 'amount', 'note'].includes(key))) {
    throw new Error('カレンダーへ登録する内容を確認してください。');
  }
  const {recipeId, date, meal, status, amount, note = ''} = input;
  if (typeof recipeId !== 'string' || !recipeId.trim() || recipeId.length > 120 || ['__proto__', 'constructor', 'prototype'].includes(recipeId)) {
    throw new Error('記録するメニューを選んでください。');
  }
  if (!dateIsValid(date)) throw new Error('記録する日付は2000年から2100年までで指定してください。');
  if (!MEAL_IDS.includes(meal) || !statuses.has(status)) throw new Error('食事区分と記録の種類を選んでください。');
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 100000) {
    throw new Error('記録する量は0より大きい数値で100000以下にしてください。');
  }
  if (typeof note !== 'string' || note.length > 2000) throw new Error('食事のメモは2000文字以内で入力してください。');
  const recipe = describeRecipe(recipeId, data);
  if (!recipe) throw new Error('このメニューは見つかりませんでした。');
  const portion = recipePortion(recipe, data);
  const quantity = quantityFromAmount(recipe, data, amount);
  if (quantity > 1000) throw new Error('記録する量は基準量の1000倍以下にしてください。');
  const item = itemFromRecipe(recipe, data, quantity);
  item.portion = {...portion};
  return {id: newId(), date, meal, status, note, items: [item]};
}
