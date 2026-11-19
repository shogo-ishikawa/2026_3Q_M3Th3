import {JOURNAL_KEY, PREVIOUS_JOURNAL_KEY} from './journal.js';
import {STORAGE_KEY} from './storage.js';
import {firestoreJournal, journalParts} from './cloud-journal-firestore.js';

const messages = {
  syncing: 'クラウドと同期しています…',
  synced: 'クラウドと同期しました。',
  pending: '通信が戻るとクラウドと同期します。',
  error: 'クラウドに接続できませんでした。端末の記録は保持しています。',
  conflict: '別の端末にも変更があります。端末の記録を書き出してからクラウドの記録を開けます。'
};

export async function openCloudJournal({uid, db, api, projectId = db?.app?.options.projectId,
  local = window.localStorage, isCurrent = () => true, onStatus = () => {}, onChange = () => {},
  events = globalThis.window, isOnline = () => globalThis.navigator?.onLine !== false, backend: injected}) {
  if (!uid || !projectId) throw Error('記録の保存先を確認できません。');
  const prefix = 'meal-palette:' + encodeURIComponent(projectId) + ':' + encodeURIComponent(uid) + ':';
  const recordKey = prefix + 'cloud-journal';
  const ackKey = prefix + 'cloud-receipt';
  const claimKey = 'meal-palette:legacy-owner';
  let running = true, conflict = null, request = null, rerun = false, timer, unsubscribe, lastStatus;
  let confirmedEmpty = false, observedId;
  function assertActive() {
    if (!running || !isCurrent()) throw Error('ログイン中のアカウントが変わりました。');
  }
  const backend = injected ?? firestoreJournal({api, db, uid, assertActive});
  function status(state) {
    if (!running || !isCurrent() || lastStatus === state) return;
    lastStatus = state;
    onStatus({state, message: messages[state]});
  }
  function cached() {
    assertActive();
    const raw = local.getItem(recordKey);
    if (raw === null) return null;
    const record = JSON.parse(raw);
    if (typeof record.raw !== 'string' || typeof record.id !== 'string' ||
        !(record.base === null || typeof record.base === 'string') || !Array.isArray(record.ancestors)) {
      throw Error('端末に保存した記録の同期情報を読み込めません。');
    }
    // 受領通知は本文と別のキーに保存する。送信中に別タブが編集した本文を上書きしない。
    const receipt = local.getItem(ackKey);
    if (receipt === record.id) return {...record, base: receipt, ancestors: []};
    const offset = record.ancestors.indexOf(receipt);
    if (offset >= 0) return {...record, base: receipt, ancestors: record.ancestors.slice(offset + 1)};
    return record;
  }
  function writeCache(record) {
    assertActive();
    if (record) local.setItem(recordKey, JSON.stringify(record));
    else local.removeItem(recordKey);
  }
  function dirty(record) { return record && record.id !== record.base; }
  function schedule(delay = 120) {
    if (!running) return;
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
    timer.unref?.();
  }
  function markConflict(revision) {
    conflict = {revision};
    status('conflict');
  }

  async function synchronize() {
    const initial = cached();
    if (conflict) { status('conflict'); return; }
    if (!isOnline()) { status('pending'); return; }
    status('syncing');
    if (dirty(initial)) {
      const reply = await backend.write(initial);
      assertActive();
      if (reply.conflict) { markConflict(reply.revision); return; }
      local.setItem(ackKey, initial.id);
      if (cached()?.id !== initial.id) rerun = true;
    } else {
      const remote = await backend.read(initial?.base ?? null);
      assertActive();
      if (cached()?.id !== initial?.id) { rerun = true; return; }
      confirmedEmpty = !remote.revision && !initial;
      if (!remote.revision && initial) { markConflict(null); return; }
      if (remote.revision && remote.revision !== initial?.base) {
        writeCache({id: remote.revision, base: remote.revision, raw: remote.raw, ancestors: []});
        onChange();
      }
    }
    if (!rerun) status('synced');
  }

  function flush() {
    if (!running || !isCurrent()) return Promise.resolve();
    clearTimeout(timer);
    if (request) { rerun = true; return request; }
    request = (async () => {
      do {
        rerun = false;
        try { await synchronize(); }
        catch (error) {
          if (!running || !isCurrent()) return;
          const retryable = !isOnline() || ['unavailable', 'deadline-exceeded', 'aborted'].includes(error.code);
          status(retryable ? 'pending' : 'error');
          if (retryable && isOnline()) schedule(30000);
          return;
        }
      } while (rerun && running && isCurrent());
    })().finally(() => { request = null; });
    return request;
  }

  function setJournal(raw) {
    const previous = cached();
    if (observedId !== undefined && observedId !== (previous?.id ?? null)) {
      throw Error('別の画面で保存内容が変わりました。最新の記録を開いてください。');
    }
    if (previous?.raw === raw) return;
    journalParts(raw);
    const ancestors = dirty(previous) ? [...previous.ancestors, previous.id] : [];
    const id = crypto.randomUUID();
    writeCache({raw, id, base: previous?.base ?? null, ancestors});
    observedId = id;
    confirmedEmpty = false;
    if (conflict) return;
    status(isOnline() ? 'syncing' : 'pending');
    schedule();
  }
  const storage = {
    getItem(key) {
      assertActive();
      if (key !== JOURNAL_KEY) return local.getItem(prefix + key);
      const record = cached();
      observedId = record?.id ?? null;
      return record?.raw ?? null;
    },
    setItem(key, value) {
      assertActive();
      if (key === JOURNAL_KEY) setJournal(String(value));
      else local.setItem(prefix + key, String(value));
    },
    ownsEvent(event) {
      return event.storageArea === local && (event.key === null || event.key.startsWith(prefix));
    }
  };

  function storageChanged(event) {
    if (!running || !isCurrent() || !storage.ownsEvent(event) || (event.key && event.key !== recordKey)) return;
    conflict = null;
    onChange();
    schedule();
  }
  function becameOnline() { schedule(0); }
  function stop() {
    running = false;
    clearTimeout(timer);
    unsubscribe?.();
    events?.removeEventListener('online', becameOnline);
    events?.removeEventListener('storage', storageChanged);
  }
  function legacyRaw() {
    if (!confirmedEmpty || cached() || local.getItem(claimKey) !== null) return null;
    for (const key of [JOURNAL_KEY, PREVIOUS_JOURNAL_KEY, STORAGE_KEY]) {
      const raw = local.getItem(key);
      if (raw !== null) return raw;
    }
    return null;
  }
  async function adoptLegacy(raw) {
    assertActive();
    if (!legacyRaw() || !isOnline()) throw Error('オンラインで記録のないアカウントにログインしてから引き継いでください。');
    const remote = await backend.read(null);
    assertActive();
    if (remote.revision || !legacyRaw()) throw Error('保存内容が変わりました。画面を開き直してください。');
    JSON.parse(raw);
    setJournal(raw);
    local.setItem(claimKey, prefix);
    onChange();
    await flush();
  }
  async function useCloudVersion() {
    assertActive();
    if (!conflict) throw Error('クラウドと端末の変更をもう一度確認してください。');
    const seen = conflict, initial = cached();
    const remote = await backend.read(null);
    assertActive();
    if (initial?.id !== cached()?.id || remote.revision !== seen.revision) {
      markConflict(remote.revision);
      throw Error('保存内容が変わりました。端末の記録を確認してもう一度選んでください。');
    }
    writeCache(remote.revision ? {raw: remote.raw, id: remote.revision, base: remote.revision, ancestors: []} : null);
    conflict = null;
    confirmedEmpty = !remote.revision;
    status('synced');
    onChange();
  }

  // SDKのオフライン検出を待つ間にも、このアカウントの端末記録を利用できる。
  const initialSync = flush();
  let openingTimer;
  try {
    await Promise.race([initialSync, new Promise(resolve => { openingTimer = setTimeout(resolve, 5000); })]);
    assertActive();
    events?.addEventListener('online', becameOnline);
    events?.addEventListener('storage', storageChanged);
    unsubscribe = backend.watch?.(revision => {
      if (!running || !isCurrent()) return;
      if (conflict && revision !== conflict.revision) markConflict(revision);
      else if (!conflict && revision !== (cached()?.base ?? null)) schedule();
    }, () => status('error'));
    return {storage, flush, stop, exportLocal: () => cached()?.raw ?? null, useCloudVersion, adoptLegacy, legacyRaw};
  } catch (error) {
    stop();
    throw error;
  } finally {
    clearTimeout(openingTimer);
  }
}
