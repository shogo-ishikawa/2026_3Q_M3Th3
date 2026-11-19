// Two separate Firebase app instances exercise the actual journal transaction adapter.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {firestoreJournal} from '../../cloud-journal-firestore.js';

const require = createRequire(new URL('../../tools/firebase-sdk/package.json', import.meta.url));
const {initializeApp, deleteApp} = require('firebase/app');
const api = require('firebase/firestore');
const endpoint = new URL('http://' + process.env.FIRESTORE_EMULATOR_HOST);
assert(['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname) && endpoint.port);
const uid = 'reader-' + randomUUID();
const apps = [];

function client() {
  const app = initializeApp({projectId: 'demo-meal-palette'}, randomUUID());
  apps.push(app);
  const db = api.getFirestore(app);
  api.connectFirestoreEmulator(db, endpoint.hostname, Number(endpoint.port), {
    mockUserToken: {sub: uid, email: 'reader@example.test', email_verified: true,
      firebase: {sign_in_provider: 'google.com', identities: {}}}
  });
  return firestoreJournal({db, uid, api, assertActive() {}});
}

try {
  const first = client();
  assert.deepEqual(await first.read(null), {revision: null});
  const id = randomUUID();
  const raw = JSON.stringify({entries: ['野菜スープ'.repeat(30000)], plans: ['夕食']});
  assert.deepEqual(await first.write({id, raw, base: null, ancestors: []}), {revision: id});
  const second = client();
  assert.deepEqual(await second.read(null), {revision: id, raw});
  assert.deepEqual(await second.read(id), {revision: id});
  assert.deepEqual(await second.write({id: randomUUID(), raw: '{}', base: null, ancestors: []}),
    {revision: id, conflict: true});
  const nextId = randomUUID();
  assert.deepEqual(await second.write({id: nextId, raw: '{}', base: id, ancestors: []}), {revision: nextId});
  assert.deepEqual(await first.read(id), {revision: nextId, raw: '{}'});
  console.log('Verified first sign-in, cross-device reads, split records and stale-write protection.');
} finally {
  await Promise.all(apps.map(app => deleteApp(app)));
}
