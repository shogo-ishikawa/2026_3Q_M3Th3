import assert from 'node:assert/strict';
import test from 'node:test';
import {openCloudJournal} from '../cloud-journal.js';
import {firestoreJournal, journalParts} from '../cloud-journal-firestore.js';
import {JOURNAL_KEY} from '../journal.js';

function device() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
}
function cloud() {
  const rows = new Map();
  // Clone / commit the whole map only on success, like an atomic Firestore transaction.
  const api = {
    doc: (base, ...path) => [typeof base === 'string' ? base : '', ...path].join('/'),
    runTransaction: async (_, operation) => {
      const writes = [];
      const reply = await operation({
        async get(ref) {
          return {exists: () => rows.has(ref), data: () => rows.get(ref)};
        },
        set: (key, value) => writes.push(() => rows.set(key, value)),
        delete: key => writes.push(() => rows.delete(key))
      });
      writes.forEach(apply => apply());
      return reply;
    }
  };
  return {rows, api, db: {}};
}
function app(options) {
  return openCloudJournal({uid: 'alice', projectId: 'meals', events: new EventTarget(), ...options});
}

test('2 MiBの手前まで記録し、文書境界の絵文字と短縮後の分割数も一致する', async () => {
  const backend = cloud();
  const a = await app({...backend, local: device()});
  const raw = 'a'.repeat(96 * 1024 - 1) + '🍌' + 'x'.repeat(2 * 1024 * 1024 - 96 * 1024 - 3);
  assert.equal(Buffer.byteLength(raw), 2 * 1024 * 1024);
  assert.equal(journalParts(raw).map(s => Buffer.from(s).toString()).join(''), raw);
  assert.throws(() => journalParts(raw + 'x'));
  a.storage.setItem(JOURNAL_KEY, raw);
  await a.flush();
  assert.ok(backend.rows.size > 2);
  const b = await app({...backend, local: device()});
  assert.equal(b.exportLocal(), raw);
  b.storage.setItem(JOURNAL_KEY, '{"entries":[]}');
  await b.flush();
  assert.equal(backend.rows.size, 2);
  await a.flush();
  assert.equal(a.exportLocal(), '{"entries":[]}');
  a.stop(); b.stop();
});

test('端末・アカウント・プロジェクトを区別し、同一利用者の保存済み献立と栄養記録を別端末で復元する', async () => {
  const first = device(), remote = cloud();
  remote.db.app = {options: {projectId: 'meals'}};
  const raw = JSON.stringify({entries: [{status:'planned'}, {status:'eaten', items:[{kcal:220}]}], targets:{kcal:1900}});
  const a = await app({...remote, local: first});
  a.storage.setItem(JOURNAL_KEY, raw);
  a.storage.setItem('backup', 'only-alice');
  await a.flush();
  const b = await app({...remote, local: device()});
  assert.equal(b.exportLocal(), raw);
  const bob = await app({...remote, uid:'bob', local:first});
  assert.equal(bob.storage.getItem(JOURNAL_KEY), null);
  assert.equal(bob.storage.getItem('backup'), null);
  const other = await app({...cloud(), projectId:'other', local:first});
  assert.equal(other.exportLocal(), null);
  a.stop(); b.stop(); bob.stop(); other.stop();
});

test('未送信の編集を再起動後に送り、別端末との競合時は両方を保持する', async () => {
  const local = device(), remote = cloud(), other = device();
  let online = true, status;
  const config = {...remote, local, isOnline: () => online, onStatus: value => {status = value.state;}};
  let a = await app(config);
  a.storage.setItem(JOURNAL_KEY, 'original');
  await a.flush();
  const b = await app({...remote, local:other});
  online = false;
  a.storage.setItem(JOURNAL_KEY, 'offline edit'); await a.flush(); a.stop();
  a = await app(config);
  assert.equal(a.exportLocal(), 'offline edit');
  assert.equal(status, 'pending');
  b.storage.setItem(JOURNAL_KEY, 'other edit'); await b.flush();
  online = true;
  await a.flush();
  assert.equal(status, 'conflict');
  assert.equal(a.exportLocal(), 'offline edit');
  const third = await app({...remote, local:device()});
  assert.equal(third.exportLocal(), 'other edit');
  b.storage.setItem(JOURNAL_KEY, 'even newer'); await b.flush();
  await assert.rejects(a.useCloudVersion(), /保存内容が変わりました/);
  assert.equal(a.exportLocal(), 'offline edit');
  await a.useCloudVersion();
  assert.equal(a.exportLocal(), 'even newer');
  a.stop(); b.stop(); third.stop();
});

test('送信完了を受け取る前に次を編集して閉じても直系の変更が再送される', async () => {
  const local = device(), remote = cloud();
  const transport = firestoreJournal({...remote, uid:'alice', assertActive:()=>{}});
  let release, wrote;
  const applied = new Promise(ok => { wrote = ok; });
  const backend = {...transport, async write(record) {
    const result = await transport.write(record);
    wrote();
    await new Promise(ok => { release = ok; });
    return result;
  }};
  const a = await app({backend, local});
  a.storage.setItem(JOURNAL_KEY, 'first');
  const pending = a.flush();
  await applied;
  a.storage.setItem(JOURNAL_KEY, 'second');
  a.stop();
  const fresh = await app({...remote, local});
  assert.equal(fresh.exportLocal(), 'second');
  release(); await pending;
  const reader = await app({...remote, local:device()});
  assert.equal(reader.exportLocal(), 'second');
  fresh.stop(); reader.stop();
});

test('未ログイン時代の記録は同意後だけ一つのアカウントへ引き継ぐ', async () => {
  const local = device(), remote = cloud();
  const old = '{"version":2}', converted = '{"version":3}';
  local.setItem('kondate-note-v2', old);
  const a = await app({...remote, local});
  assert.equal(a.legacyRaw(), old);
  assert.equal(a.storage.getItem('kondate-note-v2'), null);
  assert.equal(a.storage.getItem(JOURNAL_KEY), null);
  await a.adoptLegacy(converted);
  assert.equal(a.exportLocal(), converted);
  assert.equal(local.getItem('kondate-note-v2'), old);
  assert.equal(a.legacyRaw(), null);
  const b = await app({...remote, uid:'bob', local});
  assert.equal(b.legacyRaw(), null);
  assert.equal(b.exportLocal(), null);
  a.stop(); b.stop();
});

test('切り替えたアカウントと終了したセッションから以前の記録を操作できない', async () => {
  let current = true;
  const a = await app({...cloud(), local:device(), isCurrent:() => current});
  current = false;
  assert.throws(() => a.storage.getItem(JOURNAL_KEY), /アカウント/);
  assert.throws(() => a.storage.setItem('backup', 'new'), /アカウント/);
  a.stop();
  assert.throws(() => a.exportLocal(), /アカウント/);
});

test('同じ端末の別タブが先に書いたら古い表示からの保存を拒否する', async () => {
  const local = device(), remote = cloud();
  const first = await app({...remote, local});
  const second = await app({...remote, local});
  assert.equal(first.storage.getItem(JOURNAL_KEY), null);
  assert.equal(second.storage.getItem(JOURNAL_KEY), null);
  first.storage.setItem(JOURNAL_KEY, 'first tab');
  assert.throws(() => second.storage.setItem(JOURNAL_KEY, 'outdated tab'), /別の画面/);
  await first.flush();
  assert.equal(second.storage.getItem(JOURNAL_KEY), 'first tab');
  second.storage.setItem(JOURNAL_KEY, 'after refreshing');
  await second.flush();
  first.stop(); second.stop();
});

test('読み込みに必要な文書が欠けている場合は端末の保存済み記録を維持する', async () => {
  const local = device(), remote = cloud();
  let state;
  const first = await app({...remote, local, onStatus: value => {state = value.state;}});
  first.storage.setItem(JOURNAL_KEY, 'last good copy');
  await first.flush();
  const second = await app({...remote, local:device()});
  second.storage.setItem(JOURNAL_KEY, 'incomplete incoming');
  await second.flush();
  remote.rows.delete('/users/alice/mealJournal/current/parts/0');
  await first.flush();
  assert.equal(state, 'error');
  assert.equal(first.exportLocal(), 'last good copy');
  first.stop(); second.stop();
});
