import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {accountIdentity} from '../account-identity.js';

const user = {uid: 'u1', displayName: 'さくら'};
const owner = 'admin@example.test';
const adminHash = createHash('sha256').update(owner).digest('hex');
const token = {signInProvider: 'google.com', claims: {sub: user.uid, email: 'sakura@example.org', email_verified: true}};

test('挨拶にはGoogleの表示名を使い、表示名が空なら確認済みメールの名前を使う', async () => {
  assert.deepEqual(await accountIdentity(user, token), {name: 'さくら', isAdmin: false});
  assert.equal((await accountIdentity({...user, displayName:'   '}, token)).name, 'sakura');
});

test('管理者表示は本人のGoogleトークンの確認済みメールアドレスに限る', async () => {
  const adminToken = {...token, claims: {...token.claims, email: owner}};
  assert.equal((await accountIdentity(user, adminToken, adminHash)).isAdmin, true);
  assert.equal((await accountIdentity({...user, email:owner, displayName:owner}, token, adminHash)).isAdmin, false);
  assert.equal(await accountIdentity(user, {...adminToken, signInProvider: 'password'}), null);
  assert.equal(await accountIdentity(user, {...adminToken, claims:{...adminToken.claims, email_verified:false}}), null);
  assert.equal(await accountIdentity({...user, uid:'u2'}, adminToken), null);
  assert.equal(await accountIdentity(user, null), null);
});
