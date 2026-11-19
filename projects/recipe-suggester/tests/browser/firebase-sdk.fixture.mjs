// 配信用の一時コピーにだけ置く。テストではGoogleとFirestoreの通信だけを置き換える。
const accountKey = 'meal-fixture-auth';
const users = {
  member: {uid: 'member', displayName: '花子', email: 'member@example.test'},
  second: {uid: 'second', displayName: '次郎', email: 'second@example.test'},
  owner: {uid: 'owner', displayName: 'テスト管理者', email: 'owner@example.test'},
  invalid: {uid: 'invalid', displayName: '他の認証方式', email: 'owner@example.test'}
};
const auth = {currentUser: users[localStorage.getItem(accountKey)] || null};
let before, changed;

export const initializeApp = options => ({options});
export const getAuth = () => auth;
export const getFirestore = app => ({app});
export class GoogleAuthProvider {
  setCustomParameters() {}
  addScope(scope) { this.scope=scope; }
  static credentialFromResult(result) { return result.credential; }
}
export async function reauthenticateWithPopup(user,provider) {
  if(user!==auth.currentUser || provider.scope!=='https://www.googleapis.com/auth/drive.file') throw Error('fixture: invalid scope or user');
  return {user,credential:{accessToken:'test-drive-'+user.uid}};
}
export function beforeAuthStateChanged(_, callback) { before = callback; }
export function onIdTokenChanged(_, callback) {
  changed = callback;
  queueMicrotask(() => changed(auth.currentUser));
}
async function change(id) {
  const user = users[id] || null;
  await before?.(user);
  auth.currentUser = user;
  if (user) localStorage.setItem(accountKey, id);
  else localStorage.removeItem(accountKey);
  await changed?.(user);
}
window.addEventListener('storage', e => {
  if (e.key === accountKey && auth.currentUser?.uid !== (e.newValue || undefined)) change(e.newValue);
});
export const signInWithPopup = () => change(sessionStorage.getItem('meal-fixture-next') || 'member');
export const signOut = () => change(null);
export async function getIdTokenResult(user) {
  return {claims: {sub: user.uid, email_verified: true, email: user.email},
    signInProvider: user.uid === 'invalid' ? 'password' : 'google.com'};
}

export const doc = (dbOrRef, ...path) => [typeof dbOrRef === 'string' ? dbOrRef : '', ...path].filter(Boolean).join('/');
function snapshot(data) { return {exists: () => data != null, data: () => data}; }
async function database(action) {
  if (!navigator.onLine) throw Object.assign(Error('offline'), {code: 'unavailable'});
  return window.mealFixtureDatabase(action);
}
export async function runTransaction(_, callback) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const {documents, version} = await database({op: 'snapshot'});
    const writes = {};
    const result = await callback({
      get: path => Promise.resolve(snapshot(documents[path])),
      set: (path, fields) => { writes[path] = fields; },
      delete: path => { writes[path] = null; }
    });
    if (!Object.keys(writes).length || await database({op: 'commit', writes, version})) return result;
  }
  throw Object.assign(Error('conflict'), {code: 'aborted'});
}
export const getDocFromServer = async path => snapshot((await database({op: 'snapshot'})).documents[path]);
export const collection = (_, path) => path;
export const where = (field, op, value) => ({field, op, value});
export const or = (...filters) => ({filters});
export const query = (path, filter) => ({path, ...filter});
export async function getCountFromServer(q) {
  const {documents} = await database({op: 'snapshot'});
  const matches = (data, filter) => filter.op === 'array-contains'
    ? Array.isArray(data[filter.field]) && data[filter.field].includes(filter.value)
    : data[filter.field] === filter.value;
  const count = Object.entries(documents).filter(([path, data]) =>
    path.startsWith(q.path + '/') && (q.filters ?? [q]).some(filter => matches(data, filter))).length;
  return {data: () => ({count})};
}
