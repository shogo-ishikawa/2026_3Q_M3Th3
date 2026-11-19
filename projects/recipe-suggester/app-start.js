// アカウントに結び付いた保存先が準備できてから、アプリを一度だけ起動します。
import {parseJournal} from './journal.js';
import {ALLERGENS, INGREDIENTS, RECIPES} from './data.js';

let session;

export function normalizeLegacyJournal(raw) {
  const journal = parseJournal(raw, {allergens: ALLERGENS, ingredients: INGREDIENTS, recipes: RECIPES});
  return JSON.stringify(journal);
}

export function getAccountSession() {
  if (!session) throw Error('Google アカウントでログインしてください。');
  return session;
}

export async function startMealPalette(account) {
  const sample = new URLSearchParams(globalThis.location?.search).get('demo') === 'week';
  if (!account?.user?.uid || account.user.uid !== account.uid || (!sample && !account.storage)) {
    throw Error('アカウントの保存先を確認してください。');
  }
  if (session) throw Error('アカウントを切り替えるには画面を開き直してください。');
  session = account;
  await import('./app.js');
}
