/** 本人確認と保存先の準備が済んだアカウントだけでアプリを開く。 */
import {accountIdentity} from './account-identity.js';
import {createDrivePhotos} from './drive-photos.js';

const byId = id => document.getElementById(id);
const gate = byId('account-gate');
const content = byId('account-content');
const login = byId('google-login');
const retry = byId('account-retry');
const message = byId('account-gate-message');
const demo = new URLSearchParams(location.search).get('demo') === 'week';

let generation = 0;
let openingUid = null;
let mountedUid = null;
let journal = null;
let photos = null;
let stopFeedback;
let appLoaded = false;
let adminVisible = false;
let lastStatus = null;
let nextSignInHint = '';

function lock() {
  document.body.setAttribute('data-account-locked', '');
  content.inert = true;
  content.hidden = true;
  gate.hidden = false;
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  byId('account-greeting').textContent = '';
  byId('account-birthday').textContent = '';
  byId('account-birthday').hidden = true;
  byId('account-admin').hidden = true;
}

function stop() {
  generation++;
  openingUid = null;
  mountedUid = null;
  lock();
  journal?.stop();
  journal = null;
  photos?.stop();
  photos = null;
  stopFeedback?.();
  stopFeedback = null;
}

function needsReload(text) {
  login.disabled = true;
  message.textContent = text;
  retry.hidden = false;
}

function showStatus(status) {
  lastStatus = status;
  byId('account-sync-state').textContent = status.message;
  byId('account-sync-retry').hidden = !['pending', 'error'].includes(status.state);
  byId('account-save-copy').hidden = status.state !== 'conflict';
  byId('account-use-cloud').hidden = status.state !== 'conflict';
  const legacy = Boolean(journal?.legacyRaw());
  byId('account-legacy-import').hidden = !legacy;
  byId('account-sync-panel').hidden = !legacy && !['pending', 'error', 'conflict'].includes(status.state);
  if (status.state === 'synced') syncMessage('');
}

function syncMessage(text) {
  const detail = byId('account-sync-detail');
  detail.textContent = text;
  detail.hidden = !text;
}

function downloadCurrentCopy() {
  const raw = journal?.exportLocal();
  if (typeof raw !== 'string') return;
  const url = URL.createObjectURL(new Blob([raw], {type: 'application/json'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'meal-palette-device-copy.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function wireJournal() {
  byId('account-sync-retry').onclick = async () => {
    try { await journal.flush(); } catch { syncMessage('通信を確認してから、もう一度お試しください。'); }
  };
  byId('account-save-copy').onclick = downloadCurrentCopy;
  byId('account-use-cloud').onclick = async () => {
    if (!confirm('この端末だけの編集はクラウドの記録に置き換わります。必要な記録を書き出しましたか？ 置き換えるには「OK」を選んでください。')) return;
    try {
      await journal.useCloudVersion();
      location.reload();
    } catch { syncMessage('保存内容を確認できませんでした。通信と同期状況を確認してください。'); }
  };
  byId('account-legacy-import').onclick = async () => {
    const raw = journal.legacyRaw();
    if (!raw || !confirm('このブラウザーに残っている以前の記録と設定を、ログイン中のGoogleアカウントに保存します。ご自身の記録であることを確認してください。')) return;
    try {
      const {normalizeLegacyJournal} = await import('./app-start.js');
      await journal.adoptLegacy(normalizeLegacyJournal(raw));
      location.reload();
    } catch { syncMessage('以前の記録を引き継げませんでした。同期状況と保存内容を確認してください。'); }
  };
}

function signInError(code) {
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'ログインを取り消しました。';
  if (code === 'auth/popup-blocked') return 'このサイトのポップアップを許可して、もう一度ログインしてください。';
  if (code === 'auth/network-request-failed') return '通信できる状態で、もう一度ログインしてください。';
  return 'Googleでログインできませんでした。時間をおいてもう一度お試しください。';
}

async function start() {
  const response = await fetch('./assets/firebase/config.json');
  if (!response.ok) throw Error('config');
  const config = await response.json();
  if (!config.apiKey || !config.projectId || !config.appId || config.authDomain !== config.projectId + '.firebaseapp.com') {
    needsReload('アカウント機能の公開準備中です。');
    return;
  }
  const sdk = await import('./assets/firebase/firebase-sdk.js');
  const firebase = sdk.initializeApp(config, 'meal-palette');
  const auth = sdk.getAuth(firebase);
  auth.languageCode = 'ja';
  const db = sdk.getFirestore(firebase);
  const provider = new sdk.GoogleAuthProvider();
  provider.setCustomParameters({prompt: 'select_account'});

  login.onclick = async () => {
    login.disabled = true;
    message.textContent = 'Googleでログインしています…';
    try { await sdk.signInWithPopup(auth, provider); }
    catch (error) {
      if (mountedUid) return;
      message.textContent = signInError(error.code);
      login.disabled = false;
    }
  };
  byId('account-logout').onclick = async () => {
    stop();
    needsReload('ログアウトしています…');
    try {
      await sdk.signOut(auth);
      location.reload();
    } catch { needsReload('ログアウトを完了できませんでした。再読み込みして、もう一度お試しください。'); }
  };
  sdk.beforeAuthStateChanged(auth, next => {
    if (openingUid && next?.uid !== openingUid) stop();
  });
  sdk.onIdTokenChanged(auth, async user => {
    if (appLoaded && user?.uid !== mountedUid) {
      stop();
      location.reload();
      return;
    }
    if (!user) {
      stop();
      login.disabled = false;
      retry.hidden = true;
      message.textContent = nextSignInHint;
      nextSignInHint = '';
      return;
    }
    const alreadyOpening = openingUid === user.uid;
    if (!alreadyOpening) {
      stop();
      openingUid = user.uid;
      login.disabled = true;
      message.textContent = demo ? 'ログイン状態を確認しています…' : 'アカウントの記録を開いています…';
    }
    const number = generation;
    const current = () => generation === number && auth.currentUser?.uid === user.uid;
    try {
      const identity = await accountIdentity(user, await sdk.getIdTokenResult(user));
      if (!current()) return;
      if (!identity) {
        nextSignInHint = 'メールアドレスを確認済みのGoogleアカウントでログインしてください。';
        stop();
        await sdk.signOut(auth);
        return;
      }
      if (alreadyOpening) {
        if (mountedUid && adminVisible !== identity.isAdmin) { stop(); location.reload(); }
        return;
      }
      const {startMealPalette} = await import('./app-start.js');
      if (!current()) return;
      if (!demo) {
        const {openCloudJournal} = await import('./cloud-journal.js');
        const opened = await openCloudJournal({
          uid: user.uid, db, api: sdk, projectId: config.projectId, isCurrent: current,
          onStatus: status => { if (current()) showStatus(status); },
          onChange: () => { if (current()) document.dispatchEvent(new Event('meal-cloud-journal-change')); }
        });
        if (!current()) { opened.stop(); return; }
        journal = opened;
        if (lastStatus) showStatus(lastStatus);
        wireJournal();
      }
      if (demo) byId('account-sync-panel').hidden = true;
      if (!demo) photos = createDrivePhotos({auth, sdk, uid:user.uid, projectId:config.projectId, isCurrent:current});
      const session = {user, uid: user.uid, name: identity.name, isAdmin: identity.isAdmin, storage: journal?.storage, db, firestore: sdk, journal, auth, photos};
      // app.js のDOMリスナーが二つのアカウントにまたがらないよう切り替え時は再起動する。
      mountedUid = user.uid;
      appLoaded = true;
      await startMealPalette(session);
      if (!current()) return;
      if (!demo) {
        const {setupMenuFeedback} = await import('./menu-feedback.js');
        if (!current()) return;
        stopFeedback = setupMenuFeedback(session);
      }
      adminVisible = identity.isAdmin;
      byId('account-greeting').textContent = identity.isAdmin ? '' : identity.name + 'さん、こんにちは。';
      const admin = byId('account-admin');
      admin.hidden = !identity.isAdmin;
      if (identity.isAdmin) admin.onclick = () => {
        if (demo) { location.assign('./#settings-feedback'); return; }
        byId('tab-settings').click();
        byId('settings-tab-feedback').click();
        byId('admin-menu-proposals').focus();
      };
      gate.hidden = true;
      content.hidden = false;
      content.inert = false;
      document.body.removeAttribute('data-account-locked');
    } catch {
      if (!current()) return;
      stop();
      needsReload('アカウントの記録を開けませんでした。通信できる状態で再読み込みしてください。');
    }
  });
}

retry.onclick = () => location.reload();
window.addEventListener('pagehide', event => { if (event.persisted) lock(); });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
start().catch(() => needsReload('ログインに接続できませんでした。通信できる状態で再読み込みしてください。'));
